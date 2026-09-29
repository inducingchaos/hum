# Requirements

Captured from the owner's first brief (2026-09-27). Keep this close to their words.

## Source

- The owner's own music library, saved in their Dropbox (path in the gitignored library profile, `docs/profile.md`).
- Tens of GB of audio. The owner does **not** want it all on disk.
- Metadata files were saved alongside the tracks; use them for track names etc.

## Playback

- Play / pause / repeat / skip / search.
- List, and shuffle within a nested folder.
- **Filter-shuffle by path segments.** A query like `grey dark` plays only tracks whose path matches *all* terms (e.g. `grey/dark`, not `jade/mid` or `azure/dark`). A query like `dark` matches `azure/dark`, `jade/dark`, etc. (made-up folder names; see `test/fixtures.ts`)
- **Pre-load the next 1–3 tracks.** No loading spinners when avoidable, no gaps between tracks.
- No transitions or animations. Snappy.
- Output through the Mac's audio (built-in or a connected speaker).
- Quit with Ctrl+C, or maybe a cute little power button.

## Controls (added round 1)

- **100% keyboard-controllable**, with a **toggleable menu that shows all shortcuts**.
- Media keys: the owner uses next/prev/play/pause from their MacBook Air (M2) control strip / media keys. Must work.
- A shortcut to clear the audio cache.
- Terminal: **Ghostty**.

## Tree view mode

- Scrollable visual file tree of all folders.
- Toggle folders open/closed to reveal contained MP3s (if not too hard).
- Defaults: all folders expanded, all files hidden.
- For visibility/exploration only; no click-to-play needed yet.

## Look and feel

- Hyper-minimal, brutalist, retro. Still shows track name and other metadata.
- "Performant, aesthetic, low-effort."

## Turn 7 additions (after the first hands-on test)

Owner tested `pnpm play` and `pnpm test:keys`: both work, media keys included (R1 closed). New asks, close to their words:

- Fill the empty space between "next" and the bottom bar with recents/history, **integrated with up next** as one rolling list: a pointer at now playing, a played label at one end, an up-next label at the other. A summarized queue on the main page.
- Flag songs as favourites, view them in a list (like the `f` search view), and shuffle favourites.
- Use the metadata image URL as a correctly cropped thumbnail in the macOS Now Playing widget.
- The queue has the same song in several versions (one folder level holds alternate versions): "they sound the same". Dedupe those during shuffle/playback like lengths. To get a specific version, filter for it, and/or a toggle for deduping lengths and versions.
- Asked: what happens if Dropbox auth times out, and how to re-auth.

## Tech

- Simple CLI: `cd` into the repo, run `pnpm play`.
- Owner assumed TypeScript run via tsx or a bash bin file, but is open to something better if justified.
- Local-first, no server.
- **No native binaries, apps, or system integrations installed** (e.g. no mpv). Prefer pnpm packages and built-in shell commands. If that's impossible, describe the limitation and present options.
- Storage options the owner listed: (a) stream directly from Dropbox, (b) short-lived cache in a gitignored folder inside the project, (c) anything else viable.

## Process

- Agent may change anything inside the repo; nothing outside it. Dropbox is read-only.
- Commit and push on every change.
- Maintain an in-repo knowledge base every turn (sessions may be compacted, models switched).
- Note that searching other Claude/Claude Code chats can recover context.

## Phase 2: iPhone player (turn 10, 2026-09-28): exploring, not approved

Owner, close to their words: how hard would a **PWA player** be, in a similar aesthetic, that they authenticate with (deployed on Vercel, frontend and functions if needed), working as a simple, minimal, **better app for this library** that plays tracks the way the CLI does. Goal: carry the CLI experience (prefetching, minimal interface, own files, performance, caching) to the iPhone; do the basic actions by touch; play to a speaker from the phone; native **lock screen controls**, ideally with the thumbnail.

- Design references: the TUI player view, and two of the owner's projects (ALTERED "thought editor": dark, monospace list with dim secondary text, keycap hints in a bottom bar; a monospace Markdown landing page with an orange accent link).
- Repo: same repo is fine, possibly Turborepo; diverging is OK if justified.
- Native iOS app considered and set aside (build waits, Swift networking, getting it on a device) unless there's a better strategy. Push web/PWA as far as it goes.
- Process: brief rundown, question rounds (several if answers branch), then a plan. **Ask before external approvals** (Vercel, Dropbox console changes).

### Round 2 + 3 answers (turns 11–12)

