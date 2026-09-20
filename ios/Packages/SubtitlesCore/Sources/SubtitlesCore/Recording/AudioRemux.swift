import AVFoundation

/// The raw AAC stream a talk is recorded as → the m4a it is kept as. The audio is copied, not encoded again, so
/// an hour takes a moment. Works just as well on a stream that was cut off mid-frame: what was written is kept.
enum AudioRemux {
  struct Failed: Error, LocalizedError { let reason: String; var errorDescription: String? { reason } }

  static func m4a(from source: URL, to destination: URL) async throws {
    try? FileManager.default.removeItem(at: destination)
    guard let session = AVAssetExportSession(asset: AVURLAsset(url: source), presetName: AVAssetExportPresetPassthrough) else {
      throw Failed(reason: "this audio cannot be exported")
    }
    if #available(iOS 18, macOS 15, *) {
      try await session.export(to: destination, as: .m4a)
    } else {
      session.outputURL = destination
      session.outputFileType = .m4a
      nonisolated(unsafe) let legacy = session
      await withCheckedContinuation { (done: CheckedContinuation<Void, Never>) in legacy.exportAsynchronously { done.resume() } }
      if legacy.status != .completed { throw legacy.error ?? Failed(reason: "the export did not finish") }
    }
  }

  static func duration(of url: URL) async -> Double? {
    guard let t = try? await AVURLAsset(url: url).load(.duration), t.isNumeric else { return nil }
    return t.seconds
  }
}
