// Paths and settings. Every path the app writes lives inside the repo (AGENTS.md rule 1).
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseProfile, type Profile } from "@hum/core/profile";

export const ROOT = join(import.meta.dir, "..");
export const SECRETS = join(ROOT, ".secrets");
export const CACHE = join(ROOT, ".cache");
export const DATA = join(ROOT, ".data"); // things you'd miss if deleted (favourites); .cache is disposable

const state = process.env.HUM_STATE ?? join(CACHE, "state.json"); // tests point this elsewhere

export const paths = {
  token: join(SECRETS, "dropbox.json"),
  pkce: join(SECRETS, "pkce.json"),
  library: join(CACHE, "library.json"),
  meta: join(CACHE, "meta"),
  audio: join(CACHE, "audio"),
  art: join(CACHE, "art"),
  bin: join(CACHE, "bin"),
  tmp: join(CACHE, "tmp"),
  state,
  // Tests set HUM_STATE, which keeps their favourites next to it instead of the real ones.
  favorites: process.env.HUM_STATE ? state.replace(/(\.json)?$/, "-favorites.json") : join(DATA, "favorites.json"),
  lock: join(CACHE, "play.lock"),
  log: join(CACHE, "log.txt"),
  localConfig: join(ROOT, "config.local.json"),
  profile: join(ROOT, "profile.local.json"),
  helperSource: join(ROOT, "native", "humplayer.swift"),
  helperPlist: join(ROOT, "native", "Info.plist"),
};

export { APP_KEY } from "@hum/core/profile";

// The library profile (docs/profile.md): where the library is and how its
// folders are organised. Gitignored; the CLI stops with a clear message without it.
let cachedProfile: Profile | null | undefined;
export function loadProfile(): Profile | null {
  if (cachedProfile !== undefined) return cachedProfile;
  if (!existsSync(paths.profile)) return (cachedProfile = null);
  return (cachedProfile = parseProfile(JSON.parse(readFileSync(paths.profile, "utf8"))));
}
export function profile(): Profile {
  const p = loadProfile();
  if (!p) throw new Error(`missing ${paths.profile}: see docs/profile.md`);
  return p;
}

export type Accent = "red" | "green" | "yellow" | "blue" | "magenta" | "cyan";

export interface Settings {
  cacheCapBytes: number;
  prefetchDepth: number;
  minFreeBytes: number;
  accent: Accent;
  defaultFilter: string;
}

const defaults: Settings = {
  cacheCapBytes: 2e9,
  prefetchDepth: 3,
  minFreeBytes: 1e9,
  accent: "yellow",
  defaultFilter: "",
};

// Optional gitignored overrides, e.g. { "accent": "cyan" }.
// The profile's defaultFilter applies unless config.local.json sets one.
function loadSettings(): Settings {
  const base = { ...defaults, defaultFilter: loadProfileQuietly()?.defaultFilter ?? "" };
  if (!existsSync(paths.localConfig)) return base;
  try {
    return { ...base, ...JSON.parse(readFileSync(paths.localConfig, "utf8")) };
  } catch {
    return base;
  }
}

function loadProfileQuietly(): Profile | null {
  try {
    return loadProfile();
  } catch {
    return null;
  }
}

export const settings = loadSettings();
