import AVFoundation
import CoreText
import CoreVideo

/// A recording as a video anyone can play: its audio, and its subtitles drawn into the picture — a bottom-anchored
/// stack of the latest cues, the current one bright and earlier ones dimmed, like the live display. A port of
/// desktop/helpers/render-subs.swift and desktop/lib/mp4.js, made with AVFoundation because a phone has no ffmpeg.
/// Runs on the device; nothing goes to the server. No subtitle track is embedded: players would switch it on and
/// show every line twice.
public struct MP4Exporter: Sendable {
  public struct Options: Sendable {
    public var width = 1080
    public var height = 1920
    public var fontSize: CGFloat = 64
    /// Draw the original under the translation.
    public var showBoth = false
    /// The longest a picture is held before it is written again: players seek badly through very long frames.
    public var maxFrameSeconds = 1.0
    public init() {}
    public static var portrait: Options { Options() }
    public static var landscape: Options { var o = Options(); o.width = 1920; o.height = 1080; o.fontSize = 56; return o }
  }

  public struct Failed: Error, LocalizedError { public let reason: String; public var errorDescription: String? { reason } }

  struct Shown: Equatable { let index: Int; let bright: Bool }
  struct Segment: Equatable { let start: Double; let end: Double; let shown: [Shown] }

  public init() {}

  /// The picture changes when a cue starts and when one ends. Between those moments it is one still frame.
  static func segments(cues: [Cue], duration: Double, maxLines: Int = 60) -> [Segment] {
    let list = cues.sorted { $0.start < $1.start }
    var times: Set<Double> = [0]
    for c in list { times.insert(Double(c.start) / 1000); times.insert(min(Double(c.end) / 1000, duration)) }
    let sorted = times.filter { $0 >= 0 && $0 < duration }.sorted()
    var out: [Segment] = []
    for (k, t) in sorted.enumerated() {
      let next = k + 1 < sorted.count ? sorted[k + 1] : duration
      if next - t < 0.001 { continue }
      let visible = list.enumerated().filter { Double($0.element.start) / 1000 <= t + 1e-6 }.suffix(maxLines)
      out.append(Segment(start: t, end: next, shown: visible.map { Shown(index: $0.offset, bright: Double($0.element.end) / 1000 > t + 1e-6) }))
    }
    return out
  }

  /// - Parameters:
  ///   - source: the spoken-language cues, drawn under the translation when `options.showBoth`.
  ///   - progress: 0…1, called as the video is written.
  public func export(audio: URL, target: [Cue], source: [Cue] = [], to destination: URL, options: Options = .portrait,
                     progress: @escaping @Sendable (Double) -> Void = { _ in }) async throws {
    let asset = AVURLAsset(url: audio)
    guard let audioTrack = try await asset.loadTracks(withMediaType: .audio).first else { throw Failed(reason: "this recording has no audio") }
    let duration = try await asset.load(.duration).seconds
    guard duration > 0 else { throw Failed(reason: "this recording is empty") }
    let main = (target.isEmpty ? source : target).sorted { $0.start < $1.start }
    let under = target.isEmpty ? [] : source
    let pairs = main.map { cue in (cue, options.showBoth ? (under.first { abs($0.start - cue.start) < 50 }?.text ?? "") : "") }

    let part = destination.appendingPathExtension("part")
    try? FileManager.default.removeItem(at: part)
    let writer = try AVAssetWriter(outputURL: part, fileType: .mp4)
    writer.shouldOptimizeForNetworkUse = true // the index at the front: plays while it downloads

    let video = AVAssetWriterInput(mediaType: .video, outputSettings: [
      AVVideoCodecKey: AVVideoCodecType.h264, AVVideoWidthKey: options.width, AVVideoHeightKey: options.height,
      AVVideoCompressionPropertiesKey: [AVVideoAverageBitRateKey: 900_000, AVVideoMaxKeyFrameIntervalDurationKey: 10],
    ])
    video.expectsMediaDataInRealTime = false
    let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: video, sourcePixelBufferAttributes: [
      kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA, kCVPixelBufferWidthKey as String: options.width, kCVPixelBufferHeightKey as String: options.height,
    ])
    // the audio is copied as it is, not encoded again
    let hint = try await audioTrack.load(.formatDescriptions).first
    let audioInput = AVAssetWriterInput(mediaType: .audio, outputSettings: nil, sourceFormatHint: hint)
    audioInput.expectsMediaDataInRealTime = false
    let reader = try AVAssetReader(asset: asset)
    let audioOutput = AVAssetReaderTrackOutput(track: audioTrack, outputSettings: nil)
    guard writer.canAdd(video), writer.canAdd(audioInput), reader.canAdd(audioOutput) else { throw Failed(reason: "this recording cannot be made into a video") }
    writer.add(video); writer.add(audioInput); reader.add(audioOutput)
    guard writer.startWriting(), reader.startReading() else { throw writer.error ?? reader.error ?? Failed(reason: "the export could not start") }
    writer.startSession(atSourceTime: .zero)

