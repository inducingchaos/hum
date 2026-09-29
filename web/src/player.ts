// The player (plan-web §7). Owns the queue, filter, history and the lock screen;
// an engine (engine/) does the audio. Queue, filter and dedupe rules are the
// CLI's, from @hum/core.
import { artUrl } from "@hum/core/art";
import { applyFilter, describe, parseFilter, vocabulary } from "@hum/core/filter";
import { albumOf, dedupe, dedupeVariants, pathOrder, type Library, type Track } from "@hum/core/model";
import { valueOrder } from "@hum/core/profile";
import { Queue, type QueueSnapshot } from "@hum/core/queue";
import { signal } from "@preact/signals";
import { prefetch } from "./cache.ts";
import { kv } from "./db.ts";
import { ElementEngine } from "./engine/element.ts";
import { StreamEngine, streamSupport } from "./engine/stream.ts";
import type { Engine } from "./engine/types.ts";
import { log } from "./log.ts";
import { profile } from "./profile.ts";

const HISTORY = 200;

interface Saved {
  queue: QueueSnapshot;
  position: number;
  filter: string;
  dedupe: boolean;
  history: string[];
}

export type EngineChoice = "auto" | "stream" | "element";

// ── State the UI reads ───────────────────────────────────────────────────────
export const current = signal<Track | undefined>(undefined);
export const playing = signal(false);
export const position = signal(0);
export const duration = signal(0);
export const buffering = signal(false);
export const sourceKind = signal<"cache" | "stream" | undefined>(undefined);
export const filterText = signal("");
export const poolSize = signal(0);
export const dedupeOn = signal(true);
export const queueVersion = signal(0); // bumped whenever the queue changes
export const notice = signal("");
export const engineName = signal("");
export const engineChoice = signal<EngineChoice>("auto");

let byId = new Map<string, Track>();
let all: Track[] = [];
let songs: Track[] = [];
let vocab: string[] = [];
let history: string[] = [];
let lastSave = 0;
export let queue = new Queue({ order: [], cursor: 0, shuffle: true, repeat: "all" });

const audio = document.createElement("audio");
audio.preload = "auto";
audio.setAttribute("playsinline", "");
document.body.appendChild(audio);

let engine: Engine;

export const track = (id: string | undefined) => (id ? byId.get(id) : undefined);
export const historyIds = () => history;

function bump(): void {
  queueVersion.value++;
}

function say(msg: string): void {
  notice.value = msg;
  log(msg);
}

// ── Engine ───────────────────────────────────────────────────────────────────

function makeEngine(choice: EngineChoice): Engine {
  const sup = streamSupport();
  log(`stream support: ${sup.api}, audio/mpeg ${sup.ok ? "yes" : "no"} · engine setting: ${choice}`);
  const events = {
    boundary: onBoundary,
    ended: () => {
      playing.value = false;
      say("END OF QUEUE");
    },
    time: (pos: number) => {
      if (soft) return; // muted "pause": the clock stays where it was paused
      position.value = pos;
      save(false);
    },
    failed: (msg: string) => {
      say(msg);
      if (/CAN'T PLAY|CAN'T STREAM/.test(msg)) setTimeout(next, 1500);
    },
    source: (k: "cache" | "stream") => (sourceKind.value = k),
  };
  const useStream = choice === "stream" || (choice === "auto" && sup.ok);
  return useStream ? new StreamEngine(audio, events) : new ElementEngine(audio, events);
}

export async function setEngineChoice(c: EngineChoice): Promise<void> {
  save(true);
  await kv.set("engine", c);
  location.reload();
}

// The engine moved into the next track by itself (the one we gave setNext).
function onBoundary(id: string): void {
  if (soft) return; // resuming reloads the paused track anyway
  const got = queue.advance(true);
  if (got !== id) {
    log(`queue out of step (engine ${id}, queue ${got}), following the engine`);
    queue.playNow(id);
  }
  bump();
  const t = byId.get(id)!;
  current.value = t;
  position.value = 0;
  duration.value = t.duration;
  recordStart(t);
  updateMediaSession(t);
  afterQueueChange();
}

// ── Library + filter ─────────────────────────────────────────────────────────

