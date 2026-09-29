// The library profile: everything specific to one person's library lives here,
// NOT in the code. It's a small JSON file kept out of git (`profile.local.json`
// at the repo root; the apps store a copy on the device). See docs/profile.md.
//
// The code only assumes this shape on Dropbox:
//   <root>/<tracks>/<folder>/<folder>/…/<slug>-<id>.mp3   (audio, one folder level per dimension)
//   <root>/<metadata>/<slug>-<id>.json                     (optional metadata, same file stem)

export interface Profile {
  label: string; // shown as the artist on the lock screen and in the header
  root: string; // Dropbox folder that holds the library, e.g. "/music/library"
  tracks: string; // audio folder, relative to root
  metadata: string; // metadata folder, relative to root
  dimensions: string[]; // a name per folder level under `tracks`, e.g. ["mood", "style", "mix"]
  order?: string[]; // folder values listed first, in this order (the rest alphabetical)
  // A folder level whose values are alternate versions of the same song. With
  // dedupe on, one version per song plays: `prefer`, else the first of
  // `fallback` that exists.
  variant?: { dimension: number; prefer: string; fallback?: string[] };
  artQuery?: string; // appended to cover-art URLs; "{size}" becomes the pixel size
  defaultFilter?: string; // filter used on a fresh start
}

// PKCE app key: public by design (no secret), safe to commit.
export const APP_KEY = "49yjxi7h52fcwsy";

const join = (a: string, b: string) => `${a.replace(/\/+$/, "")}/${b.replace(/^\/+/, "")}`;
export const tracksDir = (p: Profile) => join(p.root, p.tracks);
export const metadataDir = (p: Profile) => join(p.root, p.metadata);

// Validates a parsed profile.json. Throws with a readable message.
export function parseProfile(x: unknown): Profile {
  const o = (x ?? {}) as Record<string, unknown>;
  const str = (k: string) => {
    if (typeof o[k] !== "string" || !(o[k] as string).trim()) throw new Error(`profile: "${k}" must be a non-empty string`);
    return (o[k] as string).trim();
  };
  const strs = (k: string, required: boolean) => {
    const v = o[k];
    if (v === undefined && !required) return undefined;
    if (!Array.isArray(v) || !v.every((s) => typeof s === "string")) throw new Error(`profile: "${k}" must be a list of strings`);
    return (v as string[]).map((s) => s.toLowerCase());
  };
  const root = str("root");
  if (!root.startsWith("/")) throw new Error(`profile: "root" must start with /`);
  const dimensions = strs("dimensions", true)!;
  let variant: Profile["variant"];
  if (o.variant !== undefined) {
    const v = o.variant as Record<string, unknown>;
    if (typeof v.dimension !== "number" || v.dimension < 0 || v.dimension >= dimensions.length || typeof v.prefer !== "string")
      throw new Error(`profile: "variant" needs a dimension index (0–${dimensions.length - 1}) and a "prefer" value`);
    if (v.fallback !== undefined && !(Array.isArray(v.fallback) && v.fallback.every((s) => typeof s === "string")))
      throw new Error(`profile: "variant.fallback" must be a list of strings`);
    const fallback = (v.fallback as string[] | undefined)?.map((s) => s.toLowerCase());
    variant = { dimension: v.dimension, prefer: v.prefer.toLowerCase(), ...(fallback ? { fallback } : {}) };
  }
  return {
    label: typeof o.label === "string" && o.label.trim() ? o.label.trim() : "hum",
    root: root.replace(/\/+$/, "").toLowerCase(),
    tracks: str("tracks"),
    metadata: str("metadata"),
    dimensions,
    ...(o.order !== undefined ? { order: strs("order", false) } : {}),
    ...(variant ? { variant } : {}),
    ...(typeof o.artQuery === "string" ? { artQuery: o.artQuery } : {}),
    ...(typeof o.defaultFilter === "string" ? { defaultFilter: o.defaultFilter } : {}),
  };
}

// Sort helper for folder values: profile order first, then alphabetical.
export function valueOrder(p: Pick<Profile, "order"> | undefined): (a: string, b: string) => number {
  const order = p?.order ?? [];
  const rank = (v: string) => (order.includes(v) ? order.indexOf(v) : order.length);
  return (a, b) => rank(a) - rank(b) || a.localeCompare(b);
}
