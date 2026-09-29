// Minimal zip reader for Dropbox's download_zip: central directory + stored or
// raw-DEFLATE entries (node:zlib). No zip64; the metadata zip is a few MB.
// Same logic as the iOS app's Zip.swift.
import { inflateRawSync } from "node:zlib";

export function unzip(buf: Uint8Array): { name: string; data: Uint8Array }[] {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const u16 = (o: number) => dv.getUint16(o, true);
  const u32 = (o: number) => dv.getUint32(o, true);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65_535); i--) {
    if (u32(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("zip: no end of central directory");
  const count = u16(eocd + 10);
  let p = u32(eocd + 16);
  const out: { name: string; data: Uint8Array }[] = [];
  const dec = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (u32(p) !== 0x02014b50) throw new Error("zip: bad central directory");
    const method = u16(p + 10);
    const compSize = u32(p + 20);
    const size = u32(p + 24);
    const nameLen = u16(p + 28);
    const local = u32(p + 42);
    const name = dec.decode(buf.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + u16(p + 30) + u16(p + 32);
    if (name.endsWith("/") || compSize === 0xffffffff || u32(local) !== 0x04034b50) continue;
    const start = local + 30 + u16(local + 26) + u16(local + 28);
    const raw = buf.subarray(start, start + compSize);
    if (method === 0) out.push({ name, data: raw });
    else if (method === 8) {
      const data = new Uint8Array(inflateRawSync(raw));
      if (data.length === size) out.push({ name, data });
    }
  }
  return out;
}
