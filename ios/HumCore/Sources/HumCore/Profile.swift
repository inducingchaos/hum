// The library profile (docs/profile.md): everything specific to one library,
// kept out of git. Port of packages/core/src/profile.ts.
import Foundation

public struct Variant: Codable, Equatable, Sendable {
  public var dimension: Int
  public var prefer: String
  public var fallback: [String]?

  public init(dimension: Int, prefer: String, fallback: [String]? = nil) {
    self.dimension = dimension
    self.prefer = prefer
    self.fallback = fallback
  }
}

public struct Profile: Codable, Equatable, Sendable {
  public var label: String
  public var root: String
  public var tracks: String
  public var metadata: String
  public var dimensions: [String]
  public var order: [String]?
  public var variant: Variant?
  public var artQuery: String?
  public var defaultFilter: String?

  public init(
    label: String, root: String, tracks: String, metadata: String, dimensions: [String], order: [String]? = nil,
    variant: Variant? = nil, artQuery: String? = nil, defaultFilter: String? = nil
  ) {
    self.label = label
    self.root = root
    self.tracks = tracks
    self.metadata = metadata
    self.dimensions = dimensions
    self.order = order
    self.variant = variant
    self.artQuery = artQuery
    self.defaultFilter = defaultFilter
  }

  public var tracksDir: String { Self.join(root, tracks) }
  public var metadataDir: String { Self.join(root, metadata) }

  static func join(_ a: String, _ b: String) -> String {
    var a = a
    while a.hasSuffix("/") { a.removeLast() }
    var b = Substring(b)
    while b.hasPrefix("/") { b.removeFirst() }
    return "\(a)/\(b)"
  }

  // Profile order first, then alphabetical.
  public func valueOrder(_ a: String, _ b: String) -> Bool {
    let order = self.order ?? []
    let ra = order.firstIndex(of: a) ?? order.count
    let rb = order.firstIndex(of: b) ?? order.count
    return ra != rb ? ra < rb : a < b
  }
}

public struct ProfileError: Error, CustomStringConvertible, Sendable {
  public let description: String
}

// PKCE app key: public by design (no secret).
public let appKey = "49yjxi7h52fcwsy"

extension Profile {
  // Validates JSON the same way parseProfile does in TS. Throws a readable message.
  public static func parse(_ data: Data) throws -> Profile {
    guard let obj = try? JSONSerialization.jsonObject(with: data), let o = obj as? [String: Any] else {
      throw ProfileError(description: "profile: not valid JSON")
    }
    func str(_ k: String) throws -> String {
      guard let s = (o[k] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines), !s.isEmpty else {
        throw ProfileError(description: "profile: \"\(k)\" must be a non-empty string")
      }
      return s
    }
    func strs(_ k: String, required: Bool) throws -> [String]? {
      guard let v = o[k] else {
        if required { throw ProfileError(description: "profile: \"\(k)\" must be a list of strings") }
        return nil
      }
      guard let a = v as? [String] else { throw ProfileError(description: "profile: \"\(k)\" must be a list of strings") }
      return a.map { $0.lowercased() }
    }
    var root = try str("root")
    guard root.hasPrefix("/") else { throw ProfileError(description: "profile: \"root\" must start with /") }
    while root.hasSuffix("/") { root.removeLast() }
    let dimensions = try strs("dimensions", required: true)!
    var variant: Variant?
    if let v = o["variant"] {
      guard let v = v as? [String: Any], let dim = v["dimension"] as? Int, dim >= 0, dim < dimensions.count,
        let prefer = v["prefer"] as? String
      else {
        throw ProfileError(description: "profile: \"variant\" needs a dimension index (0–\(dimensions.count - 1)) and a \"prefer\" value")
      }
      var fallback: [String]?
      if let f = v["fallback"] {
        guard let f = f as? [String] else { throw ProfileError(description: "profile: \"variant.fallback\" must be a list of strings") }
        fallback = f.map { $0.lowercased() }
      }
      variant = Variant(dimension: dim, prefer: prefer.lowercased(), fallback: fallback)
    }
    let label = (o["label"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
    return Profile(
      label: label?.isEmpty == false ? label! : "hum",
      root: root.lowercased(),
      tracks: try str("tracks"),
      metadata: try str("metadata"),
      dimensions: dimensions,
      order: try strs("order", required: false),
      variant: variant,
      artQuery: o["artQuery"] as? String,
      defaultFilter: o["defaultFilter"] as? String
    )
  }
}
