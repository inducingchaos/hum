# hum

A tiny player for a personal music library kept in Dropbox. Three front ends share one core:

- **CLI** (`src/`): brutalist, keyboard-only terminal player, gapless, media keys. macOS.
- **iOS app** (`ios/`): native Swift/SwiftUI, two looks (native and terminal). See `docs/plan-ios.md`.
- **PWA** (`web/`): the earlier home-screen web app. Frozen: no new deploys.

Nothing about a particular library is in the code. Where the library lives and how its folders are organised is a small **library profile** you keep out of git: see `docs/profile.md`.

```
 HUM ───────────────────────────────────────────────────────────────────────── ⏻
 QUIET HARBOUR  ♥
 dawn / azure / mid

 █████████████████████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  12:04 / 30:00

 ▶ PLAYING   SHUF   RPT:ALL   DEDUP   VOL 100                          12 / 47
 FILTER  azure mid · 47 songs

  ↑ PLAYED   Paper Kites                             dawn/azure/mid
             Salt and Glass ♥                        dawn/azure/mid
       NOW ▶ Quiet Harbour ♥                         dawn/azure/mid
           ● Northbound                              dawn/azure/mid
    ↓ NEXT ◐ Long Division                           dawn/azure/mid
─────────────────────────────────────────────────────────────────────── ? KEYS ─
```

## Use (CLI)

```sh
pnpm play                    # resume where you left off
pnpm play azure mid          # every */azure/mid folder
pnpm play night ochre        # night/ochre/*
pnpm play fav                # shuffle your favourites
pnpm play all                # shuffle everything (in the player: / all)
./play …                     # same thing, ~300 ms faster (skips pnpm)
```

(Folder names in these examples are made up; yours come from your library.)

Filter terms match whole folder names (`mid`, `midnight`), hyphen-free forms (`seagreen`), or unique prefixes (`gre`). Ambiguous prefixes (`mi` = mid or midnight) are rejected instead of guessed. Terms from different folder levels must all match; terms from the same level are alternatives: `dawn azure indigo` plays dawn tracks that are azure or indigo. `fav` means your favourites and combines with the rest (`fav dawn`).

Each song plays in one version: the longest length and, if the profile names a `variant` folder level, the preferred value there. Name a value to get that one, or press `d` to queue every file.

Press `?` in the player for every shortcut. The essentials:

| Key | |
| --- | --- |
| `Space` · `n` · `p` | play/pause · next · previous |
| `←` `→` (`⇧` for 60 s) | seek 10 s |
| `/` · `f` | filter by folder · search names and tags |
| `s` · `r` · `d` | shuffle (`s s` reshuffles) · repeat off/all/one · one version per song |
| `l` | like / unlike the playing song ♥ |
| `1` `2` `3` `4` | player · queue · folder tree · favourites (`a` shuffles them) |
| `C` · `q` | clear cached audio · quit |
| F7 F8 F9 | media keys, Control Center, AirPods |

## Setup (once)

Needs Bun, pnpm, and Xcode's Swift toolchain (the audio engine compiles itself into `.cache/bin/` on first run, about 10 s). Nothing is installed outside the repo.

```sh
pnpm install
cp docs/profile.example.json profile.local.json   # then edit it for your library
pnpm auth start          # open the URL, click Allow, copy the code
pnpm auth finish <code>
pnpm play                # first run indexes the library
```

**If Dropbox access stops working.** The refresh token doesn't expire by itself; it only stops if the app is revoked in Dropbox (Settings → Connected apps) or disabled. The player then shows `DROPBOX AUTH EXPIRED` and keeps playing cached songs. To fix it, run `pnpm auth start` and `pnpm auth finish <code>` again. That works in another terminal while the player runs: the next skip picks up the new token.

## How it works

- **Dropbox, read-only.** A scoped app with `files.metadata.read` + `files.content.read`, PKCE refresh token in `.secrets/` (gitignored), and an endpoint allowlist in code.
- **Library.** Listed once into `.cache/library.json`; later launches load it in ~5 ms and pick up changes in the background. Length variants of the same song collapse to the longest one, and the profile's variant level to one value.
- **Metadata.** Optional JSON per audio file (same file stem). Read generically: `name`/`title`, `duration`, `bpm`, an image URL, and every list of strings becomes a search tag.
- **Audio.** `native/humplayer.swift`, an AVQueuePlayer helper driven over JSON lines. Gapless handoff, streaming for uncached tracks, Now Playing and media keys.
- **Cache.** The current track plus the next 3 are kept on disk (downloaded one at a time, in order) inside a 2 GB LRU in `.cache/audio/`.
- **Cover art.** The metadata's image, shown in macOS Now Playing (`.cache/art/`).
- **Your data.** Favourites are in `.data/favorites.json` (gitignored, not a cache: keep it). Playback state and history are in `.cache/state.json`.

## Commands

| | |
| --- | --- |
| `pnpm sync` | full re-index |
| `pnpm cache:clear` | delete cached audio |
| `pnpm test` | unit tests |
| `pnpm test:e2e` | terminal end-to-end tests (muted; values picked from your library) |
| `pnpm test:engine` / `test:player` | audio engine / controller smoke tests (muted) |
| `pnpm test:keys` | press F7/F8/F9 to check media keys (audible, quiet) |
| `pnpm typecheck` | TypeScript |

Settings can be overridden in a gitignored `config.local.json`, e.g. `{ "accent": "cyan", "cacheCapBytes": 5e9 }`.

Docs: `docs/plan.md` (CLI design), `docs/plan-ios.md` (iOS app), `docs/plan-web.md` (PWA), `docs/kb/` (project knowledge base), `AGENTS.md` (rules for coding agents).

## PWA (frozen)

`web/` is the home-screen web app: lock-screen controls, prefetch, resume. No server: it signs in to Dropbox from the phone and a static host serves the files. It asks for the library profile once, on the sign-in screen.

```sh
pnpm web                   # dev server on :5173
pnpm web:check             # typecheck + unit tests + build
pnpm --filter web e2e      # browser smoke test against a fake Dropbox
```

Shared logic (filter, queue, search, library model, profile) lives in `packages/core` (`@hum/core`); the iOS app has a Swift port (`ios/HumCore`) checked against the same cases.
