// Turns a Dropbox audio file entry + its metadata JSON into a Track. Metadata
// is read generically: no field names beyond the few common ones below.
import type { Track } from "./model.ts";

export type RawMeta = Record<string, unknown>;

export interface FileEntry {
  path_lower: string;
  name: string;
  size: number;
}

// Some files have comma-joined values ("a, b"); split, trim, dedupe.
export function cleanList(xs: unknown): string[] {
  if (!Array.isArray(xs)) return [];
  const out = new Set<string>();
  for (const x of xs) for (const part of String(x).split(",")) if (part.trim()) out.add(part.trim());
  return [...out];
}

export function stemOf(fileName: string): string {
  return fileName.replace(/\.(mp3|json)$/i, "");
}

// "some-song-0123abcd" → "0123abcd"
export function idOf(stem: string): string {
  return stem.slice(stem.lastIndexOf("-") + 1);
}

// Fallback display name when metadata is missing: "some-song-<id>" → "Some Song".
export function nameFromStem(stem: string): string {
  const i = stem.lastIndexOf("-");
  const slug = i > 0 ? stem.slice(0, i) : stem; // no hyphen: the whole stem (was cut by one letter)
  return slug
    .split("-")
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join(" ");
}

// "<tracksDir>/a/b/c/x.mp3" → ["a", "b", "c"]. Null when outside tracksDir or
// when the depth isn't `depth` folders (if given).
export function segmentsOf(pathLower: string, tracksDir: string, depth?: number): string[] | null {
  const prefix = tracksDir.toLowerCase().replace(/\/+$/, "") + "/";
  if (!pathLower.startsWith(prefix)) return null;
  const parts = pathLower.slice(prefix.length).split("/");
  parts.pop(); // the file
  if (depth !== undefined && parts.length !== depth) return null;
  return parts;
}

const firstString = (m: RawMeta | undefined, keys: string[]) => {
  for (const k of keys) if (typeof m?.[k] === "string" && (m[k] as string).trim()) return (m[k] as string).trim();
  return undefined;
};

// Every list of strings in the metadata, as search tags.
export function tagsOf(m: RawMeta | undefined): string[] {
  if (!m) return [];
  const out = new Set<string>();
  for (const v of Object.values(m)) if (Array.isArray(v) && v.every((x) => typeof x === "string")) for (const s of cleanList(v)) out.add(s);
  return [...out];
}

export function toTrack(file: FileEntry, meta: RawMeta | undefined, tracksDir: string, depth?: number): Track | null {
  const dims = segmentsOf(file.path_lower, tracksDir, depth);
  if (!dims) return null;
  const stem = stemOf(file.name);
  const bpm = typeof meta?.bpm === "number" && meta.bpm > 1 ? meta.bpm : undefined;
  const image = firstString(meta, ["imageUrl", "image", "artwork", "cover"]);
  return {
    id: idOf(stem),
    stem,
    path: file.path_lower,
    fileName: file.name,
    name: firstString(meta, ["name", "title"]) ?? nameFromStem(stem),
    dims,
    size: file.size,
    duration: typeof meta?.duration === "number" ? meta.duration : 0,
    tags: tagsOf(meta),
    ...(bpm ? { bpm } : {}),
    ...(image?.startsWith("https://") ? { image } : {}),
    hasMeta: !!meta,
  };
}
