// Node self-check for Model.js (GitHub Notifications).
//
// Deterministic unit tests for the bounded fetch command, the count probe and
// page parsing, the pagination algorithm (including the conformance tables in
// pagination-specs.md section 11 and the invariant sweep in section 10), the
// link rewriting, the state reducer and every display string - plus one live
// round-trip through the real `gh api notifications` command when gh is
// available and authenticated (it is skipped, not failed, when it is not).
//
// Run: node test-model.js

const assert = require("assert");
const { spawnSync } = require("child_process");
const M = require("./Model.js");

// A trimmed but structurally exact copy of a `gh api notifications` page: every
// field the widget ignores is still present, so the tests catch a future
// implementation that starts depending on something else.
const PAGE_ONE = [
  {
    id: "10000000001",
    unread: true,
    reason: "assign",
    updated_at: "2026-01-05T09:00:00Z",
    last_read_at: "2026-01-06T12:00:00Z",
    subject: {
      title: "Implement proxy for remote assets",
      url: "https://api.github.com/repos/acme/widgets/issues/270",
      latest_comment_url:
        "https://api.github.com/repos/acme/widgets/issues/270",
      type: "Issue",
    },
    repository: {
      id: 1000000001,
      name: "widgets",
      full_name: "acme/widgets",
      private: true,
      owner: { login: "acme", type: "Organization" },
      html_url: "https://github.com/acme/widgets",
      description: "Example privately hosted widgets",
    },
  },
  {
    id: "10000000002",
    unread: true,
    reason: "review_requested",
    subject: {
      title: "Fix the cache invalidation race",
      url: "https://api.github.com/repos/cli/cli/pulls/42",
      type: "PullRequest",
    },
    repository: {
      id: 2,
      name: "cli",
      html_url: "https://github.com/cli/cli",
      private: false,
    },
  },
];

const PAGE_TWO = [
  {
    id: "3",
    unread: true,
    subject: {
      title: "v0.56.2",
      url: "https://api.github.com/repos/hyprwm/Hyprland/releases/123",
      type: "Release",
    },
    repository: {
      name: "Hyprland",
      html_url: "https://github.com/hyprwm/Hyprland",
    },
  },
];

const tests = [];
function test(name, fn) {
  tests.push([name, fn]);
}

function item(title, extra) {
  return Object.assign(
    {
      repoName: "cli",
      repoUrl: "https://github.com/cli/cli",
      title: title,
      subjectUrl: "https://api.github.com/repos/cli/cli/issues/1",
    },
    extra || {},
  );
}

// n valid raw gh items, spread over three repositories.
function manyItems(n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push({
      id: String(i),
      unread: true,
      subject: {
        title: "subject " + i,
        url: "https://api.github.com/repos/acme/widgets/issues/" + i,
        type: "Issue",
      },
      repository: {
        name: "repo-" + (i % 3),
        html_url: "https://github.com/acme/repo-" + (i % 3),
      },
    });
  }
  return out;
}

// ---- fake `gh api ... --include` probe responses ---------------------------
// The count probe is one item at most: `rel="last"` carries the total when the
// inbox overflows one page, otherwise the body array itself is 0 or 1 long.
function probeWithCount(count) {
  const one = JSON.stringify([PAGE_TWO[0]]);
  if (count >= 2) {
    return (
      "HTTP/2.0 200 OK\r\n" +
      "Content-Type: application/json; charset=utf-8\r\n" +
      'Link: <https://api.github.com/notifications?per_page=1&page=' +
      count +
      '>; rel="last"\r\n' +
      "\r\n" +
      one
    );
  }
  return (
    "HTTP/2.0 200 OK\r\n" +
    "Content-Type: application/json; charset=utf-8\r\n" +
    "\r\n" +
    (count === 1 ? one : "[]")
  );
}

// Exactly what ghCommand(1) prints: probe, sentinel, one page of JSON.
function combinedStdout(count, pageItems) {
  return probeWithCount(count) + M.COUNT_MARKER + JSON.stringify(pageItems || []);
}

function parseCombined(count, pageItems, requestedPage) {
  return M.parseNotifications(
    0,
    combinedStdout(count, pageItems),
    "",
    requestedPage === undefined ? 1 : requestedPage,
  );
}

function viewFor(count, pageItems, requestedPage, nowMs) {
  const view = M.viewAfterFetch(
    M.initialView(),
    parseCombined(count, pageItems, requestedPage),
    nowMs === undefined ? 1 : nowMs,
  );
  return view;
}

// A conformance-table frame string -> the algorithm's token array.
function frame(str) {
  return str.split(" ").map((t) => (t === "..." ? "..." : Number(t)));
}

// --------------------------------------------------------------------------
// constants and the bounded command

test("the bounded fetch constants are fixed", () => {
  assert.strictEqual(M.PAGE_SIZE, 5);
  assert.strictEqual(M.PAGINATION_WINDOW, 5);
  assert.strictEqual(M.MAX_STDOUT_BYTES, 262144);
  assert.strictEqual(M.MAX_STDERR_BYTES, 8192);
  assert.strictEqual(M.MAX_NAME_CHARS, 200);
  assert.strictEqual(M.MAX_TITLE_CHARS, 300);
  assert.strictEqual(M.MAX_URL_CHARS, 512);
  assert.strictEqual(M.COUNT_MARKER_TEXT, "@@GH_NOTIF_COUNT@@");
  assert.strictEqual(M.COUNT_MARKER, "\n@@GH_NOTIF_COUNT@@\n");
  assert.strictEqual(M.countMarker(), M.COUNT_MARKER);
});

test("the command is bounded: one probe plus one page, no paginate/slurp", () => {
  const cmd = M.ghCommand(3);
  assert.ok(cmd.indexOf("notifications?per_page=5&page=3") !== -1, cmd);
  assert.ok(cmd.indexOf("notifications?per_page=1&page=1") !== -1, cmd);
  assert.strictEqual((cmd.match(/head -c/g) || []).length, 2);
  assert.ok(cmd.indexOf("head -c 8192") !== -1, cmd);
  assert.ok(cmd.indexOf("head -c 262145") !== -1, cmd);
  assert.ok(!/--paginate|--slurp/.test(cmd), cmd);
  assert.deepStrictEqual(M.ghArgv(1).slice(0, 2), ["bash", "-lc"]);
});

test("a bad page request in the command falls back to page 1", () => {
  assert.ok(M.ghCommand(0).indexOf("notifications?per_page=5&page=1") !== -1);
  assert.ok(M.ghCommand(-4).indexOf("notifications?per_page=5&page=1") !== -1);
  assert.ok(M.ghCommand("nope").indexOf("notifications?per_page=5&page=1") !== -1);
  assert.ok(M.ghCommand(2.9).indexOf("notifications?per_page=5&page=2") !== -1);
});

// --------------------------------------------------------------------------
// mark all read (command + classifier only: never a live PUT, it would mutate
// the user's real GitHub inbox)

test("the mark-all-read command is one bounded PUT /notifications", () => {
  const cmd = M.markAllReadCommand();
  // One gh invocation under the shared capStreams() wrapper, not a bare call.
  assert.strictEqual((cmd.match(/gh api/g) || []).length, 1, cmd);
  assert.ok(cmd.indexOf("gh api --method PUT notifications") !== -1, cmd);
  assert.deepStrictEqual(M.markAllReadArgv().slice(0, 2), ["bash", "-lc"]);
  assert.ok(
    M.markAllReadArgv()[2].indexOf("gh api --method PUT notifications") !== -1,
  );
  // No `last_read_at` and no pagination: one request marks every unread item.
  assert.strictEqual(cmd.indexOf("last_read_at"), -1);
  assert.ok(!/--paginate|--slurp/.test(cmd));
});

