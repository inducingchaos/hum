import { describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AudioCache } from "../src/cache/lru.ts";
import { Favorites } from "../src/core/favorites.ts";
import { search } from "@hum/core/search";
import { dedupe, dedupeVariants, groupKey } from "@hum/core/model";
import { artUrl } from "@hum/core/art";
import { metadataDir, parseProfile, tracksDir, valueOrder } from "@hum/core/profile";
import { cleanList, idOf, nameFromStem, segmentsOf, toTrack } from "@hum/core/normalize";
import { track, VARIANT } from "./fixtures.ts";

const TRACKS = "/lib/audio";

describe("normalize", () => {
  test("comma-joined values are split, trimmed, deduped", () => {
    expect(cleanList(["Soft, Warm", "Warm", " Deep "])).toEqual(["Soft", "Warm", "Deep"]);
    expect(cleanList(undefined)).toEqual([]);
  });

  test("ids, names, segments", () => {
    const stem = "quiet-harbour-0123456789abcdef01234567";
    expect(idOf(stem)).toBe("0123456789abcdef01234567");
    expect(nameFromStem(stem)).toBe("Quiet Harbour");
    expect(segmentsOf(`${TRACKS}/dawn/jade/dark/${stem}.mp3`, TRACKS, 3)).toEqual(["dawn", "jade", "dark"]);
    expect(segmentsOf(`${TRACKS}/dawn/x.mp3`, TRACKS, 3)).toBeNull();
    expect(segmentsOf(`${TRACKS}/dawn/x.mp3`, TRACKS)).toEqual(["dawn"]);
    expect(segmentsOf("/elsewhere/dawn/jade/dark/x.mp3", TRACKS, 3)).toBeNull();
  });

  test("bpm 0/1 is unknown; missing metadata falls back to the slug; tags are every string list", () => {
    const file = { path_lower: `${TRACKS}/noon/ochre/light/still-water-abc.mp3`, name: "still-water-abc.mp3", size: 5 };
    expect(toTrack(file, { name: "Still Water", bpm: 1 }, TRACKS, 3)!.bpm).toBeUndefined();
    expect(toTrack(file, { name: "Still Water", bpm: 90 }, TRACKS, 3)!.bpm).toBe(90);
    const bare = toTrack(file, undefined, TRACKS, 3)!;
    expect([bare.name, bare.hasMeta, bare.id, bare.dims[0]]).toEqual(["Still Water", false, "abc", "noon"]);
    const rich = toTrack(file, { title: "Still Water", a: ["x", "y, z"], b: ["x"], c: [1, 2], image: "https://img/1" }, TRACKS, 3)!;
    expect([rich.name, rich.tags, rich.image]).toEqual(["Still Water", ["x", "y", "z"], "https://img/1"]);
  });
});

describe("profile", () => {
  const base = { root: "/Lib/", tracks: "audio", metadata: "meta", dimensions: ["A", "b", "c"] };
  test("valid profile is normalised", () => {
    const p = parseProfile({ ...base, variant: { dimension: 2, prefer: "Mid" } });
    expect([p.root, p.dimensions, p.variant, p.label, tracksDir(p), metadataDir(p)]).toEqual([
      "/lib", ["a", "b", "c"], { dimension: 2, prefer: "mid" }, "hum", "/lib/audio", "/lib/meta",
    ]);
  });
  test("bad profiles explain themselves", () => {
    expect(() => parseProfile({ ...base, root: "lib" })).toThrow(/root/);
    expect(() => parseProfile({ ...base, dimensions: "a" })).toThrow(/dimensions/);
    expect(() => parseProfile({ ...base, variant: { dimension: 5, prefer: "x" } })).toThrow(/variant/);
  });
  test("value order: profile order first, then alphabetical", () => {
    expect(["b", "z", "a", "y"].sort(valueOrder({ order: ["z", "y"] }))).toEqual(["z", "y", "a", "b"]);
  });
});

describe("dedupe", () => {
  test("keeps the longest length variant per song + folder", () => {
    const a = track({ dims: ["fog", "ochre", "light"], name: "Lamp", duration: 900 });
    const b = track({ dims: ["fog", "ochre", "light"], name: "Lamp", duration: 3600 });
    const c = track({ dims: ["fog", "ochre", "dark"], name: "Lamp", duration: 900 });
    const out = dedupe([a, b, c]);
    expect(out).toHaveLength(2);
    expect(out).toContain(b);
    expect(out).toContain(c);
  });
});