    // The two tracks are written at the same time, each as fast as the writer will take it. The writer paces them
    // against each other: it stops accepting whichever runs ahead. Written one after the other — or in one loop
    // that waits on either — the input being waited on is the one the writer has paused, and nothing moves again.
    let renderer = FrameRenderer(options: options, cues: pairs)
    let timescale: CMTimeScale = 600
    let segments = Self.segments(cues: main, duration: duration)
    nonisolated(unsafe) let videoInput = video, pixels = adaptor, sound = audioInput, soundSource = audioOutput, file = writer
    let frameGap = options.maxFrameSeconds
    do {
      try await withThrowingTaskGroup(of: Void.self) { group in
        group.addTask {
          // ---- the picture: one still per state, written again at least every `maxFrameSeconds`
          for segment in segments {
            try Task.checkCancellation()
            guard let pool = pixels.pixelBufferPool else { throw Failed(reason: "no picture buffer") }
            var buffer: CVPixelBuffer?
            CVPixelBufferPoolCreatePixelBuffer(nil, pool, &buffer)
            guard let buffer else { throw Failed(reason: "no picture buffer") }
            renderer.draw(segment.shown, into: buffer)
            var t = segment.start
            while t < segment.end - 0.001 {
              while !videoInput.isReadyForMoreMediaData { try await Task.sleep(for: .milliseconds(3)) }
              guard pixels.append(buffer, withPresentationTime: CMTime(seconds: t, preferredTimescale: timescale)) else { throw file.error ?? Failed(reason: "a frame could not be written") }
              t += frameGap
            }
            progress(min(0.95, segment.end / duration * 0.95))
          }
          videoInput.markAsFinished()
        }
        group.addTask {
          // ---- the sound, copied as it is
          while let sample = soundSource.copyNextSampleBuffer() {
            try Task.checkCancellation()
            while !sound.isReadyForMoreMediaData { try await Task.sleep(for: .milliseconds(3)) }
            guard sound.append(sample) else { throw file.error ?? Failed(reason: "the audio could not be written") }
          }
          sound.markAsFinished()
        }
        try await group.waitForAll()
      }
    } catch {
      // nothing half-made is left behind, whether it failed or the person changed their mind
      writer.cancelWriting(); reader.cancelReading()
      try? FileManager.default.removeItem(at: part)
      throw error
    }
    writer.endSession(atSourceTime: CMTime(seconds: duration, preferredTimescale: timescale))
    await writer.finishWriting()
    guard writer.status == .completed else { throw writer.error ?? Failed(reason: "the video was not finished") }
    try? FileManager.default.removeItem(at: destination)
    try FileManager.default.moveItem(at: part, to: destination)
    progress(1)
  }
}

/// Draws the subtitle stack with Core Text. Two passes per cue — a black outline underneath, then a clean white
/// fill on top — so bold Chinese strokes do not look hollow.
final class FrameRenderer: @unchecked Sendable { // made, then only read, by the one task that draws
  private let options: MP4Exporter.Options
  private let cues: [(Cue, String)]
  private let mainFont: CTFont
  private let subFont: CTFont
  private let paragraph: CTParagraphStyle

  init(options: MP4Exporter.Options, cues: [(Cue, String)]) {
    self.options = options; self.cues = cues
    // the system font, which falls back to PingFang for Chinese
    func system(_ size: CGFloat, bold: Bool) -> CTFont {
      let base = CTFontCreateUIFontForLanguage(bold ? .emphasizedSystem : .system, size, nil) ?? CTFontCreateWithName("Helvetica" as CFString, size, nil)
      return base
    }
    mainFont = system(options.fontSize, bold: true)
    subFont = system(options.fontSize * 0.55, bold: false)
    var alignment = CTTextAlignment.center
    var lineHeight: CGFloat = 1.12
    paragraph = withUnsafePointer(to: &alignment) { a in
      withUnsafePointer(to: &lineHeight) { l in
        let settings = [CTParagraphStyleSetting(spec: .alignment, valueSize: MemoryLayout<CTTextAlignment>.size, value: a),
                        CTParagraphStyleSetting(spec: .lineHeightMultiple, valueSize: MemoryLayout<CGFloat>.size, value: l)]
        return CTParagraphStyleCreate(settings, settings.count)
      }
    }
  }