test("both mark commands cap stdout and stderr like the fetch", () => {
  for (const cmd of [M.markAllReadCommand(), M.markDoneCommand("7")]) {
    assert.strictEqual((cmd.match(/head -c/g) || []).length, 2, cmd);
    assert.ok(cmd.indexOf("head -c 8192") !== -1, cmd);
    assert.ok(cmd.indexOf("head -c 262145") !== -1, cmd);
    assert.ok(cmd.indexOf("set -o pipefail") !== -1, cmd);
    assert.ok(!/--paginate|--slurp/.test(cmd), cmd);
  }
  assert.deepStrictEqual(M.markAllReadArgv().slice(0, 2), ["bash", "-lc"]);
  assert.deepStrictEqual(M.markDoneArgv("7").slice(0, 2), ["bash", "-lc"]);
});

test("an oversized mark response is rejected before classification", () => {
  const huge = "x".repeat(M.MAX_STDOUT_BYTES + 1);
  // Checked first, like parseNotifications: even exit 0 with oversized output
  // is a failure, and the failure says why.
  assert.deepStrictEqual(M.parseMarkAllRead(0, huge, ""), {
    ok: false,
    error: "GitHub returned more data than the widget will load.",
  });
  assert.strictEqual(M.parseMarkDone(1, huge, "err").ok, false);
  assert.match(M.parseMarkDone(1, huge, "err").error, /more data/);
  // One byte at the cap is still accepted for classification.
  assert.deepStrictEqual(M.parseMarkAllRead(0, "x".repeat(M.MAX_STDOUT_BYTES), ""), {
    ok: true,
    error: "",
  });
});

test("parseMarkAllRead classifies success and failure", () => {
  assert.deepStrictEqual(M.parseMarkAllRead(0, "", ""), { ok: true, error: "" });

  const failed = M.parseMarkAllRead(1, "", "gh: HTTP 401: Bad credentials");
  assert.strictEqual(failed.ok, false);
  assert.match(failed.error, /not authenticated/);

  // gh sometimes writes the failure to stdout; both streams are classified.
  const stdoutOnly = M.parseMarkAllRead(1, "gh: HTTP 401: Bad credentials", "");
  assert.strictEqual(stdoutOnly.ok, false);
  assert.match(stdoutOnly.error, /not authenticated/);
});

// --------------------------------------------------------------------------
// mark one notification done (command + classifier only: never a live DELETE,
// it would dismiss a real thread in the user's GitHub inbox)

test("the mark-done command is exactly one DELETE of that thread", () => {
  const cmd = M.markDoneCommand("10000000001");
  assert.strictEqual((cmd.match(/gh api/g) || []).length, 1, cmd);
  assert.ok(
    cmd.indexOf("gh api --method DELETE notifications/threads/10000000001") !== -1,
    cmd,
  );
  assert.deepStrictEqual(M.markDoneArgv("10000000001").slice(0, 2), ["bash", "-lc"]);
  assert.ok(
    M.markDoneArgv("10000000001")[2].indexOf(
      "gh api --method DELETE notifications/threads/10000000001",
    ) !== -1,
  );
  assert.ok(M.markDoneCommand("7").indexOf("--method DELETE") !== -1);
  assert.ok(M.markDoneCommand("7").indexOf("notifications/threads/7") !== -1);
  // gh sends `id` as a JSON string, but a bare number is accepted the same way.
  assert.ok(
    M.markDoneCommand(10000000001).indexOf(
      "gh api --method DELETE notifications/threads/10000000001",
    ) !== -1,
  );
  // The endpoint takes the thread id in the path and nothing else: no body, no
  // last_read_at, no pagination.
  assert.strictEqual(M.markDoneCommand("7").indexOf("last_read_at"), -1);
  assert.ok(!/--paginate|--slurp/.test(M.markDoneCommand("7")));
});

test("an id that is not a bare digit run never reaches the shell", () => {
  // "" is the caller's signal that there is nothing to send.
  assert.strictEqual(M.markDoneCommand(""), "");
  assert.strictEqual(M.markDoneCommand(null), "");
  assert.strictEqual(M.markDoneCommand(undefined), "");
  assert.deepStrictEqual(M.markDoneArgv(""), []);
  assert.deepStrictEqual(M.markDoneArgv(undefined), []);

  const bad = [
    "1; rm -rf /",
    "1 && gh api --method PUT notifications",
    "$(rm -rf /)",
    "threads/1",
    "1 2",
    "-1",
    "+1",
    "1e3",
    "1.0",
    "0x1",
    "abc",
    "1\n2",
    " 42 ",
    "9".repeat(M.MAX_ID_CHARS + 1),
  ];
  for (const value of bad) {
    assert.strictEqual(M.markDoneCommand(value), "", value);
    assert.deepStrictEqual(M.markDoneArgv(value), [], value);
  }

  // The cap is what bounds the shell string, and the longest legal id fits.
  assert.strictEqual(M.MAX_ID_CHARS, 20);
  const longest = "9".repeat(M.MAX_ID_CHARS);
  assert.ok(
    M.markDoneCommand(longest).indexOf(
      "gh api --method DELETE notifications/threads/" + longest,
    ) !== -1,
  );
});

test("notificationId keeps the ids gh sends and refuses everything else", () => {
  assert.strictEqual(M.notificationId("10000000001"), "10000000001");
  assert.strictEqual(M.notificationId(42), "42");
  assert.strictEqual(M.notificationId("0"), "0");
  assert.strictEqual(M.notificationId(" 42 "), "");
  assert.strictEqual(M.notificationId(true), "");
  assert.strictEqual(M.notificationId({}), "");
  assert.strictEqual(M.notificationId(""), "");
});

test("a page's ids survive the parse, and a hostile one is neutralised", () => {
  const result = parseCombined(20, [PAGE_ONE[0], PAGE_TWO[0]], 1);
  assert.strictEqual(result.items[0].id, "10000000001");
  assert.strictEqual(result.items[1].id, "3");
  assert.ok(
    M.markDoneCommand(result.items[0].id).indexOf(
      "gh api --method DELETE notifications/threads/10000000001",
    ) !== -1,
  );

  const hostile = parseCombined(20, [{ ...PAGE_ONE[0], id: "1; rm -rf /" }], 1);
  assert.strictEqual(hostile.items[0].id, "");
  assert.deepStrictEqual(M.markDoneArgv(hostile.items[0].id), []);

  // An entry the API sent no id for is still a readable row; only `x` is a
  // no-op for it.
  const noId = parseCombined(20, [{ subject: { title: "no id" } }], 1);
  assert.strictEqual(noId.items[0].id, "");
  assert.strictEqual(noId.items[0].title, "no id");
});

test("parseMarkDone classifies success and failure", () => {
  // 204 No Content is the success case: gh exits 0 and prints nothing.
  assert.deepStrictEqual(M.parseMarkDone(0, "", ""), { ok: true, error: "" });

  const failed = M.parseMarkDone(1, "", "gh: HTTP 404: Not Found");
  assert.strictEqual(failed.ok, false);
  assert.match(failed.error, /404/);

  // gh sometimes writes the failure to stdout; both streams are classified.
  assert.match(
    M.parseMarkDone(1, "gh: HTTP 401: Bad credentials", "").error,
    /not authenticated/,
  );

  // Same classifier as the PUT, so both mark actions fail identically.
  assert.deepStrictEqual(
    M.parseMarkDone(1, "out", "err"),
    M.parseMarkAllRead(1, "out", "err"),
  );
});

// --------------------------------------------------------------------------
// probe / count / page parsing

test("splitHeadersBody and parseLinkPages read gh's --include shape", () => {
  const split = M.splitHeadersBody("A: 1\r\nB: 2\r\n\r\nBODY");
  assert.strictEqual(split.headers, "A: 1\r\nB: 2");
  assert.strictEqual(split.body, "BODY");
  assert.deepStrictEqual(M.splitHeadersBody("no blank line"), {
    headers: "",
    body: "no blank line",
  });
  const links = M.parseLinkPages(
    'Link: <https://api.github.com/notifications?per_page=1&page=2>; rel="next", ' +
      '<https://api.github.com/notifications?per_page=1&page=97>; rel="last"',
  );
  assert.strictEqual(links.next, 2);
  assert.strictEqual(links.last, 97);
  assert.strictEqual(links.prev, null);
  assert.strictEqual(links.first, null);
});

