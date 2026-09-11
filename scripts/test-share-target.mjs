// Sharing a photo INTO Glidna from the phone's share sheet (S221).
//
// KEVIN wanted wearable/camera footage to become a logged meal. The AI half of
// that is cheap when you send FRAMES rather than video; the expensive half is
// getting the picture into the app at all. This is that path: the manifest
// registers Glidna as a share target, the service worker catches the POST and
// parks the files, and the app picks them up and hands them to the AI chat.
//
// ⚠️ THE WHOLE FEATURE IS THREE FILES AGREEING ON STRINGS NOTHING VALIDATES.
// public/manifest.webmanifest names an action path and a form field; public/sw.js
// matches that path and reads that field; src/App.jsx opens the cache sw.js
// wrote. Any one of those drifting produces the same symptom — "sharing does
// nothing" — with no error anywhere. That is what this suite exists to stop.
//
// ⚠️ AND ORDER MATTERS INSIDE sw.js. The POST handler has to sit ABOVE the
// `method !== "GET"` guard, or the guard returns without responding and the
// share goes to the network, where nothing is listening.
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const APP = readFileSync(join(ROOT, "src/App.jsx"), "utf8");
const SW = readFileSync(join(ROOT, "public/sw.js"), "utf8");
const MANIFEST = JSON.parse(readFileSync(join(ROOT, "public/manifest.webmanifest"), "utf8"));

let checks = 0, fails = 0;
const ok = (n, c, x) => { checks++; if (!c) { fails++; console.log("  FAIL:", n, x !== undefined ? JSON.stringify(x) : ""); } };

// ── 1. The manifest actually registers us ───────────────────────────────────
const st = MANIFEST.share_target;
ok("the manifest declares a share_target", !!st);
ok("it POSTs (a GET share target cannot carry files)", st && st.method === "POST");
ok("…as multipart, which is the only enctype that carries files",
   st && st.enctype === "multipart/form-data");
ok("it accepts a files param", !!(st && st.params && st.params.files && st.params.files[0]));
ok("it accepts real photo types incl. iPhone HEIC",
   st && ["image/jpeg", "image/png", "image/heic"].every((t) => st.params.files[0].accept.includes(t)),
   st && st.params.files[0].accept);

// ── 2. The three files agree ────────────────────────────────────────────────
const ACTION = st.action;                       // e.g. "/share-target"
const FIELD = st.params.files[0].name;          // e.g. "photos"
ok("sw.js matches the EXACT path the manifest posts to",
   SW.includes(`=== "${ACTION}"`), { ACTION });
ok("sw.js reads the EXACT form field the manifest names",
   SW.includes(`getAll("${FIELD}")`), { FIELD });

const swCache = (SW.match(/const SHARE = "([^"]+)"/) || [])[1];
const appCache = (APP.match(/const SHARE_CACHE = "([^"]+)"/) || [])[1];
ok("sw.js names a share cache", !!swCache);
ok("App.jsx names a share cache", !!appCache);
// ⚠️ THE ONE THAT WOULD ACTUALLY HAPPEN. Bump the cache name in sw.js during a
// later change, forget App.jsx, and every share writes to a box nothing reads.
ok("…and they are the SAME string", swCache === appCache, { swCache, appCache });

const swKey = (SW.match(/`(\/__shared\/)\$\{i\}`/) || [])[1];
const appKey = (APP.match(/`(\/__shared\/)\$\{i\}`/) || [])[1];
ok("sw.js and App.jsx agree on the per-file key prefix", !!swKey && swKey === appKey, { swKey, appKey });

// ── 3. Order and status inside the worker ───────────────────────────────────
const postAt = SW.indexOf(`req.method === "POST"`);
const guardAt = SW.indexOf(`if (req.method !== "GET") return;`);
ok("the POST branch exists", postAt !== -1);
ok("the GET guard exists", guardAt !== -1);
// ⚠️ POSITIONAL, because both lines would read fine in a diff either way.
ok("the POST branch sits ABOVE the GET guard", postAt < guardAt, { postAt, guardAt });
// [^)]* cannot span the `new URL(...)` inside the call — the first version of
// this assertion failed against correct code for that reason.
ok("the handoff is a 303, not a 302 (302 keeps the method and re-POSTs)",
   /Response\.redirect\([\s\S]*?,\s*303\)/.test(SW));
ok("the redirect carries the file count so the app knows how many to read",
   /\/\?shared=\$\{n\}/.test(SW));
// ⚠️ Without this the activate handler eats the share mid-flight.
ok("the share cache is on the activate allowlist",
   /k !== SHELL && k !== ASSETS && k !== SHARE/.test(SW));
ok("a previous share is cleared before a new one is written",
   /for \(const k of await c\.keys\(\)\) await c\.delete\(k\)/.test(SW));
