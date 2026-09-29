// Event log (the PWA's SYS log): what the player did while locked or in the
// background, for the owner to read and copy. Never logs tokens or links.
import Foundation
import Observation
import UIKit

nonisolated struct LogLine: Codable, Hashable, Sendable {
  var t: Date
  var bg: Bool
  var msg: String
}

@Observable final class EventLog {
  static let shared = EventLog()
  private(set) var lines: [LogLine] = []
  private let max = 500
  private var saveTask: Task<Void, Never>?

  private init() {
    lines = Store.read([LogLine].self, "log.json") ?? []
  }

  func add(_ msg: String) {
    let bg = UIApplication.shared.applicationState != .active
    lines.append(LogLine(t: Date(), bg: bg, msg: msg))
    if lines.count > max { lines.removeFirst(lines.count - max) }
    #if DEBUG
      print("[hum]", msg)
    #endif
    saveTask?.cancel()
    // In the background the app can be suspended any moment: write through.
    let delay: Duration = bg ? .zero : .seconds(1)
    saveTask = Task {
      try? await Task.sleep(for: delay)
      guard !Task.isCancelled else { return }
      Store.write(self.lines, "log.json")
    }
  }

  func clear() {
    lines = []
    Store.write(lines, "log.json")
  }

  static func clock(_ d: Date) -> String {
    let c = Calendar.current.dateComponents([.hour, .minute, .second], from: d)
    return String(format: "%02d:%02d:%02d", c.hour ?? 0, c.minute ?? 0, c.second ?? 0)
  }

  var text: String {
    lines.map { "\(Self.clock($0.t))\($0.bg ? " [bg]" : "") \($0.msg)" }.joined(separator: "\n")
  }
}

func log(_ msg: String) {
  EventLog.shared.add(msg)
}
