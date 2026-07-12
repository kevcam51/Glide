// Glidna — scheduled AI automations / workflows (S92, Phase 1 backend).
//
// A user (Elite+/Apex) saves an automation: a saved prompt + a schedule. An
// hourly dispatcher runs each due one through the SAME AI + tools as the chat
// (headless, via aichat.runAssistantTurn), METERS the spend against the user's
// daily budget (every run is a COLD message ~10-25k tokens), and delivers the
// result to their notification feed.
//
// Storage: a top-level `workflows` collection, ADMIN-SDK-ONLY (no client rules =
// clients are denied direct access; they go through the callables below, and the
// dispatcher queries via the Admin SDK). Same pattern as webauthnCreds — so NO
// firestore.rules change is needed.
//
// Phase 2 (next): the "Automations" UI. Times are UTC in Phase 1 (the picker +
// timezone handling land with the UI).

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const admin = require("firebase-admin");
const { runAssistantTurn, ANTHROPIC_API_KEY, tierFor } = require("./aichat");
const { appendFeed } = require("./push");

// Workflows allowed per tier (Kevin S92): higher tiers only — each run is the
// priciest usage pattern (a cold message), so it's gated to Elite+/Apex.
// Keys are aichat.js tier names (clientMax=Elite, clientUltra=Apex, etc.).
const WORKFLOW_CAP = { clientMax: 1, clientUltra: 3, trainerMax: 2, trainerUltra: 5 };
function capFor(profile) {
  if (profile && profile.role === "admin") return 20; // Kevin can exercise the flow
  return WORKFLOW_CAP[tierFor(profile)] || 0;
}
const DISABLED_AT = 4102444800000; // year 2100 — parks disabled workflows out of the due query

// Next run as a UTC timestamp (Phase 1: hour is UTC; local-time picker is Phase 2).
function computeNextRun(schedule, fromMs) {
  const hour = Math.min(23, Math.max(0, Number(schedule && schedule.hour) || 8));
  const next = new Date(fromMs);
  next.setUTCMinutes(0, 0, 0);
  next.setUTCHours(hour);
  if (schedule && schedule.type === "weekly") {
    const dow = Math.min(6, Math.max(0, Number(schedule.weekday) || 0));
    next.setUTCDate(next.getUTCDate() + ((dow - next.getUTCDay() + 7) % 7));
    if (next.getTime() <= fromMs) next.setUTCDate(next.getUTCDate() + 7);
  } else if (next.getTime() <= fromMs) {
    next.setUTCDate(next.getUTCDate() + 1);
  }
  return next.getTime();
}
function normalizeSchedule(s) {
  return {
    type: s && s.type === "weekly" ? "weekly" : "daily",
    hour: Math.min(23, Math.max(0, Number(s && s.hour) || 8)),
    weekday: Math.min(6, Math.max(0, Number(s && s.weekday) || 0)),
  };
}

// ── Create / update an automation (tier-gated) ──────────────────────────────
exports.saveWorkflow = onCall({ region: "us-central1", maxInstances: 10 }, async (request) => {
  const uid = request.auth && request.auth.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in first.");
  const db = admin.firestore();
  const profile = (await db.doc(`users/${uid}`).get()).data() || {};
  const cap = capFor(profile);
  if (cap <= 0) throw new HttpsError("failed-precondition", "Automations are available on Elite and Apex plans.");

  const d = request.data || {};
  const name = String(d.name || "Automation").slice(0, 60).trim() || "Automation";
  const prompt = String(d.prompt || "").slice(0, 1000).trim();
  if (!prompt) throw new HttpsError("invalid-argument", "Tell the automation what to do.");
  const schedule = normalizeSchedule(d.schedule);
  const enabled = d.enabled !== false;
  const now = Date.now();
  const nextRunAt = enabled ? computeNextRun(schedule, now) : DISABLED_AT;
  const col = db.collection("workflows");

  if (d.id) {
    const ref = col.doc(String(d.id));
    const cur = await ref.get();
    if (!cur.exists || cur.data().uid !== uid) throw new HttpsError("permission-denied", "Not your automation.");
    await ref.set({ name, prompt, schedule, enabled, nextRunAt, updatedAt: now }, { merge: true });
    return { id: ref.id, nextRunAt };
  }
  const cnt = (await col.where("uid", "==", uid).get()).size;
  if (cnt >= cap) throw new HttpsError("failed-precondition", `You've reached your automation limit (${cap}). Upgrade for more.`);
  const ref = await col.add({ uid, name, prompt, schedule, enabled, nextRunAt,
    delivery: "feed", lastRunAt: null, lastResult: "", lastStatus: "", createdAt: now, updatedAt: now });
  return { id: ref.id, nextRunAt };
});

