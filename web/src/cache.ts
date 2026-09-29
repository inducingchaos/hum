// Audio cache on the phone (plan-web §8). Whole MP3s in Cache Storage, keyed by
// track id. Window = the 2 played before now (kept, never downloaded again),
// now, and the next 3 (downloaded one at a time, in order). Everything else is
// least-recently-played-first out once the cap is passed.
import type { Track } from "@hum/core/model";
import { signal } from "@preact/signals";
import { kv } from "./db.ts";
import { AuthError, download, NetworkError } from "./dropbox.ts";
import { log } from "./log.ts";

const CACHE = "hum-audio-v1";
const key = (id: string) => `/__audio/${id}`;
export const CAP_BYTES = 1e9;

interface Entry {
  size: number;
  usedAt: number;
}

export const cachedIds = signal<ReadonlySet<string>>(new Set());
export const downloading = signal<{ id: string; pct: number } | null>(null);
export const cacheBytes = signal(0);

let index: Record<string, Entry> = {};
let cap = CAP_BYTES;
let cache: Cache | undefined;

const publish = () => {
  cachedIds.value = new Set(Object.keys(index));
  cacheBytes.value = Object.values(index).reduce((n, e) => n + e.size, 0);
  void kv.set("cacheIndex", index).catch(() => {});
};

export async function initCache(): Promise<void> {
  cache = await caches.open(CACHE);
  const saved = (await kv.get<Record<string, Entry>>("cacheIndex")) ?? {};
  const present = new Set((await cache.keys()).map((r) => new URL(r.url).pathname.split("/").pop()!));
  index = {};
  for (const id of present) index[id] = saved[id] ?? { size: 0, usedAt: 0 };
  publish();
  // Ask iOS not to evict us under storage pressure. Best effort, not awaited:
  // it held up every launch.
  void navigator.storage?.persist?.().then(
    (p) => log(`cache: ${present.size} tracks, persist=${p}`),
    () => {},
  );
}

export const isCached = (id: string) => id in index;

// The cached bytes of a track, or undefined.
export async function cachedBlob(id: string): Promise<Blob | undefined> {
  if (!cache || !(id in index)) return undefined;
  const res = await cache.match(key(id));
  if (!res) {
    delete index[id];
    publish();
    return undefined;
  }
  index[id]!.usedAt = Date.now();
  publish();
  return res.blob();
}

// A blob: URL for a cached track, or undefined. The caller revokes it.
export async function cachedUrl(id: string): Promise<string | undefined> {
  if (!cache || !(id in index)) return undefined;
  const res = await cache.match(key(id));
  if (!res) {
    delete index[id];
    publish();
    return undefined;
  }
  index[id]!.usedAt = Date.now();
  publish();
  return URL.createObjectURL(await res.blob());
}

async function fetchTrack(t: Track, signal: AbortSignal): Promise<void> {
  const t0 = performance.now();
  const res = await download(t.path, signal);
  const reader = res.body!.getReader();
  const chunks: Uint8Array[] = [];
  let got = 0;
  let lastPct = -1;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.length;
    const pct = t.size ? Math.floor((got / t.size) * 100) : 0;
    if (pct !== lastPct) downloading.value = { id: t.id, pct: (lastPct = pct) };
  }
  if (t.size && got !== t.size) throw new Error(`size mismatch ${got} != ${t.size}`);
  const blob = new Blob(chunks as BlobPart[], { type: "audio/mpeg" });
  try {
    await cache!.put(key(t.id), new Response(blob, { headers: { "Content-Type": "audio/mpeg", "Content-Length": String(got) } }));
  } catch (e) {
    // Storage full: shrink the cap to what fits and carry on streaming.
    cap = Math.max(200e6, cacheBytes.value * 0.8);
    throw new Error(`cache full, cap now ${Math.round(cap / 1e6)} MB: ${(e as Error).message}`);
  }
  index[t.id] = { size: got, usedAt: Date.now() };
  publish();
  log(`cached ${t.name} (${Math.round(got / 1e6)} MB, ${((performance.now() - t0) / 1000).toFixed(1)} s)`);
}

async function evict(pinned: ReadonlySet<string>): Promise<void> {
  let total = cacheBytes.value;
  const victims = Object.entries(index)
    .filter(([id]) => !pinned.has(id))
    .sort((a, b) => a[1].usedAt - b[1].usedAt);
  for (const [id, e] of victims) {
    if (total <= cap) break;
    await cache!.delete(key(id));
    delete index[id];
    total -= e.size;
  }
  publish();
}

export async function clearCache(): Promise<void> {
  prefetch.stop();
  await caches.delete(CACHE);
  cache = await caches.open(CACHE);
  index = {};
  publish();
}

// ── Prefetch ────────────────────────────────────────────────────────────────

class Prefetcher {
  private want: Track[] = [];
  private pinned: ReadonlySet<string> = new Set();
  private current?: { id: string; ctl: AbortController };
  private running = false;
  private stopped = false;

  // `download`: now + next 3 in play order. `keep`: also the 2 played before now.
  setWindow(downloadOrder: Track[], keep: string[]): void {
    this.stopped = false;
    this.want = downloadOrder;
    this.pinned = new Set([...downloadOrder.map((t) => t.id), ...keep]);
    if (this.current && !this.pinned.has(this.current.id)) {
      log(`prefetch: abort ${this.current.id} (left the window)`);
      this.current.ctl.abort();
    }
    void this.run();
  }

  stop(): void {
    this.stopped = true;
    this.current?.ctl.abort();
  }

  private async run(): Promise<void> {
    if (this.running || !cache) return;
    this.running = true;
    try {
      for (;;) {
        if (this.stopped) return;
        const next = this.want.find((t) => !(t.id in index));
        if (!next) break;
        const ctl = new AbortController();
        this.current = { id: next.id, ctl };
        try {
          log(`prefetch: start ${next.name}`);
          await fetchTrack(next, ctl.signal);
        } catch (e) {
          if ((e as Error).name === "AbortError") continue;
          log(`prefetch: ${next.name} failed: ${(e as Error).message}`);
          if (e instanceof AuthError) return;
          // Offline or flaky: wait, then try again (the window may have moved by then).
          await new Promise((r) => setTimeout(r, e instanceof NetworkError ? 10_000 : 3_000));
        } finally {
          this.current = undefined;
          downloading.value = null;
        }
      }
      await evict(this.pinned);
    } finally {
      this.running = false;
    }
  }
}

export const prefetch = new Prefetcher();
