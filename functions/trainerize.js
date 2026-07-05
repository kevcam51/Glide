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
// This first function just TESTS the connection (lists clients) so we confirm auth
// before building the full importer. Trainer/admin only. Read-only.

const { onCall, HttpsError } = require("firebase-functions/v2/https");
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

// The importer: pulls the trainer's Trainerize roster + a per-client snapshot
// (profile, last body stat, goals) and writes each client as a LOCAL PROFILE in
// the CALLER's Glide account (Option A — see docs/TRAINERIZE-API.md). Deduped
// by trainerizeId (deterministic profile id "ctz{trainerizeId}"), so re-running
// UPDATES instead of duplicating. v1 = roster + snapshot; history is v2.
exports.trainerizeImport = onCall(
  { secrets: [TRAINERIZE_GROUP_ID, TRAINERIZE_API_TOKEN], cors: true, timeoutSeconds: 300 },
  async (request) => {
    const uid = request.auth && request.auth.uid;
    await requireAdmin(uid);
    const auth = Buffer.from(`${TRAINERIZE_GROUP_ID.value()}:${TRAINERIZE_API_TOKEN.value()}`).toString("base64");
    const db = admin.firestore();

    // 1. Full roster (paged; Kevin's group is small but don't assume).
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
    if (!roster.length) return { ok: true, total: 0, created: 0, updated: 0, clients: [] };

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
      // progress chart + "last activity" have a starting point (replace-by-date,
      // matching the app's one-weigh-in-per-date rule).
      if (snap.weightLbs && lastStatDate) {
        const cis = Array.isArray(d.checkIns) ? d.checkIns.filter((c) => c && c.date !== lastStatDate) : [];
        cis.push({
          date: lastStatDate, timestamp: new Date(`${lastStatDate}T12:00:00`).getTime(),
          weight: Number(snap.weightLbs), calories: null, hitTarget: null, workedOut: null,
          mood: null, notes: "Imported from Trainerize", bodyFat: snap.bodyFat ? Number(snap.bodyFat) : null,
          loggedBy: "trainer", isFuturePlan: false,
        });
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
      results.push({ name, weight: entry.weight, goal: entry.goal, status: u.status || "" });
    }
    await kvSetJSON(db, uid, "caliq-index", index);
    return { ok: true, total: roster.length, created, updated, clients: results };
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
