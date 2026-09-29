// The audio engine (plan-ios §5): one AVQueuePlayer holding the current item
// and the next one, like the CLI's Swift helper. It knows nothing about the
// queue; the player model tells it what to load and what comes next, and it
// reports boundaries (the next item became current by itself) and state.
import AVFoundation
import Foundation

protocol AudioEngine: AnyObject {
  var onBoundary: ((String) -> Void)? { get set }
  var onEnded: (() -> Void)? { get set }
  var onState: ((_ playing: Bool, _ buffering: Bool) -> Void)? { get set }
  var onTime: ((Double) -> Void)? { get set }
  var onFailed: ((_ id: String, _ message: String) -> Void)? { get set }
  var position: Double { get }
  var itemDuration: Double { get }  // from the file itself; 0 until known
  var paused: Bool { get }
  var currentId: String? { get }
  func load(_ id: String, url: URL, at: Double, autoplay: Bool)
  func setNext(_ id: String?, url: URL?)
  func play()
  func pause()
  func seek(_ sec: Double)
}

final class AVEngine: AudioEngine {
  var onBoundary: ((String) -> Void)?
  var onEnded: (() -> Void)?
  var onState: ((Bool, Bool) -> Void)?
  var onTime: ((Double) -> Void)?
  var onFailed: ((String, String) -> Void)?

  private let player = AVQueuePlayer()
  private var current: (item: AVPlayerItem, id: String, url: URL)?
  private var next: (item: AVPlayerItem, id: String, url: URL)?
  private var ended = false
  private var itemObservers: [ObjectIdentifier: NSKeyValueObservation] = [:]
  private var playerObservers: [NSKeyValueObservation] = []
  private var timeObserver: Any?
  private var pendingSeek: Double?  // applied once the item is ready
  private var seeking = false

  init() {
    player.actionAtItemEnd = .advance
    player.automaticallyWaitsToMinimizeStalling = true
    playerObservers = Self.observePlayer(player) { [weak self] which in
      switch which {
      case .item: self?.currentChanged()
      case .status: self?.stateChanged()
      }
    }
    timeObserver = Self.addTimeObserver(player) { [weak self] in self?.tick() }
  }

  var currentId: String? { current?.id }

  var itemDuration: Double {
    let d = player.currentItem?.duration.seconds ?? 0
    return d.isFinite && d > 0 ? d : 0
  }
  var paused: Bool { player.timeControlStatus == .paused }

  var position: Double {
    if let p = pendingSeek { return p }
    let s = player.currentTime().seconds
    return s.isFinite ? max(0, s) : 0
  }

  // ── KVO, created outside the main actor so the callbacks may run anywhere;
  //    they hop to the main queue before touching the engine. ──

  enum Change: Sendable { case item, status }

  nonisolated private static func observePlayer(_ p: AVQueuePlayer, _ cb: @escaping @MainActor @Sendable (Change) -> Void)
    -> [NSKeyValueObservation]
  {
    [
      p.observe(\.currentItem, options: [.new]) { _, _ in Task { @MainActor in cb(.item) } },
      p.observe(\.timeControlStatus, options: [.new]) { _, _ in Task { @MainActor in cb(.status) } },
    ]
  }

  nonisolated private static func observeItem(_ item: AVPlayerItem, _ cb: @escaping @MainActor @Sendable (AVPlayerItem.Status) -> Void)
    -> NSKeyValueObservation
  {
    item.observe(\.status, options: [.new]) { it, _ in
      let s = it.status
      Task { @MainActor in cb(s) }
    }
  }

  nonisolated private static func seek(_ p: AVQueuePlayer, _ sec: Double, _ done: @escaping @MainActor @Sendable () -> Void) {
    p.seek(to: CMTime(seconds: sec, preferredTimescale: 1000), toleranceBefore: .zero, toleranceAfter: .zero) { _ in
      Task { @MainActor in done() }
    }
  }

  nonisolated private static func addTimeObserver(_ p: AVQueuePlayer, _ cb: @escaping @MainActor @Sendable () -> Void) -> Any {
    p.addPeriodicTimeObserver(forInterval: CMTime(seconds: 0.5, preferredTimescale: 600), queue: .main) { _ in
      MainActor.assumeIsolated { cb() }
    }
  }

  private func makeItem(_ id: String, _ url: URL) -> AVPlayerItem {
    let item = AVPlayerItem(asset: AVURLAsset(url: url), automaticallyLoadedAssetKeys: ["playable", "duration"])
    item.preferredForwardBufferDuration = 30
    let key = ObjectIdentifier(item)
    itemObservers[key] = Self.observeItem(item) { [weak self] status in
      self?.itemStatus(key, id, status)
    }
    return item
  }

  private func forget(_ item: AVPlayerItem) {
    itemObservers[ObjectIdentifier(item)] = nil
  }

  // ── Commands ──

  func load(_ id: String, url: URL, at: Double, autoplay: Bool) {
    if let c = current { forget(c.item) }
    if let n = next { forget(n.item) }
    next = nil
    let item = makeItem(id, url)
    current = (item, id, url)
    ended = false
    pendingSeek = at > 0 ? at : nil
    player.removeAllItems()
    player.insert(item, after: nil)
    if autoplay { player.play() } else { player.pause() }
  }

  func setNext(_ id: String?, url: URL?) {
    if let n = next {
      if n.id == id { return }
      player.remove(n.item)
      forget(n.item)
      next = nil
    }
    guard let id, let url, let cur = current else { return }
    let item = makeItem(id, url)
    if player.canInsert(item, after: cur.item) {
      player.insert(item, after: cur.item)
      next = (item, id, url)
    } else {
      forget(item)
    }
  }

  func play() {
    if player.currentItem == nil, let c = current {
      // Ended: play the last track again from the top.
      load(c.id, url: c.url, at: 0, autoplay: true)
      return
    }
    player.play()
  }

  func pause() { player.pause() }

  func seek(_ sec: Double) {
    guard let item = player.currentItem else { return }
    if item.status != .readyToPlay {
      pendingSeek = sec
      return
    }
    seeking = true
    pendingSeek = sec
    Self.seek(player, sec) { [weak self] in
      guard let self else { return }
      self.seeking = false
      self.pendingSeek = nil
      self.tick()
    }
  }

  // ── Events ──

  private func itemStatus(_ key: ObjectIdentifier, _ id: String, _ status: AVPlayerItem.Status) {
    let item = [current?.item, next?.item].compactMap { $0 }.first { ObjectIdentifier($0) == key }
    switch status {
    case .readyToPlay:
      if let item, item === current?.item, let at = pendingSeek, !seeking {
        seek(at)
      }
    case .failed:
      guard item != nil else { return }  // an item we already dropped
      onFailed?(id, item?.error?.localizedDescription ?? "failed to load")
    default:
      break
    }
  }

  private func currentChanged() {
    let now = player.currentItem
    if let c = current, now === c.item { return }
    if let n = next, now === n.item {
      if let c = current { forget(c.item) }
      current = n
      next = nil
      pendingSeek = nil
      onBoundary?(n.id)
      return
    }
    if now == nil, current != nil, !ended {
      ended = true
      onEnded?()
    }
  }

  private func stateChanged() {
    let s = player.timeControlStatus
    onState?(s == .playing, s == .waitingToPlayAtSpecifiedRate)
  }

  private func tick() {
    if seeking { return }
    onTime?(position)
  }
}
