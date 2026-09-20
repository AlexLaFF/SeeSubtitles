import AVFoundation
import Foundation
import ImageIO
import Testing
import UniformTypeIdentifiers
@testable import SubtitlesCore

@Suite struct MP4ExporterTests {
  @Test("the picture changes when a cue starts and when one ends, and only then")
  func segments() {
    let cues = [Cue(start: 1000, end: 2500, text: "一"), Cue(start: 3000, end: 9000, text: "二")]
    let s = MP4Exporter.segments(cues: cues, duration: 5)
    #expect(s.map(\.start) == [0, 1, 2.5, 3])
    #expect(s.map(\.end) == [1, 2.5, 3, 5])
    #expect(s[0].shown.isEmpty)
    #expect(s[1].shown == [.init(index: 0, bright: true)])
    #expect(s[2].shown == [.init(index: 0, bright: false)], "a cue that has ended stays, dimmed")
    #expect(s[3].shown == [.init(index: 0, bright: false), .init(index: 1, bright: true)])
  }

  @Test("a recording becomes a video with its audio and its subtitles in the picture")
  func export() async throws {
    let root = temporaryDirectory("mp4"); defer { try? FileManager.default.removeItem(at: root) }
    let clock = TestClock()
    let recorder = Recorder(root: root, now: { clock.now })
    let id = try await recorder.start(source: "yue", target: "zh")
    for _ in 0..<15 { await recorder.write(tone(0.2)); clock.advance(200) }
    _ = await recorder.stop()
    let recording = try #require(RecordingLibrary(root: root).recording(id: id))
    let out = recording.folder.appendingPathComponent(RecordingNames.fileName(id, .mp4))
    let target = [Cue(start: 200, end: 1400, text: "大家好，欢迎来到今天的分享。"), Cue(start: 1500, end: 2900, text: "今天我们会讲一下如何用字幕帮助更多人参与会议。")]
    let source = [Cue(start: 200, end: 1400, text: "大家好，欢迎嚟到今日嘅分享。"), Cue(start: 1500, end: 2900, text: "今日我哋会讲吓点样用字幕帮助更多人参与会议。")]
    var options = MP4Exporter.Options.portrait
    options.showBoth = true
    let seen = ProgressLog()
    try await MP4Exporter().export(audio: recording.audio!, target: target, source: source, to: out, options: options) { p in seen.add(p) }

    let asset = AVURLAsset(url: out)
    let video = try #require(try await asset.loadTracks(withMediaType: .video).first)
    #expect(try await video.load(.naturalSize) == CGSize(width: 1080, height: 1920))
    #expect(try await asset.loadTracks(withMediaType: .audio).count == 1)
    #expect(abs(try await asset.load(.duration).seconds - 3.0) < 0.15)
    #expect(seen.values.last == 1 && seen.values == seen.values.sorted())
    #expect(!FileManager.default.fileExists(atPath: out.path + ".part"))
    #expect(RecordingLibrary(root: root).recording(id: id)?.mp4 == out)

    // what the second sentence looks like: there is something bright near the bottom, and the top is black
    let generator = AVAssetImageGenerator(asset: asset)
    generator.requestedTimeToleranceBefore = .zero; generator.requestedTimeToleranceAfter = .zero
    let image = try await generator.image(at: CMTime(seconds: 2.0, preferredTimescale: 600)).image
    if let keep = ProcessInfo.processInfo.environment["KEEP_FRAME"] {
      let dest = CGImageDestinationCreateWithURL(URL(fileURLWithPath: keep) as CFURL, UTType.png.identifier as CFString, 1, nil)!
      CGImageDestinationAddImage(dest, image, nil); CGImageDestinationFinalize(dest)
    }
    func brightness(rowFraction: Double) -> Int {
      let ctx = CGContext(data: nil, width: image.width, height: image.height, bitsPerComponent: 8, bytesPerRow: image.width * 4, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
      ctx.draw(image, in: CGRect(x: 0, y: 0, width: image.width, height: image.height))
      let data = ctx.data!.bindMemory(to: UInt8.self, capacity: image.width * image.height * 4)
      let row = Int(Double(image.height) * rowFraction)
      return (0..<image.width).map { Int(data[(row * image.width + $0) * 4]) }.max() ?? 0
    }
    #expect((80...99).contains { brightness(rowFraction: Double($0) / 100) > 200 }, "subtitles near the bottom")
    #expect(brightness(rowFraction: 0.1) < 30, "nothing at the top")
  }
}

extension MP4ExporterTests {
  @Test("a minute of talk is made in seconds: the sound and the picture are written side by side")
  func longEnoughToStall() async throws {
    let root = temporaryDirectory("mp4long"); defer { try? FileManager.default.removeItem(at: root) }
    let clock = TestClock()
    let recorder = Recorder(root: root, now: { clock.now })
    let id = try await recorder.start(source: "yue", target: "zh")
    for _ in 0..<60 { await recorder.write(tone(1)); clock.advance(1000) }
    _ = await recorder.stop()
    let recording = try #require(RecordingLibrary(root: root).recording(id: id))
    let cues = (0..<20).map { Cue(start: $0 * 3000 + 200, end: $0 * 3000 + 2800, text: "第 \($0 + 1) 句：字幕帮助更多人参与会议。") }
    let out = recording.folder.appendingPathComponent(RecordingNames.fileName(id, .mp4))
    let began = Date()
    try await MP4Exporter().export(audio: recording.audio!, target: cues, to: out)
    // written one track after the other, a writer stalls for seconds at every frame and this takes minutes
    #expect(Date().timeIntervalSince(began) < 30, "took \(Date().timeIntervalSince(began)) s")
    #expect(abs(try await AVURLAsset(url: out).load(.duration).seconds - 60) < 0.5)
    // a leftover from an export the app never finished is cleared away at launch
    try Data().write(to: recording.folder.appendingPathComponent("\(id)录音＋字幕.mp4.part"))
    _ = await RecordingLibrary(root: root).recoverInterrupted()
    #expect(try FileManager.default.contentsOfDirectory(atPath: recording.folder.path).filter { $0.contains(".part") }.isEmpty)
  }
}

final class ProgressLog: @unchecked Sendable {
  private let lock = NSLock(); private var _values: [Double] = []
  func add(_ v: Double) { lock.withLock { _values.append(v) } }
  var values: [Double] { lock.withLock { _values } }
}
