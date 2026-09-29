// The controller: owns the queue and wires it to the audio engine, the cache,
// and the prefetcher. The UI reads its fields and calls its actions.
import { paths, profile, settings } from "../config.ts";
import { ArtCache } from "../cache/art.ts";
import { AudioCache } from "../cache/lru.ts";
import { Prefetcher, type CacheMark } from "../cache/prefetch.ts";
import { AuthError, NetworkError, temporaryLink } from "../dropbox/client.ts";
import { Engine, type EngineEvent, type TrackRef } from "../engine/helper.ts";
import { albumOf, dedupe, dedupeVariants, groupKey, pathOrder, type Library, type Track } from "@hum/core/model";
import { fmtBytes, log } from "../util.ts";
import { Favorites } from "./favorites.ts";
import { applyFilter, describe, FAV, parseFilter, usesFav, vocabulary, type ParsedFilter } from "@hum/core/filter";
import { Queue } from "@hum/core/queue";
import { saveState, type Persisted } from "./store.ts";

// Tests run with HUM_MUTE=1 so they never make sound on the owner's Mac.
const MUTE = process.env.HUM_MUTE === "1";
const HISTORY = 200; // recently played ids kept in state.json

export type Status = "playing" | "paused" | "buffering" | "stopped" | "ended";

export class Player {
  lib!: Library;
  byId = new Map<string, Track>();
  all: Track[] = []; // every file, path order
  songs: Track[] = []; // one length per song and version, path order (search, tree counts)
  vocab: string[] = [];
  pool: string[] = []; // song ids matching the filter, in path order
  filter: ParsedFilter = { terms: [], ok: true };
  queue: Queue;
  readonly favs = new Favorites();
  dedupe = true; // one version per song: longest length, one variant (turn 7)
  history: string[] = []; // ids in the order they started playing, oldest first

  status: Status = "stopped";
  pos = 0;
  dur = 0;
  volume = 100;
  loadedId?: string; // what the engine has as its current item
  offline = false;
  authExpired = false;
  diskLow = false;
  engineDead = false;

  readonly cache = new AudioCache(paths.audio, settings.cacheCapBytes);
  private readonly art = new ArtCache(paths.art);
  readonly prefetch: Prefetcher;
  private engine: Engine;
  private loadToken = 0;
  private sentNext?: string; // "<current>→<next>" last sent with setNext
  private errorsInARow = 0;
  // After a seek, time events from before it landed are stale; ignore them briefly.
  private seekGuard?: { pos: number; until: number };
  private lastSave = 0;

  // UI hooks
  onChange: () => void = () => {};
  onNotice: (msg: string) => void = () => {};

  constructor(lib: Library, saved: Persisted | null) {
    this.dedupe = saved?.dedupe ?? true;
    this.history = saved?.history ?? [];
    this.setLibrary(lib);
    this.volume = saved?.volume ?? 100;
    this.queue = new Queue(saved?.queue ?? { order: [], cursor: 0, shuffle: true, repeat: "all" });
    this.setFilterQuery(saved?.filter ?? settings.defaultFilter);
    if (saved) this.queue.retain(new Set(this.byId.keys()));
    if (!this.queue.order.length) this.queue.setPool(this.pool);
    else if (saved?.dedupe === undefined) this.rebase(); // queue saved before version dedupe existed
    this.pos = saved?.pos ?? 0;
    this.prefetch = new Prefetcher(this.cache, settings.minFreeBytes, {
      cached: (id) => {
        this.offline = false;
        this.authExpired = false;
        if (id === this.queue.autoNext()) this.syncNext();
        this.onChange();
      },
      offline: (o) => {
        this.offline = o;
        this.onChange();
      },
      authExpired: () => {
        this.authExpired = true;
        this.onChange();
      },
      diskLow: (low) => {
        this.diskLow = low;
        this.onChange();
      },
      failed: (id) => this.onNotice(`DOWNLOAD FAILED · ${this.byId.get(id)?.name ?? id}`),
    });
    this.engine = new Engine((e) => this.onEngine(e));
  }

  // ---- library ----

  setLibrary(lib: Library): void {
    this.lib = lib;
    this.byId = new Map(lib.tracks.map((t) => [t.id, t]));
    this.all = [...lib.tracks].sort(pathOrder);
    this.songs = dedupe(lib.tracks).sort(pathOrder);
    this.vocab = vocabulary(lib.tracks);
    if (this.queue) {
      this.setFilterQuery(this.filterText);
      this.queue.retain(new Set(this.byId.keys()));
      this.updateWindow();
      this.onChange();
    }
  }

