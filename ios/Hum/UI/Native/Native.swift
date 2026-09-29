// Look A, "Native" (plan-ios §8): as much stock SwiftUI as possible. Liquid
// Glass tab bar with a mini player, SF Symbols, glass buttons, context menus,
// swipe actions, sheets, Form. Same player, same features as the Terminal look.
import AuthenticationServices
import HumCore
import SwiftUI

enum NativeTab: Hashable { case now, queue, settings }

struct NativeRoot: View {
  let p: PlayerModel
  @State private var tab: NativeTab = .now

  var body: some View {
    TabView(selection: $tab) {
      Tab("Now", systemImage: "waveform", value: .now) { NativeNow(p: p) }
      Tab("Queue", systemImage: "list.bullet", value: .queue) { NativeQueue(p: p) }
      Tab("Settings", systemImage: "gearshape", value: .settings) { NativeSettings(p: p) }
    }
    .tabBarMinimizeBehavior(.onScrollDown)
    .tabViewBottomAccessory { MiniPlayer(p: p) }
    .tint(Color.accentColor)
  }
}

// The glass mini player above the tab bar.
struct MiniPlayer: View {
  let p: PlayerModel

  var body: some View {
    HStack(spacing: 12) {
      Artwork(image: p.artwork, size: 32, corner: 6)
      VStack(alignment: .leading, spacing: 0) {
        Text(p.current?.name ?? "Not playing").font(.subheadline.weight(.semibold)).lineLimit(1)
        Text(p.current?.album ?? "").font(.caption).foregroundStyle(.secondary).lineLimit(1)
      }
      Spacer(minLength: 0)
      Button {
        p.toggle()
      } label: {
        Image(systemName: p.playing ? "pause.fill" : "play.fill").font(.title3).frame(width: 36, height: 36)
      }
      .accessibilityLabel(p.playing ? "Pause" : "Play")
      Button {
        p.next()
      } label: {
        Image(systemName: "forward.fill").font(.title3).frame(width: 36, height: 36)
      }
      .accessibilityLabel("Next")
    }
    .buttonStyle(.plain)
    .padding(.horizontal, 12)
  }
}

struct Artwork: View {
  let image: UIImage?
  var size: CGFloat?
  var corner: CGFloat = 20

  var body: some View {
    ZStack {
      if let image {
        Image(uiImage: image).resizable().scaledToFill()
      } else {
        Rectangle().fill(.quaternary)
        Image(systemName: "waveform").font(Font.system(size: (size ?? 160) * 0.4)).foregroundStyle(.secondary)
      }
    }
    .frame(width: size, height: size)
    .aspectRatio(1, contentMode: .fit)
    .clipShape(RoundedRectangle(cornerRadius: corner, style: .continuous))
  }
}

// ── Now ──────────────────────────────────────────────────────────────────────

struct NativeNow: View {
  let p: PlayerModel
  @Environment(AppModel.self) private var app
  @State private var showFilter = false
  @State private var scrub: Double?

