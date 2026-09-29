// Read-only Dropbox client (plan-ios §4). Same rules as the CLI and the PWA: an
// endpoint allowlist on top of a token that only has files.metadata.read +
// files.content.read. The refresh token is in the Keychain and never logged.
import CryptoKit
import Foundation
import HumCore
import Security

enum DropboxError: Error, CustomStringConvertible {
  case auth(String)
  case network(String)
  case http(String, Int, String)

  var description: String {
    switch self {
    case .auth(let m): "auth: \(m)"
    case .network(let m): "network: \(m)"
    case .http(let what, let code, let body): "\(what) \(code): \(body)"
    }
  }
}

nonisolated struct ListEntry: Decodable, Sendable {
  let tag: String
  let name: String
  let pathLower: String
  let size: Int?

  enum CodingKeys: String, CodingKey {
    case tag = ".tag"
    case name
    case pathLower = "path_lower"
    case size
  }
}

nonisolated struct PKCE: Codable, Sendable {
  let verifier: String
  let state: String
  let redirect: Bool

  static func make(redirect: Bool) -> PKCE {
    PKCE(verifier: randomString(48), state: randomString(12), redirect: redirect)
  }

  var challenge: String { b64url(Data(SHA256.hash(data: Data(verifier.utf8)))) }

  static func randomString(_ n: Int) -> String {
    var bytes = [UInt8](repeating: 0, count: n)
    _ = SecRandomCopyBytes(kSecRandomDefault, n, &bytes)
    return b64url(Data(bytes))
  }
}

nonisolated func b64url(_ d: Data) -> String {
  d.base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_")
    .replacingOccurrences(of: "=", with: "")
}

final class Dropbox {
  // Dropbox's mobile redirect scheme for this app key.
  static let callbackScheme = "db-\(appKey)"
  static let redirectURI = "\(callbackScheme)://2/token"
  private static let refreshKey = "dropbox.refresh"
  private static let rpcAllowed: Set<String> = [
    "files/list_folder", "files/list_folder/continue", "files/get_temporary_link", "users/get_current_account",
  ]
  private static let contentAllowed: Set<String> = ["files/download", "files/download_zip"]

  private var access: (token: String, expires: Date)?
  private var refreshing: Task<String, Error>?
  private var links: [String: (url: URL, expires: Date)] = [:]
  private let session: URLSession

  init() {
    let cfg = URLSessionConfiguration.default
    cfg.waitsForConnectivity = false
    cfg.timeoutIntervalForRequest = 30
    session = URLSession(configuration: cfg)
  }

  var signedIn: Bool { Keychain.get(Self.refreshKey) != nil }

  // ── Sign-in ────────────────────────────────────────────────────────────────

  func authorizeURL(_ p: PKCE) -> URL {
    var c = URLComponents(string: "https://www.dropbox.com/oauth2/authorize")!
    var q = [
      URLQueryItem(name: "client_id", value: appKey),
      URLQueryItem(name: "response_type", value: "code"),
      URLQueryItem(name: "code_challenge", value: p.challenge),
      URLQueryItem(name: "code_challenge_method", value: "S256"),
      URLQueryItem(name: "token_access_type", value: "offline"),
    ]
    if p.redirect {
      q.append(URLQueryItem(name: "redirect_uri", value: Self.redirectURI))
      q.append(URLQueryItem(name: "state", value: p.state))
    }
    c.queryItems = q
    return c.url!
  }

  // The callback URL from the web sign-in: db-<key>://2/token?code=…&state=…
  func finish(callback: URL, pkce: PKCE) async throws -> String? {
    let items = URLComponents(url: callback, resolvingAgainstBaseURL: false)?.queryItems ?? []
    if let err = items.first(where: { $0.name == "error" })?.value {
      throw DropboxError.auth(items.first { $0.name == "error_description" }?.value ?? err)
    }
    guard let code = items.first(where: { $0.name == "code" })?.value else { throw DropboxError.auth("no code in the callback") }
    guard items.first(where: { $0.name == "state" })?.value == pkce.state else { throw DropboxError.auth("sign-in state mismatch: start again") }
    return try await finish(code: code, pkce: pkce)
  }

