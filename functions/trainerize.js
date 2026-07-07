// Glide — Trainerize import (read-only migration + wearable calorieOut).
//
// Lets a trainer pull their Trainerize clients + history into Glide, and (later)
// their wearable calories-burned via healthData.calorieOut — so we don't need a
// paid unified-wearable service for existing clients. See docs/TRAINERIZE-API.md.
//
// AUTH (from the API reference): all endpoints are POST to https://api.trainerize.com/v03/…,
// JSON body, HTTP Basic where the credential is base64("<GroupID>:<APIToken>").
//
// SETUP (Kevin, one-time — the function won't deploy until BOTH secrets exist):
//   1. In Trainerize (Studio), find your Group API ID + API token.
//   2. printf 'YOUR_GROUP_ID' | firebase functions:secrets:set TRAINERIZE_GROUP_ID --data-file=-
//   3. printf 'YOUR_API_TOKEN' | firebase functions:secrets:set TRAINERIZE_API_TOKEN --data-file=-
//   4. firebase deploy --only functions:trainerizeTest
// trainerizeTest just TESTS the connection (lists clients); trainerizeImport is the
// v1 importer. Both are ADMIN-ONLY (shared group token — see requireAdmin below).

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");

const TRAINERIZE_GROUP_ID = defineSecret("TRAINERIZE_GROUP_ID");
const TRAINERIZE_API_TOKEN = defineSecret("TRAINERIZE_API_TOKEN");

const BASE = "https://api.trainerize.com/v03";

// One authenticated POST to a Trainerize endpoint. Returns {ok,status,json}.
// 15s hard timeout — one hung call must not eat the importer's whole window
// (which would die mid-loop with the index write never happening).
async function tz(path, body, auth) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(`${BASE}/${path}`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body || {}),
      signal: controller.signal,
    });
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 500) }; }
    return { ok: res.ok, status: res.status, json };
  } catch (e) {
    // Timeout / network failure → a non-ok result instead of a throw, so the
    // import loop skips that client's field rather than dying mid-run.
    return { ok: false, status: 0, json: { error: (e && e.name === "AbortError") ? "timeout" : String(e && e.message) } };
  } finally {
    clearTimeout(timer);
  }
}

// These functions authenticate with KEVIN's shared Trainerize group token
// (Secret Manager) — so they must be callable ONLY by the platform owner.
// Anyone can self-signup as a "trainer", so a role check is NOT enough: a
// role-gated version would hand any stranger the real client roster (PII).
// Multi-tenant (each trainer connects their OWN token, stored encrypted)
// lifts this gate later — see docs/TRAINERIZE-API.md.
const ADMIN_UIDS = ["G7QUZ8Kat1fgyoMjdGKz4DYoVHi1"];
async function requireAdmin(uid) {
  if (!uid) throw new HttpsError("unauthenticated", "Sign in first.");
  if (!ADMIN_UIDS.includes(uid)) {
    throw new HttpsError("permission-denied",
      "The Trainerize connection is linked to the platform owner's account.");
  }
}

// ── kv helpers — mirror src/storage.js exactly: users/{uid}/kv/{encodeURIComponent(key)}
//    docs with { k: originalKey, value: jsonString }. Same pattern as aitools.js.
async function kvGetJSON(db, uid, key) {
  const snap = await db.doc(`users/${uid}/kv/${encodeURIComponent(key)}`).get();
  if (!snap.exists) return null;
  try { return JSON.parse(snap.data().value); } catch { return null; }
}
async function kvSetJSON(db, uid, key, obj) {
  await db.doc(`users/${uid}/kv/${encodeURIComponent(key)}`).set({ k: key, value: JSON.stringify(obj) });
}

// ── Field mapping: Trainerize → Glide plan `data` ───────────────────────────
// Trainerize activeLevel → Glide ACTIVITY_LEVELS id (App.jsx).
const ACTIVITY_MAP = {
  sedentary: "sedentary", lightlyActive: "light", moderatelyActive: "moderate",
  veryActive: "very", extremelyActive: "extra", extraActive: "extra",
};

