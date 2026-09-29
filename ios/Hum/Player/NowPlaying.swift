// Lock screen, Control Center, headphones and AirPods (plan-ios §6).
// Previous/next instead of ±15 s (the PWA's first bug), scrubbing, artwork.
import AVFoundation
import MediaPlayer
import UIKit

struct RemoteHandlers {
  var play: () -> Void
  var pause: () -> Void
  var toggle: () -> Void
  var next: () -> Void
  var prev: () -> Void
  var seek: (Double) -> Void
}

final class NowPlaying {
  private let handlers: RemoteHandlers

  init(_ handlers: RemoteHandlers) {
    self.handlers = handlers
    let c = MPRemoteCommandCenter.shared()
    Self.register(c.playCommand, "play") { [weak self] _ in self?.handlers.play() }
    Self.register(c.pauseCommand, "pause") { [weak self] _ in self?.handlers.pause() }
    Self.register(c.togglePlayPauseCommand, "toggle") { [weak self] _ in self?.handlers.toggle() }
    Self.register(c.nextTrackCommand, "nexttrack") { [weak self] _ in self?.handlers.next() }
    Self.register(c.previousTrackCommand, "previoustrack") { [weak self] _ in self?.handlers.prev() }
    Self.register(c.changePlaybackPositionCommand, "seekto") { [weak self] pos in
      if let pos { self?.handlers.seek(pos) }
    }
    for cmd in [c.skipForwardCommand, c.skipBackwardCommand, c.seekForwardCommand, c.seekBackwardCommand] { cmd.isEnabled = false }
  }

  // Handlers are created outside the main actor (MediaPlayer may call them
  // from any thread) and hop to the main queue.
  nonisolated private static func register(_ cmd: MPRemoteCommand, _ name: String, _ fn: @escaping @MainActor @Sendable (Double?) -> Void) {
    cmd.isEnabled = true
    cmd.addTarget { event in
      let pos = (event as? MPChangePlaybackPositionCommandEvent)?.positionTime
      Task { @MainActor in
        log("remote: \(name)")
        fn(pos)
      }
      return .success
    }
  }

  // MPMediaItemArtwork calls its handler off the main thread: build it here.
  nonisolated private static func artwork(_ image: UIImage) -> MPMediaItemArtwork {
    MPMediaItemArtwork(boundsSize: image.size) { _ in image }
  }

  func update(title: String, artist: String, album: String, duration: Double, elapsed: Double, playing: Bool, art: UIImage?) {
    var info: [String: Any] = [
      MPMediaItemPropertyTitle: title,
      MPMediaItemPropertyArtist: artist,
      MPMediaItemPropertyAlbumTitle: album,
      MPNowPlayingInfoPropertyElapsedPlaybackTime: elapsed,
      MPNowPlayingInfoPropertyPlaybackRate: playing ? 1.0 : 0.0,
      MPNowPlayingInfoPropertyDefaultPlaybackRate: 1.0,
      MPNowPlayingInfoPropertyMediaType: MPNowPlayingInfoMediaType.audio.rawValue,
    ]
    if duration > 0 { info[MPMediaItemPropertyPlaybackDuration] = duration }
    if let art { info[MPMediaItemPropertyArtwork] = Self.artwork(art) }
    MPNowPlayingInfoCenter.default().nowPlayingInfo = info
  }

  func clear() {
    MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
  }
}
