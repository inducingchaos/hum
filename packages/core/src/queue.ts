// The play queue: an ordered list of song ids plus a cursor. Pure logic, no I/O.
import { shuffle as shuffled } from "./shuffle.ts";

export type Repeat = "off" | "all" | "one";

export interface QueueSnapshot {
  order: string[];
  cursor: number;
  shuffle: boolean;
  repeat: Repeat;
}

export class Queue {
  order: string[];
  cursor: number;
  shuffle: boolean;
  repeat: Repeat;
  // Under repeat-all + shuffle, the next pass's order, fixed early so prefetch can see it.
  private pending?: string[];

  constructor(s: QueueSnapshot, private rng: <T>(xs: T[]) => T[] = shuffled) {
    this.order = s.order;
    this.cursor = Math.min(Math.max(0, s.cursor), Math.max(0, s.order.length - 1));
    this.shuffle = s.shuffle;
    this.repeat = s.repeat;
  }

  snapshot(): QueueSnapshot {
    return { order: this.order, cursor: this.cursor, shuffle: this.shuffle, repeat: this.repeat };
  }

  get current(): string | undefined {
    return this.order[this.cursor];
  }

  get atEnd(): boolean {
    return this.cursor >= this.order.length - 1;
  }

  // Replace the queue with a new pool (ids in path order), e.g. a new filter.
  setPool(pool: string[], startId?: string): void {
    this.pending = undefined;
    this.order = this.shuffle ? this.rng(pool) : pool.slice();
    this.cursor = 0;
    if (startId) {
      const i = this.order.indexOf(startId);
      if (this.shuffle && i > 0) this.order.unshift(...this.order.splice(i, 1));
      else if (i >= 0) this.cursor = i;
    }
  }

  // Shuffle on: current stays, the rest is shuffled after it. Off: path order, cursor on current.
  setShuffle(on: boolean, pool: string[]): void {
    this.shuffle = on;
    this.pending = undefined;
    const cur = this.current;
    if (on) {
      this.order = cur ? [cur, ...this.rng(pool.filter((id) => id !== cur))] : this.rng(pool);
      this.cursor = 0;
    } else {
      this.order = pool.slice();
      this.cursor = cur ? Math.max(0, this.order.indexOf(cur)) : 0;
    }
  }

  cycleRepeat(): Repeat {
    this.repeat = this.repeat === "off" ? "all" : this.repeat === "all" ? "one" : "off";
    return this.repeat;
  }

  private nextPass(): string[] {
    if (!this.shuffle) return this.order;
    if (!this.pending) {
      const p = this.rng(this.order);
      // Don't play the same song twice in a row across the boundary.
      if (p.length > 1 && p[0] === this.current) [p[0], p[p.length - 1]] = [p[p.length - 1]!, p[0]!];
      this.pending = p;
    }
    return this.pending;
  }

  // Ids after the current one, in play order, following repeat-all wraparound.
  upcoming(n: number): string[] {
    const out = this.order.slice(this.cursor + 1, this.cursor + 1 + n);
    if (out.length < n && this.repeat === "all" && this.order.length) {
      const pass = this.nextPass();
      for (let i = 0; out.length < n && i < pass.length; i++) out.push(pass[i]!);
    }
    return out;
  }

  // What plays when the current track ends on its own.
  autoNext(): string | undefined {
    if (this.repeat === "one") return this.current;
    return this.upcoming(1)[0];
  }

  // Move forward. `auto` = the track ended by itself (repeat-one replays it).
  advance(auto: boolean): string | undefined {
    if (auto && this.repeat === "one") return this.current;
    if (this.cursor + 1 < this.order.length) {
      this.cursor++;
      return this.current;
    }
    if (this.repeat !== "all" || !this.order.length) return undefined;
    this.order = this.nextPass().slice();
    this.pending = undefined;
    this.cursor = 0;
    return this.current;
  }

  back(): string | undefined {
    if (this.cursor > 0) this.cursor--;
    return this.current;
  }

  jumpTo(index: number): string | undefined {
    if (index >= 0 && index < this.order.length) this.cursor = index;
    return this.current;
  }

  // Play a song right now (search pick). The rest of the queue continues after it.
  playNow(id: string): void {
    this.pending = undefined;
    const i = this.order.indexOf(id);
    if (i === this.cursor) return;
    if (i >= 0) {
      this.order.splice(i, 1);
      if (i < this.cursor) this.cursor--;
    }
    if (!this.order.length) {
      this.order = [id];
      this.cursor = 0;
      return;
    }
    this.order.splice(this.cursor + 1, 0, id);
    this.cursor++;
  }

  // Drop ids that no longer exist (library delta). Keeps the cursor on the same song if possible.
  retain(valid: Set<string>): void {
    const cur = this.current;
    this.order = this.order.filter((id) => valid.has(id));
    const i = cur ? this.order.indexOf(cur) : -1;
    this.cursor = i >= 0 ? i : Math.min(this.cursor, Math.max(0, this.order.length - 1));
    this.pending = undefined;
  }
}