// Age in whole years from a "YYYY-MM-DD" birth date (null if unparseable).
function ageFromBirthDate(birthDate) {
  if (!birthDate) return null;
  const b = new Date(`${birthDate}T00:00:00Z`);
  if (isNaN(b)) return null;
  const now = new Date();
  let age = now.getUTCFullYear() - b.getUTCFullYear();
  const m = now.getUTCMonth() - b.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < b.getUTCDate())) age--;
  return age > 0 && age < 120 ? age : null;
}

const round1 = (n) => Math.round(Number(n) * 10) / 10;

// Build the imported snapshot fields for one client. Only fields with real
// values are returned, so merging never blanks out data Kevin already has.
// profile: usrProfile entry (unitBodystats:"inches" → height is total inches).
// stats:   bodystats/get {date:"last"} response (or null).
// goals:   goal/getList goals[] (or []).
function mapSnapshot(profile, stats, goals) {
  const d = {};
  if (profile) {
    if (profile.firstName) d.firstName = String(profile.firstName).trim();
    if (profile.lastName) d.lastName = String(profile.lastName).trim();
    if (profile.sex === "male" || profile.sex === "female") d.gender = profile.sex;
    const age = ageFromBirthDate(profile.birthDate);
    if (age != null) d.age = String(age);
    const hIn = Number(profile.height);
    if (hIn > 36 && hIn < 96) { // sane 3–8 ft; height arrives as total inches
      d.heightFt = String(Math.floor(hIn / 12));
      d.heightIn = String(Math.round(hIn % 12));
    }
    const act = ACTIVITY_MAP[profile.activeLevel];
    if (act) d.activityLevel = act;
  }
  const bm = stats && stats.bodyMeasures;
  if (bm && Number(bm.bodyWeight) > 0) {
    d.weightLbs = String(round1(bm.bodyWeight));
    if (Number(bm.bodyFatPercent) > 0) d.bodyFat = String(round1(bm.bodyFatPercent));
    d._lastStatDate = stats.date || null; // internal: feeds the seeded check-in
  }
  for (const g of Array.isArray(goals) ? goals : []) {
    if (g.type === "weightGoal" && Number(g.weightGoal) > 0 && !d.goalWeight) {
      d.goalWeight = String(round1(g.weightGoal));
    }
    if (g.type === "nutritionGoal" && !d.macroTargets) {
      const p = Math.round(Number(g.proteinGrams)), c = Math.round(Number(g.carbsGrams)), f = Math.round(Number(g.fatGrams));
      if (p > 0 && c > 0 && f > 0) d.macroTargets = { protein: p, carbs: c, fat: f };
    }
  }
  return d;
}

// Wizard step labels (mirror App.jsx SL) — drives the plan-status badge.
const STEP_LABELS = ["Personal", "Goal Weight", "Activity", "Cardio", "Strength", "Results"];

// ── v2: nutrition history → Glide day logs ──────────────────────────────────
// Trainerize-NATIVE days carry full meal detail (meal name + clock time + each
// food with macros); MFP/Fitbit-synced days only carry day totals (those apps
// don't share per-food data) → those become one "<Source> day total" entry.
// Imported meals get stable ids "tz{nutritionId}-{i}" so a re-sync REPLACES
// prior imports (never duplicates) while leaving Glide-logged meals untouched.
const NUTRITION_DAYS = 365; // how far back a sync reaches (full year of history)
const MEAL_TYPE_MAP = { breakfast: "breakfast", lunch: "lunch", dinner: "dinner", snacks: "snack", snack: "snack" };
const r0 = (n) => Math.round(Number(n) || 0);

// One Trainerize nutrition entry → Glide meal items.
function glideMealsFromEntry(entry, detail) {
  const out = [];
  const meals = detail && Array.isArray(detail.meals) ? detail.meals : null;
  if (meals && meals.length) {
    let i = 0;
    for (const meal of meals) {
      const type = MEAL_TYPE_MAP[String(meal.name || "").toLowerCase()] || "";
      const time = (String(meal.mealTime || "").match(/\b(\d{2}:\d{2})/) || [])[1] || "";
      for (const f of Array.isArray(meal.foods) ? meal.foods : []) {
        out.push({ id: `tz${entry.id}-${i++}`, name: String(f.name || "Food").slice(0, 80), type,
          calories: r0(f.calories), protein: r0(f.proteins), carbs: r0(f.carbs), fat: r0(f.fat),
          ...(time ? { time } : {}) });
      }
    }
    if (out.length) return out;
  }
  // Summary-only day (MFP / Fitbit / empty detail): one day-total entry.
  const src = entry.source === "mFP" ? "MyFitnessPal" : entry.source === "fitbit" ? "Fitbit" : "Trainerize";
  out.push({ id: `tz${entry.id}-0`, name: `${src} day total`, type: "",
    calories: r0(entry.calories), protein: r0(entry.proteinGrams), carbs: r0(entry.carbsGrams), fat: r0(entry.fatGrams) });
  return out;
}

