// GitHub Notifications - pure logic for the Omarchy bar widget.
//
// Plain ECMAScript shared by two runtimes:
//   - BarWidget.qml / Panel.qml import it as a QML JS module;
//   - test-model.js requires it from Node (module.exports guard at the bottom).
//
// The widget is about exactly four fields of `gh api notifications`:
//     repository.name, repository.html_url, subject.title, subject.url
// Everything here turns gh's output into those four fields, turns gh's failures
// into one sentence worth reading, and builds every display string the bar icon
// and the panel show. No QML, no timers, no I/O - which is what lets node run
// this file directly.
//
// Fetching is deliberately bounded: one page of PAGE_SIZE notifications per
// load, plus a one-item `--include` probe whose Link header carries the total
// unread count. Nothing is fetched unbounded; the pagination control is a
// separate, pure function of the derived total page count.

// Default check interval: five minutes, as the widget was specified.
var DEFAULT_INTERVAL_SECONDS = 300;
var MIN_INTERVAL_SECONDS = 60;
var MAX_INTERVAL_SECONDS = 3600;

// Bounded fetch sizes.
var PAGE_SIZE = 5;

// Maximum number of middle page numbers the pagination frame shows.
var PAGINATION_WINDOW = 5;

// Hard caps on what the widget will ever hold in memory.
var MAX_STDOUT_BYTES = 262144; // 256 KiB
var MAX_STDERR_BYTES = 8192; // 8 KiB

// Retained-field caps, so one pathological API response cannot bloat a view.
var MAX_NAME_CHARS = 200;
var MAX_TITLE_CHARS = 300;
var MAX_URL_CHARS = 512;

// The count probe prints this sentinel on its own line; the loader splits the
// combined stdout on it to separate the probe response from the page response.
var COUNT_MARKER_TEXT = "@@GH_NOTIF_COUNT@@";
var COUNT_MARKER = "\n@@GH_NOTIF_COUNT@@\n";

function isArray(value) {
  return Object.prototype.toString.call(value) === "[object Array]";
}

function text(value) {
  return value === undefined || value === null ? "" : String(value);
}

function numberOr(value, fallback) {
  var n = Number(value);
  return isFinite(n) ? n : fallback;
}

function clampIntervalSeconds(value) {
  var seconds = Number(value);
  if (!isFinite(seconds) || seconds <= 0) seconds = DEFAULT_INTERVAL_SECONDS;
  seconds = Math.round(seconds);
  if (seconds < MIN_INTERVAL_SECONDS) seconds = MIN_INTERVAL_SECONDS;
  if (seconds > MAX_INTERVAL_SECONDS) seconds = MAX_INTERVAL_SECONDS;
  return seconds;
}

// ---------------------------------------------------------------------------
// the bounded gh command

// One shell string, built only from constants: a one-item `--include` probe
// (its Link `rel="last"` is the total unread count) followed by exactly one
// page of PAGE_SIZE notifications. Both streams are capped with `head -c`, so
// a runaway response can never be buffered whole. No unbounded-follow flags
// are used: only this one bounded probe-plus-page fetch.
function ghCommand(page) {
  var requested = Math.floor(Number(page));
  if (!isFinite(requested) || requested < 1) requested = 1;
  return (
    "set -o pipefail; { gh api \"notifications?per_page=1&page=1\" --include && " +
    "printf \"\\n" +
    COUNT_MARKER_TEXT +
    "\\n\" && " +
    "gh api \"notifications?per_page=" +
    PAGE_SIZE +
    "&page=" +
    requested +
    "\"; } " +
    "2> >(head -c " +
    MAX_STDERR_BYTES +
    " >&2) | head -c " +
    (MAX_STDOUT_BYTES + 1)
  );
}

function ghArgv(page) {
  return ["bash", "-lc", ghCommand(page)];
}

function countMarker() {
  return COUNT_MARKER;
}

// ---------------------------------------------------------------------------
// bounded parsing helpers

// UTF-8 byte length without Buffer, so this runs in Qt's JS engine too.
// Surrogate pairs count as four bytes; unpaired surrogates count as three.
function utf8Length(str) {
  var s = text(str);
  var bytes = 0;
  for (var i = 0; i < s.length; i++) {
    var code = s.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      var next = i + 1 < s.length ? s.charCodeAt(i + 1) : 0;
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        i++;
      } else bytes += 3;
    } else bytes += 3;
  }
  return bytes;
}

