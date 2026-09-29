# Library layout (generic)

The owner's real library was explored read-only on 2026-09-27; its specifics
(paths, folder names, counts, metadata fields, track names) are **not** kept in
this public repo (AGENTS.md rule 5). They live in the owner's gitignored
`profile.local.json` (`docs/profile.md`) and in the local, gitignored caches
(`.cache/library.json`, `.cache/meta/`), which can be regenerated with `pnpm sync`.

## What the code expects

```
<root>/
  <tracks>/<level 1>/<level 2>/…/<slug>-<id>.mp3     one folder level per profile dimension
  <metadata>/<slug>-<id>.json                        optional, same file stem as the audio
```

- Audio at another depth is ignored. The owner's library has three folder levels.
- The id is the part of the file stem after the last hyphen; it's unique across the library.
- Metadata is optional per file. Without it, the name comes from the slug (`quiet-harbour-<id>` → "Quiet Harbour") and the duration is 0 until played.

## Generic findings that shaped the code

- **Length variants:** the same song can exist in several durations in the same folder, under the same display name. With dedupe on, the longest plays (`dedupe` in `packages/core/src/model.ts`).
- **Version variants:** one folder level (the profile's `variant`) holds alternate versions of the same song that sound alike. With dedupe on, one version plays: the preferred value, else a fallback (`dedupeVariants`). A favourite covers every version (`groupKey` skips that level).
- **Filter vocabulary:** folder names are unique per level but can share prefixes across levels, and some contain hyphens, so the filter matches exact names, hyphen-free forms, hyphen parts, and only *unique* prefixes (`packages/core/src/filter.ts`).
- **Data quirks to normalise:** some list values are comma-joined in a single string (split and trim them), and some `bpm` values are 0 or 1 (treat as unknown). Display names are short (under ~40 characters), so single-line rows work.
- **Size:** the audio totals tens of GB (median file roughly 25 MB, the largest over 100 MB), which is why only a small window is cached on each device.
