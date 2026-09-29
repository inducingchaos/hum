// humplayer: the audio engine for the hum CLI.
//
// Plays local files or HTTPS URLs with AVQueuePlayer (gapless), and publishes
// Now Playing info + media-key commands. It holds no playlist logic: the Bun
// process sends commands as JSON lines on stdin and gets events as JSON lines
// on stdout. The protocol is documented in docs/plan.md §10.
//
// Exits when stdin closes, so audio never keeps playing if the parent dies.

import AVFoundation
import AppKit
import MediaPlayer

setvbuf(stdout, nil, _IOLBF, 0)
signal(SIGPIPE, SIG_IGN)

func emit(_ obj: [String: Any]) {
  guard let data = try? JSONSerialization.data(withJSONObject: obj),
    let line = String(data: data, encoding: .utf8)
  else { return }
  if fputs(line + "\n", stdout) < 0 || fflush(stdout) != 0 { exit(0) }
}

final class Item: AVPlayerItem {
  let tid: String
  let title: String
  let artist: String
  let album: String
  var pendingSeek: Double = 0
  var artwork: MPMediaItemArtwork?
  var statusObs: NSKeyValueObservation?

  init(tid: String, url: URL, title: String, artist: String, album: String) {
    self.tid = tid
    self.title = title
    self.artist = artist
    self.album = album
    super.init(asset: AVURLAsset(url: url), automaticallyLoadedAssetKeys: ["duration", "playable"])
  }

  var durationSec: Double {
    let d = duration.seconds
    return d.isFinite ? d : 0
  }
}

final class Engine {
  let player = AVQueuePlayer()
  // The item main last knew as current. KVO changes are compared against it to
  // tell a gapless advance (emit "advanced") from our own load (emit nothing).
  var lastItem: Item?
  var observers: [NSKeyValueObservation] = []
  var timer: Timer?
  // While a seek is in flight, currentTime() reports the old or an in-between
  // position. Time events wait until the latest seek lands.
  var seekSeq = 0
  var seeking = false

  init() {
    player.actionAtItemEnd = .advance
    observers.append(
      player.observe(\.currentItem, options: [.new]) { [weak self] _, _ in
        DispatchQueue.main.async { self?.currentChanged() }
      })
    observers.append(
      player.observe(\.timeControlStatus, options: [.new]) { [weak self] _, _ in
        DispatchQueue.main.async { self?.stateChanged() }
      })
    timer = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { [weak self] _ in
      self?.tick()
    }
    setupRemote()
  }

  var current: Item? { player.currentItem as? Item }

  func makeItem(_ c: [String: Any]) -> Item? {
    guard let id = c["id"] as? String, let src = c["src"] as? String else { return nil }
    let url = src.hasPrefix("http") ? URL(string: src) : URL(fileURLWithPath: src)
    guard let url else { return nil }
    let item = Item(
      tid: id, url: url,
      title: c["title"] as? String ?? "",
      artist: c["artist"] as? String ?? "",
      album: c["album"] as? String ?? "")
    if let art = c["art"] as? String { item.artwork = loadArtwork(art) }
    item.statusObs = item.observe(\.status, options: [.new]) { [weak self] it, _ in
      DispatchQueue.main.async { self?.itemStatus(it as! Item) }
    }
    return item
  }

  func itemStatus(_ item: Item) {
    switch item.status {
    case .readyToPlay:
      if item.pendingSeek > 0 {
        // Keep pendingSeek set until the seek lands, so tick() doesn't report 0:00 meanwhile.
        item.seek(to: CMTime(seconds: item.pendingSeek, preferredTimescale: 1000), toleranceBefore: .zero, toleranceAfter: .zero) {
          [weak self] _ in
          DispatchQueue.main.async {
            item.pendingSeek = 0
            self?.updateNowPlaying()
            self?.tick(force: true)
          }
        }
      }
      if item === current { updateNowPlaying(); tick(force: true) }
    case .failed:
      emit(["ev": "error", "id": item.tid, "message": item.error?.localizedDescription ?? "failed to load"])
    default: break
    }
  }

  func currentChanged() {
    let now = current
    if now === lastItem { return }
    if let prev = lastItem, let now {
      emit(["ev": "advanced", "from": prev.tid, "to": now.tid])
    } else if let prev = lastItem, now == nil {
      emit(["ev": "ended", "id": prev.tid])
    }
    lastItem = now
    updateNowPlaying()
    tick(force: true)
  }

  var lastState = ""
  func stateChanged() {
    let s: String
    switch player.timeControlStatus {
    case .playing: s = "playing"
    case .waitingToPlayAtSpecifiedRate: s = "buffering"
    default: s = "paused"
    }
    if s == lastState { return }
    lastState = s
    emit(["ev": "state", "state": s, "id": current?.tid ?? NSNull()])
    updateNowPlaying()
  }

  func tick(force: Bool = false) {
    guard let item = current, item.pendingSeek == 0, !seeking else { return }
    if !force && player.timeControlStatus != .playing { return }
    let pos = player.currentTime().seconds
    emit(["ev": "time", "id": item.tid, "pos": pos.isFinite ? pos : 0, "dur": item.durationSec])
  }

