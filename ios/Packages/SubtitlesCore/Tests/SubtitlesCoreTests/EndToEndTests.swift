import AVFoundation
import Foundation
import Testing
@testable import SubtitlesCore

// The phone's core against the real server, over a real network stack: the iOS half of the Mac's release test
// (e2e/run.js). Nothing here is a fake of ours — APIClient, RelayClient, TalkSession, Recorder and URLSession are
// what ships — and the other end is server/server.js. `node ios/e2e/run.mjs` starts that server on this Mac with
// stand-ins for Tencent and TokenHub and sets the environment below; without it these tests are skipped.
//
//   E2E_SERVER     the server                      E2E_CONTROL   the harness's control plane (absent on a real server)
//   E2E_PASSWORD   every test account's password   E2E_SECRETS   key values that must never reach the phone
//   E2E_OWNER / E2E_BUSINESS / E2E_HOBBY / E2E_SPENT / E2E_SECURE   the accounts
enum E2E {
  static let env = ProcessInfo.processInfo.environment
  static var server: URL? { env["E2E_SERVER"].flatMap(URL.init(string:)) }
  static var control: URL? { env["E2E_CONTROL"].flatMap(URL.init(string:)) }
  static var on: Bool { server != nil }
  static var hermetic: Bool { control != nil }
  static var password: String { env["E2E_PASSWORD"] ?? "" }
  static var secrets: [String] { (env["E2E_SECRETS"] ?? "").split(separator: ",").map(String.init).filter { $0.count > 8 } }
  static func account(_ name: String) -> String { env["E2E_\(name.uppercased())"] ?? "" }
  static var api: APIClient { APIClient(server: server!) }

  /// Signed in as one of the test accounts. The server allows twenty sign-in attempts a quarter of an hour from one
  /// address — and it should — so a run signs in once per account and device and keeps the token, as the app does.
  static func login(_ name: String, device: String = "iPhone · e2e", fresh: Bool = false) async throws -> APIClient {
    if !fresh, let token = await tokens.get("\(name)|\(device)") { return api.with(token: token) }
    let result = try await api.login(email: account(name), password: password, device: device)
    if !fresh { await tokens.set("\(name)|\(device)", result.token) }
    return api.with(token: result.token)
  }
  static let tokens = TokenCache()

  /// Ask the harness for something only the operator's side can do.
  static func control(_ path: String, _ body: [String: Any]? = nil) async throws -> [String: Any] {
    var request = URLRequest(url: control!.appendingPathComponent(path))
    if let body { request.httpMethod = "POST"; request.httpBody = try JSONSerialization.data(withJSONObject: body); request.setValue("application/json", forHTTPHeaderField: "Content-Type") }
    let (data, _) = try await URLSession.shared.data(for: request)
    return (try JSONSerialization.jsonObject(with: data) as? [String: Any]) ?? [:]
  }

