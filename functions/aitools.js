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
async function fetchLinkMeta(rawUrl) {
  let u;
  try { u = new URL(String(rawUrl).trim()); } catch { return { error: "That doesn't look like a valid link." }; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return { error: "Only http/https links are supported." };
  if (isBlockedHost(u.hostname)) return { error: "That link can't be fetched." };

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
        { headers: { "User-Agent": "GlideAI/1.0 (+https://calorieiq-jet.vercel.app)" } });
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
  for (let i = 0; i < max; i++) { if (off[i]) push(off[i]); if (usda[i]) push(usda[i]); } // branded first
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
  for (const day of DAYS) {
    const arr = provided && Array.isArray(provided[day]) ? provided[day] : null;
    if (arr) {
      const sessions = [];
      for (const s of arr) {
        const type = s && s.type;
        if (validSet.has(type)) sessions.push({ type, duration: clampDur(s.duration, defDur) });
        else if (type) dropped.push(type);
      }
      result[day] = sessions;
    } else if (replace) {
      result[day] = []; // unlisted day within a replaced category → rest
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
    if (arr.length) r[day] = arr.map((s) => ({ type: s.type, label: (labelMap && labelMap[s.type]) || EX_LABEL[s.type] || s.type, duration: s.duration }));
  }
  return r;
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
function randId(p) { return `${p}${Date.now()}${Math.floor(Math.random() * 1000)}`; }

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
    const hist = (await kvGetJSON(db, uid, key)) || [];
    const ev = { id: randId("e"), uid: ctx.callerUid, role: ctx.role,
      name: ctx.callerName || "AI assistant", action, ts: Date.now() };
    await kvSetJSON(db, uid, key, [ev, ...(Array.isArray(hist) ? hist : [])].slice(0, 250));
  } catch (e) { /* best-effort */ }
}

