import SubtitlesCore
import SwiftUI

/// One recording's page: what is in it, and the three things that can be made from it — a summary, a video, and
/// better subtitles from the cloud.
@MainActor @Observable
final class RecordingModel {
  enum Work: Equatable { case idle, running(stage: String, progress: Double?), failed(String) }

  private(set) var recording: Recording
  private(set) var lines: [TranscriptLine] = []
  private(set) var summary = ""
  private(set) var summaryWork: Work = .idle
  private(set) var mp4Work: Work = .idle
  private(set) var resubtitleWork: Work = .idle
  private weak var app: AppModel?
  private var summaryTask: Task<Void, Never>?

  init(recording: Recording, app: AppModel) {
    self.recording = recording; self.app = app
    reload()
  }

  func reload() {
    if let fresh = app?.library.recording(id: recording.id) { recording = fresh }
    lines = recording.transcript().lines
    if summaryWork == .idle { summary = recording.summary.flatMap { try? String(contentsOf: $0, encoding: .utf8) } ?? "" }
  }

  /// Seconds into the recording at which a line begins.
  func offset(of line: TranscriptLine) -> Double { max(0, ((line.wallStart ?? recording.manifest.startedAt) - recording.manifest.startedAt) / 1000) }

  // ---------------------------------------------------------------- summary

  var canSummarise: Bool { app?.prefs.demo == true || app?.plan?.limits.summaries == true }

  func summarise() {
    guard let app, summaryTask == nil else { return }
    let (target, source) = recording.cues()
    let name = recording.title
    let language = app.prefs.language == "en" || (!Localizer.isChinese && app.prefs.language == "system") ? "en" : "zh"
    summaryWork = .running(stage: "asking", progress: nil)
    summary = ""
    summaryTask = Task {
      defer { summaryTask = nil }
      do {
        if app.prefs.demo { try await demoSummary() }
        else {
          for try await event in app.api.summarise(name: name, language: language, target: target, source: source) {
            switch event {
            case .stage(let stage): summaryWork = .running(stage: stage, progress: nil); if stage == "condensing" { summary = "" }
            case .delta(let text): summary += text
            case .done(let markdown): summary = markdown
            }
          }
        }
        try save(summary: summary)
        summaryWork = .idle
        reload(); app.refreshLibrary()
      } catch let error as APIError {
        summaryWork = .failed(error.code == "plan_summaries" ? L("ios.summary.notInPlan") : L("ios.summary.failed"))
      } catch is CancellationError { summaryWork = .idle } catch { summaryWork = .failed(L("ios.summary.failed")) }
    }
  }

  private func demoSummary() async throws {
    let text = L("ios.demo.summary")
    summaryWork = .running(stage: "writing", progress: nil)
    for ch in text { summary.append(ch); if ch == "\n" || ch == "。" { try await Task.sleep(for: .milliseconds(120)) } }
  }

  private func save(summary markdown: String) throws {
    let base = recording.manifest.base
    try markdown.write(to: recording.folder.appendingPathComponent(RecordingNames.fileName(base, .summary)), atomically: true, encoding: .utf8)
    // the PDF is a convenience: a summary without one is still a summary
    try? SummaryDocument.pdf(markdown: markdown, title: recording.title).write(to: recording.folder.appendingPathComponent(RecordingNames.fileName(base, .pdf)))
  }

  // ---------------------------------------------------------------- MP4

  func makeMP4() {
    guard let app, let audio = recording.audio, mp4Work == .idle || { if case .failed = mp4Work { true } else { false } }() else { return }
    let (target, source) = recording.cues()
    let out = recording.folder.appendingPathComponent(RecordingNames.fileName(recording.manifest.base, .mp4))
    var options: MP4Exporter.Options = app.prefs.mp4Landscape ? .landscape : .portrait
    options.showBoth = app.prefs.showMode == .both
    mp4Work = .running(stage: "rendering", progress: 0)
    Task {
      do {
        try await MP4Exporter().export(audio: audio, target: target, source: source, to: out, options: options) { p in
          Task { @MainActor [weak self] in if case .running = self?.mp4Work { self?.mp4Work = .running(stage: "rendering", progress: p) } }
        }
        mp4Work = .idle
        reload(); app.refreshLibrary()
      } catch { mp4Work = .failed(L("ios.mp4.failed")) }
    }
  }

