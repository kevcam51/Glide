// Serve something bootable when a DEAD asset name is asked for (S235, widened S236).
//
// Kevin, on his phone: "it loads for a second and the screen goes blank… it is
// going in and out," and then, after S235 shipped, "still not working. it is
// just a blank screen." The service worker can serve an HTML shell cached from
// an earlier deploy, and Vercel serves only the current deployment's assets — so
// every hashed chunk that shell names returns 404, the module graph never
// resolves, and #root stays empty.
//
// ⚠️ S235 FIXED ONE FIFTH OF THE PROBLEM, AND THAT IS WHY HIS PHONE DID NOT
// MOVE. The rewrite covered /assets/index-*.js|css only, but index.html names
// FIVE assets — index, react, firebase, rolldown-runtime, and the lazy App
// chunk. Measured against production: a dead index-* name returned 200 while
// react-*, firebase-*, rolldown-runtime-* and App-* all still returned 404.
// Worse, a worker holding the old ENTRY in cache never asks the network for it
// at all, so the one name that was covered was the one name that never made the
// request. The fallback could not have helped him.
//
// ⚠️ TWO DIFFERENT ANSWERS, BECAUSE ONLY ONE NAME CAN BE SUBSTITUTED.
// The entry is interchangeable: every chunk lives in /assets/, a module's
// imports resolve against its own URL, so the CURRENT entry served under a dead
// entry name finds ./App-*.js exactly as it would under its own, and the page
// boots with no reload. No other chunk works that way — handing back the current
// react bundle for a dead App name would execute the wrong module. So for those
// we serve a tiny module that repairs the device and reloads. The import
// RESOLVES either way, which is the point: a 404 ends the page, a valid module
// gets a second chance.
//
// ⚠️ AND IT IS no-store ON PURPOSE. Caching the current bundle under a dead
// hashed name would break the one guarantee hashed names give: that a URL's
// content never changes. The fallback exists to get a stuck device through ONE
// boot, not to become a second copy of the app under a name that lies.

function pickAsset(html, wantCss) {
  const re = wantCss
    ? /<link[^>]+href="(\/assets\/index-[^"]+\.css)"/
    : /<script[^>]+src="(\/assets\/index-[^"]+\.js)"/;
  const m = String(html || "").match(re);
  return m ? m[1] : null;
}

// The device repairs itself and reloads — caches first, so that even if
// unregistering the worker fails it has nothing stale left to serve. The
// timestamp is what stops a reload loop: if a heal ran moments ago and we are
// STILL being asked for a dead name, reloading again would never terminate, so
// it gives up quietly and leaves the page as it found it.
const HEAL = `/* glidna: this chunk name is gone — repair the device and reload. */
(async () => {
  const K = "glidna-chunk-heal";
  try {
    if (Date.now() - Number(sessionStorage.getItem(K) || 0) < 60000) return;
    sessionStorage.setItem(K, String(Date.now()));
  } catch (e) {}
  try {
    if (self.caches) await Promise.all((await caches.keys()).map((k) => caches.delete(k)));
  } catch (e) {}
  try {
    if (navigator.serviceWorker) {
      const rs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(rs.map((r) => r.unregister()));
    }
  } catch (e) {}
  try { location.reload(); } catch (e) {}
})();
`;

export default async function handler(req, res) {
  const url = String(req.url || "");
  const path = url.split("?")[0];
  let qs = "";
  try { qs = new URL(url, "http://x").searchParams.get("f") || ""; } catch (e) {}
  // The rewrite passes the real filename, because a rewritten request arrives
  // here wearing the DESTINATION's url — /api/entry, which names no asset.
  const file = qs || path.split("/").pop() || "";
  const isCss = /\.css$/.test(file);
  const isJs = /\.js$/.test(file);
  const isEntry = /^index-/.test(file);

  const send = (code, type, body, extra) => {
    res.setHeader("content-type", type);
    res.setHeader("cache-control", "no-store");
    if (extra) res.setHeader("x-glidna-fallback", extra);
    res.status(code).send(body);
  };
  const nope = (why) => send(404, "text/plain; charset=utf-8", `/* glidna: ${why} */`);

  if (!isJs && !isCss) return nope("not an asset name");

  // Not the entry: nothing can stand in for it, so repair the device instead.
  // A stylesheet is not worth a reload on its own — a page missing one chunk of
  // CSS is readable, and if the JS is dead too that request heals it anyway.
  if (!isEntry) {
    return isCss
      ? send(200, "text/css; charset=utf-8", "/* glidna: stale stylesheet */\n", "heal-skip")
      : send(200, "application/javascript; charset=utf-8", HEAL, "heal");
  }

  const host = req.headers["x-forwarded-host"] || req.headers.host;
  const proto = req.headers["x-forwarded-proto"] || "https";
  const origin = `${proto}://${host}`;
  try {
    const html = await fetch(`${origin}/`, { headers: { "cache-control": "no-cache" } }).then((r) => r.text());
    const current = pickAsset(html, isCss);
    if (!current) return nope("no current entry in index.html");
    // ⚠️ A SELF-REFERENTIAL FETCH WOULD RECURSE THROUGH THE SAME REWRITE. If the
    // name we resolved is the one we were asked for, the static file is missing
    // and fetching it again would come straight back here.
    if (`/assets/${file}` === current) return nope("current entry is itself missing");
    const upstream = await fetch(`${origin}${current}`);
    if (!upstream.ok) return nope(`upstream ${upstream.status}`);
    const body = await upstream.text();
    return send(200, isCss ? "text/css; charset=utf-8" : "application/javascript; charset=utf-8", body, current);
  } catch (e) {
    return nope("lookup failed");
  }
}

export { pickAsset, HEAL };
