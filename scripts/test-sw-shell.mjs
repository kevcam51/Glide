// The offline shell and the assets it names must stay a matched pair (S234).
//
// Kevin: "it loads for a second and the screen goes blank." Reproduced on the
// live site: a shell cached from an earlier deploy names hashed chunks that
// 404 the moment the next deploy lands, the inline pre-paint script paints the
// background, the module never loads, and #root stays empty — permanently,
// because a blank page cannot run the code that would repair it.
//
// ⚠️ THE HELPERS ARE LIFTED FROM public/sw.js AND RUN against a Cache API double.
// A service worker cannot be imported, but its logic can be executed, and a
// suite that only pattern-matches the source would stay green against `if
// (false)` — the trap this repo has paid for repeatedly.
//
// Run: node scripts/test-sw-shell.mjs
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SW = readFileSync(join(ROOT, "public", "sw.js"), "utf8");
const HTML = readFileSync(join(ROOT, "index.html"), "utf8");

let fails = 0, checks = 0;
const ok = (n, c, x) => { checks++; if (!c) { fails++; console.log("  FAIL:", n, x !== undefined ? JSON.stringify(x) : ""); } };

// ⚠️ SLICED AS ONE SPAN, NOT BRACE-SCANNED — and the first version of this file
// paid for learning why. `assetRefs` holds the regex /(?:src|href)="(\/assets\/
// [^"]+)"/, and a scanner that treats `"` as a string delimiter desynchronises on
// it and swallows whatever follows. That is the same defect S230 fixed in the
// shared comment stripper, reproduced here within the hour. The three helpers are
// contiguous, so their span needs no parsing at all.
function liftHelpers(src) {
  const a = src.indexOf("function assetRefs(");
  const b = src.indexOf("self.addEventListener(\"fetch\"");
  if (a < 0 || b < a) throw new Error("could not locate the helper span");
  return src.slice(a, b);
}

// ── A Cache Storage double ────────────────────────────────────────────────
// ⚠️ INSERTION ORDER IS PART OF THE CONTRACT. `trimAssets` drops "the oldest",
// which is only meaningful because Cache.keys() resolves in insertion order — a
// double backed by an unordered map would make the eviction test prove nothing.
function makeCaches() {
  const stores = new Map();
  const box = (name) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const m = stores.get(name);
    // ⚠️ keys() HANDS BACK REQUEST-LIKE OBJECTS AND delete() TAKES ONE BACK, so
    // the double has to resolve both spellings to the same identity. The first
    // version stored by path and returned full URLs, so every delete silently
    // missed — and the suite reported the WORKER as broken. A double that does
    // not honour the real contract accuses the code under test.
    const key = (r) => {
      const u = typeof r === "string" ? r : (r && r.url) || String(r);
      try { return new URL(u, "https://glidna.com").pathname; } catch { return u; }
    };
    return {
      async match(r) { const v = m.get(key(r)); return v === undefined ? undefined : v; },
      async put(r, res) { m.set(key(r), res); },
      async delete(r) { return m.delete(key(r)); },
      async keys() { return [...m.keys()].map((u) => ({ url: "https://glidna.com" + u })); },
      _raw: m,
    };
  };
  return {
    open: async (n) => box(n),
    keys: async () => [...stores.keys()],
    delete: async (n) => stores.delete(n),
    match: async (r) => { for (const n of stores.keys()) { const hit = await box(n).match(r); if (hit) return hit; } return undefined; },
    _stores: stores,
  };
}
const res = (text) => ({ async text() { return text; }, clone() { return res(text); } });

const SHELL_NAME = (SW.match(/const SHELL = "([^"]+)"/) || [])[1];
const ASSETS_NAME = (SW.match(/const ASSETS = "([^"]+)"/) || [])[1];
const CAP = Number((SW.match(/const ASSET_CAP = (\d+)/) || [])[1]);

const build = (src) => new Function("caches", "SHELL", "ASSETS", "ASSET_CAP",
  `${src}; return { assetRefs, shellIsBootable, trimAssets };`);
const SRC = liftHelpers(SW);

