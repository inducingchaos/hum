// UI state, key dispatch, and frame composition. Keymap: docs/plan.md §12.
import { complete } from "@hum/core/filter";
import type { Player } from "../core/player.ts";
import { fmtBytes, plural } from "../util.ts";
import { profile } from "../config.ts";
import type { Key } from "./keys.ts";
import { Screen, size } from "./term.ts";
import { blank, row, type Span } from "./text.ts";
import { favoritesView } from "./views/favorites.ts";
import { helpView } from "./views/help.ts";
import { ListState } from "./views/list.ts";
import { playerView } from "./views/player.ts";
import { queueView } from "./views/queue.ts";
import { SearchState, searchView } from "./views/search.ts";
import { TreeState, treeView } from "./views/tree.ts";

export type View = "player" | "queue" | "tree" | "favorites" | "search";
const VIEW_NAME: Record<View, string> = { player: "", queue: "QUEUE", tree: "TREE", favorites: "FAVOURITES", search: "SEARCH" };

export class App {
  view: View = "player";
  private back: View = "player";
  help = false;
  prompt: string | null = null; // filter prompt text while open
  confirmClear = false;
  notice?: string;
  readonly queueList = new ListState();
  readonly favList = new ListState();
  readonly tree = new TreeState();
  readonly search = new SearchState();
  private screen = new Screen();
  private pending = false;

  constructor(
    private p: Player,
    private quit: () => void,
  ) {
    p.onChange = () => this.schedule();
    p.onNotice = (msg) => {
      this.notice = msg;
      this.schedule();
    };
  }

  // Coalesces bursts of changes into one frame.
  schedule(): void {
    if (this.pending) return;
    this.pending = true;
    setImmediate(() => {
      this.pending = false;
      this.render();
    });
  }

  resized(): void {
    this.screen.invalidate();
    this.render();
  }

  render(): void {
    this.screen.draw(this.frame(size().cols, size().rows));
  }

  frame(w: number, h: number): string[] {
    if (w < 60 || h < 12) return [row(w, [["TOO SMALL", "bold"]]), ...Array.from({ length: h - 1 }, () => blank(w))];
    const bodyH = h - 2;
    let body: string[];
    if (this.help) body = helpView(w, bodyH);
    else if (this.view === "queue") body = queueView(this.p, this.queueList, w, bodyH);
    else if (this.view === "favorites") body = favoritesView(this.p, this.favList, w, bodyH);
    else if (this.view === "tree") {
      this.tree.build(this.p.lib.tracks);
      body = treeView(this.tree, this.p.loadedId, w, bodyH);
    } else if (this.view === "search") body = searchView(this.search, this.p, w, bodyH);
    else body = playerView(this.p, w, bodyH);
    const bottom = this.bottomLine(w);
    if (bottom) body[bodyH - 1] = bottom;
    return [this.header(w), ...body, this.footer(w)];
  }

  private header(w: number): string {
    const name = this.help ? "KEYS" : VIEW_NAME[this.view];
    const left: Span[] = [[` ${profile().label.toUpperCase()} `, "accentBold"]];
    if (name) left.push(["· ", "dim"], [`${name} `, "bold"]);
    return row(w, left, [[" ⏻ ", "accent"]], "─", "dim");
  }

  private footer(w: number): string {
    const p = this.p;
    const flags: Span[] = [];
    const flag = (text: string) => flags.push([` ${text} `, "accentBold"], ["─", "dim"]);
    if (p.authExpired) flag("DROPBOX AUTH EXPIRED · run pnpm auth start");
    else if (p.offline) flag("OFFLINE");
    if (p.diskLow) flag("DISK LOW · PREFETCH PAUSED");
    if (this.notice) flag(this.notice);
    return row(w, [["─", "dim"], ...flags], [[" ? KEYS ", "dim"], ["─", "dim"]], "─", "dim");
  }

  // Filter prompt or confirm line, drawn over the last body row.
  private bottomLine(w: number): string | null {
    if (this.confirmClear) {
      const c = this.p.cache;
      return row(w, [[" CLEAR CACHED AUDIO? ", "accentBold"], [`${c.count} tracks · ${fmtBytes(c.totalBytes)}   `], ["y / n", "bold"]]);
    }
    if (this.prompt === null) return null;
    const { parsed, count } = this.p.previewFilter(this.prompt);
    const right: Span[] = [];
    const bad = parsed.terms.find((t) => t.kind !== "ok");
    if (bad?.kind === "ambiguous") right.push([`${bad.term}? ${bad.matches.join(" · ")} `, "accent"]);
    else if (bad) right.push([`${bad.term}? no such folder `, "accent"]);
    else right.push([`→ ${plural(count, "song")} `, count ? "dim" : "accent"]);
    const hint: Span[] = this.prompt ? [] : [[` now: ${this.p.filterText || "everything"} · all = everything · TAB completes`, "dim"]];
    return row(w, [[" FILTER › ", "accentBold"], [this.prompt], ["█", "accent"], ...hint], right);
  }

