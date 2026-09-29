# Plan: `pnpm play`, a music-library player for the terminal

Status: **approved** by the owner on 2026-09-27 (turn 6), including the ASSUMPTION items. Now being built.
Sources: `docs/kb/requirements.md`, `docs/kb/questions.md` (answers), `docs/kb/dropbox-structure.md`, `docs/kb/decisions.md`.

**Turn 16:** the repo went public, so every library specific was taken out of the code and docs. Folder names, paths and counts now come from the gitignored library profile (`docs/profile.md`); the examples below use a made-up taxonomy (times of day / colours / shades).
Anything marked **ASSUMPTION** is a call I made without asking. Override any of them by saying so.

---

## 1. Goals and non-goals

**Goals**
- `cd` into the repo, run `pnpm play`: music starts within about half a second (warm), resuming where you left off.
- Filter-shuffle by path segments (`grey dark`), search by name and tags, list a folder in order, repeat modes.
- No gaps between tracks and no spinners: the current track plus the next 3 are always on disk.
- 100% keyboard-controlled, with a toggleable shortcut menu (`?`).
- macOS media keys, the Control Center / Now Playing widget, and AirPods taps control it.
- Hyper-minimal, brutalist, retro look: terminal default colors plus one accent, no animations.
- Folder tree explorer: all folders expanded, files hidden, each folder can be toggled open.
- Nothing installed outside the repo. Dropbox stays read-only.

**Non-goals (for now)**
- Playing from the tree view (it is for exploring only; see §14 Later).
- Cover art, visualizers, crossfades, EQ.
- Multi-device sync or any server.
- Windows or Linux support (the audio engine is macOS-only by design).

---

## 2. Architecture

```
┌──────────────────────────── Ghostty ────────────────────────────┐
│  bun src/main.ts   (one process: UI, state, library, cache)     │
│   ├─ ui/        hand-rolled ANSI renderer + key input            │
│   ├─ core/      queue · filter · search · repeat · state store   │
│   ├─ library/   index sync (Dropbox cursor) + metadata join      │
│   ├─ cache/     LRU audio cache + prefetcher                     │
│   ├─ dropbox/   read-only client (allowlisted endpoints)         │
│   └─ engine/    spawns + talks to the Swift helper (JSON lines)  │
│            │ stdin/stdout                                        │
│            ▼                                                     │
│  .cache/bin/humplayer   (Swift, AVFoundation, compiled in-repo)   │
│   AVQueuePlayer · MPNowPlayingInfoCenter · MPRemoteCommandCenter │
└─────────────────────────────────────────────────────────────────┘
          │ HTTPS (read-only)
          ▼
   Dropbox API: list_folder(/continue), download, get_temporary_link
```

- **One Bun process** owns all state. The **Swift helper** only does audio output and macOS media integration. It holds no playlist logic and just follows commands.
- There is no server and no daemon. When you quit, both processes exit. The helper also exits by itself if its stdin closes (parent died), so audio never keeps playing orphaned.

---

## 3. Tech stack

| Concern | Choice | Why |
| --- | --- | --- |
| Runtime | **Bun** (installed, 1.3.9) | Runs TS natively, about 20 ms startup, built-in `fetch`, file I/O, spawn, and test runner. |
| Package manager | pnpm (scripts only) | Owner's workflow: `pnpm play`. |
| Runtime deps | **none** | The whole UI is hand-rolled ANSI. Dropbox is plain `fetch`. |
| Dev deps | `typescript`, `@types/bun` | `pnpm typecheck`. Installed into `node_modules/` in the repo. |
| Audio | Swift helper, `swiftc -O`, compiled into `.cache/bin/` | Gapless, streams HTTPS, seek, media keys. Verified that it compiles without prompts. |
| Tests | `bun test` + macOS built-in `/usr/bin/expect` for PTY-level end-to-end tests | Nothing to install. |

`package.json` scripts:

