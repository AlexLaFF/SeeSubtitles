import Foundation

/// The last few sentences of a talk run together, the newest last — what the lock screen shows, laid out in full
/// and pinned to its last line, so the newest words are always at the bottom right. Enough text to fill the lines
/// several times over, and short of ActivityKit's 4 KB for a state.
public enum RunningText {
  public static func join(_ parts: [String], limit: Int = 240) -> String {
    var out = ""
    for part in parts.reversed() {
      let p = part.trimmingCharacters(in: .whitespacesAndNewlines)
      guard !p.isEmpty else { continue }
      out = out.isEmpty ? p : p + (tight(p.last!, out.first!) ? "" : " ") + out
      if out.count >= limit { break }
    }
    return out.count > limit * 2 ? String(out.suffix(limit * 2)) : out
  }

  /// Chinese and Japanese run on without a space; everything else gets one.
  static func tight(_ a: Character, _ b: Character) -> Bool { cjk(a) || cjk(b) }
  static func cjk(_ c: Character) -> Bool {
    guard let v = c.unicodeScalars.first?.value else { return false }
    return (0x2E80...0x9FFF).contains(v) || (0xF900...0xFAFF).contains(v) || (0xFF00...0xFFEF).contains(v) || (0x3000...0x303F).contains(v)
  }
}
