# Dropbox access

Status: **accepted**. App key received (`49yjxi7h52fcwsy`, public under PKCE; in `packages/core/src/profile.ts` as `APP_KEY`).

## Code (Bun + TypeScript, zero runtime deps)

- `src/dropbox/client.ts`: token refresh (deduped in-flight), `rpc()` with a **read-only endpoint allowlist**, `download()`, `temporaryLink()` (reused for 3.5 h), `listAll()` (paginated recursive listing or cursor delta). Throws `AuthError` / `NetworkError` so callers can show `DROPBOX AUTH EXPIRED` / `OFFLINE`.
- `pnpm auth start`: prints the authorize URL and saves the PKCE verifier to `.secrets/pkce.json`.
- `pnpm auth finish <code>`: saves the refresh token to `.secrets/dropbox.json` (mode 0600) and deletes the verifier.
- `pnpm auth check`: prints the connected account name.
- `pnpm explore [path]`: recursive listing summary (counts, sizes by extension, depth, top level). Dev only.
- The original Node scripts in `scripts/` were ported and deleted in M0.

## Web client (`hum`, `web/src/dropbox.ts`)

- Same app key and scopes. PKCE in the browser; refresh token in IndexedDB (`kv` key `auth`); access token in memory only.
- Allowlist: RPC `list_folder`, `list_folder/continue`, `get_temporary_link`, `users/get_current_account`; content `files/download`, `files/download_zip` (new, read-only, `files.content.read`).
- Redirect URI `<origin>/auth` (must be registered in the Dropbox console, exact match), or the no-redirect code flow.
- Metadata: one `download_zip` of the profile's metadata folder, unzipped with `fflate`; per-file downloads (12 at a time) as the fallback.
- Not yet verified against the real Dropbox from a browser (this container has no Dropbox token or browser access to Dropbox). The W0 phone test is the first real run.

## Recommendation

Use the **Dropbox HTTP API v2** directly, with a Dropbox app the owner creates that can only read.

### Auth

- Owner creates a **Scoped access** app with **Full Dropbox** access type (App folder access can't see `the library folder`).
- Permissions: `files.metadata.read` and `files.content.read` only. Read-only is enforced by the token itself, not just by our discipline.
- OAuth 2 **PKCE** with `token_access_type=offline`, which returns a long-lived **refresh token**. PKCE needs only the app key; the app secret never has to leave the Dropbox console.
- One-time flow, done in two non-interactive steps so it works from an agent shell or the owner's terminal:
  1. `pnpm auth start` generates a verifier, saves it to `.secrets/`, prints an authorize URL.
  2. Owner opens it, clicks Allow, copies the code; `pnpm auth finish <code>` exchanges it and saves the refresh token to `.secrets/dropbox.json` (gitignored).
- The app refreshes short-lived access tokens (4 h) automatically.
- Not recommended: the console's "Generate access token" button. It expires in 4 hours and would be pasted into chat.

### Indexing

- `files/list_folder` with `recursive: true` on the library root (from the profile), paginated with `list_folder/continue`.
- Cache the result in `.cache/index.json` along with the cursor. On later launches, call `list_folder/continue` with the saved cursor to get only changes (fast startup).
- Metadata files are small: download them all once and cache them in `.cache/meta/`.

### Audio: download-ahead cache, with streaming as fallback

- Keep the current track plus the next 3 **fully downloaded** in `.cache/audio/` (gitignored). Use an LRU cap, default about 2 GB, configurable. That gives gapless transitions and no spinners.
- These are the original MP3 bytes, so there is **no quality loss**. Streaming wouldn't lower quality either, because it's the same file; the only risk with streaming is a network hiccup mid-track, and download-ahead removes that risk.
- If the owner jumps to a track that isn't cached, play it right away from a `files/get_temporary_link` URL (direct HTTPS, valid 4 h, supports range requests) while it downloads in the background. No waiting.

### Player engine

Constraint from the owner: **don't install native binaries, apps, or system integrations.** Use pnpm packages and built-in shell commands; if that's truly impossible, explain the limitation and present options. mpv is out.

Limitation: Node has no audio output of its own. Something has to hand PCM to CoreAudio. Options, all with nothing installed system-wide:

| | Option | Gapless | Play before download finishes | Seek / real position | Cost |
| --- | --- | --- | --- | --- | --- |
| **A** | `afplay` (built into macOS) | Near-gapless: pre-spawn the next process paused (SIGSTOP), resume it (SIGCONT) when the current one exits | No, local files only | No seek; position tracked by wall clock | Zero deps. Pause = SIGSTOP/SIGCONT, skip = kill. Volume is set at spawn only. |
| **B** | Small **Swift + AVFoundation** helper; source in the repo, run by the already-installed Xcode Swift toolchain, compiled on first run into `.cache/bin/` | Yes (`AVQueuePlayer`) | Yes, streams HTTPS temp links | Yes | About 150 lines of Swift, JSON over stdin/stdout. Technically a native binary, but built from our source inside the repo with Apple's frameworks; nothing is installed. |
| **C** | JXA (`osascript -l JavaScript`) + AVFoundation via the ObjC bridge | Yes | Yes | Yes | No compile step, but run-loop and stdin handling in JXA are fragile. Unproven; would need a spike. |
| **D** | pnpm: WASM MP3 decoder + `speaker` package | Yes | Yes | Yes | `speaker` compiles a native addon via node-gyp at install time; heavier and more brittle. |

**Recommendation: B**, behind a small `Player` interface, with **A** as the fallback if the owner vetoes B. B is the only zero-install option that gives true gapless playback, instant skip to uncached tracks (stream while downloading), and seek. If we go with A, the cache becomes mandatory: jumping to an uncached track waits for its download, roughly 1–3 s.

## Rejected

| Option | Why not |
| --- | --- |
| Dropbox desktop app with online-only files | Not installed. Hydrated files land in `~/Library/CloudStorage` (outside the repo) and eviction is outside our control. |
| rclone mount | Needs macFUSE, a kernel extension that requires changing system security settings. |
| Shared links | Creates public URLs, which is a write/share action. |
| Pure streaming, no cache | Possible gaps or stalls on a flaky network; no benefit over download-ahead. |
