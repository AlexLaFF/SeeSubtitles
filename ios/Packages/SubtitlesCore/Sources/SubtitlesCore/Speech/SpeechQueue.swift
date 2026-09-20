import Foundation

/// The translation, spoken: what is said, in what order, how fast, and what is skipped to keep up. A port of the
/// `Queue` in web/speak.js — the Mac and the attendee page speak by the same rules — and checked against scenarios
/// that file generates (Fixtures/speech-queue.json). The numbers and the language-to-voice table are not ported
/// at all: they are read from speech.json, exported from the same file.
///
///  - Only settled sentences. A draft is rewritten three or four times before it settles; sound cannot be rewritten.
///  - Never the past. Turning it on speaks what settles from then on, not the transcript so far.
///  - It must not fall behind. One sentence waiting: speak faster. More than `maxWaiting`: drop the oldest and say
///    the newest — a gap is heard once; drift never ends.
///  - Nothing to say when the subtitles are the words as spoken: an echo a few seconds late helps no one.
public struct SpeechQueue: Sendable {
  public struct Options: Decodable, Sendable, Equatable {
    public var rate: Double
    public var maxWaiting: Int
    public var hurry: Double
    public var rush: Double
    public var maxRate: Double
  }

  public struct Item: Sendable, Equatable {
    public let id: String
    public let text: String
    /// A multiple of the voice's normal speed.
    public let rate: Double
  }

  private struct Shared: Decodable { let defaults: Options; let voiceLanguages: [String: String]; let quirkyVoices: [String] }
  private static let shared: Shared = {
    guard let url = Bundle.module.url(forResource: "speech", withExtension: "json"), let data = try? Data(contentsOf: url),
          let shared = try? JSONDecoder().decode(Shared.self, from: data)
    else { fatalError("speech.json is missing or unreadable — run node ios/scripts/export-schema.mjs") }
    return shared
  }()

  public static var defaults: Options { shared.defaults }

  /// Apple's robotic "Eloquence" set and its novelty voices: available, but never what a listener gets by default.
  public static func isQuirky(name: String, identifier: String) -> Bool {
    identifier.contains(".eloquence.") || identifier.contains("speech.synthesis.voice") || shared.quirkyVoices.contains { name == $0 || name.hasPrefix("\($0) (") }
  }

  /// What a talk's subtitle language is called by a speech engine: "yue" → "zh-HK".
  public static func voiceLanguage(_ code: String) -> String { shared.voiceLanguages[code] ?? code }

  /// What to say for a line, or "" when there is nothing worth saying aloud.
  public static func textToSpeak(_ line: TranscriptLine) -> String {
    guard line.ended, line.kind == .speech else { return "" }
    let target = line.targetText.trimmingCharacters(in: .whitespacesAndNewlines)
    let source = line.sourceText.trimmingCharacters(in: .whitespacesAndNewlines)
    return !target.isEmpty && target != source ? target : ""
  }

  public var options: Options
  public private(set) var isOn = false
  public private(set) var spoken = 0
  public private(set) var skipped = 0
  private var waiting: [(id: String, text: String)] = []
  private var known = Set<String>() // every sentence that has been offered once settled: a sentence is said once
  private var speaking: String?

  public init(options: Options = SpeechQueue.defaults) { self.options = options }

  /// Sentences not yet finished being said, the one in progress included.
  public var behind: Int { waiting.count + (speaking == nil ? 0 : 1) }

  /// Begin. Everything already in the transcript is the past.
  public mutating func start(existing ids: [String] = []) {
    isOn = true
    waiting = []; speaking = nil
    known.formUnion(ids)
  }

  /// End, dropping whatever was waiting. Whoever drives the voice silences the sentence in progress.
  public mutating func stop() { isOn = false; waiting = []; speaking = nil }

  /// A line changed or arrived. Returns the ids dropped to keep up (usually none).
  @discardableResult
  public mutating func offer(_ line: TranscriptLine) -> [String] {
    guard isOn, !known.contains(line.id), line.ended else { return [] }
    known.insert(line.id) // settled: whatever happens next, it will not be offered again
    let text = Self.textToSpeak(line)
    guard !text.isEmpty else { return [] }
    waiting.append((line.id, text))
    var dropped: [String] = []
    while waiting.count > options.maxWaiting { dropped.append(waiting.removeFirst().id); skipped += 1 }
    return dropped
  }

  /// The next thing to say, and how fast — or nil when there is nothing, or something is being said.
  public mutating func next() -> Item? {
    guard isOn, speaking == nil, !waiting.isEmpty else { return nil }
    let item = waiting.removeFirst()
    let behind = waiting.count // sentences still waiting behind this one
    let rate = min(options.maxRate, options.rate * (behind >= 2 ? options.rush : behind == 1 ? options.hurry : 1))
    speaking = item.id
    return Item(id: item.id, text: item.text, rate: (rate * 1000).rounded() / 1000)
  }

  /// The sentence in progress is over, however it ended.
  public mutating func finished(_ id: String) {
    guard speaking == id else { return }
    speaking = nil
    spoken += 1
  }
}