// ── v3: wearable health data → Glide day logs ───────────────────────────────
// Trainerize aggregates each client's connected wearable (Garmin/Apple/Fitbit):
// daily calories burned ({restingEnergy, activeEnergy}) and steps. Stored on
// the day log as `wearable: {active, resting, steps, source}` — display-only
// for now (it does NOT change the calorie target; that's a later product call).
const HEALTH_DAYS_MAX = 90; // wearables write one doc per day — cap the backfill
async function syncClientHealth(db, uid, pid, tzUserId, auth, days) {
  const span = Math.min(days, HEALTH_DAYS_MAX);
  const startDate = new Date(Date.now() - span * 86400000).toISOString().slice(0, 10);
  const endDate = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const byDate = {};
  for (const type of ["calorieOut", "step"]) {
    const r = await tz("healthData/getList", { userID: tzUserId, type, startDate, endDate }, auth);
    if (!r.ok) continue;
    for (const e of (r.json && r.json.healthData) || []) {
      if (!e || !/^\d{4}-\d{2}-\d{2}$/.test(e.date || "")) continue;
      const w = (byDate[e.date] = byDate[e.date] || {});
      if (type === "calorieOut" && e.data) {
        w.active = r0(e.data.activeEnergy);
        w.resting = r0(e.data.restingEnergy);
      } else if (type === "step" && e.data) {
        w.steps = r0(e.data.steps);
      }
      if (e.source) w.source = e.source;
    }
  }
  let written = 0;
  for (const [date, w] of Object.entries(byDate)) {
    if (!w.active && !w.steps) continue; // nothing meaningful that day
    const logKey = `caliq-log-${pid}-${date}`;
    const log = (await kvGetJSON(db, uid, logKey)) || { calories: 0, water: 0, weight: 0, meals: [] };
    log.wearable = w;
    await kvSetJSON(db, uid, logKey, log);
    written++;
  }
  return written;
}

// ── v2: completed workouts → Glide check-ins ────────────────────────────────
// calendar/getList (one call per client, {userID, startDate, endDate}) returns
// dated items with status "scheduled" | "tracked". Types seen live (S89):
// workoutInterval / workoutRegular / workoutVideo ({workoutID, rpe} + the
// workout name in title) and cardio ({exerciseID, time seconds, distance}).
// Every TRACKED workout/cardio day gets its Glide check-in marked
// workedOut:true with the workout names in notes — MERGED into any existing
// same-date check-in (never wholesale-replaced, the S86 lesson), so weights /
// body fat / moods survive. Notes stay idempotent across re-syncs: the
// "Trainerize: …" segment is replaced, hand-written notes are kept.
const WORKOUT_DAYS_MAX = 90; // cap the backfill like HEALTH_DAYS_MAX
const WORKOUT_TYPES = new Set(["workoutInterval", "workoutRegular", "workoutVideo", "cardio"]);

// One tracked calendar item → a short display name ("Total Body 1", "Running 33m").
function workoutItemName(it) {
  let name = String(it.title || "Workout").trim().slice(0, 60);
  if (it.type === "cardio" && it.detail && Number(it.detail.time) > 0) {
    name += ` ${Math.max(1, Math.round(Number(it.detail.time) / 60))}m`;
  }
  return name;
}

// Replace the Trainerize-owned segment of a check-in's notes, keep the rest.
function mergeTzNote(existingNotes, tzNote) {
  const kept = String(existingNotes || "").split(" · ")
    .filter((s) => s && !s.startsWith("Trainerize: ")).join(" · ");
  return kept ? `${kept} · ${tzNote}` : tzNote;
}

