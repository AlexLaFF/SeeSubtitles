import Foundation

/// One frame's worth of audio for the relay: 200 ms of 16 kHz mono 16-bit PCM, little-endian, and the moment on
/// this device's clock when it began. Cue times come from `t0`, so it is measured, never assumed.
public struct AudioChunk: Sendable, Equatable {
  public let pcm: Data
  /// Milliseconds since 1970 when the first sample was captured.
  public let t0: Double
  public init(pcm: Data, t0: Double) { self.pcm = pcm; self.t0 = t0 }
}

/// Cuts a stream of 16 kHz samples into the relay's 200 ms chunks, carrying the capture time along.
public struct ChunkAssembler: Sendable {
  public static let sampleRate = 16_000
  public static let chunkSamples = 3_200 // 200 ms
  public static let chunkBytes = chunkSamples * 2
  public static let chunkMs = 200.0

  private var pending: [Int16] = []
  private var pendingStart: Double = 0

  public init() { pending.reserveCapacity(Self.chunkSamples * 2) }

  /// - Parameter startedAt: when the first of `samples` was captured, in ms since 1970.
  public mutating func append(_ samples: [Int16], startedAt: Double) -> [AudioChunk] {
    guard !samples.isEmpty else { return [] }
    if pending.isEmpty { pendingStart = startedAt }
    pending.append(contentsOf: samples)
    var chunks: [AudioChunk] = []
    while pending.count >= Self.chunkSamples {
      let head = pending.prefix(Self.chunkSamples)
      let data = head.withUnsafeBufferPointer { Data(buffer: $0) } // Int16 on Apple hardware is little-endian
      chunks.append(AudioChunk(pcm: data, t0: pendingStart))
      pending.removeFirst(Self.chunkSamples)
      pendingStart += Self.chunkMs
    }
    return chunks
  }

  /// Forget what is pending: after a gap the next samples start a new chunk on their own clock.
  public mutating func reset() { pending.removeAll(keepingCapacity: true) }
}
