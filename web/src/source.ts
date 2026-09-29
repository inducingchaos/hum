// Where a track's audio comes from: the local cache if it's there, else Dropbox.
import type { Track } from "@hum/core/model";
import { cachedBlob, cachedUrl } from "./cache.ts";
import { download, temporaryLink } from "./dropbox.ts";

export interface UrlSource {
  id: string;
  url: string;
  kind: "cache" | "stream";
  at: number; // when resolved; temp links go stale
}

// For the element engine: something to put in <audio src>.
export async function urlFor(t: Track, fresh = false): Promise<UrlSource> {
  const blob = fresh ? undefined : await cachedUrl(t.id);
  if (blob) return { id: t.id, url: blob, kind: "cache", at: Date.now() };
  return { id: t.id, url: await temporaryLink(t.path, fresh), kind: "stream", at: Date.now() };
}

export const CHUNK = 256 * 1024;

// ID3v2 tag size at the start of an MP3 (0 if none). Needs the first 10 bytes.
export function id3Size(b: Uint8Array): number {
  if (b.length < 10 || b[0] !== 0x49 || b[1] !== 0x44 || b[2] !== 0x33) return 0;
  const size = ((b[6]! & 0x7f) << 21) | ((b[7]! & 0x7f) << 14) | ((b[8]! & 0x7f) << 7) | (b[9]! & 0x7f);
  return 10 + size + (b[5]! & 0x10 ? 10 : 0);
}

export interface Reader {
  kind: "cache" | "stream";
  start: number; // byte offset of the first byte `chunks` yields
  chunks: AsyncGenerator<Uint8Array>;
}

// The first n bytes over the network, without downloading more if Range is ignored.
async function firstBytes(t: Track, n: number, signal: AbortSignal): Promise<Uint8Array> {
  const body = (await download(t.path, signal, `bytes=0-${n - 1}`)).body!.getReader();
  const out = new Uint8Array(n);
  let got = 0;
  try {
    while (got < n) {
      const { done, value } = await body.read();
      if (done) break;
      const take = Math.min(n - got, value.length);
      out.set(value.subarray(0, take), got);
      got += take;
    }
  } finally {
    body.cancel().catch(() => {});
  }
  return out.subarray(0, got);
}

const headSizes = new Map<string, number>(); // id → ID3v2 size, learned once per track

// Bytes of the audio frames from roughly `at` seconds on (or from an exact byte,
// to resume after a dropped connection), for MediaSource.
// Drops ID3v2 at the start and an ID3v1 tag at the end, which would otherwise
// be fed to the decoder as junk between two tracks.
export async function openReader(t: Track, from: { at: number } | { byte: number }, signal: AbortSignal): Promise<Reader> {
  const blob = await cachedBlob(t.id);
  const size = blob?.size ?? t.size;
  let head = headSizes.get(t.id);
  if (head === undefined) {
    const first = blob ? new Uint8Array(await blob.slice(0, 10).arrayBuffer()) : await firstBytes(t, 10, signal);
    head = id3Size(first);
    headSizes.set(t.id, head);
  }
  const audioStart = Math.min(head, size);
  // VBR: a byte offset proportional to time lands within a second or two.
  let start: number;
  if ("byte" in from) start = Math.max(audioStart, Math.min(from.byte, size));
  else {
    const frac = t.duration > 0 ? Math.max(0, Math.min(0.999, from.at / t.duration)) : 0;
    start = audioStart + Math.floor(frac * (size - audioStart));
  }
  const trim = async function* (gen: AsyncGenerator<Uint8Array>): AsyncGenerator<Uint8Array> {
    // Hold back the last 128 bytes until the end, then drop them if they're an ID3v1 tag.
    let tail = new Uint8Array(0);
    for await (const c of gen) {
      const joined = new Uint8Array(tail.length + c.length);
      joined.set(tail);
      joined.set(c, tail.length);
      if (joined.length > 128) yield joined.subarray(0, joined.length - 128);
      tail = joined.subarray(Math.max(0, joined.length - 128));
    }
    const isV1 = tail.length === 128 && tail[0] === 0x54 && tail[1] === 0x41 && tail[2] === 0x47; // "TAG"
    if (!isV1 && tail.length) yield tail;
  };
  if (blob) {
    const gen = async function* () {
      for (let o = start; o < size; o += CHUNK) {
        if (signal.aborted) return;
        yield new Uint8Array(await blob.slice(o, Math.min(o + CHUNK, size)).arrayBuffer());
      }
    };
    return { kind: "cache", start, chunks: trim(gen()) };
  }
  const res = await download(t.path, signal, start > 0 ? `bytes=${start}-` : undefined);
  let skip = res.status === 206 ? 0 : start; // no range support: read and drop
  const body = res.body!.getReader();
  const gen = async function* () {
    try {
      for (;;) {
        const { done, value } = await body.read();
        if (done) return;
        if (skip >= value.length) {
          skip -= value.length;
          continue;
        }
        yield skip ? value.subarray(skip) : value;
        skip = 0;
      }
    } finally {
      body.cancel().catch(() => {});
    }
  };
  return { kind: "stream", start, chunks: trim(gen()) };
}
