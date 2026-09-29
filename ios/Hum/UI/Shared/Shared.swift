// Bits both looks use.
import AVKit
import HumCore
import SwiftUI

// Wrapping row of chips (filter sheet).
struct FlowLayout: Layout {
  var spacing: CGFloat = 8
  var lineSpacing: CGFloat = 8

  func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
    let width = proposal.width ?? .infinity
    var x: CGFloat = 0, y: CGFloat = 0, line: CGFloat = 0, widest: CGFloat = 0
    for v in subviews {
      let s = v.sizeThatFits(.unspecified)
      if x > 0, x + s.width > width {
        y += line + lineSpacing
        x = 0
        line = 0
      }
      x += s.width + spacing
      line = max(line, s.height)
      widest = max(widest, x - spacing)
    }
    return CGSize(width: proposal.width ?? widest, height: y + line)
  }

  func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
    var x = bounds.minX, y = bounds.minY, line: CGFloat = 0
    for v in subviews {
      let s = v.sizeThatFits(.unspecified)
      if x > bounds.minX, x + s.width > bounds.maxX {
        y += line + lineSpacing
        x = bounds.minX
        line = 0
      }
      v.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(s))
      x += s.width + spacing
      line = max(line, s.height)
    }
  }
}

// AirPlay / Bluetooth route picker.
struct RoutePicker: UIViewRepresentable {
  var tint: UIColor = .label

  func makeUIView(context: Context) -> AVRoutePickerView {
    let v = AVRoutePickerView()
    v.prioritizesVideoDevices = false
    v.tintColor = tint
    v.activeTintColor = UIColor(red: 1, green: 0.5, blue: 0, alpha: 1)
    return v
  }

  func updateUIView(_ v: AVRoutePickerView, context: Context) {
    v.tintColor = tint
  }
}

// The filter editor's draft: words toggled by chips or typed.
enum Draft {
  static func words(_ s: String) -> [String] { s.split(whereSeparator: \.isWhitespace).map(String.init) }

  static func toggle(_ term: String, in s: String) -> String {
    let w = words(s)
    return (w.contains(term) ? w.filter { $0 != term } : w + [term]).joined(separator: " ")
  }
}

// Cache mark for a row: ● cached, ◐ downloading, ○ not yet.
enum Mark {
  static func of(_ id: String, _ p: PlayerModel) -> String {
    p.cache.cachedIds.contains(id) ? "●" : p.cache.downloading == id ? "◐" : "○"
  }
}

extension PlayerModel {
  // The rolling list: up to 3 played (oldest first), and what's next.
  var playedRecent: [String] {
    let cur = queue.current
    return Array(history.filter { $0 != cur }.suffix(3))
  }

  func upNext(_ n: Int) -> [String] { Array(upcoming.prefix(n)) }

  var statusText: String { playing ? (buffering ? "Loading" : "Playing") : "Paused" }
  var repeatLabel: String { queue.repeat == .one ? "Repeat one" : "Repeat" }
}

@MainActor let haptic = UIImpactFeedbackGenerator(style: .light)