  private setFilterQuery(q: string): void {
    const f = parseFilter(q, this.vocab);
    this.filter = f.ok ? f : { terms: [], ok: true };
    this.pool = this.poolFor(this.filter).map((t) => t.id);
  }

  // What a filter plays: with dedupe on, one length and one version per song. The
  // version is the liked one for favourites, else the profile's preferred one.
  private poolFor(f: ParsedFilter): Track[] {
    const hits = applyFilter(this.dedupe ? this.songs : this.all, f, (t) => this.favs.has(t));
    return this.dedupe ? dedupeVariants(hits, profile().variant, (t) => this.favs.isLikedVersion(t)) : hits;
  }

  get filterText(): string {
    return describe(this.filter);
  }

  get current(): Track | undefined {
    const id = this.queue.current;
    return id ? this.byId.get(id) : undefined;
  }

  track(id: string): Track | undefined {
    return this.byId.get(id);
  }

  mark(id: string): CacheMark {
    return this.prefetch.mark(id);
  }

  // ---- lifecycle ----

  start(): void {
    this.engine.start();
  }

  quit(): void {
    this.persist(true);
    this.engine.quit();
  }

  persist(force = false): void {
    const now = Date.now();
    if (!force && now - this.lastSave < 5000) return;
    this.lastSave = now;
    saveState({
      version: 1,
      filter: this.filterText,
      queue: this.queue.snapshot(),
      volume: this.volume,
      pos: this.pos,
      dedupe: this.dedupe,
      history: this.history,
    });
  }

  // ---- engine plumbing ----

  private ref(t: Track, src: string): TrackRef {
    return { id: t.id, src, title: t.name, artist: profile().label, album: albumOf(t), art: this.art.path(t) };
  }

  private updateWindow(): void {
    const ids = [this.queue.current, ...this.queue.upcoming(settings.prefetchDepth)].filter((x): x is string => !!x);
    const window = ids.map((id) => this.byId.get(id)).filter((t): t is Track => !!t);
    this.prefetch.setWindow(window);
    for (const t of window) void this.art.ensure(t);
  }

  // A track started: log it, and hand the engine its cover if it wasn't ready at load time.
  private started(t: Track, hadArt: boolean): void {
    if (this.history.at(-1) !== t.id) this.history = [...this.history, t.id].slice(-HISTORY);
    if (hadArt) return;
    void this.art.ensure(t).then((path) => {
      if (path && this.loadedId === t.id) this.engine.send({ cmd: "art", id: t.id, path });
    });
  }

  // Tell the engine what follows the current track, if it's on disk (gapless handoff).
  private syncNext(): void {
    const cur = this.queue.current;
    if (!cur || cur !== this.loadedId) return;
    const nextId = this.queue.autoNext();
    const next = nextId && this.cache.has(nextId) ? this.byId.get(nextId) : undefined;
    const key = `${cur}→${next?.id ?? ""}`;
    if (key === this.sentNext) return;
    this.sentNext = key;
    if (next) this.engine.send({ cmd: "setNext", after: cur, ...this.ref(next, this.cache.path(next.id)) });
    else this.engine.send({ cmd: "setNext", after: cur });
  }

  private async playCurrent(pos = 0, paused = false): Promise<void> {
    const t = this.current;
    const token = ++this.loadToken;
    if (!t) {
      this.engine.send({ cmd: "stop" });
      this.loadedId = undefined;
      this.status = "stopped";
      this.onChange();
      return;
    }
    this.loadedId = t.id;
    this.sentNext = undefined;
    this.seekGuard = undefined;
    this.pos = pos;
    this.dur = t.duration;
    this.status = paused ? "paused" : "buffering";
    this.updateWindow();
    this.onChange();
    let src: string;
    if (this.cache.has(t.id)) {
      this.cache.touch(t.id);
      src = this.cache.path(t.id);
    } else {
      try {
        src = await temporaryLink(t.path);
        this.authExpired = false; // a new token works (pnpm auth finish while running)
        if (this.offline) {
          this.offline = false; // the network is back
          this.prefetch.kick();
        }
      } catch (e) {
        if (token !== this.loadToken) return;
        return this.cannotStream(e as Error);
      }
      if (token !== this.loadToken) return; // superseded by a newer skip
    }
    const ref = this.ref(t, src);
    this.engine.send({ cmd: "load", ...ref, pos, paused });
    this.engine.send({ cmd: "volume", value: MUTE ? 0 : this.volume / 100 });
    this.started(t, !!ref.art);
    this.syncNext();
    this.persist(true);
  }

