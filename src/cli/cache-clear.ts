// pnpm cache:clear: delete all cached audio (the player must not be running).
import { paths, settings } from "../config.ts";
import { AudioCache } from "../cache/lru.ts";
import { fmtBytes } from "../util.ts";
import { isLocked } from "../core/lock.ts";

if (isLocked()) {
  console.error("the player is running; press C inside it instead");
  process.exit(1);
}
const cache = new AudioCache(paths.audio, settings.cacheCapBytes);
const n = cache.count;
console.log(`cleared ${n} tracks, ${fmtBytes(cache.clear(new Set()))}`);