// `gh api ... --include` prints the status line and headers, a blank line, then
// the body. Split on the first blank line, tolerating CRLF or LF.
function splitHeadersBody(raw) {
  var s = text(raw);
  var at = s.indexOf("\r\n\r\n");
  if (at !== -1) return { headers: s.slice(0, at), body: s.slice(at + 4) };
  at = s.indexOf("\n\n");
  if (at !== -1) return { headers: s.slice(0, at), body: s.slice(at + 2) };
  return { headers: "", body: s };
}

// Every `<url>; rel="name"` occurrence, with the `page=` read out of the URL.
function parseLinkPages(headers) {
  var out = { first: null, prev: null, next: null, last: null };
  var s = text(headers);
  var re = /<([^>]*)>;\s*rel="([^"]*)"/g;
  var match;
  while ((match = re.exec(s)) !== null) {
    var candidates = match[1].match(/[?&]page=(\d+)/);
    if (!candidates) continue;
    var page = parseInt(candidates[1], 10);
    if (!isFinite(page)) continue;
    if (
      match[2] === "first" ||
      match[2] === "prev" ||
      match[2] === "next" ||
      match[2] === "last"
    )
      out[match[2]] = page;
  }
  return out;
}

// The count probe: Link `last` when the inbox overflows one item, otherwise the
// body array itself (length 0 or 1). A non-array body is rejected.
function countFromProbe(probeText) {
  var split = splitHeadersBody(probeText);
  var links = parseLinkPages(split.headers);
  if (links.last !== null) return links.last;
  var body = split.body.replace(/^\s+|\s+$/g, "");
  if (body === "") return null;
  var parsed;
  try {
    parsed = JSON.parse(body);
  } catch (e) {
    return null;
  }
  if (!isArray(parsed)) return null;
  return parsed.length;
}

function totalPagesFromCount(count, pageSize) {
  var n = Number(count);
  if (!isFinite(n) || n < 0) n = 0;
  var p = Number(pageSize);
  if (!isFinite(p) || p < 1) p = 1;
  return Math.max(1, Math.ceil(n / p));
}

function clampPage(page, totalPages) {
  var t = Math.floor(Number(totalPages));
  if (!isFinite(t) || t < 1) t = 1;
  var p = Math.floor(Number(page));
  if (!isFinite(p)) p = 1;
  if (p < 1) p = 1;
  if (p > t) p = t;
  return p;
}

// ---------------------------------------------------------------------------
// gh output -> the four fields

// Anything nested up to a few levels lands as one flat list of objects. The cap
// lets a caller stop as soon as enough items are in hand.
function flattenPages(parsed, limit) {
  var cap = limit === undefined ? Infinity : Number(limit);
  if (!isFinite(cap) || cap < 0) cap = Infinity;
  var out = [];
  function walk(node, depth) {
    if (depth > 4 || !isArray(node)) return;
    for (var i = 0; i < node.length; i++) {
      if (out.length >= cap) return;
      var entry = node[i];
      if (isArray(entry)) walk(entry, depth + 1);
      else if (entry !== null && typeof entry === "object") out.push(entry);
    }
  }
  walk(parsed, 0);
  return out;
}

function truncateChars(value, max) {
  var s = text(value);
  return s.length > max ? s.slice(0, max) : s;
}

// Only the four fields the widget is about. An entry with no repository, no
// title and no url is nothing anyone can read or click, so it is dropped rather
// than rendered as an empty row. Retained strings are capped.
function normalizeItem(raw) {
  if (!raw || typeof raw !== "object") return null;
  var repository = raw.repository || {};
  var subject = raw.subject || {};
  var item = {
    repoName: truncateChars(repository.name, MAX_NAME_CHARS),
    repoUrl: truncateChars(repository.html_url, MAX_URL_CHARS),
    title: truncateChars(subject.title, MAX_TITLE_CHARS),
    subjectUrl: truncateChars(subject.url, MAX_URL_CHARS),
  };
  if (
    item.repoName === "" &&
    item.repoUrl === "" &&
    item.title === "" &&
    item.subjectUrl === ""
  )
    return null;
  return item;
}

