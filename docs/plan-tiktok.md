# Plan: the TikTok audio phase (parked)

Status: **parked** (turn 14, 2026-09-28). The owner asked to record it now and build it in a later turn, possibly a new chat, after hum is stable. Nothing here is built. Start the phase by asking the owner the questions in §6.

Owner's words (turn 14, voice-typed, condensed): make hum/the CLI a generic micro player, not just for the current library. Part A: a script or app that pulls in all my saved TikTok audios (50–500 now), keeps them up to date, and saves them to Dropbox with metadata (source link, duration, title, popularity if any). Most are personal, few are commercial. Today I'd copy a link, paste it into an online TikTok audio downloader and save the MP3. Part B: universalize the CLI player: look at every library-specific part and make it generic, so the current library is one source and TikTok another. Two separate modes, no mixing, with mostly the same controls and different parameters. End result: play my saved TikTok audios from the Mac or the iPhone (hum), filter by name or shuffle all, and favourite them. A + B together = "the TikTok audio phase".

---

## 1. What exists to build on

- `packages/core` (@hum/core): filter (terms by dimension, OR within, AND across), queue, search, model, normalize, art, format. Shared by the CLI (`src/`) and hum (`web/`).
- hum's stream engine (`web/src/engine/stream.ts`) plays **MP3 only** (MediaSource `audio/mpeg`); the element engine plays anything Safari can (m4a/AAC too). The CLI's Swift helper (AVFoundation) plays both.
- Dropbox access is **read-only** by rule (AGENTS.md rule 2) and by token scope.

## 2. Part A: ingest saved TikTok sounds into Dropbox

### Findings (turn 14, with network access)

- **No official API** exposes a user's favourite/saved sounds (TikTok's Display/Research APIs don't cover favourites).
- **yt-dlp** (`yt_dlp/extractor/tiktok.py`): extracts a *video's* audio track (`music.playUrl` → m4a or mp3 format `audio`) and public *collections*; `tiktok:sound` is marked `_WORKING = False`; there is **no favourites extractor**.
- A sound page's raw HTML (`tiktok.com/music/<name>-<id>`) has no sound data (rendered client-side). A headless-browser check was blocked by the cloud container's TLS proxy (Chromium doesn't trust its CA; we don't disable verification). **Redo on the Mac.**
- Audio URLs (`playUrl`) and cover URLs are signed CDN links that **expire**: download both at ingest time, never store links as the source of truth.

### Getting the list of saved sounds (pick with the owner)

