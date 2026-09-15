import QtQuick
import Quickshell
import Quickshell.Io
import qs.Commons
import qs.Ui
import "Model.js" as Model

// GitHub Notifications - unread GitHub notifications in the Omarchy bar.
//
// One `gh api notifications` call every `intervalSeconds` (300 by default)
// feeds one icon: the GitHub mark is lit while there is something unread and
// dimmed while the inbox is quiet. Clicking it opens the list, where the
// repository and the subject of every notification are separate clickable
// links.
//
// Polling lives here, never in the panel: one Timer and one reusable Process,
// so at most one gh call is ever in flight. The panel mirrors `view` and can
// only ask this widget to refresh.
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

    readonly property int count: Model.countOf(root.view)
    readonly property bool hasNotifications: Model.hasNotifications(root.view)
    readonly property bool opened: panelLoader.item ? panelLoader.item.opened === true : false

    // ---- polling ------------------------------------------------------------
    function refresh() {
        if (proc.running)
            return;
        proc.running = true;
    }

    // BarWidget.broadcast() target, so an IPC refresh reaches every bar instance
    // instead of only the one that owns the IPC target.
    function refreshNow() {
        root.refresh();
    }

    Process {
        id: proc
        command: Model.ghArgv()
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
            var result = Model.parseNotifications(exitCode, ghStdout.text, ghStderr.text);
            root.view = Model.viewAfterFetch(root.view, result, Date.now());
            var line = "GitHub Notifications: " + Model.statusLine(root.view);
            if (root.view.status === "error")
                console.warn(line + " - " + root.view.error);
            else
                console.log(line);
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
        onTriggered: root.refresh()
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
