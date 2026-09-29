// Look B, "Terminal" (plan-ios §8): the PWA's look, 1:1. Monochrome, Geist
// Mono at one size (13 pt, no Dynamic Type on purpose), rows padded 1ch × 3ch,
// hairline rules, one orange accent. Native underneath: haptics, context menus,
// the system route picker, safe areas.
import AuthenticationServices
import HumCore
import SwiftUI

enum Term {
  static let bg = Color(hex: 0x0C0C0C)
  static let row = Color(hex: 0x161616)
  static let press = Color(hex: 0x1C1C1C)
  static let line = Color(hex: 0x222222)
  static let fg = Color(hex: 0xECECEC)
  static let mid = Color(hex: 0x9A9A9A)
  static let dim = Color(hex: 0x5F5F5F)
  static let accent = Color(hex: 0xFF8000)
  static let size: CGFloat = 13
  static let ch: CGFloat = 7.8  // Geist Mono's advance is 0.6 em
  static let px = ch * 3
  static let py = ch

  static func font(_ bold: Bool = false) -> Font {
    .custom(bold ? "GeistMono-SemiBold" : "GeistMono-Regular", fixedSize: size)
  }
}

extension Color {
  init(hex: UInt32) {
    self.init(red: Double((hex >> 16) & 0xFF) / 255, green: Double((hex >> 8) & 0xFF) / 255, blue: Double(hex & 0xFF) / 255)
  }
}

struct HLine: View {
  var body: some View { Rectangle().fill(Term.line).frame(height: 1) }
}

struct VLine: View {
  var body: some View { Rectangle().fill(Term.line).frame(width: 1) }
}

// Flat button: no animation, a slightly lighter band while pressed.
struct TermPress: ButtonStyle {
  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .contentShape(Rectangle())
      .background(configuration.isPressed ? Term.press : Color.clear)
  }
}

extension View {
  func term(_ color: Color = Term.fg, bold: Bool = false) -> some View {
    font(Term.font(bold)).foregroundStyle(color)
  }
}

enum TermTab: String { case now, queue, sys }

struct TermRoot: View {
  let p: PlayerModel
  @State private var tab: TermTab = .now

  var body: some View {
    VStack(spacing: 0) {
      TermHeader()
      Group {
        switch tab {
        case .now: TermNow(p: p)
        case .queue: TermQueue(p: p)
        case .sys: TermSys(p: p)
        }
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
      TermTransport(p: p)
      HStack(spacing: 0) {
        tabButton(.now, "Now")
        VLine()
        tabButton(.queue, "Queue")
        VLine()
        tabButton(.sys, "Sys")
      }
      .fixedSize(horizontal: false, vertical: true)
      .overlay(alignment: .top) { HLine() }
    }
    .background(Term.bg.ignoresSafeArea())
    .tint(Term.accent)
  }

  private func tabButton(_ t: TermTab, _ label: String) -> some View {
    Button {
      haptic.impactOccurred()
      tab = t
    } label: {
      Text(label).term(tab == t ? Term.fg : Term.dim)
        .frame(maxWidth: .infinity)
        .padding(.vertical, Term.py * 1.75)
    }
    .buttonStyle(TermPress())
    .accessibilityIdentifier("tab.\(t.rawValue)")
  }
}

struct TermHeader: View {
  @Environment(AppModel.self) private var app

  var body: some View {
    HStack(spacing: Term.ch * 2) {
      Text("hum").term(bold: true)
      if let label = app.profile?.label, label != "hum" { Text(label).term(Term.dim) }
      Spacer(minLength: 0)
      if !app.syncStatus.isEmpty { Text(app.syncStatus).term(Term.dim).lineLimit(1).truncationMode(.tail) }
    }
    .lineLimit(1)
    .padding(.horizontal, Term.px)
    .padding(.vertical, Term.py * 1.5)
    .overlay(alignment: .bottom) { HLine() }
  }
}

struct TermTransport: View {
  let p: PlayerModel

