import AVFoundation

/// Something that can say a sentence. The real one is the system's; tests use one that only remembers.
@MainActor
public protocol SpeechVoice: AnyObject {
  /// Say `text`. `done` is called once, when it has been said, failed, or been cut short by `stop()`.
  func speak(_ text: String, language: String, voiceId: String?, rate: Double, done: @escaping @MainActor () -> Void)
  func stop()
}

/// Says nothing, and takes a moment over it. What UI tests listen to — a simulator speaks through the Mac's own
/// loudspeakers — and what a test of the queue's driver needs: every sentence "said", in order, remembered.
@MainActor
public final class SilentVoice: SpeechVoice {
  public private(set) var said: [(text: String, language: String, rate: Double)] = []
  private let seconds: Double
  private var generation = 0
  public init(secondsPerSentence: Double = 0.4) { seconds = secondsPerSentence }

  public func speak(_ text: String, language: String, voiceId: String?, rate: Double, done: @escaping @MainActor () -> Void) {
    said.append((text, language, rate))
    let mine = generation
    Task { @MainActor in
      try? await Task.sleep(for: .seconds(seconds / rate))
      if mine == self.generation { done() }
    }
    pending = done
  }

  private var pending: (@MainActor () -> Void)?
  public func stop() { generation += 1; let done = pending; pending = nil; done?() }
}

/// A voice on this device that can read a language.
public struct VoiceChoice: Sendable, Equatable, Identifiable {
  public let id: String
  public let name: String
  public let language: String
  /// 0 default · 1 enhanced · 2 premium · below zero for the robotic and novelty voices. Better ones are downloaded in
  /// Settings › Accessibility › Spoken Content.
  public let quality: Int
}

/// The system's own voices (AVSpeechSynthesizer): free, instant, offline, and they keep speaking with the screen
/// locked. Plays through the app's audio session, so it shares the route — the headphones — with nothing else to set up.
@MainActor
public final class SystemVoice: NSObject, SpeechVoice, AVSpeechSynthesizerDelegate {
  private let synthesizer = AVSpeechSynthesizer()
  private var completions: [ObjectIdentifier: @MainActor () -> Void] = [:]

  public override init() {
    super.init()
    synthesizer.delegate = self
  }

  /// The voices that can read `language` (a talk's code: "en", "yue"), best first. Mandarin is never read in a
  /// Cantonese voice, nor the other way round: Chinese must match its region exactly.
  public static func voices(for language: String) -> [VoiceChoice] {
    let want = SpeechQueue.voiceLanguage(language).lowercased()
    let base = want.split(separator: "-").first.map(String.init) ?? want
    return AVSpeechSynthesisVoice.speechVoices()
      .filter { v in let l = v.language.lowercased(); return l == want || (base != "zh" && l.split(separator: "-").first.map(String.init) == base) }
      .map { v in VoiceChoice(id: v.identifier, name: v.name, language: v.language, quality: SpeechQueue.isQuirky(name: v.name, identifier: v.identifier) ? -8 : v.quality == .premium ? 2 : v.quality == .enhanced ? 1 : 0) }
      .sorted { a, b in
        let sa = (a.language.lowercased() == want ? 4 : 0) + a.quality, sb = (b.language.lowercased() == want ? 4 : 0) + b.quality
        return sa != sb ? sa > sb : a.name < b.name
      }
  }

  /// A multiple of normal speed → AVSpeechUtterance's 0…1 scale, where 0.5 is normal and the top end is far
  /// faster than double. A quarter of the scale per doubling keeps 1.6× brisk rather than frantic.
  static func utteranceRate(_ multiple: Double) -> Float {
    let rate = Double(AVSpeechUtteranceDefaultSpeechRate) + (multiple - 1) * 0.25
    return Float(min(Double(AVSpeechUtteranceMaximumSpeechRate), max(Double(AVSpeechUtteranceMinimumSpeechRate), rate)))
  }

  public func speak(_ text: String, language: String, voiceId: String?, rate: Double, done: @escaping @MainActor () -> Void) {
    let utterance = AVSpeechUtterance(string: text)
    utterance.voice = voiceId.flatMap(AVSpeechSynthesisVoice.init(identifier:)) ?? Self.voices(for: language).first.flatMap { AVSpeechSynthesisVoice(identifier: $0.id) }
      ?? AVSpeechSynthesisVoice(language: SpeechQueue.voiceLanguage(language))
    utterance.rate = Self.utteranceRate(rate)
    utterance.postUtteranceDelay = 0.05
    completions[ObjectIdentifier(utterance)] = done
    synthesizer.speak(utterance)
  }

  public func stop() { synthesizer.stopSpeaking(at: .immediate) }

  private func finish(_ utterance: AVSpeechUtterance) {
    if let done = completions.removeValue(forKey: ObjectIdentifier(utterance)) { done() }
  }

  public nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
    nonisolated(unsafe) let u = utterance
    Task { @MainActor in self.finish(u) }
  }

  public nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
    nonisolated(unsafe) let u = utterance
    Task { @MainActor in self.finish(u) }
  }
}

/// Where sound would come out right now.
public enum AudioRoute {
  /// Whether only the person holding the phone would hear it: headphones, wired or Bluetooth. A Bluetooth
  /// loudspeaker looks the same from here, which is why the app also says "headphones only" in words.
  public static var isPrivate: Bool {
    #if os(iOS)
    let personal: Set<AVAudioSession.Port> = [.headphones, .bluetoothA2DP, .bluetoothLE, .bluetoothHFP, .usbAudio]
    return AVAudioSession.sharedInstance().currentRoute.outputs.contains { personal.contains($0.portType) }
    #else
    return true
    #endif
  }

  /// "AirPods Pro", or nil when the output is the phone itself.
  public static var privateOutputName: String? {
    #if os(iOS)
    return isPrivate ? AVAudioSession.sharedInstance().currentRoute.outputs.first?.portName : nil
    #else
    return nil
    #endif
  }
}
