import Foundation

/// The hosted server, as this app uses it. Every call carries the account's bearer token except logging in and
/// joining a talk, which need none. The Tencent and TokenHub keys are the server's and never come here.
public struct APIClient: Sendable {
  public static let production = URL(string: "https://seesubtitles.com")!

  public let server: URL
  public let token: String?
  private let session: URLSession

  public init(server: URL = APIClient.production, token: String? = nil, session: URLSession = .shared) {
    self.server = server; self.token = token; self.session = session
  }

  public func with(token: String?) -> APIClient { APIClient(server: server, token: token, session: session) }

  // ---------------------------------------------------------------- plumbing

  func request(_ method: String, _ path: String, json: [String: Any]? = nil) -> URLRequest {
    var r = URLRequest(url: server.appendingPathComponent(path))
    r.httpMethod = method
    if let token { r.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
    if let json {
      r.setValue("application/json", forHTTPHeaderField: "Content-Type")
      r.httpBody = try? JSONSerialization.data(withJSONObject: json)
    }
    return r
  }

  private struct Failure: Decodable { let error: String?; let code: String? }

  static func check(_ data: Data, _ response: URLResponse) throws {
    guard let http = response as? HTTPURLResponse else { return }
    guard !(200..<300).contains(http.statusCode) else { return }
    let failure = try? JSONDecoder().decode(Failure.self, from: data)
    throw APIError(status: http.statusCode, code: failure?.code, message: failure?.error ?? HTTPURLResponse.localizedString(forStatusCode: http.statusCode))
  }

  func send<T: Decodable>(_ request: URLRequest, as type: T.Type = T.self) async throws -> T {
    let (data, response) = try await session.data(for: request)
    try Self.check(data, response)
    return try JSONDecoder().decode(T.self, from: data)
  }

  private struct Ok: Decodable { let ok: Bool? }
  func send(_ request: URLRequest) async throws { _ = try await send(request, as: Ok.self) }

  /// An event stream: the response's lines as events, ending when the server closes it or the task is cancelled.
  func events(_ request: URLRequest) -> AsyncThrowingStream<ServerSentEvent, Error> {
    let session = self.session
    return AsyncThrowingStream { continuation in
      let task = Task {
        do {
          var r = request
          r.timeoutInterval = 3600 // a model that is thinking, or a quiet room, says nothing for a long while
          let (bytes, response) = try await session.bytes(for: r)
          if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
            var body = Data()
            for try await byte in bytes { body.append(byte); if body.count > 4096 { break } }
            try Self.check(body, response)
          }
          var parser = ServerSentEventParser()
          for try await line in bytes.lines { if let event = parser.feed(line) { continuation.yield(event) } }
          continuation.finish()
        } catch {
          continuation.finish(throwing: error)
        }
      }
      continuation.onTermination = { _ in task.cancel() }
    }
  }

  // ---------------------------------------------------------------- the account

  public struct Login: Decodable, Sendable { public let token: String; public let user: User }
  public struct PublicConfig: Decodable, Sendable { public let apple: Bool }
  public struct AppleStatus: Decodable, Sendable { public let enabled: Bool; public let linked: Bool }

  public func publicConfig() async throws -> PublicConfig { try await send(request("GET", "api/config")) }

  public func loginApple(code: String, nonce: String) async throws -> Login {
    try await send(request("POST", "api/apple/native", json: ["code": code, "nonce": nonce]))
  }

  public func appleStatus() async throws -> AppleStatus { try await send(request("GET", "api/apple/status")) }

  public func linkApple(code: String, nonce: String, password: String, totp: String?) async throws {
    var body: [String: Any] = ["code": code, "nonce": nonce, "password": password]
    if let totp { body["totp"] = totp }
    try await send(request("POST", "api/apple/link-native", json: body))
  }

  /// - Parameter code: the 6-digit code, once the server has answered `totp_required`.
  public func login(email: String, password: String, code: String? = nil, device: String) async throws -> Login {
    var body: [String: Any] = ["email": email, "password": password, "kind": "bearer", "label": device]
    if let code, !code.isEmpty { body["code"] = code }
    return try await send(request("POST", "api/login", json: body))
  }

  public func logout() async throws { try await send(request("POST", "api/logout")) }
  public func me() async throws -> Account { try await send(request("GET", "api/me")) }

  public func usageDetail(month: String, userId: Int? = nil) async throws -> UsageBreakdown {
    var r = request("GET", userId == nil ? "api/usage/detail" : "api/team/usage")
    var url = URLComponents(url: r.url!, resolvingAgainstBaseURL: false)!
    url.queryItems = [URLQueryItem(name: "month", value: month)]
    if let userId { url.queryItems?.append(URLQueryItem(name: "userId", value: String(userId))) }
    r.url = url.url!
    return try await send(r)
  }

  public func usageAccounts() async throws -> [User] {
    struct Team: Decodable { let users: [User] }
    let team: Team = try await send(request("GET", "api/team"))
    return team.users
  }

  public func changePassword(current: String, next: String) async throws {
    try await send(request("POST", "api/account/password", json: ["current": current, "next": next]))
  }

  public func twoFactor() async throws -> TwoFactorStatus { try await send(request("GET", "api/account/totp")) }
  public func devices() async throws -> [Device] { try await send(request("GET", "api/account/tokens")) }
  public func signOut(device id: String) async throws { try await send(request("POST", "api/account/tokens/revoke", json: ["id": id])) }
  public func signOutEverywhereElse() async throws { try await send(request("POST", "api/account/tokens/revoke", json: ["all": true])) }

