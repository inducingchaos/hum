# Library profile

Everything specific to one person's library lives in a small JSON file that is
**never committed**: `profile.local.json` at the repo root (gitignored, like all
`*.local.json`). The code is generic and learns the layout from it.

| Field | Required | Meaning |
| --- | --- | --- |
| `label` | no | Name shown as the artist on the lock screen / Now Playing and in headers. Default `hum`. |
| `root` | yes | Dropbox folder holding the library (starts with `/`). |
| `tracks` | yes | Audio folder, relative to `root`. Audio is `<tracks>/<level 1>/<level 2>/…/<slug>-<id>.mp3`. |
| `metadata` | yes | Metadata folder, relative to `root`: `<slug>-<id>.json` per audio file (optional per file). |
| `dimensions` | yes | A name for each folder level under `tracks`. Files at another depth are ignored. |
| `order` | no | Folder values to list first, in this order (filter chips, tree). The rest sort alphabetically. |
| `variant` | no | A folder level whose values are alternate versions of the same song. With dedupe on, one plays: `prefer`, else the first of `fallback` present. `dimension` is a 0-based index into `dimensions`. |
| `artQuery` | no | Query string added to cover-art URLs (`{size}` → pixels), e.g. a square crop for an image CDN. |
| `defaultFilter` | no | Filter for a fresh start (CLI, apps). |

Example with made-up values: [`profile.example.json`](profile.example.json).

## Metadata

Read generically. A track uses `name` (or `title`), `duration` (seconds), `bpm`
(values ≤ 1 mean unknown), and the first https URL in `imageUrl` / `image` /
`artwork` / `cover`. **Every list of strings** in the file becomes a search tag
(comma-joined values are split). Everything else is ignored.

Length variants (several durations of one song) are recognised by the same
display name in the same folder; the longest one plays when dedupe is on.

## Where each front end gets it

- **CLI:** reads `profile.local.json` directly.
- **iOS app:** if `profile.local.json` exists at build time, the build copies it into the app (it stays on your Mac and in the app, never in git). Otherwise the app asks you to paste it once.
- **PWA:** asks you to paste it once on the sign-in screen (kept in the browser's storage).
