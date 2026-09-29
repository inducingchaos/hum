// Cover art: the metadata's image URL, plus the profile's optional query
// (e.g. a square-crop request for an image CDN). "{size}" becomes the size.
export function artUrl(url: string, query: string | undefined, size = 600): string {
  if (!query) return url;
  const u = new URL(url);
  for (const [k, v] of new URLSearchParams(query.replaceAll("{size}", String(size)))) u.searchParams.set(k, v);
  return u.toString();
}
