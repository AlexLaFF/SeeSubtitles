import Foundation

/// A string from the catalogue. Every string the app shows is written once, in web/locales.js, in English and
/// Simplified Chinese; this looks it up in the language the person chose (Settings › Language) or the system's.
/// `{name}` placeholders are filled from `values`. scripts/check-strings.mjs fails the build for a key that is
/// not in the catalogue.
func L(_ key: String, _ values: [String: String] = [:]) -> String {
  var text = Localizer.bundle.localizedString(forKey: key, value: nil, table: nil)
  for (name, value) in values { text = text.replacingOccurrences(of: "{\(name)}", with: value) }
  return text
}

enum Localizer {
  /// "system", "en" or "zh-Hans".
  nonisolated(unsafe) static var language = "system" { didSet { bundle = resolve() } }
  nonisolated(unsafe) private(set) static var bundle: Bundle = resolve()

  private static func resolve() -> Bundle {
    guard language != "system", let path = Bundle.main.path(forResource: language, ofType: "lproj"), let bundle = Bundle(path: path) else { return .main }
    return bundle
  }

  /// Whether the interface is in Chinese right now: names of languages put their own script first either way,
  /// but a few layouts (the pair line) choose which half to show.
  static var isChinese: Bool {
    let code = language == "system" ? (Bundle.main.preferredLocalizations.first ?? "en") : language
    return code.hasPrefix("zh")
  }
}

/// 754 → "12:34"; 3754 → "1:02:34". For clocks that run.
func clock(_ seconds: Int) -> String {
  let s = max(0, seconds)
  return s >= 3600 ? String(format: "%d:%02d:%02d", s / 3600, (s / 60) % 60, s % 60) : String(format: "%02d:%02d", s / 60, s % 60)
}

/// 121680 s → "33:48" hours and minutes, for the month's usage.
func hoursMinutes(_ seconds: Double) -> String {
  let m = Int(seconds / 60)
  return String(format: "%d:%02d", m / 60, m % 60)
}
