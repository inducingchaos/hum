// hum service worker (plan-web §11): app shell only. Never touches Dropbox or
// image hosts, and never deletes the audio cache (hum-audio-*), which page code owns.
const SHELL = "hum-shell-v2";

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (e) => {
  e.waitUntil(
    (async () => {
      for (const k of await caches.keys()) if (k.startsWith("hum-shell-") && k !== SHELL) await caches.delete(k);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin) return;

  // Pages: the cached shell at once (launch doesn't wait on the network, turn
  // 14: ~4 s cold starts), refreshed in the background for the next launch.
  if (req.mode === "navigate") {
    e.respondWith(
      (async () => {
        const cache = await caches.open(SHELL);
        const hit = await cache.match("/");
        const net = fetch(req).then(async (res) => {
          if (res.ok) await cache.put("/", res.clone());
          return res;
        });
        if (hit) {
          e.waitUntil(net.catch(() => {}));
          return hit;
        }
        return net.catch(() => Response.error());
      })(),
    );
    return;
  }

  // Hashed build assets never change: cache first.
  if (url.pathname.startsWith("/assets/")) {
    e.respondWith(
      (async () => {
        const cache = await caches.open(SHELL);
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) await cache.put(req, res.clone());
        return res;
      })(),
    );
    return;
  }

  // Icons, manifest: cached copy now, refresh in the background.
  e.respondWith(
    (async () => {
      const cache = await caches.open(SHELL);
      const hit = await cache.match(req);
      const net = fetch(req).then(async (res) => {
        if (res.ok) await cache.put(req, res.clone());
        return res;
      });
      return hit ?? net;
    })(),
  );
});
