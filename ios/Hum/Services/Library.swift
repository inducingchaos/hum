// Library index on the phone (plan-ios §4, same as the PWA's library.ts).
// Phase 1: one recursive listing (names from file names; enough to play).
// Phase 2: one download_zip of the metadata folder. Later launches: the saved
// library loads at once and a cursor delta runs in the background.
import Foundation
import HumCore

final class LibrarySync {
  let dropbox: Dropbox
  let profile: Profile

  init(dropbox: Dropbox, profile: Profile) {
    self.dropbox = dropbox
    self.profile = profile
  }

  static func load() async -> Library? {
    await Task.detached(priority: .userInitiated) {
      guard let lib = Store.read(Library.self, "library.json"), lib.version == Library.currentVersion else { return nil }
      return lib
    }.value
  }

  static func save(_ lib: Library) {
    Task.detached(priority: .utility) { Store.write(lib, "library.json") }
  }

  static func needsMetadata(_ lib: Library) -> Bool {
    lib.tracks.filter { !$0.hasMeta }.count * 2 > lib.tracks.count
  }

  private var tracksPrefix: String { profile.tracksDir.lowercased() + "/" }
  private var metaPrefix: String { profile.metadataDir.lowercased() + "/" }

  private func isAudio(_ e: ListEntry) -> Bool {
    e.tag == "file" && e.pathLower.hasPrefix(tracksPrefix) && e.name.lowercased().hasSuffix(".mp3")
  }

  private func isMeta(_ e: ListEntry) -> Bool {
    e.tag == "file" && e.pathLower.hasPrefix(metaPrefix) && e.name.lowercased().hasSuffix(".json")
  }

  private static func file(_ e: ListEntry) -> FileEntry { FileEntry(pathLower: e.pathLower, name: e.name, size: e.size ?? 0) }

  // Parsing runs off the main actor: thousands of small JSON files.
  nonisolated static func build(_ files: [FileEntry], metas: [String: Data], profile: Profile) -> [Track] {
    files.compactMap { f in
      let data = metas[stemOf(f.name).lowercased()]
      let meta = data.flatMap { (try? JSONSerialization.jsonObject(with: $0)) as? [String: Any] }
      return toTrack(f, meta, tracksDir: profile.tracksDir, depth: profile.dimensions.count)
    }
  }

  nonisolated static func metasFromZip(_ zip: Data) -> [String: Data] {
    var out: [String: Data] = [:]
    for (name, data) in (try? Zip.entries(zip)) ?? [] {
      let base = (name as NSString).lastPathComponent
      guard base.lowercased().hasSuffix(".json") else { continue }
      out[stemOf(base).lowercased()] = data
    }
    return out
  }

  func listTracks(progress: @escaping (String) -> Void) async throws -> Library {
    let t0 = Date()
    let (entries, cursor) = try await dropbox.listAll(path: profile.root) { n in progress("LISTING \(n.formatted()) FILES") }
    let files = entries.filter(isAudio).map(Self.file)
    let p = profile
    let tracks = await Task.detached { Self.build(files, metas: [:], profile: p) }.value
    let lib = Library(cursor: cursor, syncedAt: ISO8601DateFormatter().string(from: Date()), tracks: tracks)
    Self.save(lib)
    log("listing: \(tracks.count) tracks in \(Int(Date().timeIntervalSince(t0) * 1000)) ms")
    return lib
  }

  func fillMetadata(_ lib: Library, progress: @escaping (String) -> Void) async throws -> Library {
    let t0 = Date()
    var metas: [String: Data] = [:]
    do {
      progress("ZIPPING METADATA")
      let zip = try await dropbox.downloadZip(profile.metadataDir)
      progress("READING METADATA")
      metas = await Task.detached { Self.metasFromZip(zip) }.value
      log("metadata zip: \(metas.count) files in \(Int(Date().timeIntervalSince(t0) * 1000)) ms")
    } catch {
      log("metadata zip failed, falling back to single files: \(error)")
    }
    let files = lib.tracks.map { FileEntry(pathLower: $0.path, name: $0.fileName, size: $0.size) }
    if metas.count * 2 < files.count {
      metas = try await fetchMetas(files.map { stemOf($0.name) }) { d in progress("METADATA \(d.formatted()) / \(files.count.formatted())") }
    }
    let p = profile
    let m = metas
    let tracks = await Task.detached { Self.build(files, metas: m, profile: p) }.value
    let full = Library(cursor: lib.cursor, syncedAt: ISO8601DateFormatter().string(from: Date()), tracks: tracks)
    Self.save(full)
    log("metadata: \(tracks.filter(\.hasMeta).count) / \(tracks.count) in \(Int(Date().timeIntervalSince(t0) * 1000)) ms")
    return full
  }

  // Metadata one file at a time, 12 in flight (the fallback when the zip fails).
  private func fetchMetas(_ stems: [String], progress: ((Int) -> Void)? = nil) async throws -> [String: Data] {
    var out: [String: Data] = [:]
    let dropbox = self.dropbox
    let dir = profile.metadataDir
    for start in stride(from: 0, to: stems.count, by: 12) {
      let chunk = Array(stems[start..<min(start + 12, stems.count)])
      // Plain tasks: a task group here trips the region-isolation checker (Xcode 26.6).
      let tasks = chunk.map { stem in Task { (stem, try? await dropbox.downloadData("\(dir)/\(stem).json")) } }
      for t in tasks {
        let (stem, data) = await t.value
        if let data { out[stem.lowercased()] = data }
      }
      progress?(min(start + 12, stems.count))
    }
    return out
  }

  // Changes since the saved cursor; nil when nothing changed.
  func deltaSync(_ lib: Library) async throws -> Library? {
    let res: (entries: [ListEntry], cursor: String)
    do {
      res = try await dropbox.listAll(cursor: lib.cursor)
    } catch DropboxError.http(_, 409, _) {
      return try await fillMetadata(try await listTracks { _ in }) { _ in }  // cursor reset
    }
    var byPath = Dictionary(lib.tracks.map { ($0.path, $0) }, uniquingKeysWith: { a, _ in a })
    var changed: [String: FileEntry] = [:]
    var refresh = Set<String>()
    for e in res.entries {
      if e.tag == "deleted" {
        for p in byPath.keys where p == e.pathLower || p.hasPrefix(e.pathLower + "/") { byPath[p] = nil }
      } else if isAudio(e) {
        changed[e.pathLower] = Self.file(e)
      } else if isMeta(e) {
        refresh.insert(stemOf(e.name).lowercased())
      }
    }
    for t in byPath.values where !t.hasMeta || refresh.contains(t.stem.lowercased()) {
      changed[t.path] = FileEntry(pathLower: t.path, name: t.fileName, size: t.size)
    }
    let nothing = changed.isEmpty && byPath.count == lib.tracks.count
    if nothing && res.cursor == lib.cursor { return nil }
    let files = Array(changed.values)
    let metas = try await fetchMetas(files.map { stemOf($0.name) })
    let p = profile
    for t in await Task.detached(operation: { Self.build(files, metas: metas, profile: p) }).value { byPath[t.path] = t }
    let next = Library(cursor: res.cursor, syncedAt: ISO8601DateFormatter().string(from: Date()), tracks: Array(byPath.values))
    Self.save(next)
    log("delta sync: \(changed.count) changed, \(next.tracks.count) tracks")
    return nothing ? nil : next
  }
}
