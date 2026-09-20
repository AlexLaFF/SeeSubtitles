import AVFoundation

/// What a finished recording amounts to.
public struct RecordingInfo: Sendable, Equatable {
  public let id: String
  public let base: String
  public let folder: URL
  public let durationMs: Int
  public let paddedMs: Int
  public let cues: Int
  public let hasAudio: Bool
  public let error: String?
}

/// Writes a talk to the phone as it happens: the audio, a subtitle file per language, the manifest. A port of
/// core/recorder.js, with the same promises:
///  - Nothing here touches the network; recording continues when the connection to the server is lost.
///  - The audio is a raw AAC stream while the talk runs, so a file cut short by a crash or a dead battery plays
///    up to the last frame written. It becomes an m4a when the talk stops, or at the next launch if it never did.
///  - Gaps in captured audio (a phone call, a route change) are padded with silence, keeping the audio aligned
///    with wall-clock time and therefore with the subtitle timestamps.
///  - Subtitles are appended a sentence at a time, so they too survive whatever happens to the app.
public actor Recorder {
  static let gapPadMs = 1_500.0 // pad silence when the audio falls this far behind the wall clock
  static let lagSettleMs = 2_000.0 // measure the pipeline's normal lag after this long

  private struct Active {
    var manifest: RecordingManifest
    let folder: URL
    var file: AVAudioFile?
    let format: AVAudioFormat
    var writtenSamples = 0
    var paddedMs = 0.0
    var baseLag: Double?
    var seen = Set<String>()
    var cues = (target: 0, source: 0)
    var error: String?
  }

  private let root: URL
  private let now: @Sendable () -> Double
  private var active: Active?

  public init(root: URL, now: @escaping @Sendable () -> Double = { Date().timeIntervalSince1970 * 1000 }) {
    self.root = root; self.now = now
  }

  public var isRecording: Bool { active != nil }
  public var elapsedMs: Double { active.map { now() - $0.manifest.startedAt } ?? 0 }

  /// Begin. With `audio` false the talk's words are kept and its sound is not.
  /// - Returns: the recording's id, which is its folder's name.
  @discardableResult
  public func start(source: String, target: String, audio: Bool = true, sampleRate: Int = 48_000, bitRate: Int = 96_000,
                    kind: RecordingManifest.Kind? = nil, title: String? = nil, sessionCode: String? = nil) throws -> String {
    if let active { return active.manifest.base }
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    let startedAt = now()
    let base = RecordingNames.uniqueBase(RecordingNames.base(for: Date(timeIntervalSince1970: startedAt / 1000)), in: root)
    let folder = root.appendingPathComponent(base, isDirectory: true)
    try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
    let manifest = RecordingManifest(base: base, source: source, target: target, startedAt: startedAt, rate: sampleRate,
                                     kind: kind ?? (audio ? .recorded : .transcriptOnly), title: title, sessionCode: sessionCode)
    try manifest.write(to: folder.appendingPathComponent(RecordingNames.fileName(base, .manifest)))
    let format = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: Double(sampleRate), channels: 1, interleaved: true)!
    var file: AVAudioFile?
    if audio {
      let settings: [String: Any] = [AVFormatIDKey: kAudioFormatMPEG4AAC, AVSampleRateKey: sampleRate, AVNumberOfChannelsKey: 1, AVEncoderBitRateKey: bitRate]
      // ".aac" makes this an ADTS stream: frames one after another, no index to finish, nothing to lose
      file = try AVAudioFile(forWriting: folder.appendingPathComponent(RecordingNames.fileName(base, .partialAudio)), settings: settings, commonFormat: .pcmFormatInt16, interleaved: true)
    }
    active = Active(manifest: manifest, folder: folder, file: file, format: format)
    return base
  }

  /// Feed captured audio: mono 16-bit samples at the recording's rate. Pads silence if the audio has fallen
  /// behind the clock — which is what a gap in capture looks like from here.
  public func write(_ samples: [Int16]) {
    guard var rec = active, rec.file != nil, !samples.isEmpty else { return }
    let rate = Double(rec.manifest.rate)
    let t = now()
    let elapsedSamples = (t - rec.manifest.startedAt) / 1000 * rate
    let lag = elapsedSamples - Double(rec.writtenSamples + samples.count) // > 0 when audio is behind the wall clock
    if let baseLag = rec.baseLag {
      if lag < baseLag {
        rec.baseLag = max(0, lag) // the pipeline is faster than first measured
      } else if lag - baseLag > Self.gapPadMs / 1000 * rate {
        let pad = Int((lag - baseLag).rounded())
        append(silence: pad, to: &rec)
      }
    } else if t - rec.manifest.startedAt > Self.lagSettleMs {
      rec.baseLag = max(0, lag)
    }
    append(samples, to: &rec)
    active = rec
  }

  private func append(silence count: Int, to rec: inout Active) {
    var left = count
    let second = [Int16](repeating: 0, count: rec.manifest.rate)
    while left > 0 { // a second at a time: a call can last an hour, and an hour of zeros is not worth allocating
      let n = min(left, second.count)
      append(n == second.count ? second : Array(second[0..<n]), to: &rec)
      left -= n
    }
    rec.paddedMs += Double(count) / Double(rec.manifest.rate) * 1000
  }

  private func append(_ samples: [Int16], to rec: inout Active) {
    guard let file = rec.file, let buffer = AVAudioPCMBuffer(pcmFormat: rec.format, frameCapacity: AVAudioFrameCount(samples.count)) else { return }
    buffer.frameLength = AVAudioFrameCount(samples.count)
    samples.withUnsafeBufferPointer { src in buffer.int16ChannelData![0].update(from: src.baseAddress!, count: samples.count) }
    do { try file.write(from: buffer); rec.writtenSamples += samples.count } catch { rec.error = error.localizedDescription }
  }

  /// Append a finished sentence to the subtitle files. A sentence is written once, when it has ended.
  public func add(_ line: TranscriptLine) {
    guard var rec = active, line.kind == .speech, line.ended, let wallStart = line.wallStart, !rec.seen.contains(line.id) else { return }
    let start = Int(wallStart - rec.manifest.startedAt)
    let end = Int((line.wallEnd ?? wallStart + 2000) - rec.manifest.startedAt)
    guard end > 0 else { return }
    rec.seen.insert(line.id)
    let base = rec.manifest.base
    // Transcribing rather than translating puts both slots in one file; writing it twice would double every cue.
    let oneFile = rec.manifest.source == rec.manifest.target
    if !line.targetText.isEmpty {
      rec.cues.target += 1
      Self.append(SRT.block(number: rec.cues.target, cue: Cue(start: start, end: end, text: line.targetText)), to: rec.folder.appendingPathComponent(RecordingNames.srtName(base, language: rec.manifest.target)))
    }
    if !line.sourceText.isEmpty, !oneFile {
      rec.cues.source += 1
      Self.append(SRT.block(number: rec.cues.source, cue: Cue(start: start, end: end, text: line.sourceText)), to: rec.folder.appendingPathComponent(RecordingNames.srtName(base, language: rec.manifest.source)))
    }
    active = rec
  }

  private static func append(_ text: String, to url: URL) {
    let data = Data(text.utf8)
    if let handle = try? FileHandle(forWritingTo: url) {
      defer { try? handle.close() }
      _ = try? handle.seekToEnd()
      try? handle.write(contentsOf: data)
    } else {
      try? data.write(to: url)
    }
  }

  /// Finish: close the audio, turn it into an m4a, and keep the transcript as the reader saw it.
  public func stop(transcript: Transcript? = nil) async -> RecordingInfo? {
    guard var rec = active else { return nil }
    active = nil
    let hadAudio = rec.file != nil
    rec.file = nil // closing is what finishes the stream
    let base = rec.manifest.base
    let part = rec.folder.appendingPathComponent(RecordingNames.fileName(base, .partialAudio))
    var durationMs = Int(Double(rec.writtenSamples) / Double(rec.manifest.rate) * 1000)
    if hadAudio {
      do {
        try await AudioRemux.m4a(from: part, to: rec.folder.appendingPathComponent(RecordingNames.fileName(base, .audio)))
        try? FileManager.default.removeItem(at: part)
      } catch {
        rec.error = "the audio was kept as a raw stream: \(error.localizedDescription)" // still there, still playable
      }
    } else {
      durationMs = Int(now() - rec.manifest.startedAt)
    }
    rec.manifest.durationMs = durationMs
    try? rec.manifest.write(to: rec.folder.appendingPathComponent(RecordingNames.fileName(base, .manifest)))
    if let transcript, let data = try? JSONEncoder().encode(transcript.lines) {
      try? data.write(to: rec.folder.appendingPathComponent(RecordingNames.fileName(base, .transcript)), options: .atomic)
    }
    return RecordingInfo(id: base, base: base, folder: rec.folder, durationMs: durationMs, paddedMs: Int(rec.paddedMs), cues: rec.cues.target, hasAudio: hadAudio, error: rec.error)
  }
}