  var body: some View {
    NavigationStack {
      ScrollView {
        VStack(alignment: .leading, spacing: 20) {
          Artwork(image: p.artwork)
            .frame(maxWidth: 320)
            .frame(maxWidth: .infinity)
            .shadow(color: .black.opacity(0.25), radius: 20, y: 10)
          VStack(alignment: .leading, spacing: 4) {
            Text(p.current?.name ?? "—").font(.title2.weight(.bold)).accessibilityIdentifier("title")
            Text(p.current?.album ?? "").font(.subheadline).foregroundStyle(.secondary)
          }
          scrubber
          transport
          toggles
          filterButton
          if !p.notice.isEmpty {
            Label(p.notice, systemImage: "info.circle").font(.footnote).foregroundStyle(.orange).accessibilityIdentifier("notice")
          }
          upNext
        }
        .padding(.horizontal, 20)
        .padding(.bottom, 24)
      }
      .navigationTitle("hum")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        if !app.syncStatus.isEmpty {
          ToolbarItem(placement: .topBarLeading) {
            Text(app.syncStatus).font(.caption).foregroundStyle(.secondary).lineLimit(1)
          }
        }
        ToolbarItem(placement: .topBarTrailing) {
          RoutePicker().frame(width: 32, height: 32)
        }
      }
      .sheet(isPresented: $showFilter) { NativeFilter(p: p) }
    }
  }

  private var scrubber: some View {
    let dur = max(p.duration, 0.1)
    return VStack(spacing: 2) {
      Slider(
        value: Binding(get: { scrub ?? min(p.position, dur) }, set: { scrub = $0 }),
        in: 0...dur,
        onEditingChanged: { editing in
          if !editing, let s = scrub {
            p.seek(s)
            scrub = nil
          }
        }
      )
      .accessibilityIdentifier("scrubber")
      HStack {
        Text(fmtTime(scrub ?? p.position)).accessibilityIdentifier("time")
        Spacer()
        Text("-" + fmtTime(max(0, p.duration - (scrub ?? p.position))))
      }
      .font(.caption.monospacedDigit())
      .foregroundStyle(.secondary)
    }
  }

  private var transport: some View {
    HStack(spacing: 28) {
      Spacer()
      Button {
        p.prev()
      } label: {
        Image(systemName: "backward.fill").font(.title2).frame(width: 56, height: 56)
      }
      .buttonStyle(.glass)
      .accessibilityIdentifier("prev")
      Button {
        p.toggle()
      } label: {
        Image(systemName: p.playing ? "pause.fill" : "play.fill").font(.largeTitle).frame(width: 76, height: 76)
          .contentTransition(.symbolEffect(.replace))
      }
      .buttonStyle(.glassProminent)
      .accessibilityIdentifier("playpause")
      Button {
        p.next()
      } label: {
        Image(systemName: "forward.fill").font(.title2).frame(width: 56, height: 56)
      }
      .buttonStyle(.glass)
      .accessibilityIdentifier("next")
      Spacer()
    }
    .sensoryFeedback(.impact(weight: .light), trigger: p.current?.id)
  }

  private var toggles: some View {
    GlassEffectContainer {
      HStack(spacing: 10) {
        toggle("shuffle", on: p.queue.shuffle, id: "toggle.shuffle") { p.toggleShuffle() }
        toggle(p.queue.repeat == .one ? "repeat.1" : "repeat", on: p.queue.repeat != .off, id: "toggle.repeat") { p.cycleRepeat() }
        toggle("square.stack", on: p.dedupeOn, id: "toggle.dedupe") { p.toggleDedupe() }
        Spacer()
        if let id = p.current?.id {
          toggle(p.liked(id) ? "heart.fill" : "heart", on: p.liked(id), id: "toggle.like") { p.toggleLike(id) }
        }
      }
    }
  }

  private func toggle(_ symbol: String, on: Bool, id: String, _ action: @escaping () -> Void) -> some View {
    Button(action: action) {
      Image(systemName: symbol).font(.body.weight(.semibold)).frame(width: 40, height: 40)
        .foregroundStyle(on ? Color.accentColor : Color.secondary)
    }
    .buttonStyle(.glass)
    .accessibilityIdentifier(id)
  }

  private var filterButton: some View {
    Button {
      showFilter = true
    } label: {
      HStack {
        Label(p.filterText.isEmpty ? "Everything" : p.filterText, systemImage: "line.3.horizontal.decrease.circle")
          .lineLimit(1)
        Spacer()
        Text(plural(p.poolSize, "song")).foregroundStyle(.secondary)
        Image(systemName: "chevron.right").font(.caption.weight(.semibold)).foregroundStyle(.tertiary)
      }
      .padding(.horizontal, 16)
      .padding(.vertical, 12)
      .glassEffect(.regular.interactive(), in: .rect(cornerRadius: 16))
    }
    .buttonStyle(.plain)
    .accessibilityIdentifier("filter")
  }

  private var upNext: some View {
    let played = p.playedRecent
    let next = p.upNext(24)
    return LazyVStack(alignment: .leading, spacing: 0) {
      if !played.isEmpty {
        Text("Played").font(.headline).padding(.bottom, 6)
        ForEach(Array(played.enumerated()), id: \.offset) { _, id in
          NativeRow(p: p, id: id, dimmed: true) { p.playNow(id) }
        }
      }
      Text("Up Next").font(.headline).padding(.top, played.isEmpty ? 0 : 16).padding(.bottom, 6)
      ForEach(Array(next.enumerated()), id: \.offset) { _, id in
        NativeRow(p: p, id: id) { p.playNow(id) }
      }
    }
  }
}

