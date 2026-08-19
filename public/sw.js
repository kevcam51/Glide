// Service worker: installability, an offline shell, and a fast cold start.
//
// STARTUP (S97u, Kevin: "it takes a little bit of time to get started" on the
// installed PWA). This used to cache NOTHING but the shell, so every launch
// re-downloaded the whole bundle (~1.9MB raw / ~500KB gzipped) before the app
// could run. That caution was aimed at stale-version bugs — but Vite emits
// CONTENT-HASHED filenames (index-B2uc0RTI.js), so an asset URL is immutable by
// construction: change the content and the name changes. Caching those forever
// therefore CANNOT serve a stale app, while navigations stay network-first, so a
// deploy is picked up immediately and simply asks for the new hashed names.
// Net effect: first launch downloads, every launch after reads from local disk.
// v3 (S183q): the cached navigation HTML carries the inline pre-paint script, so
// any change to that script needs a new cache name or one launch runs the old
// copy — which would mean a cold start ignoring the user's accent colour.
const SHELL = "glidna-shell-v3";
const ASSETS = "glidna-assets-v2";
const ASSET_CAP = 60;   // trim old hashed files so the cache can't grow forever

self.addEventListener("install", (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(SHELL).then((c) => c.add("/")).catch(() => {}));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL && k !== ASSETS).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Keep the asset cache bounded: superseded hashed files are never requested
// again (the fresh HTML only references current ones), so drop the oldest.
async function trimAssets() {
  try {
    const c = await caches.open(ASSETS);
    const keys = await c.keys();
    if (keys.length > ASSET_CAP) {
      await Promise.all(keys.slice(0, keys.length - ASSET_CAP).map((k) => c.delete(k)));
    }
  } catch { /* trimming is best-effort */ }
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  // Navigations: network-first, fall back to the cached shell when offline.
  // Refresh the cached shell on every successful navigation — the install-time
  // copy goes stale after a deploy (its hashed asset URLs 404), so keeping it
  // at most one page-load old is what makes the offline fallback actually boot.
  if (req.mode === "navigate") {
    // Network-first RACED against a short timeout (S97y, Kevin: "sometimes it
    // takes a little too long to open"). Pure network-first made every launch
    // block on the HTML round-trip before anything could render — even though
    // every JS/CSS asset was already cached locally and would have painted
    // instantly. On a cold radio that gate is the whole delay.
    //
    // Now: if the network answers within SHELL_TIMEOUT_MS we use it (always
    // freshest). If it's slower, we serve the cached shell so the app boots
    // immediately, while the real response still lands in the cache for next
    // launch. Deliberately NOT plain cache-first: that would routinely boot a
    // one-deploy-old shell whose hashed asset URLs can 404.
    const SHELL_TIMEOUT_MS = 1200;
    e.respondWith((async () => {
      const cached = await caches.match("/");
      // ⚠️ ONLY THE ROOT IS THE SHELL (S196p). This stored ANY successful
      // navigation under "/", including the /card/:code and /i/:code landing
      // pages — which are serverless functions returning a REDIRECT
      // interstitial, not the app, and are explicitly marked no-store. So after
      // anyone opened a "save your card" or invite link on their phone, the
      // installed app's cached start screen WAS that interstitial: every cold
      // start on a slow radio booted into a redirect page instead of Glidna.
      //
      // Those routes also render fine without caching — they are one-time
      // links, always online by definition, since they were just tapped from a
      // message.
      const isShell = url.pathname === "/";
      const network = fetch(req).then((res) => {
        const noStore = res && res.headers && /no-store/i.test(res.headers.get("cache-control") || "");
        if (res && res.ok && isShell && !noStore) {
          const copy = res.clone();
          caches.open(SHELL).then((c) => c.put("/", copy)).catch(() => {});
        }
        return res;
      });
      // No cached shell yet (first ever launch) — nothing to fall back to.
      if (!cached) return network.catch(() => caches.match("/"));
      const timeout = new Promise((resolve) => setTimeout(() => resolve(null), SHELL_TIMEOUT_MS));
      const winner = await Promise.race([network.catch(() => null), timeout]);
      // Let the network write its cache update either way (don't await it).
      network.catch(() => {});
      return winner || cached;
    })());
    return;   // handled — don't fall through to the asset branch
  }
  // Hashed build assets: cache-first. Immutable by construction (see the note at
  // the top), so a hit is always correct — this is what makes launch #2 instant.
  if (url.origin === self.location.origin && url.pathname.startsWith("/assets/")) {
    e.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(ASSETS).then((c) => c.put(req, copy)).then(trimAssets).catch(() => {});
        }
        return res;
      }))
    );
    return;
  }
  // Everything else (API calls, images, fonts): straight to network, never cached.
});

// ── Push delivery (S90) — Web Push payloads sent by functions/push.js ─────────
self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { /* non-JSON payload */ }
  e.waitUntil(self.registration.showNotification(d.title || "Glidna", {
    body: d.body || "",
    icon: "/icon-192.png",
    badge: "/icon-maskable-192.png",
    tag: d.tag || "glide",
    // S196e: a payload may carry action buttons, each with its own destination
    // (`actionUrls[action]`). The button does NOT act here — the worker has no
    // signed-in Firestore access — it just opens the app at a URL that does,
    // which is the same mechanism the invite and card links already use.
    actions: Array.isArray(d.actions) ? d.actions.slice(0, 2) : undefined,
    data: { url: d.url || "/", actionUrls: d.actionUrls || {} },
  }));
});

// S183: every payload carries a `url`, but this used to focus an already-open
// window and stop there — so the destination was silently dropped for anyone
// who had Glidna open, which is most people most of the time. A push that says
// "your reward is ready" then dumped them on the dashboard. Focus AND navigate,
// and only skip the navigate when the tab is already on that exact URL (so a
// tap doesn't reload the page out from under someone).
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const data = e.notification.data || {};
  // An action button overrides the body tap. Falling back to the plain url when
  // an action has no destination keeps an unknown action harmless.
  const url = (e.action && data.actionUrls && data.actionUrls[e.action]) || data.url || "/";
  const target = new URL(url, self.location.origin).href;
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (list) => {
      for (const c of list) {
        if (!("focus" in c)) continue;
        // navigate() can reject (cross-origin, or a client that won't allow
        // it); focusing is still the right outcome, so never let that throw.
        if (c.url !== target && "navigate" in c) { try { await c.navigate(target); } catch { /* focus anyway */ } }
        return c.focus();
      }
      return self.clients.openWindow(target);
    })
  );
});
