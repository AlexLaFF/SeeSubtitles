import Foundation

/// One line of a talk: a sentence the room heard, or something the reader typed in reply.
public struct TranscriptLine: Codable, Sendable, Equatable, Identifiable {
  public enum Kind: String, Codable, Sendable { case speech, reply }

  public var id: String
  public var seq: Int
  public var kind: Kind
  public var sourceText: String
  public var targetText: String
  /// A sentence is rewritten while it is spoken; once ended it no longer changes.
  public var ended: Bool
  /// Milliseconds since 1970, on this device's clock.
  public var wallStart: Double?
  public var wallEnd: Double?
  public var createdAt: Double

  public init(id: String, seq: Int, kind: Kind = .speech, sourceText: String = "", targetText: String = "", ended: Bool = false, wallStart: Double? = nil, wallEnd: Double? = nil, createdAt: Double) {
    self.id = id; self.seq = seq; self.kind = kind; self.sourceText = sourceText; self.targetText = targetText
    self.ended = ended; self.wallStart = wallStart; self.wallEnd = wallEnd; self.createdAt = createdAt
  }

  /// What a reader sees first: the subtitle, or the words themselves when there is no translation yet.
  public var display: String { targetText.isEmpty ? sourceText : targetText }
}

/// The lines of one talk, keyed by sentence so an update lands on the line it belongs to — across reconnects too.
/// A port of core/transcript.js, which keeps the last thousand; a reader looks back, so this keeps them all.
public struct Transcript: Sendable, Equatable {
  public private(set) var lines: [TranscriptLine] = []
  private var indexById: [String: Int] = [:]
  private var seq = 0

  public init() {}

  public init(lines: [TranscriptLine]) {
    self.lines = lines
    for (i, line) in lines.enumerated() { indexById[line.id] = i }
    seq = lines.map(\.seq).max() ?? 0
  }

  /// Apply one update. Returns the line as it now stands and whether it is new.
  @discardableResult
  public mutating func apply(_ r: LiveResult, now: Double) -> (line: TranscriptLine, isNew: Bool) {
    let id = r.sentenceId ?? "\(r.voiceId ?? "v"):\(r.startTime.map { String(Int($0)) } ?? "x")"
    let isNew = indexById[id] == nil
    if isNew {
      seq += 1
      indexById[id] = lines.count
      lines.append(TranscriptLine(id: id, seq: seq, createdAt: now))
    }
    let i = indexById[id]!
    if let text = r.sourceText { lines[i].sourceText = text }
    if let text = r.targetText { lines[i].targetText = text }
    if let t = r.wallStart { lines[i].wallStart = t }
    if let t = r.wallEnd { lines[i].wallEnd = t }
    lines[i].ended = lines[i].ended || r.sentenceEnd
    return (lines[i], isNew)
  }

  /// Something the reader typed to show the other person; kept in the transcript as their own line.
  @discardableResult
  public mutating func addReply(_ text: String, now: Double) -> TranscriptLine {
    seq += 1
    let line = TranscriptLine(id: "reply:\(seq):\(Int(now))", seq: seq, kind: .reply, sourceText: text, targetText: text, ended: true, wallStart: now, wallEnd: now, createdAt: now)
    indexById[line.id] = lines.count
    lines.append(line)
    return line
  }

  /// Sentences that have settled and have something in them.
  public var finished: [TranscriptLine] { lines.filter { $0.ended && !($0.sourceText.isEmpty && $0.targetText.isEmpty) } }
}
