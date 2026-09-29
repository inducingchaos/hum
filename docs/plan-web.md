# Plan: `hum`, the iPhone player (PWA)

Status: **approved** (turn 12, 2026-09-28), including the ASSUMPTION items. W1 and the W0 spike are built; W0 waits on the owner's iPhone test.
Sources: `docs/kb/requirements.md` (Phase 2), `docs/kb/questions.md` (round 2), `docs/plan.md` (the CLI, whose behaviour this copies).
Anything marked **ASSUMPTION** is a call I made without asking. Override any of them by saying so.

---

## 1. Goals and non-goals

**Goals**
- A home-screen web app on the owner's iPhone (iOS 26.6) that plays the music library straight from Dropbox, like `pnpm play` does on the Mac.
- Lock screen / Control Center controls: play, pause, next, previous, scrub, with title, the folder path and the cover image.
- Keeps playing and advancing to the next track with the screen locked. Plays to Bluetooth, and AirPlay via Control Center.
- Near-instant starts: the current track, the next 3, and the last 2 played are kept on the phone.
- Same behaviour as the CLI: filter terms, dedupe, shuffle, repeat off/all/one, favourites, search, the rolling played/now/next list, resume where you left off.
- One-handed, touch-first, no animations, no spinners unless actually waiting.
- No server. Vercel only hosts static files. Dropbox stays read-only.

**Non-goals (v1)**
- Syncing favourites/history/position with the Mac (answer 3a: per device).
- A big offline library (answer 4a).
- True gapless playback (not possible with a web audio element; the gap is short).
- Android or desktop-browser polish (it will run there, just not tuned).

---

## 2. Codename and domain (answer 10a)

**Codename `hum`**: the steady sound under your work, three letters, lowercase, no brand. The app header shows `HUM`.

Domain: a clean `*.vercel.app` name. Backup if you don't like `hum`: `lull`. **I can't check availability from this container** (its network blocks `vercel.app`). Vercel says whether a name is taken when you set the project's domain.

---

## 3. Architecture

```
┌──────────────── iPhone: Safari home-screen app (standalone) ────────────────┐
│  web/ (Vite + Preact + TS, one page)                                         │
│   ├─ ui/        Preact views, signals for state                              │
│   ├─ player/    ONE <audio> element · Media Session · audioSession=playback  │
│   ├─ cache/     Cache Storage (audio + art), window = prev 2 · now · next 3  │
│   ├─ library/   sync from Dropbox → IndexedDB (cursor deltas)                │
│   ├─ store/     IndexedDB: state, favourites, history, tokens                │
│   ├─ dropbox/   browser client, PKCE, read-only endpoint allowlist           │
│   └─ @hum/core  shared with the CLI: filter · queue · search · model · norm  │
│  sw.js          hand-written service worker: app shell only                  │
└──────────────────────────────────────────────────────────────────────────────┘
      │ HTTPS, straight from the phone (Dropbox allows cross-origin calls)
      ▼
  Dropbox API: oauth2/token · list_folder(/continue) · download_zip · download · get_temporary_link
  image host: cover art (512×512 via the profile's artQuery)
  Vercel: static files only (HTML, JS, CSS, icons, manifest)
```

- Everything runs on the phone. Vercel never sees the token or the library.
- **Login is "Sign in with Dropbox"** (answer 1a). Someone who opens the URL without your Dropbox login gets an empty app with a sign-in button, nothing else.

---

## 4. Tech stack (answer 7a)

| Concern | Choice | Why |
| --- | --- | --- |
| Build | **Vite** | Fast dev server, tiny static output, Vercel builds it with no config. |
| UI | **Preact** + `@preact/signals` | Same API as React (components, hooks, JSX) in ~4 KB. Signals are reactive values: change `player.state.value` and only what reads it re-renders. You'll recognise almost everything if you know React. |
| Unzip | `fflate` (~8 KB) | Unzips the metadata zip in the browser (§6). |
| Storage | IndexedDB via a ~40-line wrapper, Cache Storage for audio | No extra deps. |
| Service worker | Hand-written, ~60 lines | Full control; caching audio is our code's job, not a plugin's. |
| Font | `ui-monospace` (SF Mono on iPhone) | Nothing to download, crisp, matches the TUI. |
| Tests | `bun test` for shared/pure logic, Playwright (installed Chromium) for a UI smoke test | Same runner as the CLI. iOS-specific behaviour is tested by the owner on the phone. |

