// Library index: a full listing on first run, then cheap cursor deltas in the background.
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { paths, profile } from "../config.ts";
import { download, downloadZip, listAll, type ListEntry } from "../dropbox/client.ts";
import { unzip } from "./zip.ts";
import { log, readJson, writeJsonAtomic } from "../util.ts";
import { LIBRARY_VERSION, type Library, type Track } from "@hum/core/model";
import { metadataDir, tracksDir } from "@hum/core/profile";
import { stemOf, toTrack, type FileEntry, type RawMeta } from "@hum/core/normalize";

// The profile decides where tracks and metadata live (docs/profile.md).
const TRACKS_PREFIX = () => `${tracksDir(profile())}/`.toLowerCase();
const META_PREFIX = () => `${metadataDir(profile())}/`.toLowerCase();
const make = (f: FileEntry, meta: RawMeta | undefined) => toTrack(f, meta, tracksDir(profile()), profile().dimensions.length);

export function loadLibrary(): Library | null {
  if (!existsSync(paths.library)) return null;
  try {
    const lib = readJson<{ version: number } & Omit<Library, "version">>(paths.library);
    if (lib.version === LIBRARY_VERSION) return lib as Library;
    return migrate(lib.tracks, lib.cursor);
  } catch {
    return null;
  }
}

// Older versions are rebuilt from the metadata already on disk: no network, ~100 ms.
function migrate(old: Track[], cursor: string): Library {
  const tracks = old.map((t) => make({ path_lower: t.path, name: t.fileName, size: t.size }, readMeta(t.stem))).filter((t): t is Track => !!t);
  const lib: Library = { version: LIBRARY_VERSION, cursor, syncedAt: new Date().toISOString(), tracks };
  saveLibrary(lib);
  return lib;
}

function saveLibrary(lib: Library): void {
  writeJsonAtomic(paths.library, lib);
}

const metaFile = (stem: string) => join(paths.meta, `${stem}.json`);

function readMeta(stem: string): RawMeta | undefined {
  try {
    return JSON.parse(readFileSync(metaFile(stem), "utf8"));
  } catch {
    return undefined;
  }
}

async function fetchMeta(stem: string): Promise<RawMeta | undefined> {
  try {
    const res = await download(`${metadataDir(profile())}/${stem}.json`);
    const text = await res.text();
    const meta = JSON.parse(text);
    mkdirSync(paths.meta, { recursive: true });
    await Bun.write(metaFile(stem), text);
    return meta;
  } catch (e) {
    log("meta fetch failed", stem, (e as Error).message);
    return undefined;
  }
}

async function pool<T>(items: T[], n: number, fn: (x: T) => Promise<void>): Promise<void> {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) await fn(items[i++]!);
  }));
}

const isMp3 = (e: ListEntry) => e[".tag"] === "file" && e.path_lower.startsWith(TRACKS_PREFIX()) && e.name.toLowerCase().endsWith(".mp3");
const isMeta = (e: ListEntry) => e[".tag"] === "file" && e.path_lower.startsWith(META_PREFIX()) && e.name.toLowerCase().endsWith(".json");

async function buildTracks(files: FileEntry[], onProgress?: (done: number, total: number) => void): Promise<Track[]> {
  const metas = new Map<string, RawMeta | undefined>();
  const missing: string[] = [];
  for (const f of files) {
    const stem = stemOf(f.name);
    const m = readMeta(stem);
    if (m) metas.set(stem, m);
    else missing.push(stem);
  }
  let done = files.length - missing.length;
  onProgress?.(done, files.length);
  await pool(missing, 12, async (stem) => {
    metas.set(stem, await fetchMeta(stem));
    onProgress?.(++done, files.length);
  });
  return files.map((f) => make(f, metas.get(stemOf(f.name)))).filter((t): t is Track => !!t);
}

