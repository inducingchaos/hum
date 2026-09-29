# Plan: hum for iOS (native)

Status: **approved** (turn 16, 2026-09-29). Stack decision: D17. Owner answers: `docs/kb/questions.md` round 4.
Sources: `docs/kb/requirements.md` (turns 15–16), `docs/plan-web.md` (the PWA this replaces), `docs/profile.md`.

## 1. Goal

The PWA, rebuilt as a native iPhone app: same features, same library, but with native audio so the
lock screen, pause, background playback and launch time behave like a real music app. Two looks in one
app (the owner's challenge):

- **Native** (look A): as much stock SwiftUI as possible. Liquid Glass tab bar with a mini player
  accessory, SF Symbols, context menus, swipe actions, sheets, `Form`. Still reads as "our" minimal player.
- **Terminal** (look B): the PWA's look 1:1 (Geist Mono 13 pt, monochrome, hairline rules, one orange
  accent), drawn with SwiftUI, with native behaviour underneath (haptics, context menus on long-press,
  Dynamic Type off on purpose, safe areas).

Switch in SYS / Settings (`Look`). Both drive the same player model, so switching is instant and loses nothing.

Non-goals for v1: App Store release, search/browse/favourites views beyond the PWA's (likes + `fav` filter are in),
CarPlay, widgets, Mac Catalyst.

## 2. Stack (D17)

