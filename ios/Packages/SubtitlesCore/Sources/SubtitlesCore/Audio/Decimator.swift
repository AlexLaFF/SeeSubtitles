import Foundation

/// Streaming low-pass FIR and integer decimator: 48 kHz → 16 kHz by default. A port of core/decimator.js that
/// produces the same samples, so the relay hears from a phone exactly what it hears from a Mac. Filter state is
/// kept across calls, so audio can arrive in any chunk size.
public struct Decimator: Sendable {
  public let factor: Int
  public let taps: Int
  public let coefficients: [Double]
  private var history: [Double] // the last taps-1 input samples
  private var phase = 0 // where the next output falls in the next chunk

  /// - Parameters:
  ///   - cutoff: as a fraction of the input rate; the default is 0.9 × the output's Nyquist (7.2 kHz for 48 → 16).
  public init(factor: Int = 3, taps: Int = 63, cutoff: Double? = nil) {
    precondition(factor >= 1, "factor must be a positive integer")
    let odd = taps % 2 == 0 ? taps + 1 : taps
    self.factor = factor
    self.taps = odd
    self.coefficients = Decimator.design(taps: odd, cutoff: cutoff ?? 0.9 / (2 * Double(factor)))
    self.history = Array(repeating: 0, count: odd - 1)
  }

  /// Windowed-sinc (Hamming) low-pass, normalised to unity gain at DC.
  public static func design(taps: Int, cutoff fc: Double) -> [Double] {
    var h = [Double](repeating: 0, count: taps)
    let m = Double(taps - 1) / 2
    var sum = 0.0
    for k in 0..<taps {
      let x = Double(k) - m
      let sinc = x == 0 ? 2 * fc : sin(2 * Double.pi * fc * x) / (Double.pi * x)
      let w = 0.54 - 0.46 * cos((2 * Double.pi * Double(k)) / Double(taps - 1))
      h[k] = sinc * w
      sum += h[k]
    }
    return h.map { $0 / sum }
  }

  /// Samples at the input rate in, samples at input rate ÷ factor out.
  public mutating func process(_ input: [Int16]) -> [Int16] {
    let n = taps - 1
    let length = n + input.count
    var buffer = [Double](repeating: 0, count: length)
    for i in 0..<n { buffer[i] = history[i] }
    for i in 0..<input.count { buffer[n + i] = Double(input[i]) }

    var output = [Int16]()
    output.reserveCapacity(max(0, length - n - phase) / factor + 1)
    var i = n + phase
    coefficients.withUnsafeBufferPointer { h in
      buffer.withUnsafeBufferPointer { b in
        while i < length {
          var acc = 0.0
          for k in 0..<taps { acc += h[k] * b[i - k] }
          // Math.round, as JavaScript rounds: halves go up, not away from zero
          output.append(acc > 32767 ? 32767 : acc < -32768 ? -32768 : Int16((acc + 0.5).rounded(.down)))
          i += factor
        }
      }
    }
    phase = i - length
    for k in 0..<n { history[k] = buffer[length - n + k] }
    return output
  }
}