  // ---- keys ----

  key(k: Key): void {
    if (k === "ctrl-c") return this.quit();
    this.notice = undefined;
    if (this.confirmClear) {
      this.confirmClear = false;
      if (k === "y" || k === "Y") this.p.clearCache();
    } else if (this.prompt !== null) this.promptKey(k);
    else if (this.help) {
      if (k === "q") return this.quit();
      this.help = false;
    } else if (this.view === "search") this.searchKey(k);
    else if (!this.viewKey(k)) this.globalKey(k);
    this.render();
  }

  private page(): number {
    return Math.max(1, size().rows - 5);
  }

  private viewKey(k: Key): boolean {
    if (this.view === "queue") {
      if (this.queueList.move(k, this.p.queue.order.length, this.page())) return true;
      if (k === "enter") {
        this.p.jumpTo(this.queueList.sel);
        return true;
      }
    }
    if (this.view === "favorites") {
      const favs = this.p.favoriteTracks();
      if (this.favList.move(k, favs.length, this.page())) return true;
      const t = favs[this.favList.sel];
      if (k === "enter" && t) this.p.playNow(t.id);
      else if ((k === "x" || k === "delete") && t) this.p.toggleFavorite(t.id);
      else if (k === "a" || k === "A") this.p.playFavorites();
      else return false;
      return true;
    }
    if (this.view === "tree") return this.tree.key(k, this.page());
    return false;
  }

  private setView(v: View): void {
    if (v === "queue" && this.view !== "queue") this.queueList.sel = this.p.queue.cursor;
    if (v === "search") {
      this.back = this.view;
      this.search.query = "";
      this.search.update(this.p);
    }
    this.view = v;
  }

  private globalKey(k: Key): void {
    const p = this.p;
    switch (k) {
      case " ": return p.toggle();
      case "n": return p.next();
      case "p": return p.prev();
      case "left": return p.seekBy(-10);
      case "right": return p.seekBy(10);
      case "shift-left": return p.seekBy(-60);
      case "shift-right": return p.seekBy(60);
      case "-": case "_": return p.setVolume(p.volume - 5);
      case "=": case "+": return p.setVolume(p.volume + 5);
      case "/": this.prompt = ""; return;
      case "f": return this.setView("search");
      case "s": return p.toggleShuffle();
      case "r": return p.cycleRepeat();
      case "d": return p.toggleDedupe();
      case "l": return p.toggleFavorite();
      case "1": return this.setView("player");
      case "2": return this.setView("queue");
      case "3": return this.setView("tree");
      case "4": return this.setView("favorites");
      case "?": this.help = true; return;
      case "C": this.confirmClear = true; return;
      case "esc": return this.setView("player");
      case "q": return this.quit();
    }
  }

  private promptKey(k: Key): void {
    const text = this.prompt ?? "";
    if (k === "esc") this.prompt = null;
    else if (k === "enter") {
      if (!text.trim()) this.prompt = null; // empty: leave the filter as it is
      else if (this.p.applyFilter(text)) this.prompt = null;
    } else if (k === "tab") this.prompt = complete(text, this.p.vocab);
    else if (k === "backspace") this.prompt = [...text].slice(0, -1).join("");
    else if (k === "ctrl-u") this.prompt = "";
    else if (k === "ctrl-w") this.prompt = text.replace(/\S*\s*$/, "");
    else if ([...k].length === 1) this.prompt = text + k;
  }

  private searchKey(k: Key): void {
    const s = this.search;
    if (k === "esc") return this.setView(this.back);
    if (k === "enter") {
      const t = s.results[s.list.sel];
      if (t) {
        this.p.playNow(t.id);
        this.view = "player";
      }
      return;
    }
    // j/k/g type into the query here; only arrows and ctrl keys move.
    if (["up", "down", "pageup", "pagedown", "ctrl-n", "ctrl-p"].includes(k)) {
      s.list.move(k, s.results.length, this.page());
      return;
    }
    const before = s.query;
    if (k === "backspace") s.query = [...s.query].slice(0, -1).join("");
    else if (k === "ctrl-u") s.query = "";
    else if (k === "ctrl-w") s.query = s.query.replace(/\S*\s*$/, "");
    else if ([...k].length === 1) s.query += k;
    if (s.query !== before) s.update(this.p);
  }
}
