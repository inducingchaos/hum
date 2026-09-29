// Controller smoke test (pnpm test:player): gapless advance through the queue,
// engine crash → respawn → resume, cover art, dedupe, favourites, offline
// fallback, and state persistence. Always muted, with its own state + favourites.
process.env.HUM_MUTE = "1";
process.env.HUM_STATE ??= new URL("../../.cache/smoke-state.json", import.meta.url).pathname;

const { Player } = await import("../core/player.ts");
const { loadLibrary } = await import("../library/sync.ts");
const { loadState } = await import("../core/store.ts");
const { buildHelper, helperIsStale, HELPER_BIN } = await import("../engine/build.ts");
const { ArtCache } = await import("../cache/art.ts");
const { paths } = await import("../config.ts");
const { applyFilter } = await import("@hum/core/filter");
const { dedupe, folderOf, groupKey } = await import("@hum/core/model");
const { profile } = await import("../config.ts");

if (helperIsStale()) await buildHelper();
const lib = loadLibrary();
if (!lib) {
  console.log("no library yet: run `pnpm play` once (it indexes the library), then run this again");
  process.exit(1);
}
// A small leaf folder (fewest songs, at least 4) keeps downloads short. Picked
// from the library itself, so no folder names live in this file.
const counts = new Map<string, number>();
for (const t of dedupe(lib.tracks)) counts.set(folderOf(t), (counts.get(folderOf(t)) ?? 0) + 1);
const SMALL = [...counts].filter(([, n]) => n >= 4).sort((a, b) => a[1] - b[1])[0]![0].split("/").join(" ");
const p = new Player(lib, null);
p.applyFilter(SMALL, false);

const until = async (label: string, test: () => boolean, ms = 60_000) => {
  const end = Date.now() + ms;
  while (!test()) {
    if (Date.now() > end) throw new Error(`timeout: ${label}`);
    await Bun.sleep(100);
  }
};
let failed = 0;
async function step(name: string, fn: () => Promise<void>) {
  const t = performance.now();
  try {
    await fn();
    console.log(`ok   ${name} (${Math.round(performance.now() - t)} ms)`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}: ${(e as Error).message}`);
  }
}

p.start();
await step("starts playing", () => until("playing", () => p.status === "playing" && p.pos > 0.3));
await step("cover art fetched for Now Playing", async () => {
  const art = new ArtCache(paths.art);
  await until("art on disk", () => !!art.path(p.current!), 15_000);
});
await step("gapless advance to the next song", async () => {
  const next = p.queue.upcoming(1)[0]!;
  await until("next cached", () => p.cache.has(next));
  await Bun.sleep(300); // let setNext land
  const cursor = p.queue.cursor;
  p.seekTo(p.dur - 2);
  await until("advanced", () => p.queue.cursor === cursor + 1 && p.loadedId === next && p.pos > 0.2, 15_000);
  if (p.status !== "playing") throw new Error(`status ${p.status}`);
  if (p.history.at(-1) !== next) throw new Error("history didn't log the advance");
});
await step("engine crash → respawn → resume near the same position", async () => {
  p.seekTo(120);
  await until("seeked", () => p.pos > 120.5, 10_000);
  const id = p.loadedId;
  Bun.spawnSync(["pkill", "-f", HELPER_BIN]);
  await Bun.sleep(500);
  await until("resumed", () => p.status === "playing" && p.loadedId === id && p.pos > 119 && p.pos < 130, 15_000);
});
await step("dedupe: one version per song; toggling keeps the song playing", async () => {
  const id = p.loadedId;
  const songs = (ids: string[]) => new Set(ids.map((x) => groupKey(p.track(x)!, profile().variant?.dimension))).size;
  if (songs(p.queue.order) !== p.queue.order.length) throw new Error("duplicate versions in the queue");
  p.toggleDedupe();
  const every = applyFilter(p.all, p.filter).length;
  if (p.pool.length !== every || p.queue.current !== id) throw new Error(`off: pool ${p.pool.length} ≠ ${every}`);
  p.toggleDedupe();
  if (songs(p.queue.order) !== p.queue.order.length || p.queue.current !== id || p.loadedId !== id) throw new Error("back on");
});
await step("like → fav filter plays it → unlike", async () => {
  const id = p.loadedId!;
  p.toggleFavorite();
  if (!p.isFav(id) || !p.applyFilter("fav") || p.pool.length !== 1) throw new Error("fav filter");
  await until("playing the favourite", () => p.loadedId === id && p.status === "playing", 10_000);
  p.toggleFavorite(id);
  if (p.isFav(id) || p.favoriteTracks().length) throw new Error("still liked");
  p.applyFilter(SMALL);
  await until("back on the filter", () => p.status === "playing", 15_000);
});
await step("offline: an uncached pick falls back to a cached song", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (() => Promise.reject(new TypeError("network down"))) as unknown as typeof fetch;
  try {
    const uncached = p.songs.find((t) => !p.cache.has(t.id) && folderOf(t) !== SMALL.split(" ").join("/"))!;
    p.playNow(uncached.id);
    await until("fell back", () => p.offline && !!p.loadedId && p.loadedId !== uncached.id && p.cache.has(p.loadedId), 10_000);
  } finally {
    globalThis.fetch = realFetch;
  }
});
await step("pause + state persisted", async () => {
  p.toggle();
  await until("paused", () => p.status === "paused", 5000);
  p.quit();
  const s = loadState();
  if (!s || s.filter !== SMALL || !s.queue || s.queue.order[s.queue.cursor] !== p.loadedId || Math.abs(s.pos - p.pos) > 2)
    throw new Error(`bad state ${JSON.stringify({ f: s?.filter, pos: s?.pos })}`);
});
console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
