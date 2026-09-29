// The stream engine (turn 13). One <audio> element fed by ONE MediaSource
// (ManagedMediaSource on iOS). Tracks are appended back to back into the same
// SourceBuffer, so the element never ends or changes `src` at a track change:
// nothing for iOS to defer while the lock screen is lit, and no gap.
//
// Timeline: element time only goes forward. Each track is a segment
// [start, end) on it; `end` is known once all its bytes are appended. A jump
// (tap, next, prev, a seek outside what's buffered) drops the buffer and starts
// a fresh segment a little ahead of the current element time.
import type { Track } from "@hum/core/model";
import { AuthError } from "../dropbox.ts";
import { log } from "../log.ts";
import { openReader, type Reader } from "../source.ts";
import type { Engine, EngineEvents } from "./types.ts";

const AHEAD = 120; // seconds buffered ahead of the playhead
const BEHIND = 20; // seconds kept behind it
const MIME = "audio/mpeg";

interface Seg {
  t: Track;
  start: number; // element time where the track's 0:00 is
  end?: number; // set once fully appended
  at: number; // track seconds the first appended byte corresponds to
  reader?: Reader;
  byte?: number; // next byte to append (to reopen after a network error)
}

const MMS: typeof MediaSource | undefined = (globalThis as any).ManagedMediaSource;

export function streamSupport(): { ok: boolean; api: string } {
  const Api = MMS ?? (globalThis as any).MediaSource;
  const api = MMS ? "ManagedMediaSource" : Api ? "MediaSource" : "none";
  return { ok: !!Api?.isTypeSupported?.(MIME), api };
}

export class StreamEngine implements Engine {
  readonly name = "stream";
  private ms: MediaSource;
  private sb?: SourceBuffer;
  private opened: Promise<void>;
  private segs: Seg[] = [];
  private cur?: Seg;
  private next?: Track;
  private gen = 0; // bumped to stop the feeder
  private feeding?: Promise<void>;
  private wake?: () => void;
  private jumpTo?: number; // element time to seek to once data is there
  private endedSent = false;
  private ctl = new AbortController();

  constructor(private audio: HTMLAudioElement, private ev: EngineEvents) {
    this.ms = MMS ? new MMS() : new MediaSource();
    if (MMS) {
      // ManagedMediaSource needs this (or an AirPlay fallback source). AirPlay
      // still works as an audio route from Control Center.
      audio.disableRemotePlayback = true;
      this.ms.addEventListener("startstreaming", () => this.poke());
    }
    this.opened = new Promise((resolve) =>
      this.ms.addEventListener(
        "sourceopen",
        () => {
          this.sb = this.ms.addSourceBuffer(MIME);
          if (this.sb.mode !== "sequence") {
            try {
              this.sb.mode = "sequence";
            } catch {}
          }
          resolve();
        },
        { once: true },
      ),
    );
    audio.src = URL.createObjectURL(this.ms);
    audio.addEventListener("timeupdate", () => this.tick());
    audio.addEventListener("ended", () => this.onEnded());
    audio.addEventListener("error", () => {
      const e = audio.error;
      log(`audio error ${e?.code}: ${e?.message ?? ""} (stream engine)`);
    });
  }

  get paused() {
    return this.audio.paused;
  }

  position() {
    const s = this.cur;
    if (!s) return 0;
    if (this.jumpTo !== undefined) return this.jumpTo - s.start;
    return Math.max(0, this.audio.currentTime - s.start);
  }

  play() {
    this.audio.play().catch((e) => log(`play() refused: ${e.name}`));
  }

  pause() {
    this.audio.pause();
  }

  // Operations that rebuild the buffer run one at a time (turn 14: a skip and
  // the setNext right after it could interleave and cancel each other).
  private chain: Promise<void> = Promise.resolve();
  private loads = 0;
  private jumped?: () => void;

  private enqueue(fn: () => Promise<void>): Promise<void> {
    const p = this.chain.then(fn);
    this.chain = p.catch((e) => log(`stream op failed: ${(e as Error).message}`));
    return p;
  }

