# Decisions

Status per entry: proposed / accepted / rejected.

## D1: Access Dropbox via HTTP API with a read-only scoped app (proposed)

PKCE + refresh token, stored in gitignored `.secrets/`. See `dropbox-access.md`.

## D2: Download-ahead LRU cache in `.cache/audio/`, with temp-link streaming fallback (proposed)

Gapless, no quality loss, bounded disk use.

## D3: Playback engine: Swift/AVFoundation helper compiled in-repo (accepted 2026-09-27)

- mpv: **rejected**. The owner doesn't want native binaries or apps installed.
- **Accepted: option B.** A small Swift helper in the repo uses AVFoundation (`AVQueuePlayer`) and is compiled on first run into `.cache/bin/` by the already-present Xcode toolchain. The owner's condition: if Xcode ever needs updating or anything needs installing, **stop and tell the owner**; don't work around it.
- Verified: Swift 6.3.3 compiles and runs an `AVQueuePlayer` test in about 6 s cold, with no license or update prompts.
- Fallback if B breaks: built-in `afplay`. The full options table is in `dropbox-access.md`.

## D4: Knowledge base lives in the repo, not in agent memory (accepted)

The owner restricted writes to the repo, so the `~/.claude` memory directory is off-limits. `AGENTS.md` + `docs/kb/` serve as memory. `CLAUDE.md` imports `AGENTS.md` so Claude Code picks it up automatically.

## D5: Round-1 answers (accepted 2026-09-27)

Full table in `questions.md`. In short: Bun runtime; hand-rolled ANSI TUI with zero runtime deps; dedupe length variants keeping the longest; whole-segment filter with unique-prefix fallback; search over name and tags; resume on launch; CLI args start a filter; repeat off/all/one; 2 GB LRU plus a clear shortcut; minimal now-playing; terminal default colors plus one accent; keyboard only; media keys + Now Playing; tree labels are name + count; Ghostty; toggleable shortcut menu.

## D6: Token storage in repo `.secrets/` (accepted)

Keychain is outside the repo, which the scope rule forbids. The file is mode 0600 and gitignored.

## D7: Prefetch depth = 3, downloaded sequentially in queue order (accepted)

Covers the owner's "next 1–3" at the generous end. Sequential ordering keeps the very next track ready soonest.

## D8: Test and watch-along approach (proposed)

Unit tests with `bun test`. PTY end-to-end tests with macOS built-in `/usr/bin/expect`. The watch-along runs in the Claude desktop app's Terminal panel. A cloud machine is not viable (needs macOS audio).

## Assumptions made in `docs/plan.md` (owner may override)

