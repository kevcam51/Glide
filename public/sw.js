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

// ── Push delivery (S90) — Web Push payloads sent by functions/push.js ─────────
self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { /* non-JSON payload */ }
  e.waitUntil(self.registration.showNotification(d.title || "Glide", {
    body: d.body || "",
    icon: "/icon-192.png",
    badge: "/icon-maskable-192.png",
    tag: d.tag || "glide",
    data: { url: d.url || "/" },
  }));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || "/";
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) { if ("focus" in c) return c.focus(); }
      return self.clients.openWindow(url);
    })
  );
});
