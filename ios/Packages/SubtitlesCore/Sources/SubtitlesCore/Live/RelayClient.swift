import Foundation

/// Where the connection to the relay stands.
public enum RelayState: String, Sendable, Equatable {
  case idle, connecting, ready, reconnecting
  /// The server said no in a way that asking again will not change: the plan, the login, the language pair.
  case refused
  case stopped
}

/// Why a talk was refused. `code` is the server's (`plan_talks`, `plan_quota`, `bad_language`) or `unauthorized`.
public struct RelayRefusal: Sendable, Equatable, Error {
  public let code: String
  public let message: String
  public init(code: String, message: String) { self.code = code; self.message = message }
}

public enum RelayEvent: Sendable, Equatable {
  /// `retryAt` is when the next attempt is due, in ms since 1970, while reconnecting.
  case state(RelayState, retryAt: Double?)
  case result(LiveResult)
  /// The relay's own connection to the recogniser: "ready", "reconnecting", …
  case upstream(String)
  case refused(RelayRefusal)
  /// Something went wrong upstream (`tencent_4008`, …); the client keeps going.
  case serverError(code: String, message: String)
  case log(String)
}

/// The live pipeline with the hosted server in the path: a port of core/remote-stream.js. Push 200 ms chunks of
/// audio, read results from `events`. The server holds the keys, opens the real stream and counts the seconds.
///
/// A client carries one talk: `start()`, then `stop()`, which ends `events`. Make another for the next talk.
public actor RelayClient {
  public struct Timing: Sendable {
    public var chunkMs = 200.0
    public var keepaliveMs = 4_000.0
    public var backoffMs: [Double] = [500, 1_000, 2_000, 4_000, 8_000, 10_000]
    /// A connection that has lasted this long has earned a fresh backoff.
    public var stableMs = 30_000.0
    /// Audio held while (re)connecting: a second, the same as the Mac.
    public var maxQueue = 5
    public init() {}
  }

  /// Refusals that end the talk. Anything else is retried.
  static let terminalCodes: Set<String> = ["plan_quota", "plan_talks", "bad_language", "multilingual_unavailable"]

  public nonisolated let events: AsyncStream<RelayEvent>
  private let continuation: AsyncStream<RelayEvent>.Continuation
  private let server: URL
  private let token: String
  private let opener: any RelaySocketOpener
  private let timing: Timing
  private let now: @Sendable () -> Double

  private var options: RelayOptions
  private var queue: [AudioChunk] = []
  private var socket: (any RelaySocket)?
  private var generation = 0
  private var running = false
  private var refusal: RelayRefusal?
  private var attempt = 0
  private var openedAt: Double?
  private var lastSentAt = 0.0
  private var pacer: Task<Void, Never>?
  private var receiver: Task<Void, Never>?
  private var retry: Task<Void, Never>?

  public private(set) var state: RelayState = .idle
  public private(set) var connects = 0
  public private(set) var dropped = 0
  public private(set) var keepalives = 0

  public init(server: URL, token: String, options: RelayOptions, opener: any RelaySocketOpener = URLSessionRelayOpener(),
              timing: Timing = Timing(), now: @escaping @Sendable () -> Double = { Date().timeIntervalSince1970 * 1000 }) {
    self.server = server; self.token = token; self.options = options
    self.opener = opener; self.timing = timing; self.now = now
    (events, continuation) = AsyncStream.makeStream(of: RelayEvent.self, bufferingPolicy: .bufferingNewest(512))
  }

  // ---------------------------------------------------------------- the talk

  public func start() {
    guard !running, state != .stopped else { return }
    running = true
    refusal = nil
    connect()
    let interval = timing.chunkMs
    pacer = Task { [weak self] in
      while !Task.isCancelled {
        try? await Task.sleep(for: .milliseconds(interval))
        await self?.tick()
      }
    }
  }

  public func stop() async {
    guard state != .stopped else { return }
    let wasReady = state == .ready
    running = false
    pacer?.cancel(); retry?.cancel()
    if wasReady, let socket { try? await socket.send(.text(#"{"type":"stop"}"#)) }
    closeSocket()
    queue.removeAll()
    setState(.stopped)
    continuation.finish()
  }

  /// Queue one chunk. While the connection is down the newest second is kept and the rest is dropped: subtitles
  /// resume from now, not from a backlog. The recording is not this client's business and loses nothing.
  public func push(_ chunk: AudioChunk) {
    guard running else { return }
    queue.append(chunk)
    if queue.count > timing.maxQueue {
      let excess = queue.count - timing.maxQueue
      queue.removeFirst(excess)
      dropped += excess
    }
  }

  /// Languages, pipeline and model need a new connection; tuning goes down the open one.
  public func update(_ next: RelayOptions) async {
    let old = options
    options = next
    guard running, next != old else { return }
    if next.needsReconnect(from: old) { return reconnect(reason: "settings changed") }
    if state == .ready, let socket { try? await socket.send(.text(next.settingsMessage)) }
  }

  public func reconnect(reason: String = "manual") {
    guard running else { return }
    log("reconnect requested: \(reason)")
    retry?.cancel()
    closeSocket()
    connect()
  }

  // ---------------------------------------------------------------- internals

  /// The relay's address for these options: http(s) becomes ws(s), and what is fixed at connection time travels
  /// in the query string, because the server opens the recogniser's stream before any message arrives.
  static func url(server: URL, options: RelayOptions) -> URL? {
    guard var parts = URLComponents(url: server, resolvingAgainstBaseURL: false) else { return nil }
    parts.scheme = parts.scheme == "http" ? "ws" : "wss"
    parts.path = "/api/desktop/live"
    parts.queryItems = options.query
    // URLComponents leaves "+" alone, and a server reads it as a space: hotwords may contain one
    parts.percentEncodedQuery = parts.percentEncodedQuery?.replacingOccurrences(of: "+", with: "%2B")
    return parts.url
  }

  /// One audio frame: eight bytes of capture time (a big-endian double, ms), then the PCM. The server maps results
  /// back onto this clock, so a recording's cue times never drift by the network delay.
  static func frame(_ chunk: AudioChunk) -> Data {
    var bits = chunk.t0.bitPattern.bigEndian
    var data = Data(capacity: 8 + chunk.pcm.count)
    withUnsafeBytes(of: &bits) { data.append(contentsOf: $0) }
    data.append(chunk.pcm)
    return data
  }

  private func connect() {
    guard running, let url = Self.url(server: server, options: options) else { return }
    retry = nil
    generation += 1
    connects += 1
    let mine = generation
    var request = URLRequest(url: url, timeoutInterval: 10)
    request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    let socket = opener.open(request)
    self.socket = socket
    setState(.connecting)
    receiver = Task { [weak self] in
      while !Task.isCancelled {
        do {
          let frame = try await socket.receive()
          await self?.handle(frame, generation: mine)
        } catch {
          let status = await socket.handshakeStatus()
          await self?.closed(generation: mine, error: error, handshakeStatus: status)
          return
        }
      }
    }
  }

  private struct Envelope: Decodable {
    struct Upstream: Decodable { let state: String? }
    let type: String
    let result: LiveResult?
    let status: Upstream?
    let text: String?
    let code: String?
    let message: String?
  }

  private func handle(_ frame: RelayFrame, generation mine: Int) async {
    guard mine == generation, case .text(let text) = frame else { return }
    guard let msg = try? JSONDecoder().decode(Envelope.self, from: Data(text.utf8)) else {
      return log("odd message from the server: \(text.prefix(120))")
    }
    switch msg.type {
    case "ready":
      openedAt = now()
      lastSentAt = now()
      setState(.ready)
      // hotwords and the tuning that is not in the query string follow the handshake
      if let socket { try? await socket.send(.text(options.settingsMessage)) }
    case "result":
      if let result = msg.result { continuation.yield(.result(result)) }
    case "status":
      if let upstream = msg.status?.state { continuation.yield(.upstream(upstream)) }
    case "log":
      log("server: \(msg.text ?? "")")
    case "error":
      let code = msg.code ?? "error"
      let message = msg.message ?? ""
      if Self.terminalCodes.contains(code) { refusal = RelayRefusal(code: code, message: message) }
      else { continuation.yield(.serverError(code: code, message: message)) }
    default:
      break
    }
  }

  private func closed(generation mine: Int, error: Error, handshakeStatus: Int?) {
    guard mine == generation else { return }
    socket = nil
    guard running else { return }
    if handshakeStatus == 401 { refusal = RelayRefusal(code: "unauthorized", message: "the server rejected this login") }
    if let refusal {
      // the answer will not change by asking again: this talk is over until the person decides otherwise
      running = false
      pacer?.cancel()
      queue.removeAll()
      continuation.yield(.refused(refusal))
      return setState(.refused)
    }
    if handshakeStatus == 503 { continuation.yield(.serverError(code: "no_keys", message: "the server has no recognition keys configured")) }
    log("server connection closed: \(handshakeStatus.map { "HTTP \($0)" } ?? error.localizedDescription)")
    scheduleReconnect()
  }

  private func scheduleReconnect() {
    guard running, retry == nil else { return }
    let delay = timing.backoffMs[min(attempt, timing.backoffMs.count - 1)]
    attempt += 1
    setState(.reconnecting, retryAt: now() + delay)
    retry = Task { [weak self] in
      try? await Task.sleep(for: .milliseconds(delay))
      guard !Task.isCancelled else { return }
      await self?.connect()
    }
  }

  private func tick() async {
    guard running, state == .ready, let socket else { return }
    let t = now()
    if attempt > 0, let openedAt, t - openedAt > timing.stableMs { attempt = 0 }
    // one chunk per tick keeps real time; two drains what built up while reconnecting
    let n = queue.count > 2 ? 2 : min(1, queue.count)
    for _ in 0..<n {
      guard !queue.isEmpty else { break }
      await send(queue.removeFirst(), on: socket)
    }
    if n == 0, t - lastSentAt > timing.keepaliveMs {
      // nothing to say is still something: the relay drops a client that goes quiet
      await send(AudioChunk(pcm: Data(count: ChunkAssembler.chunkBytes), t0: t - timing.chunkMs), on: socket)
      keepalives += 1
    }
  }

  private func send(_ chunk: AudioChunk, on socket: any RelaySocket) async {
    do {
      try await socket.send(.binary(Self.frame(chunk)))
      lastSentAt = now()
    } catch {
      log("send failed: \(error.localizedDescription)") // the receive loop will see the connection end
    }
  }

  private func closeSocket() {
    generation += 1 // whatever the old socket still says is no longer ours
    receiver?.cancel()
    socket?.close(code: 1000)
    socket = nil
  }

  private func setState(_ next: RelayState, retryAt: Double? = nil) {
    guard state != next || retryAt != nil else { return }
    state = next
    continuation.yield(.state(next, retryAt: retryAt))
  }

  private func log(_ text: String) { continuation.yield(.log(text)) }
}
