import type { Track } from "@hum/core/model";

// A made-up taxonomy with the edge cases the filter must handle: a prefix
// shared across dimensions (mi → mid, midnight), an exact name that is also a
// prefix (mid / midnight), a hyphenated name (sea-green), and one first-level
// value with many more second-level folders than the others.
export const FOLDERS: Record<string, string[]> = {
  dawn: ["amber", "azure", "crimson", "gold", "grey", "indigo", "jade", "lime", "navy", "ochre", "sea-green"],
  fog: ["azure", "grey", "ochre"],
  midnight: ["azure", "grey", "ochre"],
  noon: ["azure", "ochre"],
};
export const LEVELS = ["dark", "light", "mid"];
export const VARIANT = { dimension: 2, prefer: "mid", fallback: ["dark", "light"] };

let n = 0;
export function track(p: Partial<Track> & { dims: string[] }): Track {
  const id = (p.id ?? String(++n)).padStart(4, "0");
  return {
    id,
    stem: `x-${id}`,
    path: `/x/${p.dims.join("/")}/x-${id}.mp3`,
    fileName: `x-${id}.mp3`,
    name: `Song ${id}`,
    size: 1000,
    duration: 1800,
    tags: [],
    hasMeta: true,
    ...p,
  };
}

// Two songs in every leaf folder.
export function library(): Track[] {
  const out: Track[] = [];
  for (const [a, bs] of Object.entries(FOLDERS))
    for (const b of bs) for (const c of LEVELS) for (let i = 0; i < 2; i++) out.push(track({ dims: [a, b, c] }));
  return out;
}
