import AVFoundation
import Foundation
import Testing
@testable import SubtitlesCore

func tone(_ seconds: Double, rate: Int = 48_000) -> [Int16] {
  (0..<Int(seconds * Double(rate))).map { Int16(6000 * sin(2 * Double.pi * 440 * Double($0) / Double(rate))) }
}

func audioSeconds(_ url: URL) throws -> Double {
  let file = try AVAudioFile(forReading: url)
  return Double(file.length) / file.fileFormat.sampleRate
}

@Suite struct RecorderTests {
  @Test("a talk becomes an m4a, a subtitle file per language, a manifest and the transcript")
  func records() async throws {
    let root = temporaryDirectory("rec"); defer { try? FileManager.default.removeItem(at: root) }
    let clock = TestClock()
    let recorder = Recorder(root: root, now: { clock.now })
    let id = try await recorder.start(source: "yue", target: "zh")
    for _ in 0..<10 { await recorder.write(tone(0.2)); clock.advance(200) } // two seconds, on time
    let t0 = clock.now - 2000
    var transcript = Transcript()
    let one = transcript.apply(LiveResult(sentenceId: "v:0", sourceText: "大家好呀", targetText: "大家好", wallStart: t0 + 100, wallEnd: t0 + 900, sentenceEnd: true), now: clock.now).line
    let draft = transcript.apply(LiveResult(sentenceId: "v:1", sourceText: "未完", targetText: "没说完", wallStart: t0 + 1000), now: clock.now).line
    let reply = transcript.addReply("谢谢", now: clock.now)
    await recorder.add(one); await recorder.add(one) // written once, however often it is offered
    await recorder.add(draft); await recorder.add(reply) // a draft is not a cue, and neither is a reply
    let info = try #require(await recorder.stop(transcript: transcript))
    #expect(info.id == id && info.hasAudio && info.error == nil && info.cues == 1 && info.paddedMs == 0)
    #expect(abs(info.durationMs - 2000) < 5)

    let recording = try #require(RecordingLibrary(root: root).recording(id: id))
    #expect(recording.audio?.lastPathComponent == "\(id)录音.m4a")
    #expect(abs(try audioSeconds(recording.audio!) - 2.0) < 0.1)
    #expect(!FileManager.default.fileExists(atPath: recording.folder.appendingPathComponent("\(id)录音.part.aac").path))
    #expect(try String(contentsOf: recording.targetSubtitles!, encoding: .utf8) == "1\n00:00:00,100 --> 00:00:00,900\n大家好\n\n")
    #expect(try String(contentsOf: recording.sourceSubtitles!, encoding: .utf8).contains("大家好呀"))
    #expect(recording.manifest.source == "yue" && recording.manifest.kind == .recorded && recording.manifest.durationMs == info.durationMs)
    #expect(recording.transcript() == transcript)
    #expect(recording.files.count == 3)
  }

  @Test("a gap in the audio — a phone call — is kept as silence, so the subtitles stay in time")
  func padsGaps() async throws {
    let root = temporaryDirectory("rec"); defer { try? FileManager.default.removeItem(at: root) }
    let clock = TestClock()
    let recorder = Recorder(root: root, now: { clock.now })
    try await recorder.start(source: "zh", target: "zh")
    for _ in 0..<15 { clock.advance(200); await recorder.write(tone(0.2)) } // 3 s; the lag settles after 2 s
    clock.advance(5000) // the call
    for _ in 0..<5 { clock.advance(200); await recorder.write(tone(0.2)) }
    let info = try #require(await recorder.stop())
    #expect(abs(info.paddedMs - 5000) < 250)
    #expect(abs(info.durationMs - 9000) < 250, "3 s + 5 s of silence + 1 s, was \(info.durationMs)")
  }

