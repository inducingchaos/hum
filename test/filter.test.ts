import { describe, expect, test } from "bun:test";
import { applyFilter, complete, parseFilter, resolveTerm, vocabulary } from "@hum/core/filter";
import { folderOf } from "@hum/core/model";
import { library } from "./fixtures.ts";

const lib = library();
const vocab = vocabulary(lib);
const folders = (q: string) => [...new Set(applyFilter(lib, parseFilter(q, vocab)).map(folderOf))].sort();

describe("filter", () => {
  test("all terms must match: grey dark", () => {
    expect(folders("grey dark")).toEqual(["dawn/grey/dark", "fog/grey/dark", "midnight/grey/dark"]);
  });

  test("a single third-level value matches every */*/dark folder", () => {
    expect(folders("dark")).toHaveLength(19);
    expect(folders("dark").every((f) => f.endsWith("/dark"))).toBe(true);
  });

  test("same dimension = either: azure indigo", () => {
    expect(folders("dawn azure indigo")).toEqual([
      "dawn/azure/dark", "dawn/azure/light", "dawn/azure/mid",
      "dawn/indigo/dark", "dawn/indigo/light", "dawn/indigo/mid",
    ]);
    expect(folders("noon fog ochre light")).toEqual(["fog/ochre/light", "noon/ochre/light"]);
  });

  test("first + second level", () => {
    expect(folders("noon ochre")).toEqual(["noon/ochre/dark", "noon/ochre/light", "noon/ochre/mid"]);
  });

  test("exact wins over prefix: mid is not midnight", () => {
    expect(resolveTerm("mid", vocab)).toEqual({ term: "mid", kind: "ok", matches: ["mid"] });
    expect(folders("mid").every((f) => f.endsWith("/mid"))).toBe(true);
  });

  test("ambiguous prefixes are errors", () => {
    expect(resolveTerm("mi", vocab)).toMatchObject({ kind: "ambiguous", matches: ["mid", "midnight"] });
    expect(resolveTerm("li", vocab)).toMatchObject({ kind: "ambiguous", matches: ["light", "lime"] });
    expect(parseFilter("mi", vocab).ok).toBe(false);
  });

  test("unique prefix", () => {
    expect(resolveTerm("gre", vocab)).toMatchObject({ kind: "ok", matches: ["grey"] });
    expect(resolveTerm("a", vocab)).toMatchObject({ kind: "ambiguous" });
    expect(resolveTerm("midn", vocab)).toMatchObject({ kind: "ok", matches: ["midnight"] });
    expect(resolveTerm("lig", vocab)).toMatchObject({ kind: "ok", matches: ["light"] });
  });

  test("hyphenated names", () => {
    expect(resolveTerm("seagreen", vocab).matches).toEqual(["sea-green"]);
    expect(resolveTerm("green", vocab).matches).toEqual(["sea-green"]);
    expect(resolveTerm("sea", vocab).matches).toEqual(["sea-green"]);
  });

  test("case-insensitive, unknown terms fail", () => {
    expect(folders("DAWN Jade LIGHT")).toEqual(["dawn/jade/light"]);
    expect(resolveTerm("jazz", vocab).kind).toBe("none");
  });

  test("empty filter or `all` = everything", () => {
    expect(applyFilter(lib, parseFilter("  ", vocab))).toHaveLength(lib.length);
    expect(applyFilter(lib, parseFilter("all", vocab))).toHaveLength(lib.length);
    expect(parseFilter("ALL", vocab)).toEqual({ terms: [], ok: true });
    expect(folders("all noon ochre")).toEqual(folders("noon ochre"));
  });

  test("fav is a pseudo-folder, combinable with real ones", () => {
    const liked = new Set([lib[0]!.id, lib.find((t) => t.dims[0] === "noon")!.id]);
    const isFav = (t: { id: string }) => liked.has(t.id);
    expect(resolveTerm("favourites", vocab)).toMatchObject({ kind: "ok", matches: ["fav"] });
    expect(resolveTerm("fa", vocab)).toMatchObject({ kind: "ok", matches: ["fav"] });
    expect(resolveTerm("f", vocab)).toMatchObject({ kind: "ambiguous", matches: ["fav", "fog"] });
    expect(applyFilter(lib, parseFilter("fav", vocab), isFav)).toHaveLength(2);
    expect(applyFilter(lib, parseFilter("fav noon", vocab), isFav).map((t) => t.dims[0])).toEqual(["noon"]);
  });

  test("tab completion", () => {
    expect(complete("grey dar", vocab)).toBe("grey dark ");
    expect(complete("mi", vocab)).toBe("mid");
    expect(complete("x", vocab)).toBe("x");
    expect(complete("dawn ", vocab)).toBe("dawn ");
  });
});
