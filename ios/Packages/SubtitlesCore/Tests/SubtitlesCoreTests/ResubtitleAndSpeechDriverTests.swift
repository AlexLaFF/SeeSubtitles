import Foundation
import Testing
@testable import SubtitlesCore

@Suite(.serialized) struct ResubtitlerTests {
  let api = APIClient(server: URL(string: "https://seesubtitles.test")!, token: "tok", session: StubServer.session())

  /// A short recording with one subtitle in each language, as a talk leaves it.
  func recording(in root: URL, reply: String? = nil) async throws -> Recording {
    let clock = TestClock()
    let recorder = Recorder(root: root, now: { clock.now })
    let id = try await recorder.start(source: "yue", target: "zh")
    for _ in 0..<10 { await recorder.write(tone(0.2)); clock.advance(200) }
    var transcript = Transcript()
    let line = transcript.apply(LiveResult(sentenceId: "v:0", sourceText: "现场原文", targetText: "现场译文", wallStart: clock.now - 1800, wallEnd: clock.now - 900, sentenceEnd: true), now: clock.now).line
    await recorder.add(line)
    if let reply { transcript.addReply(reply, now: clock.now - 500) }
    _ = await recorder.stop(transcript: transcript)
    return try #require(RecordingLibrary(root: root).recording(id: id))
  }

