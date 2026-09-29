// Shortcut menu (?): every key, grouped. Keep in sync with docs/plan.md §12 and ui/app.ts.
import { blank, pad, row } from "../text.ts";

export const HELP: [string, [string, string][]][] = [
  ["PLAYBACK", [
    ["SPACE", "play / pause"],
    ["N  P", "next / previous (restarts if > 5 s in)"],
    ["← → ⇧← ⇧→", "seek 10 s / 60 s"],
    ["-  =", "volume"],
    ["F7 F8 F9", "media keys · Control Center · AirPods"],
  ]],
  ["QUEUE", [
    ["/", "filter: folder names · fav · all = no filter"],
    ["F", "search names and tags"],
    ["S  R", "shuffle on / off · repeat off → all → one"],
    ["D", "one version per song on / off (lengths + versions)"],
    ["L", "like / unlike the playing song ♥ · filter: fav"],
  ]],
  ["VIEWS", [
    ["1 2 3 4", "player · queue · tree · favourites"],
    ["↑↓ J K", "move · PGUP PGDN G ⇧G jump"],
    ["ENTER  ESC", "play selected · open / close folder · back"],
    ["A  X", "favourites: shuffle all · unlike selected"],
    ["← → O .", "tree: close / open · all files · raw names"],
  ]],
  ["OTHER", [
    ["C", "clear cached audio"],
    ["Q  ^C", "quit"],
  ]],
];

export function helpView(w: number, h: number): string[] {
  const rows = HELP.reduce((n, [, keys]) => n + 1 + keys.length, 0);
  const spaced = rows + HELP.length + 1 <= h; // blank lines between groups only when they fit
  const lines: string[] = rows < h ? [blank(w)] : [];
  for (const [group, keys] of HELP) {
    lines.push(row(w, [[` ${group}`, "accentBold"]]));
    for (const [k, what] of keys) lines.push(row(w, [["   "], [pad(k, 12), "bold"], [what]]));
    if (spaced) lines.push(blank(w));
  }
  while (lines.length < h) lines.push(blank(w));
  return lines.slice(0, h);
}
