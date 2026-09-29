import { expect, test } from "bun:test";
import { unzip } from "../src/library/zip.ts";

// Same fixture as ios/HumTests (made by Python's zipfile): a folder entry, a
// deflated JSON, a stored JSON, a deflated .txt.
const sample = Buffer.from("UEsDBBQAAAAAAAAAIQAAAAAAAAAAAAAAAAAFAAAAbWV0YS9QSwMEFAAAAAgAiQo9XVNRjghBAAAARQAAABoAAABtZXRhL3F1aWV0LWhhcmJvdXItMDEuanNvbqtWykvMTVWyUlAKLM1MLVHwSCxKyi8tUtJRUEopLUosyczPA0oaWhgYAEVKEtOLgbxopeTEnFyQkuKc/HKl2FoAUEsDBBQAAAAAAIkKPV2oSMexEQAAABEAAAATAAAAbWV0YS9zdG9yZWQtMDIuanNvbnsibmFtZSI6IlN0b3JlZCJ9UEsDBBQAAAAIAIkKPV1RzrIKCAAAAPQBAAAPAAAAbWV0YS9yZWFkbWUudHh0q6gYBSMNAABQSwECFAMUAAAAAAAAACEAAAAAAAAAAAAAAAAABQAAAAAAAAAAAAAAgAEAAAAAbWV0YS9QSwECFAMUAAAACACJCj1dU1GOCEEAAABFAAAAGgAAAAAAAAAAAAAAgAEjAAAAbWV0YS9xdWlldC1oYXJib3VyLTAxLmpzb25QSwECFAMUAAAAAACJCj1dqEjHsREAAAARAAAAEwAAAAAAAAAAAAAAgAGcAAAAbWV0YS9zdG9yZWQtMDIuanNvblBLAQIUAxQAAAAIAIkKPV1RzrIKCAAAAPQBAAAPAAAAAAAAAAAAAACAAd4AAABtZXRhL3JlYWRtZS50eHRQSwUGAAAAAAQABAD5AAAAEwEAAAAA", "base64");

test("unzip reads stored and deflated entries, skips folders", () => {
  const e = unzip(new Uint8Array(sample));
  expect(e.map((x) => x.name)).toEqual(["meta/quiet-harbour-01.json", "meta/stored-02.json", "meta/readme.txt"]);
  expect(JSON.parse(new TextDecoder().decode(e[0]!.data)).name).toBe("Quiet Harbour");
  expect(new TextDecoder().decode(e[1]!.data)).toBe('{"name":"Stored"}');
  expect(e[2]!.data.length).toBe(500);
  expect(() => unzip(new TextEncoder().encode("not a zip at all, definitely not"))).toThrow();
});