test("countFromProbe reads Link last, then the body array", () => {
  assert.strictEqual(M.countFromProbe(probeWithCount(97)), 97);
  assert.strictEqual(M.countFromProbe(probeWithCount(1)), 1);
  assert.strictEqual(M.countFromProbe(probeWithCount(0)), 0);
  assert.strictEqual(M.countFromProbe("garbage"), null);
  assert.strictEqual(
    M.countFromProbe('HTTP/2.0 200 OK\n\n{"message":"Not Found"}'),
    null,
  );
});

test("derived page maths", () => {
  assert.strictEqual(M.totalPagesFromCount(0, 5), 1);
  assert.strictEqual(M.totalPagesFromCount(10, 5), 2);
  assert.strictEqual(M.totalPagesFromCount(11, 5), 3);
  assert.strictEqual(M.totalPagesFromCount(97, 5), 20);
  assert.strictEqual(M.clampPage(0, 3), 1);
  assert.strictEqual(M.clampPage(2, 3), 2);
  assert.strictEqual(M.clampPage(999, 3), 3);
  assert.strictEqual(M.clampPage(5, 0), 1);
});

test("a combined probe+page response parses into a bounded page", () => {
  const result = parseCombined(97, PAGE_ONE, 1);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.error, "");
  assert.strictEqual(result.totalCount, 97);
  assert.strictEqual(result.totalPages, 20);
  assert.strictEqual(result.page, 1);
  assert.ok(result.items.length <= M.PAGE_SIZE);
});

test("the count probe covers 0, 1 and overflow", () => {
  const zero = parseCombined(0, []);
  assert.strictEqual(zero.ok, true);
  assert.strictEqual(zero.totalCount, 0);
  assert.strictEqual(zero.totalPages, 1);

  const one = parseCombined(1, PAGE_TWO);
  assert.strictEqual(one.totalCount, 1);
  assert.strictEqual(one.totalPages, 1);

  const many = parseCombined(25, PAGE_ONE, 2);
  assert.strictEqual(many.totalCount, 25);
  assert.strictEqual(many.totalPages, 5);
  assert.strictEqual(many.page, 2);
  assert.strictEqual(many.items.length, 2);
});

test("a requested page past the end clamps to the last page", () => {
  const result = parseCombined(25, PAGE_ONE, 999);
  assert.strictEqual(result.totalPages, 5);
  assert.strictEqual(result.page, 5);
});

test("more than a page of items is capped at PAGE_SIZE", () => {
  const result = parseCombined(200, manyItems(20), 1);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.items.length, M.PAGE_SIZE);
});

test("retained strings are truncated to their caps", () => {
  const long = {
    subject: { title: "t".repeat(900), url: "u".repeat(900) },
    repository: { name: "n".repeat(900), html_url: "h".repeat(900) },
  };
  const result = parseCombined(200, [long], 1);
  assert.strictEqual(result.items.length, 1);
  const first = result.items[0];
  assert.strictEqual(first.repoName.length, M.MAX_NAME_CHARS);
  assert.strictEqual(first.title.length, M.MAX_TITLE_CHARS);
  assert.strictEqual(first.repoUrl.length, M.MAX_URL_CHARS);
  assert.strictEqual(first.subjectUrl.length, M.MAX_URL_CHARS);
});

test("only the wanted fields survive", () => {
  const result = parseCombined(20, [PAGE_ONE], 1);
  assert.deepStrictEqual(result.items[0], {
    id: "10000000001",
    repoName: "widgets",
    repoUrl: "https://github.com/acme/widgets",
    title: "Implement proxy for remote assets",
    subjectUrl: "https://api.github.com/repos/acme/widgets/issues/270",
    updatedAt: "2026-01-05T09:00:00Z",
  });
  assert.deepStrictEqual(Object.keys(result.items[0]).sort(), [
    "id",
    "repoName",
    "repoUrl",
    "subjectUrl",
    "title",
    "updatedAt",
  ]);
});

test("updated_at is retained, capped, and never undefined", () => {
  // End-to-end: PAGE_ONE[0] carries a date, PAGE_ONE[1] does not.
  const result = parseCombined(20, [PAGE_ONE], 1);
  assert.strictEqual(result.items[0].updatedAt, "2026-01-05T09:00:00Z");

  const endToEnd = parseCombined(20, [PAGE_ONE[1]], 1);
  assert.strictEqual(endToEnd.items[0].updatedAt, "");

  const missing = M.normalizeItem({ subject: { title: "no date" } });
  assert.strictEqual(missing.updatedAt, "");
  assert.notStrictEqual(missing.updatedAt, undefined);

  const long = M.normalizeItem({
    subject: { title: "long date" },
    updated_at: "z".repeat(200),
  });
  assert.strictEqual(long.updatedAt, "z".repeat(M.MAX_UPDATED_CHARS));
  assert.strictEqual(long.updatedAt.length, M.MAX_UPDATED_CHARS);
});

test("missing pieces become empty strings, never undefined", () => {
  const result = parseCombined(
    20,
    [
      { subject: { title: "no repository at all" } },
      { repository: { name: "only-repo" } },
    ],
    1,
  );
  assert.strictEqual(result.items.length, 2);
  assert.strictEqual(result.items[0].repoName, "");
  assert.strictEqual(result.items[0].repoUrl, "");
  assert.strictEqual(result.items[0].title, "no repository at all");
  assert.strictEqual(result.items[0].subjectUrl, "");
  assert.strictEqual(result.items[1].repoName, "only-repo");
  assert.strictEqual(result.items[1].title, "");
});

test("entries that carry nothing at all are dropped", () => {
  const result = parseCombined(20, [PAGE_ONE[0], {}, null, "nope", []], 1);
  assert.strictEqual(result.items.length, 1);
});

test("an empty notification list is a success", () => {
  const result = parseCombined(0, []);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.items.length, 0);
  assert.strictEqual(result.totalCount, 0);
});

test("empty output without the sentinel is reported", () => {
  const result = M.parseNotifications(0, "", "");
  assert.strictEqual(result.ok, false);
  assert.match(result.error, /unexpected response/);
});

test("stdout without the sentinel is reported", () => {
  const result = M.parseNotifications(0, JSON.stringify(PAGE_ONE), "");
  assert.strictEqual(result.ok, false);
  assert.match(result.error, /unexpected response/);
});

test("non-JSON page output is reported instead of thrown", () => {
  const result = M.parseNotifications(
    0,
    probeWithCount(0) + M.COUNT_MARKER + "gh: something went sideways",
    "",
    1,
  );
  assert.strictEqual(result.ok, false);
  assert.match(result.error, /not JSON/);
});

test("a single object instead of a list is reported", () => {
  const result = M.parseNotifications(
    0,
    probeWithCount(0) + M.COUNT_MARKER + '{"message":"Not Found"}',
    "",
    1,
  );
  assert.strictEqual(result.ok, false);
  assert.match(result.error, /single object/);
});

test("an oversized stdout is rejected before parsing", () => {
  const result = M.parseNotifications(
    0,
    "x".repeat(M.MAX_STDOUT_BYTES + 1),
    "",
    1,
  );
  assert.strictEqual(result.ok, false);
  assert.match(result.error, /more data/);
  assert.strictEqual(M.utf8Length("x".repeat(M.MAX_STDOUT_BYTES)), M.MAX_STDOUT_BYTES);
  assert.strictEqual(M.utf8Length("é"), 2);
  assert.strictEqual(M.utf8Length("😀"), 4);
});

test("an unparseable probe is classified as a gh failure", () => {
  const result = M.parseNotifications(
    0,
    "not a probe at all" + M.COUNT_MARKER + "[]",
    "",
    1,
  );
  assert.strictEqual(result.ok, false);
  assert.match(result.error, /exit 0/);
});

// --------------------------------------------------------------------------
// failure classification

