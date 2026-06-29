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
const { CARDIO, STRENGTH, CARDIO_IDS, STRENGTH_IDS } = require("./exercises");

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

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
// Full plan wrapper ({data, step}) for read-modify-write of plan fields.
async function loadPlanWrap(db, uid) {
  const id = await activePlanId(db, uid);
  const wrap = (await kvGetJSON(db, uid, `caliq-${id}`)) || { data: {}, step: 0 };
  if (!wrap.data) wrap.data = {};
  return { id, wrap };
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
    activityLevel: d.activityLevel || null,
    bodyFatPct: num(d.bodyFat),
    goalBodyFatPct: num(d.goalBodyFat),
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
    {
      name: "get_profile",
      description:
        "Get the plan's personal profile (name, gender, age, height, current & goal weight, activity level, body-fat) "
        + "and which required fields are still MISSING for a calorie target. Use this before onboarding someone to see "
        + "what to ask for. " + (isTrainer ? TRAINER_NOTE : CLIENT_NOTE),
      input_schema: { type: "object", properties: { ...clientIdProp } },
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
          bodyFatPct: { type: "number", description: "Current body-fat %, optional" },
          goalBodyFatPct: { type: "number", description: "Goal body-fat %, optional" },
          ...clientIdProp,
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
          ...clientIdProp,
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
          ...clientIdProp,
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
          ...clientIdProp,
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
          ...clientIdProp,
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
          ...clientIdProp,
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
      name: "set_workout_schedule",
      description:
        "Write a weekly workout PROGRAM into the plan (shows on the plan + calendar). Build it from list_exercises ids. "
        + "Lay the program out for the user and get their OK before calling. "
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
          ...clientIdProp,
        },
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
          .where("k", ">=", prefix).where("k", "<=", prefix + "").orderBy("k", "desc").limit(1).get();
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

  if (name === "get_profile") {
    const { data } = await activePlanData(db, uid);
    return profileSummary(data);
  }

  if (name === "set_personal_info") {
    const { id: planId, wrap } = await loadPlanWrap(db, uid);
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
    if (input.activityLevel && ACTIVITY_MULT[input.activityLevel]) { d.activityLevel = input.activityLevel; changes.push(`activity ${input.activityLevel}`); }
    if (input.bodyFatPct != null) { const b = clampNum(input.bodyFatPct, 2, 70, true); if (b) { d.bodyFat = b; changes.push("body fat"); } }
    if (input.goalBodyFatPct != null) { const b = clampNum(input.goalBodyFatPct, 2, 70, true); if (b) { d.goalBodyFat = b; changes.push("goal body fat"); } }
    if (changes.length === 0) return { error: "No valid profile fields were provided." };
    await kvSetJSON(db, uid, `caliq-${planId}`, wrap);
    await appendHistory(db, uid, planId, ctx, `updated profile: ${changes.join(", ")}`);
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
    };
    if (ctx.isTrainer && input.clientId) {
      const t = await resolveTargetUid(db, { clientId: input.clientId }, ctx);
      if (t && t.error) return t; // unauthorized client → tell the model
      meal.clientId = input.clientId;
    }
    return { shown: true, meal };
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
    };
    const { id: planId } = await activePlanData(db, uid);
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
    const { id: planId, wrap } = await loadPlanWrap(db, uid);
    const d = wrap.data;
    if (!Array.isArray(d.checkIns)) d.checkIns = [];
    const ci = d.checkIns.find((c) => c.date === date);
    if (ci) { ci.workedOut = true; if (note) ci.notes = note; }
    else d.checkIns.push({ date, timestamp: checkInTimestamp(date), weight: null, calories: null,
      hitTarget: null, workedOut: true, mood: null, notes: note, bodyFat: null, loggedBy, isFuturePlan: false });
    await kvSetJSON(db, uid, `caliq-${planId}`, wrap);
    await appendHistory(db, uid, planId, ctx, note ? `recorded a workout: "${note}"` : "recorded a workout");
    return { ok: true, date, note: note || null };
  }

  if (name === "log_weigh_in") {
    const v = Math.round((Number(input.weightLbs) || 0) * 10) / 10;
    if (!v || v <= 0) return { error: "Provide a weight greater than 0." };
    const re = /^\d{4}-\d{2}-\d{2}$/;
    const date = re.test(input.date || "") ? input.date : ctx.today;
    const loggedBy = (ctx.isTrainer && uid !== ctx.callerUid) ? "trainer" : "client";
    const { id: planId, wrap } = await loadPlanWrap(db, uid);
    const d = wrap.data;
    if (!Array.isArray(d.checkIns)) d.checkIns = [];
    const prev = Number(d.weightLbs) || v;
    if (d.startWeightLbs == null || d.startWeightLbs === "") d.startWeightLbs = prev;
    d.weightLbs = v;
    d.checkIns = d.checkIns.filter((c) => c.date !== date);
    d.checkIns.push({ date, timestamp: checkInTimestamp(date), weight: v, calories: null, hitTarget: null,
      workedOut: null, mood: null, notes: "", bodyFat: null, loggedBy, isFuturePlan: false });
    await kvSetJSON(db, uid, `caliq-${planId}`, wrap);
    await appendHistory(db, uid, planId, ctx, `logged weight: ${v} lbs`);
    return { ok: true, date, weightLbs: v };
  }

  if (name === "set_targets") {
    const { id: planId, wrap } = await loadPlanWrap(db, uid);
    const d = wrap.data;
    const changes = [];
    if (input.proteinTarget != null || input.carbsTarget != null || input.fatTarget != null) {
      const base = nutritionTargets(d);
      const cur = d.macroTargets || {};
      const pick = (inv, curv, basev) => inv != null ? Math.max(0, Math.round(Number(inv)))
        : (curv != null ? curv : (basev != null ? basev : 0));
      const protein = pick(input.proteinTarget, cur.protein, base.proteinTarget);
      const carbs = pick(input.carbsTarget, cur.carbs, base.carbsTarget);
      const fat = pick(input.fatTarget, cur.fat, base.fatTarget);
      d.macroTargets = { protein, carbs, fat };
      changes.push(`macros to ${protein}g protein / ${carbs}g carbs / ${fat}g fat`);
    }
    if (input.goalWeightLbs != null) {
      const g = Math.round(Number(input.goalWeightLbs) * 10) / 10;
      if (g > 0) { d.goalWeight = g; changes.push(`goal weight to ${g} lbs`); }
    }
    if (changes.length === 0) return { error: "Provide at least one of protein/carbs/fat target or goal weight." };
    await kvSetJSON(db, uid, `caliq-${planId}`, wrap);
    await appendHistory(db, uid, planId, ctx, `updated ${changes.join(" and ")}`);
    return { ok: true, updated: { macroTargets: d.macroTargets || null, goalWeightLbs: d.goalWeight != null ? d.goalWeight : null } };
  }

  if (name === "set_workout_schedule") {
    const replace = input.replace !== false; // default true
    const { id: planId, wrap } = await loadPlanWrap(db, uid);
    const d = wrap.data;
    const dropped = [];
    const clampDur = (v, def) => Math.max(5, Math.min(120, Math.round(Number(v) || def)));
    const buildWeek = (provided, validSet, defDur, existing) => {
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
    };
    const changed = [];
    if (input.strength && typeof input.strength === "object") {
      d.strength = buildWeek(input.strength, STRENGTH_IDS, 45, d.strength); changed.push("strength");
    }
    if (input.cardio && typeof input.cardio === "object") {
      d.cardio = buildWeek(input.cardio, CARDIO_IDS, 30, d.cardio); changed.push("cardio");
    }
    if (changed.length === 0) return { error: "Provide cardio and/or strength as day-keyed objects." };
    await kvSetJSON(db, uid, `caliq-${planId}`, wrap);
    await appendHistory(db, uid, planId, ctx, "updated the workout program");
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
