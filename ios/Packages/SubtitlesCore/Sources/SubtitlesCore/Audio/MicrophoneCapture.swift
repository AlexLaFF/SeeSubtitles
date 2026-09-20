import AVFoundation

/// The microphone, through AVAudioEngine. Follows the system when the input changes and says so; stops while
/// something else holds the microphone and resumes when it is given back. Keeps going with the screen locked
/// (the app declares the `audio` background mode).
public final class MicrophoneCapture: AudioSource, @unchecked Sendable {
  public let events: AsyncStream<CaptureEvent>
  private let continuation: AsyncStream<CaptureEvent>.Continuation
  private let engine = AVAudioEngine()
  private let converter = CaptureConverter()
  private let lock = NSLock()
  private var running = false
  private var observers: [NSObjectProtocol] = []

  public init() { (events, continuation) = AsyncStream.makeStream(of: CaptureEvent.self, bufferingPolicy: .bufferingNewest(256)) }

  public func start() throws {
    lock.lock(); defer { lock.unlock() }
    guard !running else { return }
    #if os(iOS)
    let session = AVAudioSession.sharedInstance()
    // .record, not .playAndRecord: nothing is played while a talk runs, and the speaker stays out of the microphone
    try session.setCategory(.record, mode: .default, options: [.allowBluetooth])
    try session.setActive(true, options: [])
    #endif
    observe()
    try startEngine()
    running = true
  }

  public func stop() {
    lock.lock(); defer { lock.unlock() }
    guard running else { return }
    running = false
    observers.forEach(NotificationCenter.default.removeObserver)
    observers = []
    engine.inputNode.removeTap(onBus: 0)
    engine.stop()
    #if os(iOS)
    try? AVAudioSession.sharedInstance().setActive(false, options: [.notifyOthersOnDeactivation])
    #endif
    continuation.finish()
  }

  private func startEngine() throws {
    let input = engine.inputNode
    input.removeTap(onBus: 0)
    let format = input.outputFormat(forBus: 0)
    guard format.sampleRate > 0, format.channelCount > 0 else { throw NSError(domain: "MicrophoneCapture", code: 1, userInfo: [NSLocalizedDescriptionKey: "no microphone is available"]) }
    input.installTap(onBus: 0, bufferSize: AVAudioFrameCount(format.sampleRate / 10), format: format) { [weak self] buffer, when in
      guard let self else { return }
      let samples = self.converter.convert(buffer)
      guard !samples.isEmpty else { return }
      let wall = Date().timeIntervalSince1970
      // the moment the buffer began, not the moment it reached us
      let age = when.isHostTimeValid ? max(0, AVAudioTime.seconds(forHostTime: mach_absolute_time()) - AVAudioTime.seconds(forHostTime: when.hostTime)) : Double(buffer.frameLength) / buffer.format.sampleRate
      self.continuation.yield(.audio(CapturedAudio(samples: samples, startedAt: (wall - age) * 1000)))
    }
    engine.prepare()
    try engine.start()
  }

  private func restart(reason: String) {
    lock.lock(); defer { lock.unlock() }
    guard running else { return }
    engine.stop()
    do { try startEngine(); continuation.yield(.routeChanged(reason)) } catch { continuation.yield(.failed(error.localizedDescription)) }
  }

  private func observe() {
    let center = NotificationCenter.default
    // the hardware format changed under the engine: a new tap, in the new format
    observers.append(center.addObserver(forName: .AVAudioEngineConfigurationChange, object: engine, queue: nil) { [weak self] _ in self?.restart(reason: "input changed") })
    #if os(iOS)
    observers.append(center.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: nil) { [weak self] note in
      guard let self, let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt, let type = AVAudioSession.InterruptionType(rawValue: raw) else { return }
      if type == .began { self.continuation.yield(.interrupted); return }
      // ended: take the microphone back whether or not the system suggests it — a talk is still running
      try? AVAudioSession.sharedInstance().setActive(true, options: [])
      self.restart(reason: "interruption ended")
      self.continuation.yield(.resumed)
    })
    observers.append(center.addObserver(forName: AVAudioSession.mediaServicesWereResetNotification, object: nil, queue: nil) { [weak self] _ in self?.restart(reason: "audio services restarted") })
    #endif
  }
}
