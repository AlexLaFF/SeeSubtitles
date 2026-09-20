import Foundation

/// What a recording is, written when it starts so it is known even if it never stops properly. The first six
/// fields are the Mac's manifest (core/recorder.js); the rest are this app's, and the Mac ignores them.
public struct RecordingManifest: Codable, Sendable, Hashable {
  public enum Kind: String, Codable, Sendable {
    case recorded
    /// A talk that was listened to without recording: the words were kept, the sound was not.
    case transcriptOnly
    /// Someone else's talk, followed through its share code.
    case joined
  }

  public var base: String
  public var source: String
  public var target: String
  public var startedAt: Double
  public var rate: Int
  public var channels: Int

  public var device: String = "ios"
  public var kind: Kind = .recorded
  /// The name the person gave it; the files keep their base.
  public var title: String?
  public var durationMs: Int?
  /// Set when the app did not get to finish the recording and it was put back together at the next launch.
  public var recovered: Bool?
  /// For a joined talk: the share code it was followed through.
  public var sessionCode: String?

  public init(base: String, source: String, target: String, startedAt: Double, rate: Int = 48_000, channels: Int = 1, kind: Kind = .recorded, title: String? = nil, sessionCode: String? = nil) {
    self.base = base; self.source = source; self.target = target; self.startedAt = startedAt
    self.rate = rate; self.channels = channels; self.kind = kind; self.title = title; self.sessionCode = sessionCode
  }

  enum CodingKeys: String, CodingKey { case base, source, target, startedAt, rate, channels, device, kind, title, durationMs, recovered, sessionCode }
  public init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    base = try c.decode(String.self, forKey: .base)
    // a manifest from before languages were recorded means the only thing that build could do
    source = try c.decodeIfPresent(String.self, forKey: .source) ?? "yue"
    target = try c.decodeIfPresent(String.self, forKey: .target) ?? "zh"
    startedAt = try c.decodeIfPresent(Double.self, forKey: .startedAt) ?? 0
    rate = try c.decodeIfPresent(Int.self, forKey: .rate) ?? 48_000
    channels = try c.decodeIfPresent(Int.self, forKey: .channels) ?? 1
    device = try c.decodeIfPresent(String.self, forKey: .device) ?? "mac"
    kind = try c.decodeIfPresent(Kind.self, forKey: .kind) ?? .recorded
    title = try c.decodeIfPresent(String.self, forKey: .title)
    durationMs = try c.decodeIfPresent(Int.self, forKey: .durationMs)
    recovered = try c.decodeIfPresent(Bool.self, forKey: .recovered)
    sessionCode = try c.decodeIfPresent(String.self, forKey: .sessionCode)
  }

  static func read(_ url: URL) -> RecordingManifest? {
    guard let data = try? Data(contentsOf: url) else { return nil }
    return try? JSONDecoder().decode(RecordingManifest.self, from: data)
  }

  func write(to url: URL) throws {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
    try encoder.encode(self).write(to: url, options: .atomic)
  }
}
