// Minimal zip reader for Dropbox's download_zip (the metadata folder): central
// directory + stored or raw-DEFLATE entries, via the Compression framework.
// No zip64 (the metadata zip is a few MB); such entries are skipped.
import Compression
import Foundation

nonisolated enum Zip {
  struct Failure: Error, CustomStringConvertible {
    let description: String
  }

  static func entries(_ data: Data) throws -> [(name: String, data: Data)] {
    let bytes = [UInt8](data)
    func u16(_ o: Int) -> Int { o + 2 <= bytes.count ? Int(bytes[o]) | Int(bytes[o + 1]) << 8 : 0 }
    func u32(_ o: Int) -> Int { o + 4 <= bytes.count ? u16(o) | u16(o + 2) << 16 : 0 }

    // End of central directory: last 22+ bytes, signature PK\5\6.
    var eocd = -1
    var i = bytes.count - 22
    let stop = max(0, bytes.count - 22 - 65_535)
    while i >= stop {
      if bytes[i] == 0x50, bytes[i + 1] == 0x4B, bytes[i + 2] == 0x05, bytes[i + 3] == 0x06 {
        eocd = i
        break
      }
      i -= 1
    }
    guard eocd >= 0 else { throw Failure(description: "zip: no end of central directory") }
    let count = u16(eocd + 10)
    var p = u32(eocd + 16)
    var out: [(String, Data)] = []
    for _ in 0..<count {
      guard u32(p) == 0x0201_4B50 else { throw Failure(description: "zip: bad central directory") }
      let method = u16(p + 10)
      let compSize = u32(p + 20)
      let size = u32(p + 24)
      let nameLen = u16(p + 28)
      let extraLen = u16(p + 30)
      let commentLen = u16(p + 32)
      let local = u32(p + 42)
      let name = String(decoding: bytes[(p + 46)..<(p + 46 + nameLen)], as: UTF8.self)
      p += 46 + nameLen + extraLen + commentLen
      if name.hasSuffix("/") || compSize == 0xFFFF_FFFF || size == 0xFFFF_FFFF { continue }
      guard u32(local) == 0x0403_4B50 else { continue }
      let start = local + 30 + u16(local + 26) + u16(local + 28)
      guard start + compSize <= bytes.count else { continue }
      let raw = bytes[start..<(start + compSize)]
      switch method {
      case 0:
        out.append((name, Data(raw)))
      case 8:
        if let d = inflate(Array(raw), size: size) { out.append((name, d)) }
      default:
        continue
      }
    }
    return out
  }

  static func inflate(_ src: [UInt8], size: Int) -> Data? {
    if size == 0 { return Data() }
    var dst = [UInt8](repeating: 0, count: size)
    let n = src.withUnsafeBufferPointer { s in
      dst.withUnsafeMutableBufferPointer { d in
        compression_decode_buffer(d.baseAddress!, size, s.baseAddress!, src.count, nil, COMPRESSION_ZLIB)
      }
    }
    return n == size ? Data(dst) : nil
  }
}