  // Offline (or auth expired) and the track isn't cached: play the next cached song instead.
  private cannotStream(e: Error): void {
    log("stream failed", e.message);
    if (e instanceof AuthError) this.authExpired = true;
    else if (e instanceof NetworkError) this.offline = true;
    const order = this.queue.order;
    for (let k = 1; k < order.length; k++) {
      const i = (this.queue.cursor + k) % order.length;
      if (this.cache.has(order[i]!)) {
        this.queue.jumpTo(i);
        void this.playCurrent();
        return;
      }
    }
    this.status = "stopped";
    this.loadedId = undefined;
    this.onNotice(this.authExpired ? "DROPBOX AUTH EXPIRED · run pnpm auth start" : "OFFLINE · NOTHING CACHED");
    this.onChange();
  }

  private onEngine(e: EngineEvent): void {
    switch (e.ev) {
      case "ready":
        this.engineDead = false;
        this.engine.send({ cmd: "volume", value: MUTE ? 0 : this.volume / 100 });
        // First start resumes (auto-plays, per the plan); a respawn after a crash picks up where it was.
        if (this.status !== "ended") void this.playCurrent(this.pos, this.status === "paused");
        break;
      case "state":
        if (e.id && e.id === this.loadedId && this.status !== "ended") this.status = e.state;
        break;
      case "time":
        if (e.id !== this.loadedId) return;
        if (this.seekGuard) {
          if (Date.now() < this.seekGuard.until && Math.abs(e.pos - this.seekGuard.pos) > 2) return;
          this.seekGuard = undefined;
        }
        this.pos = e.pos;
        if (e.dur > 0) this.dur = e.dur;
        this.errorsInARow = 0;
        this.persist();
        break;
      case "advanced": {
        const next = this.queue.advance(true);
        if (next !== e.to) {
          const i = this.queue.order.indexOf(e.to);
          if (i >= 0) this.queue.jumpTo(i);
        }
        this.loadedId = e.to;
        this.pos = 0;
        this.dur = this.byId.get(e.to)?.duration ?? 0;
        this.cache.touch(e.to);
        const t = this.byId.get(e.to);
        if (t) this.started(t, false);
        this.updateWindow();
        this.syncNext();
        this.persist(true);
        break;
      }
      case "ended":
        if (e.id !== this.loadedId) return;
        if (this.queue.advance(true)) void this.playCurrent();
        else {
          this.status = "ended";
          this.loadedId = undefined;
          this.persist(true);
        }
        break;
      case "remote":
        if (e.cmd === "toggle") this.toggle();
        else if (e.cmd === "play") this.isActive() || this.toggle();
        else if (e.cmd === "pause") this.isActive() && this.toggle();
        else if (e.cmd === "next") this.next();
        else if (e.cmd === "prev") this.prev();
        else if (e.cmd === "seek" && e.pos !== undefined) this.seekTo(e.pos);
        break;
      case "error":
        if (e.id && e.id !== this.loadedId) return;
        this.onNotice(`COULD NOT PLAY · ${this.current?.name ?? "?"}`);
        if (++this.errorsInARow < 3 && this.queue.advance(false)) void this.playCurrent();
        else this.status = "stopped";
        break;
      case "art":
        return;
      case "crashed":
        if (e.gaveUp) {
          this.engineDead = true;
          this.status = "stopped";
          this.onNotice("AUDIO ENGINE KEEPS CRASHING · restart pnpm play");
        }
        break;
    }
    this.onChange();
  }

  // ---- actions ----

  isActive(): boolean {
    return this.status === "playing" || this.status === "buffering";
  }

  toggle(): void {
    if (this.status === "ended" || this.status === "stopped" || !this.loadedId) {
      if (this.status === "ended") this.queue.jumpTo(0);
      void this.playCurrent(this.status === "ended" ? 0 : this.pos);
      return;
    }
    const playing = this.isActive();
    this.engine.send({ cmd: playing ? "pause" : "play" });
    this.status = playing ? "paused" : "playing"; // optimistic; the engine confirms
    this.persist(true);
    this.onChange();
  }

  next(): void {
    if (this.queue.advance(false)) void this.playCurrent();
    else this.onNotice("END OF QUEUE");
  }

