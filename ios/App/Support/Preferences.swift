import Foundation
import SubtitlesCore
import SwiftUI

/// Which of a sentence's two texts the reader shows.
enum ShowMode: String, CaseIterable, Identifiable { case target, both, source; var id: String { rawValue } }

/// What the person has chosen, kept in UserDefaults. Observable, so a change in the Text sheet is on screen at once.
@MainActor @Observable
final class Preferences {
  private let store: UserDefaults

  var source: String { didSet { save("source", source) } }
  var target: String { didSet { save("target", target) } }
  var transModel: String { didSet { save("transModel", transModel) } }
  var vadSilenceTime: Int { didSet { save("vadSilenceTime", vadSilenceTime) } }
  var maxSpeakTime: Int { didSet { save("maxSpeakTime", maxSpeakTime) } }
  var noiseThreshold: Double { didSet { save("noiseThreshold", noiseThreshold) } }
  var filterModal: String { didSet { save("filterModal", filterModal) } }

  var recordOnStart: Bool { didSet { save("recordOnStart", recordOnStart) } }
  var bitRate: Int { didSet { save("bitRate", bitRate) } }
  var autoMP4: Bool { didSet { save("autoMP4", autoMP4) } }
  var mp4Landscape: Bool { didSet { save("mp4Landscape", mp4Landscape) } }

  var showMode: ShowMode { didSet { save("showMode", showMode.rawValue) } }
  /// A multiplier on the reader's type, on top of the system's Dynamic Type size.
  var textScale: Double { didSet { save("textScale", textScale) } }
  var textWeight: Int { didSet { save("textWeight", textWeight) } } // 0 regular · 1 semibold · 2 bold
  var highContrast: Bool { didSet { save("highContrast", highContrast) } }
  var haptics: Bool { didSet { save("haptics", haptics) } }
  var keepAwake: Bool { didSet { save("keepAwake", keepAwake) } }

  /// Listen: the translation spoken in headphones. Remembered, so a person who listens does not turn it on every talk.
  var listen: Bool { didSet { save("listen", listen) } }
  var speechRate: Double { didSet { save("speechRate", speechRate) } }
  /// The voice chosen for each subtitle language, by the system's identifier.
  var voiceIds: [String: String] { didSet { save("voiceIds", voiceIds) } }

  var language: String { didSet { save("language", language); Localizer.language = language } }
  var appearance: String { didSet { save("appearance", appearance) } } // system · dark · light
  var demo: Bool { didSet { save("demo", demo) } }
  var firstRunDone: Bool { didSet { save("firstRunDone", firstRunDone) } }
  var recentReplies: [String] { didSet { save("recentReplies", recentReplies) } }

  init(store: UserDefaults = .standard) {
    self.store = store
    let schema = LiveSchema.shared
    source = store.string(forKey: "source") ?? schema.defaults.source
    target = store.string(forKey: "target") ?? schema.defaults.target
    transModel = store.string(forKey: "transModel") ?? schema.coerceModel(nil)
    vadSilenceTime = store.object(forKey: "vadSilenceTime") as? Int ?? 700 // a pause of 700 ms ends a line (CLAUDE.md, the split pipeline)
    maxSpeakTime = store.object(forKey: "maxSpeakTime") as? Int ?? 6 // and nothing runs past 6 s
    noiseThreshold = store.object(forKey: "noiseThreshold") as? Double ?? schema.tuning.noiseThreshold.default
    filterModal = store.string(forKey: "filterModal") ?? "0"
    recordOnStart = store.object(forKey: "recordOnStart") as? Bool ?? true
    bitRate = store.object(forKey: "bitRate") as? Int ?? 96_000
    autoMP4 = store.bool(forKey: "autoMP4")
    mp4Landscape = store.bool(forKey: "mp4Landscape")
    showMode = ShowMode(rawValue: store.string(forKey: "showMode") ?? "") ?? .both
    textScale = store.object(forKey: "textScale") as? Double ?? 1.0
    textWeight = store.object(forKey: "textWeight") as? Int ?? 1
    highContrast = store.bool(forKey: "highContrast")
    haptics = store.object(forKey: "haptics") as? Bool ?? true
    keepAwake = store.object(forKey: "keepAwake") as? Bool ?? true
    listen = store.bool(forKey: "listen")
    speechRate = store.object(forKey: "speechRate") as? Double ?? SpeechQueue.defaults.rate
    voiceIds = store.dictionary(forKey: "voiceIds") as? [String: String] ?? [:]
    language = store.string(forKey: "language") ?? "system"
    appearance = store.string(forKey: "appearance") ?? "system"
    demo = store.bool(forKey: "demo")
    firstRunDone = store.bool(forKey: "firstRunDone")
    recentReplies = store.stringArray(forKey: "recentReplies") ?? []
    Localizer.language = language
  }

  private func save(_ key: String, _ value: Any) { store.set(value, forKey: key) }

  var colorScheme: ColorScheme? { appearance == "dark" ? .dark : appearance == "light" ? .light : nil }

  /// The pair, kept to what the relay accepts: choosing a spoken language narrows the subtitle language.
  func setSource(_ next: String) {
    source = LiveSchema.shared.coerceSource(next)
    target = LiveSchema.shared.coerceTarget(source: source, target: target)
  }

  func relayOptions(hotwords: String) -> RelayOptions {
    RelayOptions(source: source, target: target, transModel: transModel, hotwords: hotwords, vadSilenceTime: vadSilenceTime,
                 maxSpeakTime: maxSpeakTime, noiseThreshold: noiseThreshold, filterModal: filterModal)
  }

  func remember(reply: String) {
    recentReplies = ([reply] + recentReplies.filter { $0 != reply }).prefix(6).map { $0 }
  }
}