// gh's own error text is precise and short; this picks the cause out of it so
// the panel can say something a person can act on.
function failureText(exitCode, output) {
  var raw = text(output);
  var lower = raw.toLowerCase();
  if (
    lower.indexOf("command not found") !== -1 ||
    lower.indexOf("no such file or directory") !== -1
  )
    return "gh is not installed, or not on the PATH this shell session started with.";
  if (
    lower.indexOf("gh auth login") !== -1 ||
    lower.indexOf("authentication") !== -1 ||
    lower.indexOf("http 401") !== -1 ||
    lower.indexOf("bad credentials") !== -1
  )
    return "gh is not authenticated. Run `gh auth login` in a terminal.";
  if (lower.indexOf("rate limit") !== -1 || lower.indexOf("http 403") !== -1)
    return "GitHub API rate limit reached. The next check will pick it up again.";
  if (lower.indexOf("http 404") !== -1)
    return "GitHub answered 404 for notifications.";
  if (lower.indexOf("http 5") !== -1)
    return "GitHub is having trouble (server error). Retrying on the next check.";
  if (
    lower.indexOf("could not resolve host") !== -1 ||
    lower.indexOf("dial tcp") !== -1 ||
    lower.indexOf("connection refused") !== -1 ||
    lower.indexOf("timeout") !== -1 ||
    lower.indexOf("no such host") !== -1
  )
    return "Could not reach github.com.";
  var detail = raw.replace(/\s+/g, " ").trim();
  if (detail.length > 160) detail = detail.slice(0, 157) + "...";
  return (
    "gh api notifications failed (exit " +
    exitCode +
    ")" +
    (detail === "" ? "." : ": " + detail)
  );
}

// result: { ok, items, totalCount, totalPages, page, error }
function parseNotifications(exitCode, stdout, stderr, requestedPage) {
  var out = text(stdout);
  var err = text(stderr);

  if (utf8Length(out) > MAX_STDOUT_BYTES)
    return {
      ok: false,
      items: [],
      totalCount: 0,
      totalPages: 1,
      page: 1,
      error: "GitHub returned more data than the widget will load.",
    };

  if (exitCode !== 0)
    return {
      ok: false,
      items: [],
      totalCount: 0,
      totalPages: 1,
      page: 1,
      error: failureText(exitCode, err + "\n" + out),
    };

  var markerAt = out.indexOf(COUNT_MARKER);
  if (markerAt === -1)
    return {
      ok: false,
      items: [],
      totalCount: 0,
      totalPages: 1,
      page: 1,
      error: "gh printed an unexpected response.",
    };
  var probeText = out.slice(0, markerAt);
  var pageText = out.slice(markerAt + COUNT_MARKER.length);

  var count = countFromProbe(probeText);
  if (count === null)
    return {
      ok: false,
      items: [],
      totalCount: 0,
      totalPages: 1,
      page: 1,
      error: failureText(0, err + "\n" + probeText),
    };

  var totalPages = totalPagesFromCount(count, PAGE_SIZE);

  var trimmed = pageText.replace(/^\s+|\s+$/g, "");
  var parsed;
  try {
    parsed = JSON.parse(trimmed === "" ? "[]" : trimmed);
  } catch (e) {
    return {
      ok: false,
      items: [],
      totalCount: count,
      totalPages: totalPages,
      page: 1,
      error: "gh printed something that is not JSON.",
    };
  }
  if (!isArray(parsed))
    return {
      ok: false,
      items: [],
      totalCount: count,
      totalPages: totalPages,
      page: 1,
      error:
        "GitHub answered with a single object instead of a notification list.",
    };

  var raw = flattenPages(parsed, PAGE_SIZE);
  var items = [];
  for (var i = 0; i < raw.length && items.length < PAGE_SIZE; i++) {
    var item = normalizeItem(raw[i]);
    if (item) items.push(item);
  }

  var page = clampPage(requestedPage, totalPages);
  return {
    ok: true,
    items: items,
    totalCount: count,
    totalPages: totalPages,
    page: page,
    error: "",
  };
}

// ---------------------------------------------------------------------------
// pagination control (pagination-specs.md section 9)

function clampInt(value, lo, hi) {
  if (value < lo) return lo;
  if (value > hi) return hi;
  return value;
}

