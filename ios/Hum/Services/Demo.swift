// Demo mode (plan-ios §9): launch with `-demo YES` for a made-up library with
// generated sine-tone WAV files. No network, no sign-in. Used by the Simulator,
// the UI tests and the screenshots. `-demoShort YES` makes every track 4 s long.
import Foundation
import HumCore
import UIKit

enum Demo {
  static var on: Bool { UserDefaults.standard.bool(forKey: "demo") }
  static var short: Bool { UserDefaults.standard.bool(forKey: "demoShort") }

  static let profile = Profile(
    label: "Demo Library", root: "/demo", tracks: "audio", metadata: "meta",
    dimensions: ["time", "colour", "shade"],
    order: ["dawn", "noon", "dusk", "night", "light", "mid", "dark"],
    variant: Variant(dimension: 2, prefer: "mid", fallback: ["light", "dark"]),
    artQuery: nil, defaultFilter: nil)

  // Invented names in the test taxonomy (test/fixtures.ts).
  static let names: [String: [String]] = [
    "dawn/azure": ["Harbour Lights", "Paper Kites", "Quiet Engine", "Long Division", "Salt and Glass", "Northbound"],
    "dawn/crimson": ["Copper Field", "Slow Parade", "Lantern Room"],
    "dawn/jade": ["Morning Ledger", "Tin Roof", "Small Hours"],
    "dawn/indigo": ["Open Water", "Wide Margin", "Low Tide Study"],
    "dawn/grey": ["Signal Path", "Glass Tower", "Cold Start"],
    "noon/ochre": ["River Stones", "Warm Static", "Garden Wall"],
    "noon/grey": ["Soft Circuit", "Satellite Hum"],
    "dusk/azure": ["Still Point", "Deep Current"],
    "night/ochre": ["Oak Shelter", "Late Ember", "Far Shore", "First Snow"],
    "night/azure": ["Cloud Harbour"],
  ]

  static func library() -> Library {
    var tracks: [Track] = []
    var n = 0
    let shades = ["light", "mid", "dark"]
    for folder in names.keys.sorted() {
      let parts = folder.split(separator: "/").map(String.init)
      for name in names[folder]! {
        n += 1
        let id = String(format: "demo%03d", n)
        let slug = name.lowercased().replacingOccurrences(of: " ", with: "-")
        let dims = parts + [shades[n % 3]]
        let seconds: Double = short ? 4 : Double(20 + (n * 7) % 40)
        tracks.append(Track(
          id: id, stem: "\(slug)-\(id)", path: "/demo/audio/\(dims.joined(separator: "/"))/\(slug)-\(id).wav",
          fileName: "\(slug)-\(id).wav", name: name, dims: dims, size: Int(seconds * 32_000) + 44, duration: seconds,
          tags: ["demo"], hasMeta: true))
      }
    }
    return Library(cursor: "demo", syncedAt: ISO8601DateFormatter().string(from: Date()), tracks: tracks)
  }

  // Same value on every launch (hashValue is seeded per process).
  nonisolated static func stableHash(_ s: String) -> Int {
    s.unicodeScalars.reduce(7) { ($0 &* 31 &+ Int($1.value)) & 0xFFFFFF }
  }

  // Mono 16 kHz 16-bit PCM sine, with short fades so boundaries don't click.
  nonisolated static func wav(seconds: Double, hz: Double) -> Data {
    let rate = 16_000
    let count = Int(seconds * Double(rate))
    var pcm = Data(capacity: count * 2)
    for i in 0..<count {
      let fade = min(1, Double(min(i, count - i)) / 800)
      let v = Int16(sin(2 * .pi * hz * Double(i) / Double(rate)) * 6000 * fade)
      withUnsafeBytes(of: v.littleEndian) { pcm.append(contentsOf: $0) }
    }
    var d = Data()
    func u32(_ x: UInt32) { withUnsafeBytes(of: x.littleEndian) { d.append(contentsOf: $0) } }
    func u16(_ x: UInt16) { withUnsafeBytes(of: x.littleEndian) { d.append(contentsOf: $0) } }
    d.append(contentsOf: Array("RIFF".utf8)); u32(UInt32(36 + pcm.count))
    d.append(contentsOf: Array("WAVEfmt ".utf8)); u32(16); u16(1); u16(1); u32(UInt32(rate)); u32(UInt32(rate * 2)); u16(2); u16(16)
    d.append(contentsOf: Array("data".utf8)); u32(UInt32(pcm.count))
    d.append(pcm)
    return d
  }
}

final class DemoSource: TrackSource {
  private let dir = Store.subdir(Store.caches, "demo")

  private func file(_ t: Track) async -> URL {
    let u = dir.appendingPathComponent("\(Int(t.duration))s-\(t.fileName)")  // short and normal demo tracks differ
    if FileManager.default.fileExists(atPath: u.path) { return u }
    let hz = 196 + Double(Demo.stableHash(t.id) % 12) * 22
    let seconds = t.duration
    let data = await Task.detached { Demo.wav(seconds: seconds, hz: hz) }.value
    try? data.write(to: u, options: .atomic)
    return u
  }

  func download(_ t: Track) async throws -> URL {
    let src = await file(t)
    try? await Task.sleep(for: .milliseconds(300))  // looks like a download in the UI
    let tmp = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try FileManager.default.copyItem(at: src, to: tmp)
    return tmp
  }

  func streamURL(_ t: Track) async throws -> URL { await file(t) }

  func art(_ t: Track, size: Int) async -> UIImage? {
    let hue = CGFloat(Demo.stableHash(t.name) % 360) / 360
    let s = CGSize(width: size, height: size)
    return UIGraphicsImageRenderer(size: s).image { ctx in
      let colors = [UIColor(hue: hue, saturation: 0.55, brightness: 0.55, alpha: 1).cgColor,
                    UIColor(hue: hue + 0.08, saturation: 0.7, brightness: 0.18, alpha: 1).cgColor]
      let g = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(), colors: colors as CFArray, locations: [0, 1])!
      ctx.cgContext.drawLinearGradient(g, start: .zero, end: CGPoint(x: s.width, y: s.height), options: [])
    }
  }
}
