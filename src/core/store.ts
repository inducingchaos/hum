// Persisted player state: .cache/state.json, written atomically (answer 4a: resume).
import { existsSync } from "node:fs";
import { paths } from "../config.ts";
import { readJson, writeJsonAtomic } from "../util.ts";
import type { QueueSnapshot } from "@hum/core/queue";

export interface Persisted {
  version: 1;
  filter: string;
  queue: QueueSnapshot;
  volume: number; // 0..100
  pos: number; // seconds into the current track
  dedupe?: boolean; // absent in state saved before turn 7
  history?: string[];
}

export function loadState(): Persisted | null {
  if (!existsSync(paths.state)) return null;
  try {
    const s = readJson<Persisted>(paths.state);
    return s.version === 1 && Array.isArray(s.queue?.order) ? s : null;
  } catch {
    return null;
  }
}

export function saveState(s: Persisted): void {
  try {
    writeJsonAtomic(paths.state, s);
  } catch {}
}