  private func attributed(_ cue: (Cue, String), bright: Bool, outline: Bool) -> CFAttributedString {
    let alpha: CGFloat = bright ? 1.0 : 0.55
    func attributes(_ font: CTFont, _ a: CGFloat) -> [NSAttributedString.Key: Any] {
      var d: [NSAttributedString.Key: Any] = [NSAttributedString.Key(kCTFontAttributeName as String): font, NSAttributedString.Key(kCTParagraphStyleAttributeName as String): paragraph]
      if outline {
        d[NSAttributedString.Key(kCTStrokeColorAttributeName as String)] = CGColor(gray: 0, alpha: 0.9)
        d[NSAttributedString.Key(kCTStrokeWidthAttributeName as String)] = 9.0 // stroke only, % of font size
      } else {
        d[NSAttributedString.Key(kCTForegroundColorAttributeName as String)] = CGColor(gray: 1, alpha: a)
      }
      return d
    }
    let text = NSMutableAttributedString(string: cue.0.text, attributes: attributes(mainFont, alpha))
    if !cue.1.isEmpty { text.append(NSAttributedString(string: "\n" + cue.1, attributes: attributes(subFont, alpha * 0.8))) }
    return text
  }

  func draw(_ shown: [MP4Exporter.Shown], into buffer: CVPixelBuffer) {
    CVPixelBufferLockBaseAddress(buffer, [])
    defer { CVPixelBufferUnlockBaseAddress(buffer, []) }
    let W = CGFloat(options.width), H = CGFloat(options.height)
    guard let ctx = CGContext(data: CVPixelBufferGetBaseAddress(buffer), width: options.width, height: options.height, bitsPerComponent: 8,
                              bytesPerRow: CVPixelBufferGetBytesPerRow(buffer), space: CGColorSpaceCreateDeviceRGB(),
                              bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue) else { return }
    ctx.setFillColor(CGColor(gray: 0, alpha: 1))
    ctx.fill(CGRect(x: 0, y: 0, width: W, height: H))
    let padX = W * 0.05, padBottom = H * 0.08, padTop = H * 0.03
    let textW = W - 2 * padX
    let gap = options.fontSize * 0.5
    var y = padBottom // Core Graphics counts from the bottom: stack upward from the bottom padding
    for item in shown.reversed() where item.index < cues.count {
      if y > H - padTop { break }
      let fill = attributed(cues[item.index], bright: item.bright, outline: false)
      let setter = CTFramesetterCreateWithAttributedString(fill)
      let h = ceil(CTFramesetterSuggestFrameSizeWithConstraints(setter, CFRange(location: 0, length: 0), nil, CGSize(width: textW, height: 100_000), nil).height) + 4
      // extra room below so Core Text never drops the last line; text is laid out from the top
      let rect = CGPath(rect: CGRect(x: padX, y: y - options.fontSize, width: textW, height: h + options.fontSize), transform: nil)
      CTFrameDraw(CTFramesetterCreateFrame(CTFramesetterCreateWithAttributedString(attributed(cues[item.index], bright: item.bright, outline: true)), CFRange(location: 0, length: 0), rect, nil), ctx)
      CTFrameDraw(CTFramesetterCreateFrame(setter, CFRange(location: 0, length: 0), rect, nil), ctx)
      y += h + gap
    }
    // rows leaving past the top edge dissolve, like the live display
    let fadeH = options.fontSize * 1.12 * 0.8
    if let gradient = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(), colors: [CGColor(gray: 0, alpha: 1), CGColor(gray: 0, alpha: 0)] as CFArray, locations: [0, 1]) {
      ctx.saveGState()
      ctx.clip(to: CGRect(x: 0, y: H - padTop - fadeH, width: W, height: padTop + fadeH))
      ctx.drawLinearGradient(gradient, start: CGPoint(x: 0, y: H - padTop), end: CGPoint(x: 0, y: H - padTop - fadeH), options: [.drawsBeforeStartLocation])
      ctx.restoreGState()
    }
  }
}
