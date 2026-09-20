import Foundation

/// One item of the Library: a folder on the phone, read into what the screens need.
public struct Recording: Sendable, Hashable, Identifiable {
  public let id: String // the folder's name
  public let folder: URL
  public var manifest: RecordingManifest
  public let audio: URL?
  public let mp4: URL?
  public let summary: URL?
  public let pdf: URL?
  public let targetSubtitles: URL?
  public let sourceSubtitles: URL?
  public let transcriptFile: URL?
  public let resubtitled: Bool
  public let bytes: Int

  public var title: String { manifest.title?.isEmpty == false ? manifest.title! : manifest.base }
  public var date: Date { Date(timeIntervalSince1970: manifest.startedAt / 1000) }
  public var durationMs: Int { manifest.durationMs ?? 0 }

  /// Every file that can be shared or saved, in the order the Files list shows them.
  public var files: [URL] { [audio, targetSubtitles, sourceSubtitles == targetSubtitles ? nil : sourceSubtitles, summary, pdf, mp4].compactMap { $0 } }

  /// The subtitle cues: what the player follows and the summary is made from.
  public func cues() -> (target: [Cue], source: [Cue]) {
    func read(_ url: URL?) -> [Cue] { url.flatMap { try? String(contentsOf: $0, encoding: .utf8) }.map(SRT.parse) ?? [] }
    let target = read(targetSubtitles)
    return (target, manifest.source == manifest.target ? [] : read(sourceSubtitles))
  }

  /// The transcript as the reader saw it, replies included; rebuilt from the subtitles when that file is missing
  /// (a recording that never stopped properly, or one made elsewhere).
  public func transcript() -> Transcript {
    if let url = transcriptFile, let data = try? Data(contentsOf: url), let lines = try? JSONDecoder().decode([TranscriptLine].self, from: data) {
      return Transcript(lines: lines)
    }
    let (target, source) = cues()
    let main = target.isEmpty ? source : target
    let lines = main.enumerated().map { i, cue in
      let original = target.isEmpty ? cue.text : (source.first { abs($0.start - cue.start) < 50 }?.text ?? "")
      return TranscriptLine(id: "cue:\(i)", seq: i + 1, sourceText: original, targetText: target.isEmpty ? "" : cue.text, ended: true,
                            wallStart: manifest.startedAt + Double(cue.start), wallEnd: manifest.startedAt + Double(cue.end), createdAt: manifest.startedAt + Double(cue.start))
    }
    return Transcript(lines: lines)
  }
}

/// The recordings on this phone: a folder of folders in the app's Documents, so the Files app shows them and
/// iCloud Drive can mirror them. There is no database; the folders are the truth and a scan is quick.
public struct RecordingLibrary: Sendable {
  public let root: URL
  public init(root: URL) { self.root = root }

  /// Documents/Recordings in the app's container.
  public static func standard() -> RecordingLibrary {
    let documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
    return RecordingLibrary(root: documents.appendingPathComponent("Recordings", isDirectory: true))
  }

  public func all() -> [Recording] {
    let fm = FileManager.default
    let folders = (try? fm.contentsOfDirectory(at: root, includingPropertiesForKeys: [.isDirectoryKey])) ?? []
    return folders.compactMap(recording(at:)).sorted { $0.manifest.startedAt > $1.manifest.startedAt }
  }

  public func recording(id: String) -> Recording? { recording(at: root.appendingPathComponent(id, isDirectory: true)) }

  func recording(at folder: URL) -> Recording? {
    let fm = FileManager.default
    guard (try? folder.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) == true,
          let names = try? fm.contentsOfDirectory(atPath: folder.path) else { return nil }
    var byKind: [RecordingNames.Kind: URL] = [:]
    var subtitles: [String: URL] = [:]
    var resubtitled = false
    var bytes = 0
    for name in names {
      let url = folder.appendingPathComponent(name)
      bytes += ((try? fm.attributesOfItem(atPath: url.path)[.size]) as? Int) ?? 0
      if name.contains(".live.") { resubtitled = true; continue }
      guard let parsed = RecordingNames.parse(name) else { continue }
      if let kind = parsed.kind { byKind[kind] = url } else if let language = parsed.language { subtitles[language] = url }
    }
    guard let manifestURL = byKind[.manifest], let manifest = RecordingManifest.read(manifestURL) else { return nil }
    return Recording(id: folder.lastPathComponent, folder: folder, manifest: manifest,
                     audio: byKind[.audio] ?? byKind[.partialAudio], mp4: byKind[.mp4], summary: byKind[.summary], pdf: byKind[.pdf],
                     targetSubtitles: subtitles[manifest.target], sourceSubtitles: subtitles[manifest.source],
                     transcriptFile: byKind[.transcript], resubtitled: resubtitled, bytes: bytes)
  }

  /// Recordings whose title or words contain `query`.
  public func search(_ query: String, in recordings: [Recording]) -> [Recording] {
    let q = query.trimmingCharacters(in: .whitespaces)
    guard !q.isEmpty else { return recordings }
    return recordings.filter { r in
      if r.title.localizedCaseInsensitiveContains(q) { return true }
      return [r.targetSubtitles, r.sourceSubtitles].compactMap { $0 }.contains { (try? String(contentsOf: $0, encoding: .utf8))?.localizedCaseInsensitiveContains(q) == true }
    }
  }

  public func rename(_ recording: Recording, to title: String) throws {
    var manifest = recording.manifest
    manifest.title = title.trimmingCharacters(in: .whitespacesAndNewlines)
    try manifest.write(to: recording.folder.appendingPathComponent(RecordingNames.fileName(manifest.base, .manifest)))
  }

  public func delete(_ recording: Recording) throws { try FileManager.default.removeItem(at: recording.folder) }

  public var bytes: Int { all().reduce(0) { $0 + $1.bytes } }

  /// Put back together what a crash, a dead battery or a force-quit left behind: a raw audio stream that never
  /// became an m4a. Run at launch, when no talk can be running. Returns the recordings that were recovered.
  @discardableResult
  public func recoverInterrupted() async -> [String] {
    var recovered: [String] = []
    for recording in all() {
      let base = recording.manifest.base
      // a video the app was making when it stopped is only a fragment: it is made again when asked for
      for name in (try? FileManager.default.contentsOfDirectory(atPath: recording.folder.path)) ?? [] where name.contains(".mp4.part") {
        try? FileManager.default.removeItem(at: recording.folder.appendingPathComponent(name))
      }
      let part = recording.folder.appendingPathComponent(RecordingNames.fileName(base, .partialAudio))
      guard FileManager.default.fileExists(atPath: part.path) else { continue }
      let audio = recording.folder.appendingPathComponent(RecordingNames.fileName(base, .audio))
      guard (try? await AudioRemux.m4a(from: part, to: audio)) != nil else { continue } // the stream stays, and still plays
      try? FileManager.default.removeItem(at: part)
      var manifest = recording.manifest
      manifest.recovered = true
      if manifest.durationMs == nil, let seconds = await AudioRemux.duration(of: audio) { manifest.durationMs = Int(seconds * 1000) }
      try? manifest.write(to: recording.folder.appendingPathComponent(RecordingNames.fileName(base, .manifest)))
      recovered.append(recording.id)
    }
    return recovered
  }
}
