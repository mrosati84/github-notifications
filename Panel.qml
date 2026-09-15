import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import Quickshell
import qs.Commons
import qs.Ui
import "Model.js" as Model

// The GitHub Notifications popup: the list behind the bar icon.
//
// The widget owns polling and state; this panel only mirrors `hostWidget.view`
// and asks the widget to refresh, so the icon and the list can never disagree.
// Every row offers two separate links - the repository name and the subject
// title - and the arrow keys move a cursor that both mouse hover and keyboard
// driving share, so exactly one row is ever highlighted.
Panel {
    id: root
    moduleName: "io.github.mrosati84.github-notifications"
    // The bar widget owns the plugin's IPC target (it is the thing that lives for
    // the whole session), so this panel registers no handler of its own. It still
    // has to say so: a loaded Panel with manageIpc left at its default would
    // register a second handler for the same target and shadow the widget's.
    manageIpc: false

    property var anchorItem: null
    property var hostWidget: null

    property bool cursorActive: false
    property int focusIndex: 0

    readonly property color foreground: bar ? bar.foreground : Color.foreground
    readonly property color dim: Qt.darker(foreground, 1.5)
    readonly property color accent: Color.accent
    readonly property color warn: bar ? bar.urgent : Color.urgent
    readonly property color surface: Color.popups.background
    readonly property string fontFamily: bar ? bar.fontFamily : Style.font.family

    readonly property var view: hostWidget && hostWidget.view ? hostWidget.view : Model.initialView()
    readonly property var items: root.view.items || []
    readonly property int rowCount: root.items.length
    readonly property bool isError: Model.isError(root.view)
    readonly property string linkMode: hostWidget ? hostWidget.subjectLinkMode : "api"
    readonly property var focusedItem: root.rowCount > 0 ? root.items[Math.min(root.focusIndex, root.rowCount - 1)] : null

    function open() {
        root.controller.show();
    }
    function close() {
        root.controller.hide();
    }
    function refreshNow() {
        if (hostWidget && typeof hostWidget.refreshNow === "function")
            hostWidget.refreshNow();
    }

    // Both links go through the Omarchy browser launcher rather than xdg-open, so
    // an already-open browser gets the URL in a new tab.
    function openUrl(url) {
        if (url && url !== "")
            Quickshell.execDetached(["omarchy-launch-browser", url]);
    }

    function openRepo(item) {
        root.openUrl(Model.repoLink(item));
    }
    function openSubject(item) {
        root.openUrl(Model.subjectLink(item, root.linkMode));
    }
    function activateFocused() {
        root.openSubject(root.focusedItem);
    }
    function openFocusedRepo() {
        root.openRepo(root.focusedItem);
    }

    function setRowCursor(index) {
        root.cursorActive = true;
        root.focusIndex = index;
    }

    function moveCursor(step) {
        if (root.rowCount === 0)
            return;
        root.cursorActive = true;
        root.focusIndex = ((root.focusIndex + step) % root.rowCount + root.rowCount) % root.rowCount;
        root.scrollToFocused();
    }

    // Rows are one or two lines tall, so the offset is measured from the row
    // itself instead of assumed from an index.
    function scrollToFocused() {
        var row = rows.itemAt(root.focusIndex);
        if (!row)
            return;
        var top = row.y;
        var bottom = top + row.height;
        if (top < flick.contentY)
            flick.contentY = top;
        else if (bottom > flick.contentY + flick.height)
            flick.contentY = Math.min(bottom - flick.height, Math.max(0, flick.contentHeight - flick.height));
    }

    function scrollBy(delta) {
        flick.contentY = Math.max(0, Math.min(flick.contentY + delta, Math.max(0, flick.contentHeight - flick.height)));
    }

    onOpenedChanged: {
        if (!opened)
            return;
        root.cursorActive = false;
        root.focusIndex = 0;
        root.refreshNow();
        Qt.callLater(function () {
            keyCatcher.forceActiveFocus();
        });
    }

    KeyboardPanel {
        id: popup
        anchorItem: root.anchorItem
        owner: root.hostWidget || root
        bar: root.bar
        open: root.opened
        focusTarget: keyCatcher
        contentWidth: popup.fittedContentWidth(Style.space(380))
        contentHeight: popup.fittedContentHeight(column.implicitHeight, Style.space(620))

        PanelKeyCatcher {
            id: keyCatcher
            anchors.fill: parent

            onMoveRequested: function (dx, dy) {
                if (dy !== 0)
                    root.moveCursor(dy);
                else if (dx !== 0)
                    root.scrollBy(dx * Style.space(48));
            }
            onActivateRequested: root.activateFocused()
            onCloseRequested: root.close()
            onTabRequested: function (direction) {
                root.switchPanel(direction);
            }
            onTextKey: function (t) {
                if (t === "o" || t === "O")
                    root.openFocusedRepo();
                else if (t === "r" || t === "R")
                    root.refreshNow();
            }

            Flickable {
                id: flick
                anchors.fill: parent
                contentWidth: width
                contentHeight: column.implicitHeight
                clip: true
                boundsBehavior: Flickable.StopAtBounds
                flickableDirection: Flickable.VerticalFlick
                interactive: contentHeight > height
                ScrollBar.vertical: ScrollBar {
                    policy: ScrollBar.AsNeeded
                }

                Column {
                    id: column
                    width: flick.width
                    spacing: Style.space(10)

                    PanelHero {
                        id: hero
                        width: parent.width
                        title: "GitHub notifications"
                        meta: Model.heroMeta(root.view)
                        detail: Model.statusPill(root.view)
                        foreground: root.foreground
                        fontFamily: root.fontFamily

                        iconComponent: Component {
                            GitHubMark {
                                width: hero.iconSize
                                height: hero.iconSize
                                lit: root.rowCount > 0
                                color: root.foreground
                            }
                        }
                    }

                    // ---- a failed check says so, and never hides the last list -------
                    Column {
                        visible: root.isError
                        width: parent.width
                        spacing: Style.space(2)

                        Text {
                            width: parent.width
                            textFormat: Text.PlainText
                            text: root.view.error
                            color: root.warn
                            font.family: root.fontFamily
                            font.pixelSize: Style.font.bodySmall
                            wrapMode: Text.WordWrap
                        }

                        Text {
                            width: parent.width
                            visible: text !== ""
                            textFormat: Text.PlainText
                            text: Model.errorHint(root.view)
                            color: root.dim
                            font.family: root.fontFamily
                            font.pixelSize: Style.font.caption
                            wrapMode: Text.WordWrap
                        }
                    }

                    PanelSeparator {
                        visible: root.rowCount > 0
                        foreground: root.foreground
                    }

                    Column {
                        id: rowsColumn
                        width: parent.width
                        spacing: Style.space(2)

                        Repeater {
                            id: rows
                            model: root.items
                            delegate: NotificationRow {
                                width: rowsColumn.width
                                rowIndex: index
                                item: modelData
                            }
                        }
                    }

                    Text {
                        visible: root.rowCount === 0
                        width: parent.width
                        textFormat: Text.PlainText
                        text: Model.emptyText(root.view)
                        color: root.dim
                        font.family: root.fontFamily
                        font.pixelSize: Style.font.body
                        horizontalAlignment: Text.AlignHCenter
                        wrapMode: Text.WordWrap
                        topPadding: Style.space(10)
                        bottomPadding: Style.space(10)
                    }

                    PanelSeparator {
                        foreground: root.foreground
                    }

                    RowLayout {
                        width: parent.width
                        spacing: Style.space(8)

                        Text {
                            Layout.fillWidth: true
                            Layout.alignment: Qt.AlignVCenter
                            textFormat: Text.PlainText
                            text: Model.footerText(root.view)
                            color: root.dim
                            font.family: root.fontFamily
                            font.pixelSize: Style.font.caption
                            elide: Text.ElideRight
                        }

                        PanelActionButton {
                            id: refreshButton
                            Layout.alignment: Qt.AlignVCenter
                            iconText: "\uf021"
                            tooltipText: "Refresh now"
                            foreground: root.foreground
                            onClicked: root.refreshNow()
                        }
                    }
                }
            }
        }
    }

    // Switching panels with Tab: the bar's coordinator matches on the bar widget
    // item, not on this panel, so the widget is what gets handed over.
    function switchPanel(direction) {
        if (bar && typeof bar.switchPanelFrom === "function")
            return bar.switchPanelFrom(root.hostWidget || root, direction);
        return false;
    }

    // One notification: the repository on top, the subject under it. Each line is
    // its own link, so the two URLs the API hands over stay separately clickable.
    component NotificationRow: CursorSurface {
        id: row

        property var item: null
        property int rowIndex: 0

        width: parent ? parent.width : implicitWidth
        foreground: root.foreground
        accent: root.accent
        hasCursor: root.cursorActive && root.focusIndex === row.rowIndex
        implicitHeight: rowContent.implicitHeight + Style.spacing.rowPaddingX

        // Hovering anywhere in the row moves the shared cursor here; the two link
        // areas below sit on top of this one and own the clicks.
        MouseArea {
            anchors.fill: parent
            hoverEnabled: true
            onEntered: root.setRowCursor(row.rowIndex)
        }

        Column {
            id: rowContent
            anchors.left: parent.left
            anchors.right: parent.right
            anchors.verticalCenter: parent.verticalCenter
            anchors.leftMargin: Style.space(10)
            anchors.rightMargin: Style.space(10)
            spacing: Style.space(2)

            Text {
                id: repoLabel
                width: parent.width
                textFormat: Text.PlainText
                text: row.item ? row.item.repoName : ""
                color: repoArea.containsMouse ? root.foreground : root.dim
                font.family: root.fontFamily
                font.pixelSize: Style.font.caption
                font.underline: repoArea.containsMouse
                elide: Text.ElideRight

                MouseArea {
                    id: repoArea
                    anchors.fill: parent
                    hoverEnabled: true
                    cursorShape: Qt.PointingHandCursor
                    onEntered: root.setRowCursor(row.rowIndex)
                    onClicked: root.openRepo(row.item)
                }
            }

            Text {
                id: subjectLabel
                width: parent.width
                textFormat: Text.PlainText
                text: row.item ? row.item.title : ""
                color: subjectArea.containsMouse ? root.accent : root.foreground
                font.family: root.fontFamily
                font.pixelSize: Style.font.body
                wrapMode: Text.WordWrap
                maximumLineCount: 2
                elide: Text.ElideRight

                MouseArea {
                    id: subjectArea
                    anchors.fill: parent
                    hoverEnabled: true
                    cursorShape: Qt.PointingHandCursor
                    onEntered: root.setRowCursor(row.rowIndex)
                    onClicked: root.openSubject(row.item)
                }
            }
        }
    }
}
