// Spike event log (plan-web §17 W0). Records what the player did while the
// screen was locked, so the owner can read it afterwards in the SYS tab.
// Never logs tokens or temporary links.
import { signal } from "@preact/signals";
import { kv } from "./db.ts";

export interface LogLine {
  t: number; // epoch ms
  hidden: boolean; // page hidden (screen locked / app in background)
  msg: string;
}

const MAX = 400;
export const logLines = signal<LogLine[]>([]);
let saveTimer: ReturnType<typeof setTimeout> | undefined;

export async function loadLog(): Promise<void> {
  const saved = (await kv.get<LogLine[]>("log").catch(() => undefined)) ?? [];
  logLines.value = [...saved, ...logLines.value].slice(-MAX);
}

export function log(msg: string): void {
  const line = { t: Date.now(), hidden: document.visibilityState === "hidden", msg };
  logLines.value = [...logLines.value, line].slice(-MAX);
  if (import.meta.env?.DEV) console.debug("[hum]", msg);
  clearTimeout(saveTimer);
  // Hidden pages can be frozen at any moment, so write through quickly then.
  saveTimer = setTimeout(() => void kv.set("log", logLines.value).catch(() => {}), line.hidden ? 0 : 1000);
}

export function clearLog(): void {
  logLines.value = [];
  void kv.set("log", []);
}

export function fmtClock(t: number): string {
  const d = new Date(t);
  return [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, "0")).join(":");
}