  // Returns the account's display name (cosmetic).
  func finish(code: String, pkce: PKCE) async throws -> String? {
    var params = ["grant_type": "authorization_code", "code": code.trimmingCharacters(in: .whitespacesAndNewlines), "code_verifier": pkce.verifier]
    if pkce.redirect { params["redirect_uri"] = Self.redirectURI }
    let t = try await oauth(params)
    guard let refresh = t["refresh_token"] as? String else { throw DropboxError.auth("no refresh token") }
    Keychain.set(Self.refreshKey, refresh)
    setAccess(t)
    struct Account: Decodable {
      struct Name: Decodable { let display_name: String }
      let name: Name
    }
    let account: Account? = try? await rpc("users/get_current_account", nil)
    return account?.name.display_name
  }

  func signOut() {
    Keychain.delete(Self.refreshKey)
    access = nil
    links = [:]
  }

  // ── Tokens ─────────────────────────────────────────────────────────────────

  private func setAccess(_ t: [String: Any]) {
    if let tok = t["access_token"] as? String {
      let secs = (t["expires_in"] as? Double) ?? Double((t["expires_in"] as? Int) ?? 14_400)
      access = (tok, Date().addingTimeInterval(secs))
    }
  }

  private func oauth(_ params: [String: String]) async throws -> [String: Any] {
    var req = URLRequest(url: URL(string: "https://api.dropboxapi.com/oauth2/token")!)
    req.httpMethod = "POST"
    req.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
    var c = URLComponents()
    c.queryItems = (params.merging(["client_id": appKey]) { a, _ in a }).map { URLQueryItem(name: $0.key, value: $0.value) }
    req.httpBody = Data((c.percentEncodedQuery ?? "").replacingOccurrences(of: "+", with: "%2B").utf8)
    let (data, res) = try await send(req)
    let body = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
    if res.statusCode == 400 || res.statusCode == 401 {
      throw DropboxError.auth((body["error_description"] as? String) ?? (body["error"] as? String) ?? "auth failed")
    }
    guard res.statusCode == 200 else { throw DropboxError.http("oauth", res.statusCode, "") }
    return body
  }

  func accessToken() async throws -> String {
    if let a = access, a.expires > Date().addingTimeInterval(60) { return a.token }
    if let r = refreshing { return try await r.value }
    let task = Task { () throws -> String in
      defer { refreshing = nil }
      guard let refresh = Keychain.get(Self.refreshKey) else { throw DropboxError.auth("signed out") }
      let t = try await oauth(["grant_type": "refresh_token", "refresh_token": refresh])
      setAccess(t)
      guard let a = access else { throw DropboxError.auth("no access token") }
      return a.token
    }
    refreshing = task
    return try await task.value
  }

  private func send(_ req: URLRequest) async throws -> (Data, HTTPURLResponse) {
    do {
      let (data, res) = try await session.data(for: req)
      return (data, res as! HTTPURLResponse)
    } catch let e as URLError where e.code != .cancelled {
      throw DropboxError.network(e.localizedDescription)
    }
  }

  private func check(_ data: Data, _ res: HTTPURLResponse, _ what: String) throws {
    if res.statusCode == 401 {
      access = nil
      throw DropboxError.auth("\(what) 401")
    }
    guard (200..<300).contains(res.statusCode) else {
      throw DropboxError.http(what, res.statusCode, String(decoding: data.prefix(200), as: UTF8.self))
    }
  }

  // ── Endpoints ──────────────────────────────────────────────────────────────

