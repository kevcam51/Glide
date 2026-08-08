// Glide AI chat — Stage 2 (function-calling / data-aware tools).
//
// These tools let the AI read REAL user data from Firestore (meal logs,
// nutrition targets, client activity) so it can answer "what did I eat this
// week?" or "which clients haven't logged?". They are executed inside the
// aiChat Cloud Function via the Anthropic function-calling loop.
//
// SECURITY (the important part — enforced here, not by the model):
//   • A CLIENT caller can only ever read their OWN data. Any clientId the model
//     passes is ignored — the tools always use request.auth.uid.
//   • A TRAINER/ADMIN caller may read a specific client only after we verify
//     that client is actually assigned to them (assignedTrainerId / headTrainerId,
//     or admin). An unauthorized clientId returns an error to the model, never data.
// The model cannot override this by "asking nicely" — scoping happens server-side.

const admin = require("firebase-admin");
const { CARDIO, STRENGTH, CARDIO_IDS, STRENGTH_IDS, MET } = require("./exercises");

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

// Micronutrients the AI can estimate + store on a logged meal. Keys/units MATCH
// the frontend MICRO_DEFS (src/App.jsx) so AI-logged micros roll straight into
// the daily micronutrient bars. (Kevin: AI-logged meals were saving macros but
// ~0 micros — e.g. sodium showed near zero.)
const MICRO_UNITS = { fiber: "g", sugar: "g", satFat: "g", transFat: "g", monoFat: "g", polyFat: "g",
  cholesterol: "mg", sodium: "mg", potassium: "mg", calcium: "mg", iron: "mg", magnesium: "mg", zinc: "mg",
  phosphorus: "mg", selenium: "µg", copper: "mg", manganese: "mg", vitA: "µg", vitC: "mg", vitD: "µg",
  vitE: "mg", vitK: "µg", b1: "mg", b2: "mg", b3: "mg", b6: "mg", b12: "µg", folate: "µg", choline: "mg", caffeine: "mg" };
const MICRO_KEYS = Object.keys(MICRO_UNITS);
const MICRO_SCHEMA = {
  type: "object",
  description: "Estimated micronutrients for the WHOLE meal (totals, not per-100g). Fill in every one you can reasonably estimate — ALWAYS include sodium, potassium, fiber, sugar, saturated fat, cholesterol, calcium, and iron, plus notable vitamins/minerals for the foods involved. Each value is in the unit named in its property description (g / mg / µg).",
  properties: Object.fromEntries(MICRO_KEYS.map((k) => [k, { type: "number", description: MICRO_UNITS[k] }])),
};
// Keep only known micro keys carrying a positive finite number.
function sanitizeMicros(m) {
  if (!m || typeof m !== "object") return null;
  const out = {};
  for (const k of MICRO_KEYS) {
    const v = Number(m[k]);
    if (Number.isFinite(v) && v > 0) out[k] = Math.round(v * 100) / 100;
  }
  return Object.keys(out).length ? out : null;
}

// id → display label (for rendering a proposed program on the confirmation card).
const EX_LABEL = {};
for (const e of CARDIO) EX_LABEL[e.id] = e.label;
for (const e of STRENGTH) EX_LABEL[e.id] = e.label;

// ── fetch_link: read a shared URL's text (title + description/caption) ─────────
// Lets the AI turn a workout/recipe LINK into program changes. We only extract
// meta/description text (what any link-preview crawler reads) — never return raw
// page bodies — and cap size/time. The workout is almost always in the caption,
// so text is enough; we don't download or "watch" the video.
const HTML_ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", apos: "'", nbsp: " " };
function decodeEntities(s) {
  return String(s || "")
    .replace(/&(#\d+|#x[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, e) => {
      if (e[0] === "#") {
        const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : m;
      }
      return Object.prototype.hasOwnProperty.call(HTML_ENTITIES, e) ? HTML_ENTITIES[e] : m;
    })
    .replace(/\\u[0-9a-fA-F]{4}/g, (m) => String.fromCharCode(parseInt(m.slice(2), 16))) // JSON \uXXXX (YouTube shortDescription)
    .replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\\//g, "/");
}
// Pull a <meta property|name="key" content="..."> value (either attribute order).
function metaContent(html, key) {
  const k = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  let m = html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${k}["'][^>]*\\bcontent=["']([^"']*)["']`, "i"));
  if (m) return decodeEntities(m[1]).trim();
  m = html.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${k}["']`, "i"));
  return m ? decodeEntities(m[1]).trim() : "";
}
// fetch with a hard timeout — an outbound API that hangs must not stall a chat
// turn until the function's own timeout (dead spinner + wasted tokens).
async function fetchWithTimeout(url, opts = {}, ms = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
// Reject links that could point at internal/cloud-metadata hosts (SSRF).
function isBlockedHost(host) {
  const h = (host || "").toLowerCase();
  if (!h || !h.includes(".")) return true;                 // no TLD (e.g. "localhost", bare hostnames)
  if (h === "metadata.google.internal" || h.endsWith(".internal") || h.endsWith(".local")) return true;
  if (/^(127\.|10\.|0\.|169\.254\.|192\.168\.)/.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
  if (/^\[?::1\]?$/.test(h) || h.startsWith("fd") || h.startsWith("fe80")) return true; // IPv6 loopback/private
  return false;
}
// ── Phase 2 (docs/VIDEO-LINK-INGEST.md): social caption auto-fetch ──────────────
// TikTok/Instagram block normal server fetches of their pages, but the CAPTION
// (where the workout/recipe lives) is reachable another way: TikTok has an open
// oEmbed endpoint (no key; caption = title), and Instagram exposes a public
// embed page (plus an official oEmbed if an IG_OEMBED_TOKEN Meta app token is
// ever provisioned). Everything here is best-effort: any failure returns null
// and fetchLinkMeta falls through to the normal fetch + paste-the-caption path.
const stripTags = (s) => decodeEntities(String(s || "").replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, " ")).replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();
async function fetchSocialCaption(u) {
  const host = u.hostname.replace(/^www\./, "").toLowerCase();
  const note = "This is the post's caption, auto-fetched. Extract any exercises, workouts, or foods from it and offer to add them with the normal tools. If it's thin or clearly incomplete, ask the user to paste the full caption.";
  try {
    if (host === "tiktok.com" || host.endsWith(".tiktok.com")) {
      const r = await fetchWithTimeout(`https://www.tiktok.com/oembed?url=${encodeURIComponent(u.toString())}`, {}, 6000);
      if (!r.ok) return null;
      const j = await r.json().catch(() => null);
      if (!j || !(j.title || "").trim()) return null;
      return { url: u.toString(), siteName: "TikTok",
        title: j.author_name ? `TikTok video by ${j.author_name}` : "TikTok video",
        description: String(j.title).slice(0, 4000), note };
    }
    if (host === "instagram.com" || host.endsWith(".instagram.com") || host === "instagr.am") {
      // Instagram serves the FULL caption in its link-preview meta tags (og:*)
      // to preview crawlers — the same public surface Slack/WhatsApp unfurls
      // read. A normal browser UA gets a JS shell with no caption; the
      // facebookexternalhit UA gets the metadata. Posts/reels only.
      const m = u.pathname.match(/^\/(?:[^/]+\/)?(?:p|reel|reels|tv)\/([A-Za-z0-9_-]{5,})/);
      if (!m) return null;
      const r = await fetchWithTimeout(`https://www.instagram.com/p/${m[1]}/`, {
        headers: { "User-Agent": "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)", "Accept-Language": "en" },
      }, 6000);
      if (!r.ok) return null;
      const html = Buffer.from(await r.arrayBuffer()).subarray(0, 1024 * 1024).toString("utf8");
      const og = metaContent(html, "og:description");
      if (!og) return null;
      // og:description shape: `N likes, M comments - username on DATE: "caption"`
      // — strip the stats prefix and quotes to isolate the caption itself.
      let caption = og, user = "";
      const p = og.match(/^[\d.,KMB\s]*likes?,\s*[\d.,KMB\s]*comments?\s*-\s*([\w.\-]+)\s+on\s+[^:]+:\s*("?)([\s\S]*)\2$/);
      if (p) { user = p[1]; caption = p[3]; }
      else {
        const q = og.match(/^([\w.\-]+)\s+on\s+[^:]+:\s*("?)([\s\S]*)\2$/);
        if (q) { user = q[1]; caption = q[3]; }
      }
      caption = caption.replace(/^[“"]/, "").replace(/[”"]$/, "").trim();
      if (!caption) return null;
      return { url: u.toString(), siteName: "Instagram",
        title: user ? `Instagram post by ${user}` : (metaContent(html, "og:title") || "Instagram post"),
        description: caption.slice(0, 4000), note };
    }
  } catch { /* fall through to the normal fetch path */ }
  return null;
}

async function fetchLinkMeta(rawUrl) {
  let u;
  try { u = new URL(String(rawUrl).trim()); } catch { return { error: "That doesn't look like a valid link." }; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return { error: "Only http/https links are supported." };
  if (isBlockedHost(u.hostname)) return { error: "That link can't be fetched." };

  // Social platforms: try the caption-specific endpoints first (Phase 2) —
  // the normal page fetch below almost always 403s on IG/TikTok anyway.
  const social = await fetchSocialCaption(u);
  if (social) return social;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  const headers = {
    // A normal browser UA — most broadly accepted for articles/blogs/YouTube.
    // (Social platforms block server fetches regardless, so we lean on the
    // paste-the-caption fallback for those.)
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5",
    "Accept-Language": "en",
  };
  let res;
  try {
    // Follow redirects MANUALLY, re-checking EVERY hop against the SSRF
    // denylist — redirect:"follow" would let a public URL bounce the fetch
    // to an internal/metadata address the initial check never saw.
    let target = u;
    for (let hop = 0; ; hop++) {
      if ((target.protocol !== "http:" && target.protocol !== "https:") || isBlockedHost(target.hostname)) {
        clearTimeout(timer);
        return { error: "That link can't be fetched." };
      }
      res = await fetch(target.toString(), { redirect: "manual", signal: controller.signal, headers });
      const loc = res.headers.get("location");
      if (res.status >= 300 && res.status < 400 && loc) {
        if (hop >= 3) { clearTimeout(timer); return { error: "That link redirects too many times.", hint: "Ask the user to paste the caption/description text." }; }
        target = new URL(loc, target); // handles relative redirects
        continue;
      }
      break;
    }
  } catch (e) {
    clearTimeout(timer);
    return { error: "Couldn't open that link.", hint: "Ask the user to paste the caption or description text and work from that." };
  }
  try {
    if (!res.ok) {
      return { error: `That link couldn't be opened (the site returned ${res.status}).`,
        hint: "Some sites block apps from reading them — ask the user to paste the caption/description text." };
    }
    const ct = (res.headers.get("content-type") || "").toLowerCase();
    const clen = parseInt(res.headers.get("content-length") || "0", 10);
    if (clen && clen > 4 * 1024 * 1024) return { error: "That page is too large to read.", hint: "Ask the user to paste the caption/description." };
    if (ct && !/(text\/html|xml|text\/plain|json)/.test(ct)) {
      return { error: "That link isn't a readable page (it may be a file or image).", hint: "Ask the user to paste the caption/description text." };
    }
    const buf = Buffer.from(await res.arrayBuffer()).subarray(0, 1024 * 1024); // cap at 1MB
    const html = buf.toString("utf8");

    let title = metaContent(html, "og:title") || metaContent(html, "twitter:title");
    if (!title) { const t = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i); if (t) title = decodeEntities(t[1]).trim(); }
    let description = metaContent(html, "og:description") || metaContent(html, "twitter:description") || metaContent(html, "description");
    const siteName = metaContent(html, "og:site_name") || u.hostname.replace(/^www\./, "");

    // Best-effort: YouTube's full description lives in a JSON "shortDescription"
    // field on the watch page (og:description is only a truncated snippet). Prefer
    // it when it's longer — that's where the actual workout/recipe usually is.
    const sd = html.match(/"shortDescription":"((?:[^"\\]|\\.)*)"/);
    if (sd) { const full = decodeEntities(sd[1]).trim(); if (full.length > description.length) description = full; }

    title = (title || "").slice(0, 300);
    description = (description || "").slice(0, 4000);
    if (!title && !description) {
      return { url: u.toString(), siteName, error: "That page didn't expose any readable text.",
        hint: "Some sites (often Instagram/TikTok) hide it from apps — ask the user to paste the caption/description text." };
    }
    return {
      url: u.toString(), siteName, title, description,
      note: "This is the link's public title + description/caption. Extract any exercises, workouts, or foods from it and offer to add them with the normal tools. If it's thin or clearly incomplete, ask the user to paste the full caption.",
    };
  } catch (e) {
    return { error: "Couldn't read that link.", hint: "Ask the user to paste the caption or description text." };
  } finally {
    clearTimeout(timer);
  }
}

// ── search_food: real nutrition from the food databases (USDA + Open Food Facts) ─
// Lets the AI pull exact label values for PACKAGED/BRANDED items instead of
// estimating. Both free; OFF needs no key, USDA uses DEMO_KEY unless USDA_API_KEY
// is set. Returns matches with macros PER 100 g; the model scales to the portion.
const tidyName = (s) => (s || "Food").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
async function searchFoodDb(query) {
  const q = (query || "").toString().trim();
  if (!q) return { error: "No food to search for." };
  const key = process.env.USDA_API_KEY || "DEMO_KEY";
  const usdaP = (async () => {
    try {
      const r = await fetchWithTimeout(`https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${key}&query=${encodeURIComponent(q)}&pageSize=6`);
      if (!r.ok) return [];
      const j = await r.json();
      return (j.foods || []).map((x) => {
        const n = {};
        (x.foodNutrients || []).forEach((z) => { if (z.nutrientName === "Energy" && z.unitName && z.unitName !== "KCAL") return; n[z.nutrientName] = z.value; });
        return { name: tidyName(x.description), brand: x.brandOwner || x.brandName || "", source: "USDA",
          per100g: { kcal: Math.round(n["Energy"] || 0), protein: Math.round(n["Protein"] || 0), carbs: Math.round(n["Carbohydrate, by difference"] || 0), fat: Math.round(n["Total lipid (fat)"] || 0) } };
      }).filter((f) => f.per100g.kcal > 0);
    } catch { return []; }
  })();
  const offP = (async () => {
    try {
      const r = await fetchWithTimeout(`https://world.openfoodfacts.org/cgi/search.pl?search_simple=1&action=process&json=1&page_size=6&fields=product_name,brands,nutriments&search_terms=${encodeURIComponent(q)}`,
        { headers: { "User-Agent": "GlideAI/1.0 (+https://glidna.com)" } });
      if (!r.ok) return [];
      const j = await r.json();
      return (j.products || []).map((p) => {
        const nm = p.nutriments || {};
        return { name: tidyName(p.product_name), brand: (p.brands || "").split(",")[0].trim(), source: "OpenFoodFacts",
          per100g: { kcal: Math.round(nm["energy-kcal_100g"] || 0), protein: Math.round(nm.proteins_100g || 0), carbs: Math.round(nm.carbohydrates_100g || 0), fat: Math.round(nm.fat_100g || 0) } };
      }).filter((f) => f.name && f.name !== "Food" && f.per100g.kcal > 0);
    } catch { return []; }
  })();
  const [usda, off] = await Promise.all([usdaP, offP]);
  const seen = new Set(); const out = [];
  const push = (f) => { const k = (f.name + "|" + (f.brand || "")).toLowerCase(); if (seen.has(k)) return; seen.add(k); out.push(f); };
  const max = Math.max(usda.length, off.length);
  // USDA-first (S92): USDA FoodData Central is authoritative/verified; Open Food
  // Facts is crowd-sourced and drifts ±5% — so rank USDA ahead of OFF for precision.
  for (let i = 0; i < max; i++) { if (usda[i]) push(usda[i]); if (off[i]) push(off[i]); }
  if (!out.length) return { results: [], note: "No database match — estimate the macros instead, or ask the user for the label values." };
  return { results: out.slice(0, 8), note: "Macros are PER 100 g. Scale to the portion the user ate, then use propose_meal / log_meal." };
}

// Build one validated week ({day:[{type,duration}]}) from a provided day-keyed
// object — drops unknown ids (collected in `dropped`). Shared by the
// set_workout_schedule write and the propose_workout card. replace=true sets the
// whole week (unlisted days → rest []); replace=false merges over `existing`.
function buildWorkoutWeek(provided, validSet, defDur, existing, replace, dropped) {
  const clampDur = (v, def) => Math.max(5, Math.min(120, Math.round(Number(v) || def)));
  const result = replace ? {} : { ...(existing || {}) };
  // "By heart rate" cardio ({type:"hr", hr, duration}) is user-owned logging the AI
  // scheduler doesn't manage — it must NEVER be dropped or overwritten by a rebuild.
  // It has no exercise id, so it fails validSet; carry any existing HR sessions per day
  // forward, even on a replace (so "rebuild my cardio" can't silently delete an HR day).
  const hrOf = (day) => (Array.isArray((existing || {})[day]) ? existing[day] : []).filter((s) => s && s.type === "hr");
  const mkHr = (s) => ({ type: "hr", hr: Number(s.hr) || 0, duration: clampDur(s.duration, defDur) });
  for (const day of DAYS) {
    const arr = provided && Array.isArray(provided[day]) ? provided[day] : null;
    if (arr) {
      const sessions = [];
      for (const s of arr) {
        const type = s && s.type;
        if (type === "hr") sessions.push(mkHr(s));       // HR sessions are always valid
        else if (validSet.has(type)) sessions.push({ type, duration: clampDur(s.duration, defDur) });
        else if (type) dropped.push(type);
      }
      // If the rebuild for this day didn't re-emit HR, keep the existing HR session(s).
      if (!sessions.some((s) => s.type === "hr")) sessions.push(...hrOf(day));
      result[day] = sessions;
    } else if (replace) {
      result[day] = hrOf(day); // unlisted day in a replaced category → rest, but keep HR
    }
  }
  return result;
}
// Attach display labels to a built week for the confirmation card (skips rest days).
// labelMap (optional) covers the plan's custom exercises on top of the catalog.
function weekWithLabels(week, labelMap) {
  const r = {};
  for (const day of DAYS) {
    const arr = (week || {})[day] || [];
    if (arr.length) r[day] = arr.map((s) => (s.type === "hr"
      ? { type: "hr", hr: s.hr, label: `${Number(s.hr) || 0} bpm (heart rate)`, duration: s.duration }
      : { type: s.type, label: (labelMap && labelMap[s.type]) || EX_LABEL[s.type] || s.type, duration: s.duration }));
  }
  return r;
}
// Short human reference code for a client/plan, derived from its unique id
// (S110e, Kevin). Every account/plan already has a unique id, so this gives each
// one a stable 4-char badge (shown in the app) that a trainer can see and say —
// e.g. "how's #7K2M" — to pick a specific one when names collide. Deterministic:
// the app and the AI compute the SAME code from the same id. MUST match
// src/App.jsx refCode().
// Meal type, accepted the way people and models actually write it (S165).
// Every call site compared with strict equality against the lowercase list, so
// "Breakfast" or " lunch " silently became NO meal type — the entry logged, but
// it dropped out of the per-meal grouping on the dashboard. Fail-soft to "" is
// still the fallback for genuine nonsense; this just stops case costing data.
const MEAL_TYPES = ["breakfast", "lunch", "dinner", "snack"];
function mealTypeOf(v, fallback) {
  const t = String(v == null ? "" : v).trim().toLowerCase();
  return MEAL_TYPES.includes(t) ? t : (fallback === undefined ? "" : fallback);
}

function refCode(id) {
  const s = String(id || "").replace(/[^a-zA-Z0-9]/g, "");
  return s ? s.slice(-4).toUpperCase() : "----";
}

// The OTHER code the trainer can see. src/App.jsx assigns every connected client
// and local plan a short permanent number (#1, #2, …) — `ensureIdNums`, stored in
// the TRAINER'S OWN kv as caliq-idnums {next, map:{key -> n}} — and the trainer
// home renders THAT, while All-clients renders refCode(). So a trainer reads "#6"
// off their home screen, says "#6", and the AI only knew "KEM2". Read the map so
// both forms resolve. Caller's own kv, so no new access surface (same as
// caliq-index). Returns {} when the trainer has never loaded their home.
async function idNumMap(db, callerUid) {
  const doc = await kvGetJSON(db, callerUid, "caliq-idnums");
  return (doc && doc.map) || {};
}

// The plan's custom exercises, as id sets (by type) + an id→label map, so the AI
// can build programs that include them (valid ids) and label them on the card.
function customExerciseSets(data) {
  const list = Array.isArray(data && data.customExercises) ? data.customExercises : [];
  const strengthIds = new Set(list.filter((e) => e && e.type === "strength" && e.id).map((e) => e.id));
  const cardioIds = new Set(list.filter((e) => e && e.type === "cardio" && e.id).map((e) => e.id));
  const labels = {};
  for (const e of list) if (e && e.id) labels[e.id] = e.label || e.id;
  return { strengthIds, cardioIds, labels };
}

// ── kv access (mirrors src/storage.js: users/{uid}/kv/{encodeURIComponent(key)},
// each doc has fields { k, value } where value is a JSON string). ──────────────
function kvDocRef(db, uid, key) {
  return db.doc(`users/${uid}/kv/${encodeURIComponent(key)}`);
}
async function kvGetJSON(db, uid, key) {
  try {
    const snap = await kvDocRef(db, uid, key).get();
    if (!snap.exists) return null;
    return JSON.parse(snap.data().value || "null");
  } catch (e) {
    return null;
  }
}
async function kvSetJSON(db, uid, key, obj) {
  await kvDocRef(db, uid, key).set({ k: key, value: JSON.stringify(obj) });
}
// Transactional read-modify-write for kv JSON docs (the S85-deferred
// integrity hardening): append-style writes (meals, history, requests) used a
// plain read→write, so two concurrent writers (AI + app, or two devices)
// could silently drop each other's items. fn gets the parsed current value
// (or null) and returns the replacement; Firestore retries on contention.
async function kvTxnJSON(db, uid, key, fn) {
  const ref = kvDocRef(db, uid, key);
  let out;
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    let cur = null;
    try { cur = snap.exists ? JSON.parse(snap.data().value || "null") : null; } catch { cur = null; }
    out = fn(cur);
    tx.set(ref, { k: key, value: JSON.stringify(out) });
  });
  return out;
}
// privkv (S91, notes): the OWNER-ONLY store (rules deny even the trainer
// chain). The Admin SDK bypasses rules, so the guarantee here is CODE-level:
// these helpers are only ever called with uid === ctx.callerUid — the AI can
// never surface a client's private notes to a trainer.
function privDocRef(db, uid, key) {
  return db.doc(`users/${uid}/privkv/${encodeURIComponent(key)}`);
}
async function privGetJSON(db, uid, key) {
  try {
    const snap = await privDocRef(db, uid, key).get();
    return snap.exists ? JSON.parse(snap.data().value || "null") : null;
  } catch (e) { return null; }
}
async function privTxnJSON(db, uid, key, fn) {
  const ref = privDocRef(db, uid, key);
  let out;
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    let cur = null;
    try { cur = snap.exists ? JSON.parse(snap.data().value || "null") : null; } catch { cur = null; }
    out = fn(cur);
    tx.set(ref, { k: key, value: JSON.stringify(out) });
  });
  return out;
}
let __idSeq = 0;
function randId(p) {
  // Date.now()+random(1000) collided for items built in the same millisecond —
  // and the app deletes meals by id with .filter(), so two colliding ids meant
  // deleting one removed BOTH while subtracting only one meal's calories.
  __idSeq = (__idSeq + 1) % 100000;
  return `${p}${Date.now()}${__idSeq}${Math.floor(Math.random() * 1000)}`;
}