  @Test("transcribing puts both slots in one file, once; listening without recording keeps the words only")
  func oneFileAndTranscriptOnly() async throws {
    let root = temporaryDirectory("rec"); defer { try? FileManager.default.removeItem(at: root) }
    let clock = TestClock()
    let recorder = Recorder(root: root, now: { clock.now })
    let id = try await recorder.start(source: "zh", target: "zh", audio: false)
    await recorder.write(tone(0.2)) // ignored: this talk keeps no sound
    clock.advance(4000)
    var t = Transcript()
    await recorder.add(t.apply(LiveResult(sentenceId: "v:0", sourceText: "你好", targetText: "你好", wallStart: clock.now - 3000, wallEnd: clock.now - 2000, sentenceEnd: true), now: clock.now).line)
    let info = try #require(await recorder.stop(transcript: t))
    #expect(!info.hasAudio && info.durationMs == 4000)
    let r = try #require(RecordingLibrary(root: root).recording(id: id))
    #expect(r.audio == nil && r.manifest.kind == .transcriptOnly)
    #expect(SRT.parse(try String(contentsOf: r.targetSubtitles!, encoding: .utf8)).count == 1)
    #expect(r.cues().source.isEmpty)
  }

  @Test("a recording the app never got to finish is put back together at the next launch")
  func recovery() async throws {
    let root = temporaryDirectory("rec"); defer { try? FileManager.default.removeItem(at: root) }
    let clock = TestClock()
    let recorder = Recorder(root: root, now: { clock.now })
    let id = try await recorder.start(source: "yue", target: "zh")
    for _ in 0..<15 { await recorder.write(tone(0.2)); clock.advance(200) }
    await recorder.add(TranscriptLine(id: "v:0", seq: 1, sourceText: "原文", targetText: "译文", ended: true, wallStart: clock.now - 2500, wallEnd: clock.now - 1500, createdAt: clock.now))
    // the app dies here: what is on disk is all there is. Copy it as it stands, mid-stream and never closed.
    let crashed = temporaryDirectory("crashed"); defer { try? FileManager.default.removeItem(at: crashed) }
    try FileManager.default.copyItem(at: root.appendingPathComponent(id), to: crashed.appendingPathComponent(id))
    _ = await recorder.stop()

    let library = RecordingLibrary(root: crashed)
    let before = try #require(library.recording(id: id))
    #expect(before.audio?.pathExtension == "aac" && before.manifest.durationMs == nil)
    #expect(await library.recoverInterrupted() == [id])
    let after = try #require(library.recording(id: id))
    #expect(after.audio?.lastPathComponent == "\(id)录音.m4a")
    #expect(after.manifest.recovered == true)
    let seconds = try audioSeconds(after.audio!)
    #expect(seconds > 2.0 && seconds <= 3.1, "most of the three seconds should survive, got \(seconds)")
    #expect(abs(Double(after.manifest.durationMs ?? 0) / 1000 - seconds) < 0.1)
    #expect(after.transcript().lines.map(\.targetText) == ["译文"], "the transcript is rebuilt from the subtitles")
    #expect(await library.recoverInterrupted().isEmpty)
  }

  @Test("the Library lists, searches, renames and deletes")
  func library() async throws {
    let root = temporaryDirectory("lib"); defer { try? FileManager.default.removeItem(at: root) }
    let clock = TestClock()
    var ids: [String] = []
    for words in ["字幕帮助更多人参与会议", "产品路线图"] {
      let recorder = Recorder(root: root, now: { clock.now })
      ids.append(try await recorder.start(source: "yue", target: "zh", audio: false))
      await recorder.add(TranscriptLine(id: "v:0", seq: 1, sourceText: "", targetText: words, ended: true, wallStart: clock.now + 10, wallEnd: clock.now + 900, createdAt: clock.now))
      _ = await recorder.stop()
      clock.advance(60_000) // the next one a minute later
    }
    let library = RecordingLibrary(root: root)
    try Data("x".utf8).write(to: root.appendingPathComponent("stray.txt")) // not a recording
    let all = library.all()
    #expect(all.map(\.id) == ids.reversed(), "newest first")
    #expect(ids[0] != ids[1])
    #expect(library.search("路线", in: all).map(\.id) == [ids[1]])
    try library.rename(all[0], to: " 周会 ")
    #expect(library.recording(id: ids[1])?.title == "周会")
    #expect(library.search("周会", in: library.all()).count == 1)
    try library.delete(all[1])
    #expect(library.all().map(\.id) == [ids[1]])
    #expect(library.bytes > 0)
  }
}
