// The player (plan-ios §7), a port of the PWA's player.ts. Owns the queue,
// filter, history, likes and the lock screen; an AudioEngine does the audio.
// Queue, filter and dedupe rules are HumCore's (the same as the CLI's).
import AVFoundation
import Foundation
import HumCore
import Observation
import UIKit

nonisolated struct Like: Codable, Hashable, Sendable {
  var key: String  // groupKey: every version of the song
  var id: String  // the version that was liked
}

nonisolated struct SavedState: Codable, Sendable {
  var queue: QueueSnapshot
  var position: Double
  var filter: String
  var dedupe: Bool
  var history: [String]
  var likes: [Like]
}

@Observable final class PlayerModel {
  // ── What the UI reads ──
  private(set) var current: Track?
  private(set) var playing = false
  private(set) var buffering = false
  private(set) var position: Double = 0
  private(set) var filterText = ""
  private(set) var poolSize = 0
  private(set) var dedupeOn = true
  private(set) var queue = Queue(QueueSnapshot(order: [], cursor: 0, shuffle: true, repeat: .all))
  private(set) var history: [String] = []
  private(set) var likes: [Like] = []
  private(set) var facets: [[String]] = []
  private(set) var artwork: UIImage?
  private(set) var trackCount = 0
  // What plays after the current track (with repeat-all wraparound), kept
  // here so views never mutate the queue while rendering.
  private(set) var upcoming: [String] = []
  var notice = ""

  let profile: Profile
  let cache: AudioCache
  private let art: ArtCache
  private let source: TrackSource
  private let engine: AudioEngine
  private var nowPlaying: NowPlaying?

  private var byId: [String: Track] = [:]
  private var all: [Track] = []
  private var songs: [Track] = []
  private var vocab: [String] = []
  private var loadToken = 0
  private var nextToken = 0
  private var failuresInARow = 0
  // Play/pause intent while a load is still resolving its URL: a tap on Play
  // right after launch used to land on an empty player and be lost.
  private var wantsPlay = false
  private var loading = false  // between load() and the engine playing it
  private var lastSave = Date.distantPast
  private let persist: Bool
  static let historyMax = 200

  var dimensions: [String] { profile.dimensions }
  // The metadata's duration, else the file's own (tracks listed before the
  // metadata arrived have none; turn 17: the bar sat at the end).
  private(set) var engineDuration: Double = 0
  var duration: Double {
    if let d = current?.duration, d > 0 { return d }
    return engineDuration
  }
  var paused: Bool { !playing }

  init(profile: Profile, source: TrackSource, engine: AudioEngine, cache: AudioCache, remote: Bool = true, persist: Bool = true) {
    self.profile = profile
    self.source = source
    self.engine = engine
    self.cache = cache
    self.art = ArtCache(source: source)
    self.persist = persist
    engine.onBoundary = { [weak self] id in self?.boundary(id) }
    engine.onEnded = { [weak self] in self?.ended() }
    engine.onState = { [weak self] playing, buffering in self?.engineState(playing, buffering) }
    engine.onTime = { [weak self] t in self?.tick(t) }
    engine.onFailed = { [weak self] id, msg in self?.failed(id, msg) }
    if remote {
      nowPlaying = NowPlaying(RemoteHandlers(
        play: { [weak self] in self?.play() }, pause: { [weak self] in self?.pause() },
        toggle: { [weak self] in self?.toggle() }, next: { [weak self] in self?.next() },
        prev: { [weak self] in self?.prev() }, seek: { [weak self] s in self?.seek(s) }))
    }
  }

  func track(_ id: String?) -> Track? { id.flatMap { byId[$0] } }

  // ── Library + filter ─────────────────────────────────────────────────────

  private func isLiked(_ t: Track) -> Bool {
    let k = t.groupKey(variantDim: profile.variant?.dimension)
    return likes.contains { $0.key == k }
  }

  func liked(_ id: String) -> Bool { track(id).map(isLiked) ?? false }

  private func pool() -> [String] {
    let f = parseFilter(filterText, vocab)
    let hits = applyFilter(dedupeOn ? songs : all, f, isFav: isLiked)
    let list = dedupeOn ? dedupeVariants(hits, profile.variant, favored: { t in self.likes.contains { $0.id == t.id } }) : hits
    return list.map(\.id)
  }