test("each gh failure gets a sentence a person can act on", () => {
  assert.match(
    M.parseNotifications(127, "", "bash: line 1: exec: gh: command not found")
      .error,
    /not installed/,
  );
  assert.match(
    M.parseNotifications(
      1,
      "",
      "gh: To get started with GitHub CLI, please run: gh auth login",
    ).error,
    /not authenticated/,
  );
  assert.match(
    M.parseNotifications(1, "", "gh: HTTP 401: Bad credentials").error,
    /not authenticated/,
  );
  assert.match(
    M.parseNotifications(
      1,
      "",
      "gh: HTTP 403: API rate limit exceeded for user",
    ).error,
    /rate limit/,
  );
  assert.match(
    M.parseNotifications(1, "", "gh: HTTP 404: Not Found").error,
    /404/,
  );
  assert.match(
    M.parseNotifications(1, "", "gh: HTTP 502: Bad gateway").error,
    /server error/,
  );
  assert.match(
    M.parseNotifications(1, "", "dial tcp: lookup api.github.com: no such host")
      .error,
    /Could not reach/,
  );
});

test("an unrecognised failure still names the exit code and the first line", () => {
  const error = M.parseNotifications(9, "", "something  new\nand more").error;
  assert.match(error, /exit 9/);
  assert.match(error, /something new and more/);
});

test("a very long failure line is truncated", () => {
  const error = M.parseNotifications(1, "", "x".repeat(400)).error;
  assert.ok(error.length < 220, "error text stayed short: " + error.length);
  assert.match(error, /\.\.\.$/);
});

// --------------------------------------------------------------------------
// state

test("a fresh view is loading with nothing in it", () => {
  assert.deepStrictEqual(M.initialView(), {
    status: "loading",
    items: [],
    totalCount: 0,
    totalPages: 1,
    page: 1,
    error: "",
    checkedAt: 0,
  });
});

test("a good fetch replaces the list and the page accounting", () => {
  const view = M.viewAfterFetch(
    M.initialView(),
    M.parseNotifications(0, combinedStdout(20, PAGE_TWO), "", 1),
    1000,
  );
  assert.strictEqual(view.status, "ok");
  assert.strictEqual(view.items.length, 1);
  assert.strictEqual(view.totalCount, 20);
  assert.strictEqual(view.totalPages, 4);
  assert.strictEqual(view.page, 1);
  assert.strictEqual(view.error, "");
  assert.strictEqual(view.checkedAt, 1000);
});

test("a failed fetch keeps the last good list and records when it was checked", () => {
  const good = M.viewAfterFetch(
    M.initialView(),
    M.parseNotifications(0, combinedStdout(20, PAGE_ONE), "", 1),
    1000,
  );
  const bad = M.viewAfterFetch(
    good,
    M.parseNotifications(1, "", "gh: HTTP 403: API rate limit exceeded"),
    2000,
  );
  assert.strictEqual(bad.status, "error");
  assert.strictEqual(bad.items.length, 2); // nothing thrown away
  assert.strictEqual(bad.items[0].title, good.items[0].title);
  assert.strictEqual(bad.totalCount, 20);
  assert.strictEqual(bad.totalPages, 4);
  assert.strictEqual(bad.page, 1);
  assert.strictEqual(bad.checkedAt, 2000);
  assert.match(bad.error, /rate limit/);
});

test("a failure with no prior list is just a failure", () => {
  const view = M.viewAfterFetch(
    undefined,
    { ok: false, items: [], error: "boom" },
    5,
  );
  assert.deepStrictEqual(view, {
    status: "error",
    items: [],
    totalCount: 0,
    totalPages: 1,
    page: 1,
    error: "boom",
    checkedAt: 5,
  });
});

// --------------------------------------------------------------------------
// links

test("api.github.com subject URLs rewrite to the pages people expect", () => {
  assert.strictEqual(
    M.apiToWebUrl("https://api.github.com/repos/acme/widgets/issues/270"),
    "https://github.com/acme/widgets/issues/270",
  );
  assert.strictEqual(
    M.apiToWebUrl("https://api.github.com/repos/o/r/pulls/42"),
    "https://github.com/o/r/pull/42",
  );
  assert.strictEqual(
    M.apiToWebUrl("https://api.github.com/repos/o/r/discussions/7"),
    "https://github.com/o/r/discussions/7",
  );
  assert.strictEqual(
    M.apiToWebUrl("https://api.github.com/repos/o/r/releases/123"),
    "https://github.com/o/r/releases/123",
  );
  assert.strictEqual(
    M.apiToWebUrl("https://api.github.com/repos/o/r/commits/abc123def"),
    "https://github.com/o/r/commit/abc123def",
  );
  assert.strictEqual(
    M.apiToWebUrl("https://api.github.com/repos/o/r/check-suites/99"),
    "https://github.com/o/r/actions",
  );
});

test("an unknown or foreign URL is not guessed at", () => {
  assert.strictEqual(
    M.apiToWebUrl("https://api.github.com/repos/o/r/whatever/9"),
    "",
  );
  assert.strictEqual(
    M.apiToWebUrl("https://example.com/repos/o/r/issues/1"),
    "",
  );
  assert.strictEqual(M.apiToWebUrl(""), "");
  assert.strictEqual(M.apiToWebUrl(undefined), "");
});

test("subjectLink honours the mode and falls back to gh's own URL", () => {
  const entry = item("Issue", {
    subjectUrl: "https://api.github.com/repos/o/r/issues/9",
  });
  assert.strictEqual(
    M.subjectLink(entry, "api"),
    "https://api.github.com/repos/o/r/issues/9",
  );
  assert.strictEqual(
    M.subjectLink(entry, "web"),
    "https://github.com/o/r/issues/9",
  );
  // Unrecognised shape: "web" still has to return something clickable.
  const odd = item("Odd", {
    subjectUrl: "https://api.github.com/repos/o/r/whatever/9",
  });
  assert.strictEqual(
    M.subjectLink(odd, "web"),
    "https://api.github.com/repos/o/r/whatever/9",
  );
  assert.strictEqual(M.subjectLink(null, "web"), "");
});

test("the repository link is repository.html_url, unchanged", () => {
  assert.strictEqual(M.repoLink(item("x")), "https://github.com/cli/cli");
  assert.strictEqual(M.repoLink(null), "");
});

test("only absolute http(s) URLs are safe to launch", () => {
  assert.strictEqual(M.isSafeUrl("https://github.com/o/r"), true);
  assert.strictEqual(M.isSafeUrl("http://example.com/x"), true);
  assert.strictEqual(M.isSafeUrl("HTTPS://GitHub.com/x"), true);
  assert.strictEqual(
    M.isSafeUrl("https://api.github.com/repos/o/r/issues/1"),
    true,
  );
  assert.strictEqual(M.isSafeUrl("file:///etc/passwd"), false);
  assert.strictEqual(M.isSafeUrl("javascript:alert(1)"), false);
  assert.strictEqual(M.isSafeUrl("data:text/html,<b>x</b>"), false);
  assert.strictEqual(M.isSafeUrl("ftp://example.com"), false);
  assert.strictEqual(M.isSafeUrl("-flag"), false);
  assert.strictEqual(M.isSafeUrl("https://exa mple.com"), false);
  assert.strictEqual(M.isSafeUrl(""), false);
  assert.strictEqual(M.isSafeUrl(undefined), false);
  assert.strictEqual(M.isSafeUrl(null), false);
});

// --------------------------------------------------------------------------
// display strings

test("counts come from the probe, not from the visible page", () => {
  const empty = viewFor(0, []);
  const multi = viewFor(200, manyItems(10), 3);
  assert.strictEqual(M.countOf(empty), 0);
  assert.strictEqual(M.hasNotifications(empty), false);
  assert.strictEqual(M.countOf(multi), 200);
  assert.strictEqual(M.pageItemCount(multi), M.PAGE_SIZE);
  assert.strictEqual(M.hasNotifications(multi), true);
  assert.strictEqual(M.hasNotifications(M.initialView()), false);
  assert.strictEqual(M.countOf({ items: [{}, {}] }), 2); // fallback
});

