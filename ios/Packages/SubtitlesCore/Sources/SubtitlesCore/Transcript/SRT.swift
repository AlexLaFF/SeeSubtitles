import Foundation

/// A subtitle cue, in milliseconds from the start of the recording.
public struct Cue: Codable, Sendable, Equatable {
  public var start: Int
  public var end: Int
  public var text: String
  public init(start: Int, end: Int, text: String) { self.start = start; self.end = end; self.text = text }
}

public enum SRT {
  /// 3723004 → "01:02:03,004"
  public static func time(_ ms: Int) -> String {
    let t = max(0, ms)
    return String(format: "%02d:%02d:%02d,%03d", t / 3_600_000, (t / 60_000) % 60, (t / 1000) % 60, t % 1000)
  }

  /// One block of an SRT file, as core/recorder.js writes it: a cue is never shorter than 300 ms.
  public static func block(number: Int, cue: Cue) -> String {
    let start = max(0, cue.start)
    return "\(number)\n\(time(start)) --> \(time(max(cue.end, start + 300)))\n\(cue.text)\n\n"
  }

  public static func file(_ cues: [Cue]) -> String {
    cues.enumerated().map { block(number: $0.offset + 1, cue: $0.element) }.joined()
  }

  /// Reads what any of our writers wrote, and the looser files other tools make: CRLF, a BOM, a missing number
  /// line, a full stop for the milliseconds.
  public static func parse(_ text: String) -> [Cue] {
    var cues: [Cue] = []
    let clean = text.replacingOccurrences(of: "\u{FEFF}", with: "").replacingOccurrences(of: "\r", with: "")
    let timing = /(\d+):(\d+):(\d+)[,.](\d+)\s*-->\s*(\d+):(\d+):(\d+)[,.](\d+)/
    for block in clean.components(separatedBy: "\n\n") {
      let lines = block.split(separator: "\n", omittingEmptySubsequences: true).map(String.init)
      guard let at = lines.firstIndex(where: { $0.contains("-->") }), let m = try? timing.firstMatch(in: lines[at]) else { continue }
      func ms(_ h: Substring, _ mi: Substring, _ s: Substring, _ f: Substring) -> Int { ((Int(h)! * 60 + Int(mi)!) * 60 + Int(s)!) * 1000 + Int(f)! }
      let body = lines[(at + 1)...].joined(separator: " ")
      guard !body.isEmpty else { continue }
      cues.append(Cue(start: ms(m.1, m.2, m.3, m.4), end: ms(m.5, m.6, m.7, m.8), text: body))
    }
    return cues
  }
}

/// Text without its timing: what "copy the transcript" and the .plain.txt sidecars hold. A port of core/plain-text.js.
public enum PlainText {
  public static func clean(_ text: String) -> String {
    text.replacing(/<\/?(?:b|i|u|font)(?:\s[^>]*)?>/.ignoresCase(), with: "")
      .replacing(/\{\\[^}]*\}/, with: "")
      .replacing(/\s+/, with: " ")
      .trimmingCharacters(in: .whitespaces)
  }

  /// One line per text, empty ones dropped, a newline at the end when there is anything at all.
  public static func from(_ texts: [String]) -> String {
    let lines = texts.map(clean).filter { !$0.isEmpty }
    return lines.isEmpty ? "" : lines.joined(separator: "\n") + "\n"
  }
}
