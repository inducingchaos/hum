// Folder filter (owner's answer 2a). Terms in different dimensions (folder
// levels, plus fav) must all match; terms in the SAME dimension are
// alternatives (turn 14): `dawn azure indigo` = dawn AND (azure OR indigo).
// A term matches a folder name when it:
//   1. equals it (mid, midnight)
//   2. equals it without hyphens (seagreen)
//   3. equals one hyphen part (green → sea-green)
//   4. is a unique prefix across the vocabulary (gre → grey); ambiguous
//      prefixes (mi → mid, midnight) are an error, never a guess.
// Plus one pseudo-folder, `fav`: the owner's favourites (turn 7), so `fav`,
// `fav dawn`, and `pnpm play fav` all work like any other term.
// And `all` (turn 8) clears the filter: `/all` or `pnpm play all` shuffles everything.
import type { Track } from "./model.ts";

export type TermResult =
  | { term: string; kind: "ok"; matches: string[] }
  | { term: string; kind: "ambiguous"; matches: string[] }
  | { term: string; kind: "none"; matches: [] };

export interface ParsedFilter {
  terms: TermResult[];
  ok: boolean; // every term resolved
}

export const FAV = "fav";
const FAV_ALIASES = new Set(["favs", "favorite", "favorites", "favourite", "favourites", "♥"]);

export function vocabulary(tracks: Track[]): string[] {
  const v = new Set<string>([FAV]);
  for (const t of tracks) for (const s of t.dims) v.add(s);
  return [...v].sort();
}

export function resolveTerm(raw: string, vocab: string[]): TermResult {
  const term = raw.toLowerCase();
  if (FAV_ALIASES.has(term)) return { term, kind: "ok", matches: [FAV] };
  if (vocab.includes(term)) return { term, kind: "ok", matches: [term] };
  const dehyphen = vocab.filter((v) => v.includes("-") && v.replaceAll("-", "") === term);
  if (dehyphen.length) return { term, kind: "ok", matches: dehyphen };
  const part = vocab.filter((v) => v.includes("-") && v.split("-").includes(term));
  if (part.length) return { term, kind: "ok", matches: part };
  const prefix = vocab.filter((v) => v.startsWith(term) || v.replaceAll("-", "").startsWith(term));
  if (prefix.length === 1) return { term, kind: "ok", matches: prefix };
  if (prefix.length > 1) return { term, kind: "ambiguous", matches: prefix };
  return { term, kind: "none", matches: [] };
}

const ALL = new Set(["all", "everything", "*"]);

export function parseFilter(query: string, vocab: string[]): ParsedFilter {
  const words = query.trim().split(/\s+/).filter((w) => w && !ALL.has(w.toLowerCase()));
  const terms = words.map((t) => resolveTerm(t, vocab));
  return { terms, ok: terms.every((t) => t.kind === "ok") };
}

export type IsFav = (t: Track) => boolean;

export function matches(t: Track, f: ParsedFilter, isFav: IsFav = () => false, dims?: Map<string, number>): boolean {
  const segs = t.dims;
  const hit = (m: string) => (m === FAV ? isFav(t) : segs.includes(m));
  if (!dims) return f.terms.every((term) => term.matches.some(hit));
  for (const group of groupTerms(f, dims).values()) if (!group.some(hit)) return false;
  return true;
}

// Which dimension (segment index) each folder name lives in, from the tracks themselves.
export function dimensions(tracks: Track[]): Map<string, number> {
  const dims = new Map<string, number>();
  for (const t of tracks) t.dims.forEach((s, i) => dims.has(s) || dims.set(s, i));
  return dims;
}

// Matched values grouped by dimension; each group is an OR, groups are ANDed.
function groupTerms(f: ParsedFilter, dims: Map<string, number>): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const term of f.terms) {
    for (const m of term.matches) {
      const k = m === FAV ? FAV : String(dims.get(m) ?? `?${m}`);
      groups.set(k, [...(groups.get(k) ?? []), m]);
    }
  }
  return groups;
}

export function applyFilter<T extends Track>(tracks: T[], f: ParsedFilter, isFav?: IsFav): T[] {
  if (!f.terms.length) return tracks;
  const dims = dimensions(tracks);
  return tracks.filter((t) => matches(t, f, isFav, dims));
}

export const usesFav = (f: ParsedFilter): boolean => f.terms.some((t) => t.kind === "ok" && t.matches.includes(FAV));

// Tab completion for the last term: the unique match, or the longest common prefix.
export function complete(query: string, vocab: string[]): string {
  const m = /(\S*)$/.exec(query)!;
  const last = m[1]!.toLowerCase();
  if (!last) return query;
  const hits = vocab.filter((v) => v.startsWith(last));
  if (!hits.length) return query;
  if (hits.length === 1) return query.slice(0, m.index) + hits[0] + " ";
  let lcp = hits[0]!;
  for (const h of hits) while (!h.startsWith(lcp)) lcp = lcp.slice(0, -1);
  return query.slice(0, m.index) + lcp;
}

// Canonical form shown in the UI: "grey dark".
export function describe(f: ParsedFilter): string {
  return f.terms.map((t) => (t.matches.length === 1 ? t.matches[0] : t.term)).join(" ");
}