  var body: some View {
    HStack(spacing: 0) {
      button("Prev", "prev", bold: false) { p.prev() }
      VLine()
      button(p.playing ? "Pause" : "Play", "playpause", bold: true) { p.toggle() }
      VLine()
      button("Next", "next", bold: false) { p.next() }
    }
    .fixedSize(horizontal: false, vertical: true)
    .overlay(alignment: .top) { HLine() }
  }

  private func button(_ label: String, _ id: String, bold: Bool, _ action: @escaping () -> Void) -> some View {
    Button {
      haptic.impactOccurred()
      action()
    } label: {
      Text(label).term(bold: bold).frame(maxWidth: .infinity).padding(.vertical, Term.py * 1.75)
    }
    .buttonStyle(TermPress())
    .accessibilityIdentifier(id)
  }
}

// ── Now ──────────────────────────────────────────────────────────────────────

struct TermNow: View {
  let p: PlayerModel
  @State private var editing = false
  @State private var scrub: Double?

  var body: some View {
    if editing {
      TermFilter(p: p, editing: $editing)
    } else {
      now
    }
  }

  private var now: some View {
    VStack(alignment: .leading, spacing: 0) {
      VStack(alignment: .leading, spacing: 0) {
        Text(p.current?.name ?? "—").term(bold: true).accessibilityIdentifier("title")
        Text(p.current?.album ?? "").term(Term.dim)
      }
      .padding(.horizontal, Term.px)
      .padding(.top, Term.py * 2)
      .padding(.bottom, Term.py)
      progress
      status
      filterRow
      if !p.notice.isEmpty {
        Text(p.notice).term(Term.accent).padding(.horizontal, Term.px).padding(.top, Term.py).accessibilityIdentifier("notice")
      }
      TermRolling(p: p)
    }
  }

  private var progress: some View {
    let dur = p.duration
    let frac = scrub ?? (dur > 0 ? min(1, p.position / dur) : 0)
    return HStack(spacing: Term.ch * 2) {
      GeometryReader { g in
        ZStack(alignment: .leading) {
          Rectangle().fill(Term.line).frame(height: 2)
          Rectangle().fill(Term.fg).frame(width: g.size.width * frac, height: 2)
        }
        .frame(maxHeight: .infinity)
        .contentShape(Rectangle())
        .gesture(
          DragGesture(minimumDistance: 0)
            .onChanged { v in if dur > 0 { scrub = max(0, min(1, v.location.x / g.size.width)) } }
            .onEnded { _ in
              if let s = scrub { p.seek(s * dur) }
              scrub = nil
            })
      }
      .frame(height: 32)
      .accessibilityIdentifier("scrubber")
      Text("\(fmtTime(scrub.map { $0 * dur } ?? p.position)) / \(fmtTime(dur))").term(Term.mid).monospacedDigit()
        .accessibilityIdentifier("time")
    }
    .padding(.horizontal, Term.px)
  }

  private var status: some View {
    HStack(spacing: 0) {
      HStack(spacing: 0) {
        if p.playing { Text("● ").term(Term.accent) }
        Text(p.statusText).term(Term.mid)
      }
      .padding(.vertical, Term.py)
      .padding(.horizontal, Term.ch)
      toggle("Shuffle", on: p.queue.shuffle) { p.toggleShuffle() }
      toggle(p.repeatLabel, on: p.queue.repeat != .off) { p.cycleRepeat() }
      toggle("Dedupe", on: p.dedupeOn) { p.toggleDedupe() }
      Spacer(minLength: 0)
      Text("\((p.queue.cursor + 1).formatted())/\(p.queue.order.count.formatted())").term(Term.dim)
        .padding(.vertical, Term.py).padding(.horizontal, Term.ch)
    }
    .lineLimit(1)
    .padding(.horizontal, Term.px - Term.ch)
  }