- Per-device state; no server; library built on the phone; prefetch window plus "a few history" (keep the last 2 played cached); v1 scope as proposed; Vite + Preact (owner hasn't used Preact); blend look; iOS 26.6.2; Bluetooth speaker, AirPlay to the Mac via Control Center; `*.vercel.app` with a clean codename: **`hum`**.
- Owner doesn't want to touch git/GitHub for this repo: agents push to `main` and write their own rules (AGENTS.md).
- Owner connects Vercel and adds the Dropbox redirect URIs once `web/` exists, then reports back.

### Turn 13: first iPhone test (the Vercel deployment)

Owner's findings, close to their words:
- Works "really well" for play/pause. Lock screen shows art, title, subtitle and a scrubber, **but ±10 s buttons instead of previous/next**.
- **Next track while locked is buggy:** with the screen off it advances and plays; with the lock screen lit, the metadata switches to the next song but the audio doesn't play until the app is opened again.
- **First sync looked frozen:** the "LISTING n" counter sat for ~2–3 minutes before the player appeared.
- Switch the font to **Geist Mono** (their other projects and terminal use it) and use **one font size everywhere**, like a terminal.
- Resume after force-quit: UI showed the right track at 0:05 but audio played from 0:00, and the clock didn't move.
- Bluetooth, AirPlay, silent switch: not worth testing separately (system audio). Offline: later. Long run: skipped because advance was flaky.
- Owner enabled all network egress for the environment; the running container still gets 403 from the proxy for vercel.app / Dropbox (probably applies to new sessions).

### Turn 14: iPhone round 2 + new direction

Owner (voice-typed via Wispr Flow from now on; long, conversational messages are expected):
- Round 2 results: stream support line = `ManagedMediaSource, audio/mpeg yes`. Lock screen shows **prev/next** now ("perfect"). Next track plays with the lock screen lit and with the screen off. AirPlay to the Mac works (Control Center). Force-quit + reopen resumes at the right second. Bluetooth/silent switch: fine (system audio).
- Bugs: (1) filter sheet had no chips for the second folder level; wants e.g. one first-level value + two second-level values. (2) On a skip, the lock screen sometimes shows an older track's title/art (~250 ms) before the right one. (3) Lock-screen art pops in ~0.75–1 s after a skip (instant when going back). (4) Pause on the lock screen, then play: no audio (clock moves, then snaps back); after ~1 min paused, play goes to Spotify/the last music app. (5) Cold start after force-quit ~4 s.
- "As long as the playback works in the most basic way and we don't have a ton of bugs, that's all I care about." Fix what's fixable; frame the rest.
- **Style:** move toward the ALTERED thought editor (the "Koa remembers decisions" screenshot): pure monochrome, minimal/brutalist rather than retro CLI. Geist Mono **13px**, ~3ch horizontal padding, ~1ch vertical row padding. Optional accent **#FF8000**, sparingly. Keep the CLI's structure.
- **TikTok audio phase** (parked, record only): see `docs/plan-tiktok.md`.
- Network: full egress now works in this environment (verified: Vercel, Dropbox CORS).

### Turn 15: iPhone round 3 + Phase 3 (native iOS app)

Round 3 results, close to the owner's words:
- Skips: good. Scrub bar jumps 40–60% for ~150 ms on a skip (iOS quirk or the "infinite" stream strategy). Art is instant most times.
- **Lock-screen pause still broken:** pausing while locked (or with another app focused) exits hum's Now Playing and reverts to Apple Music/Spotify or "Not Playing". Only works while hum is focused and unlocked. The muted-pause trick didn't help.
- Cold start ~1.2–2 s grey → content, intermittent. "Good enough."
- The folder filter chips work great. The look is "good enough, no need to fine tune".
- **PWA is good enough for now.** Next: **a native iOS app** replicating the PWA, but more performant, less buggy, more integrated, more stable. Agent picks the stack and justifies it. Owner's criteria: (1) least integration code / tech debt, (2) lowest chance of bugs and durability errors (strong typing; wary of likely-AI-written open-source deps), (3) best standalone stack qualities (performance, features, bundle size, community). Owner likes Expo for React/TS sharing and OTA, but knows its quirks; sees Swift/SwiftUI as safer and more native.
- Same process: synthesis → question rounds → plan → build end to end and test → review together. Cloud first; then possibly move local and use computer use on the Simulator, then the owner's device.
- Asked whether they can fix the Chromium proxy-certificate problem: fixed by the agent (see `environment.md`).

### Turn 16: iOS decisions, public repo

Round 4 answers, close to the owner's words (full list in `questions.md`):
- Native Swift/SwiftUI: yes. Paid Apple Developer account: yes. `brew install xcodegen`: OK. M2 Air, Xcode 26.6 (could go to 27.0 or the 27.2 beta if needed).
- CI on GitHub Actions: yes, and **make the repo public** for free runner minutes, after making sure nothing sensitive is in it. The owner renamed it to `hum` and made it public.
- **Redact everything about the source service and the library** (name, paths, folder names, metadata field names, the level concept, track names) across the repo: replace with placeholders or generic, metadata-driven logic, and search again until nothing is left. Owner's words on intent: the tracks are files they already have, for personal use, testing their own player; the redaction is to keep bad actors from getting ideas, not to hide anything. Squash the history too (repo stays public meanwhile).
- **v1 = exact parity with the PWA, in two looks** (the owner's challenge): **A** as native as possible (SwiftUI, Liquid Glass tab bar, context menus, SF Symbols) while still being "our retro player"; **B** replicates the PWA look 1:1 or better, with native integration underneath.
- Name `hum`, bundle id `com.rileybarabash.hum`. Start fresh on the phone (resync, no migration).
- PWA: freeze, don't delete, no new deploys.