  func rpc<T: Decodable>(_ endpoint: String, _ args: [String: Any]?) async throws -> T {
    precondition(Self.rpcAllowed.contains(endpoint), "blocked non-read-only endpoint: \(endpoint)")
    var req = URLRequest(url: URL(string: "https://api.dropboxapi.com/2/\(endpoint)")!)
    req.httpMethod = "POST"
    req.setValue("Bearer \(try await accessToken())", forHTTPHeaderField: "Authorization")
    if let args {
      req.setValue("application/json", forHTTPHeaderField: "Content-Type")
      req.httpBody = try JSONSerialization.data(withJSONObject: args)
    }
    let (data, res) = try await send(req)
    try check(data, res, endpoint)
    return try JSONDecoder().decode(T.self, from: data)
  }

  // Dropbox-API-Arg must be ASCII: escape everything else as \uXXXX.
  nonisolated static func apiArg(_ path: String) -> String {
    let json = String(decoding: (try? JSONSerialization.data(withJSONObject: ["path": path], options: [.withoutEscapingSlashes])) ?? Data(), as: UTF8.self)
    var out = ""
    for u in json.utf16 {
      if u < 0x7F { out.unicodeScalars.append(Unicode.Scalar(u)!) } else { out += String(format: "\\u%04x", u) }
    }
    return out
  }

  private func contentRequest(_ endpoint: String, _ path: String) async throws -> URLRequest {
    precondition(Self.contentAllowed.contains(endpoint), "blocked non-read-only endpoint: \(endpoint)")
    var req = URLRequest(url: URL(string: "https://content.dropboxapi.com/2/\(endpoint)")!)
    req.httpMethod = "POST"
    req.timeoutInterval = 120
    req.setValue("Bearer \(try await accessToken())", forHTTPHeaderField: "Authorization")
    req.setValue(Self.apiArg(path), forHTTPHeaderField: "Dropbox-API-Arg")
    return req
  }

  func downloadData(_ path: String) async throws -> Data {
    let (data, res) = try await send(try await contentRequest("files/download", path))
    try check(data, res, "files/download")
    return data
  }

  func downloadZip(_ path: String) async throws -> Data {
    var req = try await contentRequest("files/download_zip", path)
    req.timeoutInterval = 300
    let (data, res) = try await send(req)
    try check(data, res, "files/download_zip")
    return data
  }

  // Whole file to a temporary location; the caller moves it.
  func download(_ path: String) async throws -> URL {
    let req = try await contentRequest("files/download", path)
    let result: (URL, URLResponse)
    do {
      result = try await session.download(for: req)
    } catch let e as URLError where e.code != .cancelled {
      throw DropboxError.network(e.localizedDescription)
    }
    let (tmp, res) = result
    let http = res as! HTTPURLResponse
    if !(200..<300).contains(http.statusCode) {
      let body = (try? Data(contentsOf: tmp)) ?? Data()
      try check(body, http, "files/download")
    }
    return tmp
  }

  // Temporary links last 4 h; reuse them for 3.5 h.
  func temporaryLink(_ path: String) async throws -> URL {
    if let hit = links[path], hit.expires > Date() { return hit.url }
    struct Link: Decodable { let link: String }
    let l: Link = try await rpc("files/get_temporary_link", ["path": path])
    guard let url = URL(string: l.link) else { throw DropboxError.http("get_temporary_link", 200, "bad link") }
    links[path] = (url, Date().addingTimeInterval(3.5 * 3600))
    return url
  }

  struct Page: Decodable {
    let entries: [ListEntry]
    let cursor: String
    let has_more: Bool
  }

  func listAll(path: String? = nil, cursor: String? = nil, onPage: ((Int) -> Void)? = nil) async throws -> (entries: [ListEntry], cursor: String) {
    var page: Page
    if let cursor {
      page = try await rpc("files/list_folder/continue", ["cursor": cursor])
    } else {
      page = try await rpc("files/list_folder", ["path": path ?? "", "recursive": true, "limit": 2000])
    }
    var all = page.entries
    onPage?(all.count)
    while page.has_more {
      page = try await rpc("files/list_folder/continue", ["cursor": page.cursor])
      all += page.entries
      onPage?(all.count)
    }
    return (all, page.cursor)
  }
}
