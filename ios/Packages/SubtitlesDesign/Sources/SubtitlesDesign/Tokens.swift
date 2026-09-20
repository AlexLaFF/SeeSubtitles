import SwiftUI
import UIKit

/// The colours of design/tokens/marquee.css, both appearances. Warm charcoal like a darkened hall, the yellow of a
/// cinema subtitle as the one accent, a red on-air light. The accent appears in three places only: the primary
/// action, the active tab, and marks of "this is happening now". Status is a dot and a word, never a colour alone.
public extension Color {
  private init(light: UInt32, dark: UInt32, lightAlpha: CGFloat = 1, darkAlpha: CGFloat = 1) {
    self.init(uiColor: UIColor { traits in
      let (hex, alpha) = traits.userInterfaceStyle == .dark ? (dark, darkAlpha) : (light, lightAlpha)
      return UIColor(red: CGFloat((hex >> 16) & 0xff) / 255, green: CGFloat((hex >> 8) & 0xff) / 255, blue: CGFloat(hex & 0xff) / 255, alpha: alpha)
    })
  }

  static let mqBackground = Color(light: 0xf5f2eb, dark: 0x191816)
  static let mqSide = Color(light: 0xede9e0, dark: 0x131210)
  static let mqSurface = Color(light: 0xfffdf7, dark: 0x21201d)
  static let mqSurface2 = Color(light: 0xf2eee5, dark: 0x2b2926)
  static let mqLine = Color(light: 0xe0dbcf, dark: 0x35322d)
  static let mqLineStrong = Color(light: 0xc4bdae, dark: 0x4a463f)
  static let mqText = Color(light: 0x1c1a16, dark: 0xf1ece2)
  static let mqText2 = Color(light: 0x6a6458, dark: 0xaca496)
  static let mqText3 = Color(light: 0x948d80, dark: 0x7d766c)
  static let mqAccent = Color(light: 0xf5c518, dark: 0xf5c518)
  static let mqOnAccent = Color(light: 0x1a1500, dark: 0x1a1500)
  static let mqAccentSoft = Color(light: 0xf5c518, dark: 0xf5c518, lightAlpha: 0.22, darkAlpha: 0.14)
  /// The accent where it is text: yellow does not read on paper, so the light appearance darkens it.
  static let mqAccentText = Color(light: 0x8f6a00, dark: 0xf5c518)
  static let mqOk = Color(light: 0x1f9a4a, dark: 0x3ec26a)
  static let mqWarn = Color(light: 0xc76a00, dark: 0xff8f1f)
  static let mqBad = Color(light: 0xc62828, dark: 0xff5a5a)
  static let mqRec = Color(light: 0xd3232a, dark: 0xff453a)
}

/// Type on iOS is the system's — SF Pro and PingFang SC — so Dynamic Type, VoiceOver and every script behave.
/// The tiers of the design language, a step larger than the Mac's because a finger is not a pointer.
public extension Font {
  static let mqViewTitle = Font.largeTitle.weight(.bold)
  static let mqSection = Font.headline
  static let mqBody = Font.body
  static let mqSecondary = Font.subheadline
  static let mqHint = Font.footnote
  /// Timestamps and counters: monospaced digits, so a running clock does not jitter.
  static let mqMono = Font.footnote.monospaced()
  /// The wordmark and the one sentence an empty screen says. The system's serif, italic: the voice of the brand
  /// without a font to bundle.
  static func mqDisplay(_ style: Font.TextStyle = .largeTitle) -> Font { .system(style, design: .serif).italic() }
}

public enum Spacing {
  public static let s1: CGFloat = 4, s2: CGFloat = 8, s3: CGFloat = 12, s4: CGFloat = 16, s5: CGFloat = 24, s6: CGFloat = 32
}
