// Queue view (2): the whole queue, current track marked, cache state per upcoming song.
import type { Player } from "../../core/player.ts";
import { folderOf } from "@hum/core/model";
import { fmtTime, plural } from "../../util.ts";
import { blank, pad, row } from "../text.ts";
import type { ListState } from "./list.ts";
import { MARK } from "./player.ts";

export function queueView(p: Player, list: ListState, w: number, h: number): string[] {
  const order = p.queue.order;
  const cur = p.queue.cursor;
  const lines: string[] = [
    row(w, [[" QUEUE  ", "bold"], [`${plural(order.length, "song")} · ${p.filterText || "everything"}`, "dim"]]),
  ];
  const listH = h - 1;
  const top = list.window(order.length, listH);
  const nameW = Math.min(40, Math.floor((w - 20) * 0.55));
  for (let i = top; i < Math.min(order.length, top + listH); i++) {
    const t = p.track(order[i]!);
    if (!t) continue;
    const isCur = i === cur;
    const past = i < cur;
    const mark = past ? " " : isCur ? "▶" : MARK[p.mark(t.id)];
    const text = ` ${mark} ${pad(t.name + (p.isFav(t.id) ? " ♥" : ""), nameW)}  `;
    const right = ` ${folderOf(t)}  ${fmtTime(t.duration).padStart(7)} `;
    if (i === list.sel) lines.push(row(w, [[pad(text, w - right.length) + right, "inverse"]]));
    else lines.push(row(w, [[text, isCur ? "accentBold" : past ? "dim" : "none"]], [[right, isCur ? "accent" : "dim"]]));
  }
  while (lines.length < h) lines.push(blank(w));
  return lines.slice(0, h);
}