  private func setTracks(_ lib: Library) {
    all = lib.tracks.sorted(by: pathOrder)
    byId = Dictionary(all.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
    songs = dedupe(all).sorted(by: pathOrder)
    vocab = vocabulary(all)
    trackCount = all.count
    var sets = profile.dimensions.map { _ in Set<String>() }
    for t in all { for (i, v) in t.dims.enumerated() where i < sets.count { sets[i].insert(v) } }
    facets = sets.map { $0.sorted(by: profile.valueOrder) }
  }

  func start(_ lib: Library) {
    setupAudioSession()
    setTracks(lib)
    let saved = persist ? Store.read(SavedState.self, "state.json") : nil
    filterText = saved?.filter ?? profile.defaultFilter ?? ""
    dedupeOn = saved?.dedupe ?? true
    history = (saved?.history ?? []).filter { byId[$0] != nil }
    likes = saved?.likes ?? []
    queue = Queue(saved?.queue ?? QueueSnapshot(order: [], cursor: 0, shuffle: true, repeat: .all))
    queue.retain(Set(byId.keys))
    let p = pool()
    poolSize = p.count
    if queue.order.isEmpty { queue.setPool(p) }
    if let id = queue.current { load(id, at: saved?.position ?? 0, autoplay: false) } else { upcoming = queue.upcoming(30) }
    log("audioSession: playback · tracks: \(all.count) · songs in pool: \(p.count)")
  }

  // New library (metadata arrived, or a delta) while running. Ids never change.
  func updateLibrary(_ lib: Library, reshuffle: Bool = false) {
    setTracks(lib)
    queue.retain(Set(byId.keys))
    let p = pool()
    poolSize = p.count
    // The first queue was built from file names only: rebuild it so dedupe
    // keeps the right versions. The current track keeps playing.
    if reshuffle { queue.setPool(p, startId: queue.current) }
    if let t = track(queue.current) {
      current = t
      updateNowPlaying()
    }
    afterQueueChange()
  }

  // Which values in each dimension still have songs, given the draft's terms
  // in the OTHER dimensions (greys out chips that would match nothing).
  func available(_ draft: String) -> [Set<String>] {
    let f = parseFilter(draft, vocab)
    let ok = f.terms.filter { $0.kind == .ok }
    return facets.indices.map { i in
      let others = ParsedFilter(terms: ok.filter { !$0.matches.allSatisfy { facets[i].contains($0) } })
      return Set(applyFilter(dedupeOn ? songs : all, others, isFav: isLiked).compactMap { i < $0.dims.count ? $0.dims[i] : nil })
    }
  }

  // Returns an error message, or nil when applied.
  @discardableResult
  func setFilter(_ text: String) -> String? {
    let f = parseFilter(text, vocab)
    if let bad = f.terms.first(where: { $0.kind != .ok }) {
      return bad.kind == .ambiguous ? "\"\(bad.term)\": \(bad.matches.joined(separator: " / "))?" : "no folder matches \"\(bad.term)\""
    }
    let prev = filterText
    filterText = describe(f)
    let p = pool()
    if p.isEmpty {
      filterText = prev
      return "no songs match"
    }
    poolSize = p.count
    queue.setPool(p)
    if let id = queue.current { load(id, at: 0, autoplay: true) }
    return nil
  }

  func complete(_ draft: String) -> String { HumCore.complete(draft, vocab) }

  // ── Transport ────────────────────────────────────────────────────────────

  func play() {
    guard current != nil else { return }
    wantsPlay = true
    activateSession()
    if engine.currentId == current?.id { engine.play() }
  }

  func pause() {
    wantsPlay = false
    loading = false
    engine.pause()
  }
  func toggle() { playing ? pause() : play() }

  func next() {
    if let id = queue.advance(auto: false) {
      load(id, at: 0, autoplay: true)
    } else {
      say("END OF QUEUE")
    }
  }

  func prev() {
    if engine.position > 3 { return seek(0) }
    if let id = queue.back() { load(id, at: 0, autoplay: true) }
  }

  func seek(_ sec: Double) {
    let s = max(0, min(sec, duration > 0 ? duration - 0.5 : sec))
    engine.seek(s)
    position = s
    updateNowPlaying()
  }

  func playNow(_ id: String) {
    queue.playNow(id)
    load(id, at: 0, autoplay: true)
  }

  func jumpTo(_ index: Int) {
    if let id = queue.jumpTo(index) { load(id, at: 0, autoplay: true) }
  }

  func toggleShuffle() {
    queue.setShuffle(!queue.shuffle, pool: pool())
    afterQueueChange()
  }

  func cycleRepeat() {
    queue.cycleRepeat()
    afterQueueChange()
  }

  func toggleDedupe() {
    dedupeOn.toggle()
    let p = pool()
    poolSize = p.count
    queue.setPool(p, startId: queue.current)
    afterQueueChange()
    say(dedupeOn ? "ONE VERSION PER SONG" : "EVERY LENGTH AND VERSION")
  }

  func toggleLike(_ id: String) {
    guard let t = track(id) else { return }
    let k = t.groupKey(variantDim: profile.variant?.dimension)
    if likes.contains(where: { $0.key == k }) {
      likes.removeAll { $0.key == k }
      say("UNLIKED · \(t.name)")
    } else {
      likes.insert(Like(key: k, id: t.id), at: 0)
      say("♥ LIKED · \(t.name)")
    }
    if usesFav(parseFilter(filterText, vocab)) { poolSize = pool().count }
    save(force: true)
  }

  private func say(_ msg: String) {
    notice = msg
    log(msg)
  }

  // ── Loading ──────────────────────────────────────────────────────────────

  private func load(_ id: String, at: Double, autoplay: Bool) {
    guard let t = byId[id] else { return }
    current = t
    position = at
    engineDuration = 0
    notice = ""
    artwork = art.cached(t.id)
    loadToken += 1
    let token = loadToken
    wantsPlay = autoplay
    loading = autoplay
    if autoplay, !playing {
      playing = true
      buffering = true
    }
    log("load \(t.name)\(at > 0 ? " at \(Int(at)) s" : "")\(autoplay ? "" : " (paused)")")
    updateNowPlaying()
    Task {
      do {
        let url = try await resolve(t)
        guard token == loadToken else { return }
        if wantsPlay { activateSession() }
        engine.load(t.id, url: url, at: at, autoplay: wantsPlay)
        failuresInARow = 0
        sendNext()
      } catch {
        guard token == loadToken else { return }
        var auth = false
        if case DropboxError.auth = error { auth = true }
        failed(t.id, "\(error)", auth: auth)
      }
    }
    afterQueueChange()
    Task {
      let img = await art.image(t)
      guard current?.id == t.id else { return }
      artwork = img
      updateNowPlaying()
    }
  }

  // The cached file if we have it, else a stream.
  private func resolve(_ t: Track) async throws -> URL {
    if let f = cache.file(t.id) { return f }
    return try await source.streamURL(t)
  }

  private func sendNext() {
    nextToken += 1
    let token = nextToken
    guard let id = queue.autoNext(), let t = byId[id], engine.currentId == queue.current else {
      engine.setNext(nil, url: nil)
      return
    }
    Task {
      guard let url = try? await resolve(t), token == nextToken else { return }
      engine.setNext(t.id, url: url)
    }
  }

  private func afterQueueChange() {
    upcoming = queue.upcoming(30)
    if engine.currentId == queue.current { sendNext() }
    updateWindow()
    save(force: true)
  }

  private func updateWindow() {
    guard let cur = queue.current else { return }
    let order = ([cur] + queue.upcoming(3)).compactMap { byId[$0] }
    let keep = Array(history.filter { $0 != cur }.suffix(2))
    cache.setWindow(order, keep: keep)
    art.preload(order)
  }

  private func recordStart(_ t: Track) {
    if history.last != t.id {
      history.append(t.id)
      if history.count > Self.historyMax { history.removeFirst(history.count - Self.historyMax) }
    }
  }

  // ── Engine events ────────────────────────────────────────────────────────

  // The engine moved into the next track by itself (the one we gave setNext).
  private func boundary(_ id: String) {
    let got = queue.advance(auto: true)
    if got != id {
      log("queue out of step (engine \(id), queue \(got ?? "-")), following the engine")
      queue.playNow(id)
    }
    guard let t = byId[id] else { return }
    current = t
    position = 0
    engineDuration = 0
    artwork = art.cached(t.id)
    recordStart(t)
    updateNowPlaying()
    afterQueueChange()
    Task {
      let img = await art.image(t)
      guard current?.id == t.id else { return }
      artwork = img
      updateNowPlaying()
    }
  }

  private func ended() {
    playing = false
    wantsPlay = false
    loading = false
    say("END OF QUEUE")
    updateNowPlaying()
  }

  private func engineState(_ isPlaying: Bool, _ isBuffering: Bool) {
    let was = playing
    // A skip reloads the player, which reports "paused" for a moment; while a
    // load we asked to play is in flight, show loading, not paused (turn 17:
    // the lock screen flipped to paused on fast skips to uncached tracks).
    let loadingToPlay = wantsPlay && loading
    if isPlaying { loading = false }
    playing = isPlaying || isBuffering || loadingToPlay
    buffering = isBuffering || (loadingToPlay && !isPlaying)
    if isPlaying, let t = current { recordStart(t) }
    if was != playing {
      updateNowPlaying()
      save(force: true)
    }
  }

  private func tick(_ t: Double) {
    position = t
    let d = engine.itemDuration
    if d != engineDuration, engine.currentId == current?.id {
      engineDuration = d
      if (current?.duration ?? 0) <= 0 { updateNowPlaying() }
    }
    save(force: false)
  }

  private func failed(_ id: String, _ msg: String, auth: Bool = false) {
    let name = byId[id]?.name ?? id
    loading = false
    playing = !engine.paused
    buffering = false
    failuresInARow += 1
    if auth {
      say("DROPBOX SIGN-IN EXPIRED")
      return
    }
    say(msg.hasPrefix("network") ? "OFFLINE · CAN'T PLAY \(name)" : "CAN'T PLAY \(name)")
    log("failed \(name): \(msg)")
    // Skip ahead, but don't spin through a whole offline queue.
    guard failuresInARow < 5, id == queue.current else { return }
    Task {
      try? await Task.sleep(for: .milliseconds(1500))
      if self.queue.current == id { self.next() }
    }
  }

  // ── Lock screen + audio session ──────────────────────────────────────────

  private func setupAudioSession() {
    let s = AVAudioSession.sharedInstance()
    do {
      try s.setCategory(.playback, mode: .default, policy: .longFormAudio)
    } catch {
      log("audioSession: \(error.localizedDescription)")
    }
    Self.observeInterruptions { [weak self] resume in
      guard let self else { return }
      log("interruption ended\(resume ? ", resuming" : "")")
      if resume { self.play() }
    }
  }

  private func activateSession() {
    try? AVAudioSession.sharedInstance().setActive(true)
  }

  nonisolated private static func observeInterruptions(_ fn: @escaping @MainActor @Sendable (Bool) -> Void) {
    _ = NotificationCenter.default.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: .main) { note in
      let info = note.userInfo ?? [:]
      let type = (info[AVAudioSessionInterruptionTypeKey] as? UInt).flatMap(AVAudioSession.InterruptionType.init(rawValue:))
      guard type == .ended else { return }
      let opts = AVAudioSession.InterruptionOptions(rawValue: (info[AVAudioSessionInterruptionOptionKey] as? UInt) ?? 0)
      let resume = opts.contains(.shouldResume)
      MainActor.assumeIsolated { fn(resume) }
    }
  }

  private func updateNowPlaying() {
    guard let t = current else { return }
    nowPlaying?.update(
      title: t.name, artist: t.album, album: profile.label, duration: duration, elapsed: position, playing: playing,
      art: artwork)
  }

  // Sign out: silence and leave the lock screen.
  func shutdown() {
    loadToken += 1
    engine.pause()
    nowPlaying?.clear()
    nowPlaying = nil
  }

  // ── Persistence ──────────────────────────────────────────────────────────

  func save(force: Bool) {
    guard persist, force || Date().timeIntervalSince(lastSave) > 5 else { return }
    lastSave = Date()
    let s = SavedState(
      queue: queue.snapshot, position: position, filter: filterText, dedupe: dedupeOn, history: history, likes: likes)
    Store.write(s, "state.json")
  }
}
