// Track + library model and dedupe. Port of packages/core/src/model.ts.
import Foundation

public struct Track: Codable, Hashable, Identifiable, Sendable {
  public var id: String
  public var stem: String
  public var path: String
  public var fileName: String
  public var name: String
  public var dims: [String]
  public var size: Int
  public var duration: Double
  public var tags: [String]
  public var bpm: Double?
  public var image: String?
  public var hasMeta: Bool

  public init(
    id: String, stem: String, path: String, fileName: String, name: String, dims: [String], size: Int,
    duration: Double, tags: [String] = [], bpm: Double? = nil, image: String? = nil, hasMeta: Bool
  ) {
    self.id = id
    self.stem = stem
    self.path = path
    self.fileName = fileName
    self.name = name
    self.dims = dims
    self.size = size
    self.duration = duration
    self.tags = tags
    self.bpm = bpm
    self.image = image
    self.hasMeta = hasMeta
  }

  public var folder: String { dims.joined(separator: "/") }
  public var album: String { dims.joined(separator: " / ") }
  // Length variants share this key.
  public var songKey: String { "\(folder)/\(name.lowercased())" }

  // Every version of a song shares this key (the variant level is skipped).
  public func groupKey(variantDim: Int?) -> String {
    var parts = dims.enumerated().filter { $0.offset != variantDim }.map(\.element)
    parts.append(name.lowercased())
    return parts.joined(separator: "/")
  }
}

public struct Library: Codable, Sendable {
  public static let currentVersion = 3
  public var version: Int
  public var cursor: String
  public var syncedAt: String
  public var tracks: [Track]

  public init(cursor: String, syncedAt: String, tracks: [Track]) {
    self.version = Self.currentVersion
    self.cursor = cursor
    self.syncedAt = syncedAt
    self.tracks = tracks
  }
}

// One track per song (length variants), keeping the longest; ties go to the smaller id.
public func dedupe(_ tracks: [Track]) -> [Track] {
  var best: [String: Track] = [:]
  var order: [String] = []
  for t in tracks {
    let k = t.songKey
    if let cur = best[k] {
      if t.duration > cur.duration || (t.duration == cur.duration && t.id < cur.id) { best[k] = t }
    } else {
      best[k] = t
      order.append(k)
    }
  }
  return order.map { best[$0]! }
}

// One version per song across the variant level. Keeps input order.
public func dedupeVariants(_ tracks: [Track], _ v: Variant?, favored: ((Track) -> Bool)? = nil) -> [Track] {
  guard let v else { return tracks }
  let fb = v.fallback ?? []
  func rank(_ t: Track) -> Int {
    if favored?(t) == true { return 0 }
    let val = v.dimension < t.dims.count ? t.dims[v.dimension] : ""
    if val == v.prefer { return 1 }
    if let i = fb.firstIndex(of: val) { return 2 + i }
    return 2 + fb.count
  }
  var best: [String: Track] = [:]
  for t in tracks {
    let k = t.groupKey(variantDim: v.dimension)
    if let cur = best[k], rank(t) >= rank(cur) { continue }
    best[k] = t
  }
  let keep = Set(best.values.map(\.id))
  return tracks.filter { keep.contains($0.id) }
}

// Folder by folder, then name, then length.
public func pathOrder(_ a: Track, _ b: Track) -> Bool {
  let n = max(a.dims.count, b.dims.count)
  for i in 0..<n {
    let x = i < a.dims.count ? a.dims[i] : ""
    let y = i < b.dims.count ? b.dims[i] : ""
    if x != y { return localeLess(x, y) }
  }
  if a.name != b.name { return localeLess(a.name, b.name) }
  return a.duration < b.duration
}

// Close to JS localeCompare for the ASCII names we have: case-insensitive first.
func localeLess(_ a: String, _ b: String) -> Bool {
  let c = a.compare(b, options: [.caseInsensitive])
  if c != .orderedSame { return c == .orderedAscending }
  return a < b
}
