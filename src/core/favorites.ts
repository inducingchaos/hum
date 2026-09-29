// Favourites (turn 7): .data/favorites.json, newest first. A favourite is a song,
// not a file: every length and version of it shows the heart. `id` remembers the
// exact version that was liked, so shuffling favourites plays that one.
import { existsSync } from "node:fs";
import { loadProfile, paths } from "../config.ts";
import { groupKey, type Track } from "@hum/core/model";
import { readJson, writeJsonAtomic } from "../util.ts";

export interface Favorite {
  key: string; // groupKey
  id: string; // the version that was liked
  name: string; // for reading the file by hand
  at: string;
}

export class Favorites {
  list: Favorite[] = [];
  private keys = new Set<string>();
  private ids = new Set<string>();

  // variantDim: the profile's variant folder level, so a like covers every version.
  constructor(
    private file = paths.favorites,
    private variantDim: number | undefined = loadProfile()?.variant?.dimension,
  ) {
    if (!existsSync(file)) return;
    try {
      const data = readJson<{ version: 1; favorites: Favorite[] }>(file);
      if (Array.isArray(data.favorites)) this.list = data.favorites;
    } catch {}
    this.index();
  }

  private index(): void {
    this.keys = new Set(this.list.map((f) => f.key));
    this.ids = new Set(this.list.map((f) => f.id));
  }

  has(t: Track): boolean {
    return this.keys.has(groupKey(t, this.variantDim));
  }

  // The exact liked version (preferred when one version per song is picked).
  isLikedVersion(t: Track): boolean {
    return this.ids.has(t.id);
  }

  get size(): number {
    return this.list.length;
  }

  // Returns true when the song is now a favourite.
  toggle(t: Track): boolean {
    const key = groupKey(t, this.variantDim);
    const on = !this.keys.has(key);
    if (on) this.list.unshift({ key, id: t.id, name: t.name, at: new Date().toISOString() });
    else this.list = this.list.filter((f) => f.key !== key);
    this.index();
    try {
      writeJsonAtomic(this.file, { version: 1, favorites: this.list });
    } catch {}
    return on;
  }
}
