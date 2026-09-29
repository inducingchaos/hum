// Where audio and art come from: Dropbox, or the demo library (Simulator, CI).
import Foundation
import HumCore
import UIKit

protocol TrackSource: AnyObject {
  // The whole file, at a temporary URL the caller moves.
  func download(_ t: Track) async throws -> URL
  // A URL AVPlayer can stream right away.
  func streamURL(_ t: Track) async throws -> URL
  func art(_ t: Track, size: Int) async -> UIImage?
}

final class DropboxSource: TrackSource {
  let dropbox: Dropbox
  let profile: Profile

  init(dropbox: Dropbox, profile: Profile) {
    self.dropbox = dropbox
    self.profile = profile
  }

  func download(_ t: Track) async throws -> URL { try await dropbox.download(t.path) }
  func streamURL(_ t: Track) async throws -> URL { try await dropbox.temporaryLink(t.path) }

  func art(_ t: Track, size: Int) async -> UIImage? {
    guard let s = t.image, let url = artURL(s, query: profile.artQuery, size: size) else { return nil }
    var req = URLRequest(url: url)
    req.timeoutInterval = 15
    guard let (data, res) = try? await URLSession.shared.data(for: req), (res as? HTTPURLResponse)?.statusCode == 200 else { return nil }
    return UIImage(data: data)
  }
}
