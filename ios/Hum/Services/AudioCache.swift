// Audio cache (plan-ios §4, the PWA's cache.ts): whole files in Caches/audio,
// keyed by track id. Window = now + next 3 (downloaded one at a time, in
// order) + the last 2 played (kept, never downloaded again). Everything else
// goes least-recently-played first once the cap is passed.
import Foundation
import HumCore
import Observation
import UIKit

nonisolated struct CacheEntry: Codable, Sendable {
  var size: Int64
  var usedAt: Date
  var ext: String
}

@Observable final class AudioCache {
  private(set) var cachedIds: Set<String> = []
  private(set) var downloading: String?
  private(set) var bytes: Int64 = 0
  let cap: Int64

  private var index: [String: CacheEntry]
  private let dir = Store.subdir(Store.caches, "audio")
  private let source: TrackSource
  private var want: [Track] = []
  private var pinned: Set<String> = []
  private var current: (id: String, task: Task<URL, Error>)?
  private var running = false

  init(source: TrackSource, cap: Int64 = 2_000_000_000) {
    self.source = source
    self.cap = cap
    let saved = Store.read([String: CacheEntry].self, "cache-index.json", in: Store.caches) ?? [:]
    // Only what's really on disk (iOS may have purged Caches).
    var idx: [String: CacheEntry] = [:]
    for (id, e) in saved where FileManager.default.fileExists(atPath: dir.appendingPathComponent("\(id).\(e.ext)").path) { idx[id] = e }
    index = idx
    publish()
  }

  private func publish() {
    cachedIds = Set(index.keys)
    bytes = index.values.reduce(0) { $0 + $1.size }
    Store.write(index, "cache-index.json", in: Store.caches)
  }

  func file(_ id: String) -> URL? {
    guard let e = index[id] else { return nil }
    let u = dir.appendingPathComponent("\(id).\(e.ext)")
    guard FileManager.default.fileExists(atPath: u.path) else {
      index[id] = nil
      publish()
      return nil
    }
    index[id]?.usedAt = Date()
    return u
  }

  func setWindow(_ order: [Track], keep: [String]) {
    want = order
    pinned = Set(order.map(\.id) + keep)
    if let c = current, !pinned.contains(c.id) {
      log("prefetch: abort \(c.id) (left the window)")
      c.task.cancel()
    }
    Task { await run() }
  }

  private func run() async {
    if running { return }
    running = true
    defer { running = false }
    while let t = want.first(where: { index[$0.id] == nil }) {
      let t0 = Date()
      log("prefetch: start \(t.name)")
      downloading = t.id
      let task = Task { try await source.download(t) }
      current = (t.id, task)
      do {
        let tmp = try await task.value
        let ext = (t.fileName as NSString).pathExtension.lowercased().isEmpty ? "mp3" : (t.fileName as NSString).pathExtension.lowercased()
        let dst = dir.appendingPathComponent("\(t.id).\(ext)")
        try? FileManager.default.removeItem(at: dst)
        try FileManager.default.moveItem(at: tmp, to: dst)
        let size = (try? FileManager.default.attributesOfItem(atPath: dst.path)[.size] as? Int64) ?? Int64(t.size)
        index[t.id] = CacheEntry(size: size, usedAt: Date(), ext: ext)
        publish()
        log("cached \(t.name) (\(Int(Double(size) / 1e6)) MB, \(String(format: "%.1f", Date().timeIntervalSince(t0))) s)")
      } catch {
        current = nil
        downloading = nil
        if Task.isCancelled || task.isCancelled || (error as? URLError)?.code == .cancelled { continue }
        log("prefetch: \(t.name) failed: \(error)")
        if case DropboxError.auth = error { return }
        // Offline or flaky: wait, then look again (the window may have moved).
        var wait = Duration.seconds(3)
        if case DropboxError.network = error { wait = .seconds(10) }
        try? await Task.sleep(for: wait)
        continue
      }
      current = nil
      downloading = nil
    }
    evict()
  }

  private func evict() {
    var total = bytes
    for (id, e) in index.filter({ !pinned.contains($0.key) }).sorted(by: { $0.value.usedAt < $1.value.usedAt }) {
      if total <= cap { break }
      try? FileManager.default.removeItem(at: dir.appendingPathComponent("\(id).\(e.ext)"))
      index[id] = nil
      total -= e.size
    }
    publish()
  }

  // Everything but the playing track (it may be playing from its file).
  func clear() {
    current?.task.cancel()
    for (id, e) in index where id != want.first?.id {
      try? FileManager.default.removeItem(at: dir.appendingPathComponent("\(id).\(e.ext)"))
      index[id] = nil
    }
    publish()
  }
}

// Cover art: memory + Caches/art, so the lock screen gets it at once on a skip.
final class ArtCache {
  private let source: TrackSource
  private let dir = Store.subdir(Store.caches, "art")
  private var memory: [String: UIImage] = [:]
  private var inflight: [String: Task<UIImage?, Never>] = [:]
  private var failed = Set<String>()

  init(source: TrackSource) {
    self.source = source
  }

  func cached(_ id: String) -> UIImage? { memory[id] }

  func image(_ t: Track) async -> UIImage? {
    if let m = memory[t.id] { return m }
    if failed.contains(t.id) { return nil }
    if let task = inflight[t.id] { return await task.value }
    let file = dir.appendingPathComponent("\(t.id).jpg")
    let task = Task { () -> UIImage? in
      if let data = try? Data(contentsOf: file), let img = UIImage(data: data) { return img }
      guard let img = await source.art(t, size: 600) else { return nil }
      if let jpg = img.jpegData(compressionQuality: 0.85) { try? jpg.write(to: file, options: .atomic) }
      return img
    }
    inflight[t.id] = task
    let img = await task.value
    inflight[t.id] = nil
    if let img {
      memory[t.id] = img
      if memory.count > 40 { memory.removeValue(forKey: memory.keys.first!) }
    } else {
      failed.insert(t.id)
    }
    return img
  }

  func preload(_ tracks: [Track]) {
    for t in tracks where memory[t.id] == nil { Task { _ = await image(t) } }
  }
}
