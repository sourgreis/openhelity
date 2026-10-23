// Network first, the cache only offline: cache-first mixes old and new files after an update.
// The deploy stamps the cache name with the commit SHA.
const CACHE = "openhelity-dev";

const ASSETS = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./css/style.css",
  "./js/app.js",
  "./js/core.js",
  "./js/dks.js",
  "./js/measure.js",
  "./js/protocol.js",
  "./js/codecs.js",
  "./js/keys.js",
  "./js/layout.js",
  "./js/macro.js",
  "./js/i18n.js",
  "./pkg/openhelity.js",
  "./pkg/openhelity_bg.wasm",
  "./locales/index.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then(async (cache) => {
    await cache.addAll(ASSETS);
    // Translations come from the catalogue, so adding one does not mean editing this file.
    try {
      const response = await fetch("./locales/index.json", { cache: "reload" });
      const catalogue = await response.json();
      await cache.addAll(catalogue.map((entry) => `./locales/${entry.code}.json`));
    } catch (_) {
      // Without the catalogue only the translations are missing offline.
    }
  }));
  self.skipWaiting();
});

// Only this app's old caches go: on GitHub Pages every site of an account shares the origin.
const isStale = (name) => name.startsWith("openhelity-") && name !== CACHE;

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.filter(isStale).map((name) => caches.delete(name))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith((async () => {
    try {
      // Bypass the HTTP cache, or it would hand back the stale copy being replaced.
      const response = await fetch(event.request.url, { cache: "reload" });
      if (response.ok) {
        const cache = await caches.open(CACHE);
        await cache.put(event.request, response.clone());
      }
      return response;
    } catch (_) {
      const cached = await caches.match(event.request);
      if (cached) return cached;
      if (url.pathname.endsWith("/locales/index.json")) {
        return new Response("[]", { headers: { "Content-Type": "application/json" } });
      }
      return new Response("Offline and not cached", { status: 504 });
    }
  })());
});