// ⚠️ ORDERING, AND ONLY A RUNTIME TEST FOUND IT. req.formData() REJECTS on a
// body with no parts, so a clear written after the parse never runs on exactly
// the path that strands a photo. The assertion above was true the whole time;
// this is the one that would have caught the bug.
{
  const clearAt = SW.indexOf("for (const k of await c.keys()) await c.delete(k);");
  const parseAt = SW.indexOf("await req.formData()");
  ok("the cache is emptied BEFORE the form is parsed", clearAt !== -1 && parseAt !== -1 && clearAt < parseAt,
     { clearAt, parseAt });
}

// ── 4. RUN the app-side reader against fakes ────────────────────────────────
// ⚠️ LIFTED AND EXECUTED, not pattern-matched. A suite that asserts on a
// transcribed copy stays green while App.jsx breaks (S199k), and one that greps
// for a guard stays green when the guard becomes `if (false)`.
function liftFn(src, name) {
  const start = src.indexOf(`async function ${name}`) !== -1
    ? src.indexOf(`async function ${name}`)
    : src.indexOf(`function ${name}`);
  if (start === -1) return null;
  let depth = 0, end = -1;
  for (let j = src.indexOf("{", start); j < src.length; j++) {
    const c = src[j];
    if (c === "{") depth++;
    else if (c === "}") { depth--; if (!depth) { end = j + 1; break; } }
  }
  return end > start ? src.slice(start, end) : null;
}

const takeSrc = liftFn(APP, "takeSharedPhotos");
const stashSrc = liftFn(APP, "stashSharedIntent");
ok("takeSharedPhotos lifts cleanly", !!takeSrc);
ok("stashSharedIntent lifts cleanly", !!stashSrc);

// Fakes: a localStorage, a Cache Storage, and a downscaleImage that reports what
// it was handed so we can prove the real blob reached it.
const makeEnv = (entries, { badIndexes = [] } = {}) => {
  const store = new Map();
  const cacheEntries = new Map(entries);
  const cache = {
    async match(k) {
      if (!cacheEntries.has(k)) return undefined;
      return { async blob() { return cacheEntries.get(k); } };
    },
    async keys() { return [...cacheEntries.keys()]; },
    async delete(k) { return cacheEntries.delete(k); },
  };
  return {
    store, cacheEntries,
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    },
    caches: { async open() { return cache; } },
    downscaleImage: async (blob) => {
      const i = [...cacheEntries.values()].indexOf(blob);
      if (badIndexes.includes(i)) throw new Error("decode failed");
      return `data:image/jpeg;base64,${blob}`;
    },
  };
};

// ⚠️ EVERY FREE NAME THE LIFTED FUNCTION USES HAS TO BE SUPPLIED. Miss one and
// it throws inside its own try/catch and returns [] — which looks exactly like
// "there was nothing to read". The first run of this suite did precisely that
// (SHARED_STASH was missing) and reported six confident failures against code
// that was fine.
const appStash = (APP.match(/const SHARED_STASH = "([^"]+)"/) || [])[1];
ok("App.jsx names the stash key", !!appStash);
const runTake = async (env) => {
  const fn = new Function(
    "localStorage", "caches", "downscaleImage", "SHARE_CACHE", "SHARED_STASH",
    `${takeSrc}; return takeSharedPhotos();`
  );
  return fn(env.localStorage, env.caches, env.downscaleImage, appCache, appStash);
};

{
  // Happy path: three photos in, three data URLs out, cache emptied.
  const env = makeEnv([["/__shared/0", "AAA"], ["/__shared/1", "BBB"], ["/__shared/2", "CCC"]]);
  env.store.set(appStash, "3");
  const out = await runTake(env);
  ok("every shared photo comes back", out.length === 3, out.length);
  ok("…as data URLs the chat can attach", out.every((u) => u.startsWith("data:image/jpeg")));
  ok("…carrying the real blob contents", out[1] === "data:image/jpeg;base64,BBB", out[1]);
  ok("the cache is emptied after reading", env.cacheEntries.size === 0);
  ok("the stash is consumed", env.store.get(appStash) === undefined);
}

{
  // ⚠️ ONE BAD PHOTO MUST NOT LOSE THE SHARE. A share of four where the second
  // fails to decode should still log the other three, not drop everything.
  const env = makeEnv([["/__shared/0", "AAA"], ["/__shared/1", "BAD"], ["/__shared/2", "CCC"]], { badIndexes: [1] });
  env.store.set(appStash, "3");
  const out = await runTake(env);
  ok("a photo that won't decode is skipped, not fatal", out.length === 2, out.length);
  ok("…and the good ones are the ones kept",
     out[0].endsWith("AAA") && out[1].endsWith("CCC"), out);
  ok("the cache is still emptied", env.cacheEntries.size === 0);
}