  func handle(_ c: [String: Any]) {
    switch c["cmd"] as? String ?? "" {
    case "load":
      guard let item = makeItem(c) else { return emit(["ev": "error", "message": "bad load"]) }
      item.pendingSeek = c["pos"] as? Double ?? 0
      seekSeq += 1
      seeking = false
      lastItem = item
      player.removeAllItems()
      player.insert(item, after: nil)
      if c["paused"] as? Bool == true { player.pause() } else { player.play() }
      updateNowPlaying()
    case "setNext":
      // Replace whatever is queued after the current item. `after` guards against
      // a race where the player already advanced before this command arrived.
      guard let cur = current else { return }
      if let after = c["after"] as? String, after != cur.tid { return }
      for it in player.items().dropFirst() { player.remove(it) }
      if let item = makeItem(c) { player.insert(item, after: cur) }
    case "play": player.play()
    case "pause": player.pause()
    case "toggle": player.timeControlStatus == .paused ? player.play() : player.pause()
    case "seek": seek(to: c["sec"] as? Double ?? 0)
    case "seekBy": seek(to: player.currentTime().seconds + (c["sec"] as? Double ?? 0))
    case "volume": player.volume = Float(c["value"] as? Double ?? 1)
    case "stop":
      lastItem = nil
      player.removeAllItems()
      updateNowPlaying()
    case "art":
      // Cover art that arrived after the item was queued.
      guard let id = c["id"] as? String, let path = c["path"] as? String else { return }
      let art = loadArtwork(path)
      for case let it as Item in player.items() where it.tid == id { it.artwork = art }
      if current?.tid == id { updateNowPlaying() }
      emit(["ev": "art", "id": id, "ok": art != nil])
    case "quit": exit(0)
    default: emit(["ev": "error", "message": "unknown cmd"])
    }
  }

  func seek(to target: Double) {
    guard let item = current else { return }
    let dur = item.durationSec
    var t = max(0, target.isFinite ? target : 0)
    if dur > 0 { t = min(t, dur - 0.25) }
    seekSeq += 1
    let seq = seekSeq
    seeking = true
    player.seek(to: CMTime(seconds: t, preferredTimescale: 1000), toleranceBefore: .zero, toleranceAfter: .zero) {
      [weak self] _ in
      DispatchQueue.main.async {
        // A newer seek (or load) superseded this one: its completion reports.
        guard let self, seq == self.seekSeq else { return }
        self.seeking = false
        self.updateNowPlaying()
        self.tick(force: true)
      }
    }
  }

  // MARK: Now Playing + media keys

  func updateNowPlaying() {
    let center = MPNowPlayingInfoCenter.default()
    guard let item = current else {
      center.nowPlayingInfo = nil
      center.playbackState = .stopped
      return
    }
    let playing = player.timeControlStatus != .paused
    let pos = player.currentTime().seconds
    var info: [String: Any] = [
      MPMediaItemPropertyTitle: item.title,
      MPMediaItemPropertyArtist: item.artist,
      MPMediaItemPropertyAlbumTitle: item.album,
      MPMediaItemPropertyPlaybackDuration: item.durationSec,
      MPNowPlayingInfoPropertyElapsedPlaybackTime: pos.isFinite ? pos : 0,
      MPNowPlayingInfoPropertyPlaybackRate: playing ? 1.0 : 0.0,
      MPNowPlayingInfoPropertyMediaType: MPNowPlayingInfoMediaType.audio.rawValue,
    ]
    if let art = item.artwork { info[MPMediaItemPropertyArtwork] = art }
    center.nowPlayingInfo = info
    center.playbackState = playing ? .playing : .paused
  }

  func setupRemote() {
    let rc = MPRemoteCommandCenter.shared()
    let forward: [(MPRemoteCommand, String)] = [
      (rc.togglePlayPauseCommand, "toggle"),
      (rc.playCommand, "play"),
      (rc.pauseCommand, "pause"),
      (rc.nextTrackCommand, "next"),
      (rc.previousTrackCommand, "prev"),
    ]
    for (command, name) in forward {
      command.isEnabled = true
      command.addTarget { _ in
        emit(["ev": "remote", "cmd": name])
        return .success
      }
    }
    rc.changePlaybackPositionCommand.isEnabled = true
    rc.changePlaybackPositionCommand.addTarget { event in
      guard let e = event as? MPChangePlaybackPositionCommandEvent else { return .commandFailed }
      emit(["ev": "remote", "cmd": "seek", "pos": e.positionTime])
      return .success
    }
    for command in [rc.skipForwardCommand, rc.skipBackwardCommand, rc.seekForwardCommand, rc.seekBackwardCommand] {
      command.isEnabled = false
    }
  }
}

// Center-cropped square, since Now Playing draws artwork in a square.
func loadArtwork(_ path: String) -> MPMediaItemArtwork? {
  guard let img = NSImage(contentsOfFile: path),
    let cg = img.cgImage(forProposedRect: nil, context: nil, hints: nil)
  else { return nil }
  let side = min(cg.width, cg.height)
  let rect = CGRect(x: (cg.width - side) / 2, y: (cg.height - side) / 2, width: side, height: side)
  guard let square = cg.cropping(to: rect) else { return nil }
  let out = NSImage(cgImage: square, size: NSSize(width: side, height: side))
  return MPMediaItemArtwork(boundsSize: out.size) { _ in out }
}

let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let engine = Engine()

Thread {
  while let line = readLine() {
    guard let data = line.data(using: .utf8),
      let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
    else { continue }
    DispatchQueue.main.async { engine.handle(obj) }
  }
  DispatchQueue.main.async { exit(0) }
}.start()

emit(["ev": "ready", "version": 1])
app.run()
