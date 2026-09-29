// Folder filter. Port of packages/core/src/filter.ts: terms in different
// dimensions must all match, terms in the same dimension are alternatives.
// A term matches a folder name exactly, without hyphens, as one hyphen part,
// or as a unique prefix (ambiguous prefixes are errors, never guesses).
import Foundation

public enum TermKind: String, Codable, Sendable { case ok, ambiguous, none }

public struct TermResult: Equatable, Sendable {
  public var term: String
  public var kind: TermKind
  public var matches: [String]

  public init(term: String, kind: TermKind, matches: [String]) {
    self.term = term
    self.kind = kind
    self.matches = matches
  }
}

public struct ParsedFilter: Equatable, Sendable {
  public var terms: [TermResult]

  public init(terms: [TermResult]) {
    self.terms = terms
  }

  public var ok: Bool { terms.allSatisfy { $0.kind == .ok } }
  public static let empty = ParsedFilter(terms: [])
}

public let favTerm = "fav"
let favAliases: Set<String> = ["favs", "favorite", "favorites", "favourite", "favourites", "♥"]
let allWords: Set<String> = ["all", "everything", "*"]

public func vocabulary(_ tracks: [Track]) -> [String] {
  var v = Set([favTerm])
  for t in tracks { v.formUnion(t.dims) }
  return v.sorted()
}

public func resolveTerm(_ raw: String, _ vocab: [String]) -> TermResult {
  let term = raw.lowercased()
  if favAliases.contains(term) { return TermResult(term: term, kind: .ok, matches: [favTerm]) }
  if vocab.contains(term) { return TermResult(term: term, kind: .ok, matches: [term]) }
  let dehyphen = vocab.filter { $0.contains("-") && $0.replacingOccurrences(of: "-", with: "") == term }
  if !dehyphen.isEmpty { return TermResult(term: term, kind: .ok, matches: dehyphen) }
  let part = vocab.filter { $0.contains("-") && $0.split(separator: "-").map(String.init).contains(term) }
  if !part.isEmpty { return TermResult(term: term, kind: .ok, matches: part) }
  let prefix = vocab.filter { $0.hasPrefix(term) || $0.replacingOccurrences(of: "-", with: "").hasPrefix(term) }
  if prefix.count == 1 { return TermResult(term: term, kind: .ok, matches: prefix) }
  if prefix.count > 1 { return TermResult(term: term, kind: .ambiguous, matches: prefix) }
  return TermResult(term: term, kind: .none, matches: [])
}

public func parseFilter(_ query: String, _ vocab: [String]) -> ParsedFilter {
  let words = query.split(whereSeparator: \.isWhitespace).map(String.init).filter { !allWords.contains($0.lowercased()) }
  return ParsedFilter(terms: words.map { resolveTerm($0, vocab) })
}

// Which dimension each folder name lives in (first seen wins).
public func dimensions(_ tracks: [Track]) -> [String: Int] {
  var dims: [String: Int] = [:]
  for t in tracks { for (i, s) in t.dims.enumerated() where dims[s] == nil { dims[s] = i } }
  return dims
}

func groupTerms(_ f: ParsedFilter, _ dims: [String: Int]) -> [[String]] {
  var keys: [String] = []
  var groups: [String: [String]] = [:]
  for term in f.terms {
    for m in term.matches {
      let k = m == favTerm ? favTerm : dims[m].map(String.init) ?? "?\(m)"
      if groups[k] == nil { keys.append(k) }
      groups[k, default: []].append(m)
    }
  }
  return keys.map { groups[$0]! }
}

public func matches(_ t: Track, _ f: ParsedFilter, isFav: (Track) -> Bool = { _ in false }, dims: [String: Int]? = nil) -> Bool {
  func hit(_ m: String) -> Bool { m == favTerm ? isFav(t) : t.dims.contains(m) }
  guard let dims else { return f.terms.allSatisfy { $0.matches.contains(where: hit) } }
  return groupTerms(f, dims).allSatisfy { $0.contains(where: hit) }
}

public func applyFilter(_ tracks: [Track], _ f: ParsedFilter, isFav: (Track) -> Bool = { _ in false }) -> [Track] {
  if f.terms.isEmpty { return tracks }
  let dims = dimensions(tracks)
  return tracks.filter { matches($0, f, isFav: isFav, dims: dims) }
}

public func usesFav(_ f: ParsedFilter) -> Bool {
  f.terms.contains { $0.kind == .ok && $0.matches.contains(favTerm) }
}

// Tab completion of the last term: the unique match (+ space) or the longest common prefix.
public func complete(_ query: String, _ vocab: [String]) -> String {
  let lastStart = query.lastIndex(where: \.isWhitespace).map { query.index(after: $0) } ?? query.startIndex
  let last = query[lastStart...].lowercased()
  if last.isEmpty { return query }
  let hits = vocab.filter { $0.hasPrefix(last) }
  if hits.isEmpty { return query }
  let head = String(query[..<lastStart])
  if hits.count == 1 { return head + hits[0] + " " }
  var lcp = hits[0]
  for h in hits { while !h.hasPrefix(lcp) { lcp.removeLast() } }
  return head + lcp
}

// Canonical form shown in the UI.
public func describe(_ f: ParsedFilter) -> String {
  f.terms.map { $0.matches.count == 1 ? $0.matches[0] : $0.term }.joined(separator: " ")
}
