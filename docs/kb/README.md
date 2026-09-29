# Knowledge base

Start with `../../AGENTS.md` for the rules.

## Status (2026-09-29)

CLI done. PWA frozen. **Phase 3: native iOS app** (`docs/plan-ios.md`).

## Build progress

- [x] M0 Scaffold: Bun + TS, `src/` layout, Dropbox client ported (`src/dropbox/client.ts`), `pnpm auth check` works, `scripts/` removed
- [x] M1 Engine: Swift helper, IPC, gapless, streaming (`pnpm test:engine` all green). Media keys (R1) coded; **owner must verify with `pnpm test:keys`**
- [x] M2 Library sync: `pnpm sync` 6.7 s full (metadata already cached), warm load + dedupe 4.7 ms, delta 0.3 s. Every track had metadata
- [x] M3 Cache + prefetch: `src/cache/lru.ts` (LRU by mtime, pinned window, .part→rename, size check), `src/cache/prefetch.ts` (sequential window downloads, abort on window change, offline backoff, disk-low pause). Verified against real downloads. `pnpm cache:clear` refuses while the player runs (lockfile `src/core/lock.ts`)
- [x] M4 Core logic: `src/core/{filter,search,queue,store}.ts`, 28 unit tests green (`pnpm test`)
- [x] M5 UI shell: `src/ui/{term,keys,text,theme,app}.ts`, controller `src/core/player.ts`, entry `src/main.ts`, player view, filter prompt, help overlay
- [x] M6 Queue, tree, search views (`src/ui/views/`). PTY e2e `pnpm test:e2e` passes (15 checks, muted via `HUM_MUTE=1`, separate state via `HUM_STATE`)
- [x] M7 Persistence/resume, offline fallback, crash respawn, lockfile, TOO SMALL: `pnpm test:player` (5 checks) + `e2e/resume.exp`
- [x] M8 Perf measured (plan §16), `./play` fast shim, `README.md`
- [x] M9 Owner tested it alone (turn 7): playback and media keys work (R1 closed)
- [x] M10 Turn-7 requests: rolling played/now/next list, favourites (`l`, view `4`, `fav` filter), version dedupe + `d` toggle, Now Playing cover art, resume-position race fixed. 35 unit tests, engine 7/7, player 8/8, e2e 21 + 6 checks green

**CLI:** done; nothing open.

**Phase 2: iPhone PWA, codename `hum`.** Plan approved (turn 12): `docs/plan-web.md`.

### hum build progress (plan-web §17)

- [x] W1 Workspace: `packages/core` (@hum/core: filter, queue, search, model, normalize, profile, shuffle, art, format), `web/` (Vite 8 + Preact + signals). CLI 35 unit tests + typecheck green
- [x] W0 spike built: `web/src/{dropbox,library,cache,player,db,log}.ts`, views NOW/QUEUE/SYS. `pnpm web:check` (typecheck, 3 unit tests, build) + `pnpm --filter web e2e` (10 browser checks with a fake Dropbox) green
- [x] W0 round 1 on the iPhone (turn 13, `the Vercel deployment`): play/pause, art, cache, resume UI work. Failed: ±10 s instead of prev/next; next track doesn't start while the lock screen is lit; first sync looked frozen; resume played from 0:00
- [x] Turn 13 fixes: stream engine (MediaSource, default) + element fallback, lock-screen handler fix, two-phase sync, resume seek fix, Geist Mono one size. `pnpm --filter web e2e` 22/22 (both engines, real MP3s)
- [x] W0 round 2 (turn 14): **go.** Prev/next on the lock screen, advance with the screen lit or off, AirPlay, resume all work
- [x] Turn 14: folder filter chips (OR within a dimension), skip race fix, soft jumps, lock-screen pause via mute, art preload, faster launch, monochrome ALTERED-style restyle. e2e 27/27
- [x] Round 3 on the iPhone (turn 15): skips good, lock-screen pause still loses Now Playing (WebKit limit). **PWA frozen** (turn 16): no deploys.
- [ ] Later: **TikTok audio phase** (parked): `docs/plan-tiktok.md`

**Turn 16: repo public.** Library specifics moved into the gitignored profile (`docs/profile.md`, D18); history squashed to one commit.

**Phase 3: native iOS app.** Plan: `docs/plan-ios.md`. Build progress lives there (§ Milestones) and here:

- [x] I0 Plan + scaffold (`ios/`, XcodeGen, CI workflow `.github/workflows/ios.yml` on `macos-26`)
- [x] I1 HumCore Swift port + shared test cases (`test/cases/core-cases.json`, run by bun and swift): 22 Swift tests green on Linux + macOS
- [x] I2 App: Dropbox auth + sync, player engine, lock screen, cache (compiles on CI, Xcode 26.6)
- [x] I3 Two looks (native / terminal) + demo mode + Simulator screenshots in CI: all green at `47db32b`
- [ ] I4 Owner: Simulator pass (Xcode or computer use) · I5 device checklist (plan-ios §13): **waiting on the owner**

**Next:** see the latest `log.md` entry.

## Roadmap (owner's process)

1. Decide how to access Dropbox (in chat). ✓
2. Owner connects credentials; agent explores the library folder read-only and documents structure + metadata format. ✓
3. Agent asks 1–15 concise questions (multiple choice with a recommendation, or short free text). ✓
4. Agent writes a comprehensive plan to `docs/plan.md`; owner approves. ✓
5. Build end-to-end, then user-test together (owner wants to watch), then owner tests alone. **← here**

## Files

- `requirements.md`: what the owner wants
- `decisions.md`: decisions and why
- `environment.md`: the owner's machine
- `dropbox-access.md`: auth, listing, download, cache
- `dropbox-structure.md`: the generic library layout the code expects (specifics are in the gitignored profile)
- `questions.md`: question rounds and answers
- `log.md`: per-turn log
- Plans: `../plan.md` (CLI), `../plan-web.md` (PWA, frozen), `../plan-ios.md` (iOS app), `../plan-tiktok.md` (TikTok phase, parked)
- Library profile format: `../profile.md`