  private func toggle(_ label: String, on: Bool, _ action: @escaping () -> Void) -> some View {
    Button(action: action) {
      Text(label).term(on ? Term.fg : Term.dim).padding(.vertical, Term.py).padding(.horizontal, Term.ch)
    }
    .buttonStyle(TermPress())
    .accessibilityIdentifier("toggle.\(label.lowercased())")
  }

  private var filterRow: some View {
    Button {
      editing = true
    } label: {
      HStack(spacing: Term.ch * 2) {
        Text("Filter").term(Term.dim)
        Text(p.filterText.isEmpty ? "everything" : p.filterText).term().truncationMode(.tail)
        Spacer(minLength: 0)
        Text(plural(p.poolSize, "song")).term(Term.dim)
      }
      .lineLimit(1)
      .padding(.horizontal, Term.px)
      .padding(.vertical, Term.py)
      .overlay(alignment: .top) { HLine() }
      .overlay(alignment: .bottom) { HLine() }
    }
    .buttonStyle(TermPress())
    .accessibilityIdentifier("filter")
  }
}

// Played / now / next as one list (the CLI's rolling list).
struct TermRolling: View {
  let p: PlayerModel

  var body: some View {
    let played = p.playedRecent
    let next = p.upNext(24)
    ScrollView {
      LazyVStack(alignment: .leading, spacing: 0) {
        if !played.isEmpty { TermSect(text: "Played") }
        ForEach(Array(played.enumerated()), id: \.offset) { _, id in
          TermRow(p: p, id: id, mark: "", markColor: Term.dim, nameColor: Term.dim) { p.playNow(id) }
        }
        if let cur = p.queue.current {
          TermRow(p: p, id: cur, mark: "▶\u{FE0E}", markColor: Term.accent, bold: true, band: true, action: nil)
        }
        if !next.isEmpty { TermSect(text: "Next") }
        ForEach(Array(next.enumerated()), id: \.offset) { _, id in
          let m = Mark.of(id, p)
          TermRow(p: p, id: id, mark: m, markColor: m == "●" ? Term.mid : Term.dim) { p.playNow(id) }
        }
      }
    }
    .scrollIndicators(.hidden)
  }
}

struct TermSect: View {
  let text: String

  var body: some View {
    Text(text).term(Term.dim).frame(maxWidth: .infinity, alignment: .leading)
      .padding(.horizontal, Term.px).padding(.top, Term.py).padding(.bottom, 2)
  }
}

struct TermRow: View {
  let p: PlayerModel
  let id: String
  var mark: String
  var markColor: Color = Term.dim
  var nameColor: Color = Term.fg
  var bold = false
  var band = false
  var action: (() -> Void)?

  var body: some View {
    if let t = p.track(id) {
      Button {
        action?()
      } label: {
        HStack(alignment: .firstTextBaseline, spacing: Term.ch * 2) {
          Text(mark).term(markColor).frame(width: Term.ch, alignment: .leading)
          Text(t.name + (p.liked(id) ? " ♥\u{FE0E}" : "")).term(nameColor, bold: bold).layoutPriority(1)
          Spacer(minLength: 0)
          Text(t.dims.dropFirst().joined(separator: " / ")).term(Term.dim)
        }
        .lineLimit(1)
        .padding(.horizontal, Term.px)
        .padding(.vertical, Term.py)
        .background(band ? Term.row : Color.clear)
      }
      .buttonStyle(TermPress())
      .contextMenu {
        Button("Play now", systemImage: "play") { p.playNow(id) }
        Button(p.liked(id) ? "Unlike" : "Like", systemImage: p.liked(id) ? "heart.slash" : "heart") { p.toggleLike(id) }
      }
    }
  }
}

// ── Filter editor ────────────────────────────────────────────────────────────

// Chips per folder level. Same level = either, different levels = all.
struct TermFilter: View {
  let p: PlayerModel
  @Binding var editing: Bool
  @State private var draft = ""
  @State private var err = ""

