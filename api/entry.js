// Serve the CURRENT entry chunk when a DEAD one is asked for (S235).
//
// Kevin, on his phone: "it loads for a second and the screen goes blank… it is
// going in and out." Intermittent, which is the signature of a race rather than
// a crash. The service worker can serve an HTML shell cached from an earlier
// deploy, and Vercel serves only the current deployment's assets — so every
// hashed chunk that shell names returns 404, the module never loads, and #root
// stays empty. S234 fixed the worker, but a fixed worker only helps once the
// device installs it, and a blank app cannot ask for anything.
//
// ⚠️ THIS IS THE HALF THAT NEEDS NOTHING FROM THE DEVICE. A rewrite in
// vercel.json sends any unmatched /assets/index-*.js|css here, and rewrites only
// fire when no static file matched — so a live chunk is never touched and this
// runs exclusively on names that would otherwise 404. Instead of nothing, the
// browser gets the current entry, the stale shell boots, and the worker's own
// "refresh the shell on every successful navigation" then repairs the cache. One
// boot, and the device is permanently back on current names.
//
// ⚠️ RELATIVE IMPORTS STILL RESOLVE, which is what makes this safe. A module's
// imports resolve against its URL, and every chunk lives in /assets/ — so the
// current entry served under a dead /assets/ name finds ./App-*.js exactly as it
// would under its own.
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

export default async function handler(req, res) {
  const url = String(req.url || "");
  const wantCss = /\.css(?:$|\?)/.test(url.split("?")[0]) || /[?&]css=1/.test(url);
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  const proto = req.headers["x-forwarded-proto"] || "https";
  const origin = `${proto}://${host}`;
  const nope = (why) => {
    res.setHeader("cache-control", "no-store");
    res.status(404).send(`/* glidna: ${why} */`);
  };
  try {
    const html = await fetch(`${origin}/`, { headers: { "cache-control": "no-cache" } }).then((r) => r.text());
    const current = pickAsset(html, wantCss);
    if (!current) return nope("no current entry in index.html");
    // ⚠️ A SELF-REFERENTIAL FETCH WOULD RECURSE THROUGH THE SAME REWRITE. If the
    // name we resolved is the one we were asked for, the static file is missing
    // and fetching it again would come straight back here.
    if (url.split("?")[0] === current) return nope("current entry is itself missing");
    const upstream = await fetch(`${origin}${current}`);
    if (!upstream.ok) return nope(`upstream ${upstream.status}`);
    const body = await upstream.text();
    res.setHeader("content-type", wantCss ? "text/css; charset=utf-8" : "application/javascript; charset=utf-8");
    res.setHeader("cache-control", "no-store");
    res.setHeader("x-glidna-fallback", current);
    return res.status(200).send(body);
  } catch (e) {
    return nope("lookup failed");
  }
}

export { pickAsset };
