// Favourites view (4): liked songs, newest first. ENTER plays one, A shuffles
// them all (the `fav` filter), X unlikes the selected one.
import type { Player } from "../../core/player.ts";
import { folderOf } from "@hum/core/model";
import { fmtTime, plural } from "../../util.ts";
import { blank, pad, row } from "../text.ts";
import type { ListState } from "./list.ts";

export function favoritesView(p: Player, list: ListState, w: number, h: number): string[] {
  const favs = p.favoriteTracks();
  const lines: string[] = [
    row(w, [[" FAVOURITES  ", "bold"], [`${plural(favs.length, "song")} · ENTER plays · A shuffles all · X unlikes`, "dim"]]),
  ];
  if (!favs.length) lines.push(blank(w), row(w, [["   nothing yet · press L while a song plays to like it", "dim"]]));
  const listH = h - 1;
  const top = list.window(favs.length, listH);
  const nameW = Math.min(40, Math.floor((w - 20) * 0.55));
  for (let i = top; i < Math.min(favs.length, top + listH); i++) {
    const t = favs[i]!;
    const playing = t.id === p.loadedId;
    const text = ` ${playing ? "▶" : " "} ${pad(t.name, nameW)}  `;
    const right = ` ${folderOf(t)}  ${fmtTime(t.duration).padStart(7)} `;
    if (i === list.sel) lines.push(row(w, [[pad(text, w - right.length) + right, "inverse"]]));
    else lines.push(row(w, [[text, playing ? "accentBold" : "none"]], [[right, playing ? "accent" : "dim"]]));
  }
  while (lines.length < h) lines.push(blank(w));
  return lines.slice(0, h);
}