test("the pill reads the state in one glance", () => {
  assert.strictEqual(M.statusPill(M.initialView()), "CHECKING");
  assert.strictEqual(M.statusPill(viewFor(0, [])), "ALL READ");
  assert.strictEqual(M.statusPill(viewFor(2, PAGE_ONE)), "2 UNREAD");
  assert.strictEqual(M.statusPill(viewFor(200, manyItems(10), 1)), "200 UNREAD");
  assert.strictEqual(
    M.statusPill(M.viewAfterFetch(M.initialView(), { ok: false, items: [], error: "x" }, 1)),
    "GH ERROR",
  );
});

test("singular and plural are both correct, and pages are named", () => {
  const one = viewFor(1, PAGE_TWO);
  assert.strictEqual(M.statusPill(one), "1 UNREAD");
  assert.strictEqual(M.heroMeta(one), "in 1 repository");
  assert.strictEqual(M.statusLine(one), "1 unread notification in 1 repository");

  const three = viewFor(3, [PAGE_ONE, PAGE_TWO]);
  assert.strictEqual(M.heroMeta(three), "in 3 repositories");
  assert.strictEqual(
    M.statusLine(three),
    "3 unread notifications in 3 repositories",
  );

  const multi = viewFor(200, manyItems(10), 10);
  assert.strictEqual(M.heroMeta(multi), "page 10 of 40");
  assert.strictEqual(M.statusLine(multi), "200 unread notifications (page 10 of 40)");

  assert.strictEqual(
    M.statusLine(M.initialView()),
    "Checking gh api notifications",
  );
  assert.strictEqual(M.statusLine(viewFor(0, [])), "No unread notifications");
  assert.strictEqual(
    M.heroMeta(M.viewAfterFetch(M.initialView(), { ok: false, items: [], error: "x" }, 1)),
    "gh api notifications failed",
  );
});

test("the empty, loading and error copies", () => {
  assert.match(M.emptyText(M.initialView()), /Asking gh/);
  assert.match(M.emptyText(viewFor(0, [])), /Nothing unread/);
  assert.strictEqual(M.heroMeta(viewFor(0, [])), "Inbox zero");
  assert.strictEqual(
    M.heroMeta(M.initialView()),
    "Checking gh api notifications",
  );
});

test("an error keeps the stale list labelled as stale", () => {
  const good = viewFor(2, PAGE_ONE, 1, 1000);
  const stale = M.viewAfterFetch(
    good,
    { ok: false, items: [], error: "rate limit" },
    2000,
  );
  assert.strictEqual(M.errorHint(stale), "Showing the last list that loaded.");
  assert.strictEqual(M.errorHint(good), "");
  assert.strictEqual(M.footerText(stale), "Last check at " + M.formatTime(2000));
  assert.strictEqual(M.errorHint(stale) !== "", true);
  assert.strictEqual(
    M.errorHint(
      M.viewAfterFetch(undefined, { ok: false, items: [], error: "x" }, 1),
    ),
    "Click the mark, or press r, to check again.",
  );
  // A never-checked error has a falsy checkedAt, so it must still say so
  // instead of rendering a phantom timestamp. (A truthy checkedAt, as the
  // existing errorHint case above uses, is a check that has a time.)
  assert.strictEqual(
    M.footerText(M.viewAfterFetch(undefined, { ok: false, items: [], error: "x" }, 0)),
    "No successful check yet",
  );
});

test("the repository breakdown counts and caps", () => {
  const items = [
    item("a"),
    item("b"),
    item("c", { repoName: "other", repoUrl: "https://github.com/x/other" }),
    item("d", { repoName: "third", repoUrl: "https://github.com/x/third" }),
  ];
  assert.strictEqual(M.repositoryCount(items), 3);
  assert.strictEqual(M.repoBreakdown(items, 2), "cli x2 · other x1 · +1 more");
  assert.strictEqual(
    M.repoBreakdown(items, 3),
    "cli x2 · other x1 · third x1",
  );
  assert.strictEqual(M.repoBreakdown([], 3), "");
});

test("an item with no repository name still counts as one", () => {
  assert.strictEqual(
    M.repoBreakdown([item("a", { repoName: "" })], 3),
    "unknown repository x1",
  );
});

test("times render as local HH:MM and never as NaN", () => {
  const midday = new Date(2026, 8, 15, 9, 5, 0).getTime();
  assert.strictEqual(M.formatTime(midday), "09:05");
  assert.strictEqual(M.formatTime(0), "");
  assert.strictEqual(M.formatTime(undefined), "");
  assert.strictEqual(M.footerText(M.initialView()), "");
  assert.strictEqual(M.footerText(viewFor(0, [], 1, midday)), "Last check at 09:05");
});

test("formatUpdatedAt has the exact format under explicit timezones", () => {
  // A child process per zone, so the ambient test timezone (CEST here) cannot
  // mask a formatter that ignores TZ or hardcodes UTC.
  function inZone(zone, iso) {
    const script =
      'const M = require("./Model.js");' +
      "process.stdout.write(M.formatUpdatedAt(" +
      JSON.stringify(iso) +
      "));";
    const run = spawnSync(process.execPath, ["-e", script], {
      cwd: __dirname,
      encoding: "utf8",
      env: { ...process.env, TZ: zone },
    });
    assert.strictEqual(run.status, 0, String(run.stderr));
    return run.stdout;
  }

  assert.strictEqual(inZone("UTC", "2026-09-10T11:28:42Z"), "2026-09-10 11:28");
  assert.strictEqual(
    inZone("America/New_York", "2026-09-10T11:28:42Z"),
    "2026-09-10 07:28",
  );
  assert.strictEqual(
    inZone("Asia/Tokyo", "2026-09-10T11:28:42Z"),
    "2026-09-10 20:28",
  );
  assert.strictEqual(inZone("UTC", "2026-01-05T03:04:05Z"), "2026-01-05 03:04");
});

test("formatUpdatedAt returns empty for missing or malformed input", () => {
  assert.strictEqual(M.formatUpdatedAt(""), "");
  assert.strictEqual(M.formatUpdatedAt(undefined), "");
  assert.strictEqual(M.formatUpdatedAt(null), "");
  assert.strictEqual(M.formatUpdatedAt("not a date"), "");
  assert.ok(M.formatUpdatedAt("not a date").indexOf("NaN") === -1);
  assert.ok(M.formatUpdatedAt("not a date").indexOf("Invalid") === -1);
});

test("the tooltip always explains the three clicks", () => {
  const full = viewFor(2, PAGE_ONE);
  const multi = viewFor(200, manyItems(10), 10);
  const empty = viewFor(0, []);
  const broken = M.viewAfterFetch(
    M.initialView(),
    { ok: false, items: [], error: "gh is not authenticated." },
    1,
  );
  assert.match(
    M.tooltip(full),
    /^2 unread GitHub notifications\nwidgets x1 · cli x1\n/,
  );
  assert.match(M.tooltip(full), /middle-click to refresh/);
  assert.match(M.tooltip(multi), /\npage 10 of 40\n/);
  assert.strictEqual(M.tooltip(multi).indexOf("repo-0 x"), -1);
  assert.strictEqual(
    M.tooltip(empty).split("\n")[0],
    "No unread GitHub notifications",
  );
  assert.match(M.tooltip(broken), /^GitHub: gh is not authenticated\./);
  assert.strictEqual(
    M.tooltip(M.initialView()).split("\n")[0],
    "GitHub: checking for notifications",
  );
});

// --------------------------------------------------------------------------
// pagination conformance tables (pagination-specs.md section 11)

