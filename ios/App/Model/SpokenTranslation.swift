import AVFoundation
import SubtitlesCore
import SwiftUI

/// The translation, spoken into headphones a sentence at a time. The rules are the core's (SpeechQueue, the same as
/// the Mac's web/speak.js) and so is the driver; this is where they meet the phone: the person's chosen voice and
/// speed, the audio route, and the screen. One per talk.
@MainActor @Observable
final class SpokenTranslation {
  typealias Status = SpeechDriver.Status

  private let driver: SpeechDriver
  private let prefs: Preferences
  /// On your own talk the microphone is open, so the voice must not reach it. A joined talk has no microphone.
  private let headphonesOnly: Bool
  @ObservationIgnored nonisolated(unsafe) private var routeObserver: NSObjectProtocol? // set once in init, read once in deinit
  private(set) var language: String
  private(set) var sourceLanguage: String
  private(set) var status: Status = .off
  private(set) var spoken = 0
  private(set) var skipped = 0

  init(prefs: Preferences, source: String, target: String, headphonesOnly: Bool) {
    self.prefs = prefs; self.sourceLanguage = source; self.language = target; self.headphonesOnly = headphonesOnly
    // -SilentVoice YES: UI tests run the whole of Listen without a sound (a simulator speaks through the Mac).
    // -SpeakWithoutHeadphones YES: a simulator has no headphones to put in.
    let voice: any SpeechVoice = UserDefaults.standard.bool(forKey: "SilentVoice") ? SilentVoice() : SystemVoice()
    driver = SpeechDriver(voice: voice, language: target) { !headphonesOnly || AudioRoute.isPrivate || UserDefaults.standard.bool(forKey: "SpeakWithoutHeadphones") }
    driver.onChange = { [weak self] in self?.refresh() }
    routeObserver = NotificationCenter.default.addObserver(forName: AVAudioSession.routeChangeNotification, object: nil, queue: .main) { [weak self] _ in
      MainActor.assumeIsolated { self?.driver.routeChanged() }
    }
  }

  /// Read from `status`, which is observed: the driver is not, and a screen that asked it directly would never redraw.
  var isOn: Bool { status != .off }
  /// Nothing to say when the subtitles are the words as spoken.
  var hasSomethingToSay: Bool { language != sourceLanguage }

  func setLanguages(source: String, target: String) { sourceLanguage = source; language = target; driver.language = target; refresh() }

  func turnOn(existing ids: [String]) {
    guard hasSomethingToSay else { return }
    // a joined talk has no microphone open, so the session is simply for playing
    if !headphonesOnly { try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .spokenAudio); try? AVAudioSession.sharedInstance().setActive(true) }
    driver.voiceId = prefs.voiceIds[language]
    driver.turnOn(existing: ids, rate: prefs.speechRate)
  }

  func turnOff() { driver.turnOff() }
  func offer(_ line: TranscriptLine) { driver.voiceId = prefs.voiceIds[language]; driver.offer(line) }

  private func refresh() { status = driver.status; spoken = driver.spoken; skipped = driver.skipped }

  deinit { if let routeObserver { NotificationCenter.default.removeObserver(routeObserver) } }
}
