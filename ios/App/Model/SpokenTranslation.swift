import AVFoundation
import SubtitlesCore
import SwiftUI

/// The translation, spoken into headphones a sentence at a time: the queue that decides (SpeechQueue, the same
/// rules as the Mac's web/speak.js) and the system's voice that says it. One per talk.
@MainActor @Observable
final class SpokenTranslation {
  enum Status: Equatable { case off, needsHeadphones, nothingToSay, ready, speaking(behind: Int) }

  private var queue = SpeechQueue()
  private let voice: any SpeechVoice
  private let prefs: Preferences
  /// On your own talk the microphone is open, so the voice must not reach it. A joined talk has no microphone.
  private let headphonesOnly: Bool
  @ObservationIgnored nonisolated(unsafe) private var routeObserver: NSObjectProtocol? // set once in init, read once in deinit
  private(set) var language: String
  private(set) var sourceLanguage: String
  private(set) var status: Status = .off
  private(set) var spoken = 0
  private(set) var skipped = 0

  init(prefs: Preferences, source: String, target: String, headphonesOnly: Bool, voice: (any SpeechVoice)? = nil) {
    self.prefs = prefs; self.sourceLanguage = source; self.language = target; self.headphonesOnly = headphonesOnly
    // -SilentVoice YES: UI tests run the whole of Listen without a sound (a simulator speaks through the Mac)
    self.voice = voice ?? (UserDefaults.standard.bool(forKey: "SilentVoice") ? SilentVoice() : SystemVoice())
    routeObserver = NotificationCenter.default.addObserver(forName: AVAudioSession.routeChangeNotification, object: nil, queue: .main) { [weak self] _ in
      MainActor.assumeIsolated { self?.routeChanged() }
    }
  }

  var isOn: Bool { queue.isOn }
  /// Nothing to say when the subtitles are the words as spoken.
  var hasSomethingToSay: Bool { language != sourceLanguage }
  /// UI tests, and anyone who knows what they are doing: -SpeakWithoutHeadphones YES
  private var routeAllows: Bool { !headphonesOnly || AudioRoute.isPrivate || UserDefaults.standard.bool(forKey: "SpeakWithoutHeadphones") }

  func setLanguages(source: String, target: String) { sourceLanguage = source; language = target; refresh() }

  func turnOn(existing ids: [String]) {
    guard hasSomethingToSay else { status = .nothingToSay; return }
    var options = SpeechQueue.defaults
    options.rate = prefs.speechRate
    queue = SpeechQueue(options: options)
    queue.start(existing: ids)
    if !headphonesOnly { try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .spokenAudio); try? AVAudioSession.sharedInstance().setActive(true) }
    refresh()
  }

  func turnOff() {
    queue.stop()
    voice.stop()
    status = .off
  }

  func offer(_ line: TranscriptLine) {
    guard queue.isOn else { return }
    // Without headphones a sentence is not held for later: by the time they are in, it is the past.
    guard routeAllows else { queue.start(existing: [line.id]); refresh(); return }
    queue.offer(line)
    pump()
  }

  private func pump() {
    guard routeAllows, let item = queue.next() else { return refresh() }
    voice.speak(item.text, language: language, voiceId: prefs.voiceIds[language], rate: item.rate) { [weak self] in
      guard let self else { return }
      self.queue.finished(item.id)
      self.pump()
    }
    refresh()
  }

  private func routeChanged() {
    guard queue.isOn else { return }
    if !routeAllows { voice.stop() } // the headphones came out: not one more word through the speaker
    refresh()
  }

  private func refresh() {
    spoken = queue.spoken; skipped = queue.skipped
    status = !queue.isOn ? (status == .nothingToSay ? .nothingToSay : .off) : !routeAllows ? .needsHeadphones : queue.behind > 0 ? .speaking(behind: queue.behind) : .ready
  }

  deinit { if let routeObserver { NotificationCenter.default.removeObserver(routeObserver) } }
}
