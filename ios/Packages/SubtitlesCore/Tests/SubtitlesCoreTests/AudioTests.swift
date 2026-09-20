import Foundation
import Testing
@testable import SubtitlesCore

struct DecimatorFixture: Decodable { let chunkSizes: [Int]; let input: String; let output: String; let taps: [Double] }

func int16s(_ base64: String) -> [Int16] {
  let data = Data(base64Encoded: base64)!
  return data.withUnsafeBytes { Array($0.bindMemory(to: Int16.self)) }
}

@Suite struct DecimatorTests {
  let fixture: DecimatorFixture = {
    let url = Bundle.module.url(forResource: "decimator", withExtension: "json", subdirectory: "Fixtures")!
    return try! JSONDecoder().decode(DecimatorFixture.self, from: Data(contentsOf: url))
  }()

  @Test("the filter is the one core/decimator.js designs")
  func sameCoefficients() {
    let d = Decimator()
    #expect(d.coefficients.count == fixture.taps.count)
    for (mine, theirs) in zip(d.coefficients, fixture.taps) { #expect(abs(mine - theirs) < 1e-15) }
  }

  @Test("48 → 16 kHz gives the samples core/decimator.js gives, fed in the same uneven chunks")
  func sameSamples() {
    let input = int16s(fixture.input)
    let expected = int16s(fixture.output)
    var d = Decimator()
    var out: [Int16] = []
    var at = 0, k = 0
    while at < input.count {
      let size = min(fixture.chunkSizes[k % fixture.chunkSizes.count], input.count - at)
      out += d.process(Array(input[at..<(at + size)]))
      at += size; k += 1
    }
    #expect(out.count == expected.count)
    #expect(out.count == 16_000)
    let different = zip(out, expected).filter { $0 != $1 }.count
    #expect(different == 0, "\(different) of \(expected.count) samples differ from the JavaScript decimator")
    #expect(expected.contains(32767) && expected.contains(-32768), "the fixture should drive the filter into its clamp")
  }
}

@Suite struct ChunkAssemblerTests {
  @Test("audio is cut into 200 ms chunks that carry the time their first sample was captured")
  func chunks() {
    var a = ChunkAssembler()
    #expect(a.append([Int16](repeating: 1, count: 3000), startedAt: 10_000).isEmpty)
    // 3000 + 3600 = 6600 samples: two chunks, 200 left over
    let out = a.append([Int16](repeating: 2, count: 3600), startedAt: 10_187.5)
    #expect(out.count == 2)
    #expect(out[0].pcm.count == 6400)
    #expect(out[0].t0 == 10_000) // from the first buffer's clock, not the second's
    #expect(out[1].t0 == 10_200)
    #expect(out[0].pcm.prefix(2) == Data([1, 0])) // little-endian
    #expect(out[1].pcm.suffix(2) == Data([2, 0]))
    // after a gap the clock starts again from what is captured next
    a.reset()
    let after = a.append([Int16](repeating: 3, count: 3200), startedAt: 99_000)
    #expect(after.map(\.t0) == [99_000])
  }
}
