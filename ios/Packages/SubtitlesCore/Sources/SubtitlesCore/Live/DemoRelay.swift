import Foundation

/// Demo mode's server: a relay that lives in the app and recites a short talk, the way the Mac's Demo Mode does
/// (desktop/local-server.js). Everything on this side of the socket is real — the microphone, the recorder, the
/// transcript, the files — so the app can be tried, and reviewed, without an account or a network.
public struct DemoRelayOpener: RelaySocketOpener {
  public init() {}
  public func open(_ request: URLRequest) -> any RelaySocket { DemoRelaySocket() }
}

final class DemoRelaySocket: RelaySocket, @unchecked Sendable {
  static let script: [(source: String, target: String)] = [
    ("大家好，欢迎嚟到今日嘅分享。", "大家好，欢迎来到今天的分享。"),
    ("今日我哋会讲吓点样用字幕帮助更多人参与会议。", "今天我们会讲一下如何用字幕帮助更多人参与会议。"),
    ("首先系现场嘅观众，佢哋可以用手机扫二维码。", "首先是现场的观众，他们可以用手机扫二维码。"),
    ("第二，系会后想重温内容嘅人。", "第二，是会后想重温内容的人。"),
    ("字幕唔只系畀听唔到嘅人，系畀所有人。", "字幕不只是给听不见的人，是给所有人。"),
    ("宜家开放现场提问，有咩问题可以举手。", "现在开放现场提问，有什么问题可以举手。"),
  ]

  private let inbox: AsyncStream<RelayFrame>
  private let continuation: AsyncStream<RelayFrame>.Continuation
  private let feed: Task<Void, Never>

  init() {
    let (stream, continuation) = AsyncStream.makeStream(of: RelayFrame.self)
    self.inbox = stream
    self.continuation = continuation
    feed = Task {
      continuation.yield(.text(#"{"type":"ready","source":"yue","target":"zh"}"#))
      try? await Task.sleep(for: .seconds(1))
      var n = 0
      while !Task.isCancelled {
        let (source, target) = Self.script[n % Self.script.count]
        let wallStart = Date().timeIntervalSince1970 * 1000
        let characters = Array(target)
        var shown = 0
        while shown < characters.count, !Task.isCancelled {
          shown = min(characters.count, shown + Int.random(in: 2...4))
          let part = Int((Double(shown) / Double(characters.count) * Double(source.count)).rounded())
          let result: [String: Any] = ["voiceId": "demo", "sentenceId": "demo:\(n)", "sourceText": String(source.prefix(part)), "targetText": String(characters[0..<shown]),
                                       "wallStart": wallStart, "wallEnd": Date().timeIntervalSince1970 * 1000, "sentenceEnd": shown >= characters.count]
          if let data = try? JSONSerialization.data(withJSONObject: ["type": "result", "result": result]) { continuation.yield(.text(String(decoding: data, as: UTF8.self))) }
          try? await Task.sleep(for: .milliseconds(Int.random(in: 250...550)))
        }
        n += 1
        try? await Task.sleep(for: .milliseconds(Int.random(in: 1200...2700)))
      }
    }
  }

  func send(_ frame: RelayFrame) async throws {} // the audio is heard by no one
  func receive() async throws -> RelayFrame {
    for await frame in inbox { return frame }
    throw CancellationError()
  }
  func close(code: Int) { feed.cancel(); continuation.finish() }
  func handshakeStatus() async -> Int? { nil }
}