// Table A - total pages T = 1..12, every current page p. Ranges expanded.
const TABLE_A = [
  [1, [[1, 1, "1"]]],
  [2, [[1, 2, "1 2"]]],
  [3, [[1, 3, "1 2 3"]]],
  [4, [[1, 4, "1 2 3 4"]]],
  [5, [[1, 5, "1 2 3 4 5"]]],
  [6, [[1, 6, "1 2 3 4 5 6"]]],
  [7, [[1, 7, "1 2 3 4 5 6 7"]]],
  [8, [[1, 4, "1 2 3 4 5 ... 8"], [5, 8, "1 ... 4 5 6 7 8"]]],
  [9, [[1, 5, "1 2 3 4 5 6 ... 9"], [6, 9, "1 ... 4 5 6 7 8 9"]]],
  [10, [[1, 5, "1 2 3 4 5 6 ... 10"], [6, 10, "1 ... 5 6 7 8 9 10"]]],
  [
    11,
    [
      [1, 5, "1 2 3 4 5 6 ... 11"],
      [6, 6, "1 ... 4 5 6 7 8 ... 11"],
      [7, 11, "1 ... 6 7 8 9 10 11"],
    ],
  ],
  [
    12,
    [
      [1, 5, "1 2 3 4 5 6 ... 12"],
      [6, 6, "1 ... 4 5 6 7 8 ... 12"],
      [7, 7, "1 ... 5 6 7 8 9 ... 12"],
      [8, 12, "1 ... 7 8 9 10 11 12"],
    ],
  ],
];

// Table B - total pages T = 20, every current page p.
const TABLE_B = [
  [1, "1 2 3 4 5 6 ... 20"],
  [2, "1 2 3 4 5 6 ... 20"],
  [3, "1 2 3 4 5 6 ... 20"],
  [4, "1 2 3 4 5 6 ... 20"],
  [5, "1 2 3 4 5 6 ... 20"],
  [6, "1 ... 4 5 6 7 8 ... 20"],
  [7, "1 ... 5 6 7 8 9 ... 20"],
  [8, "1 ... 6 7 8 9 10 ... 20"],
  [9, "1 ... 7 8 9 10 11 ... 20"],
  [10, "1 ... 8 9 10 11 12 ... 20"],
  [11, "1 ... 9 10 11 12 13 ... 20"],
  [12, "1 ... 10 11 12 13 14 ... 20"],
  [13, "1 ... 11 12 13 14 15 ... 20"],
  [14, "1 ... 12 13 14 15 16 ... 20"],
  [15, "1 ... 13 14 15 16 17 ... 20"],
  [16, "1 ... 15 16 17 18 19 20"],
  [17, "1 ... 15 16 17 18 19 20"],
  [18, "1 ... 15 16 17 18 19 20"],
  [19, "1 ... 15 16 17 18 19 20"],
  [20, "1 ... 15 16 17 18 19 20"],
];

// Table C - large totals: representative frames.
const TABLE_C = [
  [100, 1, "1 2 3 4 5 6 ... 100"],
  [100, 2, "1 2 3 4 5 6 ... 100"],
  [100, 3, "1 2 3 4 5 6 ... 100"],
  [100, 4, "1 2 3 4 5 6 ... 100"],
  [100, 5, "1 2 3 4 5 6 ... 100"],
  [100, 6, "1 ... 4 5 6 7 8 ... 100"],
  [100, 49, "1 ... 47 48 49 50 51 ... 100"],
  [100, 50, "1 ... 48 49 50 51 52 ... 100"],
  [100, 51, "1 ... 49 50 51 52 53 ... 100"],
  [100, 95, "1 ... 93 94 95 96 97 ... 100"],
  [100, 96, "1 ... 95 96 97 98 99 100"],
  [100, 97, "1 ... 95 96 97 98 99 100"],
  [100, 98, "1 ... 95 96 97 98 99 100"],
  [100, 99, "1 ... 95 96 97 98 99 100"],
  [100, 100, "1 ... 95 96 97 98 99 100"],
  [1000, 1, "1 2 3 4 5 6 ... 1000"],
  [1000, 2, "1 2 3 4 5 6 ... 1000"],
  [1000, 3, "1 2 3 4 5 6 ... 1000"],
  [1000, 4, "1 2 3 4 5 6 ... 1000"],
  [1000, 5, "1 2 3 4 5 6 ... 1000"],
  [1000, 6, "1 ... 4 5 6 7 8 ... 1000"],
  [1000, 499, "1 ... 497 498 499 500 501 ... 1000"],
  [1000, 500, "1 ... 498 499 500 501 502 ... 1000"],
  [1000, 501, "1 ... 499 500 501 502 503 ... 1000"],
  [1000, 995, "1 ... 993 994 995 996 997 ... 1000"],
  [1000, 996, "1 ... 995 996 997 998 999 1000"],
  [1000, 997, "1 ... 995 996 997 998 999 1000"],
  [1000, 998, "1 ... 995 996 997 998 999 1000"],
  [1000, 999, "1 ... 995 996 997 998 999 1000"],
  [1000, 1000, "1 ... 995 996 997 998 999 1000"],
  [12345, 1, "1 2 3 4 5 6 ... 12345"],
  [12345, 2, "1 2 3 4 5 6 ... 12345"],
  [12345, 3, "1 2 3 4 5 6 ... 12345"],
  [12345, 4, "1 2 3 4 5 6 ... 12345"],
  [12345, 5, "1 2 3 4 5 6 ... 12345"],
  [12345, 6, "1 ... 4 5 6 7 8 ... 12345"],
  [12345, 6171, "1 ... 6169 6170 6171 6172 6173 ... 12345"],
  [12345, 6172, "1 ... 6170 6171 6172 6173 6174 ... 12345"],
  [12345, 6173, "1 ... 6171 6172 6173 6174 6175 ... 12345"],
  [12345, 12340, "1 ... 12338 12339 12340 12341 12342 ... 12345"],
  [12345, 12341, "1 ... 12340 12341 12342 12343 12344 12345"],
  [12345, 12342, "1 ... 12340 12341 12342 12343 12344 12345"],
  [12345, 12343, "1 ... 12340 12341 12342 12343 12344 12345"],
  [12345, 12344, "1 ... 12340 12341 12342 12343 12344 12345"],
  [12345, 12345, "1 ... 12340 12341 12342 12343 12344 12345"],
];

