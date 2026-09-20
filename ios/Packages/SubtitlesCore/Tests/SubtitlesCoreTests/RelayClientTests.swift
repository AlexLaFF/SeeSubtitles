import Foundation
import Testing
@testable import SubtitlesCore

@Suite struct RelayClientTests {
  let server = URL(string: "https://seesubtitles.test")!
  func options(hotwords: String = "腾讯云|10\nC++|8") -> RelayOptions { RelayOptions(source: "yue", target: "zh", hotwords: hotwords, vadSilenceTime: 700, maxSpeakTime: 6) }

  @Test("the connection says who it is and what it wants before the server opens a stream")
  func handshake() async {
    let opener = FakeOpener()
    let client = RelayClient(server: server, token: "tok-123", options: options(), opener: opener, timing: fastTiming())
    await client.start()
    let socket = opener.sockets[0]
    #expect(socket.request.value(forHTTPHeaderField: "Authorization") == "Bearer tok-123")
    let url = socket.request.url!
    #expect(url.scheme == "wss")
    #expect(url.path == "/api/desktop/live")
    let query = Dictionary(uniqueKeysWithValues: URLComponents(url: url, resolvingAgainstBaseURL: false)!.queryItems!.map { ($0.name, $0.value ?? "") })
    #expect(query == ["source": "yue", "target": "zh", "pipeline": "split", "transModel": "hy-mt2-pro", "hotwords": "腾讯云|10\nC++|8", "vadSilenceTime": "700", "maxSpeakTime": "6"])
    #expect(url.absoluteString.contains("C%2B%2B"), "a plus sign must not reach the server as a space")
    // nothing is sent before the server is ready; then the settings follow the handshake
    await client.push(chunk(1))
    try? await Task.sleep(for: .milliseconds(30))
    #expect(socket.sent.isEmpty)
    socket.serverSend(readyMessage)
    #expect(await eventually { socket.sentText.count == 1 && socket.sentAudio.count == 1 })
    let settings = try! JSONSerialization.jsonObject(with: Data(socket.sentText[0].utf8)) as! [String: Any]
    #expect(settings["type"] as? String == "settings")
    #expect(settings["hotwords"] as? String == "腾讯云|10\nC++|8")
    #expect(settings["vadSilenceTime"] as? Int == 700)
    await client.stop()
  }

  @Test("an audio frame is eight bytes of capture time, big-endian, then the PCM")
  func frame() {
    let data = RelayClient.frame(AudioChunk(pcm: Data([1, 2, 3, 4]), t0: 1_757_000_000_123.5))
    #expect(data.count == 12)
    let bits = data.prefix(8).reduce(UInt64(0)) { ($0 << 8) | UInt64($1) } // what Buffer.readDoubleBE reads
    #expect(Double(bitPattern: bits) == 1_757_000_000_123.5)
    #expect(data.suffix(4) == Data([1, 2, 3, 4]))
  }

