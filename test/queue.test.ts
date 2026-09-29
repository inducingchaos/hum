import { describe, expect, test } from "bun:test";
import { Queue } from "@hum/core/queue";

const reverse = <T>(xs: T[]) => xs.slice().reverse();
const q = (order: string[], o: Partial<ConstructorParameters<typeof Queue>[0]> = {}) =>
  new Queue({ order, cursor: 0, shuffle: false, repeat: "off", ...o }, reverse);

describe("queue", () => {
  test("advance and back", () => {
    const x = q(["a", "b", "c"]);
    expect(x.advance(false)).toBe("b");
    expect(x.back()).toBe("a");
    expect(x.back()).toBe("a");
  });

  test("repeat off stops at the end", () => {
    const x = q(["a", "b"], { cursor: 1 });
    expect(x.autoNext()).toBeUndefined();
    expect(x.advance(true)).toBeUndefined();
    expect(x.current).toBe("b");
  });

  test("repeat one replays on auto-advance but a manual skip moves on", () => {
    const x = q(["a", "b"], { repeat: "one" });
    expect(x.autoNext()).toBe("a");
    expect(x.advance(true)).toBe("a");
    expect(x.advance(false)).toBe("b");
  });

  test("repeat all wraps (no shuffle)", () => {
    const x = q(["a", "b", "c"], { cursor: 2, repeat: "all" });
    expect(x.upcoming(2)).toEqual(["a", "b"]);
    expect(x.advance(true)).toBe("a");
  });

  test("repeat all + shuffle reshuffles and avoids an immediate repeat", () => {
    // reverse(["a","b","c"]) = c,b,a; c is current, so it is swapped to the end.
    const x = q(["a", "b", "c"], { cursor: 2, repeat: "all", shuffle: true });
    expect(x.upcoming(3)).toEqual(["a", "b", "c"]);
    expect(x.advance(true)).toBe("a");
    expect(x.order).toEqual(["a", "b", "c"]);
    expect(x.cursor).toBe(0);
  });

  test("setPool with shuffle puts the start id first", () => {
    const x = q([], { shuffle: true });
    x.setPool(["a", "b", "c", "d"], "b");
    expect(x.current).toBe("b");
    expect(x.order).toEqual(["b", "d", "c", "a"]);
  });

  test("setPool without shuffle starts at the given id", () => {
    const x = q([]);
    x.setPool(["a", "b", "c"], "c");
    expect(x.current).toBe("c");
    expect(x.cursor).toBe(2);
  });

  test("toggling shuffle keeps the current song", () => {
    const pool = ["a", "b", "c", "d"];
    const x = q(pool.slice(), { cursor: 2 });
    x.setShuffle(true, pool);
    expect(x.current).toBe("c");
    expect(x.order).toEqual(["c", "d", "b", "a"]);
    x.setShuffle(false, pool);
    expect(x.current).toBe("c");
    expect(x.cursor).toBe(2);
  });

  test("playNow inserts after the cursor and removes the old position", () => {
    const x = q(["a", "b", "c", "d"], { cursor: 1 });
    x.playNow("d");
    expect(x.order).toEqual(["a", "b", "d", "c"]);
    expect(x.current).toBe("d");
    x.playNow("a");
    expect(x.order).toEqual(["b", "d", "a", "c"]);
    expect(x.current).toBe("a");
    x.playNow("z");
    expect(x.current).toBe("z");
    expect(x.upcoming(5)).toEqual(["c"]);
  });

  test("repeat cycles off → all → one → off", () => {
    const x = q(["a"]);
    expect([x.cycleRepeat(), x.cycleRepeat(), x.cycleRepeat()]).toEqual(["all", "one", "off"]);
  });

  test("retain drops missing ids and keeps the cursor on the song", () => {
    const x = q(["a", "b", "c", "d"], { cursor: 2 });
    x.retain(new Set(["b", "c", "d"]));
    expect(x.current).toBe("c");
    expect(x.cursor).toBe(1);
  });
});
