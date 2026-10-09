// Keeps the app itself on the phone so it opens with no internet. The model
// weights are cached separately by WebLLM; this worker leaves those requests alone.
const CACHE = "neo-bolso-v1";
const SHELL = ["./", "index.html", "styles.css", "app.js", "orb.js", "worker.js",
  "manifest.webmanifest", "icon.svg", "icon-180.png", "icon-512.png"];
const LIB = "https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.85/lib/index.js";

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then(async (c) => {
    await c.addAll(SHELL);
    try { await c.add(new Request(LIB, { mode: "cors" })); } catch { /* fetched on first use instead */ }
  }).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith("neo-bolso-") && k !== CACHE)
    .map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  const mine = url.origin === self.location.origin;
  if (e.request.method !== "GET" || !(mine || e.request.url === LIB)) return;
  // App files: network first (so updates arrive), the cache when offline.
  // The library is versioned in its URL, so the cached copy is always right.
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    if (!mine) {
      const hit = await cache.match(e.request);
      if (hit) return hit;
    }
    try {
      const res = await fetch(e.request);
      if (res.ok) cache.put(e.request, res.clone());
      return res;
    } catch {
      const hit = await cache.match(e.request, { ignoreSearch: true });
      return hit || (mine && e.request.mode === "navigate" ? cache.match("index.html") : Response.error());
    }
  })());
});