async function syncClientWorkouts(db, uid, pid, tzUserId, auth, days) {
  const span = Math.min(days, WORKOUT_DAYS_MAX);
  const startDate = new Date(Date.now() - span * 86400000).toISOString().slice(0, 10);
  const endDate = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const r = await tz("calendar/getList",
    { userID: tzUserId, startDate, endDate, unitDistance: "miles", unitWeight: "lbs" }, auth);
  if (!r.ok) return 0;
  // date → tracked workout names (cardio + strength/video/interval sessions)
  const byDate = {};
  for (const day of (r.json && r.json.calendar) || []) {
    if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day.date || "")) continue;
    for (const it of Array.isArray(day.items) ? day.items : []) {
      if (!it || it.status !== "tracked" || !WORKOUT_TYPES.has(it.type)) continue;
      (byDate[day.date] = byDate[day.date] || []).push(workoutItemName(it));
    }
  }
  const dates = Object.keys(byDate);
  if (!dates.length) return 0;

  // Merge into the plan's check-ins in ONE wrapper read+write per client.
  const wrapKey = `caliq-${pid}`;
  const wrap = (await kvGetJSON(db, uid, wrapKey)) || { data: {}, step: 0 };
  const d = wrap.data || (wrap.data = {});
  const cis = Array.isArray(d.checkIns) ? d.checkIns : (d.checkIns = []);
  let marked = 0;
  for (const date of dates) {
    const names = byDate[date];
    const label = names.slice(0, 3).join(" + ") + (names.length > 3 ? ` +${names.length - 3} more` : "");
    const tzNote = `Trainerize: ${label}`.slice(0, 200);
    let ci = cis.find((c) => c && c.date === date);
    if (!ci) {
      ci = { date, timestamp: new Date(`${date}T12:00:00`).getTime(),
        weight: null, calories: null, hitTarget: null, workedOut: false,
        mood: null, notes: "", bodyFat: null, loggedBy: "trainer", isFuturePlan: false };
      cis.push(ci);
    }
    const nextNotes = mergeTzNote(ci.notes, tzNote);
    if (ci.workedOut === true && ci.notes === nextNotes) continue; // already in sync
    ci.workedOut = true; // only ever set true — absence of items ≠ a missed day
    ci.notes = nextNotes;
    marked++;
  }
  if (!marked) return 0;
  cis.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
  await kvSetJSON(db, uid, wrapKey, wrap);
  return marked;
}

// Sync one client's recent Trainerize nutrition into the profile's day logs.
// Additive like the app's own meal logging: totals adjust by the DELTA of
// replaced tz-imported meals, so Glide-logged food on the same day survives.
async function syncClientNutrition(db, uid, pid, tzUserId, auth, days = NUTRITION_DAYS) {
  const startDate = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const endDate = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const list = await tz("dailyNutrition/getList",
    { userID: tzUserId, startDate: `${startDate} 00:00:00`, endDate: `${endDate} 23:59:59` }, auth);
  if (!list.ok) return 0;
  const entries = (list.json && list.json.nutrition) || [];
  let written = 0;
  for (const entry of entries) {
    if (!entry || !/^\d{4}-\d{2}-\d{2}$/.test(entry.date || "")) continue;
    // Full meal detail only exists for Trainerize-native entries — one extra
    // call each; MFP/Fitbit summaries already carry everything they'll give us.
    let detail = null;
    if (entry.source === "trainerize") {
      const r = await tz("dailyNutrition/get", { id: entry.id, userID: tzUserId }, auth);
      if (r.ok && r.json) detail = r.json.nutrition || null;
    }
    const newMeals = glideMealsFromEntry(entry, detail);
    const logKey = `caliq-log-${pid}-${entry.date}`;
    const log = (await kvGetJSON(db, uid, logKey)) || { calories: 0, water: 0, weight: 0, meals: [] };
    if (!Array.isArray(log.meals)) log.meals = [];
    const isTz = (m) => typeof (m && m.id) === "string" && m.id.startsWith("tz");
    const oldTz = log.meals.filter(isTz);
    const sum = (arr, k) => arr.reduce((s, m) => s + (Number(m[k]) || 0), 0);
    log.meals = [...log.meals.filter((m) => !isTz(m)), ...newMeals];
    for (const k of ["calories", "protein", "carbs", "fat"]) {
      log[k] = Math.max(0, (Number(log[k]) || 0) - sum(oldTz, k) + sum(newMeals, k));
    }
    await kvSetJSON(db, uid, logKey, log);
    written++;
  }
  return written;
}

