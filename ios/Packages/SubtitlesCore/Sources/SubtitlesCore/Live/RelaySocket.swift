import Foundation

/// One WebSocket message.
public enum RelayFrame: Sendable, Equatable {
  case text(String)
  case binary(Data)
}

/// The connection to the relay, as little of a WebSocket as the client needs — so tests can stand in for the server.
public protocol RelaySocket: Sendable {
  func send(_ frame: RelayFrame) async throws
  /// Suspends until a message arrives; throws when the connection ends, for whatever reason.
  func receive() async throws -> RelayFrame
  func close(code: Int)
  /// The HTTP status the server answered the handshake with, when it refused it (401, 503) and that is known.
  func handshakeStatus() async -> Int?
}

public protocol RelaySocketOpener: Sendable {
  func open(_ request: URLRequest) -> any RelaySocket
}

/// The real thing: URLSession's WebSocket.
public struct URLSessionRelayOpener: RelaySocketOpener {
  private let session: URLSession
  public init(session: URLSession = .shared) { self.session = session }
  public func open(_ request: URLRequest) -> any RelaySocket {
    let task = session.webSocketTask(with: request)
    task.maximumMessageSize = 1 << 20
    task.resume()
    return URLSessionRelaySocket(task: task)
  }
}

final class URLSessionRelaySocket: RelaySocket, @unchecked Sendable {
  private let task: URLSessionWebSocketTask
  init(task: URLSessionWebSocketTask) { self.task = task }

  func send(_ frame: RelayFrame) async throws {
    switch frame {
    case .text(let text): try await task.send(.string(text))
    case .binary(let data): try await task.send(.data(data))
    }
  }

  func receive() async throws -> RelayFrame {
    switch try await task.receive() {
    case .string(let text): return .text(text)
    case .data(let data): return .binary(data)
    @unknown default: return .text("")
    }
  }

  func close(code: Int) {
    task.cancel(with: URLSessionWebSocketTask.CloseCode(rawValue: code) ?? .normalClosure, reason: nil)
  }

  func handshakeStatus() async -> Int? {
    guard let http = task.response as? HTTPURLResponse, http.statusCode != 101 else { return nil }
    return http.statusCode
  }
}
