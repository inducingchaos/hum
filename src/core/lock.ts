// Single-instance lock: .cache/play.lock holds the running player's PID.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { paths } from "../config.ts";

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

export function isLocked(): boolean {
  if (!existsSync(paths.lock)) return false;
  const pid = Number(readFileSync(paths.lock, "utf8"));
  return Number.isInteger(pid) && pid !== process.pid && alive(pid);
}

export function acquireLock(): boolean {
  if (isLocked()) return false;
  mkdirSync(dirname(paths.lock), { recursive: true });
  writeFileSync(paths.lock, String(process.pid));
  return true;
}

export function releaseLock(): void {
  try {
    if (Number(readFileSync(paths.lock, "utf8")) === process.pid) rmSync(paths.lock);
  } catch {}
}
