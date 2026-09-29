import { describe, expect, test } from "bun:test";
import { zipSync } from "fflate";
import { apiArg, challengeOf } from "../src/dropbox.ts";
import { parseMetaZip } from "../src/library.ts";

describe("pkce", () => {
  test("S256 challenge matches RFC 7636 appendix B", async () => {
    expect(await challengeOf("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });
});

describe("dropbox", () => {
  test("Dropbox-API-Arg escapes non-ASCII", () => {
    expect(apiArg({ path: "/a/café" })).toBe('{"path":"/a/caf\\u00e9"}');
  });
});

describe("metadata zip", () => {
  test("keys by lowercase stem, skips junk", () => {
    const enc = new TextEncoder();
    const zip = zipSync({
      "metadata/Quiet-Harbour-62b3.json": enc.encode(JSON.stringify({ name: "Quiet Harbour", duration: 1800 })),
      "metadata/broken-1.json": enc.encode("{nope"),
      "metadata/readme.txt": enc.encode("x"),
    });
    const m = parseMetaZip(zip);
    expect([...m.keys()]).toEqual(["quiet-harbour-62b3"]);
    expect(m.get("quiet-harbour-62b3")?.duration).toBe(1800);
  });
});