// Fresh caches: fetch the whole metadata folder as ONE zip into .cache/meta/
// (turn 17: one file at a time ran at ~30/s, minutes on a fresh clone).
// Falls back to per-file downloads if the zip fails.
async function fetchMetaZip(onProgress?: (msg: string) => void): Promise<number> {
  const t0 = Date.now();
  const timer = setInterval(() => onProgress?.(`ZIPPING METADATA · ${Math.floor((Date.now() - t0) / 1000)} s`), 1000);
  try {
    onProgress?.("ZIPPING METADATA · 0 s");
    const zip = new Uint8Array(await (await downloadZip(metadataDir(profile()))).arrayBuffer());
    clearInterval(timer);
    onProgress?.("READING METADATA");
    mkdirSync(paths.meta, { recursive: true });
    let n = 0;
    for (const { name, data } of unzip(zip)) {
      const base = name.slice(name.lastIndexOf("/") + 1);
      if (!base.toLowerCase().endsWith(".json")) continue;
      await Bun.write(metaFile(stemOf(base)), data);
      n++;
    }
    log("metadata zip", n, "files in", Date.now() - t0, "ms");
    return n;
  } catch (e) {
    log("metadata zip failed", (e as Error).message);
    return 0;
  } finally {
    clearInterval(timer);
  }
}

export async function fullSync(onProgress?: (msg: string) => void): Promise<Library> {
  const { entries, cursor } = await listAll({ path: profile().root }, (n) => onProgress?.(`LISTING ${n.toLocaleString()}`));
  const files = entries.filter(isMp3).map((e) => ({ path_lower: e.path_lower, name: e.name, size: e.size ?? 0 }));
  const missing = files.filter((f) => !existsSync(metaFile(stemOf(f.name)))).length;
  if (missing > 50) await fetchMetaZip(onProgress);
  const tracks = await buildTracks(files, (d, t) => onProgress?.(`INDEXING ${d.toLocaleString()} / ${t.toLocaleString()}`));
  const lib: Library = { version: LIBRARY_VERSION, cursor, syncedAt: new Date().toISOString(), tracks };
  saveLibrary(lib);
  return lib;
}

// Applies changes since the saved cursor. Returns the new library, or null when nothing changed.
export async function deltaSync(lib: Library): Promise<Library | null> {
  let res;
  try {
    res = await listAll({ cursor: lib.cursor });
  } catch (e) {
    // An expired/reset cursor comes back as 409 "reset": start over.
    if (/409/.test((e as Error).message)) return fullSync();
    throw e;
  }
  const byPath = new Map(lib.tracks.map((t) => [t.path, t]));
  const changed = new Map<string, FileEntry>();
  const refreshMeta = new Set<string>();
  for (const e of res.entries) {
    if (e[".tag"] === "deleted") {
      for (const p of [...byPath.keys()]) if (p === e.path_lower || p.startsWith(e.path_lower + "/")) byPath.delete(p);
      if (e.path_lower.startsWith(META_PREFIX())) rmSync(metaFile(stemOf(e.name)), { force: true });
    } else if (isMp3(e)) {
      changed.set(e.path_lower, { path_lower: e.path_lower, name: e.name, size: e.size ?? 0 });
    } else if (isMeta(e)) {
      refreshMeta.add(stemOf(e.name).toLowerCase());
    }
  }
  // Retry tracks that had no metadata last time, and pick up edited metadata.
  for (const t of byPath.values()) {
    if (!t.hasMeta || refreshMeta.has(t.stem.toLowerCase())) {
      if (refreshMeta.has(t.stem.toLowerCase())) rmSync(metaFile(t.stem), { force: true });
      changed.set(t.path, { path_lower: t.path, name: t.fileName, size: t.size });
    }
  }
  const nothing = changed.size === 0 && byPath.size === lib.tracks.length;
  if (nothing && res.cursor === lib.cursor) return null;
  for (const t of await buildTracks([...changed.values()])) byPath.set(t.path, t);
  const next: Library = { version: LIBRARY_VERSION, cursor: res.cursor, syncedAt: new Date().toISOString(), tracks: [...byPath.values()] };
  saveLibrary(next);
  return nothing ? null : next;
}