  /// A recording to stand in for the room: the real one named by E2E_AUDIO, or a tone — the stand-in recogniser
  /// does not listen, it counts.
  static func audio(seconds: Double, in folder: URL) throws -> URL {
    if let real = env["E2E_AUDIO"], FileManager.default.fileExists(atPath: real) { return URL(fileURLWithPath: real) }
    let url = folder.appendingPathComponent("room.wav")
    let format = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: 48_000, channels: 1, interleaved: true)!
    let file = try AVAudioFile(forWriting: url, settings: format.settings, commonFormat: .pcmFormatInt16, interleaved: true)
    let samples = tone(seconds)
    let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(samples.count))!
    buffer.frameLength = AVAudioFrameCount(samples.count)
    samples.withUnsafeBufferPointer { buffer.int16ChannelData![0].update(from: $0.baseAddress!, count: samples.count) }
    try file.write(from: buffer)
    return url
  }

  /// Run one talk with a file as the microphone until `sentences` have settled (or `timeout`), then stop it.
  static func talk(as api: APIClient, root: URL, sentences: Int, audioSeconds: Double = 8, record: Bool = true, hotwords: String = "", timeout: Double = hermetic ? 30 : 120) async throws -> (info: RecordingInfo?, lines: [TranscriptLine], phases: [TalkPhase]) {
    let options = RelayOptions(source: "yue", target: "zh", hotwords: hotwords, vadSilenceTime: 700, maxSpeakTime: 6)
    let relay = RelayClient(server: api.server, token: api.token ?? "", options: options)
    let source = FileAudioSource(url: try audio(seconds: audioSeconds, in: root))
    let session = TalkSession(source: source, relay: relay, recorder: Recorder(root: root.appendingPathComponent("Recordings")), options: options, recordAudio: record)
    let log = TalkLog()
    let listening = Task { for await e in session.events { await log.add(e) } }
    try await session.start()
    _ = await eventually(timeout: timeout) {
      let phases = await log.phases
      if phases.contains(where: { if case .refused = $0 { true } else { false } }) { return true }
      return await log.lines.filter { $0.ended }.map(\.id).uniqued().count >= sentences
    }
    let info = await session.stop()
    await listening.value // stopping ends the stream; read the log only once its last event has been delivered
    let lines = await session.transcript.lines
    return (info, lines, await log.phases)
  }
}

extension Array where Element: Hashable { func uniqued() -> [Element] { var seen = Set<Element>(); return filter { seen.insert($0).inserted } } }

