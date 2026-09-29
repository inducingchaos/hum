// hum for iOS: entry point. Two looks over one player (plan-ios §8).
import HumCore
import SwiftUI

@main
struct HumApp: App {
  @State private var app = AppModel()
  @Environment(\.scenePhase) private var scenePhase

  init() {
    // `-initialLook terminal` (UI tests, screenshots) sets the stored look once;
    // a plain `-look` launch argument would pin it and block switching.
    if let l = UserDefaults.standard.string(forKey: "initialLook") { UserDefaults.standard.set(l, forKey: "look") }
  }

  var body: some Scene {
    WindowGroup {
      RootView()
        .environment(app)
        .task { await app.boot() }
    }
    .onChange(of: scenePhase) { _, phase in
      switch phase {
      case .background:
        log("app in background")
        app.player?.save(force: true)
      case .active:
        log("app active")
      default:
        app.player?.save(force: true)
      }
    }
  }
}

struct RootView: View {
  @Environment(AppModel.self) private var app
  @AppStorage("look") private var look: Look = .native

  var body: some View {
    content
      .preferredColorScheme(look == .terminal ? .dark : nil)
  }

  @ViewBuilder private var content: some View {
    switch app.phase {
    case .boot:
      (look == .terminal ? Term.bg : Color(.systemBackground)).ignoresSafeArea()
    case .signIn:
      if look == .terminal { TermSignIn() } else { NativeSignIn() }
    case .syncing:
      if look == .terminal { TermSyncing() } else { NativeSyncing() }
    case .ready:
      if let p = app.player {
        if look == .terminal { TermRoot(p: p) } else { NativeRoot(p: p) }
      }
    }
  }
}