{
  // A second read finds nothing — this is what makes several mount sites safe.
  const env = makeEnv([["/__shared/0", "AAA"]]);
  env.store.set(appStash, "1");
  const first = await runTake(env);
  const second = await runTake(env);
  ok("the first reader gets the share", first.length === 1);
  ok("a second reader gets nothing (no double-attach)", second.length === 0, second);
}

{
  // Nothing shared at all.
  const env = makeEnv([]);
  const out = await runTake(env);
  ok("no stash means no work and no throw", Array.isArray(out) && out.length === 0);
}

{
  // The redirect said 2 but only 1 survived — read what is there, clear the rest.
  const env = makeEnv([["/__shared/0", "AAA"]]);
  env.store.set(appStash, "2");
  const out = await runTake(env);
  ok("a missing file is skipped rather than throwing", out.length === 1, out.length);
  ok("the cache is emptied even on a partial share", env.cacheEntries.size === 0);
}

// ── 5. RUN the stash side ───────────────────────────────────────────────────
const runStash = (href) => {
  const env = makeEnv([]);
  let replaced = null;
  const win = {
    location: { search: new URL(href).search, href },
    history: { replaceState: (_a, _b, u) => { replaced = u; } },
  };
  const fn = new Function("window", "localStorage", "URL", "URLSearchParams", "SHARED_STASH",
    `${stashSrc}; return stashSharedIntent();`);
  fn(win, env.localStorage, URL, URLSearchParams, appStash);
  return { stashed: env.store.get(appStash), replaced };
};

{
  const r = runStash("https://glidna.com/?shared=3");
  ok("a ?shared=N arrival is stashed", r.stashed === "3", r.stashed);
  // ⚠️ The marker must leave the URL, or a later reload re-opens the chat with a
  // share that was already logged.
  ok("…and the marker is stripped from the URL", r.replaced && !/shared=/.test(r.replaced), r.replaced);
}
{
  const r = runStash("https://glidna.com/?shared=0");
  ok("a share that carried no files stashes nothing", r.stashed === undefined);
}
{
  const r = runStash("https://glidna.com/?invite=ABC");
  ok("an ordinary visit is untouched", r.stashed === undefined && r.replaced === null);
}

// ── 6. The app actually consumes it ─────────────────────────────────────────
ok("the intent is captured at import, beside the other deep links",
   /stashNotifIntent\(\);\s*\n(?:\/\/[^\n]*\n)*stashSharedIntent\(\);/.test(APP));
// ⚠️ THIS ASSERTION CAUGHT A REAL CHANGE AND THEN NEEDED UPDATING ITSELF (S222).
// It used to match `takeSharedPhotos().then(`, which stopped being true the
// moment the iOS inbox joined the same effect. The behaviour was still correct —
// the assertion was describing a call SHAPE rather than the invariant. What
// actually matters is that the share cache is drained on mount, whatever else
// is drained alongside it.
// ⚠️ AND `check:weak` THEN FLAGGED THE REPLACEMENT, which is the tool earning
// its keep. A bare /takeSharedPhotos\(\)/ matches THREE times in App.jsx — the
// declaration, a comment about it, and the actual call — so deleting the call
// would have left this green. Anchored to the drain effect and COUNTED, it goes
// red whether the call is removed or accidentally duplicated.
// ⚠️ AND MY FIRST REPLACEMENT WAS ALSO WRONG. Anchoring on
// /useEffect\(\(\) => \{\s*let alive = true;/ matched a DIFFERENT effect —
// `let alive = true` is a common shape in this file and String.match returns the
// first hit in the document, not the one you meant. Anchor on the call itself.
{
  const NEEDLE = "Promise.allSettled([takeSharedPhotos(), takeInboxPhotos()])";
  const at = APP.indexOf(NEEDLE);
  ok("the share cache is drained on mount, alongside the iOS inbox", at !== -1);
  // Counted: a second drain site would attach the same photo twice.
  ok("…from exactly one place", APP.split(NEEDLE).length - 1 === 1,
     APP.split(NEEDLE).length - 1);
  const around = at === -1 ? "" : APP.slice(Math.max(0, at - 500), at + 700);
  ok("…inside a mount effect (empty dep array)",
     /useEffect\(\(\) => \{/.test(around) && /\}, \[\]\);/.test(around), );
  ok("…and what it finds is attached as pending photos", /setPendingImages/.test(around));
}
ok("…attaches them as pending photos", /setPendingImages\(\(prev\) => \[\.\.\.prev, \.\.\.urls\]/.test(APP));
ok("…and opens itself so the person sees what arrived", /setPendingImages[\s\S]{0,120}setOpen\(true\)/.test(APP));
ok("the attach respects the 20-photo message cap", /\.\.\.urls\]\.slice\(0, 20\)/.test(APP));

console.log(`${checks - fails}/${checks} share-target assertions passed`);
if (fails) process.exit(1);