| Script | Does |
| --- | --- |
| `pnpm play [terms…]` | Start the player. With terms, start that filter-shuffle. |
| `pnpm auth start \| finish <code> \| check` | Dropbox PKCE auth (ported from `scripts/` to TS). |
| `pnpm sync` | Force a full library re-index. |
| `pnpm cache:clear` | Delete cached audio (also available in-app with `C`). |
| `pnpm test` / `pnpm typecheck` | Checks. |
| `pnpm explore` | Keep the existing exploration script (dev only). |

Overhead note: pnpm 11 takes ~220 ms just to start, so `pnpm play` shows its first frame at ~400 ms. The `./play` shim runs Bun directly (~70 ms). Both work; `pnpm play` stays the documented way.

---

## 4. Repo layout (target)

```
AGENTS.md  CLAUDE.md  README.md  package.json  tsconfig.json  .gitignore
docs/plan.md  docs/kb/*
native/humplayer.swift            # audio helper source (committed)
src/
  main.ts                        # entry: args, bootstrap, crash-safe terminal restore
  config.ts                      # defaults + optional config.local.json (gitignored)
  dropbox/client.ts              # token refresh, rpc allowlist, download, temp link
  library/{sync,normalize,model}.ts
  core/{filter,search,queue,state,store}.ts
  cache/{lru,prefetch}.ts
  engine/{build,helper}.ts       # compile-if-stale + IPC wrapper
  ui/{term,render,keys,theme}.ts
  ui/views/{player,queue,tree,search,help,prompt}.ts
  cli/{auth,sync,cache-clear}.ts
test/  (unit)   e2e/ (expect scripts)
.cache/   (gitignored) index.json · library.json · meta/ · audio/ · bin/ · state.json · log.txt
.secrets/ (gitignored) dropbox.json
```

The `scripts/*.mjs` files get folded into `src/` and deleted once ported. `pnpm explore` moves to `src/cli/explore.ts`.

---

## 5. Data model

```ts
Track {
  id            // from the file stem (<slug>-<id>), unique across the library
  stem, path, fileName
  name          // display name from metadata (name/title), else from the slug
  dims          // folder names under the tracks folder, lowercase, one per profile dimension
  duration, size
  tags[]        // every list of strings in the metadata (search)
  bpm?          // undefined when 0/1
  image?        // metadata image URL, for Now Playing art
}
```

