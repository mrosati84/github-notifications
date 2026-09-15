import QtQuick
import QtQuick.Effects
import qs.Commons

// The GitHub mark, rendered from assets/github.svg and tinted to the theme.
//
// The asset is plain white, and one file is enough for every Omarchy theme:
// MultiEffect colorization replaces its colour with `color`. `lit` is the
// widget's whole visual language - bright while there is something unread,
// dimmed while the inbox is quiet.
Item {
  id: root

  property color color: Color.foreground
  property bool lit: false
  property real dimOpacity: 0.4
  // The mark is a filled shape where the bar's other icons are line art, so it
  // is drawn smaller than the slot it sits in to read at the same weight.
  // Tuned against the stock nerd-font glyphs in the bar.
  property real markScale: 0.7

  implicitWidth: Style.bar.iconCanvas
  implicitHeight: Style.bar.iconCanvas

  readonly property real boxSize: Math.max(1, Math.min(width, height))
  readonly property real markSize: Math.max(1, Math.round(root.boxSize * root.markScale))

  // Only ever a source for the effect below: ShaderEffectSource renders it
  // whether or not it is visible, so it is not drawn twice.
  Image {
    id: source
    anchors.centerIn: parent
    width: root.markSize
    height: root.markSize
    source: Qt.resolvedUrl("assets/github.svg")
    sourceSize.width: Math.max(2, Math.round(root.markSize * 2))
    sourceSize.height: Math.max(2, Math.round(root.markSize * 2))
    fillMode: Image.PreserveAspectFit
    smooth: true
    visible: false
  }

  MultiEffect {
    anchors.fill: source
    source: source
    colorization: 1.0
    colorizationColor: root.color
    autoPaddingEnabled: false
    opacity: root.lit ? 1.0 : root.dimOpacity

    Behavior on opacity {
      NumberAnimation { duration: 180; easing.type: Easing.OutCubic }
    }
    Behavior on colorizationColor {
      ColorAnimation { duration: 160 }
    }
  }
}
