import AVFoundation

/// A recording played as if it were the microphone, at the speed it was spoken. What demo mode and the UI tests
/// listen to: the same path from here on as a real talk.
public final class FileAudioSource: AudioSource, @unchecked Sendable {
  public let events: AsyncStream<CaptureEvent>
  private let continuation: AsyncStream<CaptureEvent>.Continuation
  private let url: URL
  private let loops: Bool
  private var task: Task<Void, Never>?

  public init(url: URL, loops: Bool = false) {
    self.url = url; self.loops = loops
    (events, continuation) = AsyncStream.makeStream(of: CaptureEvent.self, bufferingPolicy: .bufferingNewest(256))
  }

  public func start() throws {
    let file = try AVAudioFile(forReading: url)
    let continuation = self.continuation
    let loops = self.loops
    let source = file
    task = Task.detached {
      let converter = CaptureConverter()
      let block = AVAudioFrameCount(source.processingFormat.sampleRate / 10) // 100 ms
      let began = Date().timeIntervalSince1970
      var played = 0.0
      while !Task.isCancelled {
        guard let buffer = AVAudioPCMBuffer(pcmFormat: source.processingFormat, frameCapacity: block) else { break }
        do { try source.read(into: buffer, frameCount: block) } catch { break }
        if buffer.frameLength == 0 {
          guard loops else { break }
          source.framePosition = 0
          continue
        }
        let samples = converter.convert(buffer)
        if !samples.isEmpty { continuation.yield(.audio(CapturedAudio(samples: samples, startedAt: (began + played) * 1000))) }
        played += Double(buffer.frameLength) / source.processingFormat.sampleRate
        let ahead = began + played - Date().timeIntervalSince1970
        if ahead > 0 { try? await Task.sleep(for: .seconds(ahead)) }
      }
      continuation.finish()
    }
  }

  public func stop() { task?.cancel(); continuation.finish() }
}
