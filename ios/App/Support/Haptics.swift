import UIKit

/// What the phone says to a hand: a light tap when a sentence settles, a double one when subtitles stop. Lets a
/// reader watch the speaker and feel when to look down.
@MainActor
enum Haptics {
  private static let light = UIImpactFeedbackGenerator(style: .light)
  private static let notice = UINotificationFeedbackGenerator()

  static func sentence() { light.impactOccurred(intensity: 0.7) }
  static func trouble() { notice.notificationOccurred(.warning) }
  static func done() { notice.notificationOccurred(.success) }
}
