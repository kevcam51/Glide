// Glidna — session reminders (S187).
//
// "Your session with Casey starts in 30 minutes." Both sides can choose their
// own lead times, and as many as they like — 2 hours AND 30 minutes AND 10
// minutes if that's what keeps them on time. Prefs live in the same
// caliq-notif-prefs doc the Notification Center already owns:
//
//   sessionReminders      — the on/off switch (defaults ON, like every type)
//   sessionReminderLeads  — minutes before the start, e.g. [120, 30, 10]
//
// ── The two rules that make this behave like a calendar app ─────────────────
//
// 1. NEVER REMIND EARLY, AND NEVER REMIND TWICE. A lead fires on the first
//    sweep at or after its trigger moment, and the fact that it fired is
//    recorded ON THE SESSION with arrayUnion — atomic, so two overlapping runs
//    can't both send it. The marker is per person AND per lead
//    ("<uid>:<minutes>"), because the trainer and the client have separate
//    preferences about the same session.
//
// 2. A LATE ADDITION MUST NOT ARRIVE AS A BURST. Book a session 5 minutes
//    before it starts with leads [120, 30, 10] and the naive rule — "fire every
//    lead whose moment has passed" — sends three notifications at once, all of
//    them lies. So a lead only fires inside a window after its trigger; past
//    that it is marked sent WITHOUT sending, because a reminder that arrives
//    after the moment it was meant to warn you about is just noise.

const { onSchedule } = require("firebase-functions/v2/scheduler");
const admin = require("firebase-admin");
const { sendPushTo, VAPID_PRIVATE_KEY } = require("./push");

const REGION = "us-central1";
// How far ahead we look. Also the largest lead anyone may choose (24h).
const MAX_LEAD_MIN = 1440;
// A lead that became due more than this long ago is stale — mark it, skip it.
// Comfortably wider than the sweep interval so an occasional slow run still
// delivers rather than silently swallowing the reminder.
const FIRE_WINDOW_MS = 12 * 60000;
const SWEEP_CAP = 400;

// The lead times we accept. Anything else is dropped rather than trusted — this
// list is also what the UI offers, so a value outside it means a hand-edited
// pref doc, not a user choice.
const ALLOWED_LEADS = [5, 10, 15, 30, 60, 120, 240, 1440];
const DEFAULT_LEADS = [60];

function leadsOf(prefs) {
  if (!prefs || prefs.master === false || prefs.sessionReminders === false) return [];
  const raw = prefs.sessionReminderLeads;
  if (!Array.isArray(raw)) return DEFAULT_LEADS;
  const clean = [...new Set(raw.map(Number).filter((n) => ALLOWED_LEADS.includes(n)))];
  // An explicit empty list means "none" — that is a real choice, not a fallback.
  return clean.sort((a, b) => b - a);
}

async function notifPrefsOf(db, uid) {
  try {
    const d = (await db.doc(`users/${uid}/kv/caliq-notif-prefs`).get()).data();
    const p = d && d.value ? JSON.parse(d.value) : {};
    return p && typeof p === "object" ? p : {};
  } catch { return {}; }
}

const nameOf = (u) => (u && (u.displayName || [u.firstName, u.lastName].filter(Boolean).join(" "))) || "";

// "in 30 minutes" / "in 2 hours" / "tomorrow" — how a person says it.
function leadPhrase(min) {
  if (min >= 1440) return `in ${Math.round(min / 1440)} day${min >= 2880 ? "s" : ""}`;
  if (min >= 120) return `in ${Math.round(min / 60)} hours`;
  if (min === 60) return "in an hour";
  return `in ${min} minutes`;
}
function clockET(ms) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", hour: "numeric", minute: "2-digit", hour12: true,
  }).format(new Date(ms));
}

async function runSessionReminders(now = Date.now()) {
  const db = admin.firestore();
  // Upcoming only. A single-field range on startAt — no composite index — and
  // status is filtered in code because a cancelled session is rare enough that
  // an index for it would cost more than it saves.
  const snap = await db.collection("sessions")
    .where("startAt", ">", now)
    .where("startAt", "<=", now + MAX_LEAD_MIN * 60000)
    .orderBy("startAt", "asc")
    .limit(SWEEP_CAP)
    .get();
  if (snap.empty) return { sessions: 0, sent: 0, marked: 0 };

  const profiles = new Map();  // uid -> {profile, prefs, leads}
  const load = async (uid) => {
    if (profiles.has(uid)) return profiles.get(uid);
    const [doc, prefs] = await Promise.all([
      db.doc(`users/${uid}`).get().catch(() => null),
      notifPrefsOf(db, uid),
    ]);
    const entry = { profile: (doc && doc.exists ? doc.data() : {}) || {}, prefs, leads: leadsOf(prefs) };
    profiles.set(uid, entry);
    return entry;
  };

  let sent = 0, marked = 0, considered = 0;
  for (const d of snap.docs) {
    const s = d.data();
    if (s.status === "cancelled") continue;
    considered++;
    const already = Array.isArray(s.remindersSent) ? s.remindersSent : [];
    const startAt = Number(s.startAt) || 0;

    for (const uid of [s.trainerUid, s.clientUid]) {
      if (!uid) continue;
      const me = await load(uid);
      if (!me.leads.length) continue;
      // Who the reminder is ABOUT: the trainer hears the client's name and vice
      // versa. Telling someone their session is with themselves is the kind of
      // detail that makes an app feel unfinished.
      const otherUid = uid === s.trainerUid ? s.clientUid : s.trainerUid;
      const other = await load(otherUid);
      const otherName = nameOf(other.profile) || (uid === s.trainerUid ? "your client" : "your trainer");

      for (const lead of me.leads) {
        const key = `${uid}:${lead}`;
        if (already.includes(key)) continue;
        const trigger = startAt - lead * 60000;
        if (now < trigger) continue;                 // not yet
        const stale = now >= trigger + FIRE_WINDOW_MS;
        // Claim it first. If the write fails we simply try again next sweep —
        // far better than sending and failing to record it, which would repeat
        // the same reminder every two minutes.
        try {
          await d.ref.update({ remindersSent: admin.firestore.FieldValue.arrayUnion(key) });
        } catch (e) { continue; }
        marked++;
        if (stale) continue;                          // recorded, deliberately silent

        const title = s.title ? `${s.title} ${leadPhrase(lead)}` : `Training ${leadPhrase(lead)}`;
        await sendPushTo(db, uid, {
          title,
          body: `${clockET(startAt)} with ${otherName}${s.location ? ` · ${s.location}` : ""}`,
          tag: `session-reminder-${d.id}-${lead}`,
          url: "/",
        }, "sessionReminders").catch(() => {});
        sent++;
      }
    }
  }
  return { sessions: considered, sent, marked };
}

// Every two minutes. The shortest lead offered is 5 minutes, so the sweep has
// to be finer than that or a "5 minutes before" reminder would routinely land
// with 1 minute to go. At ~21k invocations a month this sits far inside the
// free tier, and each run reads only the sessions actually starting soon.
exports.sessionReminderPush = onSchedule(
  { schedule: "every 2 minutes", region: REGION, secrets: [VAPID_PRIVATE_KEY],
    timeoutSeconds: 300, maxInstances: 1 },
  async () => {
    const r = await runSessionReminders();
    if (r.sent || r.marked) console.log("sessionReminderPush", JSON.stringify(r));
  },
);

exports.runSessionReminders = runSessionReminders;
exports.ALLOWED_LEADS = ALLOWED_LEADS;
