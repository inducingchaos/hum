// Audio cache: .cache/audio/<id>.mp3, LRU by last use (file mtime), capped in bytes.
// Pinned ids (the current track + the prefetch window) are never evicted.
import { mkdirSync, readdirSync, renameSync, rmSync, statSync, statfsSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { download } from "../dropbox/client.ts";
import type { Track } from "@hum/core/model";
import { saveResponse } from "../util.ts";

export class SizeMismatch extends Error {}

export class AudioCache {
  private files = new Map<string, { size: number; used: number }>();

  constructor(
    readonly dir: string,
    public cap: number,
  ) {
    mkdirSync(dir, { recursive: true });
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (name.endsWith(".part")) {
        rmSync(full, { force: true }); // leftovers from an interrupted download
        continue;
      }
      if (!name.endsWith(".mp3")) continue;
      const st = statSync(full);
      this.files.set(name.slice(0, -4), { size: st.size, used: st.mtimeMs });
    }
  }

  path(id: string): string {
    return join(this.dir, `${id}.mp3`);
  }

  has(id: string): boolean {
    return this.files.has(id);
  }

  get totalBytes(): number {
    let n = 0;
    for (const f of this.files.values()) n += f.size;
    return n;
  }

  get count(): number {
    return this.files.size;
  }

  touch(id: string): void {
    const f = this.files.get(id);
    if (!f) return;
    f.used = Date.now();
    try {
      const now = new Date();
      utimesSync(this.path(id), now, now);
    } catch {}
  }

  freeDiskBytes(): number {
    try {
      const s = statfsSync(this.dir);
      return s.bavail * s.bsize;
    } catch {
      return Infinity;
    }
  }

  // Downloads a track into the cache (.part then rename). Throws on abort/network/size errors.
  async fetch(track: Track, signal: AbortSignal): Promise<void> {
    const part = `${this.path(track.id)}.part`;
    try {
      const res = await download(track.path, signal);
      const n = await saveResponse(res, part);
      if (signal.aborted) throw new DOMException("aborted", "AbortError");
      if (track.size && n !== track.size) throw new SizeMismatch(`${track.id}: got ${n}, want ${track.size}`);
      renameSync(part, this.path(track.id));
      this.files.set(track.id, { size: n, used: Date.now() });
    } catch (e) {
      rmSync(part, { force: true });
      throw e;
    }
  }

  // Deletes least-recently-used files until under the cap.
  evict(pinned: Set<string>): void {
    let total = this.totalBytes;
    if (total <= this.cap) return;
    const lru = [...this.files.entries()].filter(([id]) => !pinned.has(id)).sort((a, b) => a[1].used - b[1].used);
    for (const [id, f] of lru) {
      if (total <= this.cap) break;
      this.remove(id);
      total -= f.size;
    }
  }

  // Deletes every unpinned file. Returns bytes freed.
  clear(pinned: Set<string>): number {
    let freed = 0;
    for (const [id, f] of [...this.files.entries()]) {
      if (pinned.has(id)) continue;
      this.remove(id);
      freed += f.size;
    }
    return freed;
  }

  private remove(id: string): void {
    rmSync(this.path(id), { force: true });
    this.files.delete(id);
  }
}
