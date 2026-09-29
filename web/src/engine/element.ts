// The first engine (W0): one <audio> element, a new `src` per track. On iOS a
// track change while the lock screen is lit waits until the app is visible
// again (turn 13 test), so it's now the fallback for the stream engine.
import type { Track } from "@hum/core/model";
import { cachedIds, isCached } from "../cache.ts";
import { AuthError } from "../dropbox.ts";
import { log } from "../log.ts";
import { urlFor, type UrlSource } from "../source.ts";
import type { Engine, EngineEvents } from "./types.ts";

const LINK_MAX_AGE = 3 * 3600_000; // temp links last 4 h

export class ElementEngine implements Engine {
  readonly name = "element";
  private seq = 0;
  private cur?: UrlSource;
  private nextSrc?: UrlSource;
  private next?: Track;
  private track?: Track;
  private pendingSeek = 0;
  private retried = false;

  constructor(private audio: HTMLAudioElement, private ev: EngineEvents) {
    audio.addEventListener("ended", () => this.onEnded());
    audio.addEventListener("error", () => this.onError());
    for (const e of ["loadedmetadata", "canplay", "playing"]) audio.addEventListener(e, () => this.applySeek());
    audio.addEventListener("timeupdate", () => {
      this.applySeek();
      if (!this.pendingSeek) ev.time(audio.currentTime);
    });
    // Swap a prepared stream for the local copy once it's downloaded.
    cachedIds.subscribe(() => {
      if (this.nextSrc?.kind === "stream" && isCached(this.nextSrc.id)) void this.prepare();
    });
  }

  get paused() {
    return this.audio.paused;
  }

  position() {
    return this.pendingSeek || this.audio.currentTime;
  }

  play() {
    this.audio.play().catch((e) => log(`play() refused: ${e.name}`));
  }

  pause() {
    this.audio.pause();
  }

  seek(sec: number) {
    if (this.audio.readyState < 1) {
      this.pendingSeek = sec;
      return;
    }
    this.audio.currentTime = Math.max(0, Math.min(sec, this.audio.duration - 1));
    this.ev.time(this.audio.currentTime);
  }

  // iOS only loads media once play() is called, and can ignore a currentTime set
  // too early. Keep trying until the element is actually there (turn 13 bug:
  // resume showed 0:05 but played from 0:00).
  private applySeek() {
    if (!this.pendingSeek || this.audio.readyState < 1) return;
    if (Math.abs(this.audio.currentTime - this.pendingSeek) < 1) {
      this.pendingSeek = 0;
      return;
    }
    try {
      this.audio.currentTime = Math.min(this.pendingSeek, this.audio.duration - 1);
    } catch {}
  }

  async load(t: Track, at: number, autoplay: boolean) {
    const seq = ++this.seq;
    this.track = t;
    this.retried = false;
    let s: UrlSource;
    try {
      const n = this.nextSrc;
      s = n?.id === t.id && Date.now() - n.at < LINK_MAX_AGE ? n : await urlFor(t);
    } catch (e) {
      this.ev.failed(e instanceof AuthError ? "DROPBOX SIGN-IN EXPIRED" : `CAN'T LOAD: ${(e as Error).message}`);
      return;
    }
    if (seq !== this.seq) return this.release(s);
    if (this.nextSrc === s) this.nextSrc = undefined;
    this.pendingSeek = at;
    this.setSrc(s);
    log(`load ${t.name} from ${s.kind}${autoplay ? "" : " (paused)"}`);
    if (autoplay) this.play();
    void this.prepare();
  }

  setNext(t: Track | undefined) {
    this.next = t;
    void this.prepare();
  }

  private async prepare() {
    const t = this.next;
    if (!t || t.id === this.track?.id) {
      this.release(this.nextSrc);
      this.nextSrc = undefined;
      return;
    }
    if (this.nextSrc?.id === t.id && (this.nextSrc.kind === "cache" || !isCached(t.id))) return;
    try {
      const s = await urlFor(t);
      if (this.next?.id !== t.id) return this.release(s);
      const old = this.nextSrc;
      this.nextSrc = s;
      this.release(old);
    } catch (e) {
      log(`prepare next failed: ${(e as Error).message}`);
    }
  }

  private release(s: UrlSource | undefined) {
    if (s?.kind === "cache" && s.url !== this.cur?.url && s.url !== this.nextSrc?.url) URL.revokeObjectURL(s.url);
  }

  private setSrc(s: UrlSource) {
    const old = this.cur;
    this.cur = s;
    this.ev.source(s.kind);
    this.audio.src = s.url;
    this.release(old);
  }

  private onEnded() {
    const t = this.next;
    if (!t) return this.ev.ended();
    if (t.id === this.track?.id) {
      this.audio.currentTime = 0;
      this.play();
      return this.ev.boundary(t.id);
    }
    const n = this.nextSrc;
    this.track = t;
    this.next = undefined;
    this.retried = false;
    if (n?.id === t.id && Date.now() - n.at < LINK_MAX_AGE) {
      // No await between `ended` and play(): iOS needs that in the background.
      this.nextSrc = undefined;
      this.pendingSeek = 0;
      this.setSrc(n);
      this.audio.play().then(
        () => log(`advance → ${t.name} (${n.kind}, fast path)`),
        (e) => log(`advance → ${t.name} play() refused: ${e.name}`),
      );
    } else {
      log("advance: next not prepared, slow path");
      void this.load(t, 0, true);
    }
    this.ev.boundary(t.id);
  }

  private onError() {
    const err = this.audio.error;
    log(`audio error ${err?.code}: ${err?.message ?? ""} (${this.cur?.kind})`);
    const t = this.track;
    if (!t) return;
    if (this.cur?.kind === "stream" && !this.retried) {
      this.retried = true;
      const at = this.audio.currentTime;
      void urlFor(t, true).then(
        (s) => {
          this.pendingSeek = at;
          this.setSrc(s);
          this.play();
        },
        (e) => this.ev.failed(`CAN'T PLAY: ${(e as Error).message}`),
      );
      return;
    }
    this.ev.failed(`CAN'T PLAY ${t.name.toUpperCase()}`);
  }
}
