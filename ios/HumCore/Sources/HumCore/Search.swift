// Search over name and tags. Port of packages/core/src/search.ts.
// Per term: name prefix > name word > name substring > exact tag > tag substring.
import Foundation

func termScore(_ term: String, _ name: String, _ tags: [String]) -> Int {
  if name.hasPrefix(term) { return 50 }
  if name.split(whereSeparator: { " -'".contains($0) }).contains(where: { $0.hasPrefix(term) }) { return 40 }
  if name.contains(term) { return 30 }
  if tags.contains(term) { return 20 }
  if tags.contains(where: { $0.contains(term) }) { return 10 }
  return 0
}

public func search(_ tracks: [Track], _ query: String, limit: Int = 200) -> [Track] {
  let terms = query.lowercased().split(whereSeparator: \.isWhitespace).map(String.init)
  if terms.isEmpty { return [] }
  var scored: [(Track, Int)] = []
  for t in tracks {
    let name = t.name.lowercased()
    let tags = t.tags.map { $0.lowercased() }
    var total = 0
    for term in terms {
      let s = termScore(term, name, tags)
      if s == 0 {
        total = 0
        break
      }
      total += s
    }
    if total > 0 { scored.append((t, total)) }
  }
  scored.sort { a, b in
    if a.1 != b.1 { return a.1 > b.1 }
    if a.0.name.count != b.0.name.count { return a.0.name.count < b.0.name.count }
    return localeLess(a.0.name, b.0.name)
  }
  return scored.prefix(limit).map(\.0)
}
