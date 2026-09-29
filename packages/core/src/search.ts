// Search over name and tags (owner's answer 3b). All terms must match somewhere.
// Ranking per term: name prefix > name word > name substring > exact tag > tag substring.
import type { Track } from "./model.ts";

function tagsOf(t: Track): string[] {
  return t.tags.map((x) => x.toLowerCase());
}

function termScore(term: string, name: string, tags: string[]): number {
  if (name.startsWith(term)) return 50;
  if (name.split(/[\s\-']+/).some((w) => w.startsWith(term))) return 40;
  if (name.includes(term)) return 30;
  if (tags.includes(term)) return 20;
  if (tags.some((t) => t.includes(term))) return 10;
  return 0;
}

export function search<T extends Track>(tracks: T[], query: string, limit = 200): T[] {
  const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  const scored: [T, number][] = [];
  for (const t of tracks) {
    const name = t.name.toLowerCase();
    const tags = tagsOf(t);
    let total = 0;
    for (const term of terms) {
      const s = termScore(term, name, tags);
      if (!s) {
        total = 0;
        break;
      }
      total += s;
    }
    if (total) scored.push([t, total]);
  }
  scored.sort((a, b) => b[1] - a[1] || a[0].name.length - b[0].name.length || a[0].name.localeCompare(b[0].name));
  return scored.slice(0, limit).map(([t]) => t);
}