- Swift 6, SwiftUI, iOS 26.0 minimum (owner on 26.6). Default actor isolation = `MainActor`
  (Xcode 26's approachable concurrency), so UI and player code is main-actor unless marked otherwise.
- **Zero third-party dependencies.** AVFoundation (`AVQueuePlayer`), MediaPlayer (Now Playing + remote
  commands), AuthenticationServices (Dropbox sign-in), Security (Keychain), Compression (metadata zip).
- `HumCore`: Swift package, a port of `packages/core` (profile, model, normalize, filter, queue, search,
  format, art). Pure Foundation, so it builds and tests on Linux too (the cloud container) and on macOS CI.
  Both the TS and the Swift tests run the same cases from `test/cases/core-cases.json`.
- XcodeGen (`ios/project.yml`) generates `Hum.xcodeproj`, which is not committed. On the Mac:
  `brew install xcodegen` once, then `cd ios && xcodegen` (see §12).

## 3. Layout

```
ios/
  project.yml              XcodeGen spec (app, unit tests, UI tests)
  HumCore/                 Swift package: Sources/HumCore, Tests/HumCoreTests
  Hum/
    App/                   HumApp (entry), AppModel (boot, phases, look)
    Services/              Dropbox, Keychain, Library (sync), Zip, Store, AudioCache, Art, Log, Demo
    Player/                PlayerModel (@Observable), Engine (AVQueuePlayer), NowPlaying (lock screen)
    UI/Native/             look A
    UI/Terminal/           look B
    UI/Shared/             sign-in + profile logic shared by both looks
    Resources/             Assets (icon), Fonts (Geist Mono + OFL), Info.plist keys come from project.yml
  HumTests/                unit tests (zip, player model with a fake engine, store)
  HumUITests/              UI smoke tests on the Simulator in demo mode + screenshots of both looks
.github/workflows/ios.yml  CI: HumCore tests, build, unit + UI tests, screenshots as an artifact
```

## 4. Data flow

Same as the PWA (plan-web §6–§9), native:

- **Profile:** `profile.local.json` bundled at build time if present at the repo root (a build phase copies
  it; the file never enters git), else pasted once on the sign-in screen and stored in Application Support.
- **Auth:** PKCE with `ASWebAuthenticationSession` (SwiftUI `webAuthenticationSession`), redirect
  `db-<app key>://2/token` (Dropbox's mobile scheme), `token_access_type=offline`. Fallback: the code flow
  (no redirect; Dropbox shows a code, paste it). Refresh token in the Keychain
  (`kSecAttrAccessibleAfterFirstUnlock`, so background refresh works while locked). Access token in memory.
  Same read-only endpoint allowlist as the CLI and PWA.
- **Library:** phase 1 = recursive listing of the profile root (player starts on file names), phase 2 = one
  `download_zip` of the metadata folder, unzipped with a ~100-line reader (central directory + raw DEFLATE
  via Compression). Later launches: the saved library loads at once, a cursor delta runs in the background.
  Stored as JSON in Application Support (`library.json`, format v3 like the CLI).
- **State:** `state.json` (queue snapshot, position, filter, dedupe, history, likes), saved on every queue
  change, every 5 s while playing, and when the app goes to the background.
- **Audio cache:** `Caches/audio/<id>.mp3`. Window = now + next 3, downloaded one at a time in order;
  the last 2 played are kept. LRU cap 2 GB (SYS shows usage). iOS may purge Caches; that only costs a download.
- **Cover art:** `Caches/art/<id>.jpg` (profile `artQuery`, 600 px), preloaded for the window so the lock
  screen gets it at once.

## 5. Playback engine

- One `AVQueuePlayer` holding **current + next** (`actionAtItemEnd = .advance`): gapless, like the CLI's
  helper. When the current item changes to the queued next one, the player model advances the queue and
  queues the one after (the "boundary"). Our own loads are told apart from boundaries by item identity.
- Source per item: the cached file if present, else a Dropbox temporary link (HTTPS, range requests),
  fetched ahead for the next item. Streaming and caching both run; a track that finishes downloading while
  streaming just keeps streaming.
- `AVAudioSession`: `.playback`, `.default`, **`.longFormAudio`** route policy (AirPlay 2 / music app
  behaviour). Activated on first play. Interruptions: iOS pauses us; on `.ended` with `shouldResume`, resume.
  Route change (headphones out): AVPlayer pauses; the UI follows `timeControlStatus`.
- **Pause is a real pause.** A native app keeps its Now Playing slot while paused (the PWA's core problem),
  so no muting tricks.
- Position: periodic time observer (0.5 s). Resume after relaunch: load paused at the saved second.

## 6. Lock screen, Control Center, headphones

- `MPRemoteCommandCenter`: play, pause, toggle, next, previous, change playback position. Skip ±15 s stays
  **disabled**, so previous/next show (the PWA's first bug).
- `MPNowPlayingInfoCenter`: title, artist = the folder path, album = the profile label, duration, elapsed,
  rate, artwork. Updated on load, on boundary, on play/pause, after seeks.
- AirPlay: system route picker (Control Center); `AVRoutePickerView` in both looks.

## 7. Player model

`PlayerModel` (`@Observable`, main actor) is a port of the PWA's `player.ts`: queue (HumCore `Queue`),
filter (HumCore), dedupe (length + profile variant), history (200), likes, notices, prefetch window,
saved state. The UI only reads it and calls its actions (`toggle`, `next`, `prev`, `seek`, `playNow`,
`jumpTo`, `setFilter`, `toggleShuffle`, `cycleRepeat`, `toggleDedupe`, `toggleLike`). The engine sits
behind a small protocol so unit tests drive the model with a fake engine.

## 8. Looks

Shared screens: sign-in (profile paste → Dropbox), syncing, player. Tabs: **Now · Queue · Sys**, like the PWA.

**Native (A)**
- `TabView` (Liquid Glass on iOS 26) with a `tabViewBottomAccessory` mini player (title + play/pause + next)
  that shows on Queue and Sys.
- Now: artwork, title, folder path, scrubber (`Slider`), transport (SF Symbols, glass buttons), shuffle /
  repeat / dedupe as glass toggles, filter button → sheet with chips per folder level (profile names),
  "Up next" list with played rows above. Rows: tap = play now, context menu = Play now / Like, swipe = Like.
- Queue: `List` from now on, same row actions. Sys: `Form` (account, cache, look, log, sign out).

**Terminal (B)**
- The PWA's screens, pixel-close: header (`hum` + label + sync status), NOW (title, path, 2 px scrubber,
  status row, filter row, notice, rolling list with `○ ● ◐ ▶` marks), filter editor with chips, QUEUE,
  SYS (key/value rows, button rows, log), bottom transport (Prev | Play | Next) and tabs (Now | Queue | Sys).
- Geist Mono Regular/SemiBold 13 pt, `#0c0c0c` / `#161616` / `#222` / `#ececec` / `#9a9a9a` / `#5f5f5f`,
  accent `#FF8000`. Light haptic on transport taps. Long-press a row: native context menu (Play now / Like).

## 9. Demo mode (Simulator, CI, screenshots)

Launch argument `-demo YES`: a made-up library (the test taxonomy), short sine-tone WAV files generated on
the fly, no network, no sign-in. `-initialLook native|terminal` picks the look. The UI tests use it to play, skip,
filter and let a track end (gapless boundary), and to take screenshots of both looks.

## 10. Errors and edge cases

Same wording as the PWA where it applies: `OFFLINE` (plays cached tracks, retries downloads with backoff),
`DROPBOX SIGN-IN EXPIRED` (sign-in screen, cached tracks still play), `SYNC FAILED: …`, `END OF QUEUE`,
`CAN'T PLAY <name>` (skips after 1.5 s). A bad profile shows its validation message.

## 11. Tests

- `HumCore`: `swift test` (Linux container + CI). Port of the TS unit tests + the shared case file.
- `HumTests`: zip reader (a real zip made by Python's zipfile), store round trip, player model with a fake
  engine (filter → queue, next/prev, boundary advance, dedupe toggle, likes, save/restore).
- `HumUITests` (demo mode, both looks): launches, plays, next/prev change the title, filter chips apply,
  a short track rolls into the next one, tabs switch, look switch; screenshots attached.
- CI (`.github/workflows/ios.yml`, public repo only): HumCore tests, then `xcodebuild test` on the newest
  iPhone Simulator; screenshots exported from the result bundle and uploaded as the `screenshots` artifact.
- Owner on the device (§13): lock screen, pause/resume while locked, AirPlay, Bluetooth, long session.

## 12. Build and install (owner, on the Mac)

```sh
brew install xcodegen                     # once
cd ios && xcodegen                        # makes Hum.xcodeproj (re-run after pulling)
open Hum.xcodeproj
```

In Xcode: target Hum → Signing & Capabilities → Team = your team (the bundle id is
`com.rileybarabash.hum`). Pick your iPhone, Run. Put `profile.local.json` at the repo root before building
to skip the paste step. TestFlight later if wanted (Product → Archive → Distribute).

## 13. Milestones

| # | What | Done when |
| --- | --- | --- |
| I0 | Plan, scaffold, CI | this doc; `ios/`; workflow runs on the public repo |
| I1 | HumCore port | `swift test` green here and on CI; shared cases pass in TS and Swift |
| I2 | Services + player | sign-in, sync, cache, engine, lock screen; unit tests green on CI |
| I3 | Two looks + demo | UI tests green on CI, screenshots reviewed |
| I4 | Simulator pass | owner (or computer use on the Mac) runs through both looks |
| I5 | Device | lock screen, locked pause/resume, AirPlay, Bluetooth, an hour of playback |

## 14. Risks

| Risk | Mitigation |
| --- | --- |
| Dropbox rejects the `db-<key>://2/token` redirect | Code-flow fallback on the same screen; or add the URI in the Dropbox console |
| Compile errors only visible on macOS | Small CI loop; HumCore compiled here; code kept plain |
| MP3 gapless gap on AVQueuePlayer | Same engine as the CLI, which is gapless; tested by a UI test boundary |
| Simulator audio differs from device | Device checklist in I5 |
