// The PWA "a newer version is ready" path (S218).
//
// Kevin, on his iPad: "it constantly says that an update is available, and when i
// select update the message for an update being available still pops up."
//
// The old trigger was `controllerchange`, which is not a new version. It was
// wrong in BOTH directions and this suite pins both:
//
//   FALSE POSITIVE — iOS restarts service workers, each re-claim fired the
//   banner, and Update could never clear it because nothing had changed.
//
//   FALSE NEGATIVE — public/sw.js is static, so a normal deploy leaves it
//   byte-identical (verified against the live site). No new worker, no
//   controllerchange: the banner could never once have announced a real release.
//
// The trigger is now a comparison of the DEPLOYED entry chunk against the
// running one. Vite content-hashes it, so the filename is the build identity.
//
// ⚠️ THE PROBE FAILS SILENTLY WHEN ITS REGEX STOPS MATCHING, which is exactly
// what happened while writing it: `[^"]+\/assets\/` requires a character BEFORE
// "/assets/", and the src starts with it. Nothing throws — the app simply never
// reports an update again. So the regex is lifted from the shipping source and
// RUN against the real HTML, never eyeballed.
import { readFileSync, existsSync } from "node:fs";

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; }
  else { fail++; console.log(`  FAIL: ${name}`, extra === undefined ? "" : extra); }
};

const MAIN = readFileSync(new URL("../src/main.jsx", import.meta.url), "utf8");
const APP = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
const SW = readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");

// ── The entry-chunk probe ────────────────────────────────────────────────────
// Lift the literal out of main.jsx and run THAT, so a future edit to it is what
// this suite is testing — not a copy that can drift.
const lit = MAIN.match(/const m = html\.match\((\/.*?\/)\)\n/);
ok("found the probe regex in main.jsx", !!lit, MAIN.slice(MAIN.indexOf("html.match"), MAIN.indexOf("html.match") + 120));
const probe = new RegExp(lit[1].slice(1, -1));

// The exact shape Vite emits — type, then crossorigin, then src, and the src
// begins at "/assets/" with nothing in front of it.
const VITE_HTML = `<!doctype html><html><head>
<script type="module" crossorigin src="/assets/index-6LpOtoCV.js"></script>
<link rel="modulepreload" crossorigin href="/assets/react-CepXLKLB.js">
</head><body></body></html>`;
const m1 = VITE_HTML.match(probe);
ok("the probe matches the tag Vite actually emits", !!m1, VITE_HTML);
ok("...and captures the hashed entry chunk", m1 && m1[1] === "/assets/index-6LpOtoCV.js", m1 && m1[1]);

