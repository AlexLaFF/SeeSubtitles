import Foundation
import Testing
@testable import SubtitlesCore

/// The server, as far as URLSession can tell: answers by path, and keeps what it was asked.
final class StubServer: URLProtocol, @unchecked Sendable {
  struct Answer { var status = 200; var headers = ["Content-Type": "application/json"]; var body = Data() }
  nonisolated(unsafe) static var routes: [String: @Sendable (URLRequest, Data) -> Answer] = [:]
  nonisolated(unsafe) static var asked: [(request: URLRequest, body: Data)] = []
  static let lock = NSLock()

  static func session() -> URLSession {
    let config = URLSessionConfiguration.ephemeral
    config.protocolClasses = [StubServer.self]
    return URLSession(configuration: config)
  }
  static func reset() { lock.withLock { routes = [:]; asked = [] } }
  static func on(_ route: String, _ answer: @escaping @Sendable (URLRequest, Data) -> Answer) { lock.withLock { routes[route] = answer } }
  static func json(_ text: String, status: Int = 200) -> Answer { Answer(status: status, body: Data(text.utf8)) }

  override class func canInit(with request: URLRequest) -> Bool { true }
  override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
  override func stopLoading() {}
  override func startLoading() {
    var body = request.httpBody ?? Data()
    if let stream = request.httpBodyStream {
      stream.open(); defer { stream.close() }
      var buffer = [UInt8](repeating: 0, count: 65_536)
      while stream.hasBytesAvailable { let n = stream.read(&buffer, maxLength: buffer.count); if n <= 0 { break }; body.append(buffer, count: n) }
    }
    let key = "\(request.httpMethod ?? "GET") \(request.url!.path)"
    let handler = Self.lock.withLock { () -> (@Sendable (URLRequest, Data) -> Answer)? in Self.asked.append((request, body)); return Self.routes[key] }
    let answer = handler?(request, body) ?? Answer(status: 404, body: Data(#"{"error":"unknown endpoint"}"#.utf8))
    client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: answer.status, httpVersion: "HTTP/1.1", headerFields: answer.headers)!, cacheStoragePolicy: .notAllowed)
    client?.urlProtocol(self, didLoad: answer.body)
    client?.urlProtocolDidFinishLoading(self)
  }
}

@Suite(.serialized) struct APIClientTests {
  let api = APIClient(server: URL(string: "https://seesubtitles.test")!, token: "tok", session: StubServer.session())

