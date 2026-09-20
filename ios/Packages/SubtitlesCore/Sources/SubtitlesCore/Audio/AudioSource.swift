import AVFoundation

/// Audio as the rest of the app wants it, whatever the hardware gave: mono, 16-bit, 48 kHz.
public struct CapturedAudio: Sendable {
  public static let sampleRate = 48_000
  public let samples: [Int16]
  /// When the first sample was captured, in ms since 1970.
  public let startedAt: Double
}

public enum CaptureEvent: Sendable {
  case audio(CapturedAudio)
  /// Something else has the microphone — a phone call, Siri. Nothing is captured until `.resumed`.
  case interrupted
  case resumed
  /// The input changed (AirPods out, a wired microphone in); capture carried on.
  case routeChanged(String)
  case failed(String)
}

/// Where a talk's audio comes from: the microphone, or a file standing in for one in tests and the demo.
public protocol AudioSource: Sendable {
  var events: AsyncStream<CaptureEvent> { get }
  func start() throws
  func stop()
}

/// Turns whatever format arrives into `CapturedAudio`: any rate, any channel count, float or integer.
final class CaptureConverter {
  private let output = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: Double(CapturedAudio.sampleRate), channels: 1, interleaved: true)!
  private var converter: AVAudioConverter?
  private var inputFormat: AVAudioFormat?

  func convert(_ buffer: AVAudioPCMBuffer) -> [Int16] {
    if inputFormat != buffer.format {
      inputFormat = buffer.format
      converter = AVAudioConverter(from: buffer.format, to: output)
    }
    guard let converter, buffer.frameLength > 0 else { return [] }
    let ratio = output.sampleRate / buffer.format.sampleRate
    let capacity = AVAudioFrameCount((Double(buffer.frameLength) * ratio).rounded(.up)) + 64
    guard let out = AVAudioPCMBuffer(pcmFormat: output, frameCapacity: capacity) else { return [] }
    var fed = false
    var error: NSError?
    converter.convert(to: out, error: &error) { _, status in
      if fed { status.pointee = .noDataNow; return nil }
      fed = true
      status.pointee = .haveData
      return buffer
    }
    guard error == nil, out.frameLength > 0, let data = out.int16ChannelData else { return [] }
    return Array(UnsafeBufferPointer(start: data[0], count: Int(out.frameLength)))
  }
}