// Normalize a clock time the user/AI gives for when a meal was eaten into a
// canonical 24h "HH:MM" string (same format the frontend stores), so the AI can
// later spot time-of-day trends. Accepts "8:30pm", "8pm", "20:30", "13:45", etc.
// Falls back to the current local time (ctx.nowTime, America/New_York) when the
// meal is being logged now with no stated time; "" if neither is available.
function normMealTime(raw, ctx) {
  const s = String(raw == null ? "" : raw).trim().toLowerCase();
  if (s) {
    const m = s.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
    if (m) {
      let h = parseInt(m[1], 10);
      const min = m[2] ? parseInt(m[2], 10) : 0;
      const ap = m[3];
      if (ap === "pm" && h < 12) h += 12;
      if (ap === "am" && h === 12) h = 0;
      if (h >= 0 && h <= 23 && min >= 0 && min <= 59) {
        return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
      }
    }
  }
  return (ctx && ctx.nowTime) || "";
}

// ── plan resolution (mirrors the multi-plan manifest; default plan id "self").
// planOverride (S87): a validated LOCAL plan id from the caller's own caliq-index
// — lets a trainer's tools target their own local plan files/simulations instead
// of the manifest-active plan. Only ever set for uid === callerUid.
async function activePlanId(db, uid, planOverride) {
  if (planOverride) return planOverride;
  const m = await kvGetJSON(db, uid, "caliq-plans");
  return (m && m.active) || "self";
}
async function activePlanData(db, uid, planOverride) {
  const id = await activePlanId(db, uid, planOverride);
  const wrap = await kvGetJSON(db, uid, `caliq-${id}`);
  return { id, data: (wrap && wrap.data) || {} };
}
// Full plan wrapper ({data, step}) for read-modify-write of plan fields.
async function loadPlanWrap(db, uid, planOverride) {
  const id = await activePlanId(db, uid, planOverride);
  const wrap = (await kvGetJSON(db, uid, `caliq-${id}`)) || { data: {}, step: 0 };
  if (!wrap.data) wrap.data = {};
  return { id, wrap };
}

// After the AI writes to a LOCAL plan, keep the trainer-home card fresh: update
// the caller's caliq-index entry the way the app's autoSave does (name, weight,
// goal, lastSaved). Best-effort — a failed index touch never fails the tool.
async function touchLocalIndex(db, uid, planId) {
  try {
    const index = (await kvGetJSON(db, uid, "caliq-index")) || [];
    const entry = index.find((p) => p && p.id === planId);
    if (!entry) return;
    const wrap = await kvGetJSON(db, uid, `caliq-${planId}`);
    const d = (wrap && wrap.data) || {};
    const nm = [d.firstName, d.lastName].filter(Boolean).join(" ").trim();
    if (nm) entry.name = nm;
    entry.weight = d.weightLbs || "";
    entry.goal = d.goalWeight || "";
    entry.lastSaved = Date.now();
    await kvSetJSON(db, uid, "caliq-index", index);
  } catch (e) { console.error("touchLocalIndex failed:", e && e.message); }
}
function checkInTimestamp(date) {
  return new Date(date + "T12:00:00").getTime();
}

// Plan manifest (caliq-plans = { active, plans:[{id,name,createdAt}] }) — mirrors
// src/App.jsx normalizePlans/read/write so the AI manages plans exactly like the UI.
function normalizeManifest(m) {
  if (!m || !Array.isArray(m.plans) || m.plans.length === 0) {
    m = { active: "self", plans: [{ id: "self", name: "Main plan", createdAt: 0 }] };
  }
  if (!m.plans.some((p) => p.id === m.active)) m.active = m.plans[0].id;
  return m;
}
async function readManifest(db, uid) {
  return normalizeManifest(await kvGetJSON(db, uid, "caliq-plans"));
}
async function writeManifest(db, uid, m) {
  await kvSetJSON(db, uid, "caliq-plans", normalizeManifest(m));
}
// Personal stats carried over when starting a new phase (so the user/client
// doesn't re-enter them). Phase-specific things (goal, targets, workouts,
// check-ins, meals) start fresh.
const PERSONAL_FIELDS = ["firstName", "lastName", "gender", "age", "heightFt", "heightIn", "weightLbs", "activityLevel"];
// Append an activity-feed event to the plan's history (best-effort), same
// shape as App.appendHistory so AI actions show in the Recent Activity feed.
async function appendHistory(db, uid, planId, ctx, action) {
  try {
    const key = `caliq-history-${planId}`;
    const ev = { id: randId("e"), uid: ctx.callerUid, role: ctx.role,
      name: ctx.callerName || "AI assistant", action, ts: Date.now() };
    await kvTxnJSON(db, uid, key, (hist) =>
      [ev, ...(Array.isArray(hist) ? hist : [])].slice(0, 250));
  } catch (e) { /* best-effort */ }
}

// ── calorie/macro targets (matches src/App.jsx computeClientCalories +
// the dashboard macro defaults). The scheduled-exercise add-back is omitted —
// it's a small adjustment and zero for the common all-rest-days plan. ──────────
const ACTIVITY_MULT = { sedentary: 1.2, light: 1.375, moderate: 1.55, very: 1.725, extra: 1.9 };
// Age from an OPTIONAL date of birth (S110g) — keeps age current on its own.
// MUST match src/App.jsx ageFromDob()/effectiveAge().
function ageFromDob(dob) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dob || "").trim());
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3];
  const now = new Date();
  let age = now.getFullYear() - y;
  const beforeBday = (now.getMonth() + 1 < mo) || (now.getMonth() + 1 === mo && now.getDate() < d);
  if (beforeBday) age -= 1;
  return (age >= 0 && age <= 120) ? age : null;
}
const effectiveAge = (d) => { const a = ageFromDob(d && d.dob); return a != null ? a : (Number(d && d.age) || 0); };
function calcBMR(gender, weightLbs, heightFt, heightIn, age) {
  const kg = weightLbs * 0.453592;
  const cm = (Number(heightFt) * 12 + Number(heightIn)) * 2.54;
  return gender === "male"
    ? 10 * kg + 6.25 * cm - 5 * age + 5
    : 10 * kg + 6.25 * cm - 5 * age - 161;
}
// Weekly calories burned by the plan's scheduled cardio + strength — the exact
// mirror of App.jsx computeClientCalories' burn loop (per-session Math.round of
// MET × kg × hours; custom exercises burn calPerMin × minutes). Kept in sync so
// the AI's calorie target MATCHES every app screen — without this the AI told
// clients a target ~the daily burn lower than their dashboard showed, and
// coach_summary scored faithful clients as "over target".
// Weekly fat-loss rate → daily calorie deficit. MIRRORS App.jsx weeklyRateOf /
// dailyDeficitOf (0 / 0.5 / 1 / 2 lb per week → 0 / 250 / 500 / 1000 cal/day;
// 1 lb of fat ≈ 3500 cal). Unset/invalid = 1 lb/wk, which is what every plan
// implicitly ran on before the rate was selectable, so old plans don't shift.
// Keep in step with the app — a mismatch means the AI states a target the user
// never sees.
// NOTE 0 is a REAL value (maintenance), so `Number(x) || 1` is a trap here:
// Number(null) and Number("") are both 0 and would silently mean maintenance.
// Screen the empties before trusting a 0. Mirrors App.jsx weeklyRateOf.
const RATE_OPTS = [0, 0.5, 1, 2];
function weeklyRate(d) {
  const raw = d && d.weeklyRate;
  if (raw === null || raw === undefined || raw === "") return 1;
  const r = Number(raw);
  return RATE_OPTS.includes(r) ? r : 1;
}
function dailyDeficit(d) {
  return Math.round((weeklyRate(d) * 3500) / 7);
}

// Heart-rate calorie burn (Keytel et al., 2005) — MIRRORS App.jsx hrCaloriesPerMin.
// A "By heart rate" cardio session is stored {type:"hr", hr, duration}; there is no
// MET for it, so the server must compute its burn the same way the client does, or
// eat-back targets undercount HR cardio (the AI would quote a lower target than the app).
function hrCalPerMin(hr, gender, weightLbs, age) {
  const w = Number(weightLbs) * 0.453592; // kg
  const a = Number(age), h = Number(hr);
  if (!(h > 0) || !(w > 0) || !(a > 0)) return 0;
  const kcalMin = gender === "female"
    ? (-20.4022 + 0.4472 * h - 0.1263 * w + 0.074 * a) / 4.184
    : (-55.0969 + 0.6309 * h + 0.1988 * w + 0.2017 * a) / 4.184;
  return Math.max(0, kcalMin);
}

function weeklyPlanBurn(d) {
  const w = Number(d.weightLbs) || 0;
  const custom = {};
  (Array.isArray(d.customExercises) ? d.customExercises : []).forEach((e) => { if (e && e.id) custom[e.id] = e; });
  const burnOf = (s) => {
    if (!s || !s.duration) return 0;
    if (s.type === "hr") return Math.round(hrCalPerMin(s.hr, d.gender, d.weightLbs, effectiveAge(d)) * s.duration);
    const ce = custom[s.type];
    if (ce && ce.calPerMin) return Math.round(Number(ce.calPerMin) * s.duration);
    return Math.round((MET[s.type] || 0) * w * 0.453592 * (s.duration / 60));
  };
  let total = 0;
  for (const day of DAYS) {
    (Array.isArray((d.cardio || {})[day]) ? d.cardio[day] : []).forEach((s) => { total += burnOf(s); });
    (Array.isArray((d.strength || {})[day]) ? d.strength[day] : []).forEach((s) => { total += burnOf(s); });
  }
  return total;
}

function nutritionTargets(d) {
  const w = Number(d.weightLbs);
  let cal = null;
  if (w && d.gender) {
    const bmr = calcBMR(d.gender, w, d.heightFt, d.heightIn, effectiveAge(d));
    if (bmr && isFinite(bmr)) {
      const tdee = Math.round(bmr * (ACTIVITY_MULT[d.activityLevel] || 1.2));
      // Nutrition approach (matches App.jsx isEatback): "eatback" (default)
      // adds workout burn to the eating target; "accelerate" keeps the deficit
      // and lets the burn speed up the goal date instead.
      const eatback = (d.deficitMode || "eatback") !== "accelerate";
      // Weekly rate (matches App.jsx weeklyRateOf/dailyDeficitOf): 0/0.5/1/2
      // lb per week → 0/250/500/1000 cal/day. Unset = 1 lb/wk, the long-standing
      // default. This MUST track the app: if the server assumes a different
      // deficit, the AI quotes a target no screen shows and mis-scores adherence.
      cal = Math.max(1200, Math.round(tdee - dailyDeficit(d) + (eatback ? weeklyPlanBurn(d) / 7 : 0)));
    }
  }
  const mt = d.macroTargets || {};
  // Protein basis is a per-plan user choice (App.jsx proteinBasisOf): 1.0 g/lb
  // (default) or 0.7 g/lb. Keep the AI's target in sync with the app.
  const proteinPerLb = Number(d.proteinPerLb) === 0.7 ? 0.7 : 1.0;
  const protein = mt.protein != null ? Number(mt.protein) : (w ? Math.round(w * proteinPerLb) : null);
  const fat = mt.fat != null ? Number(mt.fat) : (cal ? Math.round((cal * 0.28) / 9) : null);
  const carbs = mt.carbs != null ? Number(mt.carbs)
    : (cal != null && protein != null && fat != null
        ? Math.max(0, Math.round((cal - protein * 4 - fat * 9) / 4)) : null);
  return {
    calorieTarget: cal,
    proteinTarget: protein,
    carbsTarget: carbs,
    fatTarget: fat,
    custom: !!(mt.protein || mt.carbs || mt.fat),
  };
}

// Personal profile summary (the wizard's StepPersonal/Goal/Activity fields) +
// which required pieces are missing for a calorie target. Used by get_profile
// and returned after set_personal_info so the AI can guide onboarding.
function profileSummary(d) {
  d = d || {};
  const num = (v) => (v === "" || v == null ? null : Number(v));
  const required = {
    gender: !!d.gender,
    age: effectiveAge(d) > 0,
    height: num(d.heightFt) > 0,
    weight: num(d.weightLbs) > 0,
    activityLevel: !!d.activityLevel,
  };
  const missing = Object.keys(required).filter((k) => !required[k]);
  const t = nutritionTargets(d);
  return {
    firstName: d.firstName || null,
    lastName: d.lastName || null,
    gender: d.gender || null,
    age: effectiveAge(d) || null,
    dob: d.dob || null,
    ageAutoFromDob: ageFromDob(d.dob) != null,
    heightFeet: num(d.heightFt),
    heightInches: num(d.heightIn),
    weightLbs: num(d.weightLbs),
    goalWeightLbs: num(d.goalWeight),
    goalRangeLowLbs: num(d.goalRangeLow),
    goalRangeHighLbs: num(d.goalRangeHigh),
    activityLevel: d.activityLevel || null,
    bodyFatPct: num(d.bodyFat),
    goalBodyFatPct: num(d.goalBodyFat),
    trainerNotes: d.trainerNotes || null,
    // "eatback" = workout burn added to the daily target (easier diet);
    // "accelerate" = tighter target, workouts speed up the goal date.
    deficitMode: d.deficitMode === "accelerate" ? "accelerate" : "eatback",
    // Tracker adjustment: when true (and eatback), a day with wearable data
    // gets its target from the watch's measured burn instead of the estimate.
    wearableAdjust: !!d.wearableAdjust,
    // Simple-view goal mode (S90b): reshapes the plain-English plan page —
    // lose = deficit, build = surplus (+250 + workout refuel), health = maintenance.
    fitnessGoal: ["lose", "build", "health"].includes(d.fitnessGoal) ? d.fitnessGoal : null,
    missing,
    complete: missing.length === 0,
    calorieTarget: t.calorieTarget,
  };
}

// ---- Body measurements (tape) → body-fat estimates ----------------------
// Formulas verified + documented in docs/METRICS-PLAN.md. All inches.
// Covert Bailey (The Ultimate Fit or Fat): needs NO scale and NO height —
// the metric for scale-averse clients. Age/gender variants auto-selected.
function baileyBF(d, m) {
  const age = effectiveAge(d);
  const g = d.gender;
  const n = (v) => (v > 0 ? Number(v) : null);
  if (g === "male") {
    const { waist, hips, forearm, wrist } = { waist: n(m.waist), hips: n(m.hips), forearm: n(m.forearm), wrist: n(m.wrist) };
    if (!waist || !hips || !forearm || !wrist) return null;
    const bf = waist + 0.5 * hips - (age > 30 ? 2.7 : 3) * forearm - wrist;
    return bf > 1 && bf < 75 ? Math.round(bf * 10) / 10 : null;
  }
  if (g === "female") {
    const { hips, thigh, calf, wrist } = { hips: n(m.hips), thigh: n(m.thigh), calf: n(m.calf), wrist: n(m.wrist) };
    if (!hips || !thigh || !calf || !wrist) return null;
    const bf = hips + (age > 30 ? 1 : 0.8) * thigh - 2 * calf - wrist;
    return bf > 1 && bf < 75 ? Math.round(bf * 10) / 10 : null;
  }
  return null;
}

// U.S. Navy method (DoD standard; needs height but no scale) — the cross-check.
function navyBF(d, m) {
  const heightIn = (Number(d.heightFt) || 0) * 12 + (Number(d.heightIn) || 0);
  if (!(heightIn > 0)) return null;
  const n = (v) => (v > 0 ? Number(v) : null);
  const log10 = (v) => Math.log(v) / Math.LN10;
  let bf = null;
  if (d.gender === "male") {
    const waist = n(m.waist), neck = n(m.neck);
    if (!waist || !neck || waist - neck <= 0) return null;
    bf = 86.010 * log10(waist - neck) - 70.041 * log10(heightIn) + 36.76;
  } else if (d.gender === "female") {
    const waist = n(m.waist), hips = n(m.hips), neck = n(m.neck);
    if (!waist || !hips || !neck || waist + hips - neck <= 0) return null;
    bf = 163.205 * log10(waist + hips - neck) - 97.684 * log10(heightIn) - 78.387;
  }
  return bf != null && bf > 1 && bf < 75 ? Math.round(bf * 10) / 10 : null;
}

// Waist-to-height ratio: >0.5 = elevated health risk (scale-free health flag).
function whtrOf(d, m) {
  const heightIn = (Number(d.heightFt) || 0) * 12 + (Number(d.heightIn) || 0);
  const waist = Number(m.waist) || 0;
  if (!(heightIn > 0) || !(waist > 0)) return null;
  return Math.round((waist / heightIn) * 100) / 100;
}

// One measurement entry → all derived metrics (null where inputs are missing).
function measurementMetrics(d, m) {
  const bailey = baileyBF(d, m);
  const navy = navyBF(d, m);
  const both = [bailey, navy].filter((v) => v != null);
  const avg = both.length ? Math.round((both.reduce((a, b) => a + b, 0) / both.length) * 10) / 10 : null;
  const whtr = whtrOf(d, m);
  const weight = Number(d.weightLbs) || 0;
  const bf = avg;
  const leanMassLbs = weight > 0 && bf != null ? Math.round(weight * (1 - bf / 100)) : null;
  // Bailey goal weight = lean mass ÷ (1 − target BF%): a physiologically
  // derived goal instead of a guessed number (docs/METRICS-PLAN.md group 6).
  const targetBf = Number(d.goalBodyFat) || null;
  const goalWeightFromLeanMass = leanMassLbs && targetBf && targetBf > 1 && targetBf < 60
    ? Math.round(leanMassLbs / (1 - targetBf / 100)) : null;
  return { baileyBF: bailey, navyBF: navy, bodyFatPct: avg, waistToHeight: whtr,
    leanMassLbs, goalWeightFromLeanMass };
}