struct NativeRow: View {
  let p: PlayerModel
  let id: String
  var dimmed = false
  var nowPlaying = false
  var action: (() -> Void)?

  var body: some View {
    if let t = p.track(id) {
      Button {
        action?()
      } label: {
        HStack(spacing: 12) {
          ZStack {
            if nowPlaying {
              Image(systemName: "speaker.wave.2.fill").foregroundStyle(Color.accentColor)
                .symbolEffect(.variableColor.iterative, isActive: p.playing)
            } else {
              cacheIcon
            }
          }
          .frame(width: 22)
          VStack(alignment: .leading, spacing: 1) {
            HStack(spacing: 4) {
              Text(t.name).font(.body.weight(nowPlaying ? .semibold : .regular)).lineLimit(1)
              if p.liked(id) { Image(systemName: "heart.fill").font(.caption2).foregroundStyle(Color.accentColor) }
            }
            Text(t.album).font(.caption).foregroundStyle(.secondary).lineLimit(1)
          }
          Spacer(minLength: 0)
          if t.duration > 0 { Text(fmtTime(t.duration)).font(.caption.monospacedDigit()).foregroundStyle(.tertiary) }
        }
        .padding(.vertical, 8)
        .contentShape(Rectangle())
        .opacity(dimmed ? 0.55 : 1)
      }
      .buttonStyle(.plain)
      .contextMenu {
        Button("Play Now", systemImage: "play.fill") { p.playNow(id) }
        Button(p.liked(id) ? "Unlike" : "Like", systemImage: p.liked(id) ? "heart.slash" : "heart") { p.toggleLike(id) }
      } preview: {
        VStack(alignment: .leading, spacing: 8) {
          Text(t.name).font(.headline)
          Text(t.album).font(.subheadline).foregroundStyle(.secondary)
          if !t.tags.isEmpty { Text(t.tags.prefix(6).joined(separator: " · ")).font(.caption).foregroundStyle(.tertiary) }
        }
        .padding()
        .frame(width: 280, alignment: .leading)
      }
    }
  }

  @ViewBuilder private var cacheIcon: some View {
    if p.cache.cachedIds.contains(id) {
      Image(systemName: "checkmark.circle.fill").foregroundStyle(.secondary)
    } else if p.cache.downloading == id {
      Image(systemName: "arrow.down.circle").foregroundStyle(.secondary).symbolEffect(.pulse)
    } else {
      Image(systemName: "circle").foregroundStyle(.quaternary)
    }
  }
}

// ── Filter sheet ─────────────────────────────────────────────────────────────

struct NativeFilter: View {
  let p: PlayerModel
  @Environment(\.dismiss) private var dismiss
  @State private var draft = ""
  @State private var err = ""

  var body: some View {
    let words = Set(Draft.words(draft))
    let avail = p.available(draft)
    NavigationStack {
      Form {
        Section {
          TextField("Everything", text: $draft)
            .textInputAutocapitalization(.never).autocorrectionDisabled().submitLabel(.go)
            .onSubmit(apply)
            .accessibilityIdentifier("filter.field")
        } footer: {
          Text("Same row = either, different rows = all. `fav` = liked songs.")
        }
        ForEach(Array(p.dimensions.enumerated()), id: \.offset) { i, dim in
          Section(dim.capitalized) {
            FlowLayout(spacing: 8, lineSpacing: 8) {
              ForEach(i < p.facets.count ? p.facets[i] : [], id: \.self) { v in
                chip(v, on: words.contains(v), available: i < avail.count && avail[i].contains(v))
              }
            }
            .padding(.vertical, 4)
          }
        }
        Section {
          chip("fav", on: words.contains("fav"), available: !p.likes.isEmpty)
        } header: {
          Text("Liked")
        }
        if !err.isEmpty {
          Section { Text(err).foregroundStyle(.orange).accessibilityIdentifier("filter.error") }
        }
      }
      .navigationTitle("Filter")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button("Cancel", systemImage: "xmark") { dismiss() } }
        ToolbarItem(placement: .confirmationAction) {
          Button("Play", systemImage: "play.fill", action: apply).accessibilityIdentifier("filter.apply")
        }
        ToolbarItem(placement: .bottomBar) {
          Button("Clear") { draft = "" }.disabled(words.isEmpty)
        }
      }
    }
    .presentationDetents([.medium, .large])
    .onAppear { draft = p.filterText }
  }

  private func chip(_ v: String, on: Bool, available: Bool) -> some View {
    Button {
      draft = Draft.toggle(v, in: draft)
      err = ""
    } label: {
      Text(v).font(.subheadline.weight(on ? .semibold : .regular)).padding(.horizontal, 4)
    }
    .buttonStyle(.bordered)
    .tint(on ? Color.accentColor : available ? Color.primary : Color.secondary)
    .opacity(available || on ? 1 : 0.45)
    .accessibilityIdentifier("chip.\(v)")
    .accessibilityAddTraits(on ? .isSelected : [])
  }

  private func apply() {
    if let e = p.setFilter(draft) { err = e } else { dismiss() }
  }
}

