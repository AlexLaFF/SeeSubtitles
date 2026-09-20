import ActivityKit
import Foundation
import SubtitlesCore

/// Keeps the lock screen and the Dynamic Island in step with the talk: a new sentence when one settles, a new
/// word when the state changes. The system limits how often an activity may change, so drafts are not sent —
/// a sentence appears there once, when it is finished.
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

  func show(text: String, original: String) { state.text = text; state.original = original; send() }
  func show(status: String, tone: Int) { guard state.status != status || state.tone != tone else { return }; state.status = status; state.tone = tone; send() }

  /// At most one change a second: the newest state wins.
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