// The importer: pulls the trainer's Trainerize roster + a per-client snapshot
// (profile, last body stat, goals) and writes each client as a LOCAL PROFILE in
// the CALLER's Glide account (Option A — see docs/TRAINERIZE-API.md). Deduped
// by trainerizeId (deterministic profile id "ctz{trainerizeId}"), so re-running
// UPDATES instead of duplicating. v1 = roster + snapshot; history is v2.
//
// Request data:
//   { mode: "list" }        → roster preview only, NO writes: each client's
//                             name/email/status + whether they're already in
//                             Glide (drives the pick-your-clients UI).
//   { clientIds: [id, …] }  → import ONLY those Trainerize ids.
//   {}                      → import the whole roster (original behavior).
// Fetch the full Trainerize roster (paged). Throws HttpsError on failure.
async function fetchRoster(auth) {
  const roster = [];
  let start = 0, total = Infinity;
  while (roster.length < total && start < 1000) {
    const r = await tz("user/getClientList", { start, count: 100 }, auth);
    if (!r.ok) {
      throw new HttpsError("internal", `Trainerize getClientList returned ${r.status}.`, { body: r.json });
    }
    const users = (r.json && r.json.users) || [];
    total = Number(r.json && r.json.total) || users.length;
    roster.push(...users.filter((u) => u && u.type === "client"));
    if (!users.length) break;
    start += users.length;
  }
  return roster;
}