// ── List the caller's automations ───────────────────────────────────────────
exports.listWorkflows = onCall({ region: "us-central1", maxInstances: 10 }, async (request) => {
  const uid = request.auth && request.auth.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in first.");
  const db = admin.firestore();
  const profile = (await db.doc(`users/${uid}`).get()).data() || {};
  const snap = await db.collection("workflows").where("uid", "==", uid).get();
  const items = snap.docs.map((doc) => {
    const w = doc.data();
    return { id: doc.id, name: w.name, prompt: w.prompt, schedule: w.schedule, enabled: w.enabled,
      lastRunAt: w.lastRunAt || null, lastResult: w.lastResult || "", lastStatus: w.lastStatus || "", nextRunAt: w.nextRunAt };
  }).sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  return { workflows: items, cap: capFor(profile) };
});

// ── Toggle enable/disable ───────────────────────────────────────────────────
exports.toggleWorkflow = onCall({ region: "us-central1", maxInstances: 10 }, async (request) => {
  const uid = request.auth && request.auth.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in first.");
  const db = admin.firestore();
  const ref = db.collection("workflows").doc(String((request.data && request.data.id) || ""));
  const cur = await ref.get();
  if (!cur.exists || cur.data().uid !== uid) throw new HttpsError("permission-denied", "Not your automation.");
  const enabled = !!(request.data && request.data.enabled);
  const nextRunAt = enabled ? computeNextRun(cur.data().schedule, Date.now()) : DISABLED_AT;
  await ref.set({ enabled, nextRunAt, updatedAt: Date.now() }, { merge: true });
  return { enabled, nextRunAt };
});

// ── Delete ──────────────────────────────────────────────────────────────────
exports.deleteWorkflow = onCall({ region: "us-central1", maxInstances: 10 }, async (request) => {
  const uid = request.auth && request.auth.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in first.");
  const db = admin.firestore();
  const ref = db.collection("workflows").doc(String((request.data && request.data.id) || ""));
  const cur = await ref.get();
  if (!cur.exists || cur.data().uid !== uid) throw new HttpsError("permission-denied", "Not your automation.");
  await ref.delete();
  return { deleted: true };
});

// ── Hourly dispatcher: run every due automation ─────────────────────────────
exports.runDueWorkflows = onSchedule(
  { schedule: "every 60 minutes", secrets: [ANTHROPIC_API_KEY], timeoutSeconds: 540, region: "us-central1" },
  async () => {
    const db = admin.firestore();
    const now = Date.now();
    // Single-field inequality → automatic index, no composite needed. Disabled
    // ones are parked at DISABLED_AT so they don't match; cap the batch so one
    // cycle stays inside the timeout (the rest catch up next hour).
    const due = await db.collection("workflows").where("nextRunAt", "<=", now)
      .orderBy("nextRunAt").limit(25).get();
    let ran = 0, skipped = 0;
    for (const doc of due.docs) {
      const w = doc.data();
      if (!w.enabled) { await doc.ref.set({ nextRunAt: DISABLED_AT }, { merge: true }).catch(() => {}); continue; }
      const next = computeNextRun(w.schedule, now);
      const prompt = `[Scheduled automation: "${w.name}"] ${w.prompt}\n\nThis runs automatically on a schedule (the user isn't here right now). Use their real data via your tools, then write ONE concise, friendly summary they'll read in their notifications. No greeting, no "let me know" — just the useful result.`;
      let res;
      try { res = await runAssistantTurn(w.uid, prompt); } catch (e) { res = { skipped: "error" }; }
      if (res && res.reply) {
        ran++;
        await doc.ref.set({ lastRunAt: now, lastResult: String(res.reply).slice(0, 4000), lastStatus: "ok", nextRunAt: next }, { merge: true }).catch(() => {});
        await appendFeed(db, w.uid, { tag: "workflow", title: `Automation: ${w.name}`.slice(0, 80),
          body: String(res.reply).replace(/\s+/g, " ").slice(0, 140) }).catch(() => {});
      } else {
        // budget / trial-expired / error — reschedule, note why, don't spam the feed.
        skipped++;
        await doc.ref.set({ lastRunAt: now, lastStatus: (res && res.skipped) || "error", nextRunAt: next }, { merge: true }).catch(() => {});
      }
    }
    console.log("runDueWorkflows", JSON.stringify({ due: due.size, ran, skipped }));
  }
);
