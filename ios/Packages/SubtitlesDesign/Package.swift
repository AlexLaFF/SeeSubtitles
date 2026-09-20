// swift-tools-version: 6.0
// Marquee on iOS: the tokens of design/tokens/marquee.css as Swift, and the few pieces every screen is made of —
// the status dot and word, the stack row, the buttons, the mark. Drawn first on the canvas (design/canvas/ios-screens.mjs).
import PackageDescription

let package = Package(
  name: "SubtitlesDesign",
  platforms: [.iOS(.v17)],
  products: [.library(name: "SubtitlesDesign", targets: ["SubtitlesDesign"])],
  targets: [.target(name: "SubtitlesDesign")]
)