const MEASUREMENT_FIELDS = ["waist", "hips", "neck", "thigh", "calf", "forearm", "wrist"];

// Least-squares weight trend (lbs/week) from check-ins — mirrors src/App.jsx
// weightTrend. Needs 2+ weigh-ins spread over ≥3 days. null otherwise.
function weightTrend(checkIns) {
  const pts = [...(checkIns || [])].filter((c) => c.weight && c.timestamp)
    .sort((a, b) => a.timestamp - b.timestamp);
  if (pts.length < 2) return null;
  const t0 = pts[0].timestamp;
  const spanDays = (pts[pts.length - 1].timestamp - t0) / 86400000;
  if (spanDays < 3) return null;
  const xs = pts.map((p) => (p.timestamp - t0) / 86400000);
  const ys = pts.map((p) => p.weight);
  const n = xs.length;
  const sx = xs.reduce((a, b) => a + b, 0);
  const sy = ys.reduce((a, b) => a + b, 0);
  const sxx = xs.reduce((a, b) => a + b * b, 0);
  const sxy = xs.reduce((a, _, i) => a + xs[i] * ys[i], 0);
  const denom = n * sxx - sx * sx;
  if (denom === 0) return null;
  return { ratePerWeek: ((n * sxy - sx * sy) / denom) * 7, spanDays, n };
}
function etaWeeks(current, target, ratePerWeek) {
  const remaining = target - current;
  if (Math.abs(remaining) < 0.05) return 0;
  if (!ratePerWeek) return null;
  if ((remaining < 0) === (ratePerWeek < 0)) return remaining / ratePerWeek;
  return null; // trending the wrong way
}

// ── date helpers ───────────────────────────────────────────────────────────
function clampDateRange(startDate, endDate) {
  // Lexical compare works for zero-padded YYYY-MM-DD. Cap span at 31 days.
  const re = /^\d{4}-\d{2}-\d{2}$/;
  if (!re.test(startDate) || !re.test(endDate)) return null;
  let s = startDate, e = endDate;
  if (s > e) { const t = s; s = e; e = t; }
  const sd = new Date(s + "T00:00:00Z"), ed = new Date(e + "T00:00:00Z");
  const days = Math.round((ed - sd) / 86400000);
  if (days > 30) { // cap to last 31 days of the range
    const capped = new Date(ed.getTime() - 30 * 86400000);
    s = capped.toISOString().slice(0, 10);
  }
  return { start: s, end: e };
}

// ── tool definitions by role ───────────────────────────────────────────────
const CLIENT_NOTE = "Returns YOUR own data.";
const TRAINER_NOTE = "Pass clientId (from list_clients) to read a specific client; omit it for your own data.";

function buildTools(role, opts = {}) {
  const isTrainer = role === "head_trainer" || role === "sub_trainer" || role === "admin";
  const clientIdProp = isTrainer
    ? { clientId: { type: "string", description: "The client's id from list_clients. " + TRAINER_NOTE } }
    : {};
  const localPlanProp = isTrainer
    ? { localPlanId: { type: "string", description: "One of YOUR OWN local plan/sim files (id from list_local_plans), not a client account. Never with clientId." } }
    : {};

  const tools = [
    {
      name: "get_nutrition_log",
      description:
        "Get daily nutrition logs (calories, protein, carbs, fat, and the foods eaten each day), plus any weigh-in and whether a workout was done, for a date range. "
        + (isTrainer ? TRAINER_NOTE : CLIENT_NOTE)
        + " Range is capped at 31 days.",
      input_schema: {
        type: "object",
        properties: {
          startDate: { type: "string", description: "Start date, YYYY-MM-DD" },
          endDate: { type: "string", description: "End date, YYYY-MM-DD" },
          ...clientIdProp, ...localPlanProp,
        },
        required: ["startDate", "endDate"],
      },
    },
    {
      name: "get_nutrition_targets",
      description:
        "Get daily calorie and macro (protein/carbs/fat) targets, plus current and goal weight. "
        + (isTrainer ? TRAINER_NOTE : CLIENT_NOTE),
      input_schema: {
        type: "object",
        properties: { ...clientIdProp, ...localPlanProp },
      },
    },
    {
      name: "get_profile",
      description:
        "Get the plan's personal profile (name, gender, age, height, current & goal weight, activity level, body-fat) "
        + "and which required fields are still MISSING for a calorie target. Use this before onboarding someone to see "
        + "what to ask for. " + (isTrainer ? TRAINER_NOTE : CLIENT_NOTE),
      input_schema: { type: "object", properties: { ...clientIdProp, ...localPlanProp } },
    },
    {
      name: "set_personal_info",
      description:
        "Save/update the plan's profile stats — the core fields a calorie target needs (gender, age, height, weight, "
        + "activity) plus optional goals. Use for conversational onboarding. Set fields the user just gave directly; "
        + "confirm only before overwriting an existing value with a different one. "
        + (isTrainer ? "Pass clientId for a client." : "Updates YOUR profile."),
      input_schema: {
        type: "object",
        properties: {
          firstName: { type: "string" },
          lastName: { type: "string" },
          gender: { type: "string", enum: ["male", "female"], description: "Biological sex (for the BMR calc)" },
          age: { type: "number", description: "Years. OPTIONAL if dob is given (dob keeps age current automatically)." },
          dob: { type: "string", description: "OPTIONAL date of birth as YYYY-MM-DD. If set, age is derived from it and stays current — don't also pass age. Only set when the user volunteers their birthday; it's their choice." },
          heightFeet: { type: "number", description: "Height feet part, e.g. 5" },
          heightInches: { type: "number", description: "Height inches part 0–11 (convert from cm/total inches if given)" },
          weightLbs: { type: "number", description: "Current weight, lbs" },
          activityLevel: { type: "string", enum: ["sedentary", "light", "moderate", "very", "extra"],
            description: "Everyday activity, NOT workouts: sedentary=desk; light=some walking; moderate=on feet most of day; very=demanding job; extra=intense labor" },
          goalWeightLbs: { type: "number", description: "Goal weight, lbs" },
          goalRangeLowLbs: { type: "number", description: "Optional goal-range low bound, lbs" },
          goalRangeHighLbs: { type: "number", description: "Optional goal-range high bound, lbs (≥ low)" },
          bodyFatPct: { type: "number", description: "Current body-fat %" },
          goalBodyFatPct: { type: "number", description: "Goal body-fat %" },
          trainerNotes: { type: "string", description: "Coaching notes (replaces existing)" },
          deficitMode: { type: "string", enum: ["eatback", "accelerate"],
            description: "'eatback' (default: workout burn added to target, steady ~1 lb/wk) or 'accelerate' (target stays TDEE−500, workouts speed the goal date). Set on a sustainability-vs-speed choice." },
          wearableAdjust: { type: "boolean",
            description: "Default false. True + eatback: days with synced watch data use the tracker's measured burn (resting+active−500) as the target instead of the estimate. Set when the user wants their watch/Garmin burn to drive daily calories." },
          fitnessGoal: { type: "string", enum: ["lose", "build", "health"],
            description: "Main goal (reshapes the Simple view): 'lose' (deficit), 'build' (surplus ≈ maintenance+250), 'health' (maintenance). Set when the user states their goal." },
          ...clientIdProp, ...localPlanProp,
        },
      },
    },
    {
      name: "list_plans",
      description:
        "List the plans on this account (id, name, which is active). A person can have several — e.g. cut, maintenance, "
        + "bulk phases. The active plan drives the dashboard, logging, and targets. "
        + (isTrainer ? TRAINER_NOTE : CLIENT_NOTE),
      input_schema: { type: "object", properties: { ...clientIdProp } },
    },
    {
      name: "create_plan",
      description:
        "Create a NEW plan — e.g. a cut, maintenance, or bulk phase. By default carries over personal stats "
        + "(gender/age/height/weight/activity) and becomes the active plan. Pass goalWeightLbs for the phase's goal. "
        + "Workouts/targets/logs start fresh — build them after. Confirm before creating. "
        + (isTrainer ? "Pass clientId to create for a client." : "Creates on YOUR account."),
      input_schema: {
        type: "object",
        properties: {
          name: { type: "string", description: "Plan name, e.g. 'Summer cut' or 'Maintenance phase'" },
          copyStats: { type: "boolean", description: "Carry over personal stats from the current active plan. Default true." },
          makeActive: { type: "boolean", description: "Switch to the new plan immediately. Default true." },
          goalWeightLbs: { type: "number", description: "Goal body weight for the new phase, pounds (optional)" },
          ...clientIdProp,
        },
        required: ["name"],
      },
    },
    {
      name: "switch_plan",
      description:
        "Make a different EXISTING plan active (planId from list_plans). The active plan drives the "
        + "dashboard, logging, and targets. Confirm which plan before switching. "
        + (isTrainer ? "Pass clientId to switch a client's active plan." : "Switches YOUR active plan."),
      input_schema: {
        type: "object",
        properties: {
          planId: { type: "string", description: "The plan's id from list_plans." },
          ...clientIdProp,
        },
        required: ["planId"],
      },
    },
    {
      name: "search_food_db",
      description:
        "Look a food up in the FOOD DATABASE (FatSecret) and get its real per-serving "
        + "calories and macros. Use this ONLY when the user explicitly asks for the food "
        + "database — e.g. \"look it up\", \"use the database\", \"find the real numbers\". "
        + "Otherwise estimate as normal; your estimates are good and cost the user less. "
        + "Returns up to 8 candidates with brand and serving. Pick the closest match, scale it "
        + "to the amount the user actually ate, and log it with source:\"database\" so the entry "
        + "records where the numbers came from. If nothing matches well, say so and fall back "
        + "to your own estimate rather than forcing a bad match.",
      input_schema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Food to look up, e.g. \"Chobani greek yogurt\" or \"chicken breast\"" },
        },
        required: ["query"],
      },
    },
    {
      name: "propose_meal",
      description:
        "PREFERRED way to log food: estimate a meal's macros (from description or photo), then call propose_meal to "
        + "show a tappable Accept/Edit confirmation CARD that saves it. Do NOT also call log_meal for the same meal. "
        + "Briefly note your estimate in text too. " + (isTrainer ? "Pass clientId to propose for a client." : ""),
      input_schema: {
        type: "object",
        properties: {
          name: { type: "string", description: "Short food/meal name, e.g. '2 eggs & whole wheat toast'" },
          mealType: { type: "string", enum: ["breakfast", "lunch", "dinner", "snack"], description: "Which meal" },
          calories: { type: "number", description: "Total calories" },
          protein: { type: "number", description: "Protein grams (0 if unknown)" },
          carbs: { type: "number", description: "Carb grams (0 if unknown)" },
          fat: { type: "number", description: "Fat grams (0 if unknown)" },
          micros: MICRO_SCHEMA,
          date: { type: "string", description: "Date YYYY-MM-DD. OMIT for today — only pass this when the user explicitly named a different day." },
          time: { type: "string", description: "Clock time eaten, e.g. '8:30am' or '19:45'. Set when the user mentions when they ate; omit for now." },
          ...clientIdProp, ...localPlanProp,
        },
        required: ["name", "mealType", "calories"],
      },
    },
    {
      name: "log_meal",
      description:
        "Save a meal to the food log DIRECTLY (no card). Prefer propose_meal — only use log_meal when the user "
        + "explicitly says to log without confirming (e.g. 'just log it'). Appears on the dashboard, calendar, "
        + "and weekly totals. "
        + (isTrainer ? "Pass clientId (from list_clients) to log for a client; omit for yourself." : "Logs to YOUR own food log."),
      input_schema: {
        type: "object",
        properties: {
          name: { type: "string", description: "Short food/meal name, e.g. '2 eggs & whole wheat toast'" },
          mealType: { type: "string", enum: ["breakfast", "lunch", "dinner", "snack"], description: "Which meal" },
          calories: { type: "number", description: "Total calories for this meal" },
          protein: { type: "number", description: "Protein grams (0 if unknown)" },
          carbs: { type: "number", description: "Carb grams (0 if unknown)" },
          fat: { type: "number", description: "Fat grams (0 if unknown)" },
          micros: MICRO_SCHEMA,
          date: { type: "string", description: "Date YYYY-MM-DD. OMIT for today — only pass this when the user explicitly named a different day." },
          time: { type: "string", description: "Clock time eaten, e.g. '8:30am' or '19:45'. Set when the user mentions when they ate; omit for now." },
          ...clientIdProp, ...localPlanProp,
        },
        required: ["name", "mealType", "calories"],
      },
    },
    {
      name: "plan_meals",
      description:
        "PLAN meals for future days (a meal plan), rather than logging them as eaten. The person then ticks each "
        + "item off as they eat it. Use when asked to 'make me a meal plan', 'plan my week', 'set up my meals for "
        + "the next 4 weeks'. Specify per meal: name, mealType, calories, macros, and optionally the TIME and the "
        + "PLACE (a restaurant, or 'home'). Repeat across days with weekdays + weeks (e.g. weekdays [1,3,5] and "
        + "weeks 4 = every Mon/Wed/Fri for four weeks), or pass explicit dates. Planning does NOT change any "
        + "calorie totals — nothing counts until it is ticked off. "
        + (isTrainer ? "Pass clientId to plan for a client; omit for yourself." : "Plans for YOU."),
      input_schema: {
        type: "object",
        properties: {
          meals: {
            type: "array",
            description: "The meals to plan. Each is one entry the person ticks off.",
            items: {
              type: "object",
              properties: {
                name: { type: "string", description: "What to eat, e.g. 'Chipotle chicken burrito bowl'" },
                mealType: { type: "string", enum: ["breakfast", "lunch", "dinner", "snack"] },
                calories: { type: "number" },
                protein: { type: "number" }, carbs: { type: "number" }, fat: { type: "number" },
                time: { type: "string", description: "Clock time, e.g. '12:30'" },
                place: { type: "string", description: "Restaurant or location, e.g. 'Chipotle', 'home'" },
                grams: { type: "number", description: "Serving size in grams, when specified" },
              },
              required: ["name", "calories"],
            },
          },
          startDate: { type: "string", description: "YYYY-MM-DD; defaults to today" },
          weekdays: { type: "array", items: { type: "number" },
            description: "Days of week to repeat on: 0=Sunday … 6=Saturday. Omit to plan only startDate." },
          weeks: { type: "number", description: "How many weeks to repeat (default 1, max 26)" },
          dates: { type: "array", items: { type: "string" }, description: "Explicit YYYY-MM-DD dates, instead of weekdays/weeks" },
          ...clientIdProp,
          ...localPlanProp,
        },
        required: ["meals"],
      },
    },
    {
      name: "log_meals",
      description:
        "Log MULTIPLE foods/meals AT ONCE in ONE call — the PREFERRED way to log a list of foods (e.g. a whole breakfast of 8 items). Put EVERY item in the meals array; they all save together in one shot, no cards, no per-item taps. Use this instead of calling log_meal repeatedly. "
        + (isTrainer ? "Pass clientId to log for a client; omit for yourself." : "Logs to YOUR own log."),
      input_schema: {
        type: "object",
        properties: {
          meals: {
            type: "array",
            description: "Every food/meal to log (each with its own estimate). All are saved together.",
            items: {
              type: "object",
              properties: {
                name: { type: "string", description: "Short food/meal name" },
                mealType: { type: "string", enum: ["breakfast", "lunch", "dinner", "snack"] },
                calories: { type: "number" },
                protein: { type: "number", description: "grams (0 if unknown)" },
                carbs: { type: "number", description: "grams (0 if unknown)" },
                fat: { type: "number", description: "grams (0 if unknown)" },
                micros: MICRO_SCHEMA,
                date: { type: "string", description: "YYYY-MM-DD; omit for today" },
                time: { type: "string", description: "clock time eaten; omit for now" },
              },
              required: ["name", "mealType", "calories"],
            },
          },
          date: { type: "string", description:
            "YYYY-MM-DD for the WHOLE batch — use this when the user names one day for everything "
            + "(\"log all of this for July 27th\"). Omit for today. A date on an individual item "
            + "overrides this, so a mixed-day batch still works." },
          ...clientIdProp, ...localPlanProp,
        },
        required: ["meals"],
      },
    },
    {
      name: "remove_meal",
      description:
        "Remove a logged meal/food from the food log (undo a mis-logged item, or to CORRECT one: remove it then log_meal the fixed version). "
        + "Matches by name (most recent match on that date) and subtracts its calories/macros from the day's totals. "
        + (isTrainer ? "Pass clientId to remove from a client's log; omit for yourself." : "Removes from YOUR own log."),
      input_schema: {
        type: "object",
        properties: {
          name: { type: "string", description: "The logged food/meal name to remove (matches case-insensitively; the most recent match on the date is removed)" },
          date: { type: "string", description: "Date YYYY-MM-DD. OMIT for today — only pass this when the user explicitly named a different day." },
          ...clientIdProp, ...localPlanProp,
        },
        required: ["name"],
      },
    },
    {
      name: "log_workout",
      description:
        "Mark a day as a completed workout day (feeds the streak and calendar). Add a short note if what they did is mentioned. "
        + "Confirm first. " + (isTrainer ? "Pass clientId to record for a client." : "Records for YOU."),
      input_schema: {
        type: "object",
        properties: {
          note: { type: "string", description: "Optional note, e.g. 'Push day — felt strong'" },
          date: { type: "string", description: "Date YYYY-MM-DD. OMIT for today — only pass this when the user explicitly named a different day." },
          ...clientIdProp, ...localPlanProp,
        },
      },
    },
    {
      name: "log_weigh_in",
      description:
        "Record a body-weight weigh-in (updates current weight + progress chart). Confirm the number first. "
        + (isTrainer ? "Pass clientId to record for a client." : "Records for YOU."),
      input_schema: {
        type: "object",
        properties: {
          weightLbs: { type: "number", description: "Body weight in pounds" },
          date: { type: "string", description: "Date YYYY-MM-DD. OMIT for today — only pass this when the user explicitly named a different day." },
          ...clientIdProp, ...localPlanProp,
        },
        required: ["weightLbs"],
      },
    },
    {
      name: "log_check_in",
      description:
        "Record daily check-in details WITHOUT a weight: mood/energy (1–5), body-fat %, whether they hit their calorie target, and/or a note. Merges into the same date's check-in (never wipes other fields). Use when the user shares how they feel, a body-fat reading, or a daily note. For weight itself use log_weigh_in."
        + (isTrainer ? " Pass clientId to record for a client." : ""),
      input_schema: {
        type: "object",
        properties: {
          date: { type: "string", description: "Date YYYY-MM-DD. OMIT for today — only pass this when the user explicitly named a different day." },
          mood: { type: "number", description: "Energy/mood 1 (drained) to 5 (fired up)" },
          bodyFatPct: { type: "number", description: "Body-fat % measured that day" },
          hitCalorieTarget: { type: "boolean", description: "Did they hit their calorie target that day?" },
          notes: { type: "string", description: "Free-text note for the day (replaces the day's existing note)" },
          ...clientIdProp, ...localPlanProp,
        },
      },
    },
    {
      name: "log_measurements",
      description:
        "Record tape measurements (inches) for a date: waist, hips, neck, thigh, calf, forearm, wrist — any subset. Merges into the same date's entry (never wipes other fields). "
        + "Body-fat % is auto-computed from whatever fields exist (Bailey needs no scale/height; U.S. Navy needs waist+neck(+hips for women)). "
        + "Measure at the widest point (wrist: narrowest). Confirm the numbers first. "
        + (isTrainer ? "Pass clientId to record for a client." : "Records for YOU."),
      input_schema: {
        type: "object",
        properties: {
          waist: { type: "number", description: "Waist at the navel, inches" },
          hips: { type: "number", description: "Hips/buttocks at the widest point, inches" },
          neck: { type: "number", description: "Neck, inches" },
          thigh: { type: "number", description: "Thigh at the widest point, inches" },
          calf: { type: "number", description: "Calf at the widest point, inches" },
          forearm: { type: "number", description: "Forearm at the widest point, inches" },
          wrist: { type: "number", description: "Wrist at the narrowest point, inches" },
          date: { type: "string", description: "Date YYYY-MM-DD. OMIT for today — only pass this when the user explicitly named a different day." },
          ...clientIdProp, ...localPlanProp,
        },
      },
    },
    {
      name: "get_measurements",
      description:
        "Read recent tape measurements + computed body composition: Bailey & Navy body-fat %, waist-to-height ratio (>0.5 = elevated risk), lean mass, and the lean-mass-derived goal weight when a goal body-fat % is set. Use for waist-trend, body-fat, or non-scale progress questions."
        + (isTrainer ? " Pass clientId for a client." : ""),
      input_schema: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Max entries to return, newest first (default 8, max 30)" },
          ...clientIdProp, ...localPlanProp,
        },
      },
    },
    {
      name: "log_water",
      description:
        "Log water intake for a day in ounces (convert cups: 1 cup = 8 oz). Default ADDS to the day's total; mode='set' overwrites it. E.g. 'log 3 cups' → 24 oz added."
        + (isTrainer ? " Pass clientId to log for a client." : ""),
      input_schema: {
        type: "object",
        properties: {
          ounces: { type: "number", description: "Water in fluid ounces" },
          mode: { type: "string", enum: ["add", "set"], description: "add (default) or set the day's total" },
          date: { type: "string", description: "Date YYYY-MM-DD. OMIT for today — only pass this when the user explicitly named a different day." },
          ...clientIdProp, ...localPlanProp,
        },
        required: ["ounces"],
      },
    },
    {
      name: "rename_plan",
      description: "Rename a plan (get planId from list_plans first)."
        + (isTrainer ? " Pass clientId for a client's plan." : ""),
      input_schema: {
        type: "object",
        properties: {
          planId: { type: "string", description: "The plan id from list_plans" },
          name: { type: "string", description: "The new plan name" },
          ...clientIdProp,
        },
        required: ["planId", "name"],
      },
    },
    {
      name: "set_notification_prefs",
      description:
        "Turn the CALLER'S OWN notification types on/off (never a client's — prefs are personal). Types: master (everything), messages, trainerReminders (client: trainer to-dos), foodReminders, weighInReminders, coachingNudges, sentReminders (trainer: sent to-do display), clientRequests (trainer), automations (scheduled automation results), referralRewards (referral credit ready to claim), sessionBilling (session charges and settlements). Only pass the keys the user asked to change.",
      input_schema: {
        type: "object",
        properties: {
          master: { type: "boolean" }, messages: { type: "boolean" },
          trainerReminders: { type: "boolean" }, foodReminders: { type: "boolean" },
          weighInReminders: { type: "boolean" }, coachingNudges: { type: "boolean" },
          sentReminders: { type: "boolean" }, clientRequests: { type: "boolean" },
          automations: { type: "boolean" }, referralRewards: { type: "boolean" },
          sessionBilling: { type: "boolean" },
        },
      },
    },
    {
      name: "set_targets",
      description:
        "Update the plan's nutrition targets and/or goal weight (protein/carbs/fat grams, or goal weight in pounds). "
        + "Always confirm the specific numbers before calling. "
        + (isTrainer ? "Pass clientId to tune a client's plan." : "Updates YOUR plan."),
      input_schema: {
        type: "object",
        properties: {
          proteinTarget: { type: "number", description: "Daily protein target, grams" },
          carbsTarget: { type: "number", description: "Daily carb target, grams" },
          fatTarget: { type: "number", description: "Daily fat target, grams" },
          goalWeightLbs: { type: "number", description: "Goal body weight, pounds" },
          ...clientIdProp, ...localPlanProp,
        },
      },
    },
    {
      name: "list_exercises",
      description:
        "Get the app's exercise library (cardio + strength, grouped by movement pattern) to build a program with REAL ids. "
        + "Call before set_workout_schedule; use the exact ids returned.",
      input_schema: { type: "object", properties: {} },
    },
    {
      name: "add_custom_exercise",
      description:
        "Create a CUSTOM exercise for a movement not in the standard library (e.g. Sled Push, Battle Ropes). Returns its "
        + "id — use it in propose_workout/set_workout_schedule. Only use when nothing in list_exercises fits. "
        + "Estimate calPerMin (calories/min: walking ~4, jogging ~9, intense HIIT ~14). "
        + (isTrainer ? "Pass clientId to add it to a client's plan." : "Adds to YOUR plan."),
      input_schema: {
        type: "object",
        properties: {
          name: { type: "string", description: "Exercise name, e.g. 'Sled Push'" },
          type: { type: "string", enum: ["strength", "cardio"], description: "Whether it's strength or cardio" },
          calPerMin: { type: "number", description: "Estimated calories burned per minute (1–30), used for its burn" },
          ...clientIdProp, ...localPlanProp,
        },
        required: ["name", "type", "calPerMin"],
      },
    },
    {
      name: "propose_workout",
      description:
        "PREFERRED way to set a workout PROGRAM: design a weekly program from list_exercises ids, then call "
        + "propose_workout to show a tappable Accept CARD that saves it. Do NOT also call set_workout_schedule for the "
        + "same program. Briefly summarize the week in text too. Shape: cardio/strength day-keyed objects of "
        + "{ type: <id>, duration }. " + (isTrainer ? "Pass clientId to propose for a client." : ""),
      input_schema: {
        type: "object",
        properties: {
          cardio: { type: "object", description: "Per-day cardio, e.g. {\"Tuesday\":[{\"type\":\"incline_walk_8\",\"duration\":30}]}" },
          strength: { type: "object", description: "Per-day strength, e.g. {\"Monday\":[{\"type\":\"bb_bench\",\"duration\":45},{\"type\":\"bb_row\",\"duration\":45}]}" },
          replace: { type: "boolean", description: "Replace the whole week (unlisted days become rest). Default true." },
          ...clientIdProp, ...localPlanProp,
        },
      },
    },
    {
      name: "set_workout_schedule",
      description:
        "Write a weekly workout PROGRAM into the plan DIRECTLY (no card). Prefer propose_workout — only use this "
        + "when the user explicitly says to skip the confirmation card. Build from list_exercises ids: cardio and/or "
        + "strength as objects keyed by full day name (Monday…Sunday), each an array of "
        + "{ type: <exercise id>, duration: <minutes> }. Strength duration usually 45; cardio 20–40. "
        + "replace=true (default) sets the whole week (unlisted days become rest). "
        + (isTrainer ? "Pass clientId to program a client's plan." : "Updates YOUR plan."),
      input_schema: {
        type: "object",
        properties: {
          cardio: { type: "object", description: "Per-day cardio, e.g. {\"Tuesday\":[{\"type\":\"incline_walk_8\",\"duration\":30}]}" },
          strength: { type: "object", description: "Per-day strength, e.g. {\"Monday\":[{\"type\":\"bb_bench\",\"duration\":45},{\"type\":\"bb_row\",\"duration\":45}]}" },
          replace: { type: "boolean", description: "Replace the whole week (unlisted days become rest). Default true." },
          ...clientIdProp, ...localPlanProp,
        },
      },
    },
    {
      name: "search_food",
      description:
        "Look up a food's REAL nutrition from the databases (USDA + Open Food Facts). Use for PACKAGED / BRANDED "
        + "items (e.g. 'Quest cookies & cream bar', a specific cereal or protein powder) for accurate label values "
        + "instead of guessing. Returns matches with calories + protein/carbs/fat PER 100 g — pick the best match, "
        + "SCALE to the portion eaten, then use propose_meal / log_meal. For simple whole foods (an apple, grilled "
        + "chicken) estimate directly without this.",
      input_schema: {
        type: "object",
        properties: { query: { type: "string", description: "The food/product to search, e.g. 'Clif builder bar chocolate'" } },
        required: ["query"],
      },
    },
    {
      name: "list_notes",
      description:
        "List the user's saved NOTES (title, body, storage location, and ids for update_note). Call before updating "
        + "so you edit the right note instead of duplicating (especially recaps — re-recapping should UPDATE the "
        + "existing recap note). A trainer passing clientId sees the client's SHARED notes plus the trainer's own "
        + "private notes about that client — a client's PRIVATE notes are never visible to anyone else. "
        + "Pass localPlanId instead for notes about one of your own plan files (those people are clients too).",
      input_schema: { type: "object", properties: { ...clientIdProp, ...localPlanProp } },
    },
    {
      name: "create_note",
      description:
        "Save a NOTE to the user's Notes panel. Use for 'write this down', 'remember this', 'save a recap' "
        + "(kind='recap' — a conversation summary or client snapshot). For a CLIENT the note is PRIVATE by default "
        + "(shared=true makes it visible to their trainer — ask before sharing). For a TRAINER with clientId: "
        + "private-to-the-trainer by default; shared=true puts it in the client's notes where they can see it. "
        + "For a LOCAL PLAN (localPlanId) the note is filed against that person in your own account — there is no "
        + "login on their end, so shared has no meaning there. Title optional (auto from first line).",
      input_schema: {
        type: "object",
        properties: {
          body: { type: "string", description: "The note content (plain text; newlines ok)" },
          title: { type: "string", description: "Optional title; defaults to the first line" },
          shared: { type: "boolean", description: "true = visible to the other side (client↔trainer). Default false (private)." },
          kind: { type: "string", enum: ["note", "recap"], description: "'recap' for conversation summaries / client snapshots (gets a recap badge)" },
          ...clientIdProp, ...localPlanProp,
        },
        required: ["body"],
      },
    },
    {
      name: "update_note",
      description:
        "Update an existing note by id (from list_notes). Default APPENDS (appendBody adds to the end); pass body to "
        + "REPLACE content, title to retitle. Use for running lists and refreshing recap notes instead of duplicating.",
      input_schema: {
        type: "object",
        properties: {
          noteId: { type: "string", description: "The note's id from list_notes" },
          appendBody: { type: "string", description: "Text to ADD to the end of the note" },
          body: { type: "string", description: "REPLACE the whole body with this" },
          title: { type: "string", description: "New title" },
          ...clientIdProp, ...localPlanProp,
        },
        required: ["noteId"],
      },
    },
    {
      // Feature requests straight from the person hitting the gap (Kevin, S140).
      // The value is the CONTEXT: it arrives with what they were trying to do,
      // which a support email never has.
      name: "send_app_request",
      description:
        "Send the Glidna team a feature request or product suggestion from this user. Use when they wish the "
        + "app did something it doesn't, or hit a limitation and want it changed — e.g. \"I wish I could log "
        + "recipes\", \"why can't I see last month's totals?\". ALWAYS ask first (\"want me to send that to the "
        + "Glidna team?\") and only call this once they say yes. Summarise their request clearly in your own "
        + "words, and put what they were doing when it came up in context. Do NOT use for bug reports about "
        + "data being wrong — check their data first. Do NOT send the same request twice in one conversation.",
      input_schema: {
        type: "object",
        properties: {
          request: { type: "string", description: "The feature they want, in one or two clear sentences." },
          context: { type: "string", description: "What they were doing when it came up, and why it matters to them." },
        },
        required: ["request"],
      },
    },
    {
      name: "fetch_link",
      description:
        "Read a web/video LINK the user shares (YouTube/Instagram/TikTok workout or recipe, blog, article) and get "
        + "its text (title + description/caption). Use whenever the user pastes a URL and wants its content used. Then "
        + "extract the exercises/meals and offer to add them with the normal tools (propose_workout / "
        + "add_custom_exercise / propose_meal). If it returns little or errors (common for TikTok/Instagram), ask "
        + "the user to paste the caption/description text instead.",
      input_schema: {
        type: "object",
        properties: {
          url: { type: "string", description: "The full http(s) link the user shared." },
        },
        required: ["url"],
      },
    },
  ];

  if (isTrainer) {
    tools.push({
      name: "list_local_plans",
      description:
        "List the trainer's OWN local plan files and simulations (NOT connected client accounts — that's "
        + "list_clients). Includes imported Trainerize clients, prep/template files, and sandbox sims. Use the "
        + "returned localPlanId with the other tools to read/edit one of these files.",
      input_schema: { type: "object", properties: {} },
    });
    tools.push({
      name: "list_clients",
      description:
        "List ALL your connected clients (id, name, last log date, days since last logged). Use ONLY when the user wants the whole roster — for ONE named person, use find_client instead (much cheaper). Use the returned id with the other tools. "
        + "Head trainers: pass includeTeam=true to ALSO include the clients of the sub-trainers on your team (each row is tagged with viaTrainer).",
      input_schema: {
        type: "object",
        properties: {
          includeTeam: { type: "boolean", description: "Head trainers only: also include clients belonging to your sub-trainers. Default false (your direct clients only)." },
        },
      },
    });
    tools.push({
      name: "list_sub_trainers",
      description:
        "List the sub-trainers on YOUR team (head trainers). Returns each one's id, name, email and how many clients they carry. "
        + "Use the returned subTrainerId with list_clients(includeTeam)/coach_summary to drill into their roster, and remember you can act on their clients directly with any tool by passing that client's clientId.",
      input_schema: { type: "object", properties: {} },
    });
    tools.push({
      name: "find_client",
      description:
        "Resolve ONE specific person by name to their id — searches ALL of this trainer's people in one call: connected client accounts AND the trainer's own local plan files (imported, prep and sandbox files). "
        + "Each match carries `kind`: \"client\" (use its `clientId`) or \"local_plan\" (use its `localPlanId`) — a local plan is usually a REAL client who simply never made an app account. "
        + "Returns names and ids only — NO activity, NO stats — so it is far cheaper than list_clients or coach_summary. ALWAYS use this when the user asks about a SINGLE named person; you do NOT need a second lookup call to cover local files. "
        + "Reserve list_clients for 'list everyone', list_local_plans for 'list my own files', and coach_summary for across-all-clients questions.",
      input_schema: {
        type: "object",
        properties: { query: { type: "string", description: "Part of the client's name or email (case-insensitive), OR their short code — either the 4-character ref like \"#KEM2\" or the small number shown on the trainer's home screen like \"#6\". An exact code match wins over a name match." } },
        required: ["query"],
      },
    });
    tools.push({
      name: "coach_summary",
      description:
        "Proactive coaching snapshot across ALL your people in ONE call — for 'who's stalled?', 'who needs "
        + "attention?', 'what should I change?'. Covers connected client accounts AND your own local plan files "
        + "(each row's `kind` says which), because a plan file is usually a real client without an app account. "
        + "Per person returns: days logged in the window, days since last log, "
        + "calorie & protein adherence (avg vs target), latest weigh-in, weight trend (lbs/week), on-track status, "
        + "open requests, and a status (inactive / stalled / off_track / on_track / logging). Use instead of the "
        + "per-client tools one by one, then give specific recommendations. A very large roster comes back one page at a time — `clientCount` is always the TRUE total, and `nextOffset` (when present) fetches the rest.",
      input_schema: {
        type: "object",
        properties: {
          days: { type: "number", description: "Window for activity/adherence, in days (default 7, max 31)." },
          offset: { type: "number", description: "Skip this many people. Only needed for a roster bigger than one page — the reply's `nextOffset` tells you the value to pass; omit it otherwise." },
        },
      },
    });
    tools.push({
      name: "confirm_ai_client",
      description:
        "Confirm using one monthly AI-client slot for a person the AI hasn't worked on yet this month. "
        + "Call this ONLY after another tool refused with 'isn't one of this month's AI clients yet' AND the "
        + "user explicitly said yes to using a slot — never silently. Then retry the original action. "
        + "Re-confirming someone already in this month's set is free and uses no new slot.",
      input_schema: {
        type: "object",
        properties: {
          clientId: { type: "string", description: "The connected client's id — same id the refused tool call used." },
          localPlanId: { type: "string", description: "The local plan file's id — same id the refused tool call used. Never with clientId." },
        },
      },
    });
    tools.push({
      name: "send_client_request",
      description:
        "Send a connected client a short to-do that appears on their home screen (e.g. log food, weigh in, record a workout). Confirm the message before sending.",
      input_schema: {
        type: "object",
        properties: {
          clientId: { type: "string", description: "The client's id from list_clients." },
          message: { type: "string", description: "The request text the client will see, e.g. 'Please log today's dinner.'" },
          type: { type: "string", enum: ["log_food", "weigh_in", "log_workout", "enter_info", "custom"], description: "Request type (drives the client's quick-action). Default custom." },
        },
        required: ["clientId", "message"],
      },
    });
  }
  // search_food RETIRED (S92) — measured no accuracy gain over the AI's own
  // estimate at 2–2.5× the tokens (docs/AI-ACCURACY.md). Never exposed now; the
  // tool def + runTool case are kept dead so re-enabling is a one-line change.
  return tools.filter((t) => t.name !== "search_food");
}

