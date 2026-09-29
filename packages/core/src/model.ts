export interface Track {
  id: string; // from the file name (<slug>-<id>), unique across the library
  stem: string; // file name without .mp3 (matches the metadata JSON name)
  path: string; // Dropbox path_lower, used for download / temp links
  fileName: string; // raw file name as shown in Dropbox
  name: string; // display name from metadata, else from the slug
  dims: string[]; // folder names under the tracks folder, lowercase, one per profile dimension
  size: number;
  duration: number; // seconds, 0 when unknown
  tags: string[]; // every list of strings in the metadata, flattened (search)
  bpm?: number;
  image?: string; // cover art URL from metadata
  hasMeta: boolean;
}

export interface Library {
  version: 3;
  cursor: string;
  syncedAt: string;
  tracks: Track[];
}
export const LIBRARY_VERSION = 3;

export const folderOf = (t: Track): string => t.dims.join("/");
export const albumOf = (t: Track): string => t.dims.join(" / ");

// Length variants (e.g. 15/30/60 min of the same song) share this key.
export const songKey = (t: Track): string => `${folderOf(t)}/${t.name.toLowerCase()}`;

// Every version of a song (any length, any value of the variant dimension)
// shares this key. Without a variant dimension it's the folder + name.
export const groupKey = (t: Track, variantDim?: number): string =>
  [...t.dims.filter((_, i) => i !== variantDim), t.name.toLowerCase()].join("/");

// One track per song, keeping the longest length variant.
export function dedupe(tracks: Track[]): Track[] {
  const best = new Map<string, Track>();
  for (const t of tracks) {
    const k = songKey(t);
    const cur = best.get(k);
    if (!cur || t.duration > cur.duration || (t.duration === cur.duration && t.id < cur.id)) best.set(k, t);
  }
  return [...best.values()];
}

export interface Variant {
  dimension: number;
  prefer: string;
  fallback?: string[];
}

// One version per song across the variant dimension. Runs after the filter, so
// a filter on that dimension still gets the versions it asked for. Keeps input order.
export function dedupeVariants(tracks: Track[], v: Variant | undefined, favored?: (t: Track) => boolean): Track[] {
  if (!v) return tracks;
  const fb = v.fallback ?? [];
  const rank = (t: Track) => {
    if (favored?.(t)) return 0;
    const val = t.dims[v.dimension] ?? "";
    if (val === v.prefer) return 1;
    const i = fb.indexOf(val);
    return i >= 0 ? 2 + i : 2 + fb.length;
  };
  const best = new Map<string, Track>();
  for (const t of tracks) {
    const k = groupKey(t, v.dimension);
    const cur = best.get(k);
    if (!cur || rank(t) < rank(cur)) best.set(k, t);
  }
  const keep = new Set(best.values());
  return tracks.filter((t) => keep.has(t));
}

// Path order: folder by folder, then name, then length. Used for shuffle-off and lists.
export function pathOrder(a: Track, b: Track): number {
  const n = Math.max(a.dims.length, b.dims.length);
  for (let i = 0; i < n; i++) {
    const c = (a.dims[i] ?? "").localeCompare(b.dims[i] ?? "");
    if (c) return c;
  }
  return a.name.localeCompare(b.name) || a.duration - b.duration;
}