  @Test("results reach the app, and stopping says so to the server")
  func resultsAndStop() async {
    let opener = FakeOpener()
    opener.onOpen = { _, s in s.serverSend(readyMessage) }
    let client = RelayClient(server: server, token: "t", options: options(), opener: opener, timing: fastTiming())
    let log = collect(client)
    await client.start()
    let socket = opener.sockets[0]
    socket.serverSend(#"{"type":"result","result":{"voiceId":"v1","sentenceId":"v1:0","sourceText":"大家好呀","targetText":"大家好","wallStart":1000.5,"wallEnd":null,"sentenceEnd":false,"startTime":0}}"#)
    socket.serverSend(#"{"type":"status","status":{"state":"ready","voiceId":"v1"}}"#)
    socket.serverSend("not json at all")
    #expect(await eventually { await log.results.count == 1 })
    let r = await log.results[0]
    #expect(r.sentenceId == "v1:0" && r.targetText == "大家好" && r.wallStart == 1000.5 && r.wallEnd == nil && !r.sentenceEnd)
    #expect(await log.events.contains(.upstream("ready")))
    await client.stop()
    #expect(socket.sentText.last == #"{"type":"stop"}"#)
    #expect(socket.closedByClient == 1000)
    #expect(await eventually { await log.states.last == .stopped })
  }

  @Test("while the connection is down only the newest second of audio is kept")
  func backlog() async {
    let opener = FakeOpener()
    let client = RelayClient(server: server, token: "t", options: options(), opener: opener, timing: fastTiming())
    await client.start() // never becomes ready
    for n in 0..<8 { await client.push(chunk(n)) }
    #expect(await client.dropped == 3)
    opener.sockets[0].serverSend(readyMessage)
    #expect(await eventually { opener.sockets[0].sentAudio.count == 5 })
    // the five that were kept, oldest first
    #expect(opener.sockets[0].sentAudio.map { $0[8] } == [3, 4, 5, 6, 7])
    await client.stop()
  }

  @Test("a dropped connection is retried with a growing delay, and a quiet one is kept alive")
  func reconnectAndKeepalive() async {
    let opener = FakeOpener()
    opener.onOpen = { n, s in if n > 0 { s.serverSend(readyMessage) } }
    let client = RelayClient(server: server, token: "t", options: options(), opener: opener, timing: fastTiming())
    let log = collect(client)
    await client.start()
    opener.sockets[0].serverClose()
    #expect(await eventually { opener.sockets.count == 2 })
    #expect(await eventually { await log.states == [.connecting, .reconnecting, .connecting, .ready] })
    let retryAt = await log.events.compactMap { if case .state(.reconnecting, let at) = $0 { at } else { nil } }
    #expect(retryAt.count == 1 && retryAt[0] != nil)
    // nothing pushed: after the keepalive interval a chunk of silence goes out, stamped like any other
    let second = opener.sockets[1]
    #expect(await eventually { second.sentAudio.count >= 1 })
    #expect(second.sentAudio[0].count == 8 + ChunkAssembler.chunkBytes)
    #expect(second.sentAudio[0].dropFirst(8).allSatisfy { $0 == 0 })
    #expect(await client.keepalives >= 1)
    await client.stop()
  }

  @Test("a plan's refusal ends the talk instead of being retried", arguments: ["plan_talks", "plan_quota", "bad_language"])
  func refusal(code: String) async {
    let opener = FakeOpener()
    opener.onOpen = { _, s in
      s.serverSend(#"{"type":"error","code":"\#(code)","message":"no"}"#)
      s.serverClose()
    }
    let client = RelayClient(server: server, token: "t", options: options(), opener: opener, timing: fastTiming())
    let log = collect(client)
    await client.start()
    #expect(await eventually { await log.states.last == .refused })
    #expect(await log.refusals == [RelayRefusal(code: code, message: "no")])
    try? await Task.sleep(for: .milliseconds(120)) // several backoffs' worth
    #expect(opener.sockets.count == 1, "a refusal must not be retried")
  }

  @Test("a rejected login ends the talk; trouble upstream does not")
  func unauthorizedAndUpstream() async {
    let refused = FakeOpener()
    refused.onOpen = { _, s in s.status = 401; s.serverClose() }
    let a = RelayClient(server: server, token: "old", options: options(), opener: refused, timing: fastTiming())
    let logA = collect(a)
    await a.start()
    #expect(await eventually { await logA.refusals.first?.code == "unauthorized" })

    let flaky = FakeOpener()
    flaky.onOpen = { n, s in
      s.serverSend(readyMessage)
      if n == 0 { s.serverSend(#"{"type":"error","code":"tencent_4008","message":"idle"}"#); s.serverClose() }
    }
    let b = RelayClient(server: server, token: "t", options: options(), opener: flaky, timing: fastTiming())
    let logB = collect(b)
    await b.start()
    #expect(await eventually { flaky.sockets.count == 2 })
    #expect(await eventually { await logB.states.last == .ready })
    #expect(await logB.events.contains(.serverError(code: "tencent_4008", message: "idle")))
    await b.stop()
  }

  @Test("new languages need a new connection; new tuning goes down the open one")
  func update() async {
    let opener = FakeOpener()
    opener.onOpen = { _, s in s.serverSend(readyMessage) }
    let client = RelayClient(server: server, token: "t", options: options(), opener: opener, timing: fastTiming())
    await client.start()
    #expect(await eventually { opener.sockets[0].sentText.count == 1 })
    var tuned = options(); tuned.maxSpeakTime = 9
    await client.update(tuned)
    #expect(await eventually { opener.sockets[0].sentText.count == 2 })
    #expect(opener.sockets.count == 1)
    await client.update(RelayOptions(source: "en", target: "zh"))
    #expect(await eventually { opener.sockets.count == 2 })
    #expect(opener.sockets[1].request.url!.query!.contains("source=en"))
    #expect(opener.sockets[0].closedByClient == 1000)
    await client.stop()
  }
}
