import Foundation
import Testing
@testable import HumCore

@Suite struct SharedCases {
  let cases: Cases
  let lib: [Track]
  let vocab: [String]

  init() throws {
    cases = try Cases.load()
    lib = cases.makeLibrary()
    vocab = vocabulary(lib)
  }

  func folders(_ q: String) -> [String] {
    Array(Set(applyFilter(lib, parseFilter(q, vocab)).map(\.folder))).sorted()
  }

  @Test func filterFolders() {
    for c in cases.filter { #expect(folders(c.query) == c.folders, "\(c.query)") }
  }

  @Test func filterCounts() {
    for c in cases.counts { #expect(applyFilter(lib, parseFilter(c.query, vocab)).count == c.count, "\(c.query)") }
  }

  @Test func resolve() {
    for c in cases.resolve {
      let r = resolveTerm(c.term, vocab)
      #expect(r.kind.rawValue == c.kind && r.matches == c.matches, "\(c.term): \(r)")
    }
  }

  @Test func completion() {
    for c in cases.complete { #expect(complete(c.in, vocab) == c.out, "\(c.in)") }
  }

  @Test func searchRanking() {
    let ts = cases.search.tracks.map { track(["dawn", "jade", "light"], name: $0.name, tags: $0.tags) }
    for c in cases.search.cases { #expect(search(ts, c.query).map(\.name) == c.names, "\(c.query)") }
  }

  @Test func normalizeAndTime() {
    for c in cases.normalize { #expect(idOf(c.stem) == c.id && nameFromStem(c.stem) == c.name, "\(c.stem)") }
    for c in cases.time { #expect(fmtTime(c.sec) == c.out) }
  }
}

@Suite struct Normalize {
  let tracksDir = "/lib/audio"

  @Test func lists() {
    #expect(cleanList(["Soft, Warm", "Warm", " Deep "]) == ["Soft", "Warm", "Deep"])
    #expect(cleanList(nil) == [])
  }

  @Test func segments() {
    #expect(segmentsOf("/lib/audio/dawn/jade/dark/x-1.mp3", tracksDir: tracksDir, depth: 3) == ["dawn", "jade", "dark"])
    #expect(segmentsOf("/lib/audio/dawn/x.mp3", tracksDir: tracksDir, depth: 3) == nil)
    #expect(segmentsOf("/lib/audio/dawn/x.mp3", tracksDir: tracksDir) == ["dawn"])
    #expect(segmentsOf("/elsewhere/dawn/jade/dark/x.mp3", tracksDir: tracksDir, depth: 3) == nil)
  }

  @Test func tracks() throws {
    let file = FileEntry(pathLower: "/lib/audio/noon/ochre/light/still-water-abc.mp3", name: "still-water-abc.mp3", size: 5)
    #expect(toTrack(file, ["name": "Still Water", "bpm": 1], tracksDir: tracksDir, depth: 3)?.bpm == nil)
    #expect(toTrack(file, ["name": "Still Water", "bpm": 90], tracksDir: tracksDir, depth: 3)?.bpm == 90)
    let bare = try #require(toTrack(file, nil, tracksDir: tracksDir, depth: 3))
    #expect(bare.name == "Still Water" && !bare.hasMeta && bare.id == "abc" && bare.dims[0] == "noon")
    let json = #"{"title":"Still Water","a":["x","y, z"],"b":["x"],"c":[1,2],"image":"https://img/1","duration":1800}"#
    let meta = try JSONSerialization.jsonObject(with: Data(json.utf8)) as! [String: Any]
    let rich = try #require(toTrack(file, meta, tracksDir: tracksDir, depth: 3))
    #expect(rich.name == "Still Water" && rich.tags == ["x", "y", "z"] && rich.image == "https://img/1" && rich.duration == 1800)
  }
}

@Suite struct ProfileTests {
  let base = #"{"root":"/Lib/","tracks":"audio","metadata":"meta","dimensions":["A","b","c"]"#

  @Test func valid() throws {
    let p = try Profile.parse(Data((base + #","variant":{"dimension":2,"prefer":"Mid"}}"#).utf8))
    #expect(p.root == "/lib" && p.dimensions == ["a", "b", "c"] && p.variant == Variant(dimension: 2, prefer: "mid"))
    #expect(p.label == "hum" && p.tracksDir == "/lib/audio" && p.metadataDir == "/lib/meta")
  }

  @Test func invalid() {
    #expect(throws: ProfileError.self) { try Profile.parse(Data((base.replacingOccurrences(of: "/Lib/", with: "lib") + "}").utf8)) }
    #expect(throws: ProfileError.self) { try Profile.parse(Data((base + #","variant":{"dimension":5,"prefer":"x"}}"#).utf8)) }
    #expect(throws: ProfileError.self) { try Profile.parse(Data("nope".utf8)) }
  }

  @Test func order() throws {
    let p = try Profile.parse(Data((base + #","order":["z","y"]}"#).utf8))
    #expect(["b", "z", "a", "y"].sorted(by: p.valueOrder) == ["z", "y", "a", "b"])
  }

  @Test func art() {
    let u = artURL("https://img.example/photo-1?a=1&w=500", query: "w={size}&h={size}&fit=crop")!
    let q = URLComponents(url: u, resolvingAgainstBaseURL: false)!.queryItems!
    #expect(q.first { $0.name == "w" }?.value == "600" && q.first { $0.name == "a" }?.value == "1" && q.count == 4)
    #expect(artURL("https://img.example/p", query: nil)?.absoluteString == "https://img.example/p")
  }
}

@Suite struct Dedupe {
  @Test func lengths() {
    let a = track(["fog", "ochre", "light"], name: "Lamp", duration: 900)
    let b = track(["fog", "ochre", "light"], name: "Lamp", duration: 3600)
    let c = track(["fog", "ochre", "dark"], name: "Lamp", duration: 900)
    let out = dedupe([a, b, c])
    #expect(out.count == 2 && out.contains(b) && out.contains(c))
  }

  @Test func variants() {
    let v = Variant(dimension: 2, prefer: "mid", fallback: ["dark", "light"])
    let hi = track(["fog", "ochre", "dark"], name: "Lamp", id: "h")
    let med = track(["fog", "ochre", "mid"], name: "Lamp", id: "m")
    let lo = track(["fog", "ochre", "light"], name: "Lamp", id: "l")
    let bell = track(["fog", "ochre", "dark"], name: "Bell")
    #expect(dedupeVariants([hi, bell, med, lo], v) == [bell, med])
    #expect(dedupeVariants([hi, bell, med, lo], Variant(dimension: 2, prefer: "light", fallback: ["dark"])) == [bell, lo])
    #expect(dedupeVariants([hi, lo], v) == [hi])
    #expect(dedupeVariants([hi, med, lo], v, favored: { $0 == lo }) == [lo])
    #expect(dedupeVariants([hi, med, lo], nil) == [hi, med, lo])
    #expect(hi.groupKey(variantDim: 2) == "fog/ochre/lamp" && hi.groupKey(variantDim: nil) == "fog/ochre/dark/lamp")
  }

  @Test func order() {
    let a = track(["b", "x"], name: "Z")
    let b = track(["a", "y"], name: "A")
    let c = track(["a", "y"], name: "b")
    #expect([a, c, b].sorted(by: pathOrder).map(\.name) == ["A", "b", "Z"])
  }
}

@Suite struct QueueTests {
  // Deterministic "shuffle": reverse.
  func q(_ order: [String], cursor: Int = 0, shuffle: Bool = false, repeat r: Repeat = .off) -> Queue {
    Queue(QueueSnapshot(order: order, cursor: cursor, shuffle: shuffle, repeat: r), rng: { $0.reversed() })
  }

  @Test func advanceAndBack() {
    var x = q(["a", "b", "c"])
    #expect(x.advance(auto: false) == "b" && x.advance(auto: false) == "c" && x.advance(auto: false) == nil)
    #expect(x.back() == "b")
    x.cycleRepeat()  // all
    #expect(x.repeat == .all)
    x.jumpTo(2)
    #expect(x.advance(auto: false) == "a" && x.cursor == 0)
  }

  @Test func repeatOne() {
    var x = q(["a", "b"], repeat: .one)
    #expect(x.autoNext() == "a" && x.advance(auto: true) == "a" && x.advance(auto: false) == "b")
  }

  @Test func upcomingWrapsUnderRepeatAll() {
    var x = q(["a", "b", "c"], cursor: 2, shuffle: true, repeat: .all)
    // next pass = reverse of order = c,b,a; c == current, so it swaps with the last: a,b,c
    #expect(x.upcoming(2) == ["a", "b"])
    #expect(x.advance(auto: true) == "a" && x.order == ["a", "b", "c"])
  }

  @Test func setPoolAndShuffle() {
    var x = q([])
    x.setPool(["a", "b", "c"], startId: "b")
    #expect(x.current == "b" && x.cursor == 1)
    x.setShuffle(true, pool: ["a", "b", "c"])
    #expect(x.order == ["b", "c", "a"] && x.cursor == 0)
    x.setShuffle(false, pool: ["a", "b", "c"])
    #expect(x.order == ["a", "b", "c"] && x.current == "b")
  }

  @Test func playNowAndRetain() {
    var x = q(["a", "b", "c", "d"], cursor: 1)
    x.playNow("d")
    #expect(x.order == ["a", "b", "d", "c"] && x.current == "d")
    x.playNow("a")
    #expect(x.order == ["b", "d", "a", "c"] && x.current == "a")
    x.retain(["a", "c"])
    #expect(x.order == ["a", "c"] && x.current == "a")
    var e = q([])
    e.playNow("z")
    #expect(e.order == ["z"] && e.current == "z")
  }
}

@Suite struct FormatTests {
  @Test func basics() {
    #expect(plural(1, "song") == "1 song" && plural(2345, "song") == "2,345 songs")
    #expect(fmtBytes(1_500_000_000) == "1.5 GB" && fmtBytes(24_000_000) == "24 MB" && fmtBytes(5000) == "5 KB")
  }
}
