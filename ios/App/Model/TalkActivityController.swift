import ActivityKit
import Foundation
import SubtitlesCore

/// Keeps the lock screen and the Dynamic Island in step with the talk. What it shows is the tail of the running
/// transcript — the sentences just said and the one being said, run together — so it reads like a strip of text
/// moving on, and a sentence too short to outlast an update is still there in the next one, just further up.
/// The system rations an activity's changes: at most one a second, the newest state winning.
@MainActor
final class TalkActivityController {
  private var activity: Activity<TalkActivityAttributes>?
  private var state = TalkActivityAttributes.ContentState(text: "", original: "", status: "", tone: 0)
  private var lastSent = Date.distantPast
  private var pending: Task<Void, Never>?

  func start(startedAt: Date, pair: String, status: String, tone: Int) {
    guard ActivityAuthorizationInfo().areActivitiesEnabled else { return }
    state = .init(text: "", original: "", status: status, tone: tone)
    let attributes = TalkActivityAttributes(startedAt: startedAt, pair: pair, stopLabel: L("ios.live.stop"))
    activity = try? Activity.request(attributes: attributes, content: ActivityContent(state: state, staleDate: nil))
  }

  func show(text: String, original: String) {
    guard state.text != text || state.original != original else { return }
    state.text = text; state.original = original; send()
  }
  func show(status: String, tone: Int) { guard state.status != status || state.tone != tone else { return }; state.status = status; state.tone = tone; send() }

  private func send() {
    guard let activity else { return }
    pending?.cancel()
    let wait = max(0, 1 - Date().timeIntervalSince(lastSent))
    nonisolated(unsafe) let target = activity // ActivityKit's own object; it is only ever touched from here
    pending = Task { [state] in
      if wait > 0 { try? await Task.sleep(for: .seconds(wait)) }
      guard !Task.isCancelled else { return }
      lastSent = Date()
      await target.update(ActivityContent(state: state, staleDate: nil))
    }
  }

  func end() {
    pending?.cancel()
    guard let activity else { return }
    self.activity = nil
    nonisolated(unsafe) let target = activity
    Task { await target.end(nil, dismissalPolicy: .immediate) }
  }
}
