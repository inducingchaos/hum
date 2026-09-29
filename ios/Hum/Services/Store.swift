// Files on the device (plan-ios §4). Application Support holds what matters
// (library, state, profile, log); Caches holds what can be re-downloaded.
import Foundation

nonisolated enum Store {
  static let support: URL = dir(.applicationSupportDirectory)
  static let caches: URL = dir(.cachesDirectory)

  private static func dir(_ d: FileManager.SearchPathDirectory) -> URL {
    let base = FileManager.default.urls(for: d, in: .userDomainMask)[0].appendingPathComponent("hum", isDirectory: true)
    try? FileManager.default.createDirectory(at: base, withIntermediateDirectories: true)
    return base
  }

  static func subdir(_ base: URL, _ name: String) -> URL {
    let u = base.appendingPathComponent(name, isDirectory: true)
    try? FileManager.default.createDirectory(at: u, withIntermediateDirectories: true)
    return u
  }

  static func read<T: Decodable>(_ type: T.Type, _ name: String, in base: URL = support) -> T? {
    guard let data = try? Data(contentsOf: base.appendingPathComponent(name)) else { return nil }
    return try? JSONDecoder().decode(T.self, from: data)
  }

  static func write<T: Encodable>(_ value: T, _ name: String, in base: URL = support) {
    guard let data = try? JSONEncoder().encode(value) else { return }
    try? data.write(to: base.appendingPathComponent(name), options: .atomic)
  }

  static func delete(_ name: String, in base: URL = support) {
    try? FileManager.default.removeItem(at: base.appendingPathComponent(name))
  }

  // Everything this app wrote (sign out).
  static func wipe() {
    for base in [support, caches] {
      for u in (try? FileManager.default.contentsOfDirectory(at: base, includingPropertiesForKeys: nil)) ?? [] {
        try? FileManager.default.removeItem(at: u)
      }
    }
  }
}
