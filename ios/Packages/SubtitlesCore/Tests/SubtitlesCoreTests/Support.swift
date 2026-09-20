import Foundation
@testable import SubtitlesCore

/// Poll until `condition` holds; tests of things that happen on a timer wait for the outcome, not for a duration.
func eventually(_ what: String = "condition", timeout: Double = 3, _ condition: @Sendable () async -> Bool) async -> Bool {
  let deadline = Date().addingTimeInterval(timeout)
  while Date() < deadline {
    if await condition() { return true }
    try? await Task.sleep(for: .milliseconds(5))
  }
  return await condition()
}

func temporaryDirectory(_ name: String = "core") -> URL {
  let url = FileManager.default.temporaryDirectory.appendingPathComponent("\(name)-\(UUID().uuidString)", isDirectory: true)
  try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
  return url
}

/// A clock a test moves by hand.
final class TestClock: @unchecked Sendable {
  private let lock = NSLock()
  private var value: Double
  init(_ start: Double = 1_757_000_000_000) { value = start }
  var now: Double { lock.withLock { value } }
  func advance(_ ms: Double) { lock.withLock { value += ms } }
}

/// The server's end of a WebSocket, scripted by the test.
final class FakeSocket: RelaySocket, @unchecked Sendable {
  struct Closed: Error {}
  let request: URLRequest
  private let lock = NSLock()
  private var _sent: [RelayFrame] = []
  private var inbox: [Result<RelayFrame, Error>] = []
  private var waiter: CheckedContinuation<RelayFrame, Error>?
  private var _closedByClient: Int?
  var status: Int?

  init(request: URLRequest) { self.request = request }

  var sent: [RelayFrame] { lock.withLock { _sent } }
  var sentText: [String] { sent.compactMap { if case .text(let t) = $0 { t } else { nil } } }
  var sentAudio: [Data] { sent.compactMap { if case .binary(let d) = $0 { d } else { nil } } }
  var closedByClient: Int? { lock.withLock { _closedByClient } }

  func send(_ frame: RelayFrame) async throws {
    try lock.withLock {
      if _closedByClient != nil { throw Closed() }
      _sent.append(frame)
    }
  }

  func receive() async throws -> RelayFrame {
    try await withCheckedThrowingContinuation { continuation in
      lock.lock()
      if !inbox.isEmpty { let next = inbox.removeFirst(); lock.unlock(); continuation.resume(with: next) }
      else { waiter = continuation; lock.unlock() }
    }
  }

  func close(code: Int) { lock.withLock { _closedByClient = code }; deliver(.failure(Closed())) }
  func handshakeStatus() async -> Int? { status }

  // the server's side
  func serverSend(_ json: String) { deliver(.success(.text(json))) }
  func serverClose() { deliver(.failure(Closed())) }

  private func deliver(_ result: Result<RelayFrame, Error>) {
    lock.lock()
    if let w = waiter { waiter = nil; lock.unlock(); w.resume(with: result) } else { inbox.append(result); lock.unlock() }
  }
}

final class FakeOpener: RelaySocketOpener, @unchecked Sendable {
  private let lock = NSLock()
  private var _sockets: [FakeSocket] = []
  /// What the "server" does with each new connection, by its number (0 = first).
  var onOpen: (@Sendable (Int, FakeSocket) -> Void)?

  var sockets: [FakeSocket] { lock.withLock { _sockets } }

  func open(_ request: URLRequest) -> any RelaySocket {
    let socket = FakeSocket(request: request)
    let n = lock.withLock { _sockets.append(socket); return _sockets.count - 1 }
    onOpen?(n, socket)
    return socket
  }
}

let readyMessage = #"{"type":"ready","source":"yue","target":"zh"}"#

func fastTiming() -> RelayClient.Timing {
  var t = RelayClient.Timing()
  t.chunkMs = 5; t.keepaliveMs = 60; t.backoffMs = [20, 40]; t.stableMs = 10_000
  return t
}

func chunk(_ n: Int) -> AudioChunk { AudioChunk(pcm: Data(repeating: UInt8(n), count: ChunkAssembler.chunkBytes), t0: 1_000_000 + Double(n) * 200) }

/// Everything a client's event stream says, gathered for assertions.
actor EventLog {
  private(set) var events: [RelayEvent] = []
  func add(_ e: RelayEvent) { events.append(e) }
  var states: [RelayState] { events.compactMap { if case .state(let s, _) = $0 { s } else { nil } } }
  var results: [LiveResult] { events.compactMap { if case .result(let r) = $0 { r } else { nil } } }
  var refusals: [RelayRefusal] { events.compactMap { if case .refused(let r) = $0 { r } else { nil } } }
}

func collect(_ client: RelayClient) -> EventLog {
  let log = EventLog()
  Task { for await event in client.events { await log.add(event) } }
  return log
}