// ── Queue ────────────────────────────────────────────────────────────────────

struct NativeQueue: View {
  let p: PlayerModel

  var body: some View {
    let start = p.queue.cursor
    let ids = Array(p.queue.order.dropFirst(start).prefix(300))
    NavigationStack {
      List {
        Section {
          ForEach(Array(ids.enumerated()), id: \.offset) { i, id in
            NativeRow(p: p, id: id, nowPlaying: i == 0) { if i > 0 { p.jumpTo(start + i) } }
              .swipeActions(edge: .trailing) {
                Button(p.liked(id) ? "Unlike" : "Like", systemImage: p.liked(id) ? "heart.slash" : "heart") { p.toggleLike(id) }
                  .tint(.orange)
              }
              .swipeActions(edge: .leading) {
                Button("Play Now", systemImage: "play.fill") { p.playNow(id) }.tint(.accentColor)
              }
          }
        } header: {
          Text("\(p.queue.order.count.formatted()) in queue · \(p.queue.shuffle ? "shuffled" : "in order")")
        }
      }
      .listStyle(.plain)
      .navigationTitle("Queue")
      .toolbar {
        ToolbarItem(placement: .topBarTrailing) {
          Button("Shuffle", systemImage: p.queue.shuffle ? "shuffle.circle.fill" : "shuffle.circle") { p.toggleShuffle() }
        }
      }
    }
  }
}

// ── Settings (the PWA's SYS) ─────────────────────────────────────────────────

struct NativeSettings: View {
  let p: PlayerModel
  @Environment(AppModel.self) private var app
  @AppStorage("look") private var look: Look = .native
  @State private var confirmSignOut = false
  @State private var confirmClear = false

  var body: some View {
    NavigationStack {
      Form {
        Section("Look") {
          Picker("Look", selection: $look) {
            ForEach(Look.allCases) { Text($0.title).tag($0) }
          }
          .pickerStyle(.segmented)
          .accessibilityIdentifier("look.picker")
        }
        Section("Library") {
          LabeledContent("Account", value: app.account ?? "Signed in")
          LabeledContent("Profile", value: app.profile?.label ?? "—")
          LabeledContent("Tracks", value: p.trackCount.formatted())
          if !app.syncStatus.isEmpty { LabeledContent("Sync", value: app.syncStatus) }
        }
        Section("Cache") {
          LabeledContent("Cached", value: "\(p.cache.cachedIds.count) tracks · \(fmtBytes(p.cache.bytes)) / \(fmtBytes(p.cache.cap))")
          LabeledContent("Downloading", value: p.cache.downloading.flatMap { p.track($0)?.name } ?? "—")
          Button("Clear Cache", role: .destructive) { confirmClear = true }
        }
        Section("Diagnostics") {
          LabeledContent("Build", value: app.build)
          NavigationLink("Event Log") { NativeLog() }
        }
        Section {
          Button("Sign Out", role: .destructive) { confirmSignOut = true }
        }
      }
      .navigationTitle("Settings")
      .confirmationDialog("Sign out? This removes the library, its profile and cached tracks from this phone.", isPresented: $confirmSignOut, titleVisibility: .visible) {
        Button("Sign Out", role: .destructive) { app.signOut() }
      }
      .confirmationDialog("Delete cached tracks?", isPresented: $confirmClear, titleVisibility: .visible) {
        Button("Clear Cache", role: .destructive) { p.cache.clear() }
      }
    }
  }
}