Accent = ANSI yellow; resume auto-plays; the first launch with no state shuffles the default filter (now the profile's `defaultFilter`); tree counts are raw files; `.` toggles raw filenames in the tree; single-instance lockfile; prefetch pauses when free disk is under 1 GB.

## D9: Engine details settled in M1 (accepted 2026-09-27)

- The helper embeds `native/Info.plist` into its binary and runs `NSApplication` with the `.accessory` policy, so macOS sees a named app ("hum") for Now Playing without an `.app` bundle and without a Dock icon.
- Compiled with `-swift-version 5` (avoids Swift 6 strict-concurrency errors in AVFoundation callbacks), with `-module-cache-path` and `TMPDIR` inside `.cache/`.
- IPC uses `setNext` (replace-after-current, with an `after` race guard) instead of separate `enqueue`/`clearNext`.
- `Bun.write(path, Response)` hung on Bun 1.3.9 while streaming a download. Use `saveResponse()` in `src/util.ts` (a chunked file writer) instead.
- Media keys (risk R1) can't be tested by an agent: posting synthetic media keys needs Accessibility permission, which is a system setting. `pnpm test:keys` lets the owner check F7/F8/F9 in 30 s.

## D10: UI details settled in M5/M6 (accepted 2026-09-27)

- `Space` is play/pause in every view, including the tree (folders toggle with `Enter`/`→`/`←`), because play/pause should never depend on which view is open.
- The filter prompt opens empty with the current filter as a dim hint. Prefilling made "type a new filter" awkward.
- In search, letters go to the query; only arrows and `Ctrl+N/P` move.
- A bare `Esc` never swallows the next key (fast typists send "Esc 3" in one read), so Alt-combos aren't supported. None are used.
- First launch: shuffle on, repeat all, volume 100.
- Test hooks: `HUM_MUTE=1` forces engine volume 0; `HUM_STATE=<path>` uses a separate state file.

## D11: Turn-7 features (accepted 2026-09-27)

- **Version dedupe after the filter**, keyed by the other folder levels + name (checked on the real library: no name repeats across those folders). Filtering first means naming a version still selects that version. Kept version: the liked one, else the profile's `variant.prefer` (was the config key `preferLevel` before turn 16). Rejected: a random version per shuffle (the resumed queue would change under the owner) and deduping before filtering (naming a version would then return only songs whose preferred version is that one).
- **One `d` toggle for both dedupes**, per the owner's option (b). Off = every file. Toggling rebuilds the queue around the current song without interrupting it.
- **Favourites are songs, not files**: any length or version shows ♥, the liked version is remembered for playback. Stored in `.data/favorites.json`, a new gitignored dir for data worth keeping (`.cache/` is disposable). Tests get their own file next to `HUM_STATE`.
- **`fav` is a filter term**, not a separate mode, so it composes (`fav dawn`) and works from the CLI (`pnpm play fav`). Favourites view is `4` (views are numbered); `l` likes. Tree lost its `h`/`l` aliases (arrows remain) so `l` means one thing everywhere. A shift-`L` binding was dropped because the help menu shows keys in uppercase and it would read the same as `l`.
- **Rolling list**: history comes from a play log (`history`, last 200, persisted), not the queue's past, so it survives filter changes. The NOW row stays at a fixed height; history is capped at 6 rows.
- **Cover art**: the image host crops to 600×600 (via the profile's `artQuery` since turn 16) and the helper center-crops again as a safety net. Fetched by main into `.cache/art/`, passed to the helper as a file path (in `load`/`setNext`, or an `art` command if it arrives later). This is the only non-Dropbox network call, and it sends nothing about the owner.
- **Seek race fix**: stale `time` events after a seek could overwrite the target position, and quitting then saved the wrong second (this was the `e2e/resume.exp` "flake"). Fixed in the helper (no `time` while a seek is in flight, superseded seeks don't report) and in main (3 s guard).
- **Auth recovery**: the refresh token doesn't expire by itself. If revoked, the footer says so; `pnpm auth start`/`finish` in another terminal fixes it without restarting, since each refresh re-reads the token file, and the flag clears on the next success.

## D12: iPhone player is a static PWA, codename `hum` (accepted 2026-09-28, turn 12)

- **PWA over native:** owner's time budget rules out Xcode builds/device installs for now. iOS 26 supports background `<audio>`, Media Session (lock screen + art) and `navigator.audioSession`. Native (reuse the Swift engine) is the fallback if the W0 spike fails.
- **No server:** Dropbox's API allows cross-origin calls, so PKCE + downloads run in the browser; Vercel hosts static files only. Rejected: Vercel functions proxying Dropbox (moves the token to a server for no gain), a site gate (Dropbox login already protects everything private).
- **One `<audio>` element**, never swapped, next source pre-resolved, advance inside the `ended` handler: the reliable way to keep advancing in the background on iOS. Rejected: two alternating elements (breaks when backgrounded), Web Audio (suspended when backgrounded).
- **Metadata via one `download_zip`** instead of thousands of requests.
- **Cache window prev 2 · now · next 3**, 1 GB LRU cap, `storage.persist()`.
- **pnpm workspace, no Turborepo**; pure core modules move to `packages/core`.
- Vite + Preact + signals, hand-written service worker, `ui-monospace`.

## D13: Git workflow: agents own git, `main` only (accepted 2026-09-28, turn 12)

- The owner doesn't want to touch git or GitHub here. Agents commit to `main` directly; cloud sessions handed a `claude/...` branch fast-forward `main` in the same turn. Rules in `AGENTS.md` "Git workflow".
- Every push to `main` deploys the web app, so only green pushes. Rejected: PRs + preview deploys (Dropbox redirect URIs can't match per-branch preview URLs, and nobody reviews them).

## D14: W0 implementation choices (accepted 2026-09-28, turn 12)

- **Shared core via tsconfig `paths` + workspace package.** Bun honours `paths`, so the CLI runs even before `pnpm install` links `@hum/core` (checked by moving the symlink away). Also moved `squareUrl` (`@hum/core/art`) and `plural/fmtTime/fmtBytes` (`@hum/core/format`); `src/util.ts` and `src/cache/art.ts` re-export them.
- **Code sign-in fallback** next to the redirect (plan-web §6).
- **Cached audio plays from blob: URLs** read out of Cache Storage (no service-worker range handling needed). Downloads use `files/download` with the Authorization header, so temporary-link CORS never matters for caching; temp links are only used as `<audio src>` for streaming.
- **Prev 2 are pinned, never downloaded**: they're only kept if already cached.
- **SYS tab + persisted event log** for the spike, `[bg]` = logged while hidden.
- **Glyphs** get U+FE0E so iOS draws ▶ ⏮ ⏭ as text, not emoji.
- Browser smoke test uses `playwright-core@1.56.1` (matches the container's Chromium 1194); on the Mac it falls back to installed Chrome or `CHROMIUM_PATH`.

## D15: Stream engine (MediaSource), lock-screen buttons, two-phase sync, Geist Mono (accepted 2026-09-28, turn 13)

- **Why the element engine failed with the lock screen lit:** the log shows `ended` firing in the background, `src` swapped and `play()` called, but the promise only resolved when the page became visible. WebKit defers starting new media for a page it doesn't consider visible; with the screen off it didn't. Any design that changes `src` at a track boundary depends on that quirk.
- **Stream engine** (`web/src/engine/stream.ts`): one MediaSource (ManagedMediaSource on iOS 17.1+) with one `audio/mpeg` SourceBuffer in `sequence` mode. Tracks are appended back to back (ID3v2 stripped, ID3v1 trimmed, parser reset between files), ~120 s ahead of the playhead, 20 s kept behind. The element never ends at a track change, so there's nothing to defer, and there's no gap. Boundaries are detected on `timeupdate` (playhead crosses the next segment's start) and reported to the player, which advances the queue and updates the lock screen. Jumps drop the buffer and start a new segment a second ahead on the same timeline. Uncached tracks stream with `Range` reads from `files/download` (206, or a 200 read-and-skip fallback); dropped connections resume at the exact byte. `disableRemotePlayback = true` is required by ManagedMediaSource; AirPlay should still work as an audio route (to verify).
- **Engine choice** in SYS: AUTO (stream if `audio/mpeg` is supported in MSE, else element) / STREAM / ELEMENT, stored in IndexedDB, reloads the page. The element engine stays as the fallback, with a sturdier resume seek (retries until the element accepts `currentTime`).
- **Lock screen:** Safari adds ±10 s buttons by default and shows them instead of previous/next. We now clear `seekbackward`/`seekforward` explicitly and re-register all handlers on every `playing`. Position state is per track (the stream timeline runs across tracks). *Unverified on iOS until the owner tests.*
- **Two-phase first sync:** phase 1 = listing only (a few seconds; names from file names, no durations/art) → player starts; phase 2 = the metadata zip in the background with a live `… · N s` counter in the header, then the queue is rebuilt around the current song. A library saved after phase 1 (e.g. iOS reloaded the page) re-runs phase 2 on the next launch. Measured on the phone: Dropbox took 38 s to produce the zip.
- **Look:** Geist Mono (self-hosted from `@fontsource-variable/geist-mono`, only the needed subsets load) at one size (14 px) everywhere, inputs included (`maximum-scale=1` stops iOS zooming on focus). PLAYED/NEXT became their own label rows (a label column doesn't fit at one size). Transport is text: PREV · PLAY/PAUSE · NEXT.

## D16: Turn-14 fixes and restyle (accepted 2026-09-28)

- **Filter: OR within a dimension, AND across** (core, so the CLI gets it too): `dawn azure indigo` = dawn AND (azure OR indigo). Dimensions are learned from the tracks (`dimensions()`), `fav` is its own. hum's filter sheet shows chips per dimension (the profile's folder levels, in the profile's order), greys values with no songs given the other dimensions.
- **Stream engine ops are serialized** (a promise chain): a skip's `load` and the `setNext` right after it used to interleave, and the second cancelled the first mid-way. Superseded skips are dropped. Suspected cause of the stale lock-screen flash; also the lock-screen metadata is set again once the new track is at the playhead.
- **Soft jumps:** a skip appends the new track after the buffered range and seeks there once data is in, instead of emptying the buffer first. The old track keeps sounding for ~0.1–0.3 s instead of silence, and the element never sits empty.
- **One track beyond the current, max:** found in screenshots: short tracks (< the 120 s buffer target) made the engine queue the same next track forever. Matters for TikTok sounds.
- **Lock-screen pause = mute (stream engine, page hidden only):** iOS drops a web app's audio session soon after a background pause, so play then did nothing and later handed the widget to Spotify. Now pause mutes and keeps playing; play jumps back to the paused point and unmutes; a remote "pause" while muted-paused acts as play (iOS may still show a pause icon); unlocking turns it into a real pause; after 10 min muted it becomes a real pause (battery). Unverified on iOS.
- **Art preload:** the next 3 tracks' 512² cover images are fetched with `new Image()` so the lock screen gets them from cache.
- **Faster launch:** the service worker serves the cached shell at once and refreshes it in the background (a deploy shows up one launch later); `storage.persist()` no longer awaited. Shell cache `hum-shell-v2`.
- **Restyle** (owner's ALTERED reference): monochrome (`#0c0c0c` bg, `#161616` selected row, `#222` rules, `#ececec`/`#9a9a9a`/`#5f5f5f` text), Geist Mono 13 px, rows padded 1ch × 3ch, sentence case labels, segmented bottom bars (Prev | Play | Next, Now | Queue | Sys), accent `#FF8000` only for the playing dot and the now-row marker. Icon: `hum` + orange rule.
- **Test tooling:** `web/e2e/fake.mjs` (MP3 fixtures, fake Dropbox, server, browser), `smoke.mjs` (27 checks), `shots.mjs` (`pnpm --filter web shots`, screenshots with a realistic library; `HUM_URL=` points either at a deploy).

## D17: Native iOS app stack (accepted 2026-09-29, turn 16)

**Proposal:** Swift 6 + SwiftUI (UIKit only where SwiftUI lacks an API), iOS 26 minimum, **zero third-party dependencies**. AVFoundation `AVQueuePlayer` for playback (the CLI's `native/humplayer.swift` already proves it is gapless on MP3), `MPNowPlayingInfoCenter` + `MPRemoteCommandCenter` for the lock screen, `AVAudioSession(.playback)`. Dropbox over plain `URLSession` (PKCE via `ASWebAuthenticationSession`, token in the Keychain), no SwiftyDropbox. Library + state as JSON files in Application Support; audio cache as files in Caches with background `URLSession` downloads. `packages/core` (~500 lines TS) is ported to a Swift package `HumCore` with shared JSON fixtures that both test suites run, so filter/queue/search behave identically on CLI, PWA, and app.

**Why:** the PWA's remaining bugs (lock-screen pause dropping Now Playing, scrubber jumps, background `play()` stalls) are WebKit media-session limits, not our code. Native audio sessions keep Now Playing while paused. Expo would put the most important part (audio + remote commands) behind a community native module (react-native-track-player / expo-audio) plus a JS bridge, for sharing ~500 lines of pure logic; OTA doesn't matter for a single-user app. Capacitor keeps the WebKit audio stack, i.e. the same bugs. Native has the least integration code for this app: the platform already is the player.

**Rejected:** Expo (bridge + native-module risk for the core feature, runtime errors, bigger bundle); Capacitor (same WebKit audio); Kotlin Multiplatform / JavaScriptCore for sharing core (more machinery than the code it shares); SwiftData (plain JSON is enough and easier to debug); SwiftyDropbox (a dependency for 4 endpoints).

Turn 16 answers: Apple Developer Program (paid) available; XcodeGen via `brew install xcodegen` OK; M2 Air with Xcode 26.6; CI on GitHub Actions with the repo made public (unlimited macOS minutes). Two looks in one app (D19).

## D18: Public repo, library profile, one-commit history (accepted 2026-09-29, turn 16)

- The owner made the repo public (renamed to `hum`) for free macOS CI minutes, and asked for **every trace of the source service and the library's specifics** to be removed: service name, Dropbox paths, taxonomy (folder names), metadata field names, the "level" concept tied to the service, track names, counts. Their stated reason: personal use of files they already have, and not helping anyone misuse the service's content.
- **Library profile** (`docs/profile.md`, `packages/core/src/profile.ts`): the library root, tracks/metadata folders, names per folder level, display order, the variant level (+ preferred value and fallbacks), an art query, a default filter. Gitignored `profile.local.json` for the CLI (and bundled into the iOS app at build time); pasted once in the PWA and the app otherwise.
- **Generic model:** `Track.dims` (folder names) replaces the three fixed fields; `Track.tags` = every string list in the metadata replaces the named tag fields; `dedupeVariants(tracks, profile.variant)` replaces the level dedupe; `artUrl(url, profile.artQuery)` replaces the image-CDN crop helper. Library format v3 (older libraries are rebuilt from the cached metadata on disk, no network). Favourite keys are unchanged for the owner's layout (other levels + name).
- **Tests and docs use a made-up taxonomy** (times of day / colours / shades) that keeps the old edge cases: an exact name that is also a prefix, an ambiguous cross-level prefix, a hyphenated name. The Mac-only e2e scripts pick their values from the owner's own library at run time (`e2e/values.ts`).
- **History:** the owner chose to squash all history into one commit and force-push (the repo stayed public meanwhile). Old session branches deleted.
- **PWA frozen:** `web/vercel.json` turns git deployments off; the installed PWA keeps its last build.