  var body: some View {
    let words = Set(Draft.words(draft))
    let avail = p.available(draft)
    ScrollView {
      VStack(alignment: .leading, spacing: 0) {
        HStack(spacing: Term.ch * 2) {
          Text("Filter").term(Term.dim)
          TextField("", text: $draft, prompt: Text("everything").foregroundStyle(Term.dim))
            .font(Term.font()).foregroundStyle(Term.fg)
            .textInputAutocapitalization(.never).autocorrectionDisabled().submitLabel(.go)
            .onSubmit(apply)
            .accessibilityIdentifier("filter.field")
          if !words.isEmpty {
            Button("Clear") { draft = "" }.buttonStyle(TermPress()).term(Term.dim)
          }
        }
        .padding(.horizontal, Term.px)
        .padding(.vertical, Term.py)
        .overlay(alignment: .bottom) { HLine() }
        ForEach(Array(p.dimensions.enumerated()), id: \.offset) { i, dim in
          VStack(alignment: .leading, spacing: Term.ch * 0.5) {
            Text(dim).term(Term.dim)
            FlowLayout(spacing: Term.ch, lineSpacing: Term.ch) {
              ForEach(i < p.facets.count ? p.facets[i] : [], id: \.self) { v in
                chip(v, on: words.contains(v), available: i < avail.count && avail[i].contains(v))
              }
            }
          }
          .padding(.horizontal, Term.px)
          .padding(.top, Term.py)
        }
        if !err.isEmpty { Text(err).term(Term.accent).padding(.horizontal, Term.px).padding(.top, Term.py) }
        HStack(spacing: 0) {
          Button {
            editing = false
          } label: {
            Text("Cancel").term().frame(maxWidth: .infinity).padding(.vertical, Term.py * 1.5)
          }
          .buttonStyle(TermPress())
          VLine()
          Button(action: apply) {
            Text("Play").term(bold: true).frame(maxWidth: .infinity).padding(.vertical, Term.py * 1.5)
          }
          .buttonStyle(TermPress())
          .accessibilityIdentifier("filter.apply")
        }
        .fixedSize(horizontal: false, vertical: true)
        .overlay(alignment: .top) { HLine() }
        .overlay(alignment: .bottom) { HLine() }
        .padding(.top, Term.py * 2)
      }
    }
    .overlay(alignment: .top) { HLine() }
    .onAppear { draft = p.filterText }
  }

  private func chip(_ v: String, on: Bool, available: Bool) -> some View {
    Button {
      draft = Draft.toggle(v, in: draft)
      err = ""
    } label: {
      Text(v).term(on ? Term.fg : available ? Term.mid : Term.dim.opacity(0.5))
        .padding(.vertical, Term.ch * 0.5)
        .padding(.horizontal, Term.ch * 1.25)
        .background(on ? Term.row : Color.clear)
        .overlay(Rectangle().stroke(on ? Term.fg : Term.line, lineWidth: 1))
    }
    .buttonStyle(TermPress())
    .accessibilityIdentifier("chip.\(v)")
  }

  private func apply() {
    if let e = p.setFilter(draft) { err = e } else { editing = false }
  }
}

// ── Queue ────────────────────────────────────────────────────────────────────

struct TermQueue: View {
  let p: PlayerModel