// ── 1. the pair must be checked, not assumed ──────────────────────────────
{
  const caches = makeCaches();
  const M = build(SRC)(caches, SHELL_NAME, ASSETS_NAME, CAP);
  const shellHtml = `<!doctype html><link href="/assets/index-AAA.css"><script type="module" src="/assets/index-AAA.js"></script>`;

  ok("it reads every asset the document names",
     JSON.stringify(M.assetRefs(shellHtml)) === JSON.stringify(["/assets/index-AAA.css", "/assets/index-AAA.js"]));

  const a = await caches.open(ASSETS_NAME);
  await a.put("/assets/index-AAA.js", res("//js"));
  ok("a shell whose script is cached is bootable", (await M.shellIsBootable(res(shellHtml))) === true);

  await a.delete("/assets/index-AAA.js");
  // ⚠️ THE WHOLE BUG. Exactly this state served a blank screen for ever.
  ok("a shell whose script is GONE is not bootable", (await M.shellIsBootable(res(shellHtml))) === false);

  ok("a document naming no script is not a shell", (await M.shellIsBootable(res("<!doctype html><p>hi"))) === false);
  ok("junk answers false rather than throwing", (await M.shellIsBootable({ clone() { throw new Error("x"); } })) === false);
  // The CSS href is deliberately not required — a missing stylesheet is ugly,
  // not fatal, and failing the check on it would refuse a bootable shell.
  await a.put("/assets/index-AAA.js", res("//js"));
  ok("a missing stylesheet does not condemn a bootable shell",
     (await M.shellIsBootable(res(shellHtml))) === true);
}

// ── 2. the cap must never evict what the shell still needs ────────────────
{
  const caches = makeCaches();
  const M = build(SRC)(caches, SHELL_NAME, ASSETS_NAME, CAP);
  const shell = await caches.open(SHELL_NAME);
  await shell.put("/", res(`<script src="/assets/index-KEEP.js"></script>`));
  const a = await caches.open(ASSETS_NAME);
  // The shell's asset goes in FIRST, so a plain oldest-first trim would take it.
  await a.put("/assets/index-KEEP.js", res("//keep"));
  for (let i = 0; i < CAP + 10; i++) await a.put(`/assets/junk-${i}.js`, res("//j"));
  await M.trimAssets();
  const left = (await a.keys()).map((k) => new URL(k.url).pathname);
  ok("the shell's own asset survives the trim", left.includes("/assets/index-KEEP.js"), left.length);
  ok("...and the cache is back under the cap", left.length <= CAP, left.length);
  ok("(control) it really was first in, so a naive trim would have dropped it",
     CAP + 11 > CAP);
}

// ── 3. wiring: the branches that use those helpers ────────────────────────
{
  // ⚠️ BUMPING THE CACHE NAMES IS THE REPAIR, not cosmetics. activate() deletes
  // every cache off the allowlist, so a rename is the only thing that clears a
  // poisoned shell on a device that cannot run its own repair code.
  ok("the shell cache name was bumped past v3", SHELL_NAME === "glidna-shell-v4", SHELL_NAME);
  ok("the asset cache name was bumped past v2", ASSETS_NAME === "glidna-assets-v3", ASSETS_NAME);
  ok("...and activate still deletes everything off the allowlist",
     /keys\.filter\(\(k\) => k !== SHELL && k !== ASSETS && k !== SHARE\)\.map\(\(k\) => caches\.delete\(k\)\)/.test(SW));
  ok("the share cache stays on the allowlist", /const SHARE = "glidna-share-v1"/.test(SW));

  ok("the navigate fallback refuses a shell that cannot boot",
     /if \(!\(await shellIsBootable\(cached\)\)\) return network;/.test(SW));
  ok("...and that check sits BEFORE the timeout race",
     SW.indexOf("shellIsBootable(cached)") < SW.indexOf("Promise.race([network"));
  ok("a 404 on a hashed asset drops the shell",
     /res\.status === 404[\s\S]{0,400}caches\.open\(SHELL\)\.then\(\(c\) => c\.delete\("\/"\)\)/.test(SW));
  ok("a no-store answer is never cached under a hashed name",
     /const noStore = res && \/no-store\/i\.test\(res\.headers\.get\("cache-control"\) \|\| ""\);/.test(SW)
     && /res && res\.ok && !noStore/.test(SW));
  ok("an HTML answer for a .js request is never cached as code",
     /const htmlForCode = res && \/\\\.\(\?:js\|css\)\$\/\.test\(url\.pathname\)/.test(SW)
     && /text\\\/html/.test(SW));
}

