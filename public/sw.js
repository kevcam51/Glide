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
// ⚠️ BUMPED TO v4/v3 TO PURGE A POISONED CACHE (S234). A cached shell names the
// hashed assets of the deploy it was cached from, and those 404 the moment the
// next deploy lands. The activate handler below deletes every cache that is not
// on the allowlist, so renaming these IS the repair: the first launch after this
// worker activates drops the stale shell and goes to the network. Anyone already
// stuck on a blank screen recovers that way and no other — a blank page cannot
// run the code that would fix it, so the fix has to live in the worker.
const SHELL = "glidna-shell-v4";
const ASSETS = "glidna-assets-v3";
const ASSET_CAP = 60;   // trim old hashed files so the cache can't grow forever
// Where a photo shared INTO Glidna waits between the share-sheet POST and the
// app reading it (S221). Cache Storage rather than IndexedDB because a Response
// already holds a Blob and the service worker is the one writing it.
//
// ⚠️ IT MUST BE ON THE ACTIVATE ALLOWLIST BELOW. That handler deletes every
// cache whose name is not SHELL or ASSETS, so a worker activating between the
// POST and the app's read would silently eat the photo — and the failure would
// look like "sharing does nothing", intermittently, which is the worst kind.
const SHARE = "glidna-share-v1";
const SHARE_CAP = 20;   // the chat accepts 20 photos a message; match it

self.addEventListener("install", (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(SHELL).then((c) => c.add("/")).catch(() => {}));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL && k !== ASSETS && k !== SHARE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Which hashed assets does a cached HTML document actually need to boot?
function assetRefs(html) {
  return [...String(html).matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]);
}

// ⚠️ A CACHED SHELL IS ONLY VALID TOGETHER WITH THE ASSETS IT NAMES (S234), and
// nothing linked the two. The shell was refreshed on every navigation while the
// asset cache was trimmed on its own schedule, so the pair could — and did —
// drift apart. Serving a shell whose entry script is gone gives the worst
// outcome available: the inline pre-paint script runs, the background paints,
// the module 404s, and #root stays empty. A blank screen, for ever, with no way
// for the page to repair itself. Kevin's phone, verified by reproducing it.
async function shellIsBootable(res) {
  try {
    const refs = assetRefs(await res.clone().text()).filter((r) => r.endsWith(".js"));
    if (!refs.length) return false;                  // no entry script named — not a shell
    const c = await caches.open(ASSETS);
    for (const r of refs) if (!(await c.match(r))) return false;
    return true;
  } catch { return false; }
}