// The shared sync engine: snapshot + nutrition for a set of Trainerize ids,
// written into `uid`'s local profiles. Used by BOTH the manual import button
// (clientIds from the picker, full 365-day nutrition) and the scheduled
// auto-sync (already-imported ids only, short nutrition window).
async function runImport(db, uid, auth, { clientIds = null, nutritionDays = NUTRITION_DAYS } = {}) {
  let roster = await fetchRoster(auth);
  const wanted = Array.isArray(clientIds) ? new Set(clientIds.map(Number).filter(Boolean)) : null;
  if (wanted) roster = roster.filter((u) => wanted.has(Number(u.id)));
  if (!roster.length) return { ok: true, total: 0, created: 0, updated: 0, mealDaysTotal: 0, clients: [] };

    // 2. Batch profile fetch (one call for the whole roster).
    const profById = {};
    const pr = await tz("user/getProfile", { usersid: roster.map((u) => u.id), unitBodystats: "inches" }, auth);
    if (pr.ok) for (const p of (pr.json && pr.json.usrProfile) || []) profById[p.id] = p;

    // 3. Per client: last body stat + goals (sequential — ~2 calls/client, far
    //    under the 1000/min throttle), then map + write into the caller's kv.
    const index = (await kvGetJSON(db, uid, "caliq-index")) || [];
    const folders = (await kvGetJSON(db, uid, "caliq-folders")) || [];
    let folder = folders.find((f) => f && f.name === "Trainerize");
    if (!folder) {
      folder = { id: `f${Date.now()}`, name: "Trainerize", order: folders.length };
      await kvSetJSON(db, uid, "caliq-folders", [...folders, folder]);
    }

    let created = 0, updated = 0;
    const results = [];
    for (const u of roster) {
      const [bs, gl] = [
        await tz("bodystats/get", { userID: u.id, date: "last", unitBodystats: "inches", unitWeight: "lbs" }, auth),
        await tz("goal/getList", { userID: u.id, unitWeight: "lbs", start: 0, count: 10 }, auth),
      ];
      const snap = mapSnapshot(profById[u.id] || u, bs.ok ? bs.json : null, gl.ok && gl.json ? gl.json.goals : []);
      const lastStatDate = snap._lastStatDate; delete snap._lastStatDate;

      // Dedupe: an index entry already tagged with this trainerizeId, else the
      // deterministic id (covers a wiped index re-import via Recover).
      const pid = (index.find((p) => p && p.trainerizeId === u.id) || {}).id || `ctz${u.id}`;
      const existing = index.find((p) => p && p.id === pid);

      const wrap = (await kvGetJSON(db, uid, `caliq-${pid}`)) || { data: {}, step: 0 };
      const d = { ...(wrap.data || {}), ...snap, trainerizeId: u.id };
      // Seed/refresh one check-in from the last Trainerize weigh-in so the
      // progress chart + "last activity" have a starting point. MERGED into any
      // existing same-date entry (one-weigh-in-per-date, but a workedOut flag
      // or notes the workout sync wrote there must survive a re-import).
      if (snap.weightLbs && lastStatDate) {
        const cis = Array.isArray(d.checkIns) ? d.checkIns : [];
        let ci = cis.find((c) => c && c.date === lastStatDate);
        if (!ci) {
          ci = { date: lastStatDate, timestamp: new Date(`${lastStatDate}T12:00:00`).getTime(),
            weight: null, calories: null, hitTarget: null, workedOut: null,
            mood: null, notes: "Imported from Trainerize", bodyFat: null,
            loggedBy: "trainer", isFuturePlan: false };
          cis.push(ci);
        }
        ci.weight = Number(snap.weightLbs);
        if (snap.bodyFat) ci.bodyFat = Number(snap.bodyFat);
        cis.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
        d.checkIns = cis;
        if (d.startWeightLbs == null || d.startWeightLbs === "") d.startWeightLbs = Number(snap.weightLbs);
      }
      // A complete snapshot can jump straight to the dashboard; never downgrade
      // a step Kevin already advanced.
      const complete = d.gender && d.age && d.heightFt && d.weightLbs && d.activityLevel;
      const step = Math.max(wrap.step || 0, complete ? 5 : 0);
      await kvSetJSON(db, uid, `caliq-${pid}`, { data: d, step });

      const name = [d.firstName, d.lastName].filter(Boolean).join(" ") || u.email || `Client ${u.id}`;
      const entry = {
        ...(existing || {}), id: pid, name, weight: d.weightLbs || "", goal: d.goalWeight || "",
        lastSaved: Date.now(), stepLabel: STEP_LABELS[step] || "Personal",
        folderId: existing ? existing.folderId : folder.id, isSimulation: false,
        trainerizeId: u.id, email: u.email || "",
      };
      if (existing) { Object.assign(existing, entry); updated++; }
      else { index.push(entry); created++; }
      // v2: pull the client's recent nutrition (Trainerize meals in full food
      // detail; MFP/Fitbit as day totals) into the profile's day logs.
      let mealDays = 0;
      try { mealDays = await syncClientNutrition(db, uid, pid, u.id, auth, nutritionDays); }
      catch (e) { console.error("nutrition sync failed for", u.id, e && e.message); }
      // v3: wearable burn + steps (Garmin/Apple/Fitbit via Trainerize).
      let healthDays = 0;
      try { healthDays = await syncClientHealth(db, uid, pid, u.id, auth, nutritionDays); }
      catch (e) { console.error("health sync failed for", u.id, e && e.message); }
      // v2: completed Trainerize workouts → workedOut check-ins (streaks,
      // calendar dots, coach views). Runs AFTER the wrapper write above so its
      // own read-modify-write of caliq-{pid} sees the fresh snapshot.
      let workoutDays = 0;
      try { workoutDays = await syncClientWorkouts(db, uid, pid, u.id, auth, nutritionDays); }
      catch (e) { console.error("workout sync failed for", u.id, e && e.message); }
      results.push({ name, weight: entry.weight, goal: entry.goal, status: u.status || "", mealDays, healthDays, workoutDays });
    }
    await kvSetJSON(db, uid, "caliq-index", index);
    const mealDaysTotal = results.reduce((s, r) => s + (r.mealDays || 0), 0);
    const healthDaysTotal = results.reduce((s, r) => s + (r.healthDays || 0), 0);
    const workoutDaysTotal = results.reduce((s, r) => s + (r.workoutDays || 0), 0);
    return { ok: true, total: roster.length, created, updated, mealDaysTotal, healthDaysTotal, workoutDaysTotal, clients: results };
}

