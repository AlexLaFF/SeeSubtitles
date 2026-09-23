import ActivityKit
import Foundation
import SubtitlesCore

/// Keeps the lock screen and the Dynamic Island in step with the talk: the sentence being spoken as it grows, a
/// new word when the state changes. The system limits how often an activity may change, so a growing sentence is
/// sent at most every three seconds and a settled one, or a change of state, within a second.
@MainActor
final class TalkActivityController {
  private var activity: Activity<TalkActivityAttributes>?
  private var state = TalkActivityAttributes.ContentState(text: "", original: "", status: "", tone: 0)
  private var lastSent = Date.distantPast
  private var pending: Task<Void, Never>?
  private static let draftGap: TimeInterval = 3

  func start(startedAt: Date, pair: String, status: String, tone: Int) {
    guard ActivityAuthorizationInfo().areActivitiesEnabled else { return }
    state = .init(text: "", original: "", status: status, tone: tone)
    let attributes = TalkActivityAttributes(startedAt: startedAt, pair: pair, stopLabel: L("ios.live.stop"))
    activity = try? Activity.request(attributes: attributes, content: ActivityContent(state: state, staleDate: nil))
  }

  func show(text: String, original: String, draft: Bool = false) { state.text = text; state.original = original; send(gap: draft ? Self.draftGap : 1) }
  func show(status: String, tone: Int) { guard state.status != status || state.tone != tone else { return }; state.status = status; state.tone = tone; send(gap: 1) }

  /// At most one change per `gap` seconds: the newest state wins.
  private func send(gap: TimeInterval) {
    guard let activity else { return }
    pending?.cancel()
    let wait = max(0, gap - Date().timeIntervalSince(lastSent))
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
