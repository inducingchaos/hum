// Boot, sign-in, sync (plan-ios §4, the PWA's app.tsx).
import AuthenticationServices
import Foundation
import HumCore
import Observation
import SwiftUI

enum Look: String, CaseIterable, Identifiable {
  case native, terminal
  var id: String { rawValue }
  var title: String { self == .native ? "Native" : "Terminal" }
}

enum Phase: Equatable { case boot, signIn, syncing, ready }

@Observable final class AppModel {
  var phase: Phase = .boot
  var syncMessage = ""  // full-screen, first sync only
  var syncStatus = ""  // background work, shown in the header
  var error = ""
  var profile: Profile?
  var profileBundled = false
  private(set) var player: PlayerModel?
  private(set) var account: String? = UserDefaults.standard.string(forKey: "account")
  let dropbox = Dropbox()
  private var codePKCE: PKCE?

  let build: String = {
    let v = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "?"
    let b = Bundle.main.object(forInfoDictionaryKey: "HumBuild") as? String ?? "dev"
    return "\(v) · \(b)"
  }()

  func boot() async {
    log("boot · \(Demo.on ? "demo" : "app") · iOS \(UIDevice.current.systemVersion) · \(build)")
    if Demo.on { return startDemo() }
    profile = loadProfile()
    guard profile != nil, dropbox.signedIn else {
      phase = .signIn
      return
    }
    await openLibrary()
  }

  // ── Profile ──

  private func loadProfile() -> Profile? {
    if let u = Bundle.main.url(forResource: "profile.local", withExtension: "json"), let d = try? Data(contentsOf: u) {
      do {
        let p = try Profile.parse(d)
        profileBundled = true
        return p
      } catch {
        self.error = "\(error)"
      }
    }
    if let d = try? Data(contentsOf: Store.support.appendingPathComponent("profile.json")) { return try? Profile.parse(d) }
    return nil
  }

  func useProfile(_ text: String) {
    error = ""
    do {
      let p = try Profile.parse(Data(text.utf8))
      try? Data(text.utf8).write(to: Store.support.appendingPathComponent("profile.json"), options: .atomic)
      profile = p
      log("profile saved: \(p.dimensions.count) folder levels")
      if dropbox.signedIn { Task { await openLibrary() } }
    } catch {
      self.error = "\(error)"
    }
  }

  // ── Sign-in ──

  func signIn(_ session: WebAuthenticationSession) async {
    error = ""
    let pkce = PKCE.make(redirect: true)
    do {
      let callback = try await session.authenticate(using: dropbox.authorizeURL(pkce), callbackURLScheme: Dropbox.callbackScheme)
      try await finish { try await self.dropbox.finish(callback: callback, pkce: pkce) }
    } catch let e as ASWebAuthenticationSessionError where e.code == .canceledLogin {
      return
    } catch {
      self.error = "\(error)"
      log("sign-in failed: \(error)")
    }
  }

  // Fallback without a redirect: Dropbox shows a code to paste.
  func codeURL() -> URL {
    let p = PKCE.make(redirect: false)
    codePKCE = p
    return dropbox.authorizeURL(p)
  }

  func signIn(code: String) async {
    error = ""
    guard let p = codePKCE else {
      error = "sign-in expired: start again"
      return
    }
    do {
      try await finish { try await self.dropbox.finish(code: code, pkce: p) }
    } catch {
      self.error = "\(error)"
    }
  }

  private func finish(_ exchange: () async throws -> String?) async throws {
    let name = try await exchange()
    account = name
    UserDefaults.standard.set(name, forKey: "account")
    log("signed in")
    await openLibrary()
  }

  func signOut() {
    player?.pause()
    player?.shutdown()
    player = nil
    dropbox.signOut()
    Store.wipe()
    UserDefaults.standard.removeObject(forKey: "account")
    account = nil
    profileBundled = false
    profile = loadProfile()
    phase = .signIn
    log("signed out")
  }

  // ── Library ──

  func openLibrary() async {
    guard let profile else {
      phase = .signIn
      return
    }
    let source = DropboxSource(dropbox: dropbox, profile: profile)
    let sync = LibrarySync(dropbox: dropbox, profile: profile)
    do {
      var lib = await LibrarySync.load()
      let stored = lib != nil
      if lib == nil {
        phase = .syncing
        lib = try await withElapsed({ self.syncMessage = $0 }) { report in try await sync.listTracks(progress: report) }
      }
      let player = makePlayer(profile, source)
      player.start(lib!)
      phase = .ready
      if LibrarySync.needsMetadata(lib!) {
        let full = try await withElapsed({ self.syncStatus = $0 }) { report in try await sync.fillMetadata(lib!, progress: report) }
        syncStatus = ""
        player.updateLibrary(full, reshuffle: true)
      } else if stored {
        Task {
          do {
            if let next = try await sync.deltaSync(lib!) { player.updateLibrary(next) }
          } catch {
            log("delta sync failed: \(error)")
          }
        }
      }
    } catch {
      syncStatus = ""
      if case DropboxError.auth = error {
        self.error = "Dropbox sign-in expired. Sign in again."
        phase = .signIn
      } else {
        let msg = "SYNC FAILED: \(error)"
        if phase == .ready { syncStatus = msg } else { syncMessage = msg }
        log(msg)
      }
    }
  }

  private func makePlayer(_ profile: Profile, _ source: TrackSource) -> PlayerModel {
    let p = PlayerModel(profile: profile, source: source, engine: AVEngine(), cache: AudioCache(source: source))
    player = p
    return p
  }

  private func startDemo() {
    if UserDefaults.standard.bool(forKey: "demoReset") {
      Store.delete("state.json")
      Store.delete("cache-index.json", in: Store.caches)
      try? FileManager.default.removeItem(at: Store.caches.appendingPathComponent("audio"))
    }
    let profile = Demo.profile
    self.profile = profile
    account = "Demo"
    let source = DemoSource()
    let p = makePlayer(profile, source)
    p.start(Demo.library())
    phase = .ready
  }

  // Runs a slow step, showing its latest message plus a seconds counter, so a
  // long wait never looks frozen.
  private func withElapsed<T>(_ show: @escaping (String) -> Void, _ fn: (@escaping (String) -> Void) async throws -> T) async throws -> T {
    let e = Elapsed(show)
    let timer = Task {
      while !Task.isCancelled {
        try? await Task.sleep(for: .seconds(1))
        e.render()
      }
    }
    defer { timer.cancel() }
    return try await fn { m in
      e.msg = m
      e.render()
    }
  }
}

private final class Elapsed {
  var msg = ""
  let t0 = Date()
  let show: (String) -> Void

  init(_ show: @escaping (String) -> Void) {
    self.show = show
  }

  func render() { show("\(msg) · \(Int(Date().timeIntervalSince(t0))) s") }
}