// The normative BUILD-FRAME from pagination-specs.md section 9: page numbers as
// JS numbers, the omitted indicator as the string "...".
function paginationFrame(totalPages, page, window) {
  var T = Math.floor(Number(totalPages));
  if (!isFinite(T) || T < 1) return [];

  var p = Math.floor(Number(page));
  if (!isFinite(p)) p = 1;
  p = clampInt(p, 1, T);

  var W = Math.floor(Number(window));
  if (!isFinite(W)) W = 5;
  if (W < 3) W = 3;

  if (T <= 2) return T === 1 ? [1] : [1, 2];

  var c = clampInt(p, 2, T - 1);
  var preferSmallerStart = 2 * p <= T + 1;

  var windowStart = null;
  var windowEnd = null;
  for (var m = Math.min(W, T - 2); m >= 1; m--) {
    var bestStart = null;
    var bestDistance = Infinity;
    var sFrom = Math.max(2, c - m + 1);
    var sTo = Math.min(c, T - m);
    for (var s = sFrom; s <= sTo; s++) {
      var e = s + m - 1;
      var leftOmitted = s - 2;
      var rightOmitted = T - e - 1;
      if (!(leftOmitted === 0 || leftOmitted >= 2)) continue;
      if (!(rightOmitted === 0 || rightOmitted >= 2)) continue;

      var distance = Math.abs((s + e) / 2 - p);
      if (
        distance < bestDistance ||
        (distance === bestDistance &&
          (bestStart === null ||
            (preferSmallerStart && s < bestStart) ||
            (!preferSmallerStart && s > bestStart)))
      ) {
        bestDistance = distance;
        bestStart = s;
      }
    }
    if (bestStart !== null) {
      windowStart = bestStart;
      windowEnd = bestStart + m - 1;
      break;
    }
  }

  if (windowStart === null) {
    windowStart = 2;
    windowEnd = T - 1;
  }

  var tokens = [1];
  if (windowStart > 2) tokens.push("...");
  for (var pageNumber = windowStart; pageNumber <= windowEnd; pageNumber++)
    tokens.push(pageNumber);
  if (windowEnd < T - 1) tokens.push("...");
  tokens.push(T);
  return tokens;
}

function paginationVisible(totalPages) {
  return Number(totalPages) >= 2;
}

function canPreviousPage(page) {
  return Number(page) > 1;
}

function canNextPage(page, totalPages) {
  return Number(page) < Number(totalPages);
}

// ---------------------------------------------------------------------------
// state

function initialView() {
  return {
    status: "loading",
    items: [],
    totalCount: 0,
    totalPages: 1,
    page: 1,
    error: "",
    checkedAt: 0,
  };
}

// A failed check never throws the last good list away: the panel keeps showing
// it, labelled, so a blip on the network does not blank the widget.
function viewAfterFetch(view, result, nowMs) {
  var previous = view || initialView();
  if (!result || !result.ok) {
    return {
      status: "error",
      items: previous.items || [],
      totalCount: numberOr(previous.totalCount, (previous.items || []).length),
      totalPages: numberOr(previous.totalPages, 1),
      page: numberOr(previous.page, 1),
      error: (result && result.error) || "unknown error",
      checkedAt: nowMs,
    };
  }
  return {
    status: "ok",
    items: result.items || [],
    totalCount: numberOr(result.totalCount, (result.items || []).length),
    totalPages: numberOr(result.totalPages, 1),
    page: numberOr(result.page, 1),
    error: "",
    checkedAt: nowMs,
  };
}

// ---------------------------------------------------------------------------
// links

// subject.url is an api.github.com URL. `subjectLinks: "web"` rewrites the
// shapes a notification subject can take to the github.com page a person
// expects; anything unrecognised returns "" so the caller falls back to the URL
// gh itself returned.
function apiToWebUrl(url) {
  var value = text(url);
  var match = value.match(
    /^https?:\/\/api\.github\.com\/repos\/([^\/]+)\/([^\/]+)\/(.+)$/,
  );
  if (!match) return "";
  var base = "https://github.com/" + match[1] + "/" + match[2] + "/";
  var rest = match[3];

  var issue = rest.match(/^issues\/(\d+)$/);
  if (issue) return base + "issues/" + issue[1];
  var pull = rest.match(/^pulls\/(\d+)$/);
  if (pull) return base + "pull/" + pull[1];
  var discussion = rest.match(/^discussions\/(\d+)$/);
  if (discussion) return base + "discussions/" + discussion[1];
  var release = rest.match(/^releases\/(\d+)$/);
  if (release) return base + "releases/" + release[1];
  var commit = rest.match(/^commits\/([0-9a-fA-F]+)$/);
  if (commit) return base + "commit/" + commit[1];
  if (/^check-suites\/\d+$/.test(rest)) return base + "actions";
  return "";
}

