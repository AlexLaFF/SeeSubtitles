import Foundation

/// How a recording's files are named: a port of the Chinese naming in core/names.js, so a recording saved from
/// the phone sits beside one from the Mac and reads the same.
///
///     9月5号14点33分录音.m4a          the audio (the Mac writes 录音.mp3)
///     9月5号14点33分中文字幕.zh.srt    subtitles, named for the language inside
///     9月5号14点33分录音＋字幕.mp4     video with the subtitles burned in
///     9月5号14点33分AI总结.md / .pdf   the summary
///     9月5号14点33分录音.json          the manifest: what was spoken, what it was subtitled in
///     9月5号14点33分逐字稿.json        the transcript as the reader saw it, replies included (iOS only)
public enum RecordingNames {
  public enum Kind: String, CaseIterable, Sendable {
    case audio, partialAudio, mp4, summary, pdf, manifest, transcript

    var suffix: String {
      switch self {
      case .audio: "录音.m4a"
      // While a talk runs the audio is a raw AAC stream, playable up to the last frame written whatever happens
      // to the app; it becomes the m4a when the talk stops (Recorder).
      case .partialAudio: "录音.part.aac"
      case .mp4: "录音＋字幕.mp4"
      case .summary: "AI总结.md"
      case .pdf: "AI总结.pdf"
      case .manifest: "录音.json"
      case .transcript: "逐字稿.json"
      }
    }
  }

  public static func fileName(_ base: String, _ kind: Kind) -> String { base + kind.suffix }

  /// "9月5号14点33分" for a recording begun at that minute, in the device's own time zone.
  public static func base(for date: Date, calendar: Calendar = .current) -> String {
    let c = calendar.dateComponents([.month, .day, .hour, .minute], from: date)
    return "\(c.month ?? 1)月\(c.day ?? 1)号\(c.hour ?? 0)点\(String(format: "%02d", c.minute ?? 0))分"
  }

  static func label(_ language: String) -> String { LiveSchema.shared.fileLabels[language] ?? language }

  /// Name of the subtitle file holding `language`: 9月5号14点33分日文字幕.ja.srt
  public static func srtName(_ base: String, language: String) -> String { "\(base)\(label(language))字幕.\(language).srt" }

  /// The `.live.` copy kept beside re-subtitled files: the subtitles the talk itself produced.
  public static func liveName(_ file: String) -> String { file.replacing(/\.(srt|mp4)$/, with: { ".live.\($0.1)" }) }

  public struct Parsed: Equatable, Sendable { public let base: String; public let kind: Kind?; public let language: String? }

  /// A file name → which recording it belongs to and what it is; nil for anything that is not ours.
  public static func parse(_ name: String) -> Parsed? {
    if name.hasPrefix(".") { return nil }
    if let m = try? /^(.*)字幕\.([A-Za-z][A-Za-z_-]{0,14})\.srt$/.wholeMatch(in: name) {
      let language = String(m.2)
      var base = String(m.1)
      // strip the label by knowing what it is for that language: a base may itself contain 字幕
      let l = label(language)
      if base.hasSuffix(l) { base.removeLast(l.count) }
      if base.hasSuffix(".live") || base.isEmpty { return nil }
      return Parsed(base: base, kind: nil, language: language)
    }
    // longest suffix first, so 录音.part.aac is not read as something else
    for kind in Kind.allCases.sorted(by: { $0.suffix.count > $1.suffix.count }) where name.count > kind.suffix.count && name.hasSuffix(kind.suffix) {
      return Parsed(base: String(name.dropLast(kind.suffix.count)), kind: kind, language: nil)
    }
    return nil
  }

  /// A base no recording in `directory` uses yet: two talks begun in the same minute become …分 and …分-2.
  public static func uniqueBase(_ base: String, in directory: URL) -> String {
    let taken = Set(((try? FileManager.default.contentsOfDirectory(atPath: directory.path)) ?? []).flatMap { name -> [String] in
      [name] + (parse(name).map { [$0.base] } ?? []) // a recording is a folder named for its base, holding files that carry it
    })
    if !taken.contains(base) { return base }
    for i in 2..<100 where !taken.contains("\(base)-\(i)") { return "\(base)-\(i)" }
    return "\(base)-\(Int(Date().timeIntervalSince1970))"
  }
}
