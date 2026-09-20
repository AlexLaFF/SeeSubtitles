import Foundation

/// One server-sent event. This server writes every event as `event: name` and a single `data:` line of JSON.
public struct ServerSentEvent: Sendable, Equatable {
  public let name: String
  public let data: Data
  public func decode<T: Decodable>(_ type: T.Type) throws -> T { try JSONDecoder().decode(type, from: data) }
}

/// Reads a stream of lines as events. An event is complete at its `data:` line — not at the blank line after
/// it, which URLSession's line reader swallows — and that is sound here because no event of ours spans two.
public struct ServerSentEventParser: Sendable {
  private var name = "message"
  public init() {}

  public mutating func feed(_ line: String) -> ServerSentEvent? {
    if line.hasPrefix(":") || line.isEmpty { return nil } // a comment is the server's heartbeat
    if line.hasPrefix("event:") { name = line.dropFirst(6).trimmingCharacters(in: .whitespaces); return nil }
    guard line.hasPrefix("data:") else { return nil }
    defer { name = "message" }
    return ServerSentEvent(name: name, data: Data(line.dropFirst(5).trimmingCharacters(in: .whitespaces).utf8))
  }
}