// repository.html_url is already the page to open.
function repoLink(item) {
  return item ? text(item.repoUrl) : "";
}

function subjectLink(item, mode) {
  if (!item) return "";
  if (mode === "web") {
    var web = apiToWebUrl(item.subjectUrl);
    if (web !== "") return web;
  }
  return text(item.subjectUrl);
}

function notificationsPageUrl() {
  return "https://github.com/notifications";
}

// ---------------------------------------------------------------------------
// display strings

// The exact total the probe reported, falling back to the loaded rows only when
// the count is absent. This is the number of unread notifications, not the
// number of rows currently on screen.
function countOf(view) {
  var count = view ? Number(view.totalCount) : NaN;
  if (isFinite(count) && count >= 0) return count;
  return view && view.items ? view.items.length : 0;
}

function pageItemCount(view) {
  return view && view.items ? view.items.length : 0;
}

function hasNotifications(view) {
  if (countOf(view) > 0) return true;
  return Number(view && view.totalPages) >= 2;
}

function isError(view) {
  return !!view && view.status === "error";
}

function isLoading(view) {
  return !!view && view.status === "loading";
}

function plural(count, one, many) {
  return count === 1 ? one : many;
}

// First-seen order, one entry per repository, with how many notifications it is
// holding.
function repoCounts(items) {
  var counts = [];
  var index = {};
  var list = items || [];
  for (var i = 0; i < list.length; i++) {
    var name = text(list[i] && list[i].repoName);
    if (name === "") name = "unknown repository";
    if (index[name] === undefined) {
      index[name] = counts.length;
      counts.push({ name: name, count: 0 });
    }
    counts[index[name]].count++;
  }
  return counts;
}

function repositoryCount(items) {
  return repoCounts(items).length;
}

function repoBreakdown(items, max) {
  var limit = max === undefined ? 3 : max;
  var counts = repoCounts(items);
  var parts = [];
  for (var i = 0; i < counts.length && i < limit; i++)
    parts.push(counts[i].name + " x" + counts[i].count);
  if (counts.length > limit)
    parts.push("+" + (counts.length - limit) + " more");
  return parts.join(" · ");
}

function formatTime(ms) {
  var value = Number(ms);
  if (!isFinite(value) || value <= 0) return "";
  var when = new Date(value);
  var hours = String(when.getHours());
  if (hours.length < 2) hours = "0" + hours;
  var minutes = String(when.getMinutes());
  if (minutes.length < 2) minutes = "0" + minutes;
  return hours + ":" + minutes;
}

// The pill next to the panel title.
function statusPill(view) {
  if (isError(view)) return "GH ERROR";
  if (isLoading(view)) return "CHECKING";
  var count = countOf(view);
  if (count === 0) return "ALL READ";
  return count + " UNREAD";
}

// The hero's second line, next to the title. It carries only what the pill and
// the rows do not already say: the count is in the pill, the page range when
// there is one, and the repositories in the repository column of every row.
function heroMeta(view) {
  if (isError(view)) return "gh api notifications failed";
  if (isLoading(view)) return "Checking gh api notifications";
  var totalPages = Number(view && view.totalPages);
  if (isFinite(totalPages) && totalPages >= 2)
    return "page " + countPage(view) + " of " + totalPages;
  if (countOf(view) === 0) return "Inbox zero";
  var repos = repositoryCount(view.items);
  return "in " + repos + " " + plural(repos, "repository", "repositories");
}

function countPage(view) {
  var page = Number(view && view.page);
  if (!isFinite(page) || page < 1) return 1;
  return Math.floor(page);
}

// The whole state as one sentence, for the shell log. The panel does not use it.
function statusLine(view) {
  if (isError(view)) return "gh api notifications failed";
  if (isLoading(view)) return "Checking gh api notifications";
  var count = countOf(view);
  if (count === 0) return "No unread notifications";
  var totalPages = Number(view && view.totalPages);
  if (isFinite(totalPages) && totalPages >= 2)
    return (
      count +
      " unread notifications (page " +
      countPage(view) +
      " of " +
      totalPages +
      ")"
    );
  var repos = repositoryCount(view.items);
  return (
    count +
    " unread " +
    plural(count, "notification", "notifications") +
    " in " +
    repos +
    " " +
    plural(repos, "repository", "repositories")
  );
}