// Table C-2 - the complete distinct frames and ranges for T = 100.
const TABLE_C2 = [
  [1, 5, "1 2 3 4 5 6 ... 100"],
  [6, 6, "1 ... 4 5 6 7 8 ... 100"],
  [7, 7, "1 ... 5 6 7 8 9 ... 100"],
  [8, 8, "1 ... 6 7 8 9 10 ... 100"],
  [9, 9, "1 ... 7 8 9 10 11 ... 100"],
  [10, 10, "1 ... 8 9 10 11 12 ... 100"],
  [11, 11, "1 ... 9 10 11 12 13 ... 100"],
  [12, 12, "1 ... 10 11 12 13 14 ... 100"],
  [13, 13, "1 ... 11 12 13 14 15 ... 100"],
  [14, 14, "1 ... 12 13 14 15 16 ... 100"],
  [15, 15, "1 ... 13 14 15 16 17 ... 100"],
  [16, 16, "1 ... 14 15 16 17 18 ... 100"],
  [17, 17, "1 ... 15 16 17 18 19 ... 100"],
  [18, 18, "1 ... 16 17 18 19 20 ... 100"],
  [19, 19, "1 ... 17 18 19 20 21 ... 100"],
  [20, 20, "1 ... 18 19 20 21 22 ... 100"],
  [21, 21, "1 ... 19 20 21 22 23 ... 100"],
  [22, 22, "1 ... 20 21 22 23 24 ... 100"],
  [23, 23, "1 ... 21 22 23 24 25 ... 100"],
  [24, 24, "1 ... 22 23 24 25 26 ... 100"],
  [25, 25, "1 ... 23 24 25 26 27 ... 100"],
  [26, 26, "1 ... 24 25 26 27 28 ... 100"],
  [27, 27, "1 ... 25 26 27 28 29 ... 100"],
  [28, 28, "1 ... 26 27 28 29 30 ... 100"],
  [29, 29, "1 ... 27 28 29 30 31 ... 100"],
  [30, 30, "1 ... 28 29 30 31 32 ... 100"],
  [31, 31, "1 ... 29 30 31 32 33 ... 100"],
  [32, 32, "1 ... 30 31 32 33 34 ... 100"],
  [33, 33, "1 ... 31 32 33 34 35 ... 100"],
  [34, 34, "1 ... 32 33 34 35 36 ... 100"],
  [35, 35, "1 ... 33 34 35 36 37 ... 100"],
  [36, 36, "1 ... 34 35 36 37 38 ... 100"],
  [37, 37, "1 ... 35 36 37 38 39 ... 100"],
  [38, 38, "1 ... 36 37 38 39 40 ... 100"],
  [39, 39, "1 ... 37 38 39 40 41 ... 100"],
  [40, 40, "1 ... 38 39 40 41 42 ... 100"],
  [41, 41, "1 ... 39 40 41 42 43 ... 100"],
  [42, 42, "1 ... 40 41 42 43 44 ... 100"],
  [43, 43, "1 ... 41 42 43 44 45 ... 100"],
  [44, 44, "1 ... 42 43 44 45 46 ... 100"],
  [45, 45, "1 ... 43 44 45 46 47 ... 100"],
  [46, 46, "1 ... 44 45 46 47 48 ... 100"],
  [47, 47, "1 ... 45 46 47 48 49 ... 100"],
  [48, 48, "1 ... 46 47 48 49 50 ... 100"],
  [49, 49, "1 ... 47 48 49 50 51 ... 100"],
  [50, 50, "1 ... 48 49 50 51 52 ... 100"],
  [51, 51, "1 ... 49 50 51 52 53 ... 100"],
  [52, 52, "1 ... 50 51 52 53 54 ... 100"],
  [53, 53, "1 ... 51 52 53 54 55 ... 100"],
  [54, 54, "1 ... 52 53 54 55 56 ... 100"],
  [55, 55, "1 ... 53 54 55 56 57 ... 100"],
  [56, 56, "1 ... 54 55 56 57 58 ... 100"],
  [57, 57, "1 ... 55 56 57 58 59 ... 100"],
  [58, 58, "1 ... 56 57 58 59 60 ... 100"],
  [59, 59, "1 ... 57 58 59 60 61 ... 100"],
  [60, 60, "1 ... 58 59 60 61 62 ... 100"],
  [61, 61, "1 ... 59 60 61 62 63 ... 100"],
  [62, 62, "1 ... 60 61 62 63 64 ... 100"],
  [63, 63, "1 ... 61 62 63 64 65 ... 100"],
  [64, 64, "1 ... 62 63 64 65 66 ... 100"],
  [65, 65, "1 ... 63 64 65 66 67 ... 100"],
  [66, 66, "1 ... 64 65 66 67 68 ... 100"],
  [67, 67, "1 ... 65 66 67 68 69 ... 100"],
  [68, 68, "1 ... 66 67 68 69 70 ... 100"],
  [69, 69, "1 ... 67 68 69 70 71 ... 100"],
  [70, 70, "1 ... 68 69 70 71 72 ... 100"],
  [71, 71, "1 ... 69 70 71 72 73 ... 100"],
  [72, 72, "1 ... 70 71 72 73 74 ... 100"],
  [73, 73, "1 ... 71 72 73 74 75 ... 100"],
  [74, 74, "1 ... 72 73 74 75 76 ... 100"],
  [75, 75, "1 ... 73 74 75 76 77 ... 100"],
  [76, 76, "1 ... 74 75 76 77 78 ... 100"],
  [77, 77, "1 ... 75 76 77 78 79 ... 100"],
  [78, 78, "1 ... 76 77 78 79 80 ... 100"],
  [79, 79, "1 ... 77 78 79 80 81 ... 100"],
  [80, 80, "1 ... 78 79 80 81 82 ... 100"],
  [81, 81, "1 ... 79 80 81 82 83 ... 100"],
  [82, 82, "1 ... 80 81 82 83 84 ... 100"],
  [83, 83, "1 ... 81 82 83 84 85 ... 100"],
  [84, 84, "1 ... 82 83 84 85 86 ... 100"],
  [85, 85, "1 ... 83 84 85 86 87 ... 100"],
  [86, 86, "1 ... 84 85 86 87 88 ... 100"],
  [87, 87, "1 ... 85 86 87 88 89 ... 100"],
  [88, 88, "1 ... 86 87 88 89 90 ... 100"],
  [89, 89, "1 ... 87 88 89 90 91 ... 100"],
  [90, 90, "1 ... 88 89 90 91 92 ... 100"],
  [91, 91, "1 ... 89 90 91 92 93 ... 100"],
  [92, 92, "1 ... 90 91 92 93 94 ... 100"],
  [93, 93, "1 ... 91 92 93 94 95 ... 100"],
  [94, 94, "1 ... 92 93 94 95 96 ... 100"],
  [95, 95, "1 ... 93 94 95 96 97 ... 100"],
  [96, 100, "1 ... 95 96 97 98 99 100"],
];

// Table D - explicit edge cases. Item counts are chosen so that
// T = totalPagesFromCount(items, PAGE_SIZE) still lands on the same
// frame-algorithm boundaries now that PAGE_SIZE is 5.
const TABLE_D = [
  { items: 0, T: 1, shown: false, p: null, frame: "" },
  { items: 4, T: 1, shown: false, p: null, frame: "" },
  { items: 5, T: 1, shown: false, p: null, frame: "" },
  { items: 6, T: 2, shown: true, p: 1, frame: "1 2" },
  { items: 10, T: 2, shown: true, p: 1, frame: "1 2" },
  { items: 35, T: 7, shown: true, p: 1, frame: "1 2 3 4 5 6 7" },
  { items: 36, T: 8, shown: true, p: 1, frame: "1 2 3 4 5 ... 8" },
  { items: 96, T: 20, shown: true, p: 1, frame: "1 2 3 4 5 6 ... 20" },
  { items: 97, T: 20, shown: true, p: 20, frame: "1 ... 15 16 17 18 19 20" },
  { items: 98, T: 20, shown: true, p: 2, frame: "1 2 3 4 5 6 ... 20" },
  { items: 99, T: 20, shown: true, p: 19, frame: "1 ... 15 16 17 18 19 20" },
  { items: 100, T: 20, shown: true, p: 10, frame: "1 ... 8 9 10 11 12 ... 20" },
];

test("Table A conformance (T = 1..12, every page)", () => {
  for (const [T, ranges] of TABLE_A) {
    for (const [from, to, expected] of ranges) {
      for (let p = from; p <= to; p++) {
        assert.deepStrictEqual(
          M.paginationFrame(T, p, 5),
          frame(expected),
          "T=" + T + " p=" + p,
        );
      }
    }
  }
});

test("Table B conformance (T = 20, every page)", () => {
  for (const [p, expected] of TABLE_B) {
    assert.deepStrictEqual(
      M.paginationFrame(20, p, 5),
      frame(expected),
      "p=" + p,
    );
  }
});

test("Table C conformance (T = 100, 1000, 12345 samples)", () => {
  for (const [T, p, expected] of TABLE_C) {
    assert.deepStrictEqual(
      M.paginationFrame(T, p, 5),
      frame(expected),
      "T=" + T + " p=" + p,
    );
  }
});

test("Table C-2 conformance (T = 100, all pages)", () => {
  for (const [from, to, expected] of TABLE_C2) {
    for (let p = from; p <= to; p++) {
      assert.deepStrictEqual(
        M.paginationFrame(100, p, 5),
        frame(expected),
        "p=" + p,
      );
    }
  }
});

test("Table D conformance (visibility and edge frames)", () => {
  for (const row of TABLE_D) {
    const T = M.totalPagesFromCount(row.items, M.PAGE_SIZE);
    assert.strictEqual(T, row.T, "T for " + row.items + " items");
    assert.strictEqual(
      M.paginationVisible(T),
      row.shown,
      "visible for " + row.items + " items",
    );
    if (row.shown)
      assert.deepStrictEqual(
        M.paginationFrame(T, row.p, 5),
        frame(row.frame),
        "items=" + row.items + " p=" + row.p,
      );
  }
});