| | Option | Pros | Cons |
| --- | --- | --- | --- |
| a | **TikTok data export** (Settings → Account → Download your data, JSON). Includes favourite sounds with links. | Official, no scraping, complete | Manual; takes hours to days; re-export for updates |
| b | **Logged-in browser automation** on the Mac (Playwright, the owner's own session): open Profile → Favourites → Sounds, scroll, record the web API responses (id, title, author, duration, playUrl, cover) | Automatic updates; gets playUrl directly | Fragile (UI/API changes, bot checks); session cookies are secrets (`.secrets/`) |
| c | **Paste-links inbox**: share → copy link into a text file (in the repo or Dropbox); the syncer resolves each link | Zero auth, always works | Manual per sound |

**Recommendation:** (a) for the first 50–500, then (b) for ongoing sync if it proves stable, with (c) as the fallback that always works.

### Storage (needs owner approval: changes rule 2)

- A **second Dropbox app**, `hum-ingest`, with **App folder** access: it can write only inside `/Apps/hum-ingest/`. Scopes `files.content.write` + `files.content.read` + `files.metadata.read`. Token in `.secrets/dropbox-ingest.json`. The existing read-only app (full Dropbox, read scopes) reads the result. Rule 2 stays true for everything else.
- Layout:
  ```
  /Apps/hum-ingest/tiktok/
    audio/<soundId>.mp3        (or .m4a, see Format)
    art/<soundId>.jpg
    meta/<soundId>.json        one file per sound
    index.json                 every meta in one file: one download for the players
  ```
- `meta` fields: `id`, `title`, `author`, `authorHandle`, `duration`, `sourceUrl` (`https://www.tiktok.com/music/…-<id>`), `videoUrl` (if saved from a video), `original` (original sound vs commercial), `usageCount`/`videoCount` (popularity, if available), `savedAt` (from the export or scrape order), `fetchedAt`, `codec`, `audioFile`, `artFile`, `unsaved` (true if no longer in favourites; never deleted).

### Format

The stream engine needs MP3. Options: (1) transcode AAC→MP3 at ingest with ffmpeg (a binary: `ffmpeg-static` inside `node_modules` or Homebrew, both need owner approval); (2) keep originals and let hum choose the element engine for non-MP3 tracks (per-track engine choice). **Recommendation: (1)** so every player path treats the library the same. Ask.

### The syncer

- `pnpm tiktok sync` (Bun, in this repo, `src/tiktok/`): read the list (export JSON / scrape / inbox) → diff with `index.json` → for each new sound: resolve playUrl → download audio + cover → (transcode) → upload → write meta → rewrite `index.json`. Idempotent, resumable, polite (serial, small delays), dry-run flag.
- Where it runs: owner's Mac, manually at first. Scheduled later (launchd is outside the repo: needs approval) or a GitHub Action (TikTok may block datacenter IPs; cookies/tokens as repo secrets).

## 3. Part B: one player, several sources

### Status: most of Part B happened in turn 16

When the repo went public, the core became generic (D18): `Track.dims` (folder names per level) and `Track.tags` (every string list in the metadata); dimension names, value order, the version-dedupe level and the art query come from a **library profile** (`docs/profile.md`). What's left for a second source:

| Piece | Today (one profile) | Several sources |
| --- | --- | --- |
| Profile | one `profile.local.json` | a list of profiles, one active at a time |
| Dedupe | length variants + optional `variant` level | per profile; TikTok: none (sound id is unique) |
| Favourites | `groupKey` (other levels + name) | per source; TikTok: id |
| Tree view (CLI) | the profile's dimensions | TikTok: author, or saved month |
| Sync | list the profile root + one metadata zip | TikTok: download `index.json` (+ cursor on `/Apps/hum-ingest/tiktok`) |
| Art | metadata image URL + `artQuery` | TikTok: `art/<id>.jpg` via temp link / cached blob |
| Subtitle | the folder path | TikTok: `@author · 0:42` |
| Engine | MP3 | per-track codec; stream engine for MP3 |

### Modes

- One source active at a time (owner: don't mix; avoids mismatched parameters).
- **Per-source state**: queue, filter, history, favourites, resume position, cache namespace.
- Switching: CLI `m` key and `pnpm play --source tiktok` (or `pnpm tiktok`); hum: tap the source name in the header (the profile's label / "TikTok").
- TikTok filter chips: likely `author`, `original/commercial`, duration buckets (`<30s`, `<1m`, `longer`), saved year. Ask.

### Migration order

1. ~~Generalize the core model~~ (done in turn 16: dims/tags + library profile). Next: allow several profiles.
2. Per-source state files / IndexedDB keys, with migration of today's single state.
3. TikTok source (reads `index.json`), art, subtitle.
4. Mode switch in the CLI and hum.
5. Part A's syncer, then point the TikTok source at real data.

## 4. Rules and approvals this phase needs

- Rule 2 (read-only Dropbox): an exception for the `hum-ingest` app's own App folder only.
- Any ffmpeg install, launchd job or GitHub Action: owner approval.
- TikTok session cookies and the ingest token: `.secrets/`, never committed or printed.

## 5. Risks

- TikTok's web API and bot checks change often; the scraper may break. The export path (a) and inbox (c) don't depend on it.
- Signed CDN links expire within hours: download immediately.
- Commercial sounds may be region-locked or muted in exports; flag, don't fail.

## 6. Questions to ask when the phase starts

1. Saved-sound list: data export, logged-in scraper, paste-links inbox, or a combination?
2. Where the sync runs: Mac manually, Mac scheduled, or a GitHub Action?
3. Transcode everything to MP3 (needs ffmpeg), or keep originals?
4. OK to create a second Dropbox app with App-folder write access?
5. Which TikTok filters matter: author, original vs commercial, duration, saved date?
6. Keep sounds that are later un-saved (flagged), or remove them?
