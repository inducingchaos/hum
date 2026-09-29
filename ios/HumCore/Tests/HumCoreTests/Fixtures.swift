import Foundation
@testable import HumCore

// Same made-up taxonomy as test/fixtures.ts.
nonisolated(unsafe) var fixtureCounter = 0

func track(_ dims: [String], name: String? = nil, id: String? = nil, duration: Double = 1800, tags: [String] = []) -> Track {
  fixtureCounter += 1
  let tid = id ?? String(format: "%04d", fixtureCounter)
  return Track(
    id: tid, stem: "x-\(tid)", path: "/x/\(dims.joined(separator: "/"))/x-\(tid).mp3", fileName: "x-\(tid).mp3",
    name: name ?? "Song \(tid)", dims: dims, size: 1000, duration: duration, tags: tags, hasMeta: true)
}

struct Cases: Decodable {
  struct Lib: Decodable {
    let folders: [String: [String]]
    let levels: [String]
  }
  struct FilterCase: Decodable {
    let query: String
    let folders: [String]
  }
  struct CountCase: Decodable {
    let query: String
    let count: Int
  }
  struct ResolveCase: Decodable {
    let term: String
    let kind: String
    let matches: [String]
  }
  struct CompleteCase: Decodable {
    let `in`: String
    let out: String
  }
  struct SearchTrack: Decodable {
    let name: String
    let tags: [String]
  }
  struct SearchCase: Decodable {
    let query: String
    let names: [String]
  }
  struct Search: Decodable {
    let tracks: [SearchTrack]
    let cases: [SearchCase]
  }
  struct NormCase: Decodable {
    let stem: String
    let id: String
    let name: String
  }
  struct TimeCase: Decodable {
    let sec: Double
    let out: String
  }
  let library: Lib
  let filter: [FilterCase]
  let counts: [CountCase]
  let resolve: [ResolveCase]
  let complete: [CompleteCase]
  let search: Search
  let normalize: [NormCase]
  let time: [TimeCase]

  // test/cases/core-cases.json at the repo root, found from this source file.
  static func load() throws -> Cases {
    var url = URL(fileURLWithPath: #filePath)
    for _ in 0..<5 { url.deleteLastPathComponent() }  // Tests/HumCoreTests/Fixtures.swift → ios/HumCore → ios → repo
    let data = try Data(contentsOf: url.appendingPathComponent("test/cases/core-cases.json"))
    return try JSONDecoder().decode(Cases.self, from: data)
  }

  func makeLibrary() -> [Track] {
    library.folders.keys.sorted().flatMap { a in
      library.folders[a]!.flatMap { b in library.levels.flatMap { c in [track([a, b, c]), track([a, b, c])] } }
    }
  }
}
