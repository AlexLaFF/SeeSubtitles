import Foundation

/// "Re-subtitle in the cloud": send a recording's audio to the server as an upload job — recognition of the whole
/// file in one pass, then translation — and put what comes back in place of the subtitles the talk itself
/// produced. Fills the holes a lost connection left and generally reads better. A port of desktop/lib/resubtitle.js:
/// the live subtitles are kept once as `.live.srt`, never overwritten after that, and the job is deleted when it is
/// done, because the server keeps the audio only as long as the job.
public struct Resubtitler: Sendable {
  public enum Stage: Sendable, Equatable { case uploading, working(status: String, progress: Double), downloading }
  public struct Failed: Error, Sendable, Equatable { public let code: String; public let message: String }

  /// The upload pipeline's name for a live language, where it has one (desktop/local-server.js keeps the same table).
  public static let jobSource = ["yue": "yue", "zh": "zh", "zh_en": "mixed", "en": "en", "ja": "ja", "ko": "ko"]
  public static let jobTarget = ["zh": "zh", "en": "en", "ja": "ja", "ko": "ko"]
  public static func canResubtitle(_ recording: Recording) -> Bool { recording.audio != nil && jobSource[recording.manifest.source] != nil }

  let api: APIClient
  let pollSeconds: Double
  public init(api: APIClient, pollSeconds: Double = 3) { self.api = api; self.pollSeconds = pollSeconds }

  public func run(_ recording: Recording, progress: @escaping @Sendable (Stage) -> Void = { _ in }) async throws {
    let manifest = recording.manifest
    guard let audio = recording.audio, let sourceLanguage = Self.jobSource[manifest.source] else {
      throw Failed(code: "unsupported_source", message: "the cloud does not transcribe \(manifest.source) uploads yet")
    }
    let targetLanguage = manifest.source == manifest.target ? "none" : (Self.jobTarget[manifest.target] ?? "none")
    let replies = recording.transcript().lines.filter { $0.kind == .reply }

    progress(.uploading)
    let size = ((try? FileManager.default.attributesOfItem(atPath: audio.path)[.size]) as? Int) ?? 0
    var job = try await api.createJob(filename: audio.lastPathComponent, size: size, sourceLanguage: sourceLanguage, targetLanguage: targetLanguage)
    job = try await api.upload(audio, to: job)
    while !job.isDone {
      if job.isFailed { throw Failed(code: "job_failed", message: job.error ?? "the cloud job failed") }
      progress(.working(status: job.status, progress: (job.progress ?? 0) / 100))
      try await Task.sleep(for: .seconds(pollSeconds))
      job = try await api.job(job.id)
    }

    progress(.downloading)
    var wanted = [(sourceLanguage, manifest.source)]
    if targetLanguage != "none" { wanted.append((targetLanguage, manifest.target)) }
    for (remoteLanguage, localLanguage) in wanted {
      guard let remote = job.files?.first(where: { $0.hasSuffix(".\(remoteLanguage).srt") }) else {
        throw Failed(code: "job_incomplete", message: "the cloud job produced no .\(remoteLanguage).srt")
      }
      let destination = recording.folder.appendingPathComponent(RecordingNames.srtName(manifest.base, language: localLanguage))
      let arrived = destination.appendingPathExtension("new")
      try await api.download(remote, of: job, to: arrived) // only once it is here is anything of the talk's own moved aside
      let backup = recording.folder.appendingPathComponent(RecordingNames.liveName(destination.lastPathComponent))
      if FileManager.default.fileExists(atPath: destination.path) {
        if FileManager.default.fileExists(atPath: backup.path) { try FileManager.default.removeItem(at: destination) }
        else { try FileManager.default.moveItem(at: destination, to: backup) } // what the talk itself produced is kept, once
      }
      try FileManager.default.moveItem(at: arrived, to: destination)
    }

    // The transcript is rebuilt from the new subtitles; what the reader typed during the talk goes back in where it was said.
    let kept = recording.folder.appendingPathComponent(RecordingNames.fileName(manifest.base, .transcript))
    try? FileManager.default.removeItem(at: kept)
    if !replies.isEmpty, let fresh = RecordingLibrary(root: recording.folder.deletingLastPathComponent()).recording(id: recording.id) {
      var merged = (fresh.transcript().lines + replies).sorted { ($0.wallStart ?? 0) < ($1.wallStart ?? 0) }
      for i in merged.indices { merged[i].seq = i + 1 }
      try? JSONEncoder().encode(merged).write(to: kept, options: .atomic)
    }
    // A video made from the old subtitles no longer matches: kept as the live one, to be made again when asked for.
    if let mp4 = recording.mp4 {
      let old = recording.folder.appendingPathComponent(RecordingNames.liveName(mp4.lastPathComponent))
      try? FileManager.default.removeItem(at: old)
      try? FileManager.default.moveItem(at: mp4, to: old)
    }
    try? await api.deleteJob(job.id)
  }
}