exports.trainerizeImport = onCall(
  { secrets: [TRAINERIZE_GROUP_ID, TRAINERIZE_API_TOKEN], cors: true, timeoutSeconds: 300 },
  async (request) => {
    const uid = request.auth && request.auth.uid;
    await requireAdmin(uid);
    const auth = Buffer.from(`${TRAINERIZE_GROUP_ID.value()}:${TRAINERIZE_API_TOKEN.value()}`).toString("base64");
    const db = admin.firestore();

    // Preview mode: roster + already-imported flags, NO writes (the picker).
    if (request.data && request.data.mode === "list") {
      const roster = await fetchRoster(auth);
      const index = (await kvGetJSON(db, uid, "caliq-index")) || [];
      const importedIds = new Set(index.filter((p) => p && p.trainerizeId).map((p) => p.trainerizeId));
      return {
        ok: true,
        clients: roster.map((u) => ({
          id: u.id,
          name: [u.firstName, u.lastName].filter(Boolean).join(" ") || u.email || `Client ${u.id}`,
          email: u.email || "",
          status: u.status || "",
          imported: importedIds.has(u.id),
        })),
      };
    }

    const clientIds = Array.isArray(request.data && request.data.clientIds) ? request.data.clientIds : null;
    return await runImport(db, uid, auth, { clientIds, nutritionDays: NUTRITION_DAYS });
  }
);

// Scheduled auto-sync — the "near real time" bridge. Trainerize has NO webhooks
// (nothing pushes events to us), so we POLL: every 30 minutes, re-sync every
// client Kevin has ALREADY imported (new Trainerize clients still wait for him
// to pick them in the importer — respects the selective-import choice). Each
// run refreshes weight/body stats/goals + the last 14 days of nutrition, so a
// meal or weigh-in that lands in Trainerize shows up in Glide within ~30 min.
// Cost: ~3-4 API calls/client/run — a rounding error against the 1000/min cap.
exports.trainerizeAutoSync = onSchedule(
  { schedule: "every 30 minutes", secrets: [TRAINERIZE_GROUP_ID, TRAINERIZE_API_TOKEN],
    timeoutSeconds: 300, region: "us-central1" },
  async () => {
    const uid = ADMIN_UIDS[0]; // single-tenant v1: Kevin's account owns the token
    const db = admin.firestore();
    // Kill switch: the trainer-home toggle writes caliq-tz-autosync {enabled}.
    // Missing/anything-but-false = ON (default). Off = skip the whole run.
    const pref = await kvGetJSON(db, uid, "caliq-tz-autosync");
    if (pref && pref.enabled === false) { console.log("trainerizeAutoSync: disabled by toggle — skipped"); return; }
    const index = (await kvGetJSON(db, uid, "caliq-index")) || [];
    const ids = index.filter((p) => p && p.trainerizeId).map((p) => p.trainerizeId);
    if (!ids.length) { console.log("trainerizeAutoSync: no imported Trainerize clients in the index — nothing to sync (run the import to restore)"); return; }
    const auth = Buffer.from(`${TRAINERIZE_GROUP_ID.value()}:${TRAINERIZE_API_TOKEN.value()}`).toString("base64");
    try {
      const r = await runImport(db, uid, auth, { clientIds: ids, nutritionDays: 14 });
      console.log("trainerizeAutoSync", JSON.stringify({ synced: r.total, updated: r.updated, mealDays: r.mealDaysTotal, workoutDays: r.workoutDaysTotal }));
    } catch (e) {
      console.error("trainerizeAutoSync failed:", e && e.message);
    }
  }
);

// Connection test: authenticate + fetch the client list. Returns a small summary
// (count + a 3-client sample) so we can confirm auth works and see the real shape
// before building the full field-by-field importer.
exports.trainerizeTest = onCall(
  { secrets: [TRAINERIZE_GROUP_ID, TRAINERIZE_API_TOKEN], cors: true },
  async (request) => {
    await requireAdmin(request.auth && request.auth.uid);
    const auth = Buffer.from(`${TRAINERIZE_GROUP_ID.value()}:${TRAINERIZE_API_TOKEN.value()}`).toString("base64");

    const r = await tz("user/getClientList", { start: 0, count: 100 }, auth);
    if (!r.ok) {
      throw new HttpsError("internal", `Trainerize returned ${r.status}. Check the Group ID / API token.`,
        { status: r.status, body: r.json });
    }
    // The exact list key varies by account/version — surface whatever came back.
    const list = (r.json && (r.json.clients || r.json.users || r.json.list || r.json.data)) || null;
    return {
      ok: true,
      status: r.status,
      count: Array.isArray(list) ? list.length : null,
      sample: Array.isArray(list) ? list.slice(0, 3) : r.json,
    };
  }
);
