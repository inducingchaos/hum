// Unit tests on the Simulator (plan-ios §11): zip reader, player model with a
// fake engine, Dropbox arg escaping.
import Foundation
import HumCore
import Testing
import UIKit

@testable import Hum

@Suite struct ZipTests {
  // Made by Python's zipfile: a folder entry, a deflated JSON, a stored JSON, a deflated .txt.
  static let sample = Data(base64Encoded: "UEsDBBQAAAAAAAAAIQAAAAAAAAAAAAAAAAAFAAAAbWV0YS9QSwMEFAAAAAgAiQo9XVNRjghBAAAARQAAABoAAABtZXRhL3F1aWV0LWhhcmJvdXItMDEuanNvbqtWykvMTVWyUlAKLM1MLVHwSCxKyi8tUtJRUEopLUosyczPA0oaWhgYAEVKEtOLgbxopeTEnFyQkuKc/HKl2FoAUEsDBBQAAAAAAIkKPV2oSMexEQAAABEAAAATAAAAbWV0YS9zdG9yZWQtMDIuanNvbnsibmFtZSI6IlN0b3JlZCJ9UEsDBBQAAAAIAIkKPV1RzrIKCAAAAPQBAAAPAAAAbWV0YS9yZWFkbWUudHh0q6gYBSMNAABQSwECFAMUAAAAAAAAACEAAAAAAAAAAAAAAAAABQAAAAAAAAAAAAAAgAEAAAAAbWV0YS9QSwECFAMUAAAACACJCj1dU1GOCEEAAABFAAAAGgAAAAAAAAAAAAAAgAEjAAAAbWV0YS9xdWlldC1oYXJib3VyLTAxLmpzb25QSwECFAMUAAAAAACJCj1dqEjHsREAAAARAAAAEwAAAAAAAAAAAAAAgAGcAAAAbWV0YS9zdG9yZWQtMDIuanNvblBLAQIUAxQAAAAIAIkKPV1RzrIKCAAAAPQBAAAPAAAAAAAAAAAAAACAAd4AAABtZXRhL3JlYWRtZS50eHRQSwUGAAAAAAQABAD5AAAAEwEAAAAA")!

  @Test func readsStoredAndDeflated() throws {
    let entries = try Zip.entries(Self.sample)
    #expect(entries.map(\.name) == ["meta/quiet-harbour-01.json", "meta/stored-02.json", "meta/readme.txt"])
    let json = try JSONSerialization.jsonObject(with: entries[0].data) as? [String: Any]
    #expect(json?["name"] as? String == "Quiet Harbour")
    #expect(String(decoding: entries[1].data, as: UTF8.self) == #"{"name":"Stored"}"#)
    #expect(entries[2].data.count == 500)
  }

  @Test func metadataByStem() {
    let m = LibrarySync.metasFromZip(Self.sample)
    #expect(Set(m.keys) == ["quiet-harbour-01", "stored-02"])
  }

  @Test func garbageThrows() {
    #expect(throws: Zip.Failure.self) { try Zip.entries(Data("not a zip".utf8)) }
  }
}

@Suite struct DropboxTests {
  @Test func apiArgIsAscii() {
    #expect(Dropbox.apiArg("/a/café") == #"{"path":"/a/caf\u00e9"}"#)
  }

  @Test func pkceChallengeIsURLSafe() {
    let p = PKCE.make(redirect: true)
    #expect(!p.challenge.contains("+") && !p.challenge.contains("/") && !p.challenge.contains("="))
    #expect(p.verifier.count >= 43)
  }
}

// ── Player model with a fake engine ──

final class FakeEngine: AudioEngine {
  var onBoundary: ((String) -> Void)?
  var onEnded: (() -> Void)?
  var onState: ((Bool, Bool) -> Void)?
  var onTime: ((Double) -> Void)?
  var onFailed: ((String, String) -> Void)?
  var position: Double = 0
  var itemDuration: Double = 0
  var paused = true
  var currentId: String?
  var nextId: String?
  var loads: [String] = []

  func load(_ id: String, url: URL, at: Double, autoplay: Bool) {
    loads.append(id)
    currentId = id
    nextId = nil
    position = at
    autoplay ? play() : pause()
  }

  func setNext(_ id: String?, url: URL?) { nextId = id }
  func play() {
    paused = false
    onState?(true, false)
  }
  func pause() {
    paused = true
    onState?(false, false)
  }
  func seek(_ sec: Double) { position = sec }

