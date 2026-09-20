import Foundation
import Testing
@testable import SubtitlesCore

/// The scenarios web/speak.js played through its own queue, with what it decided at every step.
struct SpeechFixture: Decodable {
  struct Line: Decodable { let id: String; let sourceText: String?; let targetText: String?; let ended: Bool?; let kind: String? }
  struct Next: Decodable, Equatable { let id: String; let text: String; let rate: Double }
  struct Step: Decodable {
    let op: String
    let ids: [String]?, line: Line?, id: String?
    let dropped: [String]?, next: Next?
    let behind: Int, spoken: Int, skipped: Int

    enum Keys: String, CodingKey { case op, arg, result, behind, spoken, skipped }
    init(from decoder: Decoder) throws {
      let c = try decoder.container(keyedBy: Keys.self)
      op = try c.decode(String.self, forKey: .op)
      behind = try c.decode(Int.self, forKey: .behind); spoken = try c.decode(Int.self, forKey: .spoken); skipped = try c.decode(Int.self, forKey: .skipped)
      ids = op == "start" ? try c.decodeIfPresent([String].self, forKey: .arg) : nil
      line = op == "offer" ? try c.decodeIfPresent(Line.self, forKey: .arg) : nil
      id = op == "finished" ? try c.decodeIfPresent(String.self, forKey: .arg) : nil
      dropped = op == "offer" ? try c.decodeIfPresent([String].self, forKey: .result) : nil
      next = op == "next" ? try c.decodeIfPresent(Next.self, forKey: .result) : nil
    }
  }
  struct Scenario: Decodable { let name: String; let steps: [Step] }
  let defaults: SpeechQueue.Options
  let scenarios: [Scenario]
}

@Suite struct SpeechQueueTests {
  let fixture: SpeechFixture = {
    let url = Bundle.module.url(forResource: "speech-queue", withExtension: "json", subdirectory: "Fixtures")!
    return try! JSONDecoder().decode(SpeechFixture.self, from: Data(contentsOf: url))
  }()

  @Test("the phone decides what to say, and how fast, exactly as the Mac and the attendee page do")
  func sameDecisions() {
    #expect(SpeechQueue.defaults == fixture.defaults)
    #expect(fixture.scenarios.count >= 4)
    for scenario in fixture.scenarios {
      var queue = SpeechQueue()
      for (n, step) in scenario.steps.enumerated() {
        let at = "\(scenario.name), step \(n + 1) (\(step.op))"
        switch step.op {
        case "start": queue.start(existing: step.ids ?? [])
        case "stop": queue.stop()
        case "finished": queue.finished(step.id ?? "")
        case "offer":
          let l = step.line!
          let line = TranscriptLine(id: l.id, seq: n, kind: l.kind == "reply" ? .reply : .speech, sourceText: l.sourceText ?? "", targetText: l.targetText ?? "", ended: l.ended ?? false, createdAt: 0)
          #expect(queue.offer(line) == (step.dropped ?? []), "\(at)")
        case "next":
          let item = queue.next()
          #expect(item.map { SpeechFixture.Next(id: $0.id, text: $0.text, rate: $0.rate) } == step.next, "\(at)")
        default: Issue.record("unknown step \(step.op)")
        }
        #expect(queue.behind == step.behind && queue.spoken == step.spoken && queue.skipped == step.skipped, "\(at): behind \(queue.behind), spoken \(queue.spoken), skipped \(queue.skipped)")
      }
    }
  }

  @Test("a subtitle language is given the voice language that reads it")
  func voices() {
    #expect(SpeechQueue.voiceLanguage("yue") == "zh-HK")
    #expect(SpeechQueue.voiceLanguage("zh") == "zh-CN")
    #expect(SpeechQueue.voiceLanguage("en") == "en-US")
    #expect(SpeechQueue.voiceLanguage("xx") == "xx")
  }

  @MainActor @Test("the speed asked for stays within what the system's voice can do, and rises with it")
  func rates() {
    let normal = SystemVoice.utteranceRate(1.0), brisk = SystemVoice.utteranceRate(1.1), fastest = SystemVoice.utteranceRate(1.6)
    #expect(normal < brisk && brisk < fastest)
    #expect(fastest < 0.7, "1.6× is brisk, not frantic")
    #expect(SystemVoice.utteranceRate(100) <= 1 && SystemVoice.utteranceRate(-5) >= 0)
    // every language the split pipeline subtitles in most often has a voice on a stock system
    for language in ["zh", "en", "ja"] { #expect(!SystemVoice.voices(for: language).isEmpty, "no system voice for \(language)") }
    for language in ["zh", "en"] { #expect((SystemVoice.voices(for: language).first?.quality ?? -1) >= 0, "the default \(language) voice is a natural one, not Eddy") }
    #expect(SpeechQueue.isQuirky(name: "Eddy (English (US))", identifier: "com.apple.eloquence.en-US.Eddy") && !SpeechQueue.isQuirky(name: "Tingting", identifier: "com.apple.voice.compact.zh-CN.Tingting"))
    #expect(SystemVoice.voices(for: "zh").allSatisfy { $0.language.lowercased() == "zh-cn" }, "Mandarin is never read in a Cantonese voice")
  }
}
