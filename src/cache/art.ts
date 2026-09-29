// Cover art for macOS Now Playing (turn 7). Each track's metadata may have an
// image URL; we fetch it (with the profile's artQuery, e.g. a square crop) and
// keep it in .cache/art/. The engine center-crops again, so a
// non-square answer still shows square. Missing art never blocks playback.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, renameSync } from "node:fs";
import { join } from "node:path";
import type { Track } from "@hum/core/model";
import { artUrl } from "@hum/core/art";
import { profile } from "../config.ts";
import { log, saveResponse } from "../util.ts";

export class ArtCache {
  private inflight = new Map<string, Promise<string | undefined>>();
  private failed = new Set<string>();

  constructor(private dir: string) {}

  private file(url: string): string {
    return join(this.dir, `${createHash("sha1").update(url).digest("hex").slice(0, 16)}.jpg`);
  }

  path(t: Track): string | undefined {
    if (!t.image) return undefined;
    const p = this.file(t.image);
    return existsSync(p) ? p : undefined;
  }

  // Resolves to the local file, or undefined when there's no art or it can't be fetched.
  ensure(t: Track): Promise<string | undefined> {
    if (!t.image || this.failed.has(t.image)) return Promise.resolve(undefined);
    const hit = this.path(t);
    if (hit) return Promise.resolve(hit);
    const url = t.image;
    let p = this.inflight.get(url);
    if (!p) {
      p = this.download(url).finally(() => this.inflight.delete(url));
      this.inflight.set(url, p);
    }
    return p;
  }

  private async download(url: string): Promise<string | undefined> {
    const file = this.file(url);
    try {
      const res = await fetch(artUrl(url, profile().artQuery), { signal: AbortSignal.timeout(15_000) });
      if (!res.ok || !res.headers.get("content-type")?.startsWith("image/")) throw new Error(`art ${res.status}`);
      mkdirSync(this.dir, { recursive: true });
      await saveResponse(res, `${file}.part`);
      renameSync(`${file}.part`, file);
      return file;
    } catch (e) {
      log("art failed", (e as Error).message);
      if (!(e instanceof TypeError)) this.failed.add(url); // TypeError = offline: try again later
      return undefined;
    }
  }
}
