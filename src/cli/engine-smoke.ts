// Engine smoke test (pnpm test:engine). Plays real audio at volume 0 on this Mac:
// local playback, seek, gapless advance between two files, and HTTPS streaming.
import { existsSync, mkdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { paths, profile } from "../config.ts";
import { tracksDir } from "@hum/core/profile";
import { download, listAll, temporaryLink } from "../dropbox/client.ts";
import { saveResponse } from "../util.ts";
import { buildHelper, helperIsStale } from "../engine/build.ts";
import { Engine, type EngineEvent } from "../engine/helper.ts";

if (helperIsStale()) await buildHelper();

// The three smallest tracks keep the downloads short.
const { entries } = await listAll({ path: tracksDir(profile()) });
const mp3s = entries.filter((e) => e[".tag"] === "file" && e.name.endsWith(".mp3")).sort((a, b) => a.size! - b.size!);
const [a, b, c] = mp3s;
if (!a || !b || !c) throw new Error("need 3 tracks");
mkdirSync(paths.audio, { recursive: true });
async function fetchTo(e: typeof a): Promise<string> {
  const id = e!.name.replace(/\.mp3$/, "").split("-").pop()!;
  const out = join(paths.audio, `${id}.mp3`);
  if (!existsSync(out) || statSync(out).size !== e!.size) await saveResponse(await download(e!.path_lower), out);
  return out;
}
const fileA = await fetchTo(a);
const fileB = await fetchTo(b);

const events: EngineEvent[] = [];
let waiters: Array<[(e: EngineEvent) => boolean, (e: EngineEvent) => void]> = [];
const engine = new Engine((e) => {
  events.push(e);
  waiters = waiters.filter(([test, done]) => (test(e) ? (done(e), false) : true));
});
const waitFor = (test: (e: EngineEvent) => boolean, ms = 15_000) =>
  new Promise<EngineEvent>((res, rej) => {
    waiters.push([test, res]);
    setTimeout(() => rej(new Error("timeout")), ms);
  });

const results: [string, boolean][] = [];
async function step(name: string, fn: () => Promise<unknown>) {
  const t = performance.now();
  try {
    await fn();
    results.push([name, true]);
    console.log(`ok   ${name} (${Math.round(performance.now() - t)} ms)`);
  } catch (e) {
    results.push([name, false]);
    console.log(`FAIL ${name}: ${(e as Error).message}`);
  }
}

// Any 3:2 photo works; picsum serves one without an API key.
const ART = "https://picsum.photos/id/10/600/400.jpg";
const meta = { title: "Smoke Test", artist: "hum", album: "smoke / test" };
engine.start();
await step("helper ready", () => waitFor((e) => e.ev === "ready"));
engine.send({ cmd: "volume", value: 0 });
await step("local file plays", async () => {
  engine.send({ cmd: "load", id: "A", src: fileA, ...meta });
  await waitFor((e) => e.ev === "time" && e.id === "A" && e.pos > 0.5);
});
await step("seek near end + gapless advance", async () => {
  const t = (await waitFor((e) => e.ev === "time" && e.dur > 0)) as Extract<EngineEvent, { ev: "time" }>;
  engine.send({ cmd: "setNext", after: "A", id: "B", src: fileB, ...meta });
  engine.send({ cmd: "seek", sec: t.dur - 2 });
  await waitFor((e) => e.ev === "advanced" && e.from === "A" && e.to === "B");
  await waitFor((e) => e.ev === "time" && e.id === "B" && e.pos > 0.2);
});
await step("cover art decodes (square crop)", async () => {
  const jpg = join(paths.art, "smoke.jpg");
  mkdirSync(paths.art, { recursive: true });
  // A 3:2 photo, so the center crop has work to do.
  if (!existsSync(jpg)) await saveResponse(await fetch(ART), jpg);
  engine.send({ cmd: "art", id: "B", path: jpg });
  const e = (await waitFor((e) => e.ev === "art" && e.id === "B")) as Extract<EngineEvent, { ev: "art" }>;
  if (!e.ok) throw new Error("image didn't decode");
});
await step("pause emits paused", async () => {
  engine.send({ cmd: "pause" });
  await waitFor((e) => e.ev === "state" && e.state === "paused");
});
await step("https temp link streams", async () => {
  const url = await temporaryLink(c.path_lower);
  engine.send({ cmd: "load", id: "C", src: url, ...meta });
  await waitFor((e) => e.ev === "time" && e.id === "C" && e.pos > 0.5);
});
await step("end of queue emits ended", async () => {
  const t = (await waitFor((e) => e.ev === "time" && e.id === "C" && e.dur > 0)) as Extract<EngineEvent, { ev: "time" }>;
  engine.send({ cmd: "seek", sec: t.dur - 1 });
  await waitFor((e) => e.ev === "ended" && e.id === "C");
});
if (process.argv.includes("--keys")) {
  // Interactive media-key check (risk R1): audible at low volume.
  engine.send({ cmd: "volume", value: 0.15 });
  engine.send({ cmd: "load", id: "A", src: fileA, ...meta, title: "Media key test" });
  console.log("\nPlaying quietly. Press F8 (play/pause), then F9 (next), then F7 (prev). Waiting 30 s...");
  const seen = new Set<string>();
  const until = Date.now() + 30_000;
  while (Date.now() < until && seen.size < 3) {
    const e = await waitFor((e) => e.ev === "remote", until - Date.now()).catch(() => null);
    if (!e || e.ev !== "remote") break;
    console.log(`  got media key: ${e.cmd}`);
    if (e.cmd === "toggle" || e.cmd === "play" || e.cmd === "pause") engine.send({ cmd: "toggle" });
    seen.add(e.cmd === "next" || e.cmd === "prev" ? e.cmd : "playpause");
  }
  results.push(["media keys (F7/F8/F9)", seen.size === 3]);
  console.log(seen.size === 3 ? "ok   media keys" : `FAIL media keys: only saw ${[...seen].join(", ") || "nothing"}`);
}
engine.quit();
const failed = results.filter(([, ok]) => !ok).length;
console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
