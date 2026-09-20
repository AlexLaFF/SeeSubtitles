import Foundation

/// Which languages, pipelines, models and tuning ranges a talk may use. Read from live-schema.json, which
/// ios/scripts/export-schema.mjs writes from core/schema.js — the list the relay enforces — so the phone offers
/// what will connect and nothing is typed out twice.
public struct LiveSchema: Decodable, Sendable {
  public struct Pair: Decodable, Sendable { public let source: String; public let targets: [String] }
  public struct Option: Decodable, Sendable, Identifiable { public let id: String; public let label: String }
  public struct Range: Decodable, Sendable { public let min: Double; public let max: Double; public let step: Double; public let `default`: Double }
  public struct Tuning: Decodable, Sendable { public let vadSilenceTime: Range; public let maxSpeakTime: Range; public let noiseThreshold: Range }
  public struct Defaults: Decodable, Sendable { public let source: String; public let target: String }

  public let pipelines: [String]
  public let defaultPipeline: String
  public let pairs: [String: [Pair]]
  public let languageNames: [String: String]
  public let fileLabels: [String: String]
  public let models: [String: [Option]]
  public let defaultModel: [String: String]
  public let defaults: Defaults
  public let tuning: Tuning
  public let filterModal: [Option]

  public static let shared: LiveSchema = {
    guard let url = Bundle.module.url(forResource: "live-schema", withExtension: "json"),
          let data = try? Data(contentsOf: url),
          let schema = try? JSONDecoder().decode(LiveSchema.self, from: data)
    else { fatalError("live-schema.json is missing or unreadable — run node ios/scripts/export-schema.mjs") }
    return schema
  }()

  func pairs(for pipeline: String) -> [Pair] { pairs[pipeline] ?? pairs[defaultPipeline] ?? [] }

  /// Spoken languages of a pipeline, in the order the picker shows them.
  public func sources(pipeline: String? = nil) -> [String] { pairs(for: pipeline ?? defaultPipeline).map(\.source) }

  /// Subtitle languages this spoken language can become. Never empty; source == target transcribes.
  public func targets(for source: String, pipeline: String? = nil) -> [String] {
    let all = pairs(for: pipeline ?? defaultPipeline)
    return (all.first { $0.source == source } ?? all.first)?.targets ?? []
  }

  /// The spoken language if the pipeline accepts it, else the one it opens with.
  public func coerceSource(_ source: String, pipeline: String? = nil) -> String {
    let all = sources(pipeline: pipeline)
    return all.contains(source) ? source : (all.first ?? defaults.source)
  }

  /// `target` when the pipeline accepts the pair, else the first target it does accept for `source`.
  public func coerceTarget(source: String, target: String, pipeline: String? = nil) -> String {
    let all = targets(for: source, pipeline: pipeline)
    return all.contains(target) ? target : (all.first ?? defaults.target)
  }

  public func coerceModel(_ model: String?, pipeline: String? = nil) -> String {
    let p = pipeline ?? defaultPipeline
    let offered = models[p] ?? []
    if let model, offered.contains(where: { $0.id == model }) { return model }
    return defaultModel[p] ?? offered.first?.id ?? ""
  }

  /// "粤语 Cantonese" → ("粤语", "Cantonese"): the name in its own script, then in English.
  public func name(of language: String) -> (native: String, english: String) {
    let full = languageNames[language] ?? language
    guard let cut = full.lastIndex(of: " ") else { return (full, "") }
    return (String(full[..<cut]), String(full[full.index(after: cut)...]))
  }
}
