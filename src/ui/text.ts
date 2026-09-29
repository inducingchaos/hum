// Width-aware line building. A line is a list of spans; styles are applied after
// truncation so escape codes never count toward (or break) the width.
import { RESET, style, type Style } from "./theme.ts";

export type Span = [text: string, style?: Style];

export const width = (s: string): number => Bun.stringWidth(s);

// Cut to at most `w` columns, ending in "…" when something was cut.
export function truncate(s: string, w: number): string {
  if (w <= 0) return "";
  if (width(s) <= w) return s;
  let out = "";
  let used = 0;
  for (const ch of s) {
    const cw = width(ch);
    if (used + cw > w - 1) break;
    out += ch;
    used += cw;
  }
  return out + "…";
}

export function pad(s: string, w: number): string {
  const t = truncate(s, w);
  return t + " ".repeat(Math.max(0, w - width(t)));
}

export function padLeft(s: string, w: number): string {
  const t = truncate(s, w);
  return " ".repeat(Math.max(0, w - width(t))) + t;
}

function paint(spans: Span[], budget: number): [string, number] {
  let out = "";
  let used = 0;
  for (const [text, st] of spans) {
    if (used >= budget) break;
    const t = truncate(text, budget - used);
    if (!t) continue;
    out += st && st !== "none" ? style[st] + t + RESET : t;
    used += width(t);
  }
  return [out, used];
}

// Left spans, then `fill` characters, then right spans, exactly `w` columns wide.
// The right side wins when space is short; the left side gets truncated.
export function row(w: number, left: Span[], right: Span[] = [], fill = " ", fillStyle?: Style): string {
  const rightW = right.reduce((n, [t]) => n + width(t), 0);
  const [r, rw] = rightW <= w ? paint(right, w) : ["", 0];
  const [l, lw] = paint(left, w - rw);
  const gap = w - lw - rw;
  const f = fill.repeat(Math.max(0, gap));
  return l + (fillStyle && gap > 0 ? style[fillStyle] + f + RESET : f) + r;
}

export const blank = (w: number) => " ".repeat(w);