// ⚠️ NEGATIVE CONTROL. The regex that shipped for ten minutes required a
// character before /assets/. If this ever stops failing, the control is dead and
// the assertion above proves nothing.
const BROKEN = /<script[^>]+type="module"[^>]+src="([^"]+\/assets\/[^"]+)"/;
ok("(control) the `[^\"]+` variant cannot match its own target", !BROKEN.test(VITE_HTML));

// A modulepreload link must not be mistaken for the entry script.
ok("a modulepreload link is not mistaken for the entry",
   (VITE_HTML.match(new RegExp(probe.source, "g")) || []).length === 1);

// An inline pre-paint script (index.html has one) must not swallow the match.
const WITH_INLINE = VITE_HTML.replace("<head>", "<head>\n<script>document.documentElement.dataset.x=1</script>");
const m2 = WITH_INLINE.match(probe);
ok("an inline script before it does not break the match",
   m2 && m2[1] === "/assets/index-6LpOtoCV.js", m2 && m2[1]);

// And against the real built file when one is present.
if (existsSync(new URL("../dist/index.html", import.meta.url))) {
  const built = readFileSync(new URL("../dist/index.html", import.meta.url), "utf8");
  const m3 = built.match(probe);
  ok("the probe matches the REAL built dist/index.html", !!m3, built.slice(0, 300));
  ok("...and what it captures is a hashed asset path",
     m3 && /^\/assets\/index-[A-Za-z0-9_-]+\.js$/.test(m3[1]), m3 && m3[1]);
}

// The running side must select the same element the probe parses.
ok("the running entry is read with a selector that matches that tag",
   /querySelector\('script\[type="module"\]\[src\*="\/assets\/"\]'\)/.test(MAIN));

// ── The trigger is a version comparison, not a controller change ─────────────
ok("the banner fires only when the deployed entry differs from the running one",
   /if \(m && m\[1\] !== runningEntry\) announce\(\)/.test(MAIN));
// ⚠️ COUNTED. controllerchange may still PROMPT a check — it just may not be the
// signal. If a future edit puts announce()/__glidnaUpdateReady back inside that
// listener, this goes red.
{
  const i = MAIN.indexOf("addEventListener('controllerchange'");
  ok("controllerchange is still observed", i > 0);
  const body = MAIN.slice(i, i + 160);
  ok("...but it only re-checks, and never announces by itself",
     /check\(\)/.test(body) && !/announce\(\)/.test(body) && !/__glidnaUpdateReady = true/.test(body), body);
}
ok("nothing else sets the ready flag",
   (MAIN.match(/__glidnaUpdateReady = true/g) || []).length === 1);
ok("the probe never cries wolf when it cannot identify the running build",
   /if \(!runningEntry\) return/.test(MAIN));
ok("a failed probe is silent rather than an update claim",
   /catch \{ \/\* offline, or the probe failed — say nothing \*\/ \}/.test(MAIN));

// ── Update must actually deliver the new version ─────────────────────────────
// sw.js answers navigations network-first but RACED against a 1.2s timeout, so a
// plain reload can be served the cached shell — the very HTML we just proved
// stale. The shell has to go first.
ok("sw.js really does race the navigation against a timeout (the reason for the above)",
   /SHELL_TIMEOUT_MS/.test(SW) && /Promise\.race/.test(SW));
ok("applying an update drops the cached shell before reloading",
   /k\.startsWith\('glidna-shell'\)/.test(MAIN)
   && MAIN.indexOf("caches.delete(k)") < MAIN.indexOf("window.location.reload()"));
ok("...and the hashed asset cache is deliberately kept",
   !/glidna-assets/.test(MAIN));
ok("the shell cache name in sw.js still starts with that prefix",
   /const SHELL = "glidna-shell/.test(SW));
ok("the Update button routes through it, with a plain reload as the fallback",
   /window\.__glidnaApplyUpdate; if \(f\) f\(\); else window\.location\.reload\(\)/.test(APP));

// ── The probe must not be answerable from cache ──────────────────────────────
ok("the version probe bypasses the HTTP cache", /fetch\('\/', \{ cache: 'no-store' \}\)/.test(MAIN));
// A plain fetch is not mode:'navigate' and "/" is not under /assets/, so sw.js
// passes it to the network. Pin the two branches that make that true.
ok("sw.js only intercepts navigations for the shell", /req\.mode === "navigate"/.test(SW));
ok("...and only /assets/ for the cache-first branch", /url\.pathname\.startsWith\("\/assets\/"\)/.test(SW));
ok("...everything else goes straight to the network", /straight to network, never cached/.test(SW));

// ── Rate limiting ────────────────────────────────────────────────────────────
// visibilitychange fires on every app switch; the probe is a network round-trip.
ok("the check is rate-limited", /now - lastCheck < 30000/.test(MAIN));
ok("...but an explicit request bypasses the limit",
   /__glidnaCheckUpdate = \(\) => \{ lastCheck = 0; return check\(\) \}/.test(MAIN));

console.log(`\n  ${pass}/${pass + fail} checks passed`);
console.log("  PWA updates: announced when true, and applied when tapped.\n");
if (fail) process.exit(1);
