import AVFoundation
import SwiftUI

/// A recording's audio, played. The transcript follows it, and a tap on a sentence moves it.
@MainActor @Observable
final class PlayerModel {
  private let player: AVPlayer
  private var observer: Any?
  private(set) var position: Double = 0
  private(set) var duration: Double = 0
  private(set) var playing = false
  var rate: Float = 1 { didSet { if playing { player.rate = rate } } }

  init(url: URL) {
    player = AVPlayer(url: url)
    observer = player.addPeriodicTimeObserver(forInterval: CMTime(seconds: 0.25, preferredTimescale: 600), queue: .main) { [weak self] time in
      MainActor.assumeIsolated {
        guard let self else { return }
        self.position = time.seconds
        if self.duration > 0, time.seconds >= self.duration - 0.05 { self.playing = false }
      }
    }
    Task { [weak self] in
      let seconds = (try? await AVURLAsset(url: url).load(.duration).seconds) ?? 0
      self?.duration = seconds.isFinite ? seconds : 0
    }
  }

  func toggle() {
    if playing { player.pause(); playing = false; return }
    // a recorder takes the audio session for the microphone; playing takes it back
    try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .spokenAudio)
    try? AVAudioSession.sharedInstance().setActive(true)
    if duration > 0, position >= duration - 0.1 { seek(to: 0) }
    player.playImmediately(atRate: rate)
    playing = true
  }

  func pause() { player.pause(); playing = false }
  func seek(to seconds: Double) {
    let t = max(0, min(duration > 0 ? duration : seconds, seconds))
    position = t
    player.seek(to: CMTime(seconds: t, preferredTimescale: 600), toleranceBefore: .zero, toleranceAfter: .zero)
  }
  func skip(_ seconds: Double) { seek(to: position + seconds) }
  func nextRate() { rate = rate >= 2 ? 0.75 : rate >= 1.5 ? 2 : rate >= 1.25 ? 1.5 : rate >= 1 ? 1.25 : 1 }
}