// ── access resolution: returns a uid string, or { error } the model sees ─────
// A client may switch AI off for their account entirely (profile field
// `aiOptOut`, set only by the client themselves — firestore.rules lets nobody
// but the owner/admin write a user doc, so a trainer can never opt their own
// client back IN). This is the enforcement half of the privacy disclosure: the
// policy tells clients they can refuse AI processing, and refusing has to
// actually stop it. Checked HERE because every client-targeting tool funnels
// through resolveTargetUid — the in-app assistant AND the MCP connector alike.
const AI_OPTED_OUT_SELF = "AI features are switched off for this account. The account holder can turn them back on in Glidna: the \u2261 menu, \"Use my data for AI features\".";
const AI_OPTED_OUT_CLIENT = "This client has switched AI off for their account, so their data can't be used by an AI assistant. You can still view and edit their plan normally inside Glidna. Only they can change this.";

async function resolveTargetUid(db, input, ctx) {
  // Checked for EVERY caller, not just clients: "AI is off for my account" has
  // to mean no assistant touches this account's data at all, whoever they are.
  if (ctx.aiOptOut) return { error: AI_OPTED_OUT_SELF };
  if (!ctx.isTrainer) return ctx.callerUid; // clients: always themselves
  const clientId = input && input.clientId;
  if (!clientId || clientId === ctx.callerUid) return ctx.callerUid;
  const prof = (await db.doc(`users/${clientId}`).get()).data();
  if (!prof) return { error: "No client found with that id." };
  if (ctx.role === "admin") return prof.aiOptOut ? { error: AI_OPTED_OUT_CLIENT } : clientId;
  // Direct client, or a trainer directly under me.
  if (prof.assignedTrainerId === ctx.callerUid || prof.headTrainerId === ctx.callerUid) {
    return prof.aiOptOut ? { error: AI_OPTED_OUT_CLIENT } : clientId;
  }
  // HEAD-OF-CHAIN (S116): a head trainer also reaches the clients of their
  // sub-trainers. This walks the SAME path firestore.rules isHeadOfTrainer()
  // uses — client → their assigned trainer → that trainer's headTrainerId —
  // rather than looking for headTrainerId on the CLIENT (never set there, which
  // is why head access silently failed before). One extra read, and only on the
  // fallback path, so direct-client access is unchanged.
  if (prof.assignedTrainerId) {
    try {
      const up = (await db.doc(`users/${prof.assignedTrainerId}`).get()).data();
      if (up && up.headTrainerId === ctx.callerUid) {
        return prof.aiOptOut ? { error: AI_OPTED_OUT_CLIENT } : clientId;
      }
    } catch (e) { /* fall through to the denial below */ }
  }
  return { error: "You don't have access to that client." };
}

// ── AI-client seats (S176f: 20/30/50, trial 15, Connect & admin uncapped) ────
// A trainer's paid tiers include a monthly allowance of DISTINCT people the AI
// works on — connected clients (c_<uid>) and local plan files (p_<planId>)
// both count, because a plan file is usually a real client. The month set only
// grows (that is the anti-shuffle property: rotating 25 plans still hits the
// wall at the tier's Nth distinct person), and a seat is consumed on FIRST
// ACTUAL AI USE — never by flipping a switch — behind an explicit confirm, so
// a mis-click can't burn a slot (Kevin's S176 requirement). Enforced HERE in
// runTool so the in-app chat, both Accept callables and the MCP connector all
// hit the same check. Roster-overview tools (list_clients, find_client,
// coach_summary, list_local_plans, list_sub_trainers) never reach this point
// and stay exempt — one coach_summary must not burn the month.
function seatMonthKey() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
// null = uncapped. Mirrors mcp.js planFor's tier resolution (substring hazards
// and all): connect BEFORE coach ("coach_connect" contains "coach"), ultra
// before max before coach. Grandfathered accounts (no trialStartedAt) are
// treated as Coach — consistent with how every other gate treats them as paid.
function seatCapFor(profile) {
  if (!profile) return 0;
  if (profile.role === "admin") return null;
  if (profile.subscriptionStatus === "active") {
    const t = String(profile.subscriptionTier || "").toLowerCase();
    // The ladder (S178b, Kevin). ONE number per tier, deliberately: a seat is
    // "a person the AI worked on this month" tracked once across every surface,
    // so a separate, higher connector allowance could not work — the bigger cap
    // would simply win (seat someone via Claude and they are seated everywhere),
    // and genuinely separate pools would let anyone with a connector seat their
    // 21st person through Claude and then work on them in-app for free. Kevin's
    // "20 in-app + 25 connector" intent is delivered by setting the single
    // number at the connector figure.
    //
    // Connect standalone sits BELOW Coach on purpose. It is the entry rung, and
    // this is what stops a big roster from rationally buying the cheapest tier
    // (the cannibalisation Kevin flagged three times).
    if (t.includes("connect")) return 15;   // Connect / Coach Connect
    if (t.includes("ultra")) return 55;     // Apex
    if (t.includes("max")) return 35;       // Elite
    return 25;                              // Coach (and any other active sub)
  }
  // Comped premium (admin-granted entitlement) acts as a FLOOR when there is no
  // active sub — checked AFTER the sub branch so a comped account that later
  // buys Elite/Apex/Connect gets the bigger cap, not a silent 20 (review catch).
  if (profile.entitlements && profile.entitlements.premium === true) return 25;
  const t = profile.trialStartedAt;
  const startMs = t && typeof t.toMillis === "function" ? t.toMillis()
    : typeof t === "number" ? t : null;
  if (!startMs) return 25; // grandfathered — treated as Coach
  const expired = Date.now() >= startMs + (profile.trialLengthDays || 30) * 86400000;
  return expired ? 0 : 15; // expired free tier never reaches here (AI gated upstream)
}
// Resolve the caller's cap once per runTool call. Entry points attach
// ctx.seatCap; if one ever forgets, we load the profile ourselves rather than
// silently not enforcing (belt and braces — a missed entry point must fail
// CLOSED, not open).
async function seatCapForCtx(db, ctx) {
  if (ctx.seatCap !== undefined) return ctx.seatCap;
  const prof = (await db.doc(`users/${ctx.callerUid}`).get()).data() || {};
  ctx.seatCap = seatCapFor(prof);
  return ctx.seatCap;
}
const SEAT_LIMIT_MSG = (used, cap) =>
  `Monthly AI-client limit reached (${used} of ${cap} this month). The AI can keep working with `
  + `this month's existing AI clients, and every manual feature works for everyone. The allowance `
  + `resets on the 1st (UTC). For more AI clients each month, open Glidna and see Plans & pricing — `
  + `don't quote a price, the app shows the current plans.`;

