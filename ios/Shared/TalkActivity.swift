import ActivityKit
import AppIntents
import Foundation

/// A talk, as the lock screen and the Dynamic Island show it: how long it has run, and the sentence just spoken.
/// Compiled into the app, which starts and updates it, and into the widget extension, which draws it. The words
/// for the few labels travel with it, because the extension has no string catalogue of its own: the app says them
/// in the language the person chose.
struct TalkActivityAttributes: ActivityAttributes {
  struct ContentState: Codable, Hashable {
    /// The newest sentence: the subtitle, and under it the words as spoken when both are shown.
    var text: String
    var original: String
    /// "recording", "listening", "reconnecting", "paused · call" — already in the person's language.
    var status: String
    /// 0 ok · 1 recording · 2 attention
    var tone: Int
  }

  var startedAt: Date
  /// "粤语 → 普通话"
  var pair: String
  var stopLabel: String
}

/// The Stop control on the lock screen. It runs in the app, which is alive for as long as a talk is: the app
/// listens for this and ends the talk exactly as its own Stop button does.
struct StopTalkIntent: LiveActivityIntent {
  static let title: LocalizedStringResource = "Stop"
  static let notification = Notification.Name("SeeSubtitles.StopTalk")
  func perform() async throws -> some IntentResult {
    await MainActor.run { NotificationCenter.default.post(name: Self.notification, object: nil) }
    return .result()
  }
}