  // Resolves once the new track is actually at the playhead.
  load(t: Track, at: number, autoplay: boolean): Promise<void> {
    // play() before any await, so a tap still counts as the user's gesture.
    if (autoplay) this.play();
    const token = ++this.loads;
    let done: Promise<void> | undefined;
    const op = this.enqueue(async () => {
      if (token !== this.loads) return; // a newer skip replaced this one
      const gen = await this.stop();
      await this.opened;
      await this.idle();
      if (this.ms.readyState === "open") this.sb!.abort(); // parser reset: the old file was cut mid-frame
      // Append after what's buffered and jump there once data is in. The old
      // track keeps sounding until then instead of dropping to silence, and the
      // old range is evicted afterwards.
      const start = Math.ceil(Math.max(this.bufferedEnd(), this.audio.currentTime)) + 1;
      const seg: Seg = { t, start, at };
      this.segs = [seg];
      this.cur = seg;
      this.endedSent = false;
      this.jumpTo = start + at;
      this.jumped?.();
      done = new Promise<void>((r) => (this.jumped = r));
      log(`load ${t.name}${at ? ` at ${Math.round(at)} s` : ""}${autoplay ? "" : " (paused)"}`);
      this.feed(gen);
    });
    // Not awaited inside the op: a failed feed must never block the next skip.
    return op.then(() => done);
  }

  setNext(t: Track | undefined) {
    if (this.next?.id === t?.id) return;
    this.next = t;
    void this.enqueue(async () => {
      const queued = this.segs.at(-1);
      // Already appending (or appended) a different next track: cut it off.
      if (queued && queued !== this.cur && queued.t.id !== this.next?.id) await this.dropAfterCurrent();
      else this.poke();
    });
  }

  seek(sec: number) {
    const s = this.cur;
    if (!s) return;
    const target = s.start + Math.max(0, sec);
    if (this.buffered(target)) {
      this.audio.currentTime = target;
      this.ev.time(sec);
      return;
    }
    void this.load(s.t, sec, !this.audio.paused);
  }

  // ── internals ─────────────────────────────────────────────────────────────

  private poke() {
    this.wake?.();
  }

  private buffered(time: number): boolean {
    const b = this.sb?.buffered;
    if (!b) return false;
    for (let i = 0; i < b.length; i++) if (time >= b.start(i) && time < b.end(i) - 0.5) return true;
    return false;
  }

  private bufferedEnd(): number {
    const b = this.sb?.buffered;
    return b && b.length ? b.end(b.length - 1) : 0;
  }

  private idle(): Promise<void> {
    const sb = this.sb;
    if (!sb?.updating) return Promise.resolve();
    return new Promise((r) => sb.addEventListener("updateend", () => r(), { once: true }));
  }

  private async op(fn: (sb: SourceBuffer) => void): Promise<void> {
    await this.idle();
    const sb = this.sb!;
    await new Promise<void>((resolve, reject) => {
      const done = () => {
        sb.removeEventListener("updateend", done);
        sb.removeEventListener("error", fail);
        resolve();
      };
      const fail = () => {
        sb.removeEventListener("updateend", done);
        sb.removeEventListener("error", fail);
        reject(new Error("SourceBuffer error"));
      };
      sb.addEventListener("updateend", done);
      sb.addEventListener("error", fail);
      try {
        fn(sb);
      } catch (e) {
        sb.removeEventListener("updateend", done);
        sb.removeEventListener("error", fail);
        reject(e);
      }
    });
  }

  // Stop the feeder; resolves with the new generation once it has exited.
  private async stop(): Promise<number> {
    const gen = ++this.gen;
    this.ctl.abort();
    this.ctl = new AbortController();
    this.poke();
    await this.feeding?.catch(() => {});
    // Aborted readers can't be read again; the next loop reopens at seg.byte.
    for (const s of this.segs) s.reader = undefined;
    return gen;
  }

  private async dropAfterCurrent() {
    const cur = this.cur;
    const gen = await this.stop();
    if (gen !== this.gen || !cur) return;
    if (cur.end !== undefined) {
      await this.idle();
      if (this.bufferedEnd() > cur.end) await this.op((sb) => sb.remove(cur.end!, Infinity));
    }
    this.segs = this.segs.slice(0, this.segs.indexOf(cur) + 1);
    // If the current track wasn't fully appended, feed() carries on where it stopped.
    this.feed(gen);
  }