  @Test("re-subtitling uploads the audio, waits for the job, replaces the subtitles, keeps the talk's own once, puts replies back, and deletes the job")
  func resubtitle() async throws {
    let root = temporaryDirectory("resub"); defer { try? FileManager.default.removeItem(at: root) }
    let recording = try await recording(in: root, reply: "请讲慢一点")
    let id = recording.id
    try Data("old video".utf8).write(to: recording.folder.appendingPathComponent(RecordingNames.fileName(id, .mp4)))
    let withVideo = try #require(RecordingLibrary(root: root).recording(id: id))

    StubServer.reset()
    let polls = Counter()
    let created = Box()
    StubServer.on("POST /api/jobs") { _, body in created.set(body); return StubServer.json(#"{"id":"abc123","status":"uploading","progress":0}"#) }
    let uploaded = Box()
    StubServer.on("PUT /api/jobs/abc123/upload") { _, body in uploaded.set(body); return StubServer.json(#"{"id":"abc123","status":"queued","progress":0}"#) }
    StubServer.on("GET /api/jobs/abc123") { _, _ in
      polls.increment() < 2 ? StubServer.json(#"{"id":"abc123","status":"recognizing","progress":40}"#)
        : StubServer.json(#"{"id":"abc123","status":"done","progress":100,"files":["talk.yue.srt","talk.zh.srt","talk.zh.vtt"]}"#)
    }
    StubServer.on("GET /jobs/abc123/files/talk.zh.srt") { _, _ in StubServer.Answer(headers: [:], body: Data("1\n00:00:00,200 --> 00:00:01,100\n云端译文\n\n".utf8)) }
    StubServer.on("GET /jobs/abc123/files/talk.yue.srt") { _, _ in StubServer.Answer(headers: [:], body: Data("1\n00:00:00,200 --> 00:00:01,100\n云端原文\n\n".utf8)) }
    StubServer.on("DELETE /api/jobs/abc123") { _, _ in StubServer.json(#"{"ok":true}"#) }

    let stages = StageLog()
    try await Resubtitler(api: api, pollSeconds: 0.01).run(withVideo) { stages.add($0) }

    let asked = try #require(try JSONSerialization.jsonObject(with: created.value) as? [String: Any])
    #expect(asked["sourceLang"] as? String == "yue" && asked["targetLang"] as? String == "zh" && (asked["size"] as? Int ?? 0) > 1000)
    #expect((asked["filename"] as? String)?.hasSuffix("录音.m4a") == true)
    #expect(uploaded.value.count > 1000, "the audio itself is what is uploaded")

    let library = RecordingLibrary(root: root)
    let after = try #require(library.recording(id: id))
    #expect(after.resubtitled)
    #expect(after.cues().target.map(\.text) == ["云端译文"] && after.cues().source.map(\.text) == ["云端原文"])
    let live = try String(contentsOf: after.folder.appendingPathComponent("\(id)中文字幕.zh.live.srt"), encoding: .utf8)
    #expect(live.contains("现场译文"), "what the talk itself produced is kept")
    #expect(after.transcript().lines.map(\.display) == ["云端译文", "请讲慢一点"] && after.transcript().lines.last?.kind == .reply)
    #expect(after.mp4 == nil && FileManager.default.fileExists(atPath: after.folder.appendingPathComponent("\(id)录音＋字幕.live.mp4").path), "a video of the old subtitles is set aside")
    #expect(stages.values.first == .uploading && stages.values.last == .downloading && stages.values.contains(.working(status: "recognizing", progress: 0.4)))
    #expect(StubServer.asked.contains { $0.request.httpMethod == "DELETE" }, "the server keeps the audio only as long as the job")

    // again: the first live copy is never overwritten
    StubServer.on("GET /jobs/abc123/files/talk.zh.srt") { _, _ in StubServer.Answer(headers: [:], body: Data("1\n00:00:00,200 --> 00:00:01,100\n第二次\n\n".utf8)) }
    try await Resubtitler(api: api, pollSeconds: 0.01).run(after)
    #expect(try String(contentsOf: after.folder.appendingPathComponent("\(id)中文字幕.zh.live.srt"), encoding: .utf8).contains("现场译文"))
    #expect(library.recording(id: id)?.cues().target.map(\.text) == ["第二次"])
  }

  @Test("a job that fails, or a plan without the hours, leaves the subtitles exactly as they were")
  func failures() async throws {
    let root = temporaryDirectory("resub"); defer { try? FileManager.default.removeItem(at: root) }
    let recording = try await recording(in: root)

    StubServer.reset()
    StubServer.on("POST /api/jobs") { _, _ in StubServer.json(#"{"error":"the file subtitling hours of this month are used up","code":"plan_quota"}"#, status: 403) }
    do { try await Resubtitler(api: api).run(recording); Issue.record("expected plan_quota") } catch let e as APIError { #expect(e.code == "plan_quota") }

    StubServer.on("POST /api/jobs") { _, _ in StubServer.json(#"{"id":"j","status":"uploading"}"#) }
    StubServer.on("PUT /api/jobs/j/upload") { _, _ in StubServer.json(#"{"id":"j","status":"failed","error":"no speech found"}"#) }
    do { try await Resubtitler(api: api).run(recording); Issue.record("expected the job's failure") }
    catch let e as Resubtitler.Failed { #expect(e == .init(code: "job_failed", message: "no speech found")) }

    // the job finishes but one of the files never arrives: nothing of the talk's own has been touched
    StubServer.on("PUT /api/jobs/j/upload") { _, _ in StubServer.json(#"{"id":"j","status":"done","files":["talk.yue.srt","talk.zh.srt"]}"#) }
    StubServer.on("GET /jobs/j/files/talk.yue.srt") { _, _ in StubServer.json(#"{"error":"gone"}"#, status: 404) }
    do { try await Resubtitler(api: api).run(recording); Issue.record("expected the download to fail") } catch is APIError {}
    let after = try #require(RecordingLibrary(root: root).recording(id: recording.id))
    #expect(after.cues().target.map(\.text) == ["现场译文"] && after.cues().source.map(\.text) == ["现场原文"] && !after.resubtitled)

    var thai = recording.manifest; thai.source = "th"
    #expect(!Resubtitler.canResubtitle(Recording(id: "x", folder: root, manifest: thai, audio: recording.audio, mp4: nil, summary: nil, pdf: nil, targetSubtitles: nil, sourceSubtitles: nil, transcriptFile: nil, resubtitled: false, bytes: 0)), "the cloud does not transcribe Thai uploads")
  }
}

final class Counter: @unchecked Sendable { private let lock = NSLock(); private var n = 0; func increment() -> Int { lock.withLock { n += 1; return n - 1 } } }
final class Box: @unchecked Sendable { private let lock = NSLock(); private var data = Data(); func set(_ d: Data) { lock.withLock { data = d } }; var value: Data { lock.withLock { data } } }
final class StageLog: @unchecked Sendable {
  private let lock = NSLock(); private var _values: [Resubtitler.Stage] = []
  func add(_ s: Resubtitler.Stage) { lock.withLock { _values.append(s) } }
  var values: [Resubtitler.Stage] { lock.withLock { _values } }
}

@MainActor @Suite struct SpeechDriverTests {
  func line(_ id: String, _ text: String) -> TranscriptLine { TranscriptLine(id: id, seq: 0, sourceText: "原\(id)", targetText: text, ended: true, createdAt: 0) }

  @Test("sentences are said one after another, in the talk's language, at the chosen speed")
  func speaks() async {
    let voice = SilentVoice(secondsPerSentence: 0.02)
    let driver = SpeechDriver(voice: voice, language: "en", routeAllows: { true })
    driver.offer(line("early", "before it was on"))
    driver.turnOn(existing: ["old"], rate: 1.25)
    driver.offer(line("old", "the past")); driver.offer(line("a", "One")); driver.offer(line("b", "Two"))
    #expect(voice.said.map(\.text) == ["One"], "one at a time")
    #expect(driver.status == .speaking(behind: 2))
    #expect(await eventually { await MainActor.run { voice.said.count == 2 && driver.spoken == 2 } })
    #expect(voice.said.map(\.text) == ["One", "Two"] && voice.said.allSatisfy { $0.language == "en" })
    #expect(voice.said[0].rate == 1.25 && voice.said[1].rate == 1.25, "nothing was waiting behind either when it began")
    #expect(driver.status == .ready)
    driver.turnOff()
    driver.offer(line("c", "Three"))
    #expect(voice.said.count == 2 && driver.status == .off)
  }

  @Test("on your own talk nothing is spoken without headphones, nothing is saved up for later, and the voice stops when they come out")
  func headphonesOnly() async {
    let voice = SilentVoice(secondsPerSentence: 5)
    let route = Route()
    let driver = SpeechDriver(voice: voice, language: "en", routeAllows: { route.headphones })
    driver.turnOn(existing: [], rate: 1.1)
    #expect(driver.status == .needsHeadphones)
    driver.offer(line("a", "Said to an empty room"))
    #expect(voice.said.isEmpty)
    route.headphones = true
    driver.routeChanged()
    #expect(voice.said.isEmpty && driver.status == .ready, "what settled without headphones is the past")
    driver.offer(line("b", "Heard"))
    #expect(voice.said.map(\.text) == ["Heard"])
    route.headphones = false
    driver.routeChanged() // they came out mid-sentence
    #expect(driver.status == .needsHeadphones)
    driver.offer(line("c", "Not through the speaker"))
    #expect(voice.said.map(\.text) == ["Heard"])
  }
}

@MainActor final class Route { var headphones = false }
