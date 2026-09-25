// Service worker - Ponto Overall
// Bump this on every deploy that changes cached files so clients pick up the update.
const CACHE_VERSION = "v33";
const CACHE_NAME = "ponto-overall-" + CACHE_VERSION;

const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./js/state.js",
  "./js/auth.js",
  "./js/account.js",
  "./js/grade.js",
  "./js/dayModal.js",
  "./js/vip.js",
  "./js/clients.js",
  "./js/company.js",
  "./js/onboarding.js",
  "./js/schedule.js",
  "./js/export.js",
  "./js/app.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-512-maskable.png",
  "./icons/overall-logo.png"
];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).catch(() => {})
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Network-first for the HTML shell (so updates show up fast when online),
// cache-first for everything else, always with an offline fallback to cache.
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const isHTML = req.mode === "navigate" || (req.headers.get("accept") || "").includes("text/html");

  if (isHTML) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req).then((res) => res || caches.match("./index.html")))
    );
    return;
  }

  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
          return res;
        })
        .catch(() => cached);
    })
  );
});