function emptyText(view) {
  if (isError(view)) return "";
  if (isLoading(view)) return "Asking gh for your notifications.";
  return "Nothing unread.\nNew notifications show up here on the next check.";
}

// Second line under an error, so a stale list is never mistaken for a fresh one.
function errorHint(view) {
  if (!isError(view)) return "";
  if (countOf(view) > 0) return "Showing the last list that loaded.";
  return "Click the mark, or press r, to check again.";
}

function footerText(view) {
  var checked = view ? view.checkedAt : 0;
  if (!checked) return isError(view) ? "No successful check yet" : "";
  if (isError(view)) return "Last good check " + formatTime(checked);
  return "Checked " + formatTime(checked);
}

function tooltip(view) {
  var head;
  if (isError(view))
    head = "GitHub: " + (view.error || "gh api notifications failed");
  else if (isLoading(view)) head = "GitHub: checking for notifications";
  else {
    var count = countOf(view);
    head =
      count === 0
        ? "No unread GitHub notifications"
        : count +
          " unread GitHub " +
          plural(count, "notification", "notifications");
    var totalPages = Number(view && view.totalPages);
    if (isFinite(totalPages) && totalPages >= 2) {
      // The repository breakdown only describes the page on screen, so on a
      // multi-page inbox the page range takes its place.
      head += "\npage " + countPage(view) + " of " + totalPages;
    } else if (count > 0) {
      var breakdown = repoBreakdown(view.items, 3);
      if (breakdown !== "") head += "\n" + breakdown;
    }
  }
  var tail =
    countOf(view) > 0
      ? "Click for the list · middle-click to refresh · right-click to open GitHub"
      : "Click to check and list · middle-click to refresh · right-click to open GitHub";
  return head + "\n" + tail;
}

if (typeof module !== "undefined") {
  module.exports = {
    DEFAULT_INTERVAL_SECONDS: DEFAULT_INTERVAL_SECONDS,
    MIN_INTERVAL_SECONDS: MIN_INTERVAL_SECONDS,
    MAX_INTERVAL_SECONDS: MAX_INTERVAL_SECONDS,
    PAGE_SIZE: PAGE_SIZE,
    PAGINATION_WINDOW: PAGINATION_WINDOW,
    MAX_STDOUT_BYTES: MAX_STDOUT_BYTES,
    MAX_STDERR_BYTES: MAX_STDERR_BYTES,
    MAX_NAME_CHARS: MAX_NAME_CHARS,
    MAX_TITLE_CHARS: MAX_TITLE_CHARS,
    MAX_URL_CHARS: MAX_URL_CHARS,
    COUNT_MARKER_TEXT: COUNT_MARKER_TEXT,
    COUNT_MARKER: COUNT_MARKER,
    ghCommand: ghCommand,
    ghArgv: ghArgv,
    countMarker: countMarker,
    isArray: isArray,
    text: text,
    clampIntervalSeconds: clampIntervalSeconds,
    utf8Length: utf8Length,
    splitHeadersBody: splitHeadersBody,
    parseLinkPages: parseLinkPages,
    countFromProbe: countFromProbe,
    totalPagesFromCount: totalPagesFromCount,
    clampPage: clampPage,
    initialView: initialView,
    flattenPages: flattenPages,
    normalizeItem: normalizeItem,
    failureText: failureText,
    parseNotifications: parseNotifications,
    viewAfterFetch: viewAfterFetch,
    paginationFrame: paginationFrame,
    paginationVisible: paginationVisible,
    canPreviousPage: canPreviousPage,
    canNextPage: canNextPage,
    apiToWebUrl: apiToWebUrl,
    repoLink: repoLink,
    subjectLink: subjectLink,
    notificationsPageUrl: notificationsPageUrl,
    countOf: countOf,
    pageItemCount: pageItemCount,
    hasNotifications: hasNotifications,
    isError: isError,
    isLoading: isLoading,
    plural: plural,
    repoCounts: repoCounts,
    repositoryCount: repositoryCount,
    repoBreakdown: repoBreakdown,
    formatTime: formatTime,
    statusPill: statusPill,
    heroMeta: heroMeta,
    statusLine: statusLine,
    emptyText: emptyText,
    errorHint: errorHint,
    footerText: footerText,
    tooltip: tooltip,
  };
}