// ── tool execution ──────────────────────────────────────────────────────────
async function runTool(name, input, ctx) {
  const db = admin.firestore();
  input = input || {};

  if (name === "list_exercises") {
    // Static catalog (no target needed). Strength grouped by movement pattern.
    const byCat = {};
    for (const e of STRENGTH) { (byCat[e.cat] = byCat[e.cat] || []).push({ id: e.id, label: e.label }); }
    return { days: DAYS, cardio: CARDIO, strength: byCat,
      note: "Use these EXACT ids in set_workout_schedule (type field). duration is in minutes." };
  }

  if (name === "send_app_request") {
    // Top-level collection, Admin-SDK only (no client rules) — same shape as
    // `workflows` (S92). Nobody but the admin screen ever reads these.
    const text = String(input.request || "").trim().slice(0, 1200);
    if (!text) return { error: "Nothing to send — ask them what they'd like changed first." };
    const prof = (await db.doc(`users/${ctx.callerUid}`).get()).data() || {};
    // Cheap spam guard: cap per user per day. A runaway model loop shouldn't be
    // able to fill the admin screen.
    const day = ctx.today || new Date().toISOString().slice(0, 10);
    const dayRef = db.doc(`users/${ctx.callerUid}/appRequestUsage/${day}`);
    const sentToday = ((await dayRef.get()).data() || {}).count || 0;
    if (sentToday >= 5) {
      return { error: "They've already sent several requests today — thank them and say the team has them." };
    }
    await db.collection("appRequests").add({
      uid: ctx.callerUid,
      name: prof.displayName || [prof.firstName, prof.lastName].filter(Boolean).join(" ") || null,
      email: prof.email || null,
      role: ctx.role || null,
      request: text,
      context: String(input.context || "").trim().slice(0, 1200) || null,
      status: "new",
      createdAt: Date.now(),
    });
    await dayRef.set({ count: sentToday + 1, updatedAt: Date.now() }, { merge: true });
    return { ok: true, sent: true,
      note: "Sent to the Glidna team. Confirm it's been passed on — don't promise it will be built." };
  }

  if (name === "fetch_link") {
    // Read a shared URL's text (no account target needed). All guards in the helper.
    return await fetchLinkMeta(input.url);
  }

  if (name === "search_food") {
    // Food-database lookup (no account target needed).
    return await searchFoodDb(input.query);
  }

  if (name === "list_local_plans") {
    if (!ctx.isTrainer) return { error: "Only trainers have local plan files." };
    const index = (await kvGetJSON(db, ctx.callerUid, "caliq-index")) || [];
    const nums = await idNumMap(db, ctx.callerUid);
    const days = (ts) => ts ? Math.floor((Date.now() - ts) / 86400000) : null;
    return {
      plans: index.filter((p) => p && p.id).map((p) => ({
        localPlanId: p.id,
        ref: refCode(p.id),
        num: nums[p.id] || null,   // the "#6" shown on the trainer's home
        name: p.customName || p.name || "(unnamed)",
        isSimulation: !!p.isSimulation,
        importedFromTrainerize: !!p.trainerizeId,
        weightLbs: p.weight || null,
        goalWeightLbs: p.goal || null,
        daysSinceSaved: days(p.lastSaved),
      })),
      note: "Pass localPlanId to the other tools to read/edit one of these files. They are the trainer's own working files — separate from connected client accounts (list_clients).",
    };
  }

  if (name === "list_sub_trainers") {
    // The head's team (S116). Mirrors src/profile.js getMySubTrainers, but does
    // NOT filter on role: a trainer linked under a head is a member of the team
    // regardless of the exact role string, and the access rules key off
    // headTrainerId, not role.
    if (!ctx.isTrainer) return { error: "Only trainers have a team." };
    const snap = await db.collection("users")
      .where("headTrainerId", "==", ctx.callerUid).limit(100).get();
    const team = [];
    for (const doc of snap.docs) {
      if (doc.id === ctx.callerUid) continue; // a head's own headTrainerId points at itself
      const p = doc.data();
      const clients = await db.collection("users")
        .where("assignedTrainerId", "==", doc.id).limit(200).get();
      team.push({
        subTrainerId: doc.id,
        ref: refCode(doc.id),
        name: p.displayName || [p.firstName, p.lastName].filter(Boolean).join(" ") || p.email || "Trainer",
        email: p.email || null,
        clientCount: clients.size,
      });
    }
    return {
      team, count: team.length,
      note: team.length
        ? "You can act on any of their clients directly — pass that client's clientId to any tool. Use list_clients with includeTeam=true to see the whole roster."
        : "No sub-trainers yet. A trainer joins your team by entering your invite code in Glidna.",
    };
  }

  if (name === "list_clients") {
    if (!ctx.isTrainer) return { error: "Only trainers can list clients." };
    const MAX_LIST = 60; // same roster cap as coach_summary
    // Direct clients, plus (head trainers, opt-in) the clients of every
    // sub-trainer on the team. The access rules already permit a head to read
    // and write those clients — this just makes them DISCOVERABLE, which was
    // the missing half (S116).
    const trainerIds = [ctx.callerUid];
    const nums = await idNumMap(db, ctx.callerUid);
    const viaName = {};
    if (input.includeTeam) {
      const subs = await db.collection("users")
        .where("headTrainerId", "==", ctx.callerUid).limit(100).get();
      for (const s of subs.docs) {
        if (s.id === ctx.callerUid) continue;
        trainerIds.push(s.id);
        const sp = s.data();
        viaName[s.id] = sp.displayName || [sp.firstName, sp.lastName].filter(Boolean).join(" ") || sp.email || "Trainer";
      }
    }
    // Firestore `in` takes at most 30 values — chunk the roster query.
    const docs = [];
    for (let i = 0; i < trainerIds.length; i += 30) {
      const chunk = trainerIds.slice(i, i + 30);
      const s = await db.collection("users")
        .where("assignedTrainerId", chunk.length === 1 ? "==" : "in", chunk.length === 1 ? chunk[0] : chunk)
        .limit(MAX_LIST).get();
      docs.push(...s.docs);
      if (docs.length >= MAX_LIST) break;
    }
    const snap = { docs: docs.slice(0, MAX_LIST) };
    const out = [];
    for (const doc of snap.docs) {
      const p = doc.data();
      // Check BEFORE touching their plan or logs — don't read data we're not
      // allowed to use. Listed by name so the trainer knows they're still there.
      if (p.aiOptOut) {
        out.push({ clientId: doc.id, ref: refCode(doc.id), num: nums[doc.id] || null,
          name: p.displayName || [p.firstName, p.lastName].filter(Boolean).join(" ") || p.email || "Client",
          aiOptOut: true,
          note: "AI is switched off for this client's account — no data available to an assistant." });
        continue;
      }
      const id = await activePlanId(db, doc.id);
      // Latest logged date for the client's active plan — ONE doc via a
      // descending limit(1) query (this used to download every daily-log doc
      // the client ever wrote, per client, per call).
      const prefix = `caliq-log-${id}-`;
      let last = null;
      try {
        const logs = await db.collection(`users/${doc.id}/kv`)
          .where("k", ">=", prefix).where("k", "<=", prefix + "")
          .orderBy("k", "desc").limit(1).get();
        logs.forEach((l) => { const k = l.data().k || ""; last = k.slice(-10); });
      } catch (e) { /* ignore */ }
      let daysSince = null;
      if (last) {
        const today = new Date();
        daysSince = Math.round((Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())
          - new Date(last + "T00:00:00Z").getTime()) / 86400000);
      }
      out.push({
        clientId: doc.id,
        ref: refCode(doc.id),
        num: nums[doc.id] || null,   // the "#6" shown on the trainer's home
        name: p.displayName || [p.firstName, p.lastName].filter(Boolean).join(" ") || p.email || "Client",
        lastLogDate: last,
        daysSinceLastLog: daysSince,
        // Whose client is this? Absent = your own; set = on a sub-trainer's roster.
        ...(p.assignedTrainerId && p.assignedTrainerId !== ctx.callerUid
          ? { viaTrainer: viaName[p.assignedTrainerId] || "a sub-trainer", viaTrainerId: p.assignedTrainerId }
          : {}),
      });
    }
    out.sort((a, b) => (b.daysSinceLastLog ?? 1e9) - (a.daysSinceLastLog ?? 1e9));
    return { clients: out, count: out.length, includedTeam: !!input.includeTeam };
  }

  if (name === "find_client") {
    // Lightweight name → id resolver for a SINGLE person (S110d, Kevin). Unlike
    // list_clients/coach_summary it does NO per-client sub-reads and returns a
    // tiny result, so focusing on one client is cheap. One roster query, matched
    // in memory by name/email.
    //
    // S165 — searches BOTH pools. A trainer's people live in two places: connected
    // accounts AND their own local plan files. A local plan is very often a REAL
    // client who just won't install the app (Kevin), so resolving only accounts
    // was a wrong-account write waiting to happen: ask for "Pat", have a
    // "Patricia" on the roster, and the single fuzzy hit reads as settled — the
    // meal lands in Patricia's real diary. Searching both here (rather than
    // telling the model to make a second call) means the ambiguity is a FACT in
    // the result, not something the model has to remember to go looking for.
    if (!ctx.isTrainer) return { error: "Only trainers can find clients." };
    const q = String(input.query || "").trim().toLowerCase();
    if (!q) return { error: "Provide part of the client's name to search for." };
    const snap = await db.collection("users")
      .where("assignedTrainerId", "==", ctx.callerUid).limit(200).get();
    // Let the user reference a client by their SHORT ID code too (e.g. "#7K2M"),
    // not just the name — strip any leading "#" and compare case-insensitively.
    const qCode = q.replace(/[^a-z0-9]/g, "").toUpperCase();
    // A bare "#6" is the home screen's permanent number, not a refCode. Parse it
    // tolerantly — "#6", "6", "client #6", "# 6" all mean the same thing.
    const numMatch = /(?:^|[^0-9a-z])#\s*(\d{1,4})(?![0-9a-z])/.exec(q) || (/^\s*#?\s*(\d{1,4})\s*$/.exec(q));
    const qNum = numMatch ? Number(numMatch[1]) : null;
    const nums = await idNumMap(db, ctx.callerUid);
    // An EXACT code hit must win. Otherwise a bare "6" also substring-matches
    // every name/email containing a 6 and buries the one person actually meant.
    const exact = [], fuzzy = [];
    // Capped PER POOL, not overall: a shared cap would let a trainer with many
    // similarly-named connected clients crowd their own plan files out of the
    // result entirely — and an omission here reads to the model as "that person
    // doesn't exist", which is how the wrong Pat gets written to.
    const seen = { client: 0, local_plan: 0 };
    const consider = (row, hay) => {
      if ((qCode && row.ref === qCode) || (qNum != null && row.num === qNum)) { exact.push(row); return; }
      if (!hay.some((h) => String(h || "").toLowerCase().includes(q))) return;
      if (seen[row.kind] >= 8) return;
      seen[row.kind]++; fuzzy.push(row);
    };
    for (const doc of snap.docs) {
      const p = doc.data();
      const nm = p.displayName || [p.firstName, p.lastName].filter(Boolean).join(" ") || p.email || "Client";
      const row = { kind: "client", clientId: doc.id, ref: refCode(doc.id), num: nums[doc.id] || null,
        name: nm, email: p.email || null,
        ...(p.aiOptOut ? { aiOptOut: true, note: "AI is off for this client's account — their data can't be read by an assistant." } : {}) };
      consider(row, [nm, p.email]);
    }
    // ...and the caller's OWN plan files, in the same pass. These people are
    // every bit as much clients — they just never made an account.
    const ownIndex = (await kvGetJSON(db, ctx.callerUid, "caliq-index")) || [];
    for (const p of Array.isArray(ownIndex) ? ownIndex : []) {
      if (!p || !p.id) continue;
      const nm = p.customName || p.name || "(unnamed)";
      const row = { kind: "local_plan", localPlanId: p.id, ref: refCode(p.id), num: nums[p.id] || null,
        name: nm, isSimulation: !!p.isSimulation, importedFromTrainerize: !!p.trainerizeId,
        ...(p.weight ? { currentWeightLbs: Math.round(Number(p.weight)) } : {}) };
      consider(row, [nm]);
    }
    const matches = exact.length ? exact : fuzzy;
    // Same-name disambiguation (Kevin, S110e): when 2+ people match, enrich each
    // with current weight + last-log date so they can be told apart by a HUMAN
    // detail instead of the raw id. Only pay for these per-match reads when it's
    // actually ambiguous — a unique name stays a single cheap roster query.
    if (matches.length > 1) {
      for (const m of matches) {
        try {
          // A local plan lives in the CALLER's own kv under its own id; a
          // connected client's data lives in theirs under their active plan.
          const ownerUid = m.kind === "local_plan" ? ctx.callerUid : m.clientId;
          const pid = m.kind === "local_plan" ? m.localPlanId : await activePlanId(db, m.clientId);
          if (m.currentWeightLbs == null) {
            const wrap = await kvGetJSON(db, ownerUid, `caliq-${pid}`);
            const w = wrap && wrap.data && wrap.data.weightLbs;
            if (w) m.currentWeightLbs = Math.round(Number(w));
          }
          const prefix = `caliq-log-${pid}-`;
          // , not "" — an empty upper bound makes the range match only a
          // key equal to the prefix, so this quietly returned nothing and the
          // last-log date never appeared (the S85 gotcha, live again here).
          const logs = await db.collection(`users/${ownerUid}/kv`)
            .where("k", ">=", prefix).where("k", "<=", prefix + "")
            .orderBy("k", "desc").limit(1).get();
          logs.forEach((l) => { m.lastLogDate = (l.data().k || "").slice(-10); });
        } catch (e) { /* best-effort disambiguation */ }
      }
    }
    const kinds = new Set(matches.map((m) => m.kind));
    return {
      matches, count: matches.length,
      note: matches.length === 0
        ? "Nobody matched — neither a connected client nor one of your own plan files. Don't assume they aren't in Glidna on a partial name; try a different spelling, or list_clients / list_local_plans to see everyone."
        : matches.length > 1
          ? "Several people match. Ask the user which one, describing them by a human detail (email, current weight, or last-log date) — NEVER the raw id."
            + (kinds.size > 1 ? " NOTE: these span BOTH a connected account and one of the trainer's own plan files — that is exactly the case to ask about, because writing to the wrong one is invisible to them." : "")
          : matches[0].isSimulation
            ? "Heads up: the only match is a SIMULATION (a sandbox projection, not a real logged plan). Say so before writing anything into it."
            : undefined,
    };
  }

  if (name === "coach_summary") {
    if (!ctx.isTrainer) return { error: "Only trainers can use coach_summary." };
    const win = Math.max(1, Math.min(31, Math.round(Number(input.days) || 7)));
    const end = ctx.today; // YYYY-MM-DD (Eastern)
    const endMs = new Date(end + "T00:00:00Z").getTime();
    const start = new Date(endMs - (win - 1) * 86400000).toISOString().slice(0, 10);
    const round1 = (v) => Math.round(v * 10) / 10;
    const snap = await db.collection("users").where("assignedTrainerId", "==", ctx.callerUid).limit(500).get();
    const nums = await idNumMap(db, ctx.callerUid);
    const clients = [];
    const counts = { inactive: 0, never_logged: 0, stalled: 0, off_track: 0, on_track: 0, logging: 0 };
    // S178d — PAGE, not a silent cap. Three things were wrong with MAX=60:
    //  1. The break happened BEFORE the concern-sort, so past 60 people you got
    //     an arbitrary 60 in user-id order and then sorted THOSE — someone who
    //     had gone quiet could be missing entirely from a "who needs attention?"
    //     answer. Confidently incomplete is worse than no answer (the same
    //     lesson the S165 comment below records about local plans).
    //  2. clientCount reported the TRUNCATED length, so the model was told a
    //     300-client trainer had 60 clients. That is the actual silent lie.
    //  3. The cap was shared across both pools and connected clients ran first,
    //     so a trainer with 60+ connected accounts saw NONE of their local plan
    //     files — contradicting the S165 comment sitting directly below.
    // Fixed by building ONE ordered candidate list across both pools first
    // (identity only, cheap), then snapshotting just the requested page. The
    // page bound is about RESPONSE SIZE — reads are ~$0.0000006 each, but every
    // snapshot lands in the model's context — so it stays modest and pages.
    const PAGE = 60;
    const offset = Math.max(0, Math.round(Number(input.offset) || 0));
    // One person's coaching snapshot. Identical maths either way — only WHERE
    // the data lives differs: a connected client's in their own account, a local
    // plan's in the trainer's. Extracted so the two pools can never drift.
    const snapshot = async ({ ownerUid, planId, data, head, withRequests }) => {
      const targets = nutritionTargets(data);
      const prefix = `caliq-log-${planId}-`;
      let daysLogged = 0, calSum = 0, calDays = 0, protSum = 0, protDays = 0;
      try {
        const logs = await db.collection(`users/${ownerUid}/kv`)
          .where("k", ">=", prefix + start).where("k", "<=", prefix + end + "\uf8ff").get();
        logs.forEach((l) => {
          let lg = {}; try { lg = JSON.parse(l.data().value || "{}") || {}; } catch (e) { lg = {}; }
          if ((Number(lg.calories) || 0) > 0) { daysLogged++; calSum += Number(lg.calories) || 0; calDays++; }
          if ((Number(lg.protein) || 0) > 0) { protSum += Number(lg.protein); protDays++; }
        });
      } catch (e) { /* ignore */ }
      // true latest log date (one cheap desc/limit-1 query) → days since
      let lastLog = null;
      try {
        const ls = await db.collection(`users/${ownerUid}/kv`)
          .where("k", ">=", prefix).where("k", "<=", prefix + "\uf8ff").orderBy("k", "desc").limit(1).get();
        ls.forEach((l) => { lastLog = (l.data().k || "").slice(-10); });
      } catch (e) { /* ignore */ }
      const daysSince = lastLog
        ? Math.round((endMs - new Date(lastLog + "T00:00:00Z").getTime()) / 86400000) : null;
      const cur = Number(data.weightLbs) || null;
      const goal = Number(data.goalWeight) || null;
      const trend = weightTrend(data.checkIns);
      const rate = trend ? round1(trend.ratePerWeek) : null;
      const onTrack = (trend && cur && goal && goal !== cur) ? (etaWeeks(cur, goal, trend.ratePerWeek) != null) : null;
      let openReqs = 0;
      if (withRequests) {
        try {
          const reqs = await kvGetJSON(db, ownerUid, "caliq-requests");
          if (Array.isArray(reqs)) openReqs = reqs.filter((r) => r && r.status !== "done").length;
        } catch (e) { /* ignore */ }
      }
      let status;
      if (!lastLog) status = "never_logged";       // a file nobody has ever logged to
      else if (daysLogged === 0) status = "inactive";
      else if (onTrack === true) status = "on_track";
      else if (rate != null && goal && Math.abs(rate) < 0.15) status = "stalled";
      else if (onTrack === false) status = "off_track";
      else status = "logging";
      counts[status] = (counts[status] || 0) + 1;
      return {
        ...head, status,
        daysLoggedInWindow: daysLogged, lastLogDate: lastLog, daysSinceLastLog: daysSince,
        avgCalories: calDays ? Math.round(calSum / calDays) : null, calorieTarget: targets.calorieTarget,
        avgProtein: protDays ? Math.round(protSum / protDays) : null, proteinTarget: targets.proteinTarget,
        currentWeightLbs: cur, goalWeightLbs: goal,
        weightRatePerWeek: rate, onTrack,
        ...(withRequests ? { openRequests: openReqs } : {}),
      };
    };
    // ONE candidate list across BOTH pools, identity only — no per-person reads
    // yet, so building it costs nothing and the page can span both. Connected
    // accounts first, then the trainer's OWN plan files (S165): those are
    // clients too, they just never made an account, so a roster answer that
    // silently skipped them ("nobody needs attention") was confidently
    // incomplete — which is worse than no answer at all.
    const ownIndex = (await kvGetJSON(db, ctx.callerUid, "caliq-index")) || [];
    const candidates = [];
    for (const docSnap of snap.docs) candidates.push({ kind: "client", docSnap });
    for (const p of Array.isArray(ownIndex) ? ownIndex : []) {
      if (p && p.id) candidates.push({ kind: "local_plan", p });
    }
    const total = candidates.length;
    const pageItems = candidates.slice(offset, offset + PAGE);
    const nextOffset = offset + pageItems.length < total ? offset + pageItems.length : null;

    for (const c of pageItems) {
      if (c.kind === "client") {
        const uidC = c.docSnap.id;
        const p = c.docSnap.data();
        const cname = p.displayName || [p.firstName, p.lastName].filter(Boolean).join(" ") || p.email || "Client";
        // Roster tools bypass resolveTargetUid, so the opt-out has to be honoured
        // here too — otherwise a client who switched AI off still has their weight
        // and adherence read out to their trainer's assistant. Listed by NAME (so
        // the trainer isn't left wondering where they went) but with NO data.
        if (p.aiOptOut) {
          clients.push({ clientId: uidC, ref: refCode(uidC), num: nums[uidC] || null, name: cname,
            status: "ai_opted_out", aiOptOut: true,
            note: "This client has switched AI off for their account. Their data is not available to an AI assistant — view it in Glidna instead. Only they can change this." });
          continue;
        }
        const { id: planId, data } = await activePlanData(db, uidC);
        clients.push(await snapshot({ ownerUid: uidC, planId, data, withRequests: true,
          head: { kind: "client", clientId: uidC, ref: refCode(uidC), num: nums[uidC] || null, name: cname } }));
      } else {
        const p = c.p;
        const wrap = await kvGetJSON(db, ctx.callerUid, `caliq-${p.id}`);
        clients.push(await snapshot({
          ownerUid: ctx.callerUid, planId: p.id, data: (wrap && wrap.data) || {},
          withRequests: false,   // no login on the other end to receive a to-do
          head: { kind: "local_plan", localPlanId: p.id, ref: refCode(p.id), num: nums[p.id] || null,
            name: p.customName || p.name || "(unnamed)",
            ...(p.isSimulation ? { isSimulation: true } : {}),
            ...(p.trainerizeId ? { importedFromTrainerize: true } : {}) },
        }));
      }
    }
    // Most concerning first. `never_logged` sorts LAST on purpose: a file nobody
    // has ever logged to is usually a template or a sandbox, not a person who
    // has gone quiet — putting those at the top would bury the ones who have.
    const rank = { inactive: 0, off_track: 1, stalled: 2, logging: 3, on_track: 4, never_logged: 5 };
    clients.sort((a, b) => (rank[a.status] - rank[b.status]) || ((b.daysSinceLastLog ?? -1) - (a.daysSinceLastLog ?? -1)));
    return { windowDays: win, range: { start, end },
      // clientCount is the TRUE roster size, always — `returned` is how many of
      // them this page carries. Reporting the truncated length here is what used
      // to tell a 300-client trainer they had 60.
      clientCount: total, returned: clients.length, offset,
      ...(nextOffset != null ? { nextOffset } : {}),
      truncated: nextOffset != null,
      counts, clients,
      note: (nextOffset != null
        ? `Showing ${clients.length} of ${total} people (offset ${offset}); \`counts\` covers THIS PAGE only. Most concerning first within the page — call again with offset=${nextOffset} for the rest before concluding who needs attention most. `
        : "")
        + "Covers EVERYONE this trainer coaches: connected accounts (`clientId`) and their own plan files (`localPlanId`), "
        + "which are usually real clients without an app account. `never_logged` means nothing has ever been logged for that person — "
        + "for a template or a sandbox (`isSimulation`) that is normal, not a problem to raise. To-dos can only be sent to a connected account." };
  }

  if (name === "set_notification_prefs") {
    // CALLER ONLY — notification prefs are personal; clientId is deliberately
    // ignored (a trainer never silences a client's notifications).
    // Keep in step with the Notification Center's type rows in SideMenu — a
    // key missing here means "turn off my referral notifications" silently
    // does nothing, which reads as the assistant ignoring you.
    const KEYS = ["master", "messages", "trainerReminders", "foodReminders",
      "weighInReminders", "coachingNudges", "sentReminders", "clientRequests",
      "automations", "referralRewards", "sessionBilling"];
    const patch = {};
    for (const k of KEYS) if (typeof input[k] === "boolean") patch[k] = input[k];
    if (!Object.keys(patch).length) return { error: "Say which notification type to turn on or off." };
    const updated = await kvTxnJSON(db, ctx.callerUid, "caliq-notif-prefs", (cur) =>
      ({ ...(cur && typeof cur === "object" ? cur : {}), ...patch }));
    return { ok: true, prefs: updated };
  }

  // Data tools — resolve & authorize the target user first.
  const uid = await resolveTargetUid(db, input, ctx);
  if (uid && uid.error) return uid; // { error }

  // Local-plan targeting (S87, trainers): localPlanId points a tool at one of
  // the CALLER's OWN local plan files/simulations (from list_local_plans)
  // instead of an account's manifest-active plan. Validated against the
  // caller's own index, and only ever applied to uid === callerUid — so it
  // can't widen access to anyone else's data. HOISTED above the notes tools
  // (S176f) so the seat gate below sees every target shape exactly once; the
  // notes tools' aboutPlan derives from this same validation now instead of
  // keeping its own copy (the old early-return branch the S175 inspection
  // flagged as a charge-point gap).
  let planOverride = null;
  if (ctx.isTrainer && input.localPlanId != null && input.localPlanId !== "") {
    if (input.clientId) return { error: "Use clientId OR localPlanId, not both." };
    const wantedPid = String(input.localPlanId);
    const localIndex = (await kvGetJSON(db, ctx.callerUid, "caliq-index")) || [];
    if (!localIndex.some((p) => p && p.id === wantedPid)) {
      return { error: "No local plan with that id — call list_local_plans to see the trainer's local files." };
    }
    planOverride = wantedPid;
  }

  // ── AI-client seat gate (S176f: 20/30/50, trial 15, Connect/admin uncapped) ─
  // Charged per DISTINCT target per UTC month, on first actual use, behind an
  // explicit confirm. seatKey is the target's identity: p_<planId> for a local
  // plan file (NEVER the resolved uid — resolveTargetUid maps every plan file
  // to callerUid, which would collapse all of them into one slot), c_<uid> for
  // a connected client. Self-work (a trainer's own body/plan) is never charged.
  const seatKey = planOverride ? `p_${planOverride}`
    : (ctx.isTrainer && uid !== ctx.callerUid ? `c_${uid}` : null);
  if (ctx.isTrainer && (seatKey || name === "confirm_ai_client")) {
    const cap = await seatCapForCtx(db, ctx);
    if (cap === null) { // uncapped (Connect tiers, admin) — no doc, no writes
      if (name === "confirm_ai_client") {
        return { ok: true, unlimited: true,
          note: "This plan has no monthly AI-client limit — nothing to confirm. Just retry the original action." };
      }
    } else {
      // Charge = a transaction (not read-then-write like mcpUsage): parallel
      // tool calls must not overshoot the cap. Idempotent — charging an
      // existing seat is free, which also makes propose→Accept re-runs safe.
      // The label is stored at charge time so the app's AI Clients screen
      // needs no joins later.
      const chargeSeat = async () => {
        let label = null;
        if (planOverride) {
          const idx = (await kvGetJSON(db, ctx.callerUid, "caliq-index")) || [];
          const row = idx.find((p) => p && p.id === planOverride);
          label = row ? (row.customName || row.name || null) : null;
        } else {
          const prof = (await db.doc(`users/${uid}`).get()).data() || {};
          label = prof.displayName
            || [prof.firstName, prof.lastName].filter(Boolean).join(" ") || prof.email || null;
        }
        const mref = db.doc(`users/${ctx.callerUid}/aiClients/${seatMonthKey()}`);
        return await db.runTransaction(async (tx) => {
          const snap = await tx.get(mref);
          const cur = snap.data() || {};
          const targets = cur.targets || {};
          const used = cur.count || Object.keys(targets).length;
          if (targets[seatKey]) return { used, already: true };
          if (used >= cap) return { full: true, used };
          tx.set(mref, {
            targets: { ...targets, [seatKey]: { ts: Date.now(), label } },
            count: used + 1, cap, updatedAt: Date.now(),
          }, { merge: true });
          return { used: used + 1 };
        });
      };
      if (name === "confirm_ai_client") {
        if (!seatKey) {
          return { error: "Say which person to confirm — pass their clientId (or localPlanId for a plan file)." };
        }
        const res = await chargeSeat();
        if (res.full) return { error: SEAT_LIMIT_MSG(res.used, cap) };
        return { ok: true, seatsUsed: res.used, seatCap: cap,
          note: res.already
            ? "They were already one of this month's AI clients — no new slot used. Retry the original action."
            : "Confirmed — one monthly AI-client slot used. Now retry the original action." };
      }
      // Every other target-scoped tool: the target must already hold a seat.
      const cur = (await db.doc(`users/${ctx.callerUid}/aiClients/${seatMonthKey()}`).get()).data() || {};
      const targets = cur.targets || {};
      if (!targets[seatKey]) {
        const used = cur.count || Object.keys(targets).length;
        if (used >= cap) return { error: SEAT_LIMIT_MSG(used, cap) };
        // Scheduled automations run headless — nobody is there to answer a
        // confirm, and the user consented by configuring an automation that
        // names its people. Only that path sets seatAutoConfirm — BUT bounded
        // (review catch): the prompt is free text, so a broad "check everyone"
        // must not burn the whole month unattended. Each run may auto-consume
        // at most 2 NEW seats (seatAutoConfirm starts at 2 and counts down);
        // past that it falls through to the normal ask-first refusal, which
        // lands in the automation's feed result.
        if (ctx.seatAutoConfirm > 0) {
          const res = await chargeSeat();
          if (res.full) return { error: SEAT_LIMIT_MSG(res.used, cap) };
          if (!res.already) ctx.seatAutoConfirm--;
        } else {
          return {
            error: `This person isn't one of this month's AI clients yet. Working on them will use 1 of `
              + `the ${cap} monthly AI-client slots on this plan (${used} used so far this month). Ask the `
              + `user to confirm first, then call confirm_ai_client with the same `
              + `${planOverride ? "localPlanId" : "clientId"}, then retry this action.`,
            needsSeatConfirm: true,
          };
        }
      }
    }
  }
  if (name === "confirm_ai_client") {
    // Trainer with no target reached the gate above; a client lands here.
    return { error: "Nothing to confirm — AI-client slots only apply to trainers working on a client or plan file." };
  }

  // ── Notes tools (S91, docs/NOTES-PLAN.md) ─────────────────────────────────
  // Privacy invariant enforced HERE, not by the model: the privkv (private)
  // store is only ever touched when the target IS the caller. A trainer with
  // clientId gets the client's SHARED notes + their own about-notes, period.
  if (name === "list_notes" || name === "create_note" || name === "update_note") {
    const isSelf = uid === ctx.callerUid;
    const cap = (arr) => [...arr].slice(0, 100);
    // Notes about one of the caller's OWN plan files (S166). That person is a
    // client who simply never made an account, so they get notes like anyone
    // else — filed in the caller's own store against the plan id, since there is
    // no second account to put them in. Validation now lives in the hoisted
    // planOverride block above (S176f) — one copy, and the seat gate covers it.
    const aboutPlan = planOverride || "";
    if (name === "list_notes") {
      const own = (await kvGetJSON(db, uid, "caliq-notes")) || [];
      if (aboutPlan) {
        const rows = own.filter((n) => n && n.aboutPlanId === aboutPlan)
          .map((n) => ({ id: n.id, title: n.title || "Untitled", body: String(n.body || "").slice(0, 1000),
            storedAs: "private-to-you-about-this-plan", kind: n.kind || "note",
            author: n.authorName || null, updatedAt: n.updatedAt || n.createdAt || null }))
          .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).slice(0, 30);
        return { count: rows.length, notes: rows };
      }
      const shared = own;
      const priv = isSelf ? (await privGetJSON(db, ctx.callerUid, "caliq-notes")) || [] : [];
      const about = !isSelf
        ? ((await kvGetJSON(db, ctx.callerUid, "caliq-notes")) || []).filter((n) => n && n.aboutUid === uid)
        : [];
      const fmt = (n, where) => ({ id: n.id, title: n.title || "Untitled", body: String(n.body || "").slice(0, 1000),
        storedAs: where, kind: n.kind || "note", author: n.authorName || null,
        aboutClient: n.aboutUid ? true : undefined,
        aboutLocalPlanId: n.aboutPlanId || undefined,
        updatedAt: n.updatedAt || n.createdAt || null });
      const notes = [
        ...priv.map((n) => fmt(n, "private")),
        ...shared.map((n) => fmt(n, isSelf ? (ctx.isTrainer ? "my-notes" : "shared-with-trainer") : "shared-with-client")),
        ...about.map((n) => fmt(n, "private-to-you-about-this-client")),
      ].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).slice(0, 30);
      return { count: notes.length, notes };
    }
    if (name === "create_note") {
      const body = String(input.body || "").trim().slice(0, 4000);
      if (!body) return { error: "Provide the note body." };
      const now = Date.now();
      const note = {
        id: `nt${now}${Math.floor(Math.random() * 1e4)}`,
        title: String(input.title || "").trim().slice(0, 60) || String(body.split("\n")[0]).slice(0, 40),
        body, authorUid: ctx.callerUid, authorName: ctx.callerName || "AI",
        visibility: "private", kind: input.kind === "recap" ? "recap" : "note",
        createdAt: now, updatedAt: now,
      };
      let storedAs;
      if (aboutPlan) {
        note.aboutPlanId = aboutPlan;
        await kvTxnJSON(db, ctx.callerUid, "caliq-notes", (arr) => cap([note, ...(Array.isArray(arr) ? arr : [])]));
        storedAs = "private-to-you-about-this-plan";
        return { ok: true, id: note.id, title: note.title, storedAs,
          ...(input.shared === true ? { note: "There is no account on their end, so nothing was shared — the note is filed against that plan in your own notes." } : {}) };
      }
      if (isSelf) {
        if (!ctx.isTrainer && input.shared !== true) {
          await privTxnJSON(db, ctx.callerUid, "caliq-notes", (arr) => cap([note, ...(Array.isArray(arr) ? arr : [])]));
          storedAs = "private";
        } else {
          if (!ctx.isTrainer) note.visibility = "shared";
          await kvTxnJSON(db, uid, "caliq-notes", (arr) => cap([note, ...(Array.isArray(arr) ? arr : [])]));
          storedAs = ctx.isTrainer ? "my-notes" : "shared-with-trainer";
        }
      } else if (input.shared === true) {
        note.visibility = "shared";
        await kvTxnJSON(db, uid, "caliq-notes", (arr) => cap([note, ...(Array.isArray(arr) ? arr : [])]));
        storedAs = "shared-with-client";
      } else {
        note.aboutUid = uid;
        await kvTxnJSON(db, ctx.callerUid, "caliq-notes", (arr) => cap([note, ...(Array.isArray(arr) ? arr : [])]));
        storedAs = "private-to-you-about-this-client";
      }
      return { ok: true, id: note.id, title: note.title, storedAs };
    }
    // update_note — find which accessible store holds the id, then transact it.
    const nid = String(input.noteId || "");
    if (!nid) return { error: "Provide the noteId (from list_notes)." };
    const apply = (arr) => (Array.isArray(arr) ? arr : []).map((n) => n && n.id === nid ? {
      ...n,
      title: input.title != null ? String(input.title).trim().slice(0, 60) || n.title : n.title,
      body: input.appendBody
        ? (String(n.body || "") + "\n" + String(input.appendBody).trim()).slice(0, 4000)
        : (input.body != null ? String(input.body).trim().slice(0, 4000) : n.body),
      updatedAt: Date.now(),
    } : n);
    const stores = isSelf
      ? [...(!ctx.isTrainer ? [["priv", ctx.callerUid]] : []), ["kv", uid]]
      : [["kv", uid], ["kv", ctx.callerUid]]; // client's shared notes, then my about-notes
    for (const [type, tuid] of stores) {
      const arr = type === "priv" ? await privGetJSON(db, tuid, "caliq-notes") : await kvGetJSON(db, tuid, "caliq-notes");
      if (Array.isArray(arr) && arr.some((n) => n && n.id === nid)) {
        if (type === "priv") await privTxnJSON(db, tuid, "caliq-notes", apply);
        else await kvTxnJSON(db, tuid, "caliq-notes", apply);
        return { ok: true, id: nid };
      }
    }
    return { error: "Note not found — call list_notes for current ids." };
  }

  // (planOverride is resolved in the hoisted block above the seat gate — S176f.)

  if (name === "get_nutrition_targets") {
    const { data } = await activePlanData(db, uid, planOverride);
    const t = nutritionTargets(data);
    return {
      ...t,
      currentWeightLbs: data.weightLbs != null ? Number(data.weightLbs) : null,
      goalWeightLbs: data.goalWeight != null ? Number(data.goalWeight) : null,
      note: t.calorieTarget == null
        ? "Calorie target unavailable — the plan is missing gender/age/height."
        : "Calorie target is the baseline diet target (excludes scheduled-exercise calories)."
          + (data.wearableAdjust && (data.deficitMode || "eatback") !== "accelerate"
            ? " Tracker adjustment is ON: on days the person's watch synced its measured burn, the app's day target is (measured resting+active − 500) instead of this baseline."
            : ""),
    };
  }

  if (name === "get_profile") {
    const { data } = await activePlanData(db, uid, planOverride);
    return profileSummary(data);
  }

  if (name === "set_personal_info") {
    const { id: planId, wrap } = await loadPlanWrap(db, uid, planOverride);
    const d = wrap.data;
    const changes = [];
    // clamp to sane ranges; round1 keeps one decimal (weights/percentages).
    const clampNum = (v, lo, hi, round1) => {
      const n = Number(v);
      if (!isFinite(n)) return null;
      const c = Math.max(lo, Math.min(hi, n));
      return round1 ? Math.round(c * 10) / 10 : Math.round(c);
    };
    if (typeof input.firstName === "string" && input.firstName.trim()) {
      d.firstName = input.firstName.trim().slice(0, 40); changes.push("name");
    }
    if (typeof input.lastName === "string" && input.lastName.trim()) {
      d.lastName = input.lastName.trim().slice(0, 40); if (!changes.includes("name")) changes.push("name");
    }
    if (input.gender === "male" || input.gender === "female") { d.gender = input.gender; changes.push(`gender ${input.gender}`); }
    if (input.age != null) { const a = clampNum(input.age, 13, 100); if (a) { d.age = a; changes.push(`age ${a}`); } }
    // Optional date of birth (S110g) — validate, store, and derive age. Empty
    // string clears it (falls back to the manual age).
    if (typeof input.dob === "string") {
      const dob = input.dob.trim();
      if (dob === "") { delete d.dob; changes.push("cleared dob"); }
      else if (ageFromDob(dob) != null) { d.dob = dob; changes.push(`date of birth (age ${ageFromDob(dob)})`); }
    }
    if (input.heightFeet != null) { const ft = clampNum(input.heightFeet, 3, 8); if (ft) { d.heightFt = ft; if (!changes.includes("height")) changes.push("height"); } }
    if (input.heightInches != null) { const inch = clampNum(input.heightInches, 0, 11); if (inch != null) { d.heightIn = inch; if (!changes.includes("height")) changes.push("height"); } }
    if (input.weightLbs != null) { const w = clampNum(input.weightLbs, 50, 1000, true); if (w) { d.weightLbs = w; changes.push(`weight ${w} lbs`); } }
    if (input.goalWeightLbs != null) { const g = clampNum(input.goalWeightLbs, 50, 1000, true); if (g) { d.goalWeight = g; changes.push(`goal weight ${g} lbs`); } }
    // Optional weight-range band (low–high). Accept either or both; keep low ≤ high.
    if (input.goalRangeLowLbs != null) { const lo = clampNum(input.goalRangeLowLbs, 50, 1000, true); if (lo) { d.goalRangeLow = lo; if (!changes.includes("goal range")) changes.push("goal range"); } }
    if (input.goalRangeHighLbs != null) { const hi = clampNum(input.goalRangeHighLbs, 50, 1000, true); if (hi) { d.goalRangeHigh = hi; if (!changes.includes("goal range")) changes.push("goal range"); } }
    if (d.goalRangeLow && d.goalRangeHigh && Number(d.goalRangeLow) > Number(d.goalRangeHigh)) {
      const t = d.goalRangeLow; d.goalRangeLow = d.goalRangeHigh; d.goalRangeHigh = t; // swap if reversed
    }
    if (input.activityLevel && ACTIVITY_MULT[input.activityLevel]) { d.activityLevel = input.activityLevel; changes.push(`activity ${input.activityLevel}`); }
    if (input.bodyFatPct != null) { const b = clampNum(input.bodyFatPct, 2, 70, true); if (b) { d.bodyFat = b; changes.push("body fat"); } }
    if (input.goalBodyFatPct != null) { const b = clampNum(input.goalBodyFatPct, 2, 70, true); if (b) { d.goalBodyFat = b; changes.push("goal body fat"); } }
    if (typeof input.trainerNotes === "string") { d.trainerNotes = input.trainerNotes.slice(0, 4000); changes.push("trainer notes"); }
    if (input.deficitMode === "eatback" || input.deficitMode === "accelerate") {
      d.deficitMode = input.deficitMode; changes.push(`nutrition approach: ${input.deficitMode === "eatback" ? "eat more (burn buys food)" : "faster results (burn buys speed)"}`);
    }
    if (["lose", "build", "health"].includes(input.fitnessGoal)) {
      d.fitnessGoal = input.fitnessGoal;
      changes.push(`main fitness goal: ${input.fitnessGoal === "lose" ? "lose fat" : input.fitnessGoal === "build" ? "build muscle" : "stay healthy"}`);
    }
    if (typeof input.wearableAdjust === "boolean") {
      d.wearableAdjust = input.wearableAdjust;
      changes.push(`tracker adjustment ${input.wearableAdjust ? "on (measured burn drives eat-back day targets)" : "off"}`);
    }
    if (changes.length === 0) return { error: "No valid profile fields were provided." };
    await kvSetJSON(db, uid, `caliq-${planId}`, wrap);
    await appendHistory(db, uid, planId, ctx, `updated profile: ${changes.join(", ")}`);
    if (planOverride) await touchLocalIndex(db, uid, planOverride);
    return { ok: true, updated: changes, profile: profileSummary(d) };
  }

  if (name === "list_plans") {
    const m = await readManifest(db, uid);
    return {
      activePlanId: m.active,
      plans: m.plans.map((p) => ({ id: p.id, name: p.name, active: p.id === m.active })),
      count: m.plans.length,
    };
  }

  if (name === "create_plan") {
    const nm = String(input.name || "").trim().slice(0, 60);
    if (!nm) return { error: "Provide a name for the new plan." };
    const copyStats = input.copyStats !== false; // default true
    const makeActive = input.makeActive !== false; // default true
    const m = await readManifest(db, uid);
    const newId = randId("p");
    // New plans start WITHOUT today's workout burn folded into the target
    // (S98, Kevin) — matches every client-side "new plan" path. Not carried by
    // copyStats (PERSONAL_FIELDS is stats only), so this is unambiguous. Only
    // NEW plans: existing plans leave deficitMode unset and stay on eat-back.
    const data = { deficitMode: "accelerate" };
    if (copyStats) {
      const cur = await activePlanData(db, uid); // copy from the CURRENT active plan
      const s = cur.data || {};
      for (const k of PERSONAL_FIELDS) if (s[k] != null && s[k] !== "") data[k] = s[k];
    }
    if (input.goalWeightLbs != null) {
      const g = Math.round(Number(input.goalWeightLbs) * 10) / 10;
      if (g > 0) data.goalWeight = g;
    }
    await kvSetJSON(db, uid, `caliq-${newId}`, { data, step: 0 });
    m.plans.push({ id: newId, name: nm, createdAt: Date.now() });
    if (makeActive) m.active = newId;
    await writeManifest(db, uid, m);
    await appendHistory(db, uid, newId, ctx, `created a new plan: "${nm}"`);
    return { ok: true, planId: newId, name: nm, activePlanId: m.active, copiedStats: copyStats, profile: profileSummary(data) };
  }

  if (name === "switch_plan") {
    const pid = String(input.planId || "").trim();
    const m = await readManifest(db, uid);
    const plan = m.plans.find((p) => p.id === pid);
    if (!plan) return { error: "No plan with that id. Call list_plans for the valid ids." };
    m.active = pid;
    await writeManifest(db, uid, m);
    await appendHistory(db, uid, pid, ctx, `switched the active plan to "${plan.name}"`);
    return { ok: true, activePlanId: pid, name: plan.name };
  }

  if (name === "rename_plan") {
    const pid = String(input.planId || "").trim();
    const newName = String(input.name || "").trim().slice(0, 60);
    if (!newName) return { error: "Provide the new plan name." };
    const m = await readManifest(db, uid);
    const plan = m.plans.find((p) => p.id === pid);
    if (!plan) return { error: "No plan with that id. Call list_plans for the valid ids." };
    const oldName = plan.name;
    m.plans = m.plans.map((p) => (p.id === pid ? { ...p, name: newName } : p));
    await writeManifest(db, uid, m);
    await appendHistory(db, uid, pid, ctx, `renamed the plan "${oldName}" to "${newName}"`);
    return { ok: true, planId: pid, name: newName };
  }

  if (name === "log_check_in") {
    // Merge non-weight check-in details (mood / body fat / hit-target / notes)
    // into the date's entry — same merge-never-replace rule as log_weigh_in.
    const re = /^\d{4}-\d{2}-\d{2}$/;
    const date = re.test(input.date || "") ? input.date : ctx.today;
    const mood = input.mood != null ? Math.max(1, Math.min(5, Math.round(Number(input.mood)))) : null;
    const bf = input.bodyFatPct != null ? Math.max(1, Math.min(75, Math.round(Number(input.bodyFatPct) * 10) / 10)) : null;
    const notes = input.notes != null ? String(input.notes).slice(0, 500) : null;
    const hit = typeof input.hitCalorieTarget === "boolean" ? input.hitCalorieTarget : null;
    if (mood == null && bf == null && notes == null && hit == null) {
      return { error: "Provide at least one of: mood, bodyFatPct, hitCalorieTarget, notes." };
    }
    const loggedBy = (ctx.isTrainer && uid !== ctx.callerUid) ? "trainer" : "client";
    const { id: planId, wrap } = await loadPlanWrap(db, uid, planOverride);
    const d = wrap.data;
    if (!Array.isArray(d.checkIns)) d.checkIns = [];
    const sameDay = d.checkIns.find((c) => c && c.date === date);
    const entry = { date, timestamp: checkInTimestamp(date), weight: null, calories: null, hitTarget: null,
      workedOut: null, mood: null, notes: "", bodyFat: null, loggedBy, isFuturePlan: false,
      ...(sameDay || {}) };
    if (mood != null) entry.mood = mood;
    if (bf != null) { entry.bodyFat = bf; d.bodyFat = bf; }
    if (notes != null) entry.notes = notes;
    if (hit != null) entry.hitTarget = hit;
    entry.timestamp = checkInTimestamp(date);
    d.checkIns = [...d.checkIns.filter((c) => c && c.date !== date), entry];
    await kvSetJSON(db, uid, `caliq-${planId}`, wrap);
    const bits = [mood != null && `mood ${mood}/5`, bf != null && `body fat ${bf}%`,
      hit != null && (hit ? "hit calorie target" : "missed calorie target"), notes != null && "a note"].filter(Boolean);
    await appendHistory(db, uid, planId, ctx, `checked in: ${bits.join(", ")} (${date})`);
    if (planOverride) await touchLocalIndex(db, uid, planOverride);
    return { ok: true, date, recorded: bits };
  }

  if (name === "log_measurements") {
    const re = /^\d{4}-\d{2}-\d{2}$/;
    const date = re.test(input.date || "") ? input.date : ctx.today;
    // Sanity-clamp each provided field (inches); ignore junk values.
    const vals = {};
    for (const f of MEASUREMENT_FIELDS) {
      if (input[f] == null) continue;
      const v = Math.round(Number(input[f]) * 10) / 10;
      if (v >= 3 && v <= 90) vals[f] = v;
    }
    if (!Object.keys(vals).length) {
      return { error: "Provide at least one measurement in inches: " + MEASUREMENT_FIELDS.join(", ") + "." };
    }
    const loggedBy = (ctx.isTrainer && uid !== ctx.callerUid) ? "trainer" : "client";
    const { id: planId, wrap } = await loadPlanWrap(db, uid, planOverride);
    const d = wrap.data;
    if (!Array.isArray(d.measurements)) d.measurements = [];
    const sameDay = d.measurements.find((e) => e && e.date === date);
    // Merge into the same date's entry — never wipe fields (log_check_in rule).
    const entry = { date, timestamp: checkInTimestamp(date), loggedBy, ...(sameDay || {}), ...vals };
    entry.timestamp = checkInTimestamp(date);
    d.measurements = [...d.measurements.filter((e) => e && e.date !== date), entry];
    const metrics = measurementMetrics(d, entry);
    // A computed body-fat % also updates the plan's bodyFat (like log_check_in) —
    // unless the user opted out of the estimate (measurements-only mode).
    if (metrics.bodyFatPct != null && !d.hideBodyFat) d.bodyFat = metrics.bodyFatPct;
    await kvSetJSON(db, uid, `caliq-${planId}`, wrap);
    const bits = Object.keys(vals).map((f) => `${f} ${vals[f]}"`);
    await appendHistory(db, uid, planId, ctx, `logged measurements: ${bits.join(", ")} (${date})`);
    if (planOverride) await touchLocalIndex(db, uid, planOverride);
    return { ok: true, date, recorded: vals, ...metrics,
      note: metrics.bodyFatPct == null
        ? "Body fat needs more fields — Bailey: men waist+hips+forearm+wrist, women hips+thigh+calf+wrist; Navy: waist+neck (+hips for women) + height on the profile."
        : undefined };
  }

  if (name === "get_measurements") {
    const { data: d } = await activePlanData(db, uid, planOverride);
    const list = Array.isArray(d.measurements) ? [...d.measurements] : [];
    if (!list.length) {
      return { entries: [], note: "No tape measurements logged yet. Log waist/hips/neck/thigh/calf/forearm/wrist (inches) with log_measurements." };
    }
    list.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    const limit = Math.max(1, Math.min(30, Math.round(Number(input.limit) || 8)));
    const entries = list.slice(0, limit).map((e) => {
      const m = measurementMetrics(d, e);
      const out = { date: e.date };
      for (const f of MEASUREMENT_FIELDS) if (e[f] != null) out[f] = e[f];
      if (m.baileyBF != null) out.baileyBF = m.baileyBF;
      if (m.navyBF != null) out.navyBF = m.navyBF;
      if (m.bodyFatPct != null) out.bodyFatPct = m.bodyFatPct;
      if (m.waistToHeight != null) out.waistToHeight = m.waistToHeight;
      return out;
    });
    const latest = entries[0] || null;
    const oldest = entries[entries.length - 1] || null;
    const change = {};
    if (latest && oldest && latest !== oldest) {
      for (const f of [...MEASUREMENT_FIELDS, "bodyFatPct", "waistToHeight"]) {
        if (latest[f] != null && oldest[f] != null) {
          change[f] = Math.round((latest[f] - oldest[f]) * 100) / 100;
        }
      }
    }
    const cur = measurementMetrics(d, list[0] || {});
    return { entries, changeOverWindow: Object.keys(change).length ? change : null,
      leanMassLbs: cur.leanMassLbs, goalWeightFromLeanMass: cur.goalWeightFromLeanMass,
      goalBodyFatPct: Number(d.goalBodyFat) || null,
      note: "waistToHeight > 0.5 = elevated health risk; under 0.5 is the goal. Body-fat %s are tape ESTIMATES (±2%) — the trend matters more than the absolute number." };
  }

  if (name === "log_water") {
    const oz = Math.round(Number(input.ounces) || 0);
    if (!oz || oz <= 0) return { error: "Provide the water amount in ounces (1 cup = 8 oz)." };
    if (oz > 400) return { error: "That's more water than a person drinks in a day — double-check the amount." };
    const re = /^\d{4}-\d{2}-\d{2}$/;
    const date = re.test(input.date || "") ? input.date : ctx.today;
    const { id: planId } = await activePlanData(db, uid, planOverride);
    const logKey = `caliq-log-${planId}-${date}`;
    const updated = await kvTxnJSON(db, uid, logKey, (log0) => {
      const log = log0 || {};
      const cur = Number(log.water) || 0;
      return { ...log, water: input.mode === "set" ? oz : Math.min(400, cur + oz) };
    });
    await appendHistory(db, uid, planId, ctx, `logged water: ${input.mode === "set" ? oz : "+" + oz} oz (${date})`);
    if (planOverride) await touchLocalIndex(db, uid, planOverride);
    return { ok: true, date, waterOz: updated.water };
  }

  if (name === "search_food_db") {
    const q = String((input && input.query) || "").trim().slice(0, 80);
    if (q.length < 2) return { error: "Give me a food to look up." };
    const url = process.env.FATSECRET_PROXY_URL || "";
    const secret = process.env.FATSECRET_PROXY_SECRET || "";
    if (!url || !secret || /placeholder/i.test(url)) {
      return { error: "The food database isn't available right now — estimate instead and say so." };
    }
    try {
      const { _runFoodSearch } = require("./foodsearch");
      const r = await _runFoodSearch(q, url, secret);
      const foods = (r && r.foods ? r.foods : []).slice(0, 8).map((f) => ({
        name: f.name, brand: f.brand || "", calories: f.kcal, protein: f.p, carbs: f.c, fat: f.f,
        serving: f.servingText || f.servingLabel || "", unit: f.unit || "g",
      }));
      if (!foods.length) return { foods: [], note: "Nothing matched — estimate it instead and tell the user." };
      return { foods, note: "Per the serving shown. Scale to what they actually ate before logging." };
    } catch (e) {
      console.error("search_food_db", e && e.message);
      return { error: "Food database lookup failed — estimate instead and say so." };
    }
  }
  if (name === "propose_meal") {
    // No write — normalize the meal and echo it back so the client renders an
    // Accept/Edit card. The actual save happens via the logMeal callable (Accept).
    const re = /^\d{4}-\d{2}-\d{2}$/;
    const meal = {
      name: String(input.name || "").slice(0, 120),
      mealType: mealTypeOf(input.mealType, "snack"),
      calories: Math.max(0, Math.round(Number(input.calories) || 0)),
      protein: Math.max(0, Math.round(Number(input.protein) || 0)),
      carbs: Math.max(0, Math.round(Number(input.carbs) || 0)),
      fat: Math.max(0, Math.round(Number(input.fat) || 0)),
      date: re.test(input.date || "") ? input.date : ctx.today,
      time: normMealTime(input.time, ctx),
    };
    const pMicros = sanitizeMicros(input.micros);
    if (pMicros) meal.micros = pMicros; // carried through the Accept card → logMeal
    if (ctx.isTrainer && input.clientId) {
      const t = await resolveTargetUid(db, { clientId: input.clientId }, ctx);
      if (t && t.error) return t; // unauthorized client → tell the model
      meal.clientId = input.clientId;
    }
    if (planOverride) meal.localPlanId = planOverride; // Accept card writes to the same local plan
    return { shown: true, meal };
  }

  if (name === "propose_workout") {
    // No write — validate + build the week (with labels for display) and echo it
    // back so the client renders an Accept card. Accept saves via the
    // setWorkoutSchedule callable, which re-runs set_workout_schedule.
    const replace = input.replace !== false;
    const { data } = await activePlanData(db, uid, planOverride); // for non-replace merge
    const cx = customExerciseSets(data); // the plan's custom exercises are valid ids too
    const strSet = new Set([...STRENGTH_IDS, ...cx.strengthIds]);
    const carSet = new Set([...CARDIO_IDS, ...cx.cardioIds]);
    const dropped = [];
    const built = {};
    if (input.strength && typeof input.strength === "object") {
      built.strength = buildWorkoutWeek(input.strength, strSet, 45, data.strength, replace, dropped);
    }
    if (input.cardio && typeof input.cardio === "object") {
      built.cardio = buildWorkoutWeek(input.cardio, carSet, 30, data.cardio, replace, dropped);
    }
    if (!built.strength && !built.cardio) return { error: "Provide cardio and/or strength as day-keyed objects." };
    // What the card shows (labels) and what Accept will write (raw ids), kept in sync.
    const workout = { replace, droppedInvalidIds: [...new Set(dropped)], raw: { replace } };
    if (built.strength) { workout.strength = weekWithLabels(built.strength, cx.labels); workout.raw.strength = built.strength; }
    if (built.cardio) { workout.cardio = weekWithLabels(built.cardio, cx.labels); workout.raw.cardio = built.cardio; }
    if (ctx.isTrainer && input.clientId) {
      const t = await resolveTargetUid(db, { clientId: input.clientId }, ctx);
      if (t && t.error) return t; // unauthorized client → tell the model
      workout.clientId = input.clientId;
      workout.raw.clientId = input.clientId;
    }
    if (planOverride) { workout.localPlanId = planOverride; workout.raw.localPlanId = planOverride; }
    return { shown: true, workout };
  }

  if (name === "log_meal") {
    const re = /^\d{4}-\d{2}-\d{2}$/;
    const date = re.test(input.date || "") ? input.date : ctx.today;
    const mealType = mealTypeOf(input.mealType);
    const meal = {
      id: randId("m"),
      name: String(input.name || "").slice(0, 120),
      type: mealType,
      calories: Math.max(0, Math.round(Number(input.calories) || 0)),
      protein: Math.max(0, Math.round(Number(input.protein) || 0)),
      carbs: Math.max(0, Math.round(Number(input.carbs) || 0)),
      fat: Math.max(0, Math.round(Number(input.fat) || 0)),
      time: normMealTime(input.time, ctx),
    };
    const lmMicros = sanitizeMicros(input.micros);
    if (lmMicros) meal.micros = lmMicros; // roll into the daily micronutrient bars
    const { id: planId } = await activePlanData(db, uid, planOverride);
    const logKey = `caliq-log-${planId}-${date}`;
    // Transactional append (S90 hardening): the AI logging while the app (or a
    // second device) writes the same day-log must not drop either side's meals.
    const updated = await kvTxnJSON(db, uid, logKey, (log0) => {
      const log = log0 || {};
      return {
        ...log,
        meals: [...(Array.isArray(log.meals) ? log.meals : []), meal],
        calories: (Number(log.calories) || 0) + meal.calories,
        protein: (Number(log.protein) || 0) + meal.protein,
        carbs: (Number(log.carbs) || 0) + meal.carbs,
        fat: (Number(log.fat) || 0) + meal.fat,
      };
    });
    // Mirror the activity feed (same shape as App.appendHistory), so AI-logged
    // meals show up in the client's history just like manual ones.
    try {
      const histKey = `caliq-history-${planId}`;
      const ev = {
        id: randId("e"),
        uid: ctx.callerUid,
        role: ctx.role,
        name: ctx.callerName || "AI assistant",
        action: `logged ${mealType || "a meal"} via AI: ${meal.name} (${meal.calories} cal)`,
        ts: Date.now(),
      };
      await kvTxnJSON(db, uid, histKey, (hist) =>
        [ev, ...(Array.isArray(hist) ? hist : [])].slice(0, 250));
    } catch (e) { /* history is best-effort */ }
    if (planOverride) await touchLocalIndex(db, uid, planOverride);
    return {
      ok: true,
      logged: { date, mealType, ...meal },
      dayTotals: { calories: updated.calories, protein: updated.protein, carbs: updated.carbs, fat: updated.fat },
    };
  }

  if (name === "plan_meals") {
    const items = Array.isArray(input.meals) ? input.meals.slice(0, 20) : [];
    if (!items.length) return { ok: false, error: "No meals to plan." };
    const re = /^\d{4}-\d{2}-\d{2}$/;
    const { id: planId } = await activePlanData(db, uid, planOverride);
    // Work out the target dates. Explicit `dates` wins; otherwise startDate plus
    // an optional weekday repeat. Capped so a bad weeks value can't fan out into
    // hundreds of writes.
    let dates = [];
    if (Array.isArray(input.dates) && input.dates.length) {
      dates = input.dates.filter((d) => re.test(String(d || ""))).slice(0, 120);
    } else {
      const start = re.test(String(input.startDate || "")) ? input.startDate : ctx.today;
      const dows = Array.isArray(input.weekdays)
        ? input.weekdays.map(Number).filter((n) => n >= 0 && n <= 6) : [];
      if (!dows.length) dates = [start];
      else {
        const weeks = Math.max(1, Math.min(26, Math.round(Number(input.weeks) || 1)));
        const s0 = new Date(start + "T12:00:00");
        for (let w = 0; w < weeks; w++) {
          for (let d = 0; d < 7; d++) {
            const dt = new Date(s0.getTime());
            dt.setDate(dt.getDate() + w * 7 + d);
            if (dows.includes(dt.getDay())) {
              dt.setHours(12, 0, 0, 0);
              dates.push(`${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`);
            }
          }
        }
        dates = [...new Set(dates)].slice(0, 120);
      }
    }
    if (!dates.length) return { ok: false, error: "No valid dates to plan for." };
    // Same shape the app's own planner writes, so a plan made by chat and one
    // made by hand are indistinguishable to the UI.
    const build = () => items.map((it, i) => {
      const mealType = mealTypeOf(it.mealType);
      const o = { id: randId("p") + i, name: String(it.name || "").slice(0, 120), type: mealType,
        calories: Math.max(0, Math.round(Number(it.calories) || 0)),
        protein: Math.max(0, Math.round(Number(it.protein) || 0)),
        carbs: Math.max(0, Math.round(Number(it.carbs) || 0)),
        fat: Math.max(0, Math.round(Number(it.fat) || 0)),
        done: false };
      if (it.time) o.time = String(it.time).slice(0, 12);
      if (it.place) o.place = String(it.place).slice(0, 80);
      if (Number(it.grams) > 0) { o.grams = Math.round(Number(it.grams)); o.unit = "g"; }
      return o;
    });
    let planned = 0;
    for (const date of dates) {
      const logKey = `caliq-log-${planId}-${date}`;
      // Transactional append — planning must never overwrite a day's existing
      // meals, totals or an earlier plan.
      await kvTxnJSON(db, uid, logKey, (log0) => {
        const log = log0 || {};
        return { ...log, planned: [...(Array.isArray(log.planned) ? log.planned : []), ...build()] };
      });
      planned++;
    }
    try {
      const histKey = `caliq-history-${planId}`;
      const ev = { id: randId("e"), uid: ctx.callerUid, role: ctx.role, name: ctx.callerName || "AI assistant",
        action: `planned ${items.length} meal${items.length === 1 ? "" : "s"} across ${planned} day${planned === 1 ? "" : "s"}`.slice(0, 300), ts: Date.now() };
      await kvTxnJSON(db, uid, histKey, (hist) => [ev, ...(Array.isArray(hist) ? hist : [])].slice(0, 250));
    } catch (e) { /* best-effort */ }
    if (planOverride) await touchLocalIndex(db, uid, planOverride);
    return { ok: true, days: planned, mealsPerDay: items.length,
      firstDate: dates[0], lastDate: dates[dates.length - 1],
      note: "Planned only — nothing counts toward the day's totals until it is ticked off in the app." };
  }

  if (name === "log_meals") {
    const items = Array.isArray(input.meals) ? input.meals.slice(0, 30) : [];
    if (!items.length) return { ok: false, error: "No meals to log." };
    const re = /^\d{4}-\d{2}-\d{2}$/;
    const { id: planId } = await activePlanData(db, uid, planOverride);
    // Build meal objects and group by date (usually just today) so each day's log
    // is one transactional write with all its meals.
    // Batch-level date: previously only `it.date` was read, so a model passing a
    // single date for the whole list had it silently discarded and every item
    // landed on today — while the reply confidently named the intended day.
    const batchDate = /^\d{4}-\d{2}-\d{2}$/.test(String(input.date || "")) ? input.date : null;
    const byDate = {};
    for (const it of items) {
      const date = re.test(it.date || "") ? it.date : (batchDate || ctx.today);
      const mealType = mealTypeOf(it.mealType);
      const meal = { id: randId("m"), name: String(it.name || "").slice(0, 120), type: mealType,
        calories: Math.max(0, Math.round(Number(it.calories) || 0)),
        protein: Math.max(0, Math.round(Number(it.protein) || 0)),
        carbs: Math.max(0, Math.round(Number(it.carbs) || 0)),
        fat: Math.max(0, Math.round(Number(it.fat) || 0)),
        time: normMealTime(it.time, ctx) };
      const mMicros = sanitizeMicros(it.micros);
      if (mMicros) meal.micros = mMicros; // roll into the daily micronutrient bars
      (byDate[date] = byDate[date] || []).push(meal);
    }
    const logged = [];
    for (const date of Object.keys(byDate)) {
      const dayMeals = byDate[date];
      const logKey = `caliq-log-${planId}-${date}`;
      await kvTxnJSON(db, uid, logKey, (log0) => {
        const log = log0 || {};
        const add = dayMeals.reduce((a, m) => ({ c: a.c + m.calories, p: a.p + m.protein, cb: a.cb + m.carbs, f: a.f + m.fat }), { c: 0, p: 0, cb: 0, f: 0 });
        return { ...log,
          meals: [...(Array.isArray(log.meals) ? log.meals : []), ...dayMeals],
          calories: (Number(log.calories) || 0) + add.c,
          protein: (Number(log.protein) || 0) + add.p,
          carbs: (Number(log.carbs) || 0) + add.cb,
          fat: (Number(log.fat) || 0) + add.f };
      });
      dayMeals.forEach((m) => logged.push({ date, name: m.name, calories: m.calories, mealType: m.type }));
      try {
        const histKey = `caliq-history-${planId}`;
        const ev = { id: randId("e"), uid: ctx.callerUid, role: ctx.role, name: ctx.callerName || "AI assistant",
          action: `logged ${dayMeals.length} items via AI: ${dayMeals.map((m) => m.name).join(", ")}`.slice(0, 300), ts: Date.now() };
        await kvTxnJSON(db, uid, histKey, (hist) => [ev, ...(Array.isArray(hist) ? hist : [])].slice(0, 250));
      } catch (e) { /* best-effort */ }
    }
    if (planOverride) await touchLocalIndex(db, uid, planOverride);
    return { ok: true, count: logged.length, logged };
  }

  if (name === "remove_meal") {
    const re = /^\d{4}-\d{2}-\d{2}$/;
    const date = re.test(input.date || "") ? input.date : ctx.today;
    const q = String(input.name || "").trim().toLowerCase();
    if (!q) return { ok: false, error: "Tell me which food to remove." };
    const { id: planId } = await activePlanData(db, uid, planOverride);
    const logKey = `caliq-log-${planId}-${date}`;
    let removed = null;
    const updated = await kvTxnJSON(db, uid, logKey, (log0) => {
      const log = log0 || {};
      const meals = Array.isArray(log.meals) ? log.meals.slice() : [];
      // Remove the MOST RECENT meal whose name matches (case-insensitive contains).
      let idx = -1;
      for (let i = meals.length - 1; i >= 0; i--) {
        if ((meals[i].name || "").toLowerCase().includes(q)) { idx = i; break; }
      }
      if (idx === -1) return log; // no match → leave unchanged
      removed = meals[idx];
      meals.splice(idx, 1);
      return {
        ...log, meals,
        calories: Math.max(0, (Number(log.calories) || 0) - (removed.calories || 0)),
        protein: Math.max(0, (Number(log.protein) || 0) - (removed.protein || 0)),
        carbs: Math.max(0, (Number(log.carbs) || 0) - (removed.carbs || 0)),
        fat: Math.max(0, (Number(log.fat) || 0) - (removed.fat || 0)),
      };
    });
    if (!removed) return { ok: false, error: `No logged food matching "${input.name}" found on ${date}.` };
    try {
      const histKey = `caliq-history-${planId}`;
      const ev = { id: randId("e"), uid: ctx.callerUid, role: ctx.role, name: ctx.callerName || "AI assistant",
        action: `removed via AI: ${removed.name} (${removed.calories || 0} cal)`, ts: Date.now() };
      await kvTxnJSON(db, uid, histKey, (hist) => [ev, ...(Array.isArray(hist) ? hist : [])].slice(0, 250));
    } catch (e) { /* best-effort */ }
    if (planOverride) await touchLocalIndex(db, uid, planOverride);
    return { ok: true, removed: { name: removed.name, calories: removed.calories || 0 }, date,
      dayTotals: { calories: updated.calories, protein: updated.protein, carbs: updated.carbs, fat: updated.fat } };
  }

  if (name === "log_workout") {
    const re = /^\d{4}-\d{2}-\d{2}$/;
    const date = re.test(input.date || "") ? input.date : ctx.today;
    const note = String(input.note || "").slice(0, 300);
    const loggedBy = (ctx.isTrainer && uid !== ctx.callerUid) ? "trainer" : "client";
    const { id: planId, wrap } = await loadPlanWrap(db, uid, planOverride);
    const d = wrap.data;
    if (!Array.isArray(d.checkIns)) d.checkIns = [];
    const ci = d.checkIns.find((c) => c.date === date);
    if (ci) { ci.workedOut = true; if (note) ci.notes = note; }
    else d.checkIns.push({ date, timestamp: checkInTimestamp(date), weight: null, calories: null,
      hitTarget: null, workedOut: true, mood: null, notes: note, bodyFat: null, loggedBy, isFuturePlan: false });
    await kvSetJSON(db, uid, `caliq-${planId}`, wrap);
    await appendHistory(db, uid, planId, ctx, note ? `recorded a workout: "${note}"` : "recorded a workout");
    if (planOverride) await touchLocalIndex(db, uid, planOverride);
    return { ok: true, date, note: note || null };
  }

  if (name === "log_weigh_in") {
    const v = Math.round((Number(input.weightLbs) || 0) * 10) / 10;
    if (!v || v <= 0) return { error: "Provide a weight greater than 0." };
    const re = /^\d{4}-\d{2}-\d{2}$/;
    const date = re.test(input.date || "") ? input.date : ctx.today;
    const loggedBy = (ctx.isTrainer && uid !== ctx.callerUid) ? "trainer" : "client";
    const { id: planId, wrap } = await loadPlanWrap(db, uid, planOverride);
    const d = wrap.data;
    if (!Array.isArray(d.checkIns)) d.checkIns = [];
    const prev = Number(d.weightLbs) || v;
    if (d.startWeightLbs == null || d.startWeightLbs === "") d.startWeightLbs = prev;
    d.weightLbs = v;
    // MERGE into an existing same-date check-in — a wholesale replace here used
    // to wipe a same-day workout/notes/body-fat (log_workout at 9am, weigh-in
    // at 8pm erased the workout), mirroring the log_workout merge behavior.
    const sameDay = d.checkIns.find((c) => c && c.date === date);
    const entry = { date, timestamp: checkInTimestamp(date), weight: v, calories: null, hitTarget: null,
      workedOut: null, mood: null, notes: "", bodyFat: null, loggedBy, isFuturePlan: false,
      ...(sameDay || {}) };
    entry.weight = v;
    entry.timestamp = checkInTimestamp(date);
    d.checkIns = [...d.checkIns.filter((c) => c && c.date !== date), entry];
    await kvSetJSON(db, uid, `caliq-${planId}`, wrap);
    await appendHistory(db, uid, planId, ctx, `logged weight: ${v} lbs`);
    if (planOverride) await touchLocalIndex(db, uid, planOverride);
    return { ok: true, date, weightLbs: v };
  }

  if (name === "set_targets") {
    const { id: planId, wrap } = await loadPlanWrap(db, uid, planOverride);
    const d = wrap.data;
    const changes = [];
    if (input.proteinTarget != null || input.carbsTarget != null || input.fatTarget != null) {
      // Pin ONLY the macros explicitly provided — the dashboard applies custom
      // values per-field and keeps the rest auto (1g/lb protein, 28% fat,
      // carbs = remainder). Back-filling all three here used to silently
      // freeze macros nobody chose at server-baseline numbers.
      const mt = { ...(d.macroTargets || {}) };
      const put = (key, inv) => { if (inv != null) { mt[key] = Math.max(0, Math.round(Number(inv))); changes.push(`${key} target to ${mt[key]}g`); } };
      put("protein", input.proteinTarget);
      put("carbs", input.carbsTarget);
      put("fat", input.fatTarget);
      d.macroTargets = mt;
      // Mark it as deliberately set so the 30-minute Trainerize sync stops
      // re-stamping its nutritionGoal over the top (functions/trainerize.js).
      d.macroTargetsEditedAt = Date.now();
    }
    if (input.goalWeightLbs != null) {
      const g = Math.round(Number(input.goalWeightLbs) * 10) / 10;
      if (g > 0) { d.goalWeight = g; changes.push(`goal weight to ${g} lbs`); }
    }
    if (changes.length === 0) return { error: "Provide at least one of protein/carbs/fat target or goal weight." };
    await kvSetJSON(db, uid, `caliq-${planId}`, wrap);
    await appendHistory(db, uid, planId, ctx, `updated ${changes.join(" and ")}`);
    if (planOverride) await touchLocalIndex(db, uid, planOverride);
    return { ok: true, updated: { macroTargets: d.macroTargets || null, goalWeightLbs: d.goalWeight != null ? d.goalWeight : null } };
  }

  if (name === "add_custom_exercise") {
    const exType = input.type === "cardio" ? "cardio" : (input.type === "strength" ? "strength" : null);
    if (!exType) return { error: "type must be 'strength' or 'cardio'." };
    const label = String(input.name || "").trim().slice(0, 60);
    if (!label) return { error: "Provide an exercise name." };
    const calPerMin = Math.max(1, Math.min(30, Math.round((Number(input.calPerMin) || 0) * 10) / 10));
    if (!calPerMin) return { error: "Provide a calPerMin estimate (1–30)." };
    const { id: planId, wrap } = await loadPlanWrap(db, uid, planOverride);
    const d = wrap.data;
    if (!Array.isArray(d.customExercises)) d.customExercises = [];
    // Dedupe by lowercased label + type — reuse the existing id if already there.
    const existing = d.customExercises.find((e) => e && e.type === exType && (e.label || "").toLowerCase() === label.toLowerCase());
    if (existing) return { ok: true, exercise: { id: existing.id, label: existing.label, type: exType }, note: "Already exists — reusing it." };
    const ex = { id: randId("custom_"), label, icon: "⭐", met: 0, calPerMin,
      cat: exType === "cardio" ? "Custom Cardio" : "Custom Strength", note: "Custom exercise — AI-estimated", isCustom: true, type: exType };
    d.customExercises.push(ex);
    await kvSetJSON(db, uid, `caliq-${planId}`, wrap);
    await appendHistory(db, uid, planId, ctx, `added a custom exercise: ${label}`);
    if (planOverride) await touchLocalIndex(db, uid, planOverride);
    return { ok: true, exercise: { id: ex.id, label: ex.label, type: exType, calPerMin } };
  }

  if (name === "set_workout_schedule") {
    const replace = input.replace !== false; // default true
    const { id: planId, wrap } = await loadPlanWrap(db, uid, planOverride);
    const d = wrap.data;
    const cx = customExerciseSets(d); // the plan's custom exercises are valid ids too
    const strSet = new Set([...STRENGTH_IDS, ...cx.strengthIds]);
    const carSet = new Set([...CARDIO_IDS, ...cx.cardioIds]);
    const dropped = [];
    const changed = [];
    if (input.strength && typeof input.strength === "object") {
      d.strength = buildWorkoutWeek(input.strength, strSet, 45, d.strength, replace, dropped); changed.push("strength");
    }
    if (input.cardio && typeof input.cardio === "object") {
      d.cardio = buildWorkoutWeek(input.cardio, carSet, 30, d.cardio, replace, dropped); changed.push("cardio");
    }
    if (changed.length === 0) return { error: "Provide cardio and/or strength as day-keyed objects." };
    await kvSetJSON(db, uid, `caliq-${planId}`, wrap);
    await appendHistory(db, uid, planId, ctx, "updated the workout program");
    if (planOverride) await touchLocalIndex(db, uid, planOverride);
    const summarize = (sched) => DAYS.filter((day) => ((sched || {})[day] || []).length)
      .map((day) => `${day} (${sched[day].length})`);
    return {
      ok: true, replaced: replace, updated: changed,
      strengthDays: summarize(d.strength), cardioDays: summarize(d.cardio),
      droppedInvalidIds: [...new Set(dropped)],
    };
  }

  if (name === "send_client_request") {
    if (!ctx.isTrainer) return { error: "Only trainers can send client requests." };
    if (!input.clientId) return { error: "clientId is required (from list_clients)." };
    const check = await resolveTargetUid(db, { clientId: input.clientId }, ctx);
    if (check && check.error) return check;
    if (check === ctx.callerUid) return { error: "Pick a client, not yourself." };
    const clientId = check;
    const msg = String(input.message || "").trim().slice(0, 500);
    if (!msg) return { error: "Provide the request message." };
    const type = ["log_food", "weigh_in", "log_workout", "enter_info", "custom"].includes(input.type) ? input.type : "custom";
    const now = Date.now();
    const req = { id: randId("r"), fromUid: ctx.callerUid, fromName: ctx.callerName || "Your trainer",
      type, prompt: msg, status: "open", createdAt: now, doneAt: null };
    // Transactional append (S90 hardening): concurrent request writers (AI +
    // trainer UI) must not drop each other's items.
    await kvTxnJSON(db, clientId, "caliq-requests", (cur) =>
      [req, ...(Array.isArray(cur) ? cur : [])].slice(0, 100));
    try { // history note in the client's account (matches the app's sendRequest)
      const ev = { id: randId("e"), uid: ctx.callerUid, role: ctx.role,
        name: ctx.callerName || "Your trainer", action: `sent a request: "${msg}"`, ts: now };
      await kvTxnJSON(db, clientId, "caliq-history-self", (hist) =>
        [ev, ...(Array.isArray(hist) ? hist : [])].slice(0, 250));
    } catch (e) { /* best-effort */ }
    return { ok: true, sentTo: clientId, message: msg, type };
  }

  if (name === "get_nutrition_log") {
    const range = clampDateRange(input.startDate, input.endDate);
    if (!range) return { error: "Dates must be YYYY-MM-DD." };
    const { id, data } = await activePlanData(db, uid, planOverride);
    const prefix = `caliq-log-${id}-`;
    // weigh-ins / workouts come from data.checkIns, indexed by date
    const ci = {};
    (Array.isArray(data.checkIns) ? data.checkIns : []).forEach((c) => { if (c && c.date) ci[c.date] = c; });
    // one range query for all logged days in the window
    const days = [];
    try {
      const snap = await db.collection(`users/${uid}/kv`)
        .where("k", ">=", prefix + range.start)
        .where("k", "<=", prefix + range.end + "").get();
      snap.forEach((docSnap) => {
        let log = {};
        try { log = JSON.parse(docSnap.data().value || "{}") || {}; } catch (e) { log = {}; }
        const date = (docSnap.data().k || "").slice(-10);
        const meals = (Array.isArray(log.meals) ? log.meals : []).map((m) => ({
          name: m.name || "", type: m.type || "", calories: Number(m.calories) || 0,
          protein: Number(m.protein) || 0, carbs: Number(m.carbs) || 0, fat: Number(m.fat) || 0,
          time: m.time || "", // local HH:MM the meal was eaten, when known — for time-of-day trends
        }));
        days.push({
          date,
          calories: Number(log.calories) || 0,
          protein: Number(log.protein) || 0,
          carbs: Number(log.carbs) || 0,
          fat: Number(log.fat) || 0,
          meals,
          weighInLbs: ci[date] && ci[date].weight != null ? Number(ci[date].weight) : null,
          workedOut: ci[date] ? !!ci[date].workedOut : false,
        });
      });
    } catch (e) { /* ignore */ }
    days.sort((a, b) => (a.date < b.date ? -1 : 1));
    const targets = nutritionTargets(data);
    return { range, daysLogged: days.length, days, targets };
  }

  return { error: "Unknown tool." };
}

module.exports = { buildTools, runTool, nutritionTargets, fetchLinkMeta, seatCapFor, seatMonthKey };
