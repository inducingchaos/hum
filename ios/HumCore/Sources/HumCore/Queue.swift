// The play queue: song ids + a cursor. Port of packages/core/src/queue.ts.
import Foundation

public enum Repeat: String, Codable, Sendable { case off, all, one }

public struct QueueSnapshot: Codable, Equatable, Sendable {
  public var order: [String]
  public var cursor: Int
  public var shuffle: Bool
  public var `repeat`: Repeat

  public init(order: [String], cursor: Int, shuffle: Bool, repeat: Repeat) {
    self.order = order
    self.cursor = cursor
    self.shuffle = shuffle
    self.repeat = `repeat`
  }
}

public struct Queue: Sendable {
  public private(set) var order: [String]
  public private(set) var cursor: Int
  public private(set) var shuffle: Bool
  public private(set) var `repeat`: Repeat
  // Under repeat-all + shuffle, the next pass's order, fixed early so prefetch can see it.
  private var pending: [String]?
  private let rng: @Sendable ([String]) -> [String]

  public init(_ s: QueueSnapshot, rng: @escaping @Sendable ([String]) -> [String] = { $0.shuffled() }) {
    order = s.order
    cursor = min(max(0, s.cursor), max(0, s.order.count - 1))
    shuffle = s.shuffle
    self.repeat = s.repeat
    self.rng = rng
  }

  public var snapshot: QueueSnapshot { QueueSnapshot(order: order, cursor: cursor, shuffle: shuffle, repeat: self.repeat) }
  public var current: String? { order.indices.contains(cursor) ? order[cursor] : nil }
  public var atEnd: Bool { cursor >= order.count - 1 }

  public mutating func setPool(_ pool: [String], startId: String? = nil) {
    pending = nil
    order = shuffle ? rng(pool) : pool
    cursor = 0
    if let startId, let i = order.firstIndex(of: startId) {
      if shuffle, i > 0 { order.insert(order.remove(at: i), at: 0) } else { cursor = i }
    }
  }

  public mutating func setShuffle(_ on: Bool, pool: [String]) {
    shuffle = on
    pending = nil
    let cur = current
    if on {
      order = cur.map { c in [c] + rng(pool.filter { $0 != c }) } ?? rng(pool)
      cursor = 0
    } else {
      order = pool
      cursor = cur.flatMap { order.firstIndex(of: $0) } ?? 0
    }
  }

  @discardableResult
  public mutating func cycleRepeat() -> Repeat {
    self.repeat = self.repeat == .off ? .all : self.repeat == .all ? .one : .off
    return self.repeat
  }

  private mutating func nextPass() -> [String] {
    if !shuffle { return order }
    if pending == nil {
      var p = rng(order)
      if p.count > 1, p[0] == current { p.swapAt(0, p.count - 1) }
      pending = p
    }
    return pending!
  }

  public mutating func upcoming(_ n: Int) -> [String] {
    var out = Array(order.dropFirst(cursor + 1).prefix(n))
    if out.count < n, self.repeat == .all, !order.isEmpty {
      let pass = nextPass()
      for id in pass where out.count < n { out.append(id) }
    }
    return out
  }

  public mutating func autoNext() -> String? {
    if self.repeat == .one { return current }
    return upcoming(1).first
  }

  @discardableResult
  public mutating func advance(auto: Bool) -> String? {
    if auto, self.repeat == .one { return current }
    if cursor + 1 < order.count {
      cursor += 1
      return current
    }
    if self.repeat != .all || order.isEmpty { return nil }
    order = nextPass()
    pending = nil
    cursor = 0
    return current
  }

  @discardableResult
  public mutating func back() -> String? {
    if cursor > 0 { cursor -= 1 }
    return current
  }

  @discardableResult
  public mutating func jumpTo(_ index: Int) -> String? {
    if order.indices.contains(index) { cursor = index }
    return current
  }

  public mutating func playNow(_ id: String) {
    pending = nil
    let i = order.firstIndex(of: id)
    if i == cursor, i != nil { return }
    if let i {
      order.remove(at: i)
      if i < cursor { cursor -= 1 }
    }
    if order.isEmpty {
      order = [id]
      cursor = 0
      return
    }
    order.insert(id, at: cursor + 1)
    cursor += 1
  }

  public mutating func retain(_ valid: Set<String>) {
    let cur = current
    order = order.filter { valid.contains($0) }
    if let cur, let i = order.firstIndex(of: cur) { cursor = i } else { cursor = min(cursor, max(0, order.count - 1)) }
    pending = nil
  }
}