  // ---------------------------------------------------------------- cloud re-subtitling

  /// The upload pipeline's name for a live language, where it has one (desktop/local-server.js, the same table).
  static let jobSource = ["yue": "yue", "zh": "zh", "zh_en": "mixed", "en": "en", "ja": "ja", "ko": "ko"]
  static let jobTarget = ["zh": "zh", "en": "en", "ja": "ja", "ko": "ko"]
  var canResubtitle: Bool { recording.audio != nil && Self.jobSource[recording.manifest.source] != nil && app?.isSignedIn == true }

  func resubtitle() {
    guard let app, let audio = recording.audio, let sourceLang = Self.jobSource[recording.manifest.source] else { return }
    let manifest = recording.manifest
    let targetLang = manifest.source == manifest.target ? "none" : (Self.jobTarget[manifest.target] ?? "none")
    let folder = recording.folder
    resubtitleWork = .running(stage: "uploading", progress: nil)
    Task {
      do {
        let size = ((try? FileManager.default.attributesOfItem(atPath: audio.path)[.size]) as? Int) ?? 0
        var job = try await app.api.createJob(filename: audio.lastPathComponent, size: size, sourceLanguage: sourceLang, targetLanguage: targetLang)
        job = try await app.api.upload(audio, to: job)
        while !job.isDone {
          if job.isFailed { throw APIError(status: 500, code: "job_failed", message: job.error ?? "the cloud job failed") }
          resubtitleWork = .running(stage: job.status, progress: (job.progress ?? 0) / 100)
          try await Task.sleep(for: .seconds(3))
          job = try await app.api.job(job.id)
        }
        resubtitleWork = .running(stage: "downloading", progress: 1)
        var wanted = [(sourceLang, manifest.source)]
        if targetLang != "none" { wanted.append((targetLang, manifest.target)) }
        for (remoteLang, localLang) in wanted {
          guard let remote = job.files?.first(where: { $0.hasSuffix(".\(remoteLang).srt") }) else { continue }
          let dest = folder.appendingPathComponent(RecordingNames.srtName(manifest.base, language: localLang))
          let backup = folder.appendingPathComponent(RecordingNames.liveName(dest.lastPathComponent))
          // what the talk itself produced is kept, once, beside what replaces it
          if FileManager.default.fileExists(atPath: dest.path), !FileManager.default.fileExists(atPath: backup.path) { try FileManager.default.moveItem(at: dest, to: backup) }
          try await app.api.download(remote, of: job, to: dest)
        }
        // the transcript is rebuilt from the new subtitles; what the reader typed during the talk goes back in where it was said
        let kept = folder.appendingPathComponent(RecordingNames.fileName(manifest.base, .transcript))
        let replies = lines.filter { $0.kind == .reply }
        try? FileManager.default.removeItem(at: kept)
        if !replies.isEmpty, let fresh = app.library.recording(id: recording.id) {
          var merged = (fresh.transcript().lines + replies).sorted { ($0.wallStart ?? 0) < ($1.wallStart ?? 0) }
          for i in merged.indices { merged[i].seq = i + 1 }
          try? JSONEncoder().encode(merged).write(to: kept, options: .atomic)
        }
        try? await app.api.deleteJob(job.id) // the server keeps the audio only as long as the job
        resubtitleWork = .idle
        reload(); app.refreshLibrary()
        await app.refreshAccount()
      } catch let error as APIError where error.code == "plan_quota" {
        resubtitleWork = .failed(L("err.plan_quota"))
      } catch { resubtitleWork = .failed(L("ios.resub.failed")) }
    }
  }
}