function pool(): string[] {
  const hits = applyFilter(dedupeOn.value ? songs : all, parseFilter(filterText.value, vocab));
  const list = dedupeOn.value ? dedupeVariants(hits, profile().variant) : hits;
  return list.map((t) => t.id);
}

function setTracks(lib: Library): void {
  all = lib.tracks.slice().sort(pathOrder);
  byId = new Map(all.map((t) => [t.id, t]));
  songs = dedupe(all).sort(pathOrder);
  vocab = vocabulary(all);
  DIMENSIONS = profile().dimensions;
  const sets = DIMENSIONS.map(() => new Set<string>());
  for (const t of all) t.dims.forEach((v, i) => sets[i]?.add(v));
  // The profile's order first, else alphabetical.
  facets = sets.map((set) => [...set].sort(valueOrder(profile())));
}

export async function start(lib: Library): Promise<void> {
  engineChoice.value = (await kv.get<EngineChoice>("engine")) ?? "auto";
  engine = makeEngine(engineChoice.value);
  engineName.value = engine.name;
  setupMediaSession();
  setTracks(lib);
  const saved = await kv.get<Saved>("state");
  filterText.value = saved?.filter ?? profile().defaultFilter ?? "";
  dedupeOn.value = saved?.dedupe ?? true;
  history = (saved?.history ?? []).filter((id) => byId.has(id));
  queue = new Queue(saved?.queue ?? { order: [], cursor: 0, shuffle: true, repeat: "all" });
  queue.retain(new Set(byId.keys()));
  const p = pool();
  poolSize.value = p.length;
  if (!queue.order.length) queue.setPool(p);
  bump();
  if (queue.current) load(queue.current, saved?.position ?? 0, false);
}

// New library (metadata arrived, or a delta) while running. Track ids never change.
export function updateLibrary(lib: Library, reshuffle = false): void {
  setTracks(lib);
  queue.retain(new Set(byId.keys()));
  const p = pool();
  poolSize.value = p.length;
  // The first queue was built before metadata (names/durations) was known:
  // rebuild it so dedupe keeps the right versions. The current track keeps playing.
  if (reshuffle) queue.setPool(p, queue.current);
  const t = track(queue.current);
  if (t) {
    current.value = t;
    duration.value = t.duration;
    updateMediaSession(t);
  }
  bump();
  afterQueueChange();
}

// Folder names per dimension (the profile's folder levels), for the filter sheet.
export let DIMENSIONS: string[] = [];
let facets: string[][] = [];
export const facetValues = () => facets;

// For a draft query: which values in each dimension still have songs, given
// the draft's terms in the OTHER dimensions (so picking one first-level value greys
// out second-level values that only exist under other first-level values).
export function available(draft: string): Set<string>[] {
  const f = parseFilter(draft, vocab);
  const ok = f.terms.filter((t) => t.kind === "ok");
  return DIMENSIONS.map((_, i) => {
    const others = { terms: ok.filter((t) => !t.matches.every((m) => facets[i]!.includes(m))), ok: true };
    const hits = applyFilter(dedupeOn.value ? songs : all, others);
    return new Set(hits.map((t) => t.dims[i]!));
  });
}

export function setFilter(text: string): string | undefined {
  const f = parseFilter(text, vocab);
  const bad = f.terms.find((t) => t.kind !== "ok");
  if (bad) return bad.kind === "ambiguous" ? `"${bad.term}": ${bad.matches.join(" / ")}?` : `no folder matches "${bad.term}"`;
  const prev = filterText.value;
  filterText.value = describe(f);
  const p = pool();
  if (!p.length) {
    filterText.value = prev;
    return "no songs match";
  }
  poolSize.value = p.length;
  queue.setPool(p);
  bump();
  load(queue.current!, 0, true);
  return undefined;
}

// ── Transport ────────────────────────────────────────────────────────────────

// ── Pause on the lock screen (turn 14) ──
// iOS stops a web app's audio session soon after it pauses in the background;
// play from the lock screen then does nothing, and after a minute the widget
// hands over to the last music app. So in the background (stream engine only)
// "pause" mutes and keeps playing, and "play" jumps back to the paused point.
// After SOFT_MAX it becomes a real pause to save battery.
const SOFT_MAX = 10 * 60_000;
let soft: { id: string; at: number; timer: ReturnType<typeof setTimeout> } | undefined;
export const paused = () => !!soft || engine.paused;

