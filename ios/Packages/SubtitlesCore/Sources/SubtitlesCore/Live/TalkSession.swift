import Foundation

/// Where a talk stands, as one word the status line can show.
public enum TalkPhase: Sendable, Equatable {
  case starting
  case listening
  /// Subtitles are paused; the recording is not. `retryAt` is when the next attempt is due (ms since 1970).
  case reconnecting(retryAt: Double?)
  /// Something else has the microphone; the gap is kept as silence.
  case interrupted
  case refused(RelayRefusal)
  case ended
}

public enum TalkEvent: Sendable {
  case phase(TalkPhase)
  /// A line changed or appeared. `isNew` is a sentence beginning; `line.ended` is one settling.
  case line(TranscriptLine, isNew: Bool)
  case notice(String) // route changes and the like: worth a log line, not a state
}

/// One talk from Start to Stop: the audio source feeds the recorder and the relay; what the relay answers becomes
/// the transcript and the subtitle files. The recorder never waits for the network — it is fed first, and the relay
/// being down changes nothing for it.
public actor TalkSession {
  public nonisolated let events: AsyncStream<TalkEvent>
  private let continuation: AsyncStream<TalkEvent>.Continuation
  private let source: any AudioSource
  private let relay: RelayClient
  private let recorder: Recorder
  private let recordAudio: Bool
  private let options: RelayOptions
  private let now: @Sendable () -> Double

  public private(set) var transcript = Transcript()
  public private(set) var phase: TalkPhase = .starting
  public private(set) var startedAt: Double = 0
  private var interrupted = false
  private var relayState: RelayState = .idle
  private var tasks: [Task<Void, Never>] = []

  public init(source: any AudioSource, relay: RelayClient, recorder: Recorder, options: RelayOptions, recordAudio: Bool,
              now: @escaping @Sendable () -> Double = { Date().timeIntervalSince1970 * 1000 }) {
    self.source = source; self.relay = relay; self.recorder = recorder
    self.options = options; self.recordAudio = recordAudio; self.now = now
    (events, continuation) = AsyncStream.makeStream(of: TalkEvent.self, bufferingPolicy: .bufferingNewest(1024))
  }

  /// - Returns: the recording's id.
  @discardableResult
  public func start() async throws -> String {
    startedAt = now()
    let id = try await recorder.start(source: options.source, target: options.target, audio: recordAudio)
    try source.start()
    await relay.start()
    let source = self.source, relay = self.relay
    tasks.append(Task { [weak self] in
      // One consumer, so audio reaches the recorder and the relay in the order it was captured.
      var decimator = Decimator()
      var chunks = ChunkAssembler()
      for await event in source.events {
        guard let self else { return }
        switch event {
        case .audio(let audio):
          await self.recorder.write(audio.samples) // first, and whatever the network is doing
          for chunk in chunks.append(decimator.process(audio.samples), startedAt: audio.startedAt) { await relay.push(chunk) }
        case .interrupted:
          chunks.reset()
          await self.set(interrupted: true)
        case .resumed:
          await self.set(interrupted: false)
        case .routeChanged(let why):
          chunks.reset()
          await self.notice("microphone: \(why)")
        case .failed(let why):
          await self.notice("microphone failed: \(why)")
        }
      }
    })
    tasks.append(Task { [weak self] in
      for await event in relay.events { await self?.handle(event) }
    })
    return id
  }

  /// Something the reader typed to show the other person. Kept in the transcript as their own line.
  @discardableResult
  public func reply(_ text: String) -> TranscriptLine {
    let line = transcript.addReply(text, now: now())
    continuation.yield(.line(line, isNew: true))
    return line
  }

  public func update(_ options: RelayOptions) async { await relay.update(options) }

  /// End the talk. Returns what was recorded — also for a talk that was only listened to, whose words are kept.
  public func stop() async -> RecordingInfo? {
    source.stop()
    await relay.stop()
    tasks.forEach { $0.cancel() }
    let info = await recorder.stop(transcript: transcript)
    setPhase(.ended)
    continuation.finish()
    return info
  }

  // ---------------------------------------------------------------- internals

  private func handle(_ event: RelayEvent) async {
    switch event {
    case .result(let result):
      let (line, isNew) = transcript.apply(result, now: now())
      if line.ended { await recorder.add(line) }
      continuation.yield(.line(line, isNew: isNew))
    case .state(let state, let retryAt):
      relayState = state
      refresh(retryAt: retryAt)
    case .refused(let refusal):
      setPhase(.refused(refusal))
    case .serverError(let code, let message):
      notice("server: \(code) \(message)")
    case .upstream, .log:
      break
    }
  }

  private func set(interrupted value: Bool) { interrupted = value; refresh(retryAt: nil) }

  private func refresh(retryAt: Double?) {
    if case .refused = phase { return }
    if case .ended = phase { return }
    if interrupted { return setPhase(.interrupted) }
    switch relayState {
    case .ready: setPhase(.listening)
    case .reconnecting: setPhase(.reconnecting(retryAt: retryAt))
    case .idle, .connecting: setPhase(transcript.lines.isEmpty && phase == .starting ? .starting : .reconnecting(retryAt: nil))
    case .refused, .stopped: break
    }
  }

  private func setPhase(_ next: TalkPhase) {
    guard phase != next else { return }
    phase = next
    continuation.yield(.phase(next))
  }

  private func notice(_ text: String) { continuation.yield(.notice(text)) }
}
