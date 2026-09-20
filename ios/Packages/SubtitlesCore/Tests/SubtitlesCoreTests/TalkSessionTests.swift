import Foundation
import Testing
@testable import SubtitlesCore

/// A microphone the test speaks into.
final class ScriptedSource: AudioSource, @unchecked Sendable {
  let events: AsyncStream<CaptureEvent>
  let continuation: AsyncStream<CaptureEvent>.Continuation
  init() { (events, continuation) = AsyncStream.makeStream(of: CaptureEvent.self) }
  func start() throws {}
  func stop() { continuation.finish() }
  func speak(seconds: Double, at startedAt: Double) { continuation.yield(.audio(CapturedAudio(samples: tone(seconds), startedAt: startedAt))) }
}

actor TalkLog {
  private(set) var phases: [TalkPhase] = []
  private(set) var lines: [TranscriptLine] = []
  func add(_ e: TalkEvent) { switch e { case .phase(let p): phases.append(p); case .line(let l, _): lines.append(l); case .notice: break } }
}

@Suite struct TalkSessionTests {
  @Test("a talk: audio reaches the recorder and the relay, results become the transcript and the subtitle files, and a dropped connection costs the recording nothing")
  func wholeTalk() async throws {
    let root = temporaryDirectory("talk"); defer { try? FileManager.default.removeItem(at: root) }
    let opener = FakeOpener()
    opener.onOpen = { _, s in s.serverSend(readyMessage) }
    let options = RelayOptions(source: "yue", target: "zh")
    let relay = RelayClient(server: URL(string: "https://seesubtitles.test")!, token: "t", options: options, opener: opener, timing: fastTiming())
    let source = ScriptedSource()
    let session = TalkSession(source: source, relay: relay, recorder: Recorder(root: root), options: options, recordAudio: true)
    let log = TalkLog()
    Task { for await e in session.events { await log.add(e) } }

    let id = try await session.start()
    #expect(await eventually { await log.phases.last == .listening })
    let began = await session.startedAt
    for n in 0..<5 { source.speak(seconds: 0.2, at: began + Double(n) * 200) } // a second of speech
    let first = opener.sockets[0]
    #expect(await eventually { first.sentAudio.count == 5 })
    #expect(first.sentAudio.allSatisfy { $0.count == 8 + 6400 }, "16 kHz, 200 ms, behind eight bytes of time")

    first.serverSend(#"{"type":"result","result":{"sentenceId":"v:0","sourceText":"大家好呀","targetText":"大家好","wallStart":\#(began + 100),"wallEnd":\#(began + 900),"sentenceEnd":true}}"#)
    #expect(await eventually { await log.lines.last?.ended == true })

    // the connection drops: subtitles pause, the recorder carries on
    opener.onOpen = { _, _ in } // and the server does not answer for now
    first.serverClose()
    #expect(await eventually { if case .reconnecting = await log.phases.last { true } else { false } })
    for n in 5..<10 { source.speak(seconds: 0.2, at: began + Double(n) * 200) }
    source.continuation.yield(.interrupted)
    #expect(await eventually { await log.phases.last == .interrupted })
    source.continuation.yield(.resumed)
    await session.reply("请讲慢一点")

    let info = try #require(await session.stop())
    #expect(info.id == id && info.cues == 1)
    #expect(abs(info.durationMs - 2000) < 50, "both seconds were recorded, the one without a connection too: \(info.durationMs)")
    #expect(await eventually { await log.phases.last == .ended }, "the last event is delivered after stop() returns, not before")
    let recording = try #require(RecordingLibrary(root: root).recording(id: id))
    #expect(abs(try audioSeconds(recording.audio!) - 2.0) < 0.1)
    #expect(recording.cues().target.map(\.text) == ["大家好"])
    #expect(recording.transcript().lines.map(\.kind) == [.speech, .reply])
  }

  @Test("a refused talk says why and keeps what little there was")
  func refused() async throws {
    let root = temporaryDirectory("talk"); defer { try? FileManager.default.removeItem(at: root) }
    let opener = FakeOpener()
    opener.onOpen = { _, s in s.serverSend(#"{"type":"error","code":"plan_talks","message":"this plan runs 1 talk at a time, and 1 is running"}"#); s.serverClose() }
    let options = RelayOptions(source: "yue", target: "zh")
    let relay = RelayClient(server: URL(string: "https://seesubtitles.test")!, token: "t", options: options, opener: opener, timing: fastTiming())
    let session = TalkSession(source: ScriptedSource(), relay: relay, recorder: Recorder(root: root), options: options, recordAudio: false)
    let log = TalkLog()
    Task { for await e in session.events { await log.add(e) } }
    try await session.start()
    #expect(await eventually { if case .refused(let r) = await log.phases.last { r.code == "plan_talks" } else { false } })
    _ = await session.stop()
  }
}
