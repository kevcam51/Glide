// Minimal service worker — just enough to make Glide installable as a home-screen
// app (PWA) and give a graceful offline shell. Deliberately does NOT cache JS/CSS,
// so users always get the latest app on every load (no stale-version bugs); only
// page navigations fall back to a cached shell when fully offline.
const SHELL = "glide-shell-v1";

self.addEventListener("install", (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(SHELL).then((c) => c.add("/")).catch(() => {}));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== SHELL).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  // Navigations: network-first, fall back to the cached shell when offline.
  // Refresh the cached shell on every successful navigation — the install-time
  // copy goes stale after a deploy (its hashed asset URLs 404), so keeping it
  // at most one page-load old is what makes the offline fallback actually boot.
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(SHELL).then((c) => c.put("/", copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => caches.match("/"))
    );
  }
  // Everything else: default network (always fresh — no caching here).
});
