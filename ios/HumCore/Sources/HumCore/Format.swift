// Display helpers. Port of packages/core/src/format.ts and art.ts.
import Foundation

public func plural(_ n: Int, _ word: String) -> String {
  "\(n.formatted(.number.locale(Locale(identifier: "en_US")))) \(word)\(n == 1 ? "" : "s")"
}

public func fmtTime(_ sec: Double) -> String {
  let s = sec.isFinite && sec > 0 ? Int(sec) : 0
  let h = s / 3600, m = (s % 3600) / 60, ss = s % 60
  return h > 0 ? String(format: "%d:%02d:%02d", h, m, ss) : String(format: "%d:%02d", m, ss)
}

public func fmtBytes(_ n: Int64) -> String {
  if n >= 1_000_000_000 { return String(format: "%.1f GB", Double(n) / 1e9) }
  if n >= 1_000_000 { return "\(Int((Double(n) / 1e6).rounded())) MB" }
  return "\(Int((Double(n) / 1e3).rounded())) KB"
}

// The metadata image URL plus the profile's query; "{size}" becomes the size.
public func artURL(_ url: String, query: String?, size: Int = 600) -> URL? {
  guard var c = URLComponents(string: url) else { return nil }
  guard let query, !query.isEmpty else { return c.url }
  let extra = URLComponents(string: "?" + query.replacingOccurrences(of: "{size}", with: String(size)))?.queryItems ?? []
  var items = c.queryItems ?? []
  for e in extra {
    if let i = items.firstIndex(where: { $0.name == e.name }) { items[i] = e } else { items.append(e) }
  }
  c.queryItems = items
  return c.url
}
