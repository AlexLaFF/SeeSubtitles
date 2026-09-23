import SubtitlesCore
import SwiftUI

/// One talk, as the Live screen sees it.
@MainActor @Observable
final class LiveModel {
  private let session: TalkSession
  private weak var app: AppModel?
  let isRecording: Bool

  private(set) var lines: [TranscriptLine] = []
  private(set) var phase: TalkPhase = .starting
  private(set) var startedAt = Date()
  private(set) var finished: RecordingInfo?
  /// Sentences that have settled since the reader last looked at the newest one.
  var unseen = 0
  private var indexById: [String: Int] = [:]
  private let activity = TalkActivityController()
  /// The translation, spoken. Made when the talk starts; on when the person has Listen on.
  private(set) var spoken: SpokenTranslation?
  private var stopObserver: NSObjectProtocol?

  init(session: TalkSession, recording: Bool, app: AppModel) {
    self.session = session; self.isRecording = recording; self.app = app
  }

  var isOver: Bool { if case .ended = phase { true } else if case .refused = phase { true } else { false } }
  var sentences: Int { lines.filter { $0.kind == .speech && $0.ended }.count }

  func start() async throws {
    startedAt = Date()
    UIApplication.shared.isIdleTimerDisabled = app?.prefs.keepAwake ?? true
    Task { [weak self, session] in
      for await event in session.events { self?.handle(event) }
    }
    do { try await session.start() } catch { UIApplication.shared.isIdleTimerDisabled = false; phase = .ended; throw error }
    let schema = LiveSchema.shared
    let pair = "\(schema.name(of: app?.prefs.source ?? "").native) → \(schema.name(of: app?.prefs.target ?? "").native)"
    activity.start(startedAt: startedAt, pair: pair, status: L("ios.status.connecting"), tone: 0)
    if let prefs = app?.prefs {
      let spoken = SpokenTranslation(prefs: prefs, source: prefs.source, target: prefs.target, headphonesOnly: true)
      self.spoken = spoken
      if prefs.listen { spoken.turnOn(existing: []) }
    }
    // Stop, pressed on the lock screen
    stopObserver = NotificationCenter.default.addObserver(forName: StopTalkIntent.notification, object: nil, queue: .main) { [weak self] _ in
      MainActor.assumeIsolated { Task { await self?.stop() } }
    }
  }

  private func showOnLockScreen(_ next: TalkPhase) {
    switch next {
    case .starting: activity.show(status: L("ios.status.connecting"), tone: 0)
    case .listening: activity.show(status: isRecording ? L("ios.status.recording") : L("ios.status.listening"), tone: isRecording ? 1 : 0)
    case .reconnecting: activity.show(status: L("ios.status.reconnecting"), tone: 2)
    case .interrupted: activity.show(status: L("ios.status.interrupted"), tone: 2)
    case .refused, .ended: activity.end()
    }
  }

  private func handle(_ event: TalkEvent) {
    switch event {
    case .phase(let next):
      let was = phase
      if case .refused = was { return } // a refusal is the last word; the clean-up that follows it is not news
      phase = next
      showOnLockScreen(next)
      if case .refused = next { Task { await discardRefused() } }
      guard app?.prefs.haptics == true else { return }
      switch next {
      case .reconnecting, .interrupted, .refused: if was == .listening || was == .starting { Haptics.trouble() }
      default: break
      }
    case .line(let line, _):
      if let i = indexById[line.id] {
        let settled = line.ended && !lines[i].ended
        lines[i] = line
        if settled { didSettle() }
      } else {
        indexById[line.id] = lines.count
        lines.append(line)
        if line.ended, line.kind == .speech { didSettle() }
      }
      if line.kind == .speech { showOnLockScreen() }
    case .notice:
      break
    }
  }

  func setListening(_ on: Bool) {
    app?.prefs.listen = on
    if on { spoken?.turnOn(existing: lines.map(\.id)) } else { spoken?.turnOff() }
  }

  private func didSettle() {
    unseen += 1
    if let settled = lines.last(where: { $0.kind == .speech && $0.ended }) { spoken?.offer(settled) }
    if app?.prefs.haptics == true { Haptics.sentence() }
  }

  /// The lock screen: the running text of the last sentences, the one being spoken included, in what the reader
  /// chose to see — and the words as spoken under it when both are shown.
  private func showOnLockScreen() {
    let recent = lines.suffix(12).filter { $0.kind == .speech }
    let mode = app?.prefs.showMode
    let main = recent.map { mode == .source ? $0.sourceText : $0.display }
    let original = mode == .both ? recent.map { $0.targetText.isEmpty || $0.targetText == $0.sourceText ? "" : $0.sourceText } : []
    activity.show(text: RunningText.join(main), original: RunningText.join(original))
  }

  /// A talk the server refused recorded nothing worth keeping: end it and take its empty folder away.
  private func discardRefused() async {
    spoken?.turnOff()
    UIApplication.shared.isIdleTimerDisabled = false
    guard let info = await session.stop(), info.cues == 0 else { return }
    try? FileManager.default.removeItem(at: info.folder)
    app?.refreshLibrary()
  }

  /// Settings › Recording › "Make an MP4 when a talk ends": the same export the Files tab offers, begun unasked.
  private func makeMP4(of info: RecordingInfo) {
    guard let app, let recording = app.library.recording(id: info.id), let audio = recording.audio else { return }
    let (target, source) = recording.cues()
    var options: MP4Exporter.Options = app.prefs.mp4Landscape ? .landscape : .portrait
    options.showBoth = app.prefs.showMode == .both
    let out = recording.folder.appendingPathComponent(RecordingNames.fileName(info.base, .mp4))
    Task { [weak app] in
      try? await MP4Exporter().export(audio: audio, target: target, source: source, to: out, options: options)
      app?.refreshLibrary()
    }
  }

  func reply(_ text: String) async {
    let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else { return }
    app?.prefs.remember(reply: trimmed)
    await session.reply(trimmed)
  }

  func stop() async {
    guard !isOver || finished == nil else { return }
    let info = await session.stop()
    // nothing was said and nothing was kept: not a recording, just a Start pressed by mistake
    if let info, info.cues == 0, !info.hasAudio || info.durationMs < 1500, !lines.contains(where: { $0.kind == .reply }) {
      try? FileManager.default.removeItem(at: info.folder)
    } else {
      finished = info
    }
    phase = .ended
    spoken?.turnOff()
    activity.end()
    if let stopObserver { NotificationCenter.default.removeObserver(stopObserver) }
    UIApplication.shared.isIdleTimerDisabled = false
    if app?.prefs.haptics == true { Haptics.done() }
    app?.refreshLibrary()
    Task { await app?.refreshAccount() } // the month's hours just moved
    if app?.prefs.autoMP4 == true, let info = finished, info.hasAudio, info.cues > 0 { makeMP4(of: info) }
  }
}
