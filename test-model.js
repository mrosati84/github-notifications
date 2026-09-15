// Node self-check for Model.js (GitHub Notifications).
//
// Deterministic unit tests for the four-field normalisation, the pagination
// flattening, gh failure classification, the link rewriting, the state
// reducer and every display string - plus one live round-trip through the real
// `gh api notifications` command when gh is available and authenticated (it is
// skipped, not failed, when it is not).
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

// --------------------------------------------------------------------------
// interval clamping

test("clampIntervalSeconds keeps a sane value and defaults the rest", () => {
  assert.strictEqual(M.clampIntervalSeconds(300), 300);
  assert.strictEqual(M.clampIntervalSeconds("600"), 600);
  assert.strictEqual(M.clampIntervalSeconds(undefined), 300);
  assert.strictEqual(M.clampIntervalSeconds(0), 300);
  assert.strictEqual(M.clampIntervalSeconds(-5), 300);
  assert.strictEqual(M.clampIntervalSeconds(1), 60); // floored
  assert.strictEqual(M.clampIntervalSeconds(99999), 3600); // capped
  assert.strictEqual(M.clampIntervalSeconds("abc"), 300);
});

// --------------------------------------------------------------------------
// parsing

test("the default command is the plain gh one plus pagination", () => {
  assert.deepStrictEqual(M.ghArgv(), [
    "bash",
    "-lc",
    "exec gh api notifications --paginate --slurp",
  ]);
});

test("a slurped, paginated response flattens into one list", () => {
  const out = JSON.stringify([PAGE_ONE, PAGE_TWO]);
  const result = M.parseNotifications(0, out, "");
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.error, "");
  assert.strictEqual(result.items.length, 3);
});

test("an un-slurped single page parses the same way", () => {
  const result = M.parseNotifications(0, JSON.stringify(PAGE_ONE), "");
  assert.strictEqual(result.items.length, 2);
});

test("only the four wanted fields survive", () => {
  const result = M.parseNotifications(0, JSON.stringify([PAGE_ONE]), "");
  assert.deepStrictEqual(result.items[0], {
    repoName: "widgets",
    repoUrl: "https://github.com/acme/widgets",
    title: "Implement proxy for remote assets",
    subjectUrl: "https://api.github.com/repos/acme/widgets/issues/270",
  });
  assert.deepStrictEqual(Object.keys(result.items[0]).sort(), [
    "repoName",
    "repoUrl",
    "subjectUrl",
    "title",
  ]);
});

test("missing pieces become empty strings, never undefined", () => {
  const result = M.parseNotifications(
    0,
    JSON.stringify([
      { subject: { title: "no repository at all" } },
      { repository: { name: "only-repo" } },
    ]),
    "",
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
  const result = M.parseNotifications(
    0,
    JSON.stringify([PAGE_ONE[0], {}, null, "nope", []]),
    "",
  );
  assert.strictEqual(result.items.length, 1);
});

test("an empty notification list is a success", () => {
  const result = M.parseNotifications(0, "[]", "");
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.items.length, 0);
});

test("empty output is treated as an empty list, not as an error", () => {
  const result = M.parseNotifications(0, "", "");
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.items.length, 0);
});

test("non-JSON output is reported instead of thrown", () => {
  const result = M.parseNotifications(0, "gh: something went sideways", "");
  assert.strictEqual(result.ok, false);
  assert.match(result.error, /not JSON/);
});

test("a single object instead of a list is reported", () => {
  const result = M.parseNotifications(0, '{"message":"Not Found"}', "");
  assert.strictEqual(result.ok, false);
  assert.match(result.error, /single object/);
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
    error: "",
    checkedAt: 0,
  });
});

test("a good fetch replaces the list", () => {
  const view = M.viewAfterFetch(
    M.initialView(),
    M.parseNotifications(0, JSON.stringify(PAGE_TWO), ""),
    1000,
  );
  assert.strictEqual(view.status, "ok");
  assert.strictEqual(view.items.length, 1);
  assert.strictEqual(view.error, "");
  assert.strictEqual(view.checkedAt, 1000);
});