// ── calorie/macro targets (matches src/App.jsx computeClientCalories +
// the dashboard macro defaults). The scheduled-exercise add-back is omitted —
// it's a small adjustment and zero for the common all-rest-days plan. ──────────
const ACTIVITY_MULT = { sedentary: 1.2, light: 1.375, moderate: 1.55, very: 1.725, extra: 1.9 };
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
function weeklyPlanBurn(d) {
  const w = Number(d.weightLbs) || 0;
  const custom = {};
  (Array.isArray(d.customExercises) ? d.customExercises : []).forEach((e) => { if (e && e.id) custom[e.id] = e; });
  const burnOf = (s) => {
    if (!s || !s.duration) return 0;
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
    const bmr = calcBMR(d.gender, w, d.heightFt, d.heightIn, Number(d.age));
    if (bmr && isFinite(bmr)) {
      const tdee = Math.round(bmr * (ACTIVITY_MULT[d.activityLevel] || 1.2));
      // Nutrition approach (matches App.jsx isEatback): "eatback" (default)
      // adds workout burn to the eating target; "accelerate" keeps TDEE−500
      // and lets the burn speed up the goal date instead.
      const eatback = (d.deficitMode || "eatback") !== "accelerate";
      cal = Math.max(1200, Math.round(tdee - 500 + (eatback ? weeklyPlanBurn(d) / 7 : 0)));
    }
  }
  const mt = d.macroTargets || {};
  const protein = mt.protein != null ? Number(mt.protein) : (w ? Math.round(w) : null);
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
    age: num(d.age) > 0,
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
    age: num(d.age),
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
    missing,
    complete: missing.length === 0,
    calorieTarget: t.calorieTarget,
  };
}

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
    ? { localPlanId: { type: "string", description: "Target one of YOUR OWN local plan files or simulations (id from list_local_plans) instead of an account — for prepping plans, sims, and imported Trainerize profiles. Do not combine with clientId." } }
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
        "Fill in or update the plan's personal profile — the core stats the app needs to compute a calorie target "
        + "(gender, age, height, current weight, activity level) plus optional goal weight and body-fat. Use this for "
        + "conversational onboarding: when the user gives you their stats, save them here so their plan is complete and "
        + "the dashboard shows a target. You may set fields the user just provided directly; only confirm first if you'd "
        + "OVERWRITE an existing value with a different one. "
        + (isTrainer ? "Pass clientId to set up a client's profile." : "Updates YOUR profile."),
      input_schema: {
        type: "object",
        properties: {
          firstName: { type: "string", description: "First name" },
          lastName: { type: "string", description: "Last name" },
          gender: { type: "string", enum: ["male", "female"], description: "Biological sex (used for the BMR/calorie calculation)" },
          age: { type: "number", description: "Age in years" },
          heightFeet: { type: "number", description: "Height — feet part (US units), e.g. 5 for 5'10\"" },
          heightInches: { type: "number", description: "Height — inches part (0–11), e.g. 10 for 5'10\". Convert from cm or total inches if the user gives those." },
          weightLbs: { type: "number", description: "Current body weight, pounds" },
          activityLevel: { type: "string", enum: ["sedentary", "light", "moderate", "very", "extra"],
            description: "Everyday activity level (NOT workouts): sedentary=desk job/mostly sitting; light=some walking; moderate=on feet most of the day; very=physically demanding job; extra=intense labor all day" },
          goalWeightLbs: { type: "number", description: "Goal body weight, pounds (optional)" },
          goalRangeLowLbs: { type: "number", description: "Optional healthy weight-range LOW bound, pounds (a band instead of one exact goal)" },
          goalRangeHighLbs: { type: "number", description: "Optional healthy weight-range HIGH bound, pounds (must be ≥ the low bound)" },
          bodyFatPct: { type: "number", description: "Current body-fat %, optional" },
          goalBodyFatPct: { type: "number", description: "Goal body-fat %, optional" },
          trainerNotes: { type: "string", description: "Free-text coaching notes on the plan (mainly for trainers). Replaces the existing notes." },
          deficitMode: { type: "string", enum: ["eatback", "accelerate"],
            description: "Nutrition approach: 'eatback' (default — workout burn is added to the daily calorie target: easier diet, steady ~1 lb/wk) or 'accelerate' (target stays at TDEE−500: tighter diet, workouts speed up the goal date instead). Set when the user chooses sustainability vs speed." },
          ...clientIdProp, ...localPlanProp,
        },
      },
    },
    {
      name: "list_plans",
      description:
        "List the plans on this account (id, name, and which is active). A person can have several plans — e.g. a cut "
        + "phase, a maintenance phase, a bulk. The active plan drives the dashboard, logging, and targets. "
        + (isTrainer ? TRAINER_NOTE : CLIENT_NOTE),
      input_schema: { type: "object", properties: { ...clientIdProp } },
    },
    {
      name: "create_plan",
      description:
        "Create a NEW plan — e.g. to start a cut, maintenance, or bulk phase. By default it carries over the person's "
        + "personal stats (gender/age/height/weight/activity) so they don't re-enter them, and becomes the active plan. "
        + "Pass goalWeightLbs to set the phase's goal. Workouts/targets/logs start fresh — build them after with the other "
        + "tools. Confirm with the user before creating. " + (isTrainer ? "Pass clientId to create for a client." : "Creates on YOUR account."),
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
        "Make a different EXISTING plan the active one (use a planId from list_plans). The active plan drives the "
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
      name: "propose_meal",
      description:
        "Show the user a tappable confirmation CARD for a meal you've estimated (from their description or a photo). "
        + "This is the PREFERRED way to log food: estimate the macros, then call propose_meal — the user taps Accept on "
        + "the card to save it (or Edit to adjust). Do NOT also call log_meal for the same meal; the card saves it. "
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
          date: { type: "string", description: "Date YYYY-MM-DD. Omit for today." },
          time: { type: "string", description: "Clock time the meal was eaten, e.g. '8:30am' or '19:45'. Set it when the user mentions when they ate; omit to use now." },
          ...clientIdProp, ...localPlanProp,
        },
        required: ["name", "mealType", "calories"],
      },
    },
    {
      name: "log_meal",
      description:
        "Save a meal to the food log DIRECTLY (no card). Prefer propose_meal instead — only use log_meal when the user "
        + "explicitly says to log without confirming (e.g. 'just log it, no card'). It appears on the dashboard, calendar, "
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
          date: { type: "string", description: "Date YYYY-MM-DD. Omit for today." },
          time: { type: "string", description: "Clock time the meal was eaten, e.g. '8:30am' or '19:45'. Set it when the user mentions when they ate; omit to use now." },
          ...clientIdProp, ...localPlanProp,
        },
        required: ["name", "mealType", "calories"],
      },
    },
    {
      name: "log_workout",
      description:
        "Record that a workout was completed on a day (marks the day as a workout day; feeds the streak and calendar). Add a short note for what they did if mentioned. "
        + "Confirm with the user first. " + (isTrainer ? "Pass clientId to record for a client." : "Records for YOU."),
      input_schema: {
        type: "object",
        properties: {
          note: { type: "string", description: "Optional note, e.g. 'Push day — felt strong'" },
          date: { type: "string", description: "Date YYYY-MM-DD. Omit for today." },
          ...clientIdProp, ...localPlanProp,
        },
      },
    },
    {
      name: "log_weigh_in",
      description:
        "Record a body-weight weigh-in. Updates current weight and the progress chart. Confirm the number with the user first. "
        + (isTrainer ? "Pass clientId to record for a client." : "Records for YOU."),
      input_schema: {
        type: "object",
        properties: {
          weightLbs: { type: "number", description: "Body weight in pounds" },
          date: { type: "string", description: "Date YYYY-MM-DD. Omit for today." },
          ...clientIdProp, ...localPlanProp,
        },
        required: ["weightLbs"],
      },
    },
    {
      name: "set_targets",
      description:
        "Update the plan's nutrition targets and/or goal weight. Set any of protein/carbs/fat target grams, or goal weight in pounds. "
        + "This CHANGES the plan — always confirm the specific numbers with the user before calling. "
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
        "Get the app's exercise library (cardio + strength, grouped by movement pattern) so you can build a workout program "
        + "using REAL exercise ids. Call this before set_workout_schedule. Use the exact ids returned.",
      input_schema: { type: "object", properties: {} },
    },
    {
      name: "add_custom_exercise",
      description:
        "Create a CUSTOM exercise on the plan for a movement that's not in the standard library (e.g. Battle Ropes, "
        + "Sled Push, TRX Row). Returns its id — then use that id in propose_workout/set_workout_schedule like any other "
        + "exercise. Only use this when nothing in list_exercises fits; prefer standard exercises. Estimate calPerMin "
        + "(calories burned per minute: walking ~4, jogging ~9, intense HIIT ~14). "
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
        "Show the user a tappable confirmation CARD for a weekly workout PROGRAM you've designed (from list_exercises ids). "
        + "This is the PREFERRED way to set a program: design it, then call propose_workout — the user taps Accept on the "
        + "card to save it to their plan (or asks you in chat for changes). Do NOT also call set_workout_schedule for the "
        + "same program; the card saves it. Briefly summarize the week in text too. Same shape as set_workout_schedule "
        + "(cardio/strength day-keyed objects of { type: <id>, duration }). " + (isTrainer ? "Pass clientId to propose for a client." : ""),
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
        "Write a weekly workout PROGRAM into the plan DIRECTLY (no card). Prefer propose_workout instead — only use this "
        + "when the user explicitly says to set it without a confirmation card. Build it from list_exercises ids. "
        + "Provide cardio and/or strength as objects keyed by full day name (Monday…Sunday); each day is an array of "
        + "{ type: <exercise id>, duration: <minutes> }. Strength duration is usually 45; cardio 20–40. "
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
        "Look up a food's REAL nutrition from the food databases (USDA + Open Food Facts). Use this for PACKAGED / BRANDED "
        + "items (e.g. 'Quest cookies & cream bar', 'Chobani vanilla yogurt', a specific cereal or protein powder) to get "
        + "accurate label values instead of guessing. Returns matches with calories + protein/carbs/fat PER 100 g — pick the "
        + "best match and SCALE it to the portion the user ate, then use propose_meal / log_meal. For simple home-cooked or "
        + "whole foods (an apple, grilled chicken) you can estimate directly without this.",
      input_schema: {
        type: "object",
        properties: { query: { type: "string", description: "The food/product to search, e.g. 'Clif builder bar chocolate'" } },
        required: ["query"],
      },
    },
    {
      name: "fetch_link",
      description:
        "Read a web/video LINK the user shares (a YouTube/Instagram/TikTok workout or recipe, a blog, an article) and get "
        + "its text — title + description/caption — so you can turn it into program changes. Use this whenever the user "
        + "pastes a URL and wants you to use its content (e.g. 'add the exercises from this video', 'log this recipe'). "
        + "After reading it, extract the exercises/meals and offer to add them with the normal tools (propose_workout / "
        + "add_custom_exercise / propose_meal). Note: for some platforms (especially Instagram/TikTok) the caption may not "
        + "be fetchable — if this returns little or an error, ask the user to paste the caption/description text instead.",
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
        + "list_clients). Local plans include imported Trainerize clients, prep/template files, and sandbox "
        + "simulations. Use the returned localPlanId with the other tools (via their localPlanId argument) to "
        + "read or edit one of these files.",
      input_schema: { type: "object", properties: {} },
    });
    tools.push({
      name: "list_clients",
      description:
        "List your connected clients. Returns each client's id, name, last log date, and days since they last logged. Use the returned id with the other tools.",
      input_schema: { type: "object", properties: {} },
    });
    tools.push({
      name: "coach_summary",
      description:
        "Get a proactive coaching snapshot across ALL your clients in ONE call — for questions like 'who's stalled "
        + "this week?', 'who needs attention?', or 'what should I change?'. For each client it returns: days logged in "
        + "the window, days since last log, calorie & protein adherence (avg logged vs target), latest weigh-in, weight "
        + "trend (lbs/week), whether they're on track to their goal, open requests, and a status (inactive / stalled / "
        + "off_track / on_track / logging). Use this instead of calling the per-client tools one by one, then give "
        + "specific recommendations.",
      input_schema: {
        type: "object",
        properties: {
          days: { type: "number", description: "Window for activity/adherence, in days (default 7, max 31)." },
        },
      },
    });
    tools.push({
      name: "send_client_request",
      description:
        "Send a connected client a short to-do that appears on their home screen (e.g. ask them to log food, weigh in, or record a workout). Confirm the message with the trainer before sending.",
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
  // search_food (real database values) is a Pro feature — only expose the tool
  // when the caller is entitled + has it enabled. Otherwise the AI estimates.
  if (!opts.foodDb) return tools.filter((t) => t.name !== "search_food");
  return tools;
}

// ── access resolution: returns a uid string, or { error } the model sees ─────
async function resolveTargetUid(db, input, ctx) {
  if (!ctx.isTrainer) return ctx.callerUid; // clients: always themselves
  const clientId = input && input.clientId;
  if (!clientId || clientId === ctx.callerUid) return ctx.callerUid;
  const prof = (await db.doc(`users/${clientId}`).get()).data();
  if (!prof) return { error: "No client found with that id." };
  if (ctx.role === "admin") return clientId;
  if (prof.assignedTrainerId === ctx.callerUid || prof.headTrainerId === ctx.callerUid) return clientId;
  return { error: "You don't have access to that client." };
}

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
    const days = (ts) => ts ? Math.floor((Date.now() - ts) / 86400000) : null;
    return {
      plans: index.filter((p) => p && p.id).map((p) => ({
        localPlanId: p.id,
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

  if (name === "list_clients") {
    if (!ctx.isTrainer) return { error: "Only trainers can list clients." };
    const MAX_LIST = 60; // same roster cap as coach_summary
    const snap = await db.collection("users")
      .where("assignedTrainerId", "==", ctx.callerUid).limit(MAX_LIST).get();
    const out = [];
    for (const doc of snap.docs) {
      const p = doc.data();
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
        name: p.displayName || [p.firstName, p.lastName].filter(Boolean).join(" ") || p.email || "Client",
        lastLogDate: last,
        daysSinceLastLog: daysSince,
      });
    }
    out.sort((a, b) => (b.daysSinceLastLog ?? 1e9) - (a.daysSinceLastLog ?? 1e9));
    return { clients: out, count: out.length };
  }

  if (name === "coach_summary") {
    if (!ctx.isTrainer) return { error: "Only trainers can use coach_summary." };
    const win = Math.max(1, Math.min(31, Math.round(Number(input.days) || 7)));
    const end = ctx.today; // YYYY-MM-DD (Eastern)
    const endMs = new Date(end + "T00:00:00Z").getTime();
    const start = new Date(endMs - (win - 1) * 86400000).toISOString().slice(0, 10);
    const round1 = (v) => Math.round(v * 10) / 10;
    const snap = await db.collection("users").where("assignedTrainerId", "==", ctx.callerUid).get();
    const clients = [];
    const counts = { inactive: 0, stalled: 0, off_track: 0, on_track: 0, logging: 0 };
    const MAX = 60;
    let truncated = false;
    for (const docSnap of snap.docs) {
      if (clients.length >= MAX) { truncated = true; break; }
      const uidC = docSnap.id;
      const p = docSnap.data();
      const cname = p.displayName || [p.firstName, p.lastName].filter(Boolean).join(" ") || p.email || "Client";
      const { id: planId, data } = await activePlanData(db, uidC);
      const targets = nutritionTargets(data);
      const prefix = `caliq-log-${planId}-`;
      // adherence within the window
      let daysLogged = 0, calSum = 0, calDays = 0, protSum = 0, protDays = 0;
      try {
        const logs = await db.collection(`users/${uidC}/kv`)
          .where("k", ">=", prefix + start).where("k", "<=", prefix + end + "").get();
        logs.forEach((l) => {
          let lg = {}; try { lg = JSON.parse(l.data().value || "{}") || {}; } catch (e) { lg = {}; }
          if ((Number(lg.calories) || 0) > 0) { daysLogged++; calSum += Number(lg.calories) || 0; calDays++; }
          if ((Number(lg.protein) || 0) > 0) { protSum += Number(lg.protein); protDays++; }
        });
      } catch (e) { /* ignore */ }
      // true latest log date (one cheap desc/limit-1 query) → days since
      let lastLog = null;
      try {
        const ls = await db.collection(`users/${uidC}/kv`)
          .where("k", ">=", prefix).where("k", "<=", prefix + "\uf8ff").orderBy("k", "desc").limit(1).get();
        ls.forEach((l) => { lastLog = (l.data().k || "").slice(-10); });
      } catch (e) { /* ignore */ }
      const daysSince = lastLog
        ? Math.round((endMs - new Date(lastLog + "T00:00:00Z").getTime()) / 86400000) : null;
      // weight trend + on-track
      const cur = Number(data.weightLbs) || null;
      const goal = Number(data.goalWeight) || null;
      const trend = weightTrend(data.checkIns);
      const rate = trend ? round1(trend.ratePerWeek) : null;
      const onTrack = (trend && cur && goal && goal !== cur) ? (etaWeeks(cur, goal, trend.ratePerWeek) != null) : null;
      // open requests
      let openReqs = 0;
      try {
        const reqs = await kvGetJSON(db, uidC, "caliq-requests");
        if (Array.isArray(reqs)) openReqs = reqs.filter((r) => r && r.status !== "done").length;
      } catch (e) { /* ignore */ }
      let status;
      if (daysLogged === 0) status = "inactive";
      else if (onTrack === true) status = "on_track";
      else if (rate != null && goal && Math.abs(rate) < 0.15) status = "stalled";
      else if (onTrack === false) status = "off_track";
      else status = "logging";
      counts[status]++;
      clients.push({
        clientId: uidC, name: cname, status,
        daysLoggedInWindow: daysLogged, lastLogDate: lastLog, daysSinceLastLog: daysSince,
        avgCalories: calDays ? Math.round(calSum / calDays) : null, calorieTarget: targets.calorieTarget,
        avgProtein: protDays ? Math.round(protSum / protDays) : null, proteinTarget: targets.proteinTarget,
        currentWeightLbs: cur, goalWeightLbs: goal,
        weightRatePerWeek: rate, onTrack, openRequests: openReqs,
      });
    }
    // surface the most concerning first (inactive → off_track → stalled → others)
    const rank = { inactive: 0, off_track: 1, stalled: 2, logging: 3, on_track: 4 };
    clients.sort((a, b) => (rank[a.status] - rank[b.status]) || ((b.daysSinceLastLog ?? -1) - (a.daysSinceLastLog ?? -1)));
    return { windowDays: win, range: { start, end }, clientCount: clients.length, counts, clients, truncated };
  }

  // Data tools — resolve & authorize the target user first.
  const uid = await resolveTargetUid(db, input, ctx);
  if (uid && uid.error) return uid; // { error }

  // Local-plan targeting (S87, trainers): localPlanId points a tool at one of
  // the CALLER's OWN local plan files/simulations (from list_local_plans)
  // instead of an account's manifest-active plan. Validated against the
  // caller's own index, and only ever applied to uid === callerUid — so it
  // can't widen access to anyone else's data.
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

  if (name === "get_nutrition_targets") {
    const { data } = await activePlanData(db, uid, planOverride);
    const t = nutritionTargets(data);
    return {
      ...t,
      currentWeightLbs: data.weightLbs != null ? Number(data.weightLbs) : null,
      goalWeightLbs: data.goalWeight != null ? Number(data.goalWeight) : null,
      note: t.calorieTarget == null
        ? "Calorie target unavailable — the plan is missing gender/age/height."
        : "Calorie target is the baseline diet target (excludes scheduled-exercise calories).",
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
    const data = {};
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

  if (name === "propose_meal") {
    // No write — normalize the meal and echo it back so the client renders an
    // Accept/Edit card. The actual save happens via the logMeal callable (Accept).
    const re = /^\d{4}-\d{2}-\d{2}$/;
    const meal = {
      name: String(input.name || "").slice(0, 120),
      mealType: ["breakfast", "lunch", "dinner", "snack"].includes(input.mealType) ? input.mealType : "snack",
      calories: Math.max(0, Math.round(Number(input.calories) || 0)),
      protein: Math.max(0, Math.round(Number(input.protein) || 0)),
      carbs: Math.max(0, Math.round(Number(input.carbs) || 0)),
      fat: Math.max(0, Math.round(Number(input.fat) || 0)),
      date: re.test(input.date || "") ? input.date : ctx.today,
      time: normMealTime(input.time, ctx),
    };
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
    const mealType = ["breakfast", "lunch", "dinner", "snack"].includes(input.mealType) ? input.mealType : "";
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
    const { id: planId } = await activePlanData(db, uid, planOverride);
    const logKey = `caliq-log-${planId}-${date}`;
    const log = (await kvGetJSON(db, uid, logKey)) || {};
    const updated = {
      ...log,
      meals: [...(Array.isArray(log.meals) ? log.meals : []), meal],
      calories: (Number(log.calories) || 0) + meal.calories,
      protein: (Number(log.protein) || 0) + meal.protein,
      carbs: (Number(log.carbs) || 0) + meal.carbs,
      fat: (Number(log.fat) || 0) + meal.fat,
    };
    await kvSetJSON(db, uid, logKey, updated);
    // Mirror the activity feed (same shape as App.appendHistory), so AI-logged
    // meals show up in the client's history just like manual ones.
    try {
      const histKey = `caliq-history-${planId}`;
      const hist = (await kvGetJSON(db, uid, histKey)) || [];
      const ev = {
        id: randId("e"),
        uid: ctx.callerUid,
        role: ctx.role,
        name: ctx.callerName || "AI assistant",
        action: `logged ${mealType || "a meal"} via AI: ${meal.name} (${meal.calories} cal)`,
        ts: Date.now(),
      };
      await kvSetJSON(db, uid, histKey, [ev, ...(Array.isArray(hist) ? hist : [])].slice(0, 250));
    } catch (e) { /* history is best-effort */ }
    if (planOverride) await touchLocalIndex(db, uid, planOverride);
    return {
      ok: true,
      logged: { date, mealType, ...meal },
      dayTotals: { calories: updated.calories, protein: updated.protein, carbs: updated.carbs, fat: updated.fat },
    };
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
    const cur = (await kvGetJSON(db, clientId, "caliq-requests")) || [];
    const req = { id: randId("r"), fromUid: ctx.callerUid, fromName: ctx.callerName || "Your trainer",
      type, prompt: msg, status: "open", createdAt: now, doneAt: null };
    await kvSetJSON(db, clientId, "caliq-requests", [req, ...(Array.isArray(cur) ? cur : [])].slice(0, 100));
    try { // history note in the client's account (matches the app's sendRequest)
      const hist = (await kvGetJSON(db, clientId, "caliq-history-self")) || [];
      const ev = { id: randId("e"), uid: ctx.callerUid, role: ctx.role,
        name: ctx.callerName || "Your trainer", action: `sent a request: "${msg}"`, ts: now };
      await kvSetJSON(db, clientId, "caliq-history-self", [ev, ...(Array.isArray(hist) ? hist : [])].slice(0, 250));
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

module.exports = { buildTools, runTool, nutritionTargets };