// Keep the asset cache bounded: superseded hashed files are never requested
// again (the fresh HTML only references current ones), so drop the oldest.
//
// ⚠️ EXCEPT THE ONES THE CACHED SHELL STILL NEEDS. One deploy emits 14 assets and
// a launch caches roughly half of them, so a handful of deploys in a day walks
// straight past ASSET_CAP — and the oldest entries, the ones evicted first, are
// exactly the ones an older cached shell points at. The cap was quietly creating
// the mismatch it now refuses to create.
async function trimAssets() {
  try {
    const c = await caches.open(ASSETS);
    const keys = await c.keys();
    if (keys.length <= ASSET_CAP) return;
    let keep = new Set();
    try {
      const shell = await (await caches.open(SHELL)).match("/");
      if (shell) keep = new Set(assetRefs(await shell.text()));
    } catch { /* no shell to protect */ }
    const droppable = keys.filter((k) => !keep.has(new URL(k.url).pathname));
    const over = keys.length - ASSET_CAP;
    await Promise.all(droppable.slice(0, over).map((k) => c.delete(k)));
  } catch { /* trimming is best-effort */ }
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  // ── A photo shared INTO Glidna from the phone's share sheet (S221) ─────────
  // The manifest points share_target here with method POST, and the service
  // worker is the ONLY thing that can read it: the request never reaches the
  // network, and there is no server route listening on this path.
  //
  // ⚠️ THIS MUST SIT ABOVE THE `method !== "GET"` GUARD. That guard returns
  // WITHOUT calling respondWith, which hands the request to the network — where
  // Vercel has nothing to answer a POST and the share dies on a blank page.
  //
  // ⚠️ AND THE REDIRECT MUST BE 303, NOT 302. A 302 preserves the method, so the
  // browser would re-POST to "/" and the app would never boot. 303 is the code
  // that means "now go GET this instead", which is exactly the handoff here.
  if (req.method === "POST" && new URL(req.url).pathname === "/share-target") {
    e.respondWith((async () => {
      let n = 0;
      try {
        // ⚠️ EMPTIED BEFORE ANYTHING THAT CAN THROW, and it took a runtime test
        // to see why. `req.formData()` REJECTS on a body with no parts, so with
        // the clear written after the parse — the obvious order — a share
        // carrying no image left the previous photo parked in the cache. The
        // source-level test could not catch that: the clear was present and
        // correct, just unreachable on the path that mattered.
        //
        // Clearing first also means a half-written share can never mix with the
        // one before it, which is the failure that would actually hurt: the app
        // offering to log a meal from somebody's earlier photo.
        const c = await caches.open(SHARE);
        for (const k of await c.keys()) await c.delete(k);
        const form = await req.formData();
        const files = form.getAll("photos")
          .filter((f) => f && typeof f.type === "string" && f.type.startsWith("image/"))
          .slice(0, SHARE_CAP);
        if (files.length) {
          await Promise.all(files.map((f, i) => c.put(
            `/__shared/${i}`,
            new Response(f, { headers: { "content-type": f.type || "image/jpeg" } }))));
          n = files.length;
        }
      } catch { /* a malformed share should still land the person in the app */ }
      return Response.redirect(new URL(`/?shared=${n}`, self.location.origin).toString(), 303);
    })());
    return;
  }
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
      // ⚠️ AND A SHELL WHOSE ASSETS ARE GONE IS WORSE THAN NO SHELL. The race
      // below exists so a slow radio still boots instantly from cache — but it
      // was willing to win with a shell that could not run, which is how a
      // 1.2-second network hiccup turned into a permanently blank app. If the
      // pair has drifted, wait for the network however long it takes; a spinner
      // is recoverable and a blank screen is not. Offline with a broken shell
      // now surfaces the browser's own error page rather than a silent void.
      if (!(await shellIsBootable(cached))) return network;
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
        // ⚠️ A 200 IS NOT PROOF IT IS THE ASSET. Hosts and dev servers with an
        // SPA fallback answer a missing /assets/ file with index.html at 200 —
        // caching that would park an HTML document under a hashed .js name, and
        // a cached-first hit would then feed HTML to a module parser on every
        // launch. Vercel 404s correctly (checked), so this is insurance against
        // the next host, not a bug in this one.
        const htmlForCode = res && /\.(?:js|css)$/.test(url.pathname)
          && /text\/html/i.test(res.headers.get("content-type") || "");
        // ⚠️ AND A no-store ANSWER IS NEVER CACHED UNDER A HASHED NAME (S235).
        // /api/entry serves the CURRENT bundle when a dead chunk name is asked
        // for, so a stuck device boots instead of going blank — but storing that
        // under the dead hash would make the name permanent and wrong, which is
        // the opposite of what content hashing promises. It is a one-boot rescue,
        // not a second copy of the app.
        const noStore = res && /no-store/i.test(res.headers.get("cache-control") || "");
        if (htmlForCode) {
          caches.open(SHELL).then((c) => c.delete("/")).catch(() => {});
        } else if (res && res.ok && !noStore) {
          const copy = res.clone();
          caches.open(ASSETS).then((c) => c.put(req, copy)).then(trimAssets).catch(() => {});
        } else if (res && res.status === 404) {
          // ⚠️ A HASHED ASSET THAT 404s CAN ONLY MEAN THE SHELL IS FROM A DEAD
          // DEPLOY — the names are immutable, so a miss is never transient.
          // Dropping the shell is what lets the NEXT launch go to the network
          // instead of asking for the same missing file for ever.
          caches.open(SHELL).then((c) => c.delete("/")).catch(() => {});
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