function softPause(): void {
  const id = queue.current;
  if (!id) return engine.pause();
  soft = { id, at: engine.position(), timer: setTimeout(hardenPause, SOFT_MAX) };
  audio.muted = true;
  playing.value = false;
  setPlaybackState("paused");
  save(true);
  log(`pause (muted, keeps the audio session) at ${Math.round(soft.at)} s`);
}

function resumeSoft(autoplay: boolean): void {
  const sp = soft!;
  soft = undefined;
  clearTimeout(sp.timer);
  const t = byId.get(sp.id);
  if (!autoplay) engine.pause();
  if (!t) {
    audio.muted = false;
    return;
  }
  current.value = t;
  position.value = sp.at;
  duration.value = t.duration;
  // Unmute only once the paused point is back at the playhead.
  void engine.load(t, sp.at, autoplay).then(() => {
    if (!soft) audio.muted = false;
    updateMediaSession(t);
  });
  afterQueueChange();
}

function hardenPause(): void {
  if (!soft) return;
  log("pause: 10 min muted, now a real pause");
  resumeSoft(false);
}

export function play(): void {
  if (soft) return resumeSoft(true);
  audio.muted = false;
  engine.play();
}

export function pause(): void {
  if (soft) return;
  if (document.visibilityState === "hidden" && engine.name === "stream" && !engine.paused) return softPause();
  engine.pause();
}

export const toggle = () => (paused() ? play() : pause());

export function next(): void {
  const id = queue.advance(false);
  bump();
  if (id) load(id, 0, true);
  else say("END OF QUEUE");
}

export function prev(): void {
  if ((soft ? soft.at : engine.position()) > 3) return seek(0);
  const id = queue.back();
  bump();
  if (id) load(id, 0, true);
}

export function seek(sec: number): void {
  if (soft) {
    soft.at = sec; // applied when play resumes
    position.value = sec;
    return updatePositionState();
  }
  engine.seek(sec);
  position.value = sec;
  updatePositionState();
}

export function playId(id: string): void {
  queue.playNow(id);
  bump();
  load(id, 0, true);
}

export function jumpTo(index: number): void {
  const id = queue.jumpTo(index);
  bump();
  if (id) load(id, 0, true);
}

export function toggleShuffle(): void {
  queue.setShuffle(!queue.shuffle, pool());
  bump();
  afterQueueChange();
}

export function cycleRepeat(): void {
  queue.cycleRepeat();
  bump();
  afterQueueChange();
}

export function toggleDedupe(): void {
  dedupeOn.value = !dedupeOn.value;
  const p = pool();
  poolSize.value = p.length;
  queue.setPool(p, queue.current);
  bump();
  afterQueueChange();
  say(dedupeOn.value ? "ONE VERSION PER SONG" : "EVERY LENGTH AND VERSION");
}

function load(id: string, at: number, autoplay: boolean): void {
  const t = byId.get(id);
  if (!t) return;
  current.value = t;
  position.value = at;
  duration.value = t.duration;
  notice.value = "";
  updateMediaSession(t);
  if (soft) {
    clearTimeout(soft.timer);
    soft = undefined;
    audio.muted = false;
  }
  // Set the lock screen again once the track is really at the playhead: iOS
  // sometimes showed an older track's details for a moment after a skip.
  void engine.load(t, at, autoplay).then(() => current.value?.id === t.id && updateMediaSession(t));
  afterQueueChange();
}

function afterQueueChange(): void {
  engine.setNext(track(queue.autoNext()));
  updateWindow();
  save(true);
}

function recordStart(t: Track): void {
  if (history.at(-1) !== t.id) history = [...history, t.id].slice(-HISTORY);
  bump();
}

function updateWindow(): void {
  const cur = queue.current;
  if (!cur) return;
  const order = [cur, ...queue.upcoming(3)].map((id) => byId.get(id)).filter((t): t is Track => !!t);
  const keep = history.filter((id) => id !== cur).slice(-2);
  prefetch.setWindow(order, keep);
  for (const t of order) preloadArt(t);
}

