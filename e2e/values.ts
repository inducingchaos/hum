// Prints shell exports for the e2e scripts, picked from YOUR library + profile,
// so the tests contain no library-specific names. Used by e2e/run.sh.
import { loadLibrary } from "../src/library/sync.ts";
import { vocabulary } from "@hum/core/filter";
import { dedupe, folderOf, type Track } from "@hum/core/model";

const lib = loadLibrary();
if (!lib) throw new Error("no library yet: run `pnpm play` once");
const tracks = lib.tracks;
const songs = dedupe(tracks);
const byFolder = new Map<string, Track[]>();
for (const t of songs) byFolder.set(folderOf(t), [...(byFolder.get(folderOf(t)) ?? []), t]);

// A small leaf folder with a few songs: quick to prefetch.
const [smallFolder] = [...byFolder].filter(([, ts]) => ts.length >= 4).sort((a, b) => a[1].length - b[1].length)[0]!;
const small = smallFolder.split("/").join(" ");
// The last two folder levels of one track: a filter that spans several first-level folders.
const pair = songs[0]!.dims.slice(-2).join(" ");
// Two vocabulary words sharing a prefix that is not a word itself.
const vocab = vocabulary(tracks).filter((v) => v !== "fav");
let ambiguous = "", hint = "";
for (const a of vocab) {
  for (let n = 2; n < a.length && !ambiguous; n++) {
    const pre = a.slice(0, n);
    const hits = vocab.filter((v) => v.startsWith(pre));
    if (hits.length === 2 && !vocab.includes(pre)) [ambiguous, hint] = [pre, hits.join(" · ")];
  }
  if (ambiguous) break;
}
// Tab completion: the first word of `small` plus a unique prefix of its second word.
const [w1, w2] = small.split(" ");
let partial = w2!;
for (let n = 1; n <= w2!.length; n++) if (vocab.filter((v) => v.startsWith(w2!.slice(0, n))).length === 1) { partial = w2!.slice(0, n); break; }
// A folder name the tree view shows collapsed after `j` + Enter: the first second-level folder.
const firstTop = [...new Set(tracks.map((t) => t.dims[0]!))].sort()[0]!;
const firstChild = [...new Set(tracks.filter((t) => t.dims[0] === firstTop).map((t) => t.dims[1]!))].sort()[0]!;
// A search word: the first word of some song name.
const word = songs[0]!.name.split(/\s+/)[0]!;

const out = {
  HUM_E2E_SMALL: small,
  HUM_E2E_PAIR: pair,
  HUM_E2E_AMBIG: ambiguous,
  HUM_E2E_AMBIG_HINT: hint,
  HUM_E2E_TAB_IN: `${w1} ${partial}`,
  HUM_E2E_TAB_OUT: `${w1} ${w2}`,
  HUM_E2E_FILES: `${tracks.length.toLocaleString()} FILES`,
  HUM_E2E_CHILD: firstChild,
  HUM_E2E_WORD: word,
};
for (const [k, v] of Object.entries(out)) console.log(`export ${k}='${v.replaceAll("'", "'\\''")}'`);