- **Normalization** (`packages/core/src/normalize.ts`): split comma-joined list values, trim, dedupe. Treat `bpm <= 1` as unknown. Lowercase the path segments.
- **Length-variant dedupe (answer 1a):** group by `songKey` (folder + name) and keep the longest variant. The tree view still shows every file.
- **Version dedupe (turn 7):** one folder level (the profile's `variant`) holds versions of the same song that sound alike, so the queue also keeps one version per song (`groupKey` = the other levels + name). It runs **after** the filter, so naming a version still plays that version. The version kept is the liked one for favourites, else the profile's `variant.prefer`, then its `fallback` list in order. `d` toggles both dedupes off (every file) and back on; the current song keeps playing. Search lists every version (one row each, folder shown) so a specific one can be picked.

---

## 6. Library sync

- **First run:** recursive `list_folder` on the profile's library root (seconds). Download any metadata not already in `.cache/meta/` at 12 concurrent requests (about a minute cold). Join MP3s to metadata by file stem and write `.cache/library.json` plus the cursor.
- **Every later launch:** load `library.json` synchronously (a few ms), render, then run `list_folder/continue` **in the background** and apply adds and deletes. The UI never waits on this.
- Missing metadata for a new MP3 falls back to a title-cased name built from the slug, and the metadata fetch is retried later.
- The first-run progress line is the one legitimate "loading" state: `INDEXING 1,204 / 2,345`.

---

## 7. Filter, search, and lists

### Filter (answer 2a): `/` or CLI args
- The query is split on whitespace. Each term matches one of the track's path segments. **Terms in different dimensions are ANDed; terms in the same dimension are ORed** (turn 14: `dawn azure indigo`).
- A term matches a segment if it:
  1. equals it exactly (`mid`, `midnight`),
  2. equals it with the hyphen removed (`seagreen`),
  3. equals one hyphen part (`green` → `sea-green`), or
  4. is a **unique prefix** across all segment values (`gre` → grey, `mi` → **ambiguous** between mid and midnight, so it's shown as an error).
- The segment vocabulary is small (tens of names), so prefix checks are instant.
- The prompt previews live while you type: `→ 124 songs` or `mi? mid · midnight`. **Tab** completes the current term.
- An empty filter means everything. Since an empty `Enter` in the prompt cancels, **`all`** (also `everything`, `*`) is the explicit way to clear the filter: `/all`, `pnpm play all` (turn 8).
- **Reshuffle / reset the queue:** `s` twice (off, then on) reshuffles everything after the current song. Re-applying a filter builds a fresh queue and starts a new song.
- Examples: `grey dark` → every `*/grey/dark` folder. `dark` → every `*/*/dark` folder. `night ochre` → night/ochre/*.
- **`fav` (turn 7)** is a pseudo-folder for favourites and combines with the rest: `fav`, `fav dawn`, `pnpm play fav`. Aliases: `favs`, `favorites`, `favourites`, `♥`; `fa` completes to it (`f` alone can be ambiguous with a folder name).

### Search (answer 3b): `f`
- Case-insensitive, all terms ANDed. It matches against the name and the metadata tags.
- Ranking: name prefix > name word > name substring > exact tag > tag substring. Ties go to the shorter name.
- The results list shows one row per song (dedupe applies) with its path. **Enter** plays it now, and the queue then continues with the current filter.

### List / in-order play
- `s` toggles shuffle. With shuffle off, the queue is the filtered set in path order (folder by folder → name). That covers "list and play a nested folder".

---

## 8. Queue, repeat, history

- **Queue** = the ordered list of song IDs for the current filter plus a cursor. Shuffle uses Fisher–Yates once when the filter is applied, and the order is persisted so resume keeps it.
- **Next** (`n`, or the media next key): move the cursor forward.
- **Prev** (`p`, or the media prev key): if more than 5 s into the track, restart it. Otherwise step back through history.
- **Repeat (answer 6a):** `r` cycles **off → all → one**.
  - Off: stop after the last song; the screen shows `END OF QUEUE`.
  - All: at the end, reshuffle, making sure the first new song isn't the one just played.
  - One: loop the current track gaplessly by enqueueing the same item again.
- Changing the filter replaces the queue and starts the first song immediately.
- **History (turn 7):** every song that starts playing is appended to `history` (last 200, persisted). The player view shows the most recent ones above the current song.
- **Favourites (turn 7):** `l` likes or unlikes the playing song. A favourite is a song (any length or version shows ♥), and it remembers the exact version that was liked. Stored in `.data/favorites.json` (gitignored; `.data/` holds things you'd miss, unlike the disposable `.cache/`). View `4` lists them; `a` shuffles all of them (the `fav` filter).

---

## 9. Audio cache and prefetch

- Location: `.cache/audio/<id>.mp3`. Writes go to `<id>.mp3.part`, then get renamed. The byte size is checked against the listing.
- **Window:** the current track plus the **next 3** are pinned. The prefetcher downloads them **one at a time in queue order** (current first), so the next track is always the first thing ready. When the queue changes, downloads for tracks that left the window are cancelled with an `AbortController`.
- **LRU cap: 2 GB (answer 7a).** Eviction goes by last-played time and never touches pinned files. Every download rechecks the cap. At the median 27 MB per file that's about 70 tracks, so replaying recent favorites costs nothing.
- **Clear shortcut (answer 7a):** `C`, with a `y/n` confirm, deletes all unpinned cached audio and shows the freed size. There's also `pnpm cache:clear`.
- **Uncached jump** (search pick, a new filter, fast skipping): immediately call `get_temporary_link` and hand the HTTPS URL to the engine, which streams it with AVPlayer. At the same time the file is downloaded into the cache. The player starts in about 1 s instead of waiting for the full download.
- **Gapless handoff:** once the next track is on disk, the engine is told `enqueue(next)`, so AVQueuePlayer switches tracks with no gap.
- **Offline:** if the network fails, the header shows `OFFLINE` and the queue temporarily narrows to cached songs. Downloads retry with backoff.
- The UI shows cache state per upcoming track: `●` cached, `◐` downloading, `○` not yet.

---

## 10. Audio engine (Swift helper)

**Build** (`engine/build.ts`): hash `native/humplayer.swift` and compare it with `.cache/bin/humplayer.sha`. If stale, run `swiftc -O native/humplayer.swift -o .cache/bin/humplayer` (about 6 s, first run only; shows `COMPILING AUDIO ENGINE`). If `swiftc` is missing, needs a license acceptance, or needs an Xcode update: **stop, print exactly what's needed, and tell the owner. Never auto-install or work around it** (owner's instruction).

**IPC:** newline-delimited JSON on stdin/stdout (as built in M1; types in `src/engine/helper.ts`).

| Main → helper (`cmd`) | Helper → main (`ev`) |
| --- | --- |
| `load {id, src, title, artist, album, pos?, paused?}` replaces the queue and plays | `ready {version}` |
| `setNext {after, id?, src?, title…}` replaces whatever is queued after the current item (no id = clear). Ignored if the current item is no longer `after` (race guard) | `state {state: playing\|paused\|buffering, id}` |
| `play` / `pause` / `toggle` / `stop` | `time {id, pos, dur}` (2 Hz while playing, plus after seeks/loads) |
| `seek {sec}` / `seekBy {sec}` (clamped to the track) | `advanced {from, to}` (gapless transition happened) |
| `volume {value 0..1}` | `ended {id}` (nothing was queued) |
| `art {id, path}` sets cover art on a queued or current item (turn 7) | `remote {cmd: toggle\|play\|pause\|next\|prev\|seek, pos?}` |
| `quit` | `error {id?, message}` |
| | `art {id, ok}` (ack for `art`) |

`load` and `setNext` also take `art` (a local image path) when it's already on disk.

**Seeks (turn 7 fix):** while a seek is in flight AVPlayer reports the old or an in-between time, so the helper sends no `time` until the latest seek lands, and main ignores `time` events more than 2 s away from a seek target for 3 s. Before this, quitting right after a seek could save the wrong second.

**Cover art (turn 7):** main fetches each window track's metadata image (with the profile's `artQuery`, e.g. a 600×600 square crop) into `.cache/art/` (`src/cache/art.ts`). The helper center-crops to a square anyway and sets `MPMediaItemPropertyArtwork`. Missing art never delays playback.

Now Playing metadata travels with each item, so a gapless advance updates Control Center without a round trip. An `Info.plist` is embedded into the binary (`-sectcreate __TEXT __info_plist`), giving it the name "hum" and a bundle id without an `.app` bundle. It runs `NSApplication` with the `.accessory` policy (no Dock icon).

**Media keys and Now Playing (answer 11a):** `MPRemoteCommandCenter` handles play, pause, toggle, next, previous, and change-position. `MPNowPlayingInfoCenter` gets the title (song name), artist (the profile's `label`), album (the folder path, `dawn / grey / dark`), duration, elapsed time, and rate. Remote commands are forwarded to main as `remote` events, and main decides what "next" means. That covers F7–F9, the Touch Bar / Control Strip, Control Center, AirPods, and Bluetooth speakers.

**Output device:** AVPlayer follows the system output (built-in speakers, AirPlay, Bluetooth), so no device picker is needed. App volume (`-`/`=`) is separate from system volume.

**⚠ Risk R1:** macOS may route media keys only to processes it treats as apps. mpv gets media keys this way as a bare CLI binary, so it is expected to work. **Milestone 1 tests this first.** Fallback: build the helper as a minimal `.app` bundle inside `.cache/bin/` (still in the repo, nothing installed) and launch its executable directly. If even that fails, report to the owner before going further.

**Robustness:** if the helper crashes, main respawns it and resumes at the last known position (at most 3 tries a minute, then an error line).

---

## 11. UI

Hand-rolled ANSI (answer 13a): alternate screen, hidden cursor, raw-mode stdin, **synchronized output** (DEC 2026, supported by Ghostty) so frames never tear, and a line-level diff against the previous frame so only changed rows are rewritten. It re-renders on any state change plus a 1 Hz tick for the clock. There are **no animations or transitions** anywhere.

Terminal state is always restored (normal screen, cursor visible, cooked mode) on quit, Ctrl+C, SIGTERM, uncaught errors, and crashes.

**Palette (answer 9a):** the terminal's default foreground and background, plus **one accent** taken from the ANSI palette so it follows the Ghostty theme. **ASSUMPTION:** yellow, changeable in `config.local.json`. Styles used: accent, bold, dim, and inverse for the selection. Labels are uppercase and the body text is plain.

**Target size:** it looks right at 80×24 and above. Below 60×12 it shows a single `TOO SMALL` line.

### Player view (default, answer 8a)

As built (turn 7):

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
           ◐ Long Division                           dawn/azure/mid
    ↓ NEXT ○ Harbour Lights                          dawn/azure/mid
 
─────────────────────────────────────────────────────────────────────── ? KEYS ─
```

(The header shows the profile's `label`.)

- **Rolling list (turn 7):** one list instead of separate sections: recently played above (dim, oldest at the top), the current song on the `NOW ▶` row, the queue below with cache marks. The `NOW` row sits at a fixed height (history gets at most 6 rows; tall terminals give the rest to up next), and the last body row stays blank for the filter prompt. It's the queue view in miniature; the status line shows the queue position.

- The ⏻ is decorative (answer 10a). `q` / Ctrl+C quit immediately.
- A status line appears only when there's something to say (`OFFLINE`, `CACHE CLEARED 1.4 GB`, errors), and it clears on the next key press.

### Queue view (`2`)
Previous 5 (dim), the current track (inverse), then upcoming songs with their `●◐○` state. Scrollable. **Enter** jumps to the selected song.

### Tree view (`3`, answer 14a)

```
 TREE ─────────────────────────────────────── 2,345 FILES 
 ▾ dawn                                             1,210 
   ▾ amber                                             94 
     ▸ dark                                            19 
     ▸ light                                           31 
     ▾ mid                                             44 
         Copper Field                              30:00 
         Glass Tower                               30:00 
   ▾ azure                                            152 
```

- The root is the profile's tracks folder; the metadata folder is hidden. **Defaults: every folder expanded, every file hidden.**
- Counts are **raw files** (the tree mirrors the filesystem, so all length variants are listed). **ASSUMPTION.**
- File rows show the display name and duration. `.` toggles raw filenames instead (**ASSUMPTION**, a small extra for understanding the filesystem).
- Keys: `j/k` or `↑/↓` move, `Enter` toggles, `→` opens, `←` closes (or jumps to the parent; turn 7 dropped the `h`/`l` aliases because `l` is now like), `o` shows or hides all files, `g/G` top/bottom, `PgUp/PgDn`. (Built: `Space` stays play/pause everywhere, so it does not toggle folders.)
- It's exploration only; nothing plays from here.

### Favourites view (`4`, turn 7)
Liked songs, newest first, with folder and duration. `Enter` plays one now, `a` shuffles them all (applies the `fav` filter), `x` unlikes the selected one.

### Search view (`f`)
A prompt at the top and ranked results below. Letters type into the query (so `j/k/n/p` don't act here); `↑/↓` or `Ctrl+N/P` select, `Enter` plays now, `Esc` goes back.

### Help overlay (`?`)
A full-screen list of every shortcut, grouped. `?` or `Esc` closes it. The footer always shows `? KEYS`.

---

## 12. Keymap (100% keyboard)

| Key | Action |
| --- | --- |
| `Space` | play / pause |
| `n` / `p` | next / previous (restart if > 5 s in) |
| `←` / `→` | seek −10 s / +10 s |
| `Shift+←` / `Shift+→` | seek −60 s / +60 s |
| `-` / `=` | volume −5 / +5 |
| `/` | filter prompt, starts empty and shows the current filter as a hint (`Tab` completes, `Enter` applies, `Esc` cancels, `Ctrl+U` clears, `Ctrl+W` deletes a word) |
| `f` | search |
| `s` | shuffle on / off |
| `r` | repeat: off → all → one |
| `d` | one version per song (lengths + versions) on / off |
| `l` | like / unlike the playing song |
| `1` / `2` / `3` / `4` | player / queue / tree / favourites view |
| `?` | shortcut menu |
| `C` | clear audio cache (confirm `y`) |
| `Esc` | close overlay / back to player |
| `q` / `Ctrl+C` | quit |
| Media keys | play/pause, next, previous (through the helper) |

Inside lists: `j/k`, `↑/↓`, `g/G`, `PgUp/PgDn`, and `Enter`.

---

## 13. Persistence and resume (answer 4a)

- `.cache/state.json` stores: filter, shuffle flag, repeat mode, volume, queue order + cursor, dedupe flag, history (last 200), current ID + position. A queue saved before turn 7 (no dedupe flag) is rebuilt once on launch, keeping the current song. Favourites live separately in `.data/favorites.json`. It's written atomically (tmp file then rename) every 5 s while playing and on every state change and quit.
- `pnpm play` with no args **resumes and starts playing** at the saved position. **ASSUMPTION:** it auto-plays rather than opening paused.
- `pnpm play grey dark` **replaces** the saved queue with a fresh filter-shuffle (answer 5a).
- First launch with no state defaults to a shuffle of the profile's **`defaultFilter`** (everything if unset), repeat **all**, volume 100 (app volume on top of system volume). **ASSUMPTION.**
- If the saved track no longer exists, it moves to the next song in the queue.

---

## 14. Errors and edge cases

| Situation | Behavior |
| --- | --- |
| No `.secrets/dropbox.json` | Print `run: pnpm auth start` and exit before entering the TUI. |
| Refresh token revoked | Status line `DROPBOX AUTH EXPIRED, run pnpm auth start`; cached songs keep playing. Running `pnpm auth start` / `finish` in another terminal fixes it live: the next token refresh re-reads `.secrets/dropbox.json`, and the flag clears on the next successful link or download. (Refresh tokens don't expire on their own; only revoking the app in Dropbox, or disabling it, ends one.) |
| Network down | `OFFLINE`; queue limited to cached; retry with backoff. |
| Download size mismatch | Delete it, retry once, then skip the track and note it in the status line. |
| Filter matches nothing | The prompt stays open showing `0 songs` and nothing is replaced. |
| Ambiguous prefix | `mi? mid · midnight` and not applied. |
| Terminal resized | Full redraw. |
| Helper crash | Respawn and resume (§10). |
| `swiftc` unavailable / Xcode issue | Stop with an exact message and **ask the owner** (§10). |
| Two `pnpm play` instances | Lockfile `.cache/play.lock` with PID; the second one says `ALREADY RUNNING` and exits. **ASSUMPTION.** |
| Disk nearly full | Prefetch pauses when free space is under 1 GB and a status line says why. |

**Later / nice-to-have (not in v1):** play the selected folder from the tree view; an info panel (`i`) with BPM and tags; a sleep timer; filtering by a metadata tag with `tag:` prefixes.

---

## 15. Security and rules

- Dropbox: the token has read scopes only, **and** the client refuses any endpoint outside the allowlist (`list_folder`, `list_folder/continue`, `get_metadata`, `get_temporary_link`, `download`, `get_current_account`).
- Secrets live in `.secrets/` with mode 0600 and are gitignored. Tokens and temporary links are never logged.
- All writes stay inside the repo (`.cache/`, `.secrets/`, source).
- Debug log: `.cache/log.txt`, only with `HUM_DEBUG=1`, capped at 1 MB, secrets redacted.

---

## 16. Performance targets

| Metric | Target | Measured (M8, warm, 80×24) |
| --- | --- | --- |
| launch → first frame | < 300 ms | **67–164 ms** via `./play` · **~400 ms** via `pnpm play` (pnpm alone takes ~220 ms to start; unavoidable, so `./play` exists) |
| launch → audio (cached track) | first frame + < 150 ms | **~250 ms** total via `./play` (helper spawn + AppKit init) |
| Uncached jump → audio | about 1 s | ~1–2.5 s (temp link + AVPlayer buffering) |
| Track-to-track gap | 0 | gapless `advanced` verified by `pnpm test:player` |
| Key press → frame | < 16 ms | **1–7 ms** |
| Idle CPU | about 0–1 % | 1 Hz clock redraw of one row |

---

## 17. Testing

- **Unit (`bun test`):** filter matching (exact, hyphen, prefix, ambiguity, the exact-name-is-also-a-prefix trap), search ranking, dedupe, queue/prev/repeat transitions, LRU eviction with pinning, metadata normalization, state save/load, and render snapshots of each view at 80×24.
- **Engine smoke test (`pnpm test:engine`):** plays 2 s of a cached file muted (volume 0), checks the `time` events, and tests the gapless `advanced` event between two short cached files. This plays audio on the owner's Mac, so it only runs when asked.
- **End-to-end (`e2e/*.exp`, built-in `expect`):** spawn `pnpm play` in a PTY, send keys, and assert on screen text (help overlay opens, a filter applies, tree toggles, quitting restores the terminal).
- **Watch-along session (step 5):** there's no computer-use tool in this session, but the Claude desktop app has a **Terminal panel** the owner can watch. I'll run the scripted `expect` demo there so keys are "pressed" visibly, then hand over. A cloud machine isn't viable: this needs macOS audio and AVFoundation.

---

## 18. Milestones (build order)

Each milestone ends with a commit, a push, and a KB update.

| # | Milestone | Done when |
| --- | --- | --- |
| M0 | Scaffold: tsconfig, dev deps, `src/` layout, port the Dropbox client to TS, `pnpm auth`/`sync`/`test`/`typecheck` | `pnpm auth check` works through Bun |
| M1 | **Engine spike (riskiest first):** Swift helper, IPC, local and URL playback, gapless enqueue, media keys + Now Playing (R1) | F8 pauses the audio and Control Center shows the title. If not, bundle fallback, or escalate to the owner |
| M2 | Library sync + normalization + dedupe + `library.json` + background delta | Full library loaded in < 50 ms warm |
| M3 | Cache + prefetch + temp-link streaming + LRU + clear | Skip through 5 tracks with no wait. Cache stays ≤ 2 GB |
| M4 | Core logic: filter, search, queue, repeat, shuffle, state + unit tests | Tests green |
| M5 | UI shell: terminal handling, renderer, player view, prompt, help overlay, keymap | Full playback controllable from the keyboard |
| M6 | Queue view, tree view, search view | All views navigable |
| M7 | Persistence/resume, offline, errors, lockfile, polish | Kill and relaunch resumes at the same second |
| M8 | E2E `expect` tests, perf check against §16, README usage | Targets met |
| M9 | Watch-along test with the owner, then the owner tests alone | Owner happy |
| M10 | Owner's turn-7 requests: rolling played/next list, favourites (`l`, view `4`, `fav` filter), version dedupe + `d` toggle, Now Playing cover art; fix the resume-position race | All suites green |

---

## 19. Open items (non-blocking)

- R1 media-key routing for a bare binary gets verified in M1.
- Accent color and the ASSUMPTION items above: defaults are chosen, and the owner can override anytime.
- M2 Air note: the owner mentioned a "control strip". Touch Bar and F-key media keys both go through `MPRemoteCommandCenter`, so both are covered.
