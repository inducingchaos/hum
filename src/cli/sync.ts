// pnpm sync: force a full re-index of the library.
import { dedupe } from "@hum/core/model";
import { fullSync } from "../library/sync.ts";

const t = performance.now();
const lib = await fullSync((msg) => process.stderr.write(`\r${msg}   `));
process.stderr.write("\n");
const hours = Math.round(lib.tracks.reduce((s, x) => s + x.duration, 0) / 3600);
console.log(
  `${lib.tracks.length} tracks, ${dedupe(lib.tracks).length} songs, ${hours} h, ` +
    `${lib.tracks.filter((x) => !x.hasMeta).length} without metadata (${Math.round(performance.now() - t)} ms)`,
);