test("a failed fetch keeps the last good list and records when it was checked", () => {
  const good = M.viewAfterFetch(
    M.initialView(),
    M.parseNotifications(0, JSON.stringify(PAGE_ONE), ""),
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
  assert.strictEqual(
    M.repoLink(item("x")),
    "https://github.com/cli/cli",
  );
  assert.strictEqual(M.repoLink(null), "");
});

// --------------------------------------------------------------------------
// display strings

test("counts and the lit/unlit decision", () => {
  const empty = M.viewAfterFetch(
    M.initialView(),
    M.parseNotifications(0, "[]", ""),
    1,
  );
  const full = M.viewAfterFetch(
    M.initialView(),
    M.parseNotifications(0, JSON.stringify([PAGE_ONE, PAGE_TWO]), ""),
    1,
  );
  assert.strictEqual(M.countOf(empty), 0);
  assert.strictEqual(M.hasNotifications(empty), false);
  assert.strictEqual(M.countOf(full), 3);
  assert.strictEqual(M.hasNotifications(full), true);
  assert.strictEqual(M.hasNotifications(M.initialView()), false);
});

test("the pill reads the state in one glance", () => {
  assert.strictEqual(M.statusPill(M.initialView()), "CHECKING");
  assert.strictEqual(
    M.statusPill(
      M.viewAfterFetch(M.initialView(), M.parseNotifications(0, "[]", ""), 1),
    ),
    "ALL READ",
  );
  assert.strictEqual(
    M.statusPill(
      M.viewAfterFetch(
        M.initialView(),
        M.parseNotifications(0, JSON.stringify([PAGE_ONE]), ""),
        1,
      ),
    ),
    "2 UNREAD",
  );
  assert.strictEqual(
    M.statusPill(
      M.viewAfterFetch(
        M.initialView(),
        { ok: false, items: [], error: "x" },
        1,
      ),
    ),
    "GH ERROR",
  );
});

test("singular and plural are both correct", () => {
  const one = M.viewAfterFetch(
    M.initialView(),
    M.parseNotifications(0, JSON.stringify([PAGE_TWO]), ""),
    1,
  );
  assert.strictEqual(M.statusPill(one), "1 UNREAD");
  // The hero carries only the repository count: the pill has the count of
  // notifications and every row names its own repository.
  assert.strictEqual(M.heroMeta(one), "in 1 repository");
  const many = M.viewAfterFetch(
    M.initialView(),
    M.parseNotifications(0, JSON.stringify([PAGE_ONE, PAGE_TWO]), ""),
    1,
  );
  assert.strictEqual(M.heroMeta(many), "in 3 repositories");
  // The log line still spells the whole state out.
  assert.strictEqual(
    M.statusLine(one),
    "1 unread notification in 1 repository",
  );
  assert.strictEqual(
    M.statusLine(many),
    "3 unread notifications in 3 repositories",
  );
  assert.strictEqual(
    M.statusLine(M.initialView()),
    "Checking gh api notifications",
  );
  assert.strictEqual(
    M.statusLine(
      M.viewAfterFetch(M.initialView(), M.parseNotifications(0, "[]", ""), 1),
    ),
    "No unread notifications",
  );
});

test("the empty, loading and error copies", () => {
  assert.match(M.emptyText(M.initialView()), /Asking gh/);
  assert.match(
    M.emptyText(
      M.viewAfterFetch(M.initialView(), M.parseNotifications(0, "[]", ""), 1),
    ),
    /Nothing unread/,
  );
  assert.strictEqual(
    M.heroMeta(
      M.viewAfterFetch(M.initialView(), M.parseNotifications(0, "[]", ""), 1),
    ),
    "Inbox zero",
  );
});

test("an error keeps the stale list labelled as stale", () => {
  const good = M.viewAfterFetch(
    M.initialView(),
    M.parseNotifications(0, JSON.stringify(PAGE_ONE), ""),
    1000,
  );
  const stale = M.viewAfterFetch(
    good,
    { ok: false, items: [], error: "rate limit" },
    2000,
  );
  assert.strictEqual(M.errorHint(stale), "Showing the last list that loaded.");
  assert.strictEqual(M.errorHint(good), "");
  assert.match(M.footerText(stale), /^Last good check /);
  assert.strictEqual(
    M.errorHint(
      M.viewAfterFetch(undefined, { ok: false, items: [], error: "x" }, 1),
    ),
    "Click the mark, or press r, to check again.",
  );
});

test("the repository breakdown counts and caps", () => {
  const items = [
    item("a"),
    item("b"),
    item("c", {
      repoName: "other",
      repoUrl: "https://github.com/x/other",
    }),
    item("d", { repoName: "third", repoUrl: "https://github.com/x/third" }),
  ];
  assert.strictEqual(M.repositoryCount(items), 3);
  assert.strictEqual(
    M.repoBreakdown(items, 2),
    "cli x2 · other x1 · +1 more",
  );
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
  assert.match(
    M.footerText(
      M.viewAfterFetch(
        M.initialView(),
        M.parseNotifications(0, "[]", ""),
        midday,
      ),
    ),
    /^Checked 09:05$/,
  );
});

test("the tooltip always explains the three clicks", () => {
  const full = M.viewAfterFetch(
    M.initialView(),
    M.parseNotifications(0, JSON.stringify([PAGE_ONE]), ""),
    1,
  );
  const empty = M.viewAfterFetch(
    M.initialView(),
    M.parseNotifications(0, "[]", ""),
    1,
  );
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
// live round-trip (skipped when gh is unavailable or not signed in)

test("live: the real gh command parses into notifications", () => {
  const probe = spawnSync("bash", ["-lc", "command -v gh"], {
    encoding: "utf8",
  });
  if (probe.status !== 0) {
    console.log("       (skipped: gh is not on PATH)");
    return;
  }
  const run = spawnSync("bash", ["-lc", M.GH_COMMAND], {
    encoding: "utf8",
    timeout: 60000,
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
  const result = M.parseNotifications(0, run.stdout, run.stderr);
  assert.strictEqual(result.ok, true, "live output parsed: " + result.error);
  result.items.forEach((entry) => {
    assert.strictEqual(typeof entry.repoName, "string");
    assert.strictEqual(typeof entry.repoUrl, "string");
    assert.strictEqual(typeof entry.title, "string");
    assert.strictEqual(typeof entry.subjectUrl, "string");
    assert.ok(
      entry.title !== "" || entry.subjectUrl !== "",
      "every item is clickable or readable",
    );
  });
  console.log(
    "       (live: " + result.items.length + " unread notification(s) parsed)",
  );
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
