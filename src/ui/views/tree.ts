// Tree view (3): the Dropbox folder tree for exploring. Every folder starts expanded
// and every file hidden (leaf folders closed). Counts are raw files, so all
// length variants show up here even though the queue dedupes them.
import type { Key } from "../keys.ts";
import type { Track } from "@hum/core/model";
import { fmtTime } from "../../util.ts";
import { blank, pad, row, type Span } from "../text.ts";
import { ListState } from "./list.ts";

interface Folder {
  key: string; // "dawn", "dawn/azure", "dawn/azure/mid"
  name: string;
  depth: number;
  count: number;
  children: Folder[];
  files: Track[]; // only on leaf folders
}

interface Row {
  depth: number;
  folder?: Folder;
  file?: Track;
  parent?: string;
}

export class TreeState {
  list = new ListState();
  open = new Set<string>();
  raw = false;
  root: Folder[] = [];
  total = 0;
  private built?: Track[];

  build(tracks: Track[]): void {
    if (this.built === tracks) return;
    const first = !this.built;
    this.built = tracks;
    this.total = tracks.length;
    const map = new Map<string, Folder>();
    const get = (key: string, name: string, depth: number, parent?: Folder) => {
      let f = map.get(key);
      if (!f) {
        f = { key, name, depth, count: 0, children: [], files: [] };
        map.set(key, f);
        (parent ? parent.children : this.root).push(f);
      }
      f.count++;
      return f;
    };
    this.root = [];
    for (const t of tracks) {
      let parent: Folder | undefined;
      t.dims.forEach((name, depth) => (parent = get(t.dims.slice(0, depth + 1).join("/"), name, depth, parent)));
      if (parent) parent.files.push(t);
    }
    const sortRec = (fs: Folder[]) => {
      fs.sort((a, b) => a.name.localeCompare(b.name));
      for (const f of fs) {
        sortRec(f.children);
        f.files.sort((a, b) => a.name.localeCompare(b.name) || a.duration - b.duration);
      }
    };
    sortRec(this.root);
    const deepest = Math.max(0, ...tracks.slice(0, 1).map((t) => t.dims.length - 1));
    if (first) for (const [key, f] of map) if (f.depth < deepest) this.open.add(key);
  }

  rows(): Row[] {
    const out: Row[] = [];
    const walk = (fs: Folder[], parent?: string) => {
      for (const f of fs) {
        out.push({ depth: f.depth, folder: f, parent });
        if (!this.open.has(f.key)) continue;
        walk(f.children, f.key);
        for (const t of f.files) out.push({ depth: f.depth + 1, file: t, parent: f.key });
      }
    };
    walk(this.root);
    return out;
  }

  private leaves(): string[] {
    return this.root.flatMap((s) => s.children.flatMap((g) => g.children.map((l) => l.key)));
  }

  key(k: Key, page: number): boolean {
    const rows = this.rows();
    if (this.list.move(k, rows.length, page)) return true;
    const r = rows[this.list.sel];
    if (k === ".") this.raw = !this.raw;
    else if (k === "o") {
      const leaves = this.leaves();
      const anyOpen = leaves.some((l) => this.open.has(l));
      for (const l of leaves) anyOpen ? this.open.delete(l) : this.open.add(l);
      this.keepSelection(r);
    } else if (!r) return false;
    else if (k === "enter" && r.folder) {
      this.open.has(r.folder.key) ? this.open.delete(r.folder.key) : this.open.add(r.folder.key);
    } else if (k === "right" && r.folder) this.open.add(r.folder.key);
    else if (k === "left") {
      if (r.folder && this.open.has(r.folder.key)) this.open.delete(r.folder.key);
      else if (r.parent) this.selectFolder(r.parent);
    } else return false;
    return true;
  }

  private selectFolder(key: string): void {
    const i = this.rows().findIndex((x) => x.folder?.key === key);
    if (i >= 0) this.list.sel = i;
  }

  private keepSelection(r: Row | undefined): void {
    if (r?.folder) this.selectFolder(r.folder.key);
    else if (r?.parent) this.selectFolder(r.parent);
  }
}

export function treeView(tree: TreeState, playingId: string | undefined, w: number, h: number): string[] {
  const rows = tree.rows();
  const lines: string[] = [
    row(w, [[" TREE  ", "bold"], ["tracks/", "dim"]], [[`${tree.total.toLocaleString()} FILES `, "dim"]]),
  ];
  const listH = h - 1;
  const top = tree.list.window(rows.length, listH);
  for (let i = top; i < Math.min(rows.length, top + listH); i++) {
    const r = rows[i]!;
    const indent = " " + "  ".repeat(r.depth);
    let left: string;
    let right: string;
    let st: Span[1] = "none";
    if (r.folder) {
      left = `${indent}${tree.open.has(r.folder.key) ? "▾" : "▸"} ${r.folder.name}`;
      right = `${r.folder.count.toLocaleString()} `;
      if (r.depth === 0) st = "bold";
    } else {
      const t = r.file!;
      const playing = t.id === playingId;
      left = `${indent}${playing ? "▶" : " "} ${tree.raw ? t.fileName : t.name}`;
      right = `${fmtTime(t.duration)} `;
      st = playing ? "accent" : "none";
    }
    if (i === tree.list.sel) lines.push(row(w, [[pad(left, w - right.length) + right, "inverse"]]));
    else lines.push(row(w, [[left, st]], [[right, r.file ? "dim" : st]]));
  }
  while (lines.length < h) lines.push(blank(w));
  return lines.slice(0, h);
}
