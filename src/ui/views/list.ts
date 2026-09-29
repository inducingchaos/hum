// Shared cursor + scroll state for every scrollable list.
import type { Key } from "../keys.ts";

export class ListState {
  sel = 0;
  scroll = 0;

  clamp(n: number): void {
    this.sel = Math.max(0, Math.min(this.sel, n - 1));
  }

  // Keeps the selection visible in a window of `h` rows. Returns the first visible index.
  window(n: number, h: number): number {
    this.clamp(n);
    if (this.sel < this.scroll) this.scroll = this.sel;
    if (this.sel >= this.scroll + h) this.scroll = this.sel - h + 1;
    this.scroll = Math.max(0, Math.min(this.scroll, n - h));
    return this.scroll;
  }

  // Movement keys shared by all lists. Returns true when the key was handled.
  move(k: Key, n: number, page: number): boolean {
    const step: Record<string, number> = {
      up: -1, k: -1, "ctrl-p": -1, down: 1, j: 1, "ctrl-n": 1,
      pageup: -page, pagedown: page, home: -Infinity, g: -Infinity, end: Infinity, G: Infinity,
    };
    const d = step[k];
    if (d === undefined) return false;
    this.sel = Math.max(0, Math.min(n - 1, d === -Infinity ? 0 : d === Infinity ? n - 1 : this.sel + d));
    return true;
  }
}
