# Code, Security, Performance & Professionalism Review — GitHub Notifications (Omarchy shell plugin)

| Field | Value |
|---|---|
| Review date | 2026-09-16 |
| Plugin id | `io.github.mrosati84.github-notifications` |
| Version | `1.0.0` (manifest.json) |
| Reviewer role | Independent code / security / performance reviewer (pre-disclosure) |
| Commit reviewed | `c4d5d102c1ce77f924487cea7cbcad7e791cf42d` (`implement pagination`) **plus the uncommitted remediation edits described in §4.8 and §11** |
| Working tree | 5 tracked files modified (uncommitted); `review.md` untracked |
| Reference environment | Omarchy / Quickshell 0.3.1-1, Qt 6 `qmllint`, authenticated `gh` |
| Source changes this cycle | remediation edits to 5 source/doc files (see §11); `review.md` is a review artifact |

> This document is a review artifact. It does not modify, stage, or commit any
> plugin source file. The remediation edits it describes are working-tree changes
> only; nothing was committed. Findings marked **Fixed** were applied in this
> cycle and verified; findings marked **Open** remain for a future cycle.

---

## Table of contents

1. [Executive summary](#1-executive-summary)
2. [Scope and method](#2-scope-and-method)
3. [Severity scale](#3-severity-scale)
4. [Verification results](#4-verification-results)
5. [Findings](#5-findings)
   - [Critical](#critical)
   - [High](#high)
   - [Medium](#medium)
   - [Low](#low)
   - [Informational](#informational)
6. [Security assessment](#6-security-assessment)
7. [Performance assessment](#7-performance-assessment)
8. [Code quality assessment](#8-code-quality-assessment)
9. [Professionalism / presentation assessment](#9-professionalism--presentation-assessment)
10. [Positive findings & strengths](#10-positive-findings--strengths)
11. [Remediation status / prioritised action list](#11-remediation-status--prioritised-action-list)
12. [Conclusion / disclosure sign-off](#12-conclusion--disclosure-sign-off)

---

## 1. Executive summary

**Verdict: the plugin is ready for public disclosure. All three Medium findings
and four Low findings were remediated and verified in this cycle (uncommitted);
no Critical or High findings were found at any point.**

The plugin is small (~1,000 lines of shipped QML + ~800 lines of pure
`Model.js`), well factored, and unusually well tested (50 deterministic tests,
all passing, plus a live `gh` round-trip). Security is strong: the page value
that reaches the one shell string is provably reduced to an integer, all
untrusted text is rendered with `Text.PlainText`, browser launches are now gated
to absolute `http(s)` URLs, HTTP is confined to authenticated `gh api` against
`api.github.com`, and every buffer has an explicit cap. The `omarchy plugin
validate` and `qmllint` gates both exit 0.

Status at the end of this cycle:

| Status | Findings |
|---|---|
| Fixed (this cycle, uncommitted) | F-01, F-02, F-03, F-06, F-07, F-09, F-10 |
| Open | F-04, F-05, F-08, F-11, F-12, F-13, F-14 |

Counts by severity (severity is unaffected by remediation status):

| Severity | Count |
|---|---:|
| Critical | 0 |
| High | 0 |
| Medium | 3 |
| Low | 8 |
| Informational | 3 |
| **Total** | **14** |

**Disclosure readiness:** unconditional. The security posture never blocked
disclosure; the three Medium issues that previously recommended a fix-first
posture are now fixed and verified. The remaining open items are minor quality,
documentation, and coverage notes.

---

## 2. Scope and method

**Reviewed (all in the plugin directory):**

- `manifest.json`, `README.md`, `LICENSE`, `.gitignore`
- `BarWidget.qml`, `Panel.qml`, `GitHubMark.qml`, `Model.js`, `test-model.js`
- `pagination-specs.md` (908 lines; the frame algorithm in §9 is normative)
- `assets/github.svg`, `screenshots/notif-1.png`, `screenshots/notif-2.png`

**Reference read (upstream Omarchy, not edited):**

- `/usr/share/omarchy/shell/Ui/{BarWidget,Panel,KeyboardPanel,PanelKeyCatcher,PanelController,CursorSurface,PanelActionButton,BarIconButton,PanelHero,PanelSeparator}.qml`
- `/usr/share/omarchy/shell/plugins/` (first-party plugins, especially
  `panels/weather/BarWidget.qml`, `panels/dropbox/Panel.qml`,
  `panels/disk-speedtest/Panel.qml`, manifests)
- `/usr/share/omarchy/bin/omarchy-plugin-validate`,
  `/usr/bin/omarchy-plugin-enable`,
  `/usr/share/omarchy/bin/omarchy-launch-browser`,
  `/usr/share/omarchy/shell/plugins/bar/Bar.qml`
- `/usr/share/omarchy/default/agents/skills/omarchy/plugins.md`
- `/usr/share/omarchy/shell/services/PluginRegistry.qml`,
  `/usr/share/omarchy/shell/plugins/bar/BarModel.js`,
  `/usr/share/omarchy/shell/shell.qml`

**Tools:** `node` v24.5.0, `qmllint` from Qt 6
(`/usr/lib/qt6/bin/qmllint`), `omarchy plugin validate`, `gh` (authenticated),
`rg`, `git`.

**Method.** Two passes:

1. **Review pass** at commit `c4d5d10`: static reading; execution of the
   project's own test suite; the official validator; `qmllint`; targeted
   `node -e` probes for command-injection and URL handling; and careful
   state-machine tracing of `BarWidget.open()` ↔ `Panel.onOpenedChanged` and the
   stall timer.
2. **Remediation pass** on the working tree: minimal, in-style fixes for
   F-01, F-02, F-03, F-06, F-07, F-09, F-10, a new unit test, and a re-run of the
   full baseline. The original findings keep their Severity/Category ratings;
   only their Status changed.

Findings are traceable to a command or a `file:line`. False positives are
explicitly labelled. The remediation edits were not committed.

---

## 3. Severity scale

| Severity | Definition |
|---|---|
| **Critical** | Exploitable / destructive, or causes data loss. |
| **High** | Serious security, privacy, or correctness issue with realistic impact. |
| **Medium** | Real bug / perf / docs issue with contained impact. |
| **Low** | Minor quality or maintainability nit. |
| **Informational** | Observation or positive note; no action required. |

---

## 4. Verification results

All commands were run from the plugin directory. Section 4.8 records the
remediation-pass results; §§4.1–4.7 are the state after remediation except where
noted.

### 4.1 `node test-model.js`

```
$ node test-model.js
ok   - the bounded fetch constants are fixed
ok   - the command is bounded: one probe plus one page, no paginate/slurp
ok   - a bad page request in the command falls back to page 1
ok   - splitHeadersBody and parseLinkPages read gh's --include shape
ok   - countFromProbe reads Link last, then the body array
ok   - derived page maths
ok   - a combined probe+page response parses into a bounded page
ok   - the count probe covers 0, 1 and overflow
ok   - a requested page past the end clamps to the last page
ok   - more than a page of items is capped at PAGE_SIZE
ok   - retained strings are truncated to their caps
ok   - only the four wanted fields survive
ok   - missing pieces become empty strings, never undefined
ok   - entries that carry nothing at all are dropped
ok   - an empty notification list is a success
ok   - empty output without the sentinel is reported
ok   - stdout without the sentinel is reported
ok   - non-JSON page output is reported instead of thrown
ok   - a single object instead of a list is reported
ok   - an oversized stdout is rejected before parsing
ok   - an unparseable probe is classified as a gh failure
ok   - each gh failure gets a sentence a person can act on
ok   - an unrecognised failure still names the exit code and the first line
ok   - a very long failure line is truncated
ok   - a fresh view is loading with nothing in it
ok   - a good fetch replaces the list and the page accounting
ok   - a failed fetch keeps the last good list and records when it was checked
ok   - a failure with no prior list is just a failure
ok   - api.github.com subject URLs rewrite to the pages people expect
ok   - an unknown or foreign URL is not guessed at
ok   - subjectLink honours the mode and falls back to gh's own URL
ok   - the repository link is repository.html_url, unchanged
ok   - only absolute http(s) URLs are safe to launch
ok   - counts come from the probe, not from the visible page
ok   - the pill reads the state in one glance
ok   - singular and plural are both correct, and pages are named
ok   - the empty, loading and error copies
ok   - an error keeps the stale list labelled as stale
ok   - the repository breakdown counts and caps
ok   - an item with no repository name still counts as one
ok   - times render as local HH:MM and never as NaN
ok   - the tooltip always explains the three clicks
ok   - Table A conformance (T = 1..12, every page)
ok   - Table B conformance (T = 20, every page)
ok   - Table C conformance (T = 100, 1000, 12345 samples)
ok   - Table C-2 conformance (T = 100, all pages)
ok   - Table D conformance (visibility and edge frames)
ok   - pagination invariants hold for T = 1..120 and every page
ok   - frames mirror consistently except the (9,5) tie
       (live: 97 unread, page 1 of 20, 5 rows)
ok   - live: the real bounded gh command parses into one page

50 passed, 0 failed
$ echo $?
0
```

The suite grew from 49 to 50 tests in this cycle: the new
`only absolute http(s) URLs are safe to launch` test was added for F-10. The live
round-trip ran against the reviewer's authenticated `gh` (97 unread, page 1 of
20, 5 rows).

### 4.2 `omarchy plugin validate .`

```
$ omarchy plugin validate .
$ echo $?
0
```

Exit 0, no output. This exercises the same schema checks the shell's
`PluginRegistry` enforces: `schemaVersion === 1`, required fields, relative
entry points that exist, an id that is not `omarchy.*`, and no symlinks in the
plugin folder (`.git` pruned).

### 4.3 `qmllint`

```
$ /usr/lib/qt6/bin/qmllint -I /tmp/opencode/qmlimports BarWidget.qml Panel.qml GitHubMark.qml
$ echo $?
0
```

Exit 0. Message counts after remediation: **56 warnings and 33 infos** (not
errors). Correct breakdown by severity and tag:

```
Warnings (56):
    34  [unqualified]
    21  [missing-property]
     1  [signal-handler-parameters]

Infos (33):
    32  Set "pragma ComponentBehavior: Bound" ...
     1  'index' is implicitly injected into this delegate ...
```

The `[unused-imports]` line is emitted at **Info** severity, so it belongs in
the info count, not the warning count — that distinction is why the raw tag list
and the warning total differ. It is now absent because F-07 removed the unused
import (57→56 warnings, 34→33 infos overall); F-06 removed the
`Color.popups.background` line, dropping `missing-property` from 22 to 21.

Representative lines, verbatim:

```
Warning: BarWidget.qml:108:9: Type QProcess::ExitStatus of parameter exitStatus in signal called exited was not found, but is required to compile onExited. Did you add all imports and dependencies? [signal-handler-parameters]
        onExited: function (exitCode) {

Warning: BarWidget.qml:46:72: Member "opened" not found on type "QObject" [missing-property]
    readonly property bool opened: panelLoader.item ? panelLoader.item.opened === true : false

Warning: Panel.qml:31:51: Member "foreground" not found on type "QObject" [missing-property]
    readonly property color foreground: bar ? bar.foreground : Color.foreground

Warning: Panel.qml:427:67: Member "rowPaddingX" not found on type "QObject" [missing-property]
        implicitHeight: rowContent.implicitHeight + Style.spacing.rowPaddingX

Warning: BarWidget.qml:280:22: Unqualified access [unqualified]
                lit: root.hasNotifications
Info: Set "pragma ComponentBehavior: Bound" in order to use IDs from outer components in nested components.

Warning: GitHubMark.qml:22:28: Member "iconCanvas" not found on type "QObject" [missing-property]
  implicitWidth: Style.bar.iconCanvas
```

**False positives (explicitly not bugs).** The `[missing-property]` warnings
against `qs.*` singletons — `Style.bar.iconCanvas`, `Style.font.bodySmall`,
`Style.font.caption`, `Style.font.body`, `Style.spacing.rowPaddingX`,
`Color.popups.background`, `Color.popups.border` — are **false positives**:
`Style` and `Color` are QML singletons whose nested members are ordinary
properties, which `qmllint` cannot introspect when the import is only visible as
a JS/QML module. The members do exist (verified in
`/usr/share/omarchy/shell/Commons/Style.qml:328,345` and
`Commons/Color.qml:79`). Likewise `Member "opened"/"open"/"close"/"refresh"
not found on type "QObject"` for `panelLoader.item.*` is expected: the loader
item's concrete type is not statically known. The `signal-handler-parameters`
warning about `QProcess::ExitStatus` is the same limitation for the Quickshell
`Process.exited` signal (`quickshell-io.qmltypes` declares
`exited(exitCode, exitStatus)`); using only `exitCode` is valid QML.

**Real (but benign) warnings:** the `[unqualified]` warnings are genuine (F-08).
They are consistent with upstream first-party code: the same `qmllint`
invocation reports 15 warnings for
`/usr/share/omarchy/shell/plugins/panels/weather/BarWidget.qml` (all
`missing-property`) and 71 for `panels/dropbox/Panel.qml`.

### 4.4 `git status`, `git log`, file inventory

The tree is **not** clean: the remediation edits are uncommitted and
`review.md` is an untracked review artifact (created by this review, not shipped
by the plugin).

```
$ git status --porcelain
 M BarWidget.qml
 M Model.js
 M Panel.qml
 M README.md
 M test-model.js
?? review.md

$ git status
On branch master
Your branch is ahead of 'origin/master' by 3 commits.

Changes not staged for commit:
  (use "git add <file>..." to update what will be committed)
  (use "git restore <file>..." to discard changes in working directory)
	modified:   BarWidget.qml
	modified:   Model.js
	modified:   Panel.qml
	modified:   README.md
	modified:   test-model.js

Untracked files:
  (use "git add <file>..." to include in what will be committed)
	review.md

no changes added to commit (use "git add" and/or "git commit -a")

$ git log --oneline -10
c4d5d10 implement pagination
62977ab add tech-indipendent pagination specs
416cdbd ignore opencode goal files
03a9499 add missing LICENSE file
28a98a4 moved screenshots
80eef3f add screenshots
1105f86 fix wording
a6a5116 add removal instructions and license
4722f83 initial working version

$ git diff --stat
 BarWidget.qml | 15 +++++++++++++--
 Model.js      |  9 +++++++++
 Panel.qml     |  8 ++++----
 README.md     |  7 +++++--
 test-model.js | 19 +++++++++++++++++++
 5 files changed, 50 insertions(+), 8 deletions(-)
```

File inventory. `wc -l` over the source/doc glob now also matches the untracked
`review.md`:

```
$ wc -l *.qml *.js *.md *.json
   285 BarWidget.qml
    58 GitHubMark.qml
   490 Panel.qml
   806 Model.js
  1212 test-model.js
   908 pagination-specs.md
   217 README.md
  1063 review.md
    44 manifest.json
  5083 total
```

So the `5083 total` **includes `review.md`**. Excluding it, the eight tracked
source/doc files total **4020** lines:

```
$ wc -l BarWidget.qml Panel.qml GitHubMark.qml Model.js test-model.js pagination-specs.md README.md manifest.json
   285 BarWidget.qml
   490 Panel.qml
    58 GitHubMark.qml
   806 Model.js
  1212 test-model.js
   908 pagination-specs.md
   217 README.md
    44 manifest.json
  4020 total
```

`ls -la` shows no build artifacts. `find . -name .git -prune -o -type l -print`
prints nothing — **no symlinks** inside the plugin folder.

### 4.5 Command-injection probe (`node -e`, hostile `page` values)

```
$ node -e '<probe that calls Model.ghCommand(p) with hostile p and prints the extracted page= value>'
INPUT                        EXTRACTED page= VALUE
"1; rm -rf /"                "1"              plain-integer
"$(id)"                      "1"              plain-integer
"`id`"                       "1"              plain-integer
"1\"; touch /tmp/x; echo \"" "1"              plain-integer
"1 && curl evil"             "1"              plain-integer
"1\nrm -rf /"                "1"              plain-integer
"../../etc"                  "1"              plain-integer
"1|whoami"                   "1"              plain-integer
"0x10"                       "16"             plain-integer
" 7 "                        "7"              plain-integer
"1e3"                        "1000"           plain-integer
"2.9"                        "2"              plain-integer
"-1"                         "1"              plain-integer
"NaN"                        "1"              plain-integer
"Infinity"                   "1"              plain-integer
"1e21"                       "1e+21"          NON-INTEGER
"01"                         "1"              plain-integer
"1; echo pwned"              "1"              plain-integer
"1$IFS"                      "1"              plain-integer

Full command for hostile page "1; rm -rf /":
set -o pipefail; { gh api "notifications?per_page=1&page=1" --include && printf "\n@@GH_NOTIF_COUNT@@\n" && gh api "notifications?per_page=5&page=1"; } 2> >(head -c 8192 >&2) | head -c 262145
```

Every shell-metacharacter input collapses to a plain integer. The single
`NON-INTEGER` row (`"1e21"` → `"1e+21"`) is a JS *number* string, not injectable
content: it contains no shell metacharacter and is a direct-only call value. In
production the only call path is
`BarWidget.loadPage()` → `Model.clampPage(k, …)` (`Model.js:184-192`), which
returns an integer in `1..totalPages`, then `Model.ghArgv(target)`
(`BarWidget.qml:54-64`); `pendingPage`/`requestedPage` are QML `int` properties.
See §6.1.

### 4.6 `subjectLink` / `apiToWebUrl` / `isSafeUrl` probe

```
$ node -e '<probe calling Model.apiToWebUrl / Model.subjectLink / Model.repoLink>'
URL                                            apiToWebUrl                                    subjectLink(web)
"file:///etc/passwd"                           ""                                             "file:///etc/passwd"
"javascript:alert(1)"                          ""                                             "javascript:alert(1)"
"-flag"                                        ""                                             "-flag"
"http://evil.example/x"                        ""                                             "http://evil.example/x"
"https://api.github.com/repos/o/r/issues/9"    "https://github.com/o/r/issues/9"              "https://github.com/o/r/issues/9"
"https://github.com/o/r"                       ""                                             "https://github.com/o/r"
"data:text/html,<b>x</b>"                      ""                                             "data:text/html,<b>x</b>"
""                                             ""                                             ""
"  https://ok  "                               ""                                             "  https://ok  "

subjectLink(api) for file:// = "file:///etc/passwd"
repoLink for {repoUrl:"-flag"} = "-flag"
```

Contents the widget does not recognise are still produced by the `Model.js`
link helpers (see §6.4), but `Panel.openUrl` no longer launches them: it now
requires `Model.isSafeUrl(url)` (`Panel.qml:89-92`), which accepts only absolute
`http(s)` URLs.

### 4.7 Hygiene probes

```
$ rg -n 'TODO|FIXME|XXX|HACK' --glob '!*.png' --glob '!.git/**' --glob '!review.md' .
$ echo $?
1                      # no matches in plugin source (review.md excluded)
```

`review.md` itself quotes the pattern and the phrase `TODO/FIXME/XXX/HACK`, so it
self-matches; excluding the review artifact is what makes this scan meaningful.
For transparency, the unfiltered command now exits 0 with 6 matching lines; all
of them are inside `review.md` (it quotes the pattern and discusses the marker
scan in several places). No plugin source file contains a `TODO`, `FIXME`, `XXX`,
or `HACK` marker.

```
$ rg -n -- '--paginate|--slurp' Model.js BarWidget.qml Panel.qml
$ echo $?
1                      # no matches
```

`rg -c '^test\(' test-model.js` → `50`. `.gitignore` is a single line:
`.opencode/goal.md`, and `.opencode/` is not tracked.

### 4.8 Remediation verification

**F-10 (`isSafeUrl`): new test fails on the old code, passes on the new.**
The new test calls `Model.isSafeUrl`, which did not exist at `c4d5d10`. Loading
the committed `Model.js` and invoking the helper throws:

```
$ git show HEAD:Model.js > /tmp/opencode/Model.old.js
$ node -e 'const M = require("/tmp/opencode/Model.old.js"); console.log(typeof M.isSafeUrl); M.isSafeUrl("https://github.com/o/r")'
undefined
TypeError: M.isSafeUrl is not a function
```

so the new test would fail against the old behaviour (the assertion helper
itself is unreachable). Against the remediated `Model.js`:

```
$ node -e '<same checks against ./Model.js>'
new Model exports isSafeUrl? function
"https://github.com/o/r" -> true
"http://x.y" -> true
"file:///etc/passwd" -> false
"javascript:alert(1)" -> false
"data:text/html,x" -> false
"-flag" -> false
"" -> false
undefined -> false
```

and the full suite reports `50 passed, 0 failed` (§4.1).

**F-01 (single fetch on open).** The duplicate refresh was removed from
`Panel.onOpenedChanged`; `BarWidget.open()` is now the only refresher on an open.
`switchPanelFrom` also funnels through `BarWidget.open()`
(`/usr/share/omarchy/shell/plugins/bar/Bar.qml:690` calls `nextSlot.activeItem.open()`),
so every open path — left click, IPC `open`/`show`, toggle-open, and Tab
switching — performs exactly one `loadPage(1)`. `r`, middle-click, and the
periodic timer call the widget's `refresh()`/`loadPage()` directly and are
unchanged.

**F-03 (stall message survives).** The `stalled` flag is set by the timer before
the kill (`BarWidget.qml:153`), cleared on `onExited` (`BarWidget.qml:112-115`)
which then returns before overwriting the view, and cleared when a new fetch
starts (`BarWidget.qml:61`). The timeout view written at `BarWidget.qml:156-160`
is therefore the one left on screen. This is a static trace; the QML shell is not
executed by the test suite.

**Baseline after remediation:** `node test-model.js` → `50 passed, 0 failed`,
exit 0; `omarchy plugin validate .` → exit 0; `qmllint` → exit 0.

---

## 5. Findings

### Critical

None.

### High

None.

### Medium

#### F-01 — Opening the panel triggered two sequential `gh` fetches — **Fixed**

- **Severity:** Medium
- **Category:** Performance
- **Location:** `BarWidget.qml:175-179` (`open()`, now the single refresh owner); `Panel.qml:138-148` (`onOpenedChanged`)
- **Evidence:** `BarWidget.open()` called `panelLoader.item.open()` (which set
  `PanelController.open = true` synchronously, firing `onOpenedChanged`) **and**
  `root.refresh()`. `Panel.onOpenedChanged` also called `refreshNow()`, so the
  second call landed while the first fetch was in flight and queued
  `pendingPage = 1`, producing a second sequential fetch on exit.
- **Impact:** Each panel open cost two round-trips instead of one.
- **Recommendation:** Keep exactly one refresh owner on open.
- **Fix applied:** Removed `root.refreshNow();` from `Panel.onOpenedChanged`
  (`Panel.qml:138-148`); `BarWidget.open()`'s `root.refresh()`
  (`BarWidget.qml:175-179`) is now the single owner. Cursor reset and key-catcher
  focus remain in `onOpenedChanged`. Verified by trace and by the open-path
  analysis in §4.8; no runtime QML harness exists.
- **Status:** Fixed (uncommitted, this cycle).

#### F-02 — `subjectLinks` runtime fallback (`api`) contradicted the documented/manifest default (`web`) — **Fixed**

- **Severity:** Medium
- **Category:** Professionalism (docs vs. behaviour)
- **Location:** `BarWidget.qml:28`; `Panel.qml:41`; `manifest.json:21-23, 38-40`; `README.md:79-109`
- **Evidence:** The code fallback was `"api"` while the manifest `defaultValue`
  and README said `"web"`. Because Omarchy reads widget settings verbatim from the
  layout entry (`BarModel.entrySettings`, `/usr/share/omarchy/shell/plugins/bar/BarModel.js:10-18`)
  and `PluginRegistry.setEnabled` writes only `{ id: key }`
  (`/usr/share/omarchy/shell/services/PluginRegistry.qml:526`), a fresh install
  that never edits `shell.json` inherited the `api` fallback.
- **Impact:** Contrary to the recommendation, a fresh install opened raw
  `api.github.com` JSON and spent the shared anonymous rate-limit budget.
- **Recommendation:** Make the runtime fallback `"web"`.
- **Fix applied:** `BarWidget.qml:28` now uses
  `root.setting("subjectLinks", "web")`; `Panel.qml:41` uses `"web"` when no host
  widget is present. Verified by `rg` and by the unchanged `subjectLink` tests in
  the 50-test run.
- **Status:** Fixed (uncommitted, this cycle).

#### F-03 — The 60 s stall-timeout message was overwritten by `onExited` — **Fixed**

- **Severity:** Medium
- **Category:** Code quality (error handling / correctness)
- **Location:** `BarWidget.qml:147-162` (stall timer), `BarWidget.qml:108-141` (`onExited`); README claim at `README.md:163-164`
- **Evidence:** The timer wrote a timeout view and then set `proc.running = false`
  to kill the process. Upstream documents that the exit is asynchronous
  (`panels/disk-speedtest/Panel.qml:56-58`: "Process.running stays true until the
  child exits"), so `onExited` fired afterwards and replaced the timeout view with
  a generic parse/exit error.
- **Impact:** On a hung `gh`, the panel reported the wrong cause, contradicting
  the README's "cut loose **and reported**".
- **Recommendation:** Track that the kill was intentional and keep the timeout
  message.
- **Fix applied:** Added `property bool stalled: false` (`BarWidget.qml:40`); the
  stall timer sets it before killing (`BarWidget.qml:153`); `onExited` resets it
  and returns before overwriting the view (`BarWidget.qml:109-115`); `loadPage`
  clears it whenever a new fetch starts (`BarWidget.qml:61`) so a later real exit
  is not misclassified. Verified by static trace (§4.8).
- **Status:** Fixed (uncommitted, this cycle).

### Low

#### F-04 — "Last good check" shows the time of the *failed* attempt

- **Severity:** Low
- **Category:** Code quality (correctness of a displayed string)
- **Location:** `Model.js:483-495` (error branch sets `checkedAt: nowMs`),
  `Model.js:710-715` (`footerText`)
- **Evidence:** After a good check at `t0` and a failed check at `t1`,
  `viewAfterFetch`'s error branch stores `checkedAt: t1`, and `footerText` then
  renders "Last good check <t1>" — the failure time, not the last success. The
  test at `test-model.js:505` asserts `bad.checkedAt === 2000` (the failure time)
  and `test-model.js:689` only matches the `/^Last good check /` prefix, so the
  suite does not catch the mislabel.
- **Impact:** After any failed poll the footer gives a misleading timestamp.
- **Recommendation:** Preserve the last successful `checkedAt` on failure (add a
  separate `attemptedAt` if the attempt time is wanted).
- **Status:** Open — this cycle.

#### F-05 — Repository counting merges same-named repositories from different owners

- **Severity:** Low
- **Category:** Code quality (logic)
- **Location:** `Model.js:224-242` (retains `repository.name`, drops
  `full_name`), `Model.js:598-612` (`repoCounts`), `Model.js:614-616`
  (`repositoryCount`), `Model.js:618-627` (`repoBreakdown`)
- **Evidence:** `repoCounts` keys on `repoName` (`repository.name`), which is not
  globally unique (`acme/docs` and `other/docs` both yield `"docs"`), so the
  tooltip breakdown and the hero's "in N repositories" undercount distinct
  repositories when same-named repos share a page.
- **Impact:** Cosmetic miscount of repositories on one page.
- **Recommendation:** Key on `repository.full_name` (or owner + name) for
  counting; keep `name` for display.
- **Status:** Open — this cycle.

#### F-06 — Unused `surface` property in `Panel.qml` — **Fixed**

- **Severity:** Low
- **Category:** Code quality (dead code)
- **Location:** `Panel.qml:31-35` (the colour-property block the unused `surface` was removed from)
- **Evidence:** `rg -n 'surface' Panel.qml BarWidget.qml` returned a single hit
  (`readonly property color surface: Color.popups.background`); the popup
  background is painted by `KeyboardPanel`'s card
  (`/usr/share/omarchy/shell/Ui/KeyboardPanel.qml:385`).
- **Impact:** Dead state; mild noise.
- **Recommendation:** Remove it.
- **Fix applied:** Deleted the property. `rg -n 'surface' Panel.qml` now returns
  no matches, and `qmllint`'s `missing-property` count dropped from 22 to 21
  (the `Color.popups.background` warning is gone).
- **Status:** Fixed (uncommitted, this cycle).

#### F-07 — Unused `qs.Commons` import in `BarWidget.qml` — **Fixed**

- **Severity:** Low
- **Category:** Code quality (dead code)
- **Location:** `BarWidget.qml:1-5` (the import block; the unused `qs.Commons` import was removed)
- **Evidence:** The original `qmllint` run reported an `Unused import
  [unused-imports]` warning on the `qs.Commons` line.
  `rg -n 'Style\.|Color\.' BarWidget.qml` returned no matches;
  `GitHubMark.qml` imports `qs.Commons` itself.
- **Impact:** None functional.
- **Recommendation:** Drop the import.
- **Fix applied:** Removed `import qs.Commons` (`BarWidget.qml:1-5` now imports
  `QtQuick`, `Quickshell`, `Quickshell.Io`, `qs.Ui`, and `"Model.js"`). Confirmed
  nothing from it was used. `qmllint` reports the `[unused-imports]` info no
  longer (34→33 infos).
- **Status:** Fixed (uncommitted, this cycle).

#### F-08 — No `pragma ComponentBehavior: Bound`; 34 unqualified-access warnings

- **Severity:** Low
- **Category:** Code quality (QML forward-compatibility)
- **Location:** `BarWidget.qml:277-283`; `Panel.qml:221-228, 269-277, 320-361, 417-489`
- **Evidence:** `qmllint` emits 34 `[unqualified]` warnings, e.g.
  `BarWidget.qml:280:22: Unqualified access ... lit: root.hasNotifications` and
  `Panel.qml:426:20: Unqualified access ... root.cursorActive`, each with
  `Info: Set "pragma ComponentBehavior: Bound" ...`. Inline components and
  `Component {}` bodies read outer ids (`root`, `button`, `hero`, `rowsColumn`,
  `previousButton`) without `required` properties.
- **Impact:** Benign today (the code is correct, and upstream shares the
  pattern: 15 warnings on `panels/weather/BarWidget.qml`, 71 on
  `panels/dropbox/Panel.qml`). It is a forward-compatibility/maintainability
  smell, not a bug.
- **Recommendation:** Optionally add `pragma ComponentBehavior: Bound` and pass
  outer ids as `required property`, or leave as-is for upstream consistency.
- **Status:** Open — this cycle.

#### F-09 — README "Files" table omitted significant shipped files — **Fixed**

- **Severity:** Low
- **Category:** Professionalism (documentation)
- **Location:** `README.md:182-195` (the `## Files` heading and table)
- **Evidence:** The table listed `manifest.json`, `BarWidget.qml`, `Panel.qml`,
  `GitHubMark.qml`, `assets/github.svg`, `Model.js`, `test-model.js`, but omitted
  `pagination-specs.md` (908 lines, cited by the code comments), `screenshots/`
  (referenced at `README.md:5-10`), `LICENSE`, and the README itself.
- **Impact:** A reader could not discover the pagination spec or the screenshots
  from the file map.
- **Recommendation:** Add the missing tracked docs/assets (but not `review.md`,
  which is a one-off review artifact and not part of the plugin).
- **Fix applied:** Added rows for `pagination-specs.md`, `screenshots/`, and
  `LICENSE` at `README.md:193-195`; updated the `Model.js` role to mention URL
  safety and the `test-model.js` row to "50 tests" (`README.md:191-192`) so the
  count matches the suite.
- **Status:** Fixed (uncommitted, this cycle).

#### F-10 — No URL scheme validation before opening links (defence in depth) — **Fixed**

- **Severity:** Low
- **Category:** Security
- **Location:** `Panel.qml:89-99` (`openUrl`/`openRepo`/`openSubject`); `Model.js:514-549` (`apiToWebUrl`/`repoLink`/`subjectLink`)
- **Evidence:** `openUrl` forwarded any non-empty string to
  `Quickshell.execDetached(["omarchy-launch-browser", url])`; `apiToWebUrl`
  returns `""` for non-GitHub shapes but `subjectLink`/`repoLink` fall back to the
  raw URL. The probe in §4.6 shows `file:///etc/passwd`, `javascript:alert(1)`,
  `data:text/html,...` and `-flag` all passed through. No shell injection was
  possible (the launcher receives a single argv element), but option-like strings
  and foreign schemes reached the launcher.
- **Impact:** Theoretical (provenance is the authenticated GitHub API), but
  cheap to eliminate.
- **Recommendation:** Gate on an explicit absolute-`http(s)` check.
- **Fix applied:** Added `Model.isSafeUrl(url)` — `/^https?:\/\/[^\s]+$/i`
  (`Model.js:551-557`) — and exported it (`Model.js:786`); `Panel.openUrl` now
  launches only when it returns true (`Panel.qml:89-92`); one new unit test
  covers valid https/http and rejects `file:`, `javascript:`, `data:`, `ftp:`,
  `-flag`, whitespace-containing, empty, `undefined`, and `null` inputs
  (`test-model.js:597-614`, ending at its closing `});`). `api` and `web`
  subject links still work (existing
  link tests unchanged). See §4.8 for the fail-on-old / pass-on-new evidence.
- **Status:** Fixed (uncommitted, this cycle).

#### F-11 — Test coverage is model-only; no QML/UI tests

- **Severity:** Low
- **Category:** Code quality (testing)
- **Location:** `test-model.js` (whole file); `BarWidget.qml`, `Panel.qml`
- **Evidence:** `test-model.js` exercises `Model.js` only. The QML layer is
  untested: `BarWidget.loadPage`/`pendingPage`/stall timer/IPC broadcast, and
  `Panel` cursor/scroll/pagination gating. Several exports are still only
  exercised indirectly or not at all: `clampIntervalSeconds`,
  `notificationsPageUrl`, and the interval constants are never named in tests.
  (`clampIntervalSeconds` was probed manually and behaves correctly:
  `"abc"|0|-5 → 300`, `30 → 60`, `99999 → 3600`.)
- **Impact:** The duplicate-fetch (F-01) and timeout-overwrite (F-03) lived in
  the untested layer. Model coverage itself is excellent; the count is now 50.
- **Recommendation:** Add direct tests for `clampIntervalSeconds` and
  `notificationsPageUrl`; if feasible, a lightweight QML harness.
- **Status:** Open — this cycle.

### Informational

#### F-12 — `pagination-specs.md` showcases `P = 10` while the implementation uses `PAGE_SIZE = 5`

- **Severity:** Informational
- **Category:** Professionalism (documentation clarity)
- **Location:** `pagination-specs.md:8-11, 49-50, 66, 83-84, 107-108, 420, 503`;
  `Model.js:25` (`PAGE_SIZE = 5`)
- **Evidence:** The spec's headers say "Showcase parameters used in every
  example: page size `P = 10`", and the conformance tables are labelled
  `(P = 10)`, while `Model.js` fixes `PAGE_SIZE = 5` (the appendix
  `pagination-specs.md` §15.1 states `per_page=5`).
- **Impact:** None on correctness. The frame algorithm is independent of `P`
  (§14.1: "`P` only affects derived values, never the frame algorithm"), and the
  tests re-derive `T` from `PAGE_SIZE`.
- **Recommendation:** Add a top-of-file pointer to the appendix, or regenerate
  the examples at `P = 5`.
- **Status:** Open — informational.

#### F-13 — `manageIpc: false` is a no-op here, and its comment overstates the reason

- **Severity:** Informational
- **Category:** Code quality
- **Location:** `Panel.qml:19-23`; `/usr/share/omarchy/shell/Ui/Panel.qml:15, 48-50`
- **Evidence:** The panel sets `manageIpc: false`, claiming a loaded `Panel`
  "would register a second handler for the same target and shadow the widget's".
  But this panel never sets `ipcTarget` (default `""`, `Ui/Panel.qml:15`), and the
  base handler is already disabled when `ipcTarget === ""` (`Ui/Panel.qml:49`).
  The choice matches every first-party panel (`agents`, `weather`, `clock`,
  `bluetooth`, `tailscale`, `dropbox`, `monitor`, `power`, `network`).
- **Impact:** None.
- **Recommendation:** Optional comment clarification only.
- **Status:** Open — informational.

#### F-14 — `keywords` manifest field is not used by the validator or first-party manifests

- **Severity:** Informational
- **Category:** Professionalism (manifest)
- **Location:** `manifest.json:9`
- **Evidence:** The plugin adds `"keywords": ["github","notifications","inbox",
  "gh","developer"]`. Neither `omarchy-plugin-validate` nor
  `PluginRegistry.validateManifest` inspects `keywords`, and no first-party
  manifest uses it.
- **Impact:** None; extra keys are ignored.
- **Recommendation:** Harmless; keep only if a future catalog consumes it.
- **Status:** Open — informational.

---

## 6. Security assessment

Each topic gets an explicit verdict even when safe. The remediation did not
change the security model beyond adding the F-10 URL gate.

### 6.1 Command injection via the page parameter — **SAFE**

`Model.ghCommand(page)` (`Model.js:74-92`) builds the only shell string in the
plugin, run through `bash -lc` (`ghArgv`, `Model.js:94-96`). The page value is
forced through `Math.floor(Number(page))` with a `!isFinite || < 1 → 1` guard, so
it is always a finite integer, interpolated inside the double-quoted query
string. The probe in §4.5 shows all hostile strings reduce to a plain integer.
The one non-integer (`1e21` → `1e+21`) is a number string with no shell
metacharacter and is unreachable through the production path, which passes
`Model.clampPage()` output (integer) via `BarWidget.loadPage`
(`BarWidget.qml:54-64`). Verdict: **SAFE**.

### 6.2 Sensitive-data disclosure — **SAFE / LOW**

No token is read, stored, or logged: authentication lives entirely in `gh`'s own
config, and `gh` is invoked without credentials on its argv. `console.log`/
`console.warn` (`BarWidget.qml:120,122,155`) print `Model.statusLine(view)` —
counts, page numbers, and repository *counts*, never notification titles, bodies,
URLs, or tokens. The retained state is exactly four fields per item
(`Model.normalizeItem`, `Model.js:224-242`; enforced by the test at
`test-model.js:297-311`). Verdict: **SAFE / LOW**.

### 6.3 Untrusted text rendering — **SAFE**

Every `Text` element in the plugin (7 in `Panel.qml:237,247,280,342,382,446,467`)
sets `textFormat: Text.PlainText`. `rg -n 'textFormat' *.qml` lists 7 hits and
`rg -n '^\s*Text\s*\{' *.qml` lists exactly those 7 elements, so no `Text` lacks
it. `GitHubMark.qml` uses no `Text`. Verdict: **SAFE**.

### 6.4 URL handling — **SAFE**

URLs are passed as a single argv element to
`Quickshell.execDetached(["omarchy-launch-browser", url])` (`Panel.qml:91`,
`BarWidget.qml:217`); no shell is involved. After F-10, `Panel.openUrl` launches
only when `Model.isSafeUrl(url)` is true (`Panel.qml:89-92`), i.e. only for an
absolute `http(s)` URL; `file:`, `javascript:`, `data:`, `ftp:`, option-like
`-flag`, relative, whitespace-containing, empty, and null values are refused
(`Model.js:551-557`). `omarchy-launch-browser` forwards the URL to the browser via
`uwsm-app` (still argv, no `eval`). Provenance is the authenticated GitHub API,
whose `subject.url` is always `api.github.com/...` and `repository.html_url`
always `https://github.com/...`; `subjectLinks: "web"` additionally rewrites
recognised shapes. Verdict: **SAFE**.

### 6.5 Network scope — **SAFE**

The only network I/O is the authenticated `gh api` calls to `api.github.com`
(`Model.js:77-91`), plus the user-initiated browser opening
`https://github.com/notifications` (`Model.js:559-561`) or a notification link.
There is no telemetry, no third-party endpoint, and no background connection.
Verdict: **SAFE**.

### 6.6 Resource bounds — **SAFE**

- stdout capped at 256 KiB + 1 (`MAX_STDOUT_BYTES = 262144`, `head -c 262145`)
  and rejected if over (`Model.js:290-298`);
- stderr capped at 8 KiB (`MAX_STDERR_BYTES = 8192`, `head -c 8192`);
- `PAGE_SIZE = 5` caps items per fetch and per view (`Model.js:25, 361-366`);
- string caps `MAX_NAME_CHARS=200`, `MAX_TITLE_CHARS=300`, `MAX_URL_CHARS=512`
  (`Model.js:35-37, 216-219`);
- JSON flattening depth cap of 4 (`Model.js:203-204`);
- no `--paginate`/`--slurp` (§4.7).

Verdict: **SAFE**.

### 6.7 Symlinks / manifest validation / reserved id — **SAFE**

`omarchy plugin validate .` exits 0. A direct
`find . -name .git -prune -o -type l -print` finds no symlinks. The id
`io.github.mrosati84.github-notifications` is not in the reserved `omarchy.*`
namespace and matches the validator's id regex. `schemaVersion` is the numeric
`1`; `kinds`, `entryPoints`, and `entryPoints.barWidget` are present and the
entry file exists. Verdict: **SAFE**.

### 6.8 `bash -lc` scope — **SAFE / INFORMATIONAL**

The command runs in a login shell so the user's `PATH` (and thus `gh`) is found.
Side effect: the user's shell startup files run once per fetch. That is the
documented trade-off (`README.md:27-28`) and is consistent with other Omarchy
plugins. No token or secret is placed in the shell string. Verdict:
**SAFE / INFORMATIONAL**.

---

## 7. Performance assessment

- **Polling cadence:** one `Timer` per bar-widget instance at
  `intervalSeconds` (default 300 s, clamped 60–3600 s;
  `BarWidget.qml:25, 164-172`). `triggeredOnStart: true` issues one fetch at
  load.
- **Per-monitor duplication:** a bar surface exists per output, so on a
  two-screen desktop there are two instances → two requests per interval
  (`README.md:175-177` states this). At 300 s that is 24 authenticated requests
  per hour per instance, far inside the 5,000/h authenticated budget.
- **Single fetch on open (F-01, fixed):** opening the panel now performs exactly
  one page-1 fetch. The duplicate refresh in `Panel.onOpenedChanged` was removed;
  `BarWidget.open()` is the sole refresher, and every open path (left click, IPC
  `open`/`show`, toggle-open, Tab switching via `switchPanelFrom`) funnels through
  it.
- **In-flight guard:** `loadPage` queues instead of starting a second `Process`
  (`BarWidget.qml:54-64`), so fetches are serialised by construction. The
  `pendingPage` slot is a single integer, so repeated clicks during a fetch cannot
  amplify beyond one extra fetch.
- **Stall timer:** 60 s hard cap, so a hung `gh` cannot wedge the widget; the
  timeout message now survives `onExited` (F-03).
- **Memory:** output buffers are capped; the view holds at most `PAGE_SIZE`
  items with truncated strings; `viewAfterFetch` replaces the whole view
  atomically; the `Repeater` rebuilds delegates on page change.
  `Loader { active: true }` (`BarWidget.qml:229-238`) keeps the panel loaded for
  the session (its `KeyboardPanel` `PanelWindow` exists but is hidden), matching
  upstream (`panels/weather/BarWidget.qml:56-65`). No growing accumulation was
  found.

Net: performance is sound.

---

## 8. Code quality assessment

**Strengths.** `Model.js` is genuinely pure (no QML, timers, or I/O) and both
runtimes load it via the `module.exports` guard (`Model.js:747-806`), which is
what makes the test suite possible. Naming is consistent and descriptive;
comments explain *why*, not just *what* (e.g. the clamp rationale at
`Model.js:184-192`, the page-race note at `BarWidget.qml:49-53`, the
"no unbounded-follow flags" note at `Model.js:69-73`). Failure classification
(`failureText`, `Model.js:246-283`) turns raw `gh` output into actionable
sentences and truncates to 160 chars. The pagination algorithm
(`Model.js:390-452`) is a faithful transcription of `pagination-specs.md` §9.

**Weaknesses (current):** (a) `checkedAt` is overloaded for success and failure,
mislabelling the footer (F-04). (b) Repository counting keys on a non-unique name
(F-05). (c) Inline components rely on outer-id capture without
`pragma ComponentBehavior: Bound` (F-08) — benign, upstream-consistent. (d) The
QML layer has no automated tests (F-11). The previously noted double-refresh
(F-01), clobbered stall error (F-03), dead `surface` (F-06), and unused import
(F-07) were fixed this cycle. No `TODO/FIXME/XXX/HACK` markers exist in source.

**Separation of concerns** is the strongest aspect: display strings, link
rewriting, URL safety, parsing, bounds, and pagination all live in `Model.js`;
the QML is presentation and state wiring.

**Maintainability/extensibility.** Good. Page size, window size, caps, and the
count sentinel are named constants; adding a new subject-link shape is a single
`apiToWebUrl` branch; the URL gate is a single pure predicate. The pagination
spec shipped alongside the code makes the intent auditable.

---

## 9. Professionalism / presentation assessment

- **README accuracy:** high after F-02 and F-09. Page size 5
  (`README.md:136,170` vs `Model.js:25`), caps 8 KiB/256 KiB (`:173`), "Only four
  fields" (`:22`), install/removal commands (`:34,56,63`), and the key map
  (`:113-125`) all match the code. The `subjectLinks` default is now genuinely
  "web" (`README.md:75-109`, `BarWidget.qml:28`), and the Files table lists
  `pagination-specs.md`, `screenshots/`, and `LICENSE` (`README.md:190-195`) with
  the test count corrected to 50 (`:192`). The key map lists `←→` but not `h`/`l`,
  which `PanelKeyCatcher` also accepts (`Ui/PanelKeyCatcher.qml:65-70`) — an
  omission, not an error.
- **Install/removal commands verified:** `omarchy plugin add` accepts
  `[git-url] [--enable] [--yes]`, and `omarchy bar move <id> --section right` is
  valid (`omarchy bar move --help`). `omarchy plugin validate` exists as
  documented.
- **manifest.json:** complete and schema-valid; `schemaVersion: 1`, id, name,
  version, author, license, description, `kinds`, `entryPoints.barWidget`,
  `barWidget` metadata with `defaults` and a two-entry `schema`. The extra
  `keywords` key is unused (F-14).
- **LICENSE:** MIT, `Copyright (c) 2026 Matteo Rosati`.
- **Repo hygiene:** `.gitignore` ignores only `.opencode/goal.md`; `.opencode/`
  is untracked; screenshots are referenced by the README and present; no build
  artifacts. `review.md` is an untracked review artifact and is deliberately not
  part of the shipped file map. The remediation edits are uncommitted.
- **Consistency with upstream:** `Loader`-hosted `Panel` with `hostWidget`
  injection mirrors `panels/weather/BarWidget.qml`; `manageIpc: false` matches
  every first-party panel; `KeyboardPanel`/`PanelKeyCatcher`/`CursorSurface`/
  `PanelActionButton`/`PanelHero` are used as intended.
- **Versioning:** `1.0.0`, single `bar-widget` kind, `allowMultiple: false`,
  `defaultSection: right` — sensible.

**F-12** (P=10 examples vs P=5 implementation) remains a presentation wrinkle,
not a defect.

---

## 10. Positive findings & strengths

- **No Critical or High security findings**, before or after remediation.
- **Command injection provably absent** for hostile inputs (§4.5), with a
  defence-in-depth `Math.floor(Number(...))` + finite/clamp guard.
- **All untrusted text is `Text.PlainText`** (7/7 `Text` elements).
- **Browser launches are now scheme-gated** (`Model.isSafeUrl`), with unit tests.
- **Strong, honest test suite:** 50 deterministic tests, 0 failures, including
  pagination conformance tables (A/B/C/C-2/D), an invariant sweep for T=1..120, a
  mirror-symmetry check with the documented (9,5) exception, and a live
  authenticated `gh` round-trip that actually ran (97 unread).
- **Every external read is bounded** (`head -c` caps, `PAGE_SIZE`, string
  truncation, JSON depth cap) with no paginate/slurp.
- **Clean pure-logic separation** (`Model.js` usable from both QML and Node) —
  the foundation of the testability.
- **Passes the official validator** and `qmllint` with exit 0.
- **No symlinks, reserved-id, or artifact issues;** no `TODO/FIXME` markers; the
  internal goal file is correctly gitignored.
- **Clear, purpose-written comments** explaining rationale and trade-offs.

---

## 11. Remediation status / prioritised action list

Remediation applied this cycle (working-tree edits, not committed):

| ID | Sev | Previous status | New status | Change |
|---|---|---|---|---|
| F-01 | Medium | Open | **Fixed** | Removed duplicate `refreshNow()` from `Panel.onOpenedChanged` (`Panel.qml:138-148`); `BarWidget.open()` is the single refresh owner. |
| F-02 | Medium | Open | **Fixed** | `subjectLinks` fallback → `web` (`BarWidget.qml:28`, `Panel.qml:41`). |
| F-03 | Medium | Open | **Fixed** | Added `stalled` flag guarding `onExited` (`BarWidget.qml:40,61,109-115,153`). |
| F-06 | Low | Open | **Fixed** | Removed unused `surface` property (`Panel.qml`). |
| F-07 | Low | Open | **Fixed** | Removed unused `import qs.Commons` (`BarWidget.qml`). |
| F-09 | Low | Open | **Fixed** | Added `pagination-specs.md`, `screenshots/`, `LICENSE` to the README Files table; test count 49→50 (`README.md:190-195`). |
| F-10 | Low | Open | **Fixed** | Added `Model.isSafeUrl` (`Model.js:551-557,786`), gated `Panel.openUrl` (`Panel.qml:89-92`), added a unit test (`test-model.js:597-614`). |

Remaining open items (documented, not addressed this cycle):

| ID | Sev | Category | Item |
|---|---|---|---|
| F-04 | Low | Code quality | "Last good check" uses the failed attempt's time. |
| F-05 | Low | Code quality | Repository counting merges same-named repos across owners. |
| F-08 | Low | Code quality | No `pragma ComponentBehavior: Bound` (34 unqualified warnings). |
| F-11 | Low | Code quality | Model-only tests; no QML/UI tests. |
| F-12 | Informational | Professionalism | Spec examples P=10 vs implementation P=5. |
| F-13 | Informational | Code quality | `manageIpc: false` no-op; comment overstates. |
| F-14 | Informational | Professionalism | `keywords` manifest field unused. |

No commit was made. `git status --porcelain` after remediation:

```
 M BarWidget.qml
 M Model.js
 M Panel.qml
 M README.md
 M test-model.js
?? review.md
```

---

## 12. Conclusion / disclosure sign-off

The plugin is ready for public disclosure. Its security model is sound and
demonstrated: the single shell command cannot be injected through the page
parameter, no sensitive data is logged or rendered, all displayed text is plain
text, browser launches are now restricted to absolute `http(s)` URLs, the network
surface is limited to authenticated `gh api` calls against `api.github.com`, and
every buffer is bounded and capped. The official validator and `qmllint` both
pass, the test suite passes with 50 tests and a live round-trip, and the
repository has no symlinks or build artifacts.

There are **no Critical and no High findings**. The three Medium findings
(F-01 doubled fetch on open, F-02 `subjectLinks` default mismatch, F-03
overwritten stall-timeout message) were fixed and verified this cycle, along with
four Low findings (F-06, F-07, F-09, F-10). The remaining open Low/Informational
items (F-04, F-05, F-08, F-11, F-12, F-13, F-14) are quality, coverage, and
documentation improvements that do not block disclosure.

**Disclosure sign-off:** approved. No plugin source was committed; the fixes and
this review are working-tree changes only.
