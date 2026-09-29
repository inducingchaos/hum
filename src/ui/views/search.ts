// Search view (f): type to search names and tags; ENTER plays the pick now.
import type { Player } from "../../core/player.ts";
import { search } from "@hum/core/search";
import type { Track } from "@hum/core/model";
import { folderOf } from "@hum/core/model";
import { blank, pad, row } from "../text.ts";
import { ListState } from "./list.ts";

const LIMIT = 200;

export class SearchState {
  query = "";
  list = new ListState();
  results: Track[] = [];

  update(p: Player): void {
    this.results = search(p.songs, this.query, LIMIT);
    this.list.sel = 0;
    this.list.scroll = 0;
  }
}

export function searchView(s: SearchState, p: Player, w: number, h: number): string[] {
  const lines: string[] = [
    row(w, [[" SEARCH › ", "bold"], [s.query], ["█", "accent"]], s.query ? [[`${s.results.length}${s.results.length === LIMIT ? "+" : ""} `, "dim"]] : []),
  ];
  if (!s.query) lines.push(row(w, [["   names and tags · ENTER plays · ESC back", "dim"]]));
  const listH = h - lines.length;
  const top = s.list.window(s.results.length, listH);
  for (let i = top; i < Math.min(s.results.length, top + listH); i++) {
    const t = s.results[i]!;
    const right = ` ${folderOf(t)} `;
    const left = `   ${t.name}${p.isFav(t.id) ? " ♥" : ""}`;
    if (i === s.list.sel) lines.push(row(w, [[pad(left, w - right.length) + right, "inverse"]]));
    else lines.push(row(w, [[left]], [[right, "dim"]]));
  }
  while (lines.length < h) lines.push(blank(w));
  return lines.slice(0, h);
}
