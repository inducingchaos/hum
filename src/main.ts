// pnpm play [terms…]: start the player, resuming, or filter-shuffling when terms are given.
import { hasToken } from "./dropbox/client.ts";
import { BuildError, buildHelper, helperIsStale } from "./engine/build.ts";
import { parseFilter, vocabulary } from "@hum/core/filter";
import { acquireLock, releaseLock } from "./core/lock.ts";
import { Player } from "./core/player.ts";
import { loadState } from "./core/store.ts";
import { deltaSync, fullSync, loadLibrary } from "./library/sync.ts";
import { App } from "./ui/app.ts";
import { parseKeys } from "./ui/keys.ts";
import { enterScreen, leaveScreen } from "./ui/term.ts";
import { log } from "./util.ts";

const fail = (msg: string): never => {
  console.error(msg);
  process.exit(1);
};

if (!process.stdin.isTTY || !process.stdout.isTTY) fail("pnpm play needs an interactive terminal");
if (!hasToken()) fail("not connected to Dropbox. run: pnpm auth start");
if (!acquireLock()) fail("ALREADY RUNNING (another pnpm play has the lock)");
process.on("exit", () => {
  leaveScreen();
  releaseLock();
});

if (helperIsStale()) {
  process.stdout.write("COMPILING AUDIO ENGINE (first run, about 10 s)\n");
  try {
    await buildHelper();
  } catch (e) {
    fail(e instanceof BuildError ? e.message : String(e));
  }
}

let lib = loadLibrary();
if (!lib) {
  try {
    lib = await fullSync((msg) => process.stdout.write(`\r${msg}   `));
    process.stdout.write("\n");
  } catch (e) {
    fail(`could not index the library: ${(e as Error).message}`);
  }
}
const library = lib!;

const args = process.argv.slice(2).join(" ").trim();
if (args) {
  const f = parseFilter(args, vocabulary(library.tracks));
  const bad = f.terms.find((t) => t.kind !== "ok");
  if (bad) fail(bad.kind === "ambiguous" ? `${bad.term}? ${bad.matches.join(" · ")}` : `${bad.term}? no such folder`);
}

const player = new Player(library, loadState());
if (args && !player.applyFilter(args, false)) fail(`${args}: 0 songs`);

let quitting = false;
function quit(code = 0): void {
  if (quitting) return;
  quitting = true;
  player.quit();
  leaveScreen();
  releaseLock();
  process.exit(code);
}

const app = new App(player, () => quit());
enterScreen();
process.stdin.on("data", (buf: Buffer) => {
  for (const k of parseKeys(buf.toString("utf8"))) app.key(k);
});
process.stdout.on("resize", () => app.resized());
for (const sig of ["SIGTERM", "SIGHUP", "SIGINT"] as const) process.on(sig, () => quit());
process.on("unhandledRejection", (e) => log("unhandled rejection", String((e as Error)?.stack ?? e)));
process.on("uncaughtException", (e) => {
  leaveScreen();
  log("crash", e.stack ?? String(e));
  console.error(e);
  quit(1);
});

app.render();
player.start();
setInterval(() => app.schedule(), 1000); // the clock

// Pick up library changes in the background; the UI never waits on this.
deltaSync(library)
  .then((next) => next && player.setLibrary(next))
  .catch((e) => log("delta sync failed", (e as Error).message));