struct NativeLog: View {
  @Environment(AppModel.self) private var app

  var body: some View {
    List(Array(EventLog.shared.lines.reversed().enumerated()), id: \.offset) { _, l in
      VStack(alignment: .leading, spacing: 2) {
        Text("\(EventLog.clock(l.t))\(l.bg ? " · background" : "")").font(.caption.monospacedDigit()).foregroundStyle(.secondary)
        Text(l.msg).font(.footnote.monospaced()).textSelection(.enabled)
      }
    }
    .listStyle(.plain)
    .navigationTitle("Event Log")
    .toolbar {
      ToolbarItem(placement: .topBarTrailing) {
        ShareLink(item: "hum \(app.build)\n" + EventLog.shared.text) { Image(systemName: "square.and.arrow.up") }
      }
      ToolbarItem(placement: .topBarTrailing) {
        Button("Copy", systemImage: "doc.on.doc") { UIPasteboard.general.string = "hum \(app.build)\n" + EventLog.shared.text }
      }
      ToolbarItem(placement: .bottomBar) {
        Button("Clear", role: .destructive) { EventLog.shared.clear() }
      }
    }
  }
}

// ── Sign-in + syncing ────────────────────────────────────────────────────────

struct NativeSignIn: View {
  @Environment(AppModel.self) private var app
  @Environment(\.webAuthenticationSession) private var webAuth
  @Environment(\.openURL) private var openURL
  @State private var profileText = ""
  @State private var code = ""
  @State private var codeMode = false
  @State private var busy = false

  var body: some View {
    NavigationStack {
      Form {
        Section {
          VStack(alignment: .leading, spacing: 8) {
            Image(systemName: "waveform").font(.system(size: 40, weight: .semibold)).foregroundStyle(Color.accentColor)
            Text("Your music library, from your Dropbox.").font(.title3.weight(.semibold))
            Text("Read-only. The sign-in stays on this phone.").foregroundStyle(.secondary)
          }
          .padding(.vertical, 8)
        }
        if !app.error.isEmpty {
          Section { Text(app.error).foregroundStyle(.orange).accessibilityIdentifier("error") }
        }
        if app.profile == nil {
          Section {
            TextEditor(text: $profileText)
              .font(.footnote.monospaced())
              .frame(minHeight: 140)
              .textInputAutocapitalization(.never).autocorrectionDisabled()
              .accessibilityIdentifier("profile.field")
            Button("Use Profile") { app.useProfile(profileText) }
              .disabled(profileText.trimmingCharacters(in: .whitespaces).isEmpty)
          } header: {
            Text("Library profile")
          } footer: {
            Text("Paste the JSON from profile.local.json (see docs/profile.md). Or put the file at the repo root before building.")
          }
        } else {
          Section {
            Button {
              Task {
                busy = true
                await app.signIn(webAuth)
                busy = false
              }
            } label: {
              Label(busy ? "Connecting…" : "Sign in with Dropbox", systemImage: "person.badge.key")
            }
            .disabled(busy)
            Button("Sign in with a code instead") {
              codeMode = true
              openURL(app.codeURL())
            }
          }
          if codeMode {
            Section {
              TextField("Code", text: $code).textInputAutocapitalization(.never).autocorrectionDisabled()
              Button("Connect") {
                Task {
                  busy = true
                  await app.signIn(code: code)
                  busy = false
                }
              }
              .disabled(busy || code.trimmingCharacters(in: .whitespaces).isEmpty)
            } footer: {
              Text("Allow access, copy the code Dropbox shows, paste it here.")
            }
          }
        }
      }
      .navigationTitle("hum")
    }
  }
}

struct NativeSyncing: View {
  @Environment(AppModel.self) private var app

  var body: some View {
    VStack(spacing: 16) {
      ProgressView()
      Text(app.syncMessage.isEmpty ? "Syncing" : app.syncMessage).font(.footnote.monospacedDigit()).foregroundStyle(.secondary)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
  }
}