  private feed(gen: number) {
    this.feeding = this.loop(gen).catch((e) => {
      if (gen !== this.gen) return;
      this.jumped?.();
      this.jumped = undefined;
      log(`stream feed failed: ${(e as Error).message}`);
      this.ev.failed(e instanceof AuthError ? "DROPBOX SIGN-IN EXPIRED" : `CAN'T STREAM: ${(e as Error).message}`);
    });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => {
      const id = setTimeout(r, ms);
      this.wake = () => {
        clearTimeout(id);
        r();
      };
    });
  }

  // ManagedMediaSource says when it wants data (it saves power by batching).
  private wantsData(): boolean {
    return !MMS || (this.ms as any).streaming !== false;
  }

  private async loop(gen: number) {
    const signal = this.ctl.signal;
    while (gen === this.gen) {
      const seg = this.segs.at(-1)!;
      const ahead = this.bufferedEnd() - Math.max(this.audio.currentTime, this.jumpTo ?? 0);
      if (this.jumpTo === undefined && (ahead > AHEAD || !this.wantsData())) {
        await this.sleep(2000);
        continue;
      }
      if (seg.end !== undefined) {
        // Only ever one track beyond the playing one: short tracks (under
        // AHEAD) would otherwise queue the same next track again and again.
        if (seg !== this.cur) {
          await this.sleep(2000);
          continue;
        }
        // This track is all in. Queue the next one, or finish the stream.
        const n = this.next;
        if (!n) {
          if (this.ms.readyState === "open" && !this.sb!.updating) this.ms.endOfStream();
          await this.sleep(2000);
          continue;
        }
        if (this.ms.readyState === "open") {
          await this.idle();
          this.sb!.abort(); // parser reset between files
        }
        const nseg: Seg = { t: n, start: seg.end, at: 0 };
        await this.idle();
        this.sb!.timestampOffset = seg.end;
        this.segs.push(nseg);
        log(`stream: queued ${n.name} after ${seg.t.name}`);
        continue;
      }
      if (!seg.reader) {
        const resume = seg.byte !== undefined;
        seg.reader = await openReader(seg.t, resume ? { byte: seg.byte! } : { at: seg.at }, signal);
        if (gen !== this.gen) return;
        seg.byte = seg.reader.start;
        if (seg === this.cur) this.ev.source(seg.reader.kind);
        // A resumed reader continues the same byte stream: keep the timeline.
        if (!resume) {
          await this.idle();
          this.sb!.timestampOffset = seg.start + seg.at;
        }
      }
      let chunk: IteratorResult<Uint8Array>;
      try {
        chunk = await seg.reader.chunks.next();
      } catch (e) {
        if (gen !== this.gen || (e as Error).name === "AbortError") return;
        if (e instanceof AuthError) throw e;
        // Dropped connection (a long pause, a network change): reopen where we were.
        log(`stream: ${seg.t.name} read failed (${(e as Error).message}), reconnecting`);
        seg.reader = undefined;
        await this.sleep(2000);
        continue;
      }
      if (gen !== this.gen) return;
      const { done, value } = chunk;
      if (done) {
        await this.idle();
        seg.end = this.bufferedEnd();
        continue;
      }
      await this.append(value, gen);
      seg.byte! += value.length;
      if (this.jumpTo !== undefined && this.bufferedEnd() > this.jumpTo + 0.5) {
        this.audio.currentTime = this.jumpTo;
        this.jumpTo = undefined;
        this.ev.time(this.position());
        this.jumped?.();
        this.jumped = undefined;
      }
      await this.evict();
    }
  }

  private async append(chunk: Uint8Array, gen: number) {
    for (let attempt = 0; ; attempt++) {
      try {
        await this.op((sb) => sb.appendBuffer(chunk as BufferSource));
        return;
      } catch (e) {
        if ((e as Error).name !== "QuotaExceededError" || attempt > 3 || gen !== this.gen) throw e;
        await this.evict(true);
        await this.sleep(1000);
      }
    }
  }

  private async evict(hard = false) {
    const b = this.sb!.buffered;
    if (!b.length) return;
    const upTo = this.audio.currentTime - (hard ? 2 : BEHIND);
    if (upTo - b.start(0) > (hard ? 0 : 30)) await this.op((sb) => sb.remove(0, upTo));
  }

  // Which segment is the playhead in? Crossing into the next one is a track change.
  private tick() {
    const t = this.audio.currentTime;
    const cur = this.cur;
    if (!cur || this.jumpTo !== undefined) return;
    const i = this.segs.indexOf(cur);
    const nxt = this.segs[i + 1];
    if (nxt && cur.end !== undefined && t >= nxt.start) {
      this.cur = nxt;
      this.segs = this.segs.slice(i + 1);
      if (nxt.reader) this.ev.source(nxt.reader.kind);
      this.next = undefined; // the player sets the one after
      log(`advance → ${nxt.t.name} (stream, no gap)`);
      this.ev.boundary(nxt.t.id);
    }
    this.ev.time(this.position());
    if (this.bufferedEnd() - t < AHEAD / 2) this.poke();
  }

  private onEnded() {
    if (this.endedSent) return;
    this.endedSent = true;
    this.ev.ended();
  }
}