// Warm the image cache so the lock screen art shows at once on a skip (it took
// ~1 s per track when fetched only on change; going back was instant).
const artSeen = new Set<string>();
function preloadArt(t: Track): void {
  if (!t.image || artSeen.has(t.id)) return;
  artSeen.add(t.id);
  const img = new Image();
  img.src = artUrl(t.image, profile().artQuery, 512);
}

// ── Element state (both engines use the same element) ────────────────────────

audio.addEventListener("playing", () => {
  if (soft) return;
  playing.value = true;
  buffering.value = false;
  if (current.value) recordStart(current.value);
  setPlaybackState("playing");
  // iOS has dropped handlers set before playback started; set them again.
  setupMediaSession(true);
});

audio.addEventListener("pause", () => {
  playing.value = false;
  setPlaybackState("paused");
  save(true);
});

audio.addEventListener("waiting", () => {
  buffering.value = true;
  log("waiting for data");
});

audio.addEventListener("seeked", updatePositionState);

// ── Media Session (lock screen, Control Center, AirPods) ─────────────────────

function setupMediaSession(quiet = false): void {
  if (!quiet) {
    const s = (navigator as any).audioSession;
    if (s) {
      try {
        s.type = "playback"; // plays with the silent switch on, like a music app
      } catch {}
    }
    log(`audioSession: ${s ? s.type : "unsupported"} · mediaSession: ${"mediaSession" in navigator}`);
  }
  if (!("mediaSession" in navigator)) return;
  const ms = navigator.mediaSession;
  const on = (action: MediaSessionAction, fn: MediaSessionActionHandler | null) => {
    try {
      ms.setActionHandler(
        action,
        fn &&
          ((d) => {
            log(`remote: ${action}`);
            fn(d);
          }),
      );
    } catch {
      if (!quiet) log(`mediaSession: ${action} unsupported`);
    }
  };
  on("play", play);
  // While muted-paused iOS may still show a pause button (the element is
  // playing), so a remote "pause" then means "play".
  on("pause", () => (soft ? play() : pause()));
  on("nexttrack", next);
  on("previoustrack", prev);
  on("seekto", (d) => d.seekTime !== undefined && seek(d.seekTime));
  // Safari adds ±10 s skip buttons by default, and shows them INSTEAD of
  // previous/next (turn 13). Clearing them explicitly lets the track buttons show.
  on("seekbackward", null);
  on("seekforward", null);
}

function updateMediaSession(t: Track): void {
  if (!("mediaSession" in navigator)) return;
  navigator.mediaSession.metadata = new MediaMetadata({
    title: t.name,
    artist: albumOf(t),
    album: profile().label,
    artwork: t.image ? [{ src: artUrl(t.image, profile().artQuery, 512), sizes: "512x512", type: "image/jpeg" }] : [],
  });
  updatePositionState();
}

function setPlaybackState(s: MediaSessionPlaybackState): void {
  if ("mediaSession" in navigator) navigator.mediaSession.playbackState = s;
  updatePositionState();
}

// Per track, not the element's timeline (the stream engine's runs across tracks).
function updatePositionState(): void {
  const t = current.value;
  if (!("mediaSession" in navigator) || !t) return;
  const dur = t.duration || (Number.isFinite(audio.duration) ? audio.duration : 0);
  if (dur <= 0) return;
  try {
    navigator.mediaSession.setPositionState({
      duration: dur,
      playbackRate: 1,
      position: Math.max(0, Math.min(soft ? soft.at : engine.position(), dur)),
    });
  } catch {}
}

// ── Persistence ──────────────────────────────────────────────────────────────

export function save(now: boolean): void {
  if (!engine || (!now && Date.now() - lastSave < 5000)) return;
  lastSave = Date.now();
  const s: Saved = {
    queue: queue.snapshot(),
    position: soft ? soft.at : engine.position() || position.value,
    filter: filterText.value,
    dedupe: dedupeOn.value,
    history,
  };
  void kv.set("state", s).catch(() => {});
}

document.addEventListener("visibilitychange", () => {
  log(document.visibilityState === "hidden" ? "page hidden" : "page visible");
  if (document.visibilityState === "visible" && soft) resumeSoft(false);
  save(true);
});
addEventListener("pagehide", () => save(true));
