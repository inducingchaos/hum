// Runs test/cases/core-cases.json against packages/core. ios/HumCore runs the
// same file, so the TypeScript and Swift cores can't drift apart.
import { describe, expect, test } from "bun:test";
import { applyFilter, complete, parseFilter, resolveTerm, vocabulary } from "@hum/core/filter";
import { fmtTime } from "@hum/core/format";
import { folderOf } from "@hum/core/model";
import { idOf, nameFromStem } from "@hum/core/normalize";
import { search } from "@hum/core/search";
import cases from "./cases/core-cases.json";
import { track } from "./fixtures.ts";

const lib = Object.entries(cases.library.folders as Record<string, string[]>).flatMap(([a, bs]) =>
  bs.flatMap((b) => cases.library.levels.flatMap((c) => [0, 1].map(() => track({ dims: [a, b, c] })))),
);
const vocab = vocabulary(lib);
const folders = (q: string) => [...new Set(applyFilter(lib, parseFilter(q, vocab)).map(folderOf))].sort();

describe("shared cases", () => {
  test("filter → folders", () => {
    for (const c of cases.filter) expect([c.query, folders(c.query)]).toEqual([c.query, c.folders]);
  });
  test("filter → counts", () => {
    for (const c of cases.counts) expect([c.query, applyFilter(lib, parseFilter(c.query, vocab)).length]).toEqual([c.query, c.count]);
  });
  test("resolve", () => {
    for (const c of cases.resolve) expect(resolveTerm(c.term, vocab)).toEqual({ term: c.term, kind: c.kind as never, matches: c.matches as never });
  });
  test("complete", () => {
    for (const c of cases.complete) expect([c.in, complete(c.in, vocab)]).toEqual([c.in, c.out]);
  });
  test("search", () => {
    const ts = cases.search.tracks.map((t) => track({ dims: ["dawn", "jade", "light"], name: t.name, tags: t.tags }));
    for (const c of cases.search.cases) expect([c.query, search(ts, c.query).map((t) => t.name)]).toEqual([c.query, c.names]);
  });
  test("normalize + time", () => {
    for (const c of cases.normalize) expect([idOf(c.stem), nameFromStem(c.stem)]).toEqual([c.id, c.name]);
    for (const c of cases.time) expect(fmtTime(c.sec)).toBe(c.out);
  });
});
