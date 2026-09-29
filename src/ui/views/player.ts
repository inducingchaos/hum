// Player view (default): now playing, progress, modes, filter (answer 8a: minimal),
// then one rolling list (turn 7): recently played above, the pointer on the
// current song, the queue below. It's the queue view (2) in miniature.
import type { CacheMark } from "../../cache/prefetch.ts";
import type { Player } from "../../core/player.ts";
import { albumOf, folderOf } from "@hum/core/model";
import { fmtTime, plural } from "../../util.ts";
import type { Style } from "../theme.ts";
import { blank, padLeft, row, truncate, width, type Span } from "../text.ts";

export const MARK: Record<CacheMark, string> = { cached: "●", downloading: "◐", missing: "○" };

export function statusLabel(p: Player): Span {
  switch (p.status) {
    case "playing": return ["▶ PLAYING", "accentBold"];
    case "buffering": return ["▶ BUFFERING", "accent"];
    case "paused": return ["❚❚ PAUSED", "bold"];
    case "ended": return ["■ END OF QUEUE", "bold"];
    default: return ["■ STOPPED", "dim"];
  }
}

// A song name padded to `w` columns, with the heart right after it for favourites.
export function nameCell(name: string, fav: boolean, w: number, st: Style = "none"): Span[] {
  const t = truncate(name, fav ? w - 2 : w);
  const used = width(t) + (fav ? 2 : 0);
  return [[t, st], [fav ? " ♥" : "", "accent"], [" ".repeat(Math.max(0, w - used))]];
}

export function modeSpans(p: Player): Span[] {
  const q = p.queue;
  return [
    ["SHUF", q.shuffle ? "accent" : "dim"],
    ["   "],
    [`RPT:${q.repeat.toUpperCase()}`, q.repeat === "off" ? "dim" : "accent"],
    ["   "],
    ["DEDUP", p.dedupe ? "accent" : "dim"],
    ["   "],
    [`VOL ${p.volume}`, p.volume === 0 ? "dim" : "none"],
  ];
}

export function playerView(p: Player, w: number, h: number): string[] {
  const t = p.current;
  const inner = w - 2;
  const lines: string[] = [blank(w)];
  if (!t) {
    lines.push(row(w, [[" NOTHING QUEUED", "bold"]]), row(w, [[" press / to pick a filter", "dim"]]));
  } else {
    lines.push(row(w, [[" "], [t.name.toUpperCase(), "bold"], [p.isFav(t.id) ? "  ♥" : "", "accent"]]));
    lines.push(row(w, [[` ${albumOf(t)}`, "dim"]]));
    lines.push(blank(w));
    const time = `${fmtTime(p.pos)} / ${fmtTime(p.dur)}`;
    const barW = Math.max(4, inner - width(time) - 2);
    const filled = p.dur > 0 ? Math.round((Math.min(p.pos, p.dur) / p.dur) * barW) : 0;
    lines.push(row(w, [[" "], ["█".repeat(filled), "accent"], ["░".repeat(barW - filled), "dim"], ["  "], [time]]));
  }
  lines.push(blank(w));
  const q = p.queue;
  const where: Span[] = q.order.length ? [[`${(q.cursor + 1).toLocaleString()} / ${q.order.length.toLocaleString()} `, "dim"]] : [];
  lines.push(row(w, [[" "], statusLabel(p), ["   "], ...modeSpans(p)], where));
  const f = p.filterText;
  lines.push(row(w, [[" FILTER  ", "dim"], [f || "everything"], [` · ${plural(p.pool.length, "song")}`, "dim"]]));
  lines.push(blank(w));

  // The last row stays empty: breathing room, and the filter prompt draws there.
  if (t) lines.push(...rolling(p, t.id, w, h - lines.length - 1));
  while (lines.length < h) lines.push(blank(w));
  return lines.slice(0, h);
}

// Played (oldest at the top) → the current song → up next. The current row
// sits at a fixed height so the list doesn't jump as history fills up.
function rolling(p: Player, curId: string, w: number, rows: number): string[] {
  if (rows < 3) return [];
  const nameW = Math.min(36, Math.floor((w - 14) * 0.55));
  const line = (label: string, labelSt: Style, mark: Span, id: string | undefined, nameSt: Style, text?: string) => {
    const n = id ? p.track(id) : undefined;
    const left: Span[] = [[` ${padLeft(label, 9)} `, labelSt], mark, [" "]];
    if (!n) return row(w, [...left, [text ?? "", "dim"]]);
    return row(w, [...left, ...nameCell(n.name, p.isFav(n.id), nameW, nameSt), ["  "], [folderOf(n), "dim"]]);
  };

  const above = Math.min(6, Math.floor((rows - 1) / 2)); // tall terminals give the extra rows to up next
  const below = rows - 1 - above;
  const hist = p.history.at(-1) === curId ? p.history.slice(0, -1) : p.history;
  const played = hist.slice(-above);
  const next = p.queue.upcoming(below);

  const out: string[] = Array.from({ length: above - Math.max(1, played.length) }, () => blank(w));
  if (!played.length) out.push(line("↑ PLAYED", "dim", [" "], undefined, "dim", "— nothing yet"));
  played.forEach((id, i) => out.push(line(i === 0 ? "↑ PLAYED" : "", "dim", [" "], id, "dim")));
  out.push(line("NOW", "accentBold", ["▶", "accentBold"], curId, "accentBold"));
  if (!next.length) out.push(line("↓ NEXT", "dim", [" "], undefined, "dim", "— end of queue"));
  next.forEach((id, i) => {
    const mark = p.mark(id);
    out.push(line(i === next.length - 1 ? "↓ NEXT" : "", "dim", [MARK[mark], mark === "cached" ? "accent" : "dim"], id, "none"));
  });
  return out;
}