@Suite(.serialized, .enabled(if: E2E.on, "needs a server: node ios/e2e/run.mjs")) struct EndToEndTests {
  // ---------------------------------------------------------------- accounts

  @Test("accounts: a wrong password is refused by code, a right one signs in, and the plan comes with the account")
  func accounts() async throws {
    do { _ = try await E2E.api.login(email: E2E.account("business"), password: "not the password", device: "iPhone"); Issue.record("a wrong password signed in") }
    catch let e as APIError { #expect(e.code == "bad_login" && e.status == 401) }
    let api = try await E2E.login("business")
    let me = try await api.me()
    #expect(me.user.email == E2E.account("business"))
    #expect(me.plan.plan == "business" && me.plan.limits.talks == 3 && me.plan.limits.summaries && me.plan.limits.liveSeconds == 40 * 3600)
    let hobby = try await E2E.login("hobby").me()
    #expect(hobby.plan.plan == "hobbyist" && !hobby.plan.limits.summaries && hobby.plan.limits.talks == 1)
    #expect(try await E2E.login("owner").me().plan.liveSecondsLeft == nil, "an administrator has no limit")
    // no token at all is simply not signed in
    do { _ = try await E2E.api.me(); Issue.record("/api/me answered without a login") } catch let e as APIError { #expect(e.status == 401) }
  }

  @Test("two-factor: the password alone is not enough, a wrong code is refused, the right one signs in", .enabled(if: E2E.hermetic))
  func twoFactor() async throws {
    do { _ = try await E2E.api.login(email: E2E.account("secure"), password: E2E.password, device: "iPhone"); Issue.record("signed in without the code") }
    catch let e as APIError { #expect(e.code == "totp_required") }
    do { _ = try await E2E.api.login(email: E2E.account("secure"), password: E2E.password, code: "000000", device: "iPhone"); Issue.record("a wrong code signed in") }
    catch let e as APIError { #expect(e.code == "totp_bad") }
    let code = try #require(try await E2E.control("totp")["code"] as? String)
    let ok = try await E2E.api.login(email: E2E.account("secure"), password: E2E.password, code: code, device: "iPhone")
    #expect(try await E2E.api.with(token: ok.token).twoFactor().enabled)
  }

  @Test("devices: each sign-in is listed, this one is marked, and one signed out from here stops working there")
  func devices() async throws {
    let phone = try await E2E.login("hobby", device: "iPhone · See Subtitles", fresh: true) // these two are signed out below
    let pad = try await E2E.login("hobby", device: "iPad · See Subtitles", fresh: true)
    let list = try await phone.devices()
    #expect(list.filter(\.current).map(\.label) == ["iPhone · See Subtitles"])
    let other = try #require(list.first { $0.label == "iPad · See Subtitles" })
    try await phone.signOut(device: other.id)
    do { _ = try await pad.me(); Issue.record("a signed-out device still works") } catch let e as APIError { #expect(e.status == 401) }
    #expect(try await phone.me().user.email == E2E.account("hobby"))
    // and a relay connection with that dead token ends the talk instead of retrying forever
    let relay = RelayClient(server: E2E.server!, token: pad.token ?? "", options: RelayOptions(source: "yue", target: "zh"))
    let log = collect(relay)
    await relay.start()
    #expect(await eventually(timeout: 10) { await log.refusals.first?.code == "unauthorized" })
    try await phone.logout()
    do { _ = try await phone.me(); Issue.record("logging out left the token alive") } catch let e as APIError { #expect(e.status == 401) }
  }

  @Test("glossary: a list saved on one device is what the account's other devices read, tidied by the server")
  func glossary() async throws {
    let phone = try await E2E.login("business", device: "iPhone")
    let mac = try await E2E.login("business", device: "A Mac")
    let saved = try await phone.saveGlossary([GlossaryItem(term: " 腾讯云 ", weight: 10, note: "Tencent Cloud"), GlossaryItem(term: "共融", weight: 99), GlossaryItem(term: "腾讯云", weight: 3)])
    #expect(saved.items.map(\.term) == ["腾讯云", "共融"], "trimmed, and a repeated term kept once")
    #expect(saved.items[1].weight == 11, "a weight past the scale is brought back onto it; only 100 means always")
    let read = try await mac.glossary()
    #expect(read.items == saved.items && read.hotwords == "腾讯云|10\n共融|11")
  }

  // ---------------------------------------------------------------- plans

  @Test("plans: what a plan may not do it cannot do — no summary on Hobbyist, no talk on spent hours, one talk at a time")
  func plans() async throws {
    let root = temporaryDirectory("e2e"); defer { try? FileManager.default.removeItem(at: root) }
    let hobby = try await E2E.login("hobby")
    do { for try await _ in hobby.summarise(name: "r", language: "zh", target: [Cue(start: 0, end: 1000, text: "你好")], source: []) {}; Issue.record("a Hobbyist got a summary") }
    catch let e as APIError { #expect(e.code == "plan_summaries") }

    let spent = try await E2E.login("spent")
    #expect(try await spent.me().plan.liveSecondsLeft == 0)
    let refused = try await E2E.talk(as: spent, root: root, sentences: 1, timeout: 10)
    #expect(refused.phases.contains { if case .refused(let r) = $0 { r.code == "plan_quota" } else { false } }, "a spent plan was let in: \(refused.phases)")
    #expect(refused.lines.isEmpty)

    // Hobbyist runs one talk at a time: hold one open, and the second is turned away
    let first = RelayClient(server: E2E.server!, token: hobby.token ?? "", options: RelayOptions(source: "yue", target: "zh"))
    let firstLog = collect(first)
    await first.start()
    #expect(await eventually(timeout: 10) { await firstLog.states.contains(.ready) })
    let second = try await E2E.talk(as: hobby, root: root, sentences: 1, timeout: 10)
    #expect(second.phases.contains { if case .refused(let r) = $0 { r.code == "plan_talks" } else { false } }, "a second talk was let in: \(second.phases)")
    await first.stop()
  }

  // ---------------------------------------------------------------- a talk, and what it leaves behind

  @Test("a talk through the relay: translated sentences arrive, the recording and both subtitle files are written, the server counts the seconds, and no key reaches the phone")
  func talk() async throws {
    let root = temporaryDirectory("e2e"); defer { try? FileManager.default.removeItem(at: root) }
    let api = try await E2E.login("business")
    let before = try await api.me().plan.used.liveSeconds
    let began = Date()
    let result = try await E2E.talk(as: api, root: root, sentences: 4, audioSeconds: 7)
    let seconds = Date().timeIntervalSince(began)

    let settled = result.lines.filter { $0.ended && $0.kind == .speech }
    #expect(settled.count >= 4, "only \(settled.count) sentences settled; phases \(result.phases)")
    #expect(result.phases.contains(.listening) && result.phases.last == .ended, "phases: \(result.phases)")
    // with a real recogniser a short sentence can read the same in Cantonese and Mandarin; most will not
    #expect(settled.prefix(4).filter { $0.targetText != $0.sourceText }.count >= (E2E.hermetic ? 4 : 2), "not translated: \(settled.prefix(4))")
    for line in settled.prefix(4) {
      #expect(!line.sourceText.isEmpty && !line.targetText.isEmpty, "a sentence with nothing in it: \(line)")
      #expect(line.wallStart != nil && line.wallEnd != nil, "a sentence without its times cannot become a cue")
      #expect(line.wallStart! > began.timeIntervalSince1970 * 1000 - 2000 && line.wallStart! < Date().timeIntervalSince1970 * 1000, "cue times must be on this device's clock, not the server's stream position")
    }
    if E2E.hermetic {
      #expect(settled[0].targetText == "大家好，欢迎来到今天的分享。" && settled[0].sourceText == "大家好，欢迎嚟到今日嘅分享。")
      #expect((try await E2E.control("tokenhub")["translations"] as? Int ?? 0) >= 4)
    }

    // what it leaves behind
    let info = try #require(result.info)
    let recording = try #require(RecordingLibrary(root: root.appendingPathComponent("Recordings")).recording(id: info.id))
    #expect(recording.audio?.pathExtension == "m4a")
    #expect(abs(try audioSeconds(recording.audio!) - Double(info.durationMs) / 1000) < 0.3)
    #expect(Double(info.durationMs) / 1000 > 3, "the recording is shorter than the talk: \(info.durationMs) ms")
    let cues = recording.cues()
    #expect(cues.target.count == info.cues && cues.target.count >= 4 && cues.source.count == cues.target.count)
    #expect(Array(cues.target.map(\.text).prefix(4)) == settled.prefix(4).map(\.targetText))
    #expect(cues.target.allSatisfy { $0.start >= 0 && $0.end > $0.start && $0.end <= info.durationMs + 1500 }, "cues outside the recording: \(cues.target)")
    #expect(recording.manifest.source == "yue" && recording.manifest.target == "zh")
    #expect(recording.transcript().lines.filter(\.ended).count >= 4)

    // the server counted what passed through it: about as many seconds as the talk lasted, not zero and not double
    try await Task.sleep(for: .seconds(1.5))
    let charged = try await api.me().plan.used.liveSeconds - before
    #expect(charged >= 3 && charged <= seconds + 3, "charged \(charged) s for a talk of \(seconds) s")

    // and nothing that is a key is in anything the talk wrote
    for file in try FileManager.default.contentsOfDirectory(at: recording.folder, includingPropertiesForKeys: nil) where ["srt", "json", "txt", "md"].contains(file.pathExtension) {
      let text = try String(contentsOf: file, encoding: .utf8)
      for secret in E2E.secrets { #expect(!text.contains(secret), "\(file.lastPathComponent) contains a key") }
    }
  }

  @Test("a talk that is only listened to keeps its words and no sound")
  func transcriptOnly() async throws {
    let root = temporaryDirectory("e2e"); defer { try? FileManager.default.removeItem(at: root) }
    let result = try await E2E.talk(as: try await E2E.login("business"), root: root, sentences: 2, audioSeconds: 4, record: false)
    let info = try #require(result.info)
    #expect(!info.hasAudio && info.cues >= 2)
    let recording = try #require(RecordingLibrary(root: root.appendingPathComponent("Recordings")).recording(id: info.id))
    #expect(recording.audio == nil && recording.manifest.kind == .transcriptOnly && recording.cues().target.count >= 2)
  }

  @Test("a summary: written by the server with its own key and the shared prompt, streamed as it is written, cleaned of invented timestamps")
  func summary() async throws {
    let api = try await E2E.login("business")
    var target = [Cue(start: 1000, end: 3000, text: "大家好，欢迎来到今天的分享。"), Cue(start: 4000, end: 9000, text: "今天我们会讲一下如何用字幕帮助更多人参与会议。")]
    let source = [Cue(start: 1000, end: 3000, text: "大家好，欢迎嚟到今日嘅分享。")]
    if !E2E.hermetic { // a real model needs a talk with something in it
      let more = ["首先是现场的观众，他们可以用手机扫二维码，在自己的屏幕上看字幕。", "第二，是会后想重温内容的人，他们需要可以检索的文字。", "字幕不只是给听不见的人，是给所有人：听不清、听不懂、走神的人都在看。",
                  "要让字幕准确，最重要的是事先准备：把人名和术语提前放进词汇表。", "话筒要离讲者一个拳头以内，房间越吵，越要靠近。", "如果网络中断，录音不会停，字幕会在网络恢复后自动回来。",
                  "会后可以用云端重做字幕，补上中断时漏掉的部分。", "最后，把录音、字幕和总结一起发给参加者，让没到场的人也能跟上。"]
      for (i, text) in more.enumerated() { target.append(Cue(start: 10_000 + i * 8000, end: 17_000 + i * 8000, text: text)) }
    }
    var stages: [String] = [], streamed = "", finished = ""
    for try await event in api.summarise(name: "9月20号11点33分", language: "zh", target: target, source: source) {
      switch event { case .stage(let s): stages.append(s); case .delta(let t): streamed += t; case .done(let m): finished = m }
    }
    #expect(stages.first == "asking" && stages.contains("writing"))
    #expect(!streamed.isEmpty && finished.contains("\n# ") && finished.hasPrefix("<!-- recording: 9月20号11点33分"), "not a summary: \(finished.prefix(300))")
    if E2E.hermetic { #expect(finished.contains("## 要点")) }
    for secret in E2E.secrets { #expect(!finished.contains(secret) && !streamed.contains(secret)) }
    if E2E.hermetic {
      #expect(finished.contains("[00:02]") && !finished.contains("[59:59]"), "a timestamp beyond the recording must be dropped")
      let hub = try await E2E.control("tokenhub")
      let asked = try #require(hub["lastSummaryRequest"] as? [String: Any])
      #expect((asked["system"] as? String)?.contains("综合而不是罗列") == true, "the server must ask with the shared prompt")
      let message = ((asked["messages"] as? [[String: Any]])?.first?["content"] as? String) ?? ""
      #expect(message.contains("[00:01] 大家好，欢迎来到今天的分享。\n    （原文：大家好，欢迎嚟到今日嘅分享。）"))
      let keys = (hub["keysSeen"] as? [String]) ?? []
      #expect(!keys.isEmpty && keys.allSatisfy { $0.hasPrefix("Bearer sk-e2e") }, "TokenHub must see the server's key and never the account's token: \(keys)")
    }
  }

  @Test("re-subtitling for real: the recording a talk left is recognised again as a whole file, and the talk's own subtitles are kept beside the new ones", .enabled(if: !E2E.hermetic, "the stand-ins have no file recognition"))
  func resubtitle() async throws {
    let root = temporaryDirectory("e2e"); defer { try? FileManager.default.removeItem(at: root) }
    let api = try await E2E.login("business")
    let before = try await api.me().plan.used.fileSeconds
    let talked = try await E2E.talk(as: api, root: root, sentences: 3)
    let info = try #require(talked.info)
    let library = RecordingLibrary(root: root.appendingPathComponent("Recordings"))
    let recording = try #require(library.recording(id: info.id))
    let live = recording.cues().target
    #expect(Resubtitler.canResubtitle(recording) && !live.isEmpty)

    let stages = StageLog()
    try await Resubtitler(api: api).run(recording) { stages.add($0) }

    let after = try #require(library.recording(id: info.id))
    #expect(after.resubtitled, "the talk's own subtitles were not kept as .live.srt")
    #expect(!after.cues().target.isEmpty && !after.cues().source.isEmpty, "the cloud's subtitles did not arrive")
    #expect(after.cues().target.allSatisfy { $0.end <= info.durationMs + 2000 }, "cues beyond the recording: \(after.cues().target)")
    #expect(stages.values.contains { if case .working = $0 { true } else { false } } && stages.values.last == .downloading)
    let kept = try String(contentsOf: after.folder.appendingPathComponent(RecordingNames.liveName(RecordingNames.srtName(info.id, language: "zh"))), encoding: .utf8)
    #expect(SRT.parse(kept) == live)
    #expect(try await api.me().plan.used.fileSeconds > before, "the file hours did not move")
    for secret in E2E.secrets { for file in after.files where file.pathExtension == "srt" { #expect(!(try String(contentsOf: file, encoding: .utf8)).contains(secret)) } }
  }

  // ---------------------------------------------------------------- someone else's talk

  @Test("joining a talk: no account needed; the host's name, languages and lines arrive — drafts, then settled — and its end is told", .enabled(if: E2E.hermetic))
  func join() async throws {
    let started = try await E2E.control("host/start", ["name": "字幕与共融 讲座", "target": "zh"])
    let code = try #require(started["code"] as? String)
    #expect(APIClient.shareCode(from: try #require(started["shareUrl"] as? String)) == code)
    _ = try await E2E.control("host/say", ["code": code]) // said before anyone joined: it is there on arrival

    let log = JoinLog()
    let following = Task { do { for try await event in E2E.api.join(code: code) { await log.add(event) } } catch { await log.fail(error) } }
    #expect(await eventually(timeout: 10) { await log.started != nil })
    let arrival = try #require(await log.started)
    #expect(arrival.name == "字幕与共融 讲座" && arrival.source == "yue" && arrival.target == "zh" && arrival.live)
    #expect(arrival.lines.map(\.targetText) == ["大家好，欢迎来到今天的分享。"])

    let said = try #require(try await E2E.control("host/say", ["code": code])["target"] as? String)
    #expect(await eventually(timeout: 10) { await log.lines.contains { $0.ended == true && $0.targetText == said } })
    #expect(await log.lines.contains { $0.ended != true }, "a draft arrives before the settled line")
    _ = try await E2E.control("host/end", ["code": code])
    #expect(await eventually(timeout: 15) { await log.ended })
    following.cancel()
    #expect(await log.error == nil)

    do { for try await _ in E2E.api.join(code: "nosuch") {}; Issue.record("a made-up code was followed") } catch let e as APIError { #expect(e.status == 404) }
  }

  @Test("the server is the one in the repository: the universal-link file names this app")
  func universalLinks() async throws {
    let (data, response) = try await URLSession.shared.data(from: E2E.server!.appendingPathComponent(".well-known/apple-app-site-association"))
    #expect((response as? HTTPURLResponse)?.statusCode == 200)
    #expect(String(decoding: data, as: UTF8.self).contains("com.algernonlabs.seesubtitles"))
  }
}

actor TokenCache {
  private var tokens: [String: String] = [:]
  func get(_ key: String) -> String? { tokens[key] }
  func set(_ key: String, _ token: String) { tokens[key] = token }
}

actor JoinLog {
  struct Arrival { let name: String; let lines: [JoinedLine]; let live: Bool; let source: String?; let target: String? }
  private(set) var started: Arrival?
  private(set) var lines: [JoinedLine] = []
  private(set) var ended = false
  private(set) var error: String?
  func add(_ event: JoinEvent) {
    switch event {
    case .started(let name, let lines, let live, let source, let target): started = Arrival(name: name, lines: lines, live: live, source: source, target: target)
    case .line(let line): lines.append(line)
    case .status(let live, _): if !live { ended = true }
    case .cleared: break
    }
  }
  func fail(_ e: Error) { if !(e is CancellationError) { error = "\(e)" } }
}