  public func glossary() async throws -> Glossary { try await send(request("GET", "api/glossary")) }
  public func saveGlossary(_ items: [GlossaryItem]) async throws -> Glossary {
    let list = items.map { item -> [String: Any] in
      var o: [String: Any] = ["term": item.term, "weight": item.weight]
      if let note = item.note { o["note"] = note }
      return o
    }
    return try await send(request("PUT", "api/glossary", json: ["items": list]))
  }

  // ---------------------------------------------------------------- summaries

  /// Ask for a learning summary of a recording's cues. The text streams in as it is written; `.done` carries the
  /// finished Markdown, which replaces whatever streamed (a summary over its length cap is condensed at the end).
  public func summarise(name: String, language: String, target: [Cue], source: [Cue]) -> AsyncThrowingStream<SummaryEvent, Error> {
    func list(_ cues: [Cue]) -> [[String: Any]] { cues.map { ["start": $0.start, "end": $0.end, "text": $0.text] } }
    let events = self.events(request("POST", "api/summaries", json: ["name": name, "language": language, "target": list(target), "source": list(source)]))
    struct Stage: Decodable { let stage: String }
    struct Delta: Decodable { let text: String }
    struct Done: Decodable { let markdown: String }
    struct Failed: Decodable { let code: String?; let message: String? }
    return AsyncThrowingStream { continuation in
      let task = Task {
        do {
          for try await event in events {
            switch event.name {
            case "stage": continuation.yield(.stage(try event.decode(Stage.self).stage))
            case "delta": continuation.yield(.delta(try event.decode(Delta.self).text))
            case "done": continuation.yield(.done(markdown: try event.decode(Done.self).markdown))
            case "error":
              let f = try event.decode(Failed.self)
              throw APIError(status: 502, code: f.code, message: f.message ?? "the summary failed")
            default: break
            }
          }
          continuation.finish()
        } catch { continuation.finish(throwing: error) }
      }
      continuation.onTermination = { _ in task.cancel() }
    }
  }

  // ---------------------------------------------------------------- cloud re-subtitling

  public func jobLanguages() async throws -> JobLanguages { try await send(request("GET", "api/languages")) }

  public func createJob(filename: String, size: Int, sourceLanguage: String, targetLanguage: String) async throws -> Job {
    try await send(request("POST", "api/jobs", json: ["filename": filename, "size": size, "sourceLang": sourceLanguage, "targetLang": targetLanguage]))
  }

  public func upload(_ file: URL, to job: Job) async throws -> Job {
    var r = request("PUT", "api/jobs/\(job.id)/upload")
    r.setValue("application/octet-stream", forHTTPHeaderField: "Content-Type")
    let (data, response) = try await session.upload(for: r, fromFile: file)
    try Self.check(data, response)
    return try JSONDecoder().decode(Job.self, from: data)
  }

  public func job(_ id: String) async throws -> Job { try await send(request("GET", "api/jobs/\(id)")) }
  public func deleteJob(_ id: String) async throws { try await send(request("DELETE", "api/jobs/\(id)")) }

  public func download(_ name: String, of job: Job, to destination: URL) async throws {
    let (temp, response) = try await session.download(for: request("GET", "jobs/\(job.id)/files/\(name)"))
    try Self.check(Data(), response)
    try? FileManager.default.removeItem(at: destination)
    try FileManager.default.moveItem(at: temp, to: destination)
  }

  // ---------------------------------------------------------------- joining a talk

  /// "k7m2xq", "https://seesubtitles.com/d/k7m2xq" or what a QR code holds → the share code, or nil.
  public static func shareCode(from text: String) -> String? {
    let t = text.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    if let m = try? /\/d\/([a-z0-9]{4,12})(?:[\/?#].*)?$/.firstMatch(in: t) { return String(m.1) }
    return (try? /^[a-z0-9]{4,12}$/.wholeMatch(in: t)) != nil ? t : nil
  }

  /// Follow someone else's talk through its share code. Needs no account, like the web page it mirrors.
  public func join(code: String) -> AsyncThrowingStream<JoinEvent, Error> {
    let anonymous = with(token: nil) // the request is built by the client without a token, not only sent by it
    let events = anonymous.events(anonymous.request("GET", "api/d/\(code)/stream"))
    struct Status: Decodable { let live: Bool?; let viewers: Int? }
    struct Initial: Decodable { struct Session: Decodable { let name: String? }; struct Settings: Decodable { let source: String?; let target: String? }; let session: Session?; let lines: [JoinedLine]?; let status: Status?; let settings: Settings? }
    return AsyncThrowingStream { continuation in
      let task = Task {
        do {
          for try await event in events {
            switch event.name {
            case "init":
              let i = try event.decode(Initial.self)
              continuation.yield(.started(name: i.session?.name ?? "", lines: i.lines ?? [], live: i.status?.live ?? true, source: i.settings?.source, target: i.settings?.target))
            case "line": if let line = try? event.decode(JoinedLine.self) { continuation.yield(.line(line)) }
            case "clear": continuation.yield(.cleared)
            case "status": if let s = try? event.decode(Status.self) { continuation.yield(.status(live: s.live ?? true, viewers: s.viewers ?? 0)) }
            default: break
            }
          }
          continuation.finish()
        } catch { continuation.finish(throwing: error) }
      }
      continuation.onTermination = { _ in task.cancel() }
    }
  }
}
