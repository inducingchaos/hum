// Library index on the phone (plan-web §6). First run: one listing of the
// library root plus ONE download_zip of the metadata folder. Later runs: the
// stored library loads instantly and a cursor delta runs in the background.
// Where things are comes from the profile (docs/profile.md).
import { LIBRARY_VERSION, type Library, type Track } from "@hum/core/model";
import { metadataDir, tracksDir } from "@hum/core/profile";
import { stemOf, toTrack, type FileEntry, type RawMeta } from "@hum/core/normalize";
import { unzipSync } from "fflate";
import { kv } from "./db.ts";
import { download, downloadZip, listAll, type ListEntry } from "./dropbox.ts";
import { log } from "./log.ts";
import { profile } from "./profile.ts";

const TRACKS_PREFIX = () => `${tracksDir(profile())}/`.toLowerCase();
const META_PREFIX = () => `${metadataDir(profile())}/`.toLowerCase();

const isMp3 = (e: ListEntry) => e[".tag"] === "file" && e.path_lower.startsWith(TRACKS_PREFIX()) && e.name.toLowerCase().endsWith(".mp3");
const isMeta = (e: ListEntry) => e[".tag"] === "file" && e.path_lower.startsWith(META_PREFIX()) && e.name.toLowerCase().endsWith(".json");
const fileOf = (e: ListEntry): FileEntry => ({ path_lower: e.path_lower, name: e.name, size: e.size ?? 0 });

export const loadLibrary = async () => {
  const lib = await kv.get<Library>("library");
  return lib?.version === LIBRARY_VERSION ? lib : undefined;
};
const saveLibrary = (lib: Library) => kv.set("library", lib);

// Zip entries look like "metadata/<stem>.json". Keyed by lowercase stem.
export function parseMetaZip(zip: Uint8Array): Map<string, RawMeta> {
  const out = new Map<string, RawMeta>();
  const dec = new TextDecoder();
  for (const [name, bytes] of Object.entries(unzipSync(zip))) {
    const base = name.slice(name.lastIndexOf("/") + 1);
    if (!base.toLowerCase().endsWith(".json")) continue;
    try {
      out.set(stemOf(base).toLowerCase(), JSON.parse(dec.decode(bytes)));
    } catch {
      /* a broken file just means that track shows its file name */
    }
  }
  return out;
}

async function pool<T>(items: T[], n: number, fn: (x: T) => Promise<void>): Promise<void> {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) await fn(items[i++]!);
  }));
}

async function fetchMetas(stems: string[], onProgress?: (done: number) => void): Promise<Map<string, RawMeta>> {
  const out = new Map<string, RawMeta>();
  let done = 0;
  await pool(stems, 12, async (stem) => {
    try {
      out.set(stem.toLowerCase(), await (await download(`${metadataDir(profile())}/${stem}.json`)).json());
    } catch (e) {
      log(`meta fetch failed ${stem}: ${(e as Error).message}`);
    }
    onProgress?.(++done);
  });
  return out;
}

const build = (files: FileEntry[], metas: Map<string, RawMeta>): Track[] =>
  files.map((f) => toTrack(f, metas.get(stemOf(f.name).toLowerCase()), tracksDir(profile()), profile().dimensions.length)).filter((t): t is Track => !!t);

// Phase 1 (seconds): the listing alone. Names come from file names, no
// durations or art yet, but it's enough to start playing (turn 13: the metadata
// zip took 38 s on the phone and the screen looked stuck).
export async function listTracks(onProgress: (msg: string) => void): Promise<Library> {
  const t0 = performance.now();
  const { entries, cursor } = await listAll({ path: profile().root }, (n) => onProgress(`LISTING ${n.toLocaleString()} FILES`));
  const files = entries.filter(isMp3).map(fileOf);
  const lib: Library = { version: LIBRARY_VERSION, cursor, syncedAt: new Date().toISOString(), tracks: build(files, new Map()) };
  await saveLibrary(lib);
  log(`listing: ${lib.tracks.length} tracks in ${Math.round(performance.now() - t0)} ms`);
  return lib;
}

export const needsMetadata = (lib: Library) => lib.tracks.filter((t) => !t.hasMeta).length > lib.tracks.length / 2;

// Phase 2 (tens of seconds, in the background): one zip of every metadata file,
// or single files if the zip fails.
export async function fillMetadata(lib: Library, onProgress: (msg: string) => void): Promise<Library> {
  const t0 = performance.now();
  let metas: Map<string, RawMeta> | undefined;
  try {
    onProgress("ZIPPING METADATA");
    const res = await downloadZip(metadataDir(profile()));
    onProgress("READING METADATA");
    metas = parseMetaZip(new Uint8Array(await res.arrayBuffer()));
    log(`metadata zip: ${metas.size} files in ${Math.round(performance.now() - t0)} ms`);
  } catch (e) {
    log(`metadata zip failed, falling back to single files: ${(e as Error).message}`);
  }
  const files = lib.tracks.map((t) => ({ path_lower: t.path, name: t.fileName, size: t.size }));
  if (!metas || metas.size < files.length / 2) {
    metas = await fetchMetas(files.map((f) => stemOf(f.name)), (d) => onProgress(`METADATA ${d.toLocaleString()} / ${files.length.toLocaleString()}`));
  }
  const full: Library = { ...lib, syncedAt: new Date().toISOString(), tracks: build(files, metas) };
  await saveLibrary(full);
  log(`metadata: ${full.tracks.filter((t) => t.hasMeta).length} / ${full.tracks.length} in ${Math.round(performance.now() - t0)} ms`);
  return full;
}

// Changes since the saved cursor. Returns the new library, or null when nothing changed.
export async function deltaSync(lib: Library): Promise<Library | null> {
  let res;
  try {
    res = await listAll({ cursor: lib.cursor });
  } catch (e) {
    if (/409/.test((e as Error).message)) return fillMetadata(await listTracks(() => {}), () => {}); // cursor reset
    throw e;
  }
  const byPath = new Map(lib.tracks.map((t) => [t.path, t]));
  const changed = new Map<string, FileEntry>();
  const refresh = new Set<string>();
  for (const e of res.entries) {
    if (e[".tag"] === "deleted") {
      for (const p of [...byPath.keys()]) if (p === e.path_lower || p.startsWith(e.path_lower + "/")) byPath.delete(p);
    } else if (isMp3(e)) changed.set(e.path_lower, fileOf(e));
    else if (isMeta(e)) refresh.add(stemOf(e.name).toLowerCase());
  }
  for (const t of byPath.values()) {
    if (!t.hasMeta || refresh.has(t.stem.toLowerCase())) changed.set(t.path, { path_lower: t.path, name: t.fileName, size: t.size });
  }
  const nothing = changed.size === 0 && byPath.size === lib.tracks.length;
  if (nothing && res.cursor === lib.cursor) return null;
  const files = [...changed.values()];
  for (const t of build(files, await fetchMetas(files.map((f) => stemOf(f.name))))) byPath.set(t.path, t);
  const next: Library = { version: LIBRARY_VERSION, cursor: res.cursor, syncedAt: new Date().toISOString(), tracks: [...byPath.values()] };
  await saveLibrary(next);
  log(`delta sync: ${changed.size} changed, ${next.tracks.length} tracks`);
  return nothing ? null : next;
}
