# GitHub Notifications

Unread GitHub notifications in the Omarchy bar, read through the `gh` CLI.

The GitHub mark is **lit** while `gh api notifications` has something for you
and **dimmed** while the inbox is quiet. Clicking it opens the list, where every
notification offers two separate links: the repository name and the subject
title.

```
gh api notifications  ──►  one bar icon  ──►  one panel
 (every 5 minutes)          lit / unlit         repo + subject links
```

Only four fields of the API answer are used, exactly as specified:
`repository.name`, `repository.html_url`, `subject.title`, `subject.url`.

## Requirements

- `gh` on `PATH` and signed in: `gh auth status` should succeed.
  The widget runs `gh` through `bash -lc`, so the login-shell `PATH` applies.
- Nothing else. No token is stored by this plugin; `gh` keeps its own.

## Install

```bash
omarchy plugin add https://github.com/mrosati84/github-notifications.git --enable
```

`--enable` also adds it to the bar's `right` section. Drop the flag to add it
without enabling, and enable it later from your own config:

```bash
omarchy plugin enable io.github.mrosati84.github-notifications
omarchy bar move io.github.mrosati84.github-notifications --section right   # optional
```

To move it to another bar section:

```bash
omarchy bar move io.github.mrosati84.github-notifications --section right
```

## Removal

Disable it to stop it and drop it from the bar:

```bash
omarchy plugin disable io.github.mrosati84.github-notifications
```

Delete it entirely (removes
`~/.config/omarchy/plugins/io.github.mrosati84.github-notifications`):

```bash
omarchy plugin remove io.github.mrosati84.github-notifications
```

## Settings

Settings live inline on the widget's entry in `~/.config/omarchy/shell.json`.
Edit the file (it hot-reloads) or use the Settings panel.

```json
{
  "id": "io.github.mrosati84.github-notifications",
  "intervalSeconds": 300,
  "subjectLinks": "web"
}
```

| Setting           | Default | Meaning                                                              |
| ----------------- | ------- | -------------------------------------------------------------------- |
| `intervalSeconds` | `300`   | How often the widget checks. Clamped to 60–3600.                     |
| `subjectLinks`    | `"web"` | Where the subject title opens. See below.                            |

### `subjectLinks`: the one thing worth deciding

`subject.url` from the API is an **api.github.com** URL, not a web page, and two
things go wrong when a browser opens one:

- It shows raw JSON — and 404 JSON for a private repository, because a browser
  request carries no token.
- It is an **unauthenticated** request, so it is charged to the 60 requests per
  hour that GitHub grants per _IP address_, not per user. Authenticated calls —
  `gh`, which this widget's polling already uses — get 5,000 per hour. See
  [rate limits for the REST API](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api).
  On a shared or office IP that anonymous budget is shared with everyone else on
  the address, so a handful of clicks can already read as rate limited.

| Value                                             | A click opens                                       | API cost            |
| ------------------------------------------------- | --------------------------------------------------- | ------------------- |
| `"web"` (recommended, and the default)            | `https://github.com/OWNER/REPO/issues/42`           | none                |
| `"api"`                                           | `https://api.github.com/repos/OWNER/REPO/issues/42` | 1 anonymous request |

Issues, pull requests, discussions, releases, commits and check suites are
rewritten; anything unrecognised falls back to the URL `gh` returned. The
repository link is unaffected: `repository.html_url` is already a web page.

```json
{ "id": "io.github.mrosati84.github-notifications", "subjectLinks": "web" }
```

## Using it

| Input               | Effect                                       |
| ------------------- | -------------------------------------------- |
| left click          | open / close the list                        |
| middle click        | check right now                              |
| right click         | open github.com/notifications in the browser |
| `↑` `↓` / `j` `k`   | move the row cursor                          |
| `←` `→`             | scroll the list                              |
| `Enter` / `Space`   | open the subject of the cursor row           |
| `o`                 | open the repository of the cursor row        |
| `r`                 | check right now                              |
| `Esc`               | close                                        |
| `Tab` / `Shift+Tab` | next / previous panel in the bar             |

Hovering a row moves the same cursor the keyboard uses, so there is only ever
one highlighted row. The repository line and the subject line are separate click
targets inside it.

Clicking a link leaves the panel open on purpose, so both links of a row can be
used in one visit.

## IPC

```bash
omarchy-shell io.github.mrosati84.github-notifications toggle
omarchy-shell io.github.mrosati84.github-notifications open
omarchy-shell io.github.mrosati84.github-notifications close
omarchy-shell io.github.mrosati84.github-notifications refresh
```

## Behaviour details

- **One gh call per instance, never overlapping.** A check is skipped while the
  previous one is still in flight. A call that does not answer within 60 s is
  cut loose and reported, so the widget can never wedge on a hung process.
- **Notifications are not marked as read.** This widget only reads.
- **A failed check keeps the last list.** The panel shows the error, labels the
  list as stale ("Showing the last list that loaded", "Last good check 21:45")
  and leaves the icon's lit state alone until a check succeeds.
- **The default command is `gh api notifications --paginate --slurp`.** Inboxes
  bigger than one page (GitHub's default page is 30) are counted whole; the
  slurped pages are flattened in `Model.js`.
- **The bar exists per monitor**, so on a two-screen desktop the check runs once
  per instance. Two requests every five minutes is well inside the API rate
  limit, and each instance keeps its own panel state.
- **Errors are translated.** "not installed", "not authenticated (run
  `gh auth login`)", "rate limit reached", "could not reach github.com", HTTP
  401/404/5xx each get their own sentence instead of a raw stack of text.

## Files

| File                | Role                                                                    |
| ------------------- | ----------------------------------------------------------------------- |
| `manifest.json`     | plugin manifest (`bar-widget`, entry point, settings schema)            |
| `BarWidget.qml`     | polling (Timer + Process), bar icon, click handling, IPC target         |
| `Panel.qml`         | the popup: header, notification rows with two links each, footer        |
| `GitHubMark.qml`    | the SVG mark, tinted to the theme, lit or dimmed                        |
| `assets/github.svg` | the GitHub mark itself (white; tinted at render time)                   |
| `Model.js`          | pure logic: parsing, link rewriting, failure text, display strings      |
| `test-model.js`     | node self-check for `Model.js` (32 tests, includes one live round-trip) |

## Testing

```bash
cd ~/.config/omarchy/plugins/io.github.mrosati84.github-notifications
node test-model.js          # pure logic + a live `gh api notifications` round-trip
omarchy plugin validate .
```

The live test skips itself, rather than failing, when `gh` is missing or not
signed in.

## Editing it

`BarWidget.qml` and `Panel.qml` hot-reload when saved. `GitHubMark.qml` does
**not**: it is loaded as a QML type and the type cache survives a plugin reload,
so changes to it need `omarchy restart shell` before they show up. Same for
`assets/github.svg`.

## License

MIT
