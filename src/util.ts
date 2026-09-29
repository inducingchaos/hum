import { mkdirSync, renameSync, writeFileSync, readFileSync, appendFileSync, statSync } from "node:fs";
import { dirname } from "node:path";
import { paths } from "./config.ts";

export function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

// tmp + rename so a crash mid-write never leaves a torn file.
export function writeJsonAtomic(path: string, data: unknown, mode = 0o644): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(data), { mode });
  renameSync(tmp, path);
}

export { fmtBytes, fmtTime, plural } from "@hum/core/format";
export { shuffle } from "@hum/core/shuffle";

// Debug log, only with HUM_DEBUG=1. Capped at 1 MB; callers never pass tokens or links.
const DEBUG = process.env.HUM_DEBUG === "1";
export function log(...parts: unknown[]): void {
  if (!DEBUG) return;
  try {
    if ((statSync(paths.log, { throwIfNoEntry: false })?.size ?? 0) > 1e6) writeFileSync(paths.log, "");
    const line = parts.map((p) => (typeof p === "string" ? p : JSON.stringify(p))).join(" ");
    appendFileSync(paths.log, `${new Date().toISOString()} ${redact(line)}\n`);
  } catch {}
}

function redact(s: string): string {
  return s
    .replace(/Bearer [\w.-]+/g, "Bearer ***")
    .replace(/https:\/\/[^\s"]*dropboxusercontent\.com[^\s"]*/g, "<temp-link>");
}

// Streams a response body to disk. (Bun.write(path, Response) hung on Bun 1.3.9.)
export async function saveResponse(res: Response, path: string): Promise<number> {
  const w = Bun.file(path).writer({ highWaterMark: 1 << 20 });
  let n = 0;
  try {
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      w.write(chunk);
      n += chunk.byteLength;
    }
  } finally {
    await w.end();
  }
  return n;
}
