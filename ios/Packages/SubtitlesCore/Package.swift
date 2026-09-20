// swift-tools-version: 6.0
// Everything below the screens of See Subtitles for iOS: the relay client, the audio path, the recorder, cues and
// file names, and the server's API. No UI and no third-party code. Builds for macOS too, so `swift test` runs on a
// Mac without a simulator.
import PackageDescription

let package = Package(
  name: "SubtitlesCore",
  platforms: [.iOS(.v17), .macOS(.v14)],
  products: [.library(name: "SubtitlesCore", targets: ["SubtitlesCore"])],
  targets: [
    .target(name: "SubtitlesCore", resources: [.process("Resources")]),
    .testTarget(name: "SubtitlesCoreTests", dependencies: ["SubtitlesCore"], resources: [.copy("Fixtures")]),
  ]
)
