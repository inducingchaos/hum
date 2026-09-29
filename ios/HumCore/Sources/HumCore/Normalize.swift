// Dropbox file entry + metadata JSON → Track. Port of packages/core/src/normalize.ts.
import Foundation

public struct FileEntry: Codable, Hashable, Sendable {
  public var pathLower: String
  public var name: String
  public var size: Int

  public init(pathLower: String, name: String, size: Int) {
    self.pathLower = pathLower
    self.name = name
    self.size = size
  }
}

public typealias RawMeta = [String: Any]

public func cleanList(_ xs: Any?) -> [String] {
  guard let xs = xs as? [Any] else { return [] }
  var out: [String] = []
  for x in xs {
    for part in String(describing: x).split(separator: ",", omittingEmptySubsequences: false) {
      let p = part.trimmingCharacters(in: .whitespaces)
      if !p.isEmpty, !out.contains(p) { out.append(p) }
    }
  }
  return out
}

public func stemOf(_ fileName: String) -> String {
  let lower = fileName.lowercased()
  for ext in [".mp3", ".json"] where lower.hasSuffix(ext) { return String(fileName.dropLast(ext.count)) }
  return fileName
}

public func idOf(_ stem: String) -> String {
  guard let i = stem.lastIndex(of: "-") else { return stem }
  return String(stem[stem.index(after: i)...])
}

public func nameFromStem(_ stem: String) -> String {
  let slug: Substring = stem.lastIndex(of: "-").map { stem[..<$0] }.flatMap { $0.isEmpty ? nil : $0 } ?? Substring(stem)
  return slug.split(separator: "-").map { $0.prefix(1).uppercased() + $0.dropFirst() }.joined(separator: " ")
}

public func segmentsOf(_ pathLower: String, tracksDir: String, depth: Int? = nil) -> [String]? {
  var dir = tracksDir.lowercased()
  while dir.hasSuffix("/") { dir.removeLast() }
  let prefix = dir + "/"
  guard pathLower.hasPrefix(prefix) else { return nil }
  var parts = pathLower.dropFirst(prefix.count).split(separator: "/", omittingEmptySubsequences: false).map(String.init)
  parts.removeLast()
  if let depth, parts.count != depth { return nil }
  return parts
}

// Every list of strings in the metadata, as search tags (keys in sorted order,
// so the result doesn't depend on dictionary order).
public func tagsOf(_ m: RawMeta?) -> [String] {
  guard let m else { return [] }
  var out: [String] = []
  for k in m.keys.sorted() {
    guard let a = m[k] as? [Any], !a.isEmpty, a.allSatisfy({ $0 is String }) else { continue }
    for s in cleanList(a) where !out.contains(s) { out.append(s) }
  }
  return out
}

func firstString(_ m: RawMeta?, _ keys: [String]) -> String? {
  for k in keys {
    if let s = (m?[k] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines), !s.isEmpty { return s }
  }
  return nil
}

func number(_ x: Any?) -> Double? {
  if let n = x as? NSNumber, !(x is Bool) { return n.doubleValue }
  if let d = x as? Double { return d }
  if let i = x as? Int { return Double(i) }
  return nil
}

public func toTrack(_ file: FileEntry, _ meta: RawMeta?, tracksDir: String, depth: Int? = nil) -> Track? {
  guard let dims = segmentsOf(file.pathLower, tracksDir: tracksDir, depth: depth) else { return nil }
  let stem = stemOf(file.name)
  let bpm = number(meta?["bpm"]).flatMap { $0 > 1 ? $0 : nil }
  let image = firstString(meta, ["imageUrl", "image", "artwork", "cover"])
  return Track(
    id: idOf(stem),
    stem: stem,
    path: file.pathLower,
    fileName: file.name,
    name: firstString(meta, ["name", "title"]) ?? nameFromStem(stem),
    dims: dims,
    size: file.size,
    duration: number(meta?["duration"]) ?? 0,
    tags: tagsOf(meta),
    bpm: bpm,
    image: image?.hasPrefix("https://") == true ? image : nil,
    hasMeta: meta != nil
  )
}
