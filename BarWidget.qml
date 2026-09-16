import QtQuick
import Quickshell
import Quickshell.Io
import qs.Commons
import qs.Ui
import "Model.js" as Model

// GitHub Notifications - unread GitHub notifications in the Omarchy bar.
//
// One bounded `gh api notifications` fetch (one page of 5, plus a one-item
// count probe for the exact total) every `intervalSeconds` (300 by default)
// feeds one icon: the GitHub mark is lit while there is something unread and
// dimmed while the inbox is quiet. Clicking it opens the list, where the
// repository and the subject of every notification are separate clickable
// links.
//
// Polling lives here, never in the panel: one Timer and one reusable Process,
// so at most one gh fetch is ever in flight. The panel mirrors `view`, can ask
// for a specific page, and a page request that arrives mid-fetch queues as
// `pendingPage` instead of starting a second process.
BarWidget {
    id: root
    moduleName: "io.github.mrosati84.github-notifications"

    // ---- settings (inline on this widget's shell.json entry) ----------------
    readonly property int intervalSeconds: Model.clampIntervalSeconds(root.setting("intervalSeconds", Model.DEFAULT_INTERVAL_SECONDS))
    // "api" opens subject.url exactly as gh returns it; "web" rewrites it to the
    // matching github.com page. See README.md.
    readonly property string subjectLinkMode: String(root.setting("subjectLinks", "api")) === "web" ? "web" : "api"

    // ---- state --------------------------------------------------------------
    property var view: Model.initialView()
    // The page the running (or next) fetch is for, and the page a click asked
    // for while a fetch was already in flight. Both are plain numbers; the page
    // in `view` is only ever the page that actually came back.
    property int requestedPage: 1
    property int pendingPage: 0

    // The panel reads this to grey out pagination while a fetch is in flight.
    readonly property bool busy: proc.running
    readonly property int count: Model.countOf(root.view)
    readonly property bool hasNotifications: Model.hasNotifications(root.view)
    readonly property bool opened: panelLoader.item ? panelLoader.item.opened === true : false

    // ---- polling & paging ---------------------------------------------------
    // Start a fetch for page `k`, clamped into 1..totalPages. The command is
    // assigned explicitly before the run starts, so the page number can never
    // race the process. A request that arrives while a fetch is in flight is
    // remembered in `pendingPage` and taken up when the process exits, so at
    // most one gh call is ever in flight.
    function loadPage(k) {
        if (proc.running) {
            root.pendingPage = k;
            return;
        }
        var target = Model.clampPage(k, root.view.totalPages || 1);
        root.requestedPage = target;
        proc.command = Model.ghArgv(target);
        proc.running = true;
    }

    // A full check always returns to the first page.
    function refresh() {
        root.loadPage(1);
    }

    // BarWidget.broadcast() target, so an IPC refresh reaches every bar instance
    // instead of only the one that owns the IPC target.
    function refreshNow() {
        root.refresh();
    }

    function goToPage(k) {
        root.loadPage(k);
    }

    // Both no-op at their boundary, as the spec requires: a disabled chevron
    // must never navigate (and must not spend a fetch re-loading the same page).
    function previousPage() {
        if (Model.canPreviousPage(root.view.page))
            root.goToPage(root.view.page - 1);
    }

    function nextPage() {
        if (Model.canNextPage(root.view.page, root.view.totalPages))
            root.goToPage(root.view.page + 1);
    }

    Process {
        id: proc
        // No `command:` binding: `loadPage()` assigns the argv for the exact
        // page immediately before it sets `running`, so the page fetch cannot
        // race the run.
        stdout: StdioCollector {
            id: ghStdout
            waitForEnd: true
        }
        stderr: StdioCollector {
            id: ghStderr
            waitForEnd: true
        }
        onRunningChanged: if (running)
            stallTimer.restart()
        onExited: function (exitCode) {
            stallTimer.stop();
            var result = Model.parseNotifications(exitCode, ghStdout.text, ghStderr.text, root.requestedPage);
            root.view = Model.viewAfterFetch(root.view, result, Date.now());
            var line = "GitHub Notifications: " + Model.statusLine(root.view);
            if (root.view.status === "error")
                console.warn(line + " - " + root.view.error);
            else
                console.log(line);

            // If the requested page fell past the end, the parser clamped the
            // result to the last page, so go and show that page. Otherwise, if a
            // click was queued while this fetch ran, take it up now. Both go
            // through Qt.callLater, and loadPage() refuses to start while a
            // process is running, so a queued navigation can never race a fetch.
            if (result.ok && result.page !== root.requestedPage) {
                var clamped = result.page;
                Qt.callLater(function () {
                    root.loadPage(clamped);
                });
            } else if (root.pendingPage > 0) {
                var pending = root.pendingPage;
                root.pendingPage = 0;
                Qt.callLater(function () {
                    root.loadPage(pending);
                });
            }
        }
    }

    // A gh call that never returns would hold the widget at its last reading
    // until the shell restarts, since a Process already running can not be
    // restarted. Cut it loose and say so in the panel.
    Timer {
        id: stallTimer
        interval: 60000
        onTriggered: {
            if (!proc.running)
                return;
            proc.running = false;
            console.warn("GitHub Notifications: gh did not answer within a minute");
            root.view = Model.viewAfterFetch(root.view, {
                ok: false,
                items: [],
                error: "gh did not answer within a minute."
            }, Date.now());
        }
    }

    Timer {
        interval: root.intervalSeconds * 1000
        running: true
        repeat: true
        triggeredOnStart: true
        // Keep the user's current page on a periodic tick; only an explicit
        // refresh (open, middle click, IPC) returns to page 1.
        onTriggered: root.loadPage(root.view.page || 1)
    }

    // ---- panel --------------------------------------------------------------
    function open() {
        if (panelLoader.item)
            panelLoader.item.open();
        root.refresh();
    }

    function close() {
        if (panelLoader.item)
            panelLoader.item.close();
    }

    function togglePanel() {
        if (root.opened)
            root.close();
        else
            root.open();
    }

    function closeForPopoutSwitch() {
        if (panelLoader.item && typeof panelLoader.item.closeForPopoutSwitch === "function")
            panelLoader.item.closeForPopoutSwitch();
    }

    function injectPanel() {
        var target = panelLoader.item;
        if (!target)
            return;
        if ("bar" in target)
            target.bar = root.bar;
        if ("settings" in target)
            target.settings = root.settings;
        if ("anchorItem" in target)
            target.anchorItem = button;
        if ("hostWidget" in target)
            target.hostWidget = root;
    }

    onBarChanged: injectPanel()
    onSettingsChanged: injectPanel()

    // ---- interaction --------------------------------------------------------
    function openNotificationsPage() {
        Quickshell.execDetached(["omarchy-launch-browser", Model.notificationsPageUrl()]);
    }

    function handlePressed(buttonCode) {
        if (buttonCode === Qt.MiddleButton)
            root.refresh();
        else if (buttonCode === Qt.RightButton)
            root.openNotificationsPage();
        else
            root.togglePanel();
    }

    Loader {
        id: panelLoader
        active: true
        source: Qt.resolvedUrl("Panel.qml")
        visible: false
        onLoaded: {
            root.injectPanel();
            Qt.callLater(root.injectPanel);
        }
    }

    IpcHandler {
        target: root.moduleName

        function open(): void {
            root.open();
        }
        function close(): void {
            root.close();
        }
        function show(): void {
            root.open();
        }
        function hide(): void {
            root.close();
        }
        function toggle(): void {
            root.togglePanel();
        }
        function refresh(): string {
            root.broadcast("refreshNow");
            return "ok";
        }
    }

    implicitWidth: button.implicitWidth
    implicitHeight: button.implicitHeight

    BarIconButton {
        id: button
        anchors.fill: parent
        bar: root.bar
        hasVisualContent: true
        tooltipText: Model.tooltip(root.view)
        onPressed: function (buttonCode) {
            root.handlePressed(buttonCode);
        }

        iconComponent: Component {
            GitHubMark {
                anchors.fill: parent
                lit: root.hasNotifications
                color: button.foreground
            }
        }
    }
}