  @Test("logging in sends a bearer request and the server's refusals come back as codes")
  func login() async throws {
    StubServer.reset()
    StubServer.on("POST /api/login") { _, body in
      let o = try! JSONSerialization.jsonObject(with: body) as! [String: Any]
      if o["password"] as? String != "right" { return StubServer.json(#"{"error":"wrong email or password","code":"bad_login"}"#, status: 401) }
      if o["code"] == nil { return StubServer.json(#"{"error":"enter the 6-digit code","code":"totp_required"}"#, status: 401) }
      return StubServer.json(#"{"ok":true,"user":{"id":7,"email":"a@b.c"},"token":"new-token"}"#)
    }
    let anonymous = api.with(token: nil)
    await #expect(throws: APIError(status: 401, code: "bad_login", message: "wrong email or password")) { try await anonymous.login(email: "a@b.c", password: "wrong", device: "iPhone") }
    do { _ = try await anonymous.login(email: "a@b.c", password: "right", device: "iPhone"); Issue.record("expected totp_required") }
    catch let e as APIError { #expect(e.code == "totp_required") }
    let ok = try await anonymous.login(email: "a@b.c", password: "right", code: "123456", device: "Alex’s iPhone")
    #expect(ok.token == "new-token" && ok.user.id == 7)
    let sent = try JSONSerialization.jsonObject(with: StubServer.asked.last!.body) as! [String: Any]
    #expect(sent["kind"] as? String == "bearer" && sent["label"] as? String == "Alex’s iPhone" && sent["code"] as? String == "123456")
    #expect(StubServer.asked.last!.request.value(forHTTPHeaderField: "Authorization") == nil)
  }

  @Test("the account, its plan, its glossary and its devices are read as the server writes them")
  func account() async throws {
    StubServer.reset()
    StubServer.on("GET /api/me") { _, _ in StubServer.json(#"{"user":{"id":1,"email":"a@b.c","role":"user","created_at":1},"plan":{"plan":"business","name":"Business","price":88,"month":"2026-09","team":null,"limits":{"liveSeconds":144000,"fileSeconds":72000,"talks":3,"sharing":true,"summaries":true,"team":false,"directLive":false},"used":{"liveSeconds":121680,"fileSeconds":15000}},"baseUrl":"https://x","creds":true,"signup":"closed"}"#) }
    StubServer.on("GET /api/glossary") { _, _ in StubServer.json(#"{"items":[{"term":"腾讯云","weight":10,"note":"Tencent Cloud"},{"term":"共融","weight":8}],"updatedAt":5}"#) }
    StubServer.on("PUT /api/glossary") { _, body in StubServer.json(String(decoding: body, as: UTF8.self).replacingOccurrences(of: "}]}", with: #"}],"updatedAt":9}"#)) }
    StubServer.on("GET /api/account/tokens") { _, _ in StubServer.json(#"[{"id":"ab12","kind":"bearer","label":"Alex’s iPhone","created_at":1,"last_used":2,"current":true}]"#) }
    let me = try await api.me()
    #expect(me.plan.limits.talks == 3 && me.plan.limits.summaries && me.plan.liveSecondsLeft == 22_320)
    #expect(StubServer.asked[0].request.value(forHTTPHeaderField: "Authorization") == "Bearer tok")
    let glossary = try await api.glossary()
    #expect(glossary.hotwords == "腾讯云|10\n共融|8")
    let saved = try await api.saveGlossary([GlossaryItem(term: "安利", weight: 100)])
    #expect(saved.items == [GlossaryItem(term: "安利", weight: 100)] && saved.updatedAt == 9)
    #expect(try await api.devices().first?.current == true)
    // an administrator's plan has no limits at all
    StubServer.on("GET /api/me") { _, _ in StubServer.json(#"{"user":{"id":1,"email":"a@b.c"},"plan":{"plan":"admin","name":"Administrator","month":"2026-09","limits":{"liveSeconds":null,"fileSeconds":null,"talks":null,"sharing":true,"summaries":true},"used":{"liveSeconds":5,"fileSeconds":0}}}"#) }
    #expect(try await api.me().plan.liveSecondsLeft == nil)
  }

  @Test("a summary streams in: stages, the text as it is written, then the finished Markdown")
  func summary() async throws {
    StubServer.reset()
    let stream = ":ok\n\nevent: stage\ndata: {\"stage\":\"asking\"}\n\n:\n\nevent: delta\ndata: {\"text\":\"# 《题》\\n\"}\n\nevent: delta\ndata: {\"text\":\"正文\"}\n\nevent: done\ndata: {\"markdown\":\"<!-- x -->\\n\\n# 《题》\\n正文\",\"meta\":{\"chars\":4}}\n\n"
    StubServer.on("POST /api/summaries") { _, _ in StubServer.Answer(headers: ["Content-Type": "text/event-stream"], body: Data(stream.utf8)) }
    var events: [SummaryEvent] = []
    for try await e in api.summarise(name: "r", language: "zh", target: [Cue(start: 1000, end: 2000, text: "你好")], source: []) { events.append(e) }
    #expect(events == [.stage("asking"), .delta("# 《题》\n"), .delta("正文"), .done(markdown: "<!-- x -->\n\n# 《题》\n正文")])
    let sent = try JSONSerialization.jsonObject(with: StubServer.asked[0].body) as! [String: Any]
    #expect((sent["target"] as? [[String: Any]])?.first?["start"] as? Int == 1000)

    // the plan says no before anything streams; a failure mid-stream arrives as an event
    StubServer.on("POST /api/summaries") { _, _ in StubServer.json(#"{"error":"AI summaries are not in this plan","code":"plan_summaries"}"#, status: 403) }
    do { for try await _ in api.summarise(name: "r", language: "zh", target: [], source: []) {}; Issue.record("expected an error") }
    catch let e as APIError { #expect(e.code == "plan_summaries" && e.status == 403) }
    StubServer.on("POST /api/summaries") { _, _ in StubServer.Answer(headers: ["Content-Type": "text/event-stream"], body: Data("event: error\ndata: {\"code\":\"no_cues\",\"message\":\"no subtitle cues\"}\n\n".utf8)) }
    do { for try await _ in api.summarise(name: "r", language: "zh", target: [], source: []) {}; Issue.record("expected an error") }
    catch let e as APIError { #expect(e.code == "no_cues") }
  }

  @Test("joining a talk needs no account and reads the host's lines")
  func join() async throws {
    StubServer.reset()
    let stream = "event: init\ndata: {\"session\":{\"code\":\"k7m2xq\",\"name\":\"字幕与共融\"},\"lines\":[{\"id\":\"v:0\",\"sourceText\":\"甲\",\"targetText\":\"A\",\"ended\":true,\"wallStart\":10}],\"status\":{\"live\":true,\"viewers\":3}}\n\nevent: line\ndata: {\"id\":\"v:1\",\"targetText\":\"B\",\"ended\":false}\n\nevent: status\ndata: {\"live\":false,\"viewers\":2}\n\n"
    StubServer.on("GET /api/d/k7m2xq/stream") { _, _ in StubServer.Answer(headers: ["Content-Type": "text/event-stream"], body: Data(stream.utf8)) }
    var events: [JoinEvent] = []
    for try await e in api.join(code: "k7m2xq") { events.append(e) }
    guard case .started(let name, let lines, let live) = events[0] else { Issue.record("no init"); return }
    #expect(name == "字幕与共融" && live && lines.count == 1 && lines[0].asResult.sentenceEnd)
    #expect(events.count == 3 && events[2] == .status(live: false, viewers: 2))
    #expect(StubServer.asked[0].request.value(forHTTPHeaderField: "Authorization") == nil, "a share link is followed without the account")

    #expect(APIClient.shareCode(from: "https://seesubtitles.com/d/K7M2XQ") == "k7m2xq")
    #expect(APIClient.shareCode(from: " k7m2xq\n") == "k7m2xq")
    #expect(APIClient.shareCode(from: "https://seesubtitles.com/d/k7m2xq?x=1") == "k7m2xq")
    #expect(APIClient.shareCode(from: "https://example.com/") == nil)
    #expect(APIClient.shareCode(from: "not a code!") == nil)
  }

  @Test("event streams are read line by line, heartbeats ignored")
  func sse() {
    var p = ServerSentEventParser()
    let lines = [":ok", "event: job", "data: {\"a\":1}", ":hb", "data: {\"b\":2}", "event:  x ", "data:{\"c\":3}"]
    let out = lines.compactMap { p.feed($0) }
    #expect(out.map(\.name) == ["job", "message", "x"])
    #expect(String(decoding: out[2].data, as: UTF8.self) == "{\"c\":3}")
  }
}