describe("dedupeVariants", () => {
  const lamp = (lvl: string, id: string) => track({ id, dims: ["fog", "ochre", lvl], name: "Lamp" });
  const [hi, med, lo] = [lamp("dark", "h"), lamp("mid", "m"), lamp("light", "l")];
  const bell = track({ dims: ["fog", "ochre", "dark"], name: "Bell" });
  const pref = (prefer: string) => ({ ...VARIANT, prefer });

  test("one version per song, the preferred one, input order kept", () => {
    expect(dedupeVariants([hi, bell, med, lo], pref("mid"))).toEqual([bell, med]);
    expect(dedupeVariants([hi, bell, med, lo], pref("light"))).toEqual([bell, lo]);
  });

  test("falls back in profile order when the preferred version is missing", () => {
    expect(dedupeVariants([hi, lo], pref("mid"))).toEqual([hi]);
    expect(dedupeVariants([lo, hi], { dimension: 2, prefer: "mid", fallback: ["light"] })).toEqual([lo]);
  });

  test("a liked version wins over the preferred one", () => {
    expect(dedupeVariants([hi, med, lo], pref("mid"), (t) => t === lo)).toEqual([lo]);
  });

  test("no variant dimension: nothing is dropped", () => {
    expect(dedupeVariants([hi, med, lo], undefined)).toEqual([hi, med, lo]);
  });

  test("group key skips the variant dimension", () => {
    expect([groupKey(hi, 2), groupKey(hi)]).toEqual(["fog/ochre/lamp", "fog/ochre/dark/lamp"]);
  });
});

describe("favorites", () => {
  test("a like covers every version of the song and persists", () => {
    const dir = mkdtempSync(join(tmpdir(), "hum-fav-"));
    try {
      const file = join(dir, "f.json");
      const hi = track({ dims: ["dawn", "jade", "dark"], name: "Kite" });
      const lo = track({ dims: ["dawn", "jade", "light"], name: "Kite" });
      const favs = new Favorites(file, 2);
      expect(favs.toggle(hi)).toBe(true);
      const again = new Favorites(file, 2);
      expect([again.has(lo), again.isLikedVersion(hi), again.isLikedVersion(lo)]).toEqual([true, true, false]);
      expect(again.toggle(lo)).toBe(false);
      expect(new Favorites(file, 2).size).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("cover art", () => {
  test("adds the profile's query with the size filled in, keeping the rest", () => {
    const u = new URL(artUrl("https://img.example/photo-1?a=1&w=500", "w={size}&h={size}&fit=crop"));
    expect([u.pathname, u.searchParams.get("a"), u.searchParams.get("w"), u.searchParams.get("h"), u.searchParams.get("fit")]).toEqual(["/photo-1", "1", "600", "600", "crop"]);
    expect(artUrl("https://img.example/p", undefined)).toBe("https://img.example/p");
  });
});

describe("search", () => {
  const t = (name: string, tags: string[] = []) => track({ dims: ["dawn", "jade", "light"], name, tags });
  const lib = [t("Paper Drifts"), t("Drift Away"), t("Lantern Hall", ["Drifting"]), t("Far Orbit", ["Calm"]), t("Sunset Drift")];

  test("name prefix > name word > tag", () => {
    expect(search(lib, "drift").map((x) => x.name)).toEqual(["Drift Away", "Paper Drifts", "Sunset Drift", "Lantern Hall"]);
  });

  test("all terms must match", () => {
    expect(search(lib, "far calm").map((x) => x.name)).toEqual(["Far Orbit"]);
    expect(search(lib, "far nope")).toEqual([]);
  });
});

describe("lru cache", () => {
  test("evicts least recently used, never pinned; clear frees unpinned", () => {
    const dir = mkdtempSync(join(tmpdir(), "hum-lru-"));
    try {
      for (const [id, age] of [["a", 300], ["b", 200], ["c", 100]] as const) {
        writeFileSync(join(dir, `${id}.mp3`), Buffer.alloc(100));
        const t = new Date(Date.now() - age * 1000);
        utimesSync(join(dir, `${id}.mp3`), t, t);
      }
      writeFileSync(join(dir, "d.mp3.part"), "x");
      const cache = new AudioCache(dir, 150);
      expect(readdirSync(dir)).not.toContain("d.mp3.part");
      cache.evict(new Set(["a"]));
      expect([cache.has("a"), cache.has("b"), cache.has("c")]).toEqual([true, false, false]);
      expect(cache.clear(new Set())).toBe(100);
      expect(cache.count).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
