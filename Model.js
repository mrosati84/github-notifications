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

// Default check interval: five minutes, as the widget was specified.
var DEFAULT_INTERVAL_SECONDS = 300;
var MIN_INTERVAL_SECONDS = 60;
var MAX_INTERVAL_SECONDS = 3600;

// Arguments handed to the login shell. A constant string: nothing from the API
// or from shell.json is ever interpolated into it. `--paginate --slurp` makes
// gh follow the Link header and print every page wrapped in one outer array, so
// an inbox with more than one page is counted whole instead of silently
// truncated at 30.
var GH_COMMAND = "exec gh api notifications --paginate --slurp";

function ghCommand() {
  return GH_COMMAND;
}

function ghArgv() {
  return ["bash", "-lc", GH_COMMAND];
}

function isArray(value) {
  return Object.prototype.toString.call(value) === "[object Array]";
}

function text(value) {
  return value === undefined || value === null ? "" : String(value);
}

function clampIntervalSeconds(value) {
  var seconds = Number(value);
  if (!isFinite(seconds) || seconds <= 0) seconds = DEFAULT_INTERVAL_SECONDS;
  seconds = Math.round(seconds);
  if (seconds < MIN_INTERVAL_SECONDS) seconds = MIN_INTERVAL_SECONDS;
  if (seconds > MAX_INTERVAL_SECONDS) seconds = MAX_INTERVAL_SECONDS;
  return seconds;
}

function initialView() {
  return { status: "loading", items: [], error: "", checkedAt: 0 };
}

// ---------------------------------------------------------------------------
// gh output -> the four fields

// gh --paginate --slurp prints [[page], [page]]; a plain `gh api notifications`
// prints [item, item]. Both - and anything nested deeper - land as one flat
// list of objects.
function flattenPages(parsed) {
  var out = [];
  function walk(node, depth) {
    if (depth > 4 || !isArray(node)) return;
    for (var i = 0; i < node.length; i++) {
      var entry = node[i];
      if (isArray(entry)) walk(entry, depth + 1);
      else if (entry !== null && typeof entry === "object") out.push(entry);
    }
  }
  walk(parsed, 0);
  return out;
}

// Only the four fields the widget is about. An entry with no repository, no
// title and no url is nothing anyone can read or click, so it is dropped rather
// than rendered as an empty row.
function normalizeItem(raw) {
  if (!raw || typeof raw !== "object") return null;
  var repository = raw.repository || {};
  var subject = raw.subject || {};
  var item = {
    repoName: text(repository.name),
    repoUrl: text(repository.html_url),
    title: text(subject.title),
    subjectUrl: text(subject.url),
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

// result: { ok, items, error }
function parseNotifications(exitCode, stdout, stderr) {
  var out = text(stdout);
  if (exitCode !== 0)
    return {
      ok: false,
      items: [],
      error: failureText(exitCode, text(stderr) + "\n" + out),
    };

  var parsed;
  try {
    parsed = JSON.parse(out === "" ? "[]" : out);
  } catch (e) {
    return {
      ok: false,
      items: [],
      error: "gh printed something that is not JSON.",
    };
  }
  if (!isArray(parsed))
    return {
      ok: false,
      items: [],
      error:
        "GitHub answered with a single object instead of a notification list.",
    };

  var raw = flattenPages(parsed);
  var items = [];
  for (var i = 0; i < raw.length; i++) {
    var item = normalizeItem(raw[i]);
    if (item) items.push(item);
  }
  return { ok: true, items: items, error: "" };
}

// A failed check never throws the last good list away: the panel keeps showing
// it, labelled, so a blip on the network does not blank the widget.
function viewAfterFetch(view, result, nowMs) {
  var previous = view || initialView();
  if (!result || !result.ok) {
    return {
      status: "error",
      items: previous.items || [],
      error: (result && result.error) || "unknown error",
      checkedAt: nowMs,
    };
  }
  return {
    status: "ok",
    items: result.items || [],
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

function countOf(view) {
  return view && view.items ? view.items.length : 0;
}

function hasNotifications(view) {
  return countOf(view) > 0;
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
// the rows do not already say: the count is in the pill, the repositories in the
// repository column of every row.
function heroMeta(view) {
  if (isError(view)) return "gh api notifications failed";
  if (isLoading(view)) return "Checking gh api notifications";
  if (countOf(view) === 0) return "Inbox zero";
  var repos = repositoryCount(view.items);
  return "in " + repos + " " + plural(repos, "repository", "repositories");
}

// The whole state as one sentence, for the shell log. The panel does not use it.
function statusLine(view) {
  if (isError(view)) return "gh api notifications failed";
  if (isLoading(view)) return "Checking gh api notifications";
  var count = countOf(view);
  if (count === 0) return "No unread notifications";
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
    if (count > 0) {
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
    GH_COMMAND: GH_COMMAND,
    ghCommand: ghCommand,
    ghArgv: ghArgv,
    isArray: isArray,
    text: text,
    clampIntervalSeconds: clampIntervalSeconds,
    initialView: initialView,
    flattenPages: flattenPages,
    normalizeItem: normalizeItem,
    failureText: failureText,
    parseNotifications: parseNotifications,
    viewAfterFetch: viewAfterFetch,
    apiToWebUrl: apiToWebUrl,
    repoLink: repoLink,
    subjectLink: subjectLink,
    notificationsPageUrl: notificationsPageUrl,
    countOf: countOf,
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