  var body: some View {
    let start = p.queue.cursor
    let ids = Array(p.queue.order.dropFirst(start).prefix(300))
    ScrollView {
      LazyVStack(alignment: .leading, spacing: 0) {
        TermSect(text: "\(p.queue.order.count.formatted()) in queue · \(p.queue.shuffle ? "shuffled" : "in order")")
        ForEach(Array(ids.enumerated()), id: \.offset) { i, id in
          if i == 0 {
            TermRow(p: p, id: id, mark: "▶\u{FE0E}", markColor: Term.accent, bold: true, band: true, action: nil)
          } else {
            let m = Mark.of(id, p)
            TermRow(p: p, id: id, mark: m, markColor: m == "●" ? Term.mid : Term.dim) { p.jumpTo(start + i) }
          }
        }
      }
    }
    .scrollIndicators(.hidden)
  }
}

// ── Sys ──────────────────────────────────────────────────────────────────────

struct TermSys: View {
  let p: PlayerModel
  @Environment(AppModel.self) private var app
  @AppStorage("look") private var look: Look = .native
  @State private var copied = false
  @State private var confirmSignOut = false
  @State private var confirmClear = false

  var body: some View {
    ScrollView {
      LazyVStack(alignment: .leading, spacing: 0) {
        kv("Account", app.account ?? "signed in")
        kv("Library", "\(p.trackCount.formatted()) tracks · \(app.profile?.label ?? "")")
        kv("Cache", "\(p.cache.cachedIds.count) tracks · \(fmtBytes(p.cache.bytes)) / \(fmtBytes(p.cache.cap))")
        kv("Downloading", p.cache.downloading.flatMap { p.track($0)?.name } ?? "—")
        kv("Build", app.build)
        kv("Look", look.title)
        buttons([
          ("Native", look == .native, { look = .native }),
          ("Terminal", look == .terminal, { look = .terminal }),
        ])
        buttons([
          (copied ? "Copied" : "Copy log", false, { copyLog() }),
          ("Clear log", false, { EventLog.shared.clear() }),
        ])
        buttons([
          ("Clear cache", false, { confirmClear = true }),
          ("Sign out", false, { confirmSignOut = true }),
        ])
        Text("Log · newest first · [bg] = locked or in the background").term(Term.dim)
          .padding(.horizontal, Term.px).padding(.top, Term.py * 2).padding(.bottom, Term.py)
        ForEach(Array(EventLog.shared.lines.reversed().enumerated()), id: \.offset) { _, l in
          (Text(EventLog.clock(l.t)).foregroundColor(Term.dim) + Text("\(l.bg ? " [bg]" : "") \(l.msg)").foregroundColor(l.bg ? Term.mid : Term.fg))
            .font(Term.font())
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, Term.px)
            .textSelection(.enabled)
        }
      }
      .padding(.bottom, Term.py * 2)
    }
    .confirmationDialog("Sign out? This removes the library, its profile and cached tracks from this phone.", isPresented: $confirmSignOut, titleVisibility: .visible) {
      Button("Sign out", role: .destructive) { app.signOut() }
    }
    .confirmationDialog("Delete cached tracks?", isPresented: $confirmClear, titleVisibility: .visible) {
      Button("Clear cache", role: .destructive) { p.cache.clear() }
    }
  }

  private func kv(_ k: String, _ v: String) -> some View {
    HStack(alignment: .firstTextBaseline, spacing: Term.ch * 2) {
      Text(k).term(Term.dim)
      Spacer(minLength: 0)
      Text(v).term().multilineTextAlignment(.trailing)
    }
    .padding(.horizontal, Term.px)
    .padding(.vertical, Term.py)
    .overlay(alignment: .bottom) { HLine() }
  }

  private func buttons(_ items: [(String, Bool, () -> Void)]) -> some View {
    HStack(spacing: 0) {
      ForEach(Array(items.enumerated()), id: \.offset) { i, item in
        if i > 0 { VLine() }
        Button(action: item.2) {
          Text(item.0).term(item.1 ? Term.fg : Term.mid).frame(maxWidth: .infinity).padding(.vertical, Term.py)
            .background(item.1 ? Term.row : Color.clear)
        }
        .buttonStyle(TermPress())
        .accessibilityIdentifier("sys.\(item.0.lowercased().replacingOccurrences(of: " ", with: "-"))")
      }
    }
    .fixedSize(horizontal: false, vertical: true)
    .overlay(alignment: .bottom) { HLine() }
  }