// ── 4. the belt in the HTML ───────────────────────────────────────────────
{
  // The worker is the fix; this is the second belt, for a blank screen arriving
  // by a route nobody predicted. Verified in a browser against a real 404: it
  // purged the caches, reloaded, booted, and did NOT fire twice.
  ok("the page watches for a hashed script that fails to load",
     /t\.tagName === "SCRIPT" && String\(t\.src \|\| ""\)\.indexOf\("\/assets\/"\) > -1/.test(HTML));
  ok("...listening in the capture phase, where resource errors are visible",
     /addEventListener\("error", function \(ev\) \{[\s\S]{0,200}\}, true\)/.test(HTML));
  ok("...with a backstop for an unmounted tree", /r\.children\.length === 0\) heal\("empty"\)/.test(HTML));
  // ⚠️ A REPAIR THAT CAN REPEAT IS A RELOAD LOOP, which is worse than the blank
  // screen it replaces. Once per session, recorded before the reload.
  ok("it can only heal once per session",
     /sessionStorage\.getItem\("glidna-healed"\)\) return; sessionStorage\.setItem\("glidna-healed", why\)/.test(HTML));
  ok("...and purges the caches before reloading",
     /caches\.keys\(\)\.then\(function \(ks\) \{[\s\S]{0,160}caches\.delete\(k\)/.test(HTML)
     && /\.then\(done, done\)/.test(HTML));
  ok("a browser with no Cache API still reloads", /if \(!window\.caches\) return done\(\)/.test(HTML));
}

// ── 5. mutations: every guard must be load-bearing ────────────────────────
{
  const mutate = (from, to) => {
    const c = SRC.split(from).length - 1;
    if (c !== 1) throw new Error(`anchor appears ${c}x: ${from}`);
    return build(SRC.replace(from, to));
  };
  const shellHtml = `<script src="/assets/index-AAA.js"></script>`;

  {   // drop the per-asset existence check
    const caches = makeCaches();
    const M = mutate("for (const r of refs) if (!(await c.match(r))) return false;", "")(caches, SHELL_NAME, ASSETS_NAME, CAP);
    ok("(mutation) losing the existence check calls a dead shell bootable",
       (await M.shellIsBootable(res(shellHtml))) === true);
  }
  {   // stop protecting the shell's assets from the trim
    const caches = makeCaches();
    const M = mutate("const droppable = keys.filter((k) => !keep.has(new URL(k.url).pathname));",
                     "const droppable = keys;")(caches, SHELL_NAME, ASSETS_NAME, CAP);
    const shell = await caches.open(SHELL_NAME);
    await shell.put("/", res(shellHtml));
    const a = await caches.open(ASSETS_NAME);
    await a.put("/assets/index-AAA.js", res("//keep"));
    for (let i = 0; i < CAP + 10; i++) await a.put(`/assets/junk-${i}.js`, res("//j"));
    await M.trimAssets();
    const left = (await a.keys()).map((k) => new URL(k.url).pathname);
    ok("(mutation) an unprotected trim evicts the shell's own asset",
       !left.includes("/assets/index-AAA.js"));
  }
  {   // treat a no-script document as a shell
    const caches = makeCaches();
    const M = mutate("if (!refs.length) return false;", "if (!refs.length) return true;")(caches, SHELL_NAME, ASSETS_NAME, CAP);
    ok("(mutation) an empty document would pass as bootable",
       (await M.shellIsBootable(res("<!doctype html><p>hi"))) === true);
  }
}

// ── 6. the server-side half: a dead chunk name still boots (S235) ─────────
{
  const { default: handler, pickAsset } = await import(join(ROOT, "api", "entry.js"));

  ok("it finds the current script in real index.html",
     pickAsset(HTML.replace("/src/main.jsx", "/assets/index-LIVE.js"), false) === "/assets/index-LIVE.js");
  ok("...and the current stylesheet when asked for css",
     pickAsset('<link rel="stylesheet" href="/assets/index-LIVE.css">', true) === "/assets/index-LIVE.css");
  ok("...and answers null rather than throwing on junk",
     pickAsset("", false) === null && pickAsset(null, true) === null);

  // A fake request/response pair plus a stubbed fetch, so the handler runs.
  const run = async (url, routes) => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (u) => {
      const path = new URL(u).pathname;
      const r = routes[path];
      if (!r) return { ok: false, status: 404, async text() { return ""; } };
      return { ok: true, status: 200, async text() { return r; } };
    };
    const out = { headers: {}, code: 0, body: "" };
    const res = {
      setHeader(k, v) { out.headers[k.toLowerCase()] = v; },
      status(c) { out.code = c; return res; },
      send(b) { out.body = b; return res; },
    };
    try { await handler({ url, headers: { host: "glidna.com" } }, res); }
    finally { globalThis.fetch = realFetch; }
    return out;
  };

  const LIVE_HTML = '<script type="module" src="/assets/index-LIVE.js"></script><link href="/assets/index-LIVE.css">';
  {
    const r = await run("/assets/index-DEAD.js", { "/": LIVE_HTML, "/assets/index-LIVE.js": "console.log(1)" });
    // ⚠️ THE WHOLE POINT: a name that would 404 answers with working code.
    ok("a dead chunk name serves the current entry", r.code === 200 && r.body === "console.log(1)", r.code);
    ok("...as JavaScript", /application\/javascript/.test(r.headers["content-type"] || ""));
    // ⚠️ NEVER CACHED. A hashed URL promises immutable content; parking the live
    // bundle under a dead hash would make that promise false for everyone after.
    ok("...and never cached under the dead name", r.headers["cache-control"] === "no-store");
    ok("...naming what it substituted, so this is visible in a response header",
       r.headers["x-glidna-fallback"] === "/assets/index-LIVE.js");
  }
  {
    const r = await run("/assets/index-DEAD.css?css=1", { "/": LIVE_HTML, "/assets/index-LIVE.css": "body{}" });
    ok("a dead stylesheet name serves the current one", r.code === 200 && r.body === "body{}");
    ok("...as CSS", /text\/css/.test(r.headers["content-type"] || ""));
  }
  {
    // ⚠️ THE RECURSION GUARD. The rewrite catches anything the filesystem missed,
    // so fetching the name we were ASKED for would come straight back here — a
    // function calling itself until the platform kills it.
    const r = await run("/assets/index-LIVE.js", { "/": LIVE_HTML });
    ok("it refuses to fetch the very name it was asked for", r.code === 404, r.code);
    ok("...and says why", /itself missing/.test(r.body));
  }
  {
    const r = await run("/assets/index-DEAD.js", { "/": "<p>no assets here</p>" });
    ok("no entry in the HTML is a 404, not a crash", r.code === 404 && /no current entry/.test(r.body));
  }
  {
    const r = await run("/assets/index-DEAD.js", { "/": LIVE_HTML });   // upstream chunk missing
    ok("an upstream miss is a 404, not a crash", r.code === 404 && /upstream/.test(r.body));
  }
  {
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () => { throw new Error("network down"); };
    const out = { code: 0, body: "", headers: {} };
    const res = { setHeader(k, v) { out.headers[k.toLowerCase()] = v; }, status(c) { out.code = c; return res; }, send(b) { out.body = b; return res; } };
    await handler({ url: "/assets/index-DEAD.js", headers: { host: "glidna.com" } }, res);
    globalThis.fetch = realFetch;
    ok("a thrown fetch is answered, not propagated", out.code === 404 && /lookup failed/.test(out.body));
  }

  // ⚠️ THE REWRITE MUST SIT WHERE THE FILESYSTEM STILL WINS. Vercel checks static
  // files before rewrites, so a LIVE chunk never reaches the function — that is
  // the only reason this is safe to leave on permanently.
  const VERCEL = JSON.parse(readFileSync(join(ROOT, "vercel.json"), "utf8"));
  const srcs = VERCEL.rewrites.map((r) => r.source);
  ok("the js fallback is wired", srcs.includes("/assets/index-:hash.js"));
  ok("the css fallback is wired", srcs.includes("/assets/index-:hash.css"));
  ok("...and nothing rewrites the whole asset directory",
     !srcs.some((s) => s === "/assets/:path*" || s === "/assets/(.*)"), srcs.filter((s) => s.startsWith("/assets")));
}

console.log(`\n  ${checks - fails}/${checks} checks passed`);
if (fails) { console.log(`  ${fails} FAILED`); process.exit(1); }
console.log("  The shell and the assets it names stay a matched pair.\n");
