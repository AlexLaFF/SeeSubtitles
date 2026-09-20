import Foundation

/// Feeds a voice from the queue: one sentence at a time, the next when the last has been said. Knows one more
/// thing the queue does not — whether sound may come out at all. On your own talk the microphone is open, so the
/// voice must reach ears only: without headphones nothing is spoken, a sentence that settles meanwhile is not
/// saved up for later (by then it is the past), and if the headphones come out the voice stops mid-word.
@MainActor
public final class SpeechDriver {
  public enum Status: Equatable, Sendable { case off, needsHeadphones, ready, speaking(behind: Int) }

  private var queue = SpeechQueue()
  private let voice: any SpeechVoice
  private let routeAllows: @MainActor () -> Bool
  public var language: String
  public var voiceId: String?
  public var onChange: (@MainActor () -> Void)?

  /// - Parameter routeAllows: whether sound may come out right now. Always true where no microphone is open.
  public init(voice: any SpeechVoice, language: String, routeAllows: @escaping @MainActor () -> Bool) {
    self.voice = voice; self.language = language; self.routeAllows = routeAllows
  }

  public var isOn: Bool { queue.isOn }
  public var spoken: Int { queue.spoken }
  public var skipped: Int { queue.skipped }
  public var status: Status { !queue.isOn ? .off : !routeAllows() ? .needsHeadphones : queue.behind > 0 ? .speaking(behind: queue.behind) : .ready }

  public func turnOn(existing ids: [String], rate: Double) {
    var options = SpeechQueue.defaults
    options.rate = rate
    queue = SpeechQueue(options: options)
    queue.start(existing: ids)
    onChange?()
  }

  public func turnOff() {
    queue.stop()
    voice.stop()
    onChange?()
  }

  public func offer(_ line: TranscriptLine) {
    guard queue.isOn else { return }
    guard routeAllows() else { queue.start(existing: [line.id]); onChange?(); return } // heard by no one: it is the past now
    queue.offer(line)
    pump()
  }

  /// The output changed: headphones in, or out.
  public func routeChanged() {
    guard queue.isOn else { return }
    if !routeAllows() { voice.stop() } // not one more word through the speaker
    onChange?()
  }

  private func pump() {
    guard routeAllows(), let item = queue.next() else { onChange?(); return }
    voice.speak(item.text, language: language, voiceId: voiceId, rate: item.rate) { [weak self] in
      guard let self else { return }
      self.queue.finished(item.id)
      self.pump()
    }
    onChange?()
  }
}