  prev(): void {
    if (this.pos > 5 || this.queue.cursor === 0) this.seekTo(0);
    else {
      this.queue.back();
      void this.playCurrent();
    }
  }

  seekTo(sec: number): void {
    if (!this.loadedId) return;
    this.pos = Math.max(0, Math.min(sec, this.dur || sec));
    this.seekGuard = { pos: this.pos, until: Date.now() + 3000 };
    this.engine.send({ cmd: "seek", sec: this.pos });
    this.onChange();
  }

  seekBy(delta: number): void {
    this.seekTo(this.pos + delta);
  }

  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(100, Math.round(v)));
    this.engine.send({ cmd: "volume", value: MUTE ? 0 : this.volume / 100 });
    this.persist(true);
    this.onChange();
  }

  // Returns the parsed filter so the prompt can show errors; applies only when valid and non-empty.
  previewFilter(q: string): { parsed: ParsedFilter; count: number } {
    const parsed = parseFilter(q, this.vocab);
    return { parsed, count: parsed.ok ? this.poolFor(parsed).length : 0 };
  }

  // `play: false` is for CLI args before the engine is up: it starts on "ready".
  applyFilter(q: string, play = true): boolean {
    const { parsed, count } = this.previewFilter(q);
    if (!parsed.ok || !count) return false;
    this.filter = parsed;
    this.pool = this.poolFor(parsed).map((t) => t.id);
    this.queue.setPool(this.pool);
    this.pos = 0;
    if (play) void this.playCurrent();
    return true;
  }

  toggleShuffle(): void {
    this.queue.setShuffle(!this.queue.shuffle, this.pool);
    this.afterQueueEdit();
  }

  cycleRepeat(): void {
    this.queue.cycleRepeat();
    this.afterQueueEdit();
  }

  // One version per song ↔ every length and version. The current song keeps playing.
  toggleDedupe(): void {
    this.dedupe = !this.dedupe;
    this.pool = this.poolFor(this.filter).map((t) => t.id);
    this.rebase();
    this.onNotice(this.dedupe ? "ONE VERSION PER SONG" : "EVERY LENGTH AND VERSION");
    this.afterQueueEdit();
  }

  // Rebuild the queue from the pool without interrupting the current song.
  private rebase(): void {
    const cur = this.queue.current;
    let ids = this.pool;
    if (cur && this.byId.has(cur) && !ids.includes(cur))
      ids = [...ids, cur].map((id) => this.byId.get(id)!).sort(pathOrder).map((t) => t.id);
    this.queue.setShuffle(this.queue.shuffle, ids);
  }

  isFav(id: string): boolean {
    const t = this.byId.get(id);
    return !!t && this.favs.has(t);
  }

  // Likes or unlikes a song (the current one by default). The queue isn't touched,
  // even when filtering by fav; the song count updates.
  toggleFavorite(id = this.loadedId ?? this.queue.current): void {
    const t = id ? this.byId.get(id) : undefined;
    if (!t) return;
    const on = this.favs.toggle(t);
    if (usesFav(this.filter)) this.pool = this.poolFor(this.filter).map((x) => x.id);
    this.onNotice(`${on ? "♥ LIKED" : "UNLIKED"} · ${t.name}`);
    this.onChange();
  }

  // Favourites as tracks, newest first: the liked version, or any version if that file is gone.
  favoriteTracks(): Track[] {
    return this.favs.list
      .map((f) => this.byId.get(f.id) ?? this.songs.find((t) => groupKey(t, profile().variant?.dimension) === f.key))
      .filter((t): t is Track => !!t);
  }

  playFavorites(): boolean {
    if (!this.favs.size) {
      this.onNotice("NO FAVOURITES YET · press l on a song");
      return false;
    }
    return this.applyFilter(FAV);
  }

  private afterQueueEdit(): void {
    this.updateWindow();
    this.syncNext();
    this.persist(true);
    this.onChange();
  }

  playNow(id: string): void {
    this.queue.playNow(id);
    void this.playCurrent();
  }

  jumpTo(index: number): void {
    if (index === this.queue.cursor) return;
    this.queue.jumpTo(index);
    void this.playCurrent();
  }

  clearCache(): void {
    const freed = this.cache.clear(this.prefetch.pinned());
    this.onNotice(`CACHE CLEARED · ${fmtBytes(freed)}`);
    this.onChange();
  }
}
