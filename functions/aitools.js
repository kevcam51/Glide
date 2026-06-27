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

// ── plan resolution (mirrors the multi-plan manifest; default plan id "self"). ─
async function activePlanId(db, uid) {
  const m = await kvGetJSON(db, uid, "caliq-plans");
  return (m && m.active) || "self";
}
async function activePlanData(db, uid) {
  const id = await activePlanId(db, uid);
  const wrap = await kvGetJSON(db, uid, `caliq-${id}`);
  return { id, data: (wrap && wrap.data) || {} };
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
function nutritionTargets(d) {
  const w = Number(d.weightLbs);
  let cal = null;
  if (w && d.gender) {
    const bmr = calcBMR(d.gender, w, d.heightFt, d.heightIn, Number(d.age));
    if (bmr && isFinite(bmr)) {
      const tdee = Math.round(bmr * (ACTIVITY_MULT[d.activityLevel] || 1.2));
      cal = Math.max(1200, Math.round(tdee - 500));
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

function buildTools(role) {
  const isTrainer = role === "head_trainer" || role === "sub_trainer" || role === "admin";
  const clientIdProp = isTrainer
    ? { clientId: { type: "string", description: "The client's id from list_clients. " + TRAINER_NOTE } }
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
          ...clientIdProp,
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
        properties: { ...clientIdProp },
      },
    },
  ];

  if (isTrainer) {
    tools.push({
      name: "list_clients",
      description:
        "List your connected clients. Returns each client's id, name, last log date, and days since they last logged. Use the returned id with the other tools.",
      input_schema: { type: "object", properties: {} },
    });
  }
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

  if (name === "list_clients") {
    if (!ctx.isTrainer) return { error: "Only trainers can list clients." };
    const snap = await db.collection("users")
      .where("assignedTrainerId", "==", ctx.callerUid).get();
    const out = [];
    for (const doc of snap.docs) {
      const p = doc.data();
      const id = await activePlanId(db, doc.id);
      // latest logged date for the client's active plan
      const prefix = `caliq-log-${id}-`;
      let last = null;
      try {
        const logs = await db.collection(`users/${doc.id}/kv`)
          .where("k", ">=", prefix).where("k", "<=", prefix + "").get();
        logs.forEach((l) => { const k = l.data().k || ""; const dt = k.slice(-10); if (!last || dt > last) last = dt; });
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

  // Data tools — resolve & authorize the target user first.
  const uid = await resolveTargetUid(db, input, ctx);
  if (uid && uid.error) return uid; // { error }

  if (name === "get_nutrition_targets") {
    const { data } = await activePlanData(db, uid);
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

  if (name === "get_nutrition_log") {
    const range = clampDateRange(input.startDate, input.endDate);
    if (!range) return { error: "Dates must be YYYY-MM-DD." };
    const { id, data } = await activePlanData(db, uid);
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