Budget: under 50 KB of JS gzipped, shell loads from the service worker in under 300 ms.

---

## 5. Repo layout (answer 6a)

```
package.json            root: CLI scripts as today + `web:*` scripts
pnpm-workspace.yaml     adds packages: ["packages/*", "web"]
src/  native/  test/  e2e/     CLI, unchanged except imports
packages/core/          @hum/core: filter, queue, search, library/model, library/normalize (moved from src/)
web/
  index.html  vite.config.ts  tsconfig.json  package.json
  public/     manifest.webmanifest, icons, sw.js
  src/        main.tsx, ui/, player/, cache/, library/, store/, dropbox/
vercel.json             root dir `web`, headers (CSP), SPA fallback
```

- The five pure modules have no Bun/Node imports (checked). Moving them is a mechanical change; the CLI's 35 unit tests + e2e must stay green in the same commit.
- `src/dropbox/client.ts` stays Bun-only (it uses the file system for tokens). The web gets its own small client with the same endpoint allowlist; sharing it would mean abstracting storage for ~150 lines. **ASSUMPTION.**
- No Turborepo. `pnpm --filter web build` is enough.

---

## 6. Auth and library sync

**Auth (PKCE in the browser)**
- Same Dropbox app as the CLI (key `49yjxi7h52fcwsy`, read-only scopes). **Owner action:** add redirect URIs in the Dropbox app console: `https://<domain>/auth` and `http://localhost:5173/auth` (dev).
- Flow: tap Sign in → Dropbox → back to `/auth?code=…` → exchange for a refresh token → stored in IndexedDB. Access tokens refresh on their own (the CLI's deduped-refresh logic, ported).
- The token lives in the browser, so the page gets a strict CSP (scripts only from our own origin, `connect-src` only Dropbox; images from any https host) and no third-party scripts. Sign out wipes tokens, library, cache.
- In the installed app, the Dropbox login opens inside the app's own window, and iOS keeps that login separate from Safari's. You sign in once in the app, then it remembers you.
- **Fallback: sign in with a code** (built in W0). No `redirect_uri`: Dropbox shows a code, the owner pastes it. Covers the case where iOS finishes the redirect in a separate browser view whose storage the installed app can't see (the PKCE verifier would be missing).

**Library sync** (turn 13: two phases; the player starts after the listing, metadata fills in behind it with a seconds counter in the header, see D15)
- First launch: `list_folder` (recursive) on the profile's library root for paths and sizes, plus **one `download_zip` of the metadata folder** (a few MB, one request), unzipped with `fflate`, normalised with the shared `normalize` code. Target: under 10 s. Fallback if `download_zip` misbehaves: 2,560 small downloads, 12 at a time (~30 s).
- Stored in IndexedDB with the cursor. Later launches load the stored library instantly and check `list_folder/continue` in the background; only changed metadata is fetched.

---

## 7. Playback engine

> **Turn 13 update:** the design below is now the *element* engine (fallback). The default is the **stream engine** (D15 in `docs/kb/decisions.md`): one MediaSource fed track after track, so iOS never has to start new media in the background. Choose in SYS → ENGINE.

- **One `<audio>` element for the life of the app.** iOS keeps a playing element alive in the background; swapping in a new element there often fails, so we never do.
- Source: a blob URL from the cache if the track is there, else a Dropbox **temporary link** (plays while it streams; range requests work). Links are kept for 3.5 h, as in the CLI.
- **Advancing:** on `ended`, set `src` to the next track and call `play()` in the same handler, with the next source resolved in advance (blob or link already in hand). That keeps it inside the audio session iOS already granted, so it works on the lock screen. Expected gap: roughly 0.1–0.5 s.
- **`navigator.audioSession.type = "playback"`**: plays with the silent switch on and behaves like a music app with other audio.
- **Media Session:** metadata (title, the folder path as artist, the profile label as album, 512×512 art) and handlers for play, pause, previous, next, seek-to. Not seek ±10 s, because iOS then shows skip-10 buttons instead of previous/next. Position state updates on play/pause/seek, not every second.
- Previous: restart the track if more than 3 s in, else go back (like the CLI).
- **Resume:** position saved every 5 s and on `pagehide`/`visibilitychange`. On launch the app shows the last track paused at that point. iOS won't auto-play before you tap, so nothing plays until you hit play.
- Output (Bluetooth speaker, AirPlay to the Mac) is chosen in Control Center. iOS routes the audio; no in-app code needed.

---

## 8. Cache and prefetch (answer 4a + "a few history")

- **Window:** the 2 tracks played before now, now, and the next 3 in the queue. These are pinned. So previous and the next few are instant, even offline.
- Downloads run one at a time in queue order (the CLI's prefetch logic, ported): full track bytes via `files/download` into Cache Storage, keyed by track id.
- **Cap: 1 GB** (about 35 tracks), least recently played first out, pinned tracks never evicted. The app calls `navigator.storage.persist()` so iOS doesn't clear it under storage pressure. **ASSUMPTION** on 1 GB. You didn't say a cap, and anything over ~200 MB behaves the same.
- Cover art is cached the same way (~50 KB each).
- Tracks outside the window just stream; they're never blocked on a download.
- Settings screen: cache size used, clear cache.
- Known limit: with the screen locked, iOS may throttle background downloads. Playback still works because it falls back to streaming. The spike (W0) measures this.

---

## 9. Data and state (IndexedDB, per device)

| Store | Contents |
| --- | --- |
| `auth` | refresh token, account name |
| `library` | tracks (shared `Track` model), cursor, syncedAt |
| `state` | queue order, index, position, filter, shuffle, repeat, dedupe, volume-less (iOS volume is hardware-only) |
| `favorites` | song keys + preferred version (same rules as D11) |
| `history` | last 200 plays (ids + time); the rolling list shows the last 6 |

Same defaults as the CLI's first launch: shuffle on, repeat all, dedupe on, filter `all`.

---

## 10. UI (answer 8a: TUI layout + peach accent, ALTERED type/spacing/bottom bar)

**Turn 14: restyled after the owner's ALTERED editor, see D16 (monochrome, Geist Mono 13 px, 1ch × 3ch rows, #FF8000 accent sparingly).** Originally: dark, peach accent, one size, uppercase labels, no rounded corners, no shadows, no transitions. Respects the iPhone's safe areas (notch, home bar).

**Player (default view)**
```
HUM ──────────────────────────── ⚙
COPPER FIELD
dawn / crimson / light
████████████░░░░░░░░░░░░  9:11 / 30:00      ← drag to scrub
SHUF  RPT:ALL  DEDUP           8 / 1,210    ← tap a label to toggle
FILTER everything · 1,210 songs             ← tap to change

↑ PLAYED  Slow Parade           crimson/light
          Tin Roof              jade/mid
   NOW ▶  Copper Field          crimson/light
       ●  Harbour Lights        azure/light   ● = cached
       ○  River Stones          ochre/mid
↓ NEXT ○  Paper Kites           azure/mid
──────────────────────────────────────────
  ⏮        ▶ / ❚❚        ⏭        ♥
──────────────────────────────────────────
 NOW      QUEUE      BROWSE      FAVS
```
- On a narrow screen the right column shows the folder levels after the first (ASSUMPTION). Tap a row: play it. Long-press a row: like/unlike.
- Transport and tabs sit in the bottom thumb zone, like ALTERED's bottom bar.

**Filter sheet** (tap FILTER): chips in rows. `all`, `fav`, then one row per folder level (the profile's dimensions). Tap to toggle, the count updates live, `PLAY` applies and reshuffles. The same term logic as the CLI (`grey dark`), so a text field also accepts typed terms.

**QUEUE**: full upcoming list, tap to jump. **BROWSE**: the folder tree with counts, plus the search field at the top (name + tags, answer 3b from round 1); tap a folder to play it in order or shuffled. **FAVS**: liked songs, `SHUFFLE FAVS` at the top.

**Status line** replaces spinners: `OFFLINE`, `DROPBOX SIGN-IN EXPIRED · TAP TO SIGN IN`, `SYNCING 1,203 / 2,345` (only while actually waiting).

Icon: black square, `HUM` in peach monospace. Splash: same colours, so launch doesn't flash white.

---

## 11. Service worker and updates

- Precaches the app shell (HTML, JS, CSS, icons) with a version hash, so launch works offline.
- Never touches Dropbox or image requests. Audio caching is done by page code into Cache Storage, which the page reads directly.
- New deploy: the new worker installs quietly and takes over on the next launch. A `v<hash>` line in settings shows which build is running.

---

## 12. Deploy (Vercel) and branches

- **Owner actions (need your approval, I'll walk you through them):**
  1. Vercel: import the GitHub repo as a project, root directory `web`, framework Vite, set the domain (§2). No env vars or secrets needed. (This container can't reach Vercel, so you click through it, or I give you the exact `vercel` CLI commands to run on your Mac.)
  2. Dropbox app console: add the two redirect URIs (§6).
- Dropbox redirect URIs must match exactly (no wildcards), so sign-in only works on the production domain and localhost, not preview URLs. The production branch needs to be the branch we push to. See question R3-3.
- `vercel.json`: CSP and security headers, `/auth` → `index.html`, long cache for hashed assets, no cache for `sw.js`.

---

## 13. Errors and edge cases

| Case | Behaviour |
| --- | --- |
| Offline at launch | Library from IndexedDB; plays cached tracks; skips uncached ones with `OFFLINE` shown; retries when back online. |
| Token revoked | Status line asks to sign in again; library and cache are kept. |
| Stream fails mid-track | Retry once from the same position with a fresh link; then skip and show why. |
| Storage full / cache evicted | Shrink the cap and keep going; streaming still works. |
| App killed by iOS or swiped away | Playback stops (web limit). Next launch resumes paused at the saved position. |
| Two tabs open | A `BroadcastChannel` lock: the second tab says "open elsewhere" and won't play. |

---

## 14. Security and rules

- Read-only Dropbox endpoint allowlist in the web client (as in the CLI): `list_folder`, `list_folder/continue`, `download`, `download_zip`, `get_temporary_link`, `users/get_current_account`, `oauth2/token`. (`download_zip` is new; it's read-only and covered by `files.content.read`.)
- No secrets in the repo or in Vercel. The app key is public by design under PKCE.
- The only other network call is cover art, which sends nothing about the owner.

---

## 15. Performance targets

| What | Target |
| --- | --- |
| Launch to interactive (installed, warm) | < 300 ms |
| Tap to sound, cached | < 200 ms |
| Tap to sound, uncached (streaming) | < 1.5 s |
| First library sync | < 10 s (`download_zip`), < 30 s fallback |
| Gap between tracks | < 0.5 s |
| JS shipped (gzip) | < 50 KB |

---

## 16. Testing

- `bun test`: the shared core (existing 35 tests move with it) + new pure web logic (cache window, pinning/eviction, source selection, media-session mapping).
- Playwright smoke on the installed Chromium with a fake Dropbox (fixtures) and muted audio: sign-in callback, sync, play, next/prev, filter, like, resume after reload.
- CLI suites (`test`, `test:engine`, `test:player`, `test:e2e`) stay green after the core move. Engine/player/e2e need the owner's Mac.
- **iPhone checklist** (owner): run after W0 and before calling v1 done. Details in §17 W0.

---

## 17. Milestones

| # | Milestone | Done when |
| --- | --- | --- |
| **W0** | **Spike on the phone.** *Built turn 12:* the real modules (auth, sync, cache, player, NOW/QUEUE views) plus a SYS tab with the event log (`[bg]` marks lines logged while the screen was locked; COPY LOG puts it on the clipboard). BROWSE/FAVS/search come in W5. Minimal page deployed to Vercel: sign in, sync, play 3 tracks from cache + 1 streamed, Media Session, audioSession. Owner checks on the iPhone: lock screen art + controls, next/prev from the lock screen, a track rolling into the next with the screen locked (use a 15-min track), Bluetooth, AirPlay to the Mac, silent switch, downloads while locked. | Owner reports results. **Go/no-go:** if background advance fails, we look at the native fallback (reuse the Swift engine in a tiny app) before building more. |
| W1 | Workspace: `packages/core` extracted, `web/` scaffold, CLI tests green | `pnpm test` + typecheck green. **Done turn 12** (also moved `squareUrl` and the format helpers into core) |
| W2 | Web Dropbox client + auth + library sync (IndexedDB, deltas) | Sync < 10 s, delta works |
| W3 | Player engine + cache/prefetch window + resume | Unit tests, Playwright play/next/resume |
| W4 | Player view, filter sheet, transport, toggles | Playwright smoke |
| W5 | Queue, Browse + search, Favs, settings | Playwright smoke |
| W6 | PWA polish: icons, splash, service worker, errors, status line, perf check | §15 targets met |
| W7 | Owner uses it for a day | Feedback round |

W0 comes first because everything depends on iOS behaving. It's about one session of work plus 15 minutes of your time on the phone.

---

## 18. Risks

| Risk | Likelihood | Mitigation |
| --- | --- | --- |
| iOS standalone PWA stops or doesn't advance in the background | Low–medium on iOS 26 | W0 spike tests it first. Fallback: the same page in a Safari tab, then a native app. |
| Downloads stall while locked | Medium | Streaming fallback; bigger window on Wi-Fi; measured in W0. |
| Dropbox cross-origin quirk on `download_zip` or temp links | Low | Fallbacks: many small downloads; `files/download` instead of links. |
| iOS evicts the cache | Low with `persist()` | Cache is disposable; streaming still works. |
| Token theft via script injection | Low | Strict CSP, no third-party scripts, read-only scope, sign-out wipes. |

---

## 19. Owner setup (one time)

**Vercel**
1. vercel.com → Add New → Project → import `inducingchaos/hum`.
2. Project name `hum`. Root Directory `web`. Leave framework (Vite), build and install settings as detected; `web/vercel.json` sets them. No environment variables.
3. Deploy. Production branch is `main` (the default).
4. Settings → Domains: if `hum.vercel.app` was taken, Vercel picked something like `hum-abc123.vercel.app`; edit it to a clean name.

**Dropbox** (dropbox.com/developers/apps → the app with key `49yjxi7h52fcwsy` → Settings → OAuth 2 → Redirect URIs), add:
- `https://<the domain>/auth`
- `http://localhost:5173/auth`

**iPhone**: open `https://<the domain>` in Safari → Share → Add to Home Screen → open hum from the Home Screen → SIGN IN WITH DROPBOX (if it comes back to the sign-in screen, use SIGN IN WITH A CODE).

## 20. W0 iPhone checklist

Run in the installed app (from the Home Screen), then SYS → COPY LOG and paste it into chat along with what you saw.

1. Sign in: which way worked (button or code)? How long did the first sync take?
2. Play. Lock the phone. Lock screen shows title, the folder path, cover art, previous/next, a working scrubber?
3. Auto-advance while locked: unlock, drag the bar to ~10 s before the end, lock again, wait. Does the next track start by itself? Try twice (the second one may be streamed, not cached).
4. Next and previous from the lock screen, a few times in a row.
5. Bluetooth speaker; AirPlay to the Mac from Control Center.
6. Silent switch on: still plays?
7. After 3–4 tracks are cached (SYS → CACHE), airplane mode: cached tracks play, uncached are skipped with a message.
8. Leave it playing locked for 30+ minutes (across at least one track change), then copy the log.
9. Force-quit and reopen: back on the same track, paused at the same point?