// --------------------------------------------------------------------------
// pagination invariants (pagination-specs.md section 10)

test("pagination invariants hold for T = 1..120 and every page", () => {
  const W = 5;
  const W_eff = Math.max(3, W);
  for (let T = 1; T <= 120; T++) {
    for (let p = 1; p <= T; p++) {
      const fr = M.paginationFrame(T, p, W);
      const ctx = "T=" + T + " p=" + p + " frame=" + JSON.stringify(fr);

      assert.ok(Array.isArray(fr) && fr.length > 0, "non-empty " + ctx);
      assert.strictEqual(fr[0], 1, "first is 1 " + ctx);
      assert.strictEqual(fr[fr.length - 1], T, "last is T " + ctx);
      assert.ok(fr.indexOf(p) !== -1, "contains p " + ctx);

      const numbers = fr.filter((t) => t !== "...");
      assert.strictEqual(new Set(numbers).size, numbers.length, "unique " + ctx);
      for (let i = 0; i < numbers.length; i++) {
        assert.ok(Number.isInteger(numbers[i]), "integer " + ctx);
        assert.ok(numbers[i] >= 1 && numbers[i] <= T, "range " + ctx);
        if (i > 0) assert.ok(numbers[i] > numbers[i - 1], "ascending " + ctx);
      }

      const middle = numbers.filter((n) => n !== 1 && n !== T);
      assert.ok(middle.length <= W_eff, "middle <= W_eff " + ctx);
      assert.ok(numbers.length <= W_eff + 2, "numbers <= W_eff+2 " + ctx);
      assert.ok(fr.length <= W_eff + 4, "tokens <= W_eff+4 " + ctx);

      const ellipses = fr.filter((t) => t === "...").length;
      assert.ok(ellipses <= 2, "at most two ellipses " + ctx);
      for (let i = 0; i < fr.length; i++) {
        if (fr[i] !== "...") continue;
        assert.ok(i > 0 && i < fr.length - 1, "ellipsis not first/last " + ctx);
        assert.notStrictEqual(fr[i - 1], "...", "no double left " + ctx);
        assert.notStrictEqual(fr[i + 1], "...", "no double right " + ctx);
        assert.strictEqual(typeof fr[i - 1], "number", "between numbers l " + ctx);
        assert.strictEqual(typeof fr[i + 1], "number", "between numbers r " + ctx);
        if (i === 1) assert.ok(fr[i + 1] - 2 >= 2, "left hides >=2 " + ctx);
        else assert.ok(T - fr[i - 1] - 1 >= 2, "right hides >=2 " + ctx);
      }

      if (T <= W_eff + 2) {
        assert.strictEqual(ellipses, 0, "no ellipsis when small " + ctx);
        assert.strictEqual(numbers.length, T, "all pages when small " + ctx);
      }
      if (T >= W_eff + 3) {
        assert.ok(ellipses >= 1, "ellipsis when large " + ctx);
        assert.ok(numbers.length < T, "omission when large " + ctx);
      }

      assert.strictEqual(M.paginationVisible(T), T >= 2, "visible " + ctx);
      assert.strictEqual(M.canPreviousPage(p), p > 1, "prev " + ctx);
      assert.strictEqual(M.canNextPage(p, T), p < T, "next " + ctx);
    }
  }

  // Degenerate totals and the special T <= 2 frames.
  assert.deepStrictEqual(M.paginationFrame(0, 1, W), []);
  assert.deepStrictEqual(M.paginationFrame(1, 1, W), [1]);
  assert.deepStrictEqual(M.paginationFrame(2, 1, W), [1, 2]);
  assert.deepStrictEqual(M.paginationFrame(2, 2, W), [1, 2]);
  assert.strictEqual(M.paginationVisible(0), false);
  assert.strictEqual(M.paginationVisible(1), false);
  assert.strictEqual(M.paginationVisible(2), true);
  // A window below the minimum behaves exactly as 3.
  assert.deepStrictEqual(M.paginationFrame(9, 5, 0), M.paginationFrame(9, 5, 3));
  assert.deepStrictEqual(M.paginationFrame(9, 5, -10), M.paginationFrame(9, 5, 3));
});

test("frames mirror consistently except the (9,5) tie", () => {
  for (let T = 1; T <= 120; T++) {
    for (let p = 1; p <= T; p++) {
      if (T === 9 && p === 5) continue;
      const a = M.paginationFrame(T, p, 5);
      const b = M.paginationFrame(T, T + 1 - p, 5);
      const mirrored = [];
      for (let i = b.length - 1; i >= 0; i--)
        mirrored.push(b[i] === "..." ? "..." : T + 1 - b[i]);
      assert.deepStrictEqual(a, mirrored, "mirror T=" + T + " p=" + p);
    }
  }
  // The documented self-mirror exception really is asymmetric.
  assert.notDeepStrictEqual(
    M.paginationFrame(9, 5, 5),
    [1, "...", 4, 5, 6, 7, 8, 9],
  );
});

test("the open cursor follows the row count", () => {
  assert.deepStrictEqual(M.cursorForRows(0), { active: false, index: 0 });
  assert.deepStrictEqual(M.cursorForRows(1), { active: true, index: 0 });
  assert.deepStrictEqual(M.cursorForRows(5), { active: true, index: 0 });
  assert.deepStrictEqual(M.cursorForRows(-3), { active: false, index: 0 });
  assert.deepStrictEqual(M.cursorForRows(undefined), {
    active: false,
    index: 0,
  });
});

// --------------------------------------------------------------------------
// live round-trip (skipped when gh is unavailable or not signed in)

test("live: the real bounded gh command parses into one page", () => {
  const probe = spawnSync("bash", ["-lc", "command -v gh"], {
    encoding: "utf8",
  });
  if (probe.status !== 0) {
    console.log("       (skipped: gh is not on PATH)");
    return;
  }

  const run = spawnSync("bash", ["-lc", M.ghCommand(1)], {
    encoding: "utf8",
    timeout: 60000,
    maxBuffer: 4 * 1024 * 1024,
  });
  if (run.status !== 0) {
    console.log(
      "       (skipped: gh exited " +
        run.status +
        " - " +
        String(run.stderr).trim().split("\n")[0] +
        ")",
    );
    return;
  }

  const result = M.parseNotifications(0, run.stdout, run.stderr, 1);
  assert.strictEqual(result.ok, true, "live output parsed: " + result.error);
  assert.ok(result.items.length <= M.PAGE_SIZE, "one page at most");
  assert.strictEqual(
    result.totalPages,
    Math.max(1, Math.ceil(result.totalCount / M.PAGE_SIZE)),
  );
  console.log(
    "       (live: " +
      result.totalCount +
      " unread, page " +
      result.page +
      " of " +
      result.totalPages +
      ", " +
      result.items.length +
      " rows)",
  );

  if (result.totalPages >= 2) {
    const run2 = spawnSync("bash", ["-lc", M.ghCommand(2)], {
      encoding: "utf8",
      timeout: 60000,
      maxBuffer: 4 * 1024 * 1024,
    });
    assert.strictEqual(run2.status, 0, "page 2 command succeeded");
    const page2 = M.parseNotifications(0, run2.stdout, run2.stderr, 2);
    assert.strictEqual(page2.ok, true, "page 2 parsed: " + page2.error);
    assert.strictEqual(page2.page, 2);
    assert.ok(page2.items.length <= M.PAGE_SIZE);
  }
});

async function run() {
  let pass = 0;
  let fail = 0;
  for (const [name, fn] of tests) {
    try {
      await fn();
      pass++;
      console.log("ok   - " + name);
    } catch (e) {
      fail++;
      console.log("FAIL - " + name);
      console.log("       " + (e && e.message ? e.message : e));
    }
  }
  console.log("");
  console.log(pass + " passed, " + fail + " failed");
  if (fail > 0) process.exit(1);
}

run();
