import Foundation

/// One update to one sentence, as the relay sends it (core/split-stream.js `_emit`, core/translator.js). A
/// sentence is updated many times while it is spoken and once more, with `sentenceEnd`, when it settles.
public struct LiveResult: Decodable, Sendable, Equatable {
  public var voiceId: String?
  public var sentenceId: String?
  public var sourceText: String?
  public var targetText: String?
  /// Milliseconds into the stream.
  public var startTime: Double?
  public var endTime: Double?
  /// Milliseconds since 1970 on this device's clock: the relay maps results back onto the capture times it was sent.
  public var wallStart: Double?
  public var wallEnd: Double?
  public var sentenceEnd: Bool
  public var source: String?
  public var target: String?

  public init(voiceId: String? = nil, sentenceId: String? = nil, sourceText: String? = nil, targetText: String? = nil, startTime: Double? = nil, endTime: Double? = nil, wallStart: Double? = nil, wallEnd: Double? = nil, sentenceEnd: Bool = false, source: String? = nil, target: String? = nil) {
    self.voiceId = voiceId; self.sentenceId = sentenceId; self.sourceText = sourceText; self.targetText = targetText
    self.startTime = startTime; self.endTime = endTime; self.wallStart = wallStart; self.wallEnd = wallEnd
    self.sentenceEnd = sentenceEnd; self.source = source; self.target = target
  }

  enum CodingKeys: String, CodingKey { case voiceId, sentenceId, sourceText, targetText, startTime, endTime, wallStart, wallEnd, sentenceEnd, source, target }
  public init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    voiceId = try c.decodeIfPresent(String.self, forKey: .voiceId)
    sentenceId = try c.decodeIfPresent(String.self, forKey: .sentenceId)
    sourceText = try c.decodeIfPresent(String.self, forKey: .sourceText)
    targetText = try c.decodeIfPresent(String.self, forKey: .targetText)
    startTime = try c.decodeIfPresent(Double.self, forKey: .startTime)
    endTime = try c.decodeIfPresent(Double.self, forKey: .endTime)
    wallStart = try c.decodeIfPresent(Double.self, forKey: .wallStart)
    wallEnd = try c.decodeIfPresent(Double.self, forKey: .wallEnd)
    sentenceEnd = try c.decodeIfPresent(Bool.self, forKey: .sentenceEnd) ?? false
    source = try c.decodeIfPresent(String.self, forKey: .source)
    target = try c.decodeIfPresent(String.self, forKey: .target)
  }
}

/// What a talk is opened with. Languages, pipeline and model are fixed when a connection is made (they travel in
/// its query string); the rest can change while it is open.
public struct RelayOptions: Sendable, Equatable {
  public var source: String
  public var target: String
  public var pipeline: String
  public var transModel: String
  /// One `词|权重` per line, as the glossary writes it.
  public var hotwords: String
  public var vadSilenceTime: Int?
  public var maxSpeakTime: Int?
  public var noiseThreshold: Double?
  public var filterModal: String?

  public init(source: String, target: String, pipeline: String? = nil, transModel: String? = nil, hotwords: String = "", vadSilenceTime: Int? = nil, maxSpeakTime: Int? = nil, noiseThreshold: Double? = nil, filterModal: String? = nil) {
    let schema = LiveSchema.shared
    let p = pipeline.flatMap { schema.pipelines.contains($0) ? $0 : nil } ?? schema.defaultPipeline
    self.pipeline = p
    self.source = schema.coerceSource(source, pipeline: p)
    self.target = schema.coerceTarget(source: self.source, target: target, pipeline: p)
    self.transModel = schema.coerceModel(transModel, pipeline: p)
    self.hotwords = hotwords
    self.vadSilenceTime = vadSilenceTime; self.maxSpeakTime = maxSpeakTime
    self.noiseThreshold = noiseThreshold; self.filterModal = filterModal
  }

  /// A change to any of these needs a new connection.
  func needsReconnect(from old: RelayOptions) -> Bool {
    source != old.source || target != old.target || pipeline != old.pipeline || transModel != old.transModel
  }

  var query: [URLQueryItem] {
    var items = [URLQueryItem(name: "source", value: source), URLQueryItem(name: "target", value: target),
                 URLQueryItem(name: "transModel", value: transModel), URLQueryItem(name: "pipeline", value: pipeline)]
    if !hotwords.isEmpty { items.append(URLQueryItem(name: "hotwords", value: hotwords)) }
    if let vadSilenceTime { items.append(URLQueryItem(name: "vadSilenceTime", value: String(vadSilenceTime))) }
    if let maxSpeakTime { items.append(URLQueryItem(name: "maxSpeakTime", value: String(maxSpeakTime))) }
    return items
  }

  /// The `settings` message: everything, as core/remote-stream.js sends it after `ready` and on a change.
  var settingsMessage: String {
    var o: [String: Any] = ["type": "settings", "source": source, "target": target, "transModel": transModel, "model": transModel, "pipeline": pipeline, "hotwords": hotwords]
    if let vadSilenceTime { o["vadSilenceTime"] = vadSilenceTime }
    if let maxSpeakTime { o["maxSpeakTime"] = maxSpeakTime }
    if let noiseThreshold { o["noiseThreshold"] = noiseThreshold }
    if let filterModal { o["filterModal"] = filterModal }
    let data = (try? JSONSerialization.data(withJSONObject: o, options: [.sortedKeys])) ?? Data("{}".utf8)
    return String(decoding: data, as: UTF8.self)
  }
}
