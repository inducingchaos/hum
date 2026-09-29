// Keeps the window (current track + next N) on disk, one download at a time in
// window order, so the very next track is always the first thing ready.
import { AuthError } from "../dropbox/client.ts";
import type { Track } from "@hum/core/model";
import { log } from "../util.ts";
import { AudioCache, SizeMismatch } from "./lru.ts";

export type CacheMark = "cached" | "downloading" | "missing";

export interface PrefetchEvents {
  cached(id: string): void; // a download finished
  offline(offline: boolean): void;
  authExpired(): void;
  diskLow(low: boolean): void;
  failed(id: string): void; // gave up on a track (bad size twice)
}

export class Prefetcher {
  private window: Track[] = [];
  private active?: { id: string; ctrl: AbortController };
  private running = false;
  private attempts = new Map<string, number>();
  private bad = new Set<string>();
  private backoffMs = 0;
  private wake?: () => void;
  offline = false;
  diskLow = false;

  constructor(
    private cache: AudioCache,
    private minFreeBytes: number,
    private on: PrefetchEvents,
  ) {}

  mark(id: string): CacheMark {
    if (this.cache.has(id)) return "cached";
    return this.active?.id === id ? "downloading" : "missing";
  }

  pinned(): Set<string> {
    return new Set(this.window.map((t) => t.id));
  }

  setWindow(tracks: Track[]): void {
    this.window = tracks;
    const ids = this.pinned();
    if (this.active && !ids.has(this.active.id)) this.active.ctrl.abort();
    this.kick();
  }

  // Retry now (e.g. after the network comes back or the user pressed a key).
  kick(): void {
    this.backoffMs = Math.min(this.backoffMs, 1000);
    this.wake?.();
    if (!this.running) void this.loop();
  }

  private nextMissing(): Track | undefined {
    return this.window.find((t) => !this.cache.has(t.id) && !this.bad.has(t.id));
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((res) => {
      const timer = setTimeout(res, ms);
      this.wake = () => {
        clearTimeout(timer);
        res();
      };
    });
  }

  private async loop(): Promise<void> {
    this.running = true;
    try {
      for (let t = this.nextMissing(); t; t = this.nextMissing()) {
        const low = this.cache.freeDiskBytes() < this.minFreeBytes;
        if (low !== this.diskLow) this.on.diskLow((this.diskLow = low));
        if (low) {
          await this.sleep(30_000);
          continue;
        }
        const ctrl = new AbortController();
        this.active = { id: t.id, ctrl };
        try {
          await this.cache.fetch(t, ctrl.signal);
          this.backoffMs = 0;
          if (this.offline) this.on.offline((this.offline = false));
          this.cache.evict(this.pinned());
          this.on.cached(t.id);
        } catch (e) {
          if (ctrl.signal.aborted) continue;
          log("prefetch failed", t.id, (e as Error).message);
          if (e instanceof AuthError) {
            this.on.authExpired();
            return;
          }
          // Bad bytes or a missing file won't fix themselves: retry once, then skip.
          // Anything else (dropped connection, 5xx) is treated as offline with backoff.
          if (e instanceof SizeMismatch || /download 409/.test((e as Error).message)) {
            const n = (this.attempts.get(t.id) ?? 0) + 1;
            this.attempts.set(t.id, n);
            if (n >= 2) {
              this.bad.add(t.id);
              this.on.failed(t.id);
            }
            continue;
          }
          if (!this.offline) this.on.offline((this.offline = true));
          this.backoffMs = Math.min(Math.max(this.backoffMs * 2, 2000), 60_000);
          await this.sleep(this.backoffMs);
        } finally {
          this.active = undefined;
        }
      }
    } finally {
      this.running = false;
    }
  }
}
