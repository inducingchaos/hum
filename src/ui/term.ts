// Terminal setup/teardown and flicker-free frame output.
// Alternate screen, hidden cursor, no autowrap, raw input; synchronized output
// (DEC 2026, supported by Ghostty) and line diffing so only changed rows are written.
import { writeSync } from "node:fs";

const ENTER = "\x1b[?1049h\x1b[?25l\x1b[?7l\x1b[2J";
const LEAVE = "\x1b[?2026l\x1b[0m\x1b[?7h\x1b[?25h\x1b[?1049l";

let active = false;

export function enterScreen(): void {
  if (active) return;
  active = true;
  writeSync(1, ENTER);
  if (process.stdin.isTTY) process.stdin.setRawMode(true);
  process.stdin.resume();
}

// Safe to call any number of times, including from exit handlers.
export function leaveScreen(): void {
  if (!active) return;
  active = false;
  try {
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
  } catch {}
  try {
    writeSync(1, LEAVE);
  } catch {}
  process.stdin.pause();
}

export function size(): { cols: number; rows: number } {
  return { cols: process.stdout.columns || 80, rows: process.stdout.rows || 24 };
}

export class Screen {
  private prev: string[] = [];

  invalidate(): void {
    this.prev = [];
  }

  draw(lines: string[]): void {
    let out = "";
    for (let i = 0; i < lines.length; i++) {
      if (this.prev[i] === lines[i]) continue;
      out += `\x1b[${i + 1};1H${lines[i]}\x1b[0m\x1b[K`;
    }
    if (this.prev.length > lines.length) out += `\x1b[${lines.length + 1};1H\x1b[J`;
    this.prev = lines;
    if (out) writeSync(1, `\x1b[?2026h${out}\x1b[?2026l`);
  }
}
