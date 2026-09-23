import Foundation
import Testing
@testable import SubtitlesCore

@Suite struct TranscriptTests {
  @Test("updates land on the sentence they belong to; a settled sentence stays settled")
  func apply() {
    var t = Transcript()
    let a = t.apply(LiveResult(sentenceId: "v:0", sourceText: "大家", wallStart: 1000), now: 5)
    #expect(a.isNew && a.line.seq == 1 && a.line.display == "大家")
    let b = t.apply(LiveResult(sentenceId: "v:0", sourceText: "大家好呀", targetText: "大家好", wallEnd: 3000, sentenceEnd: true), now: 6)
    #expect(!b.isNew && b.line.ended && b.line.display == "大家好" && b.line.wallStart == 1000 && b.line.wallEnd == 3000)
    // a late draft for a settled sentence changes its words but never un-settles it
    let c = t.apply(LiveResult(sentenceId: "v:0", targetText: "大家好！"), now: 7)
    #expect(c.line.ended && c.line.targetText == "大家好！")
    t.apply(LiveResult(voiceId: "v", startTime: 4200), now: 8) // no sentence id: one is made from the stream position
    #expect(t.lines.map(\.id) == ["v:0", "v:4200"])
    #expect(t.finished.map(\.id) == ["v:0"]) // an empty line is not a finished one
  }

  @Test("a reply is the reader's own line, kept in order with the talk, and survives being saved")
  func replies() throws {
    var t = Transcript()
    t.apply(LiveResult(sentenceId: "v:0", targetText: "一", sentenceEnd: true), now: 1)
    let reply = t.addReply("请问可以再讲一次吗？", now: 2)
    t.apply(LiveResult(sentenceId: "v:1", targetText: "二", sentenceEnd: true), now: 3)
    #expect(reply.kind == .reply && reply.ended)
    #expect(t.lines.map(\.seq) == [1, 2, 3])
    let saved = try JSONEncoder().encode(t.lines)
    let back = Transcript(lines: try JSONDecoder().decode([TranscriptLine].self, from: saved))
    #expect(back == t)
    var more = back
    #expect(more.apply(LiveResult(sentenceId: "v:2"), now: 4).line.seq == 4)
  }
}

@Suite struct SubtitleFileTests {
  @Test("SRT blocks are written the way core/recorder.js writes them")
  func write() {
    #expect(SRT.time(3_723_004) == "01:02:03,004")
    #expect(SRT.time(-5) == "00:00:00,000")
    #expect(SRT.block(number: 2, cue: Cue(start: 1000, end: 3500, text: "你好")) == "2\n00:00:01,000 --> 00:00:03,500\n你好\n\n")
    #expect(SRT.block(number: 1, cue: Cue(start: 1000, end: 1100, text: "短")).contains("--> 00:00:01,300"), "a cue is never shorter than 300 ms")
  }

  @Test("SRT files are read back, including the looser ones other tools make")
  func parse() {
    let cues = [Cue(start: 1000, end: 3500, text: "大家好"), Cue(start: 3_660_000, end: 3_662_000, text: "谢谢")]
    #expect(SRT.parse(SRT.file(cues)) == cues)
    let loose = "\u{FEFF}00:00:01.000 --> 00:00:02.000\r\nline one\r\nline two\r\n\r\n7\r\n00:00:05,000 --> 00:00:06,000\r\nnext\r\n"
    #expect(SRT.parse(loose) == [Cue(start: 1000, end: 2000, text: "line one line two"), Cue(start: 5000, end: 6000, text: "next")])
  }

  @Test("plain text drops markup and empty lines")
  func plain() {
    #expect(PlainText.from(["<b>你好</b>  世界", "", "{\\an8}上面", " "]) == "你好 世界\n上面\n")
    #expect(PlainText.from([]) == "")
  }
}

@Suite struct RecordingNamesTests {
  @Test("a recording's files are named as the Mac names them, with m4a audio")
  func names() {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(identifier: "Asia/Hong_Kong")!
    let date = calendar.date(from: DateComponents(year: 2026, month: 9, day: 5, hour: 14, minute: 3))!
    let base = RecordingNames.base(for: date, calendar: calendar)
    #expect(base == "9月5号14点03分")
    #expect(RecordingNames.fileName(base, .audio) == "9月5号14点03分录音.m4a")
    #expect(RecordingNames.srtName(base, language: "zh") == "9月5号14点03分中文字幕.zh.srt")
    #expect(RecordingNames.srtName(base, language: "yue") == "9月5号14点03分粤语字幕.yue.srt")
    #expect(RecordingNames.liveName("a中文字幕.zh.srt") == "a中文字幕.zh.live.srt")
  }

  @Test("file names are read back into the recording they belong to")
  func parse() {
    #expect(RecordingNames.parse("9月5号14点03分录音.m4a") == .init(base: "9月5号14点03分", kind: .audio, language: nil))
    #expect(RecordingNames.parse("9月5号14点03分录音.part.aac")?.kind == .partialAudio)
    #expect(RecordingNames.parse("9月5号14点03分录音＋字幕.mp4")?.kind == .mp4)
    #expect(RecordingNames.parse("9月5号14点03分AI总结.md")?.kind == .summary)
    #expect(RecordingNames.parse("9月5号14点03分录音.json")?.kind == .manifest)
    #expect(RecordingNames.parse("9月5号14点03分日文字幕.ja.srt") == .init(base: "9月5号14点03分", kind: nil, language: "ja"))
    #expect(RecordingNames.parse("字幕讲座中文字幕.zh.srt")?.base == "字幕讲座", "a base may itself contain 字幕")
    #expect(RecordingNames.parse("9月5号14点03分中文字幕.zh.live.srt") == nil, "the kept live copy is not the recording's subtitles")
    #expect(RecordingNames.parse(".DS_Store") == nil)
    #expect(RecordingNames.parse("notes.txt") == nil)
  }

  @Test("two talks begun in the same minute get different names")
  func unique() throws {
    let dir = temporaryDirectory("names")
    defer { try? FileManager.default.removeItem(at: dir) }
    #expect(RecordingNames.uniqueBase("9月5号14点03分", in: dir) == "9月5号14点03分")
    try FileManager.default.createDirectory(at: dir.appendingPathComponent("9月5号14点03分"), withIntermediateDirectories: true)
    #expect(RecordingNames.uniqueBase("9月5号14点03分", in: dir) == "9月5号14点03分-2")
  }
}

@Suite struct LiveSchemaTests {
  @Test("the phone offers the pairs the relay accepts, in the relay's order")
  func pairs() {
    let s = LiveSchema.shared
    #expect(s.defaultPipeline == "split")
    #expect(s.sources().first == "yue")
    #expect(s.targets(for: "yue").contains("zh"))
    #expect(s.targets(for: "yue", pipeline: "combined") == ["zh", "en", "ja", "ko", "yue"])
    #expect(s.coerceTarget(source: "id", target: "ja", pipeline: "combined") == "zh")
    #expect(s.coerceSource("klingon") == "yue")
    #expect(s.coerceModel("nonsense") == "hy-mt2-pro")
    #expect(s.coerceModel("hunyuan-translation-lite", pipeline: "combined") == "hunyuan-translation-lite")
    #expect(s.name(of: "yue").native == "粤语" && s.name(of: "yue").english == "Cantonese")
    #expect(s.name(of: "en").native == "English")
    let o = RelayOptions(source: "yue", target: "xx", pipeline: "nope")
    #expect(o.pipeline == "split" && o.transModel == "hy-mt2-pro" && s.targets(for: "yue").contains(o.target))
  }
}