  // The current track ends by itself.
  func finish() {
    if let n = nextId {
      currentId = n
      nextId = nil
      onBoundary?(n)
    } else {
      onEnded?()
    }
  }
}

final class FakeSource: TrackSource {
  func download(_ t: Track) async throws -> URL {
    let u = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try Data("x".utf8).write(to: u)
    return u
  }
  func streamURL(_ t: Track) async throws -> URL { URL(fileURLWithPath: "/dev/null") }
  func art(_ t: Track, size: Int) async -> UIImage? { nil }
}

@MainActor
func settle() async {
  for _ in 0..<5 {
    await Task.yield()
    try? await Task.sleep(for: .milliseconds(20))
  }
}

@MainActor
@Suite(.serialized) struct PlayerTests {
  func make() async -> (PlayerModel, FakeEngine) {
    let e = FakeEngine()
    let src = FakeSource()
    let p = PlayerModel(profile: Demo.profile, source: src, engine: e, cache: AudioCache(source: src, cap: 10_000_000), remote: false, persist: false)
    p.start(Demo.library())
    await settle()
    return (p, e)
  }

  @Test func startsPausedOnTheFirstSong() async {
    let (p, e) = await make()
    #expect(p.current != nil && p.current?.id == p.queue.current)
    #expect(e.loads == [p.current!.id] && e.paused)
    #expect(p.poolSize == Demo.library().tracks.count)
    #expect(e.nextId == p.upcoming.first)
  }

  @Test func nextPrevAndBoundary() async {
    let (p, e) = await make()
    let first = p.current!.id
    p.next()
    await settle()
    #expect(p.current!.id != first && e.currentId == p.current!.id && !e.paused)
    p.prev()
    await settle()
    #expect(p.current!.id == first)
    let expected = e.nextId
    e.finish()
    await settle()
    #expect(p.current?.id == expected && p.queue.current == expected)
    #expect(p.history.last == first || p.history.contains(first))
  }

  // A skip shows "loading", never "paused", until the engine plays (lock screen).
  @Test func skipStaysPlayingWhileLoading() async {
    let (p, e) = await make()
    p.play()
    await settle()
    #expect(p.playing && !e.paused)
    e.pause()  // the reload's momentary pause, before the new item plays
    p.next()
    #expect(p.playing && p.buffering)
    await settle()
    #expect(p.playing && !p.buffering && !e.paused)
    p.pause()
    await settle()
    #expect(!p.playing)
  }

  @Test func durationFallsBackToTheFile() async {
    let e = FakeEngine()
    let src = FakeSource()
    let p = PlayerModel(profile: Demo.profile, source: src, engine: e, cache: AudioCache(source: src, cap: 10_000_000), remote: false, persist: false)
    var lib = Demo.library()
    lib.tracks = lib.tracks.map { var t = $0; t.duration = 0; return t }
    p.start(lib)
    await settle()
    #expect(p.duration == 0)
    e.itemDuration = 42
    e.onTime?(1)
    #expect(p.duration == 42)
  }

  @Test func filterAndErrors() async {
    let (p, _) = await make()
    #expect(p.setFilter("noon") == nil)
    await settle()
    #expect(p.current?.dims.first == "noon" && p.poolSize == 5)
    #expect(p.setFilter("d")?.contains("dawn") == true)  // dark / dawn / dusk
    #expect(p.setFilter("zzz") == "no folder matches \"zzz\"")
    #expect(p.filterText == "noon")
    #expect(p.setFilter("all") == nil && p.filterText.isEmpty)
  }

  @Test func availableGreysOtherDimensions() async {
    let (p, _) = await make()
    let avail = p.available("noon")
    // With noon picked, only noon's colours stay available; every time of day does.
    #expect(avail[1] == ["ochre", "grey"] && avail[0].count == 4)
  }

  @Test func likesAndFav() async {
    let (p, _) = await make()
    let id = p.current!.id
    p.toggleLike(id)
    #expect(p.liked(id) && p.notice.hasPrefix("♥"))
    #expect(p.setFilter("fav") == nil && p.poolSize == 1)
    p.toggleLike(id)
    #expect(!p.liked(id))
  }

  @Test func shuffleRepeatDedupe() async {
    let (p, _) = await make()
    let cur = p.current!.id
    p.toggleShuffle()
    #expect(!p.queue.shuffle && p.queue.current == cur)
    p.cycleRepeat()
    #expect(p.queue.repeat == .one)
    p.toggleDedupe()
    #expect(!p.dedupeOn && p.notice == "EVERY LENGTH AND VERSION" && p.queue.current == cur)
  }
}