  private func copyLog() {
    UIPasteboard.general.string = "hum \(app.build)\n" + EventLog.shared.text
    copied = true
    Task {
      try? await Task.sleep(for: .seconds(1.5))
      copied = false
    }
  }
}

// ── Sign-in + syncing ────────────────────────────────────────────────────────

struct TermSignIn: View {
  @Environment(AppModel.self) private var app
  @Environment(\.webAuthenticationSession) private var webAuth
  @Environment(\.openURL) private var openURL
  @State private var profileText = ""
  @State private var codeMode = false
  @State private var code = ""
  @State private var busy = false

  var body: some View {
    VStack(spacing: 0) {
      TermHeader()
      ScrollView {
        VStack(alignment: .leading, spacing: Term.py * 2) {
          Text("Your music library, from your Dropbox.").term()
          Text("Read-only. The sign-in stays on this phone.").term(Term.dim)
          if !app.error.isEmpty { Text(app.error).term(Term.accent).accessibilityIdentifier("error") }
          if app.profile == nil {
            Text("First, paste your library profile (JSON).").term(Term.dim)
            TextEditor(text: $profileText)
              .font(Term.font()).foregroundStyle(Term.fg)
              .scrollContentBackground(.hidden)
              .textInputAutocapitalization(.never).autocorrectionDisabled()
              .frame(height: 140)
              .padding(Term.ch * 0.5)
              .overlay(Rectangle().stroke(Term.line, lineWidth: 1))
              .accessibilityIdentifier("profile.field")
            big("Use profile", disabled: profileText.trimmingCharacters(in: .whitespaces).isEmpty) { app.useProfile(profileText) }
          } else {
            big(busy ? "Connecting" : "Sign in with Dropbox", disabled: busy) {
              Task {
                busy = true
                await app.signIn(webAuth)
                busy = false
              }
            }
            Button {
              codeMode = true
              openURL(app.codeURL())
            } label: {
              Text("Or sign in with a code").term(Term.mid).padding(.vertical, Term.py)
            }
            .buttonStyle(TermPress())
            if codeMode {
              Text("Allow access, copy the code Dropbox shows, paste it here.").term(Term.dim)
              TextField("", text: $code, prompt: Text("Code").foregroundStyle(Term.dim))
                .font(Term.font()).foregroundStyle(Term.fg)
                .textInputAutocapitalization(.never).autocorrectionDisabled()
                .padding(.vertical, Term.py)
                .overlay(alignment: .bottom) { HLine() }
              big(busy ? "Connecting" : "Connect", disabled: busy || code.trimmingCharacters(in: .whitespaces).isEmpty) {
                Task {
                  busy = true
                  await app.signIn(code: code)
                  busy = false
                }
              }
            }
          }
        }
        .padding(.horizontal, Term.px)
        .padding(.vertical, Term.py * 3)
      }
    }
    .background(Term.bg.ignoresSafeArea())
  }

  private func big(_ label: String, disabled: Bool, _ action: @escaping () -> Void) -> some View {
    Button(action: action) {
      Text(label).term(bold: true).frame(maxWidth: .infinity).padding(.vertical, Term.py).padding(.horizontal, Term.ch * 2)
        .overlay(Rectangle().stroke(Term.fg, lineWidth: 1))
    }
    .buttonStyle(TermPress())
    .disabled(disabled)
    .opacity(disabled ? 0.4 : 1)
  }
}

struct TermSyncing: View {
  @Environment(AppModel.self) private var app

  var body: some View {
    VStack(spacing: 0) {
      TermHeader()
      Text(app.syncMessage.isEmpty ? "SYNCING" : app.syncMessage).term(Term.dim)
        .padding(Term.px)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
    .background(Term.bg.ignoresSafeArea())
  }
}
