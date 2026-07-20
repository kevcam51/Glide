// Training sessions / appointments (S100, docs/SESSIONS-BILLING-PLAN.md).
//
// One doc per booked session at sessions/{sid}. The TRAINER books; either side
// may cancel. Access control lives entirely in firestore.rules (participants
// only; create requires a real trainer↔client link) — these helpers just
// read/write the shapes the rules expect, exactly like src/messaging.js.
//
// ⚠️ Billing fields (settled / settledAt / chargeId / completedAt) are written
// ONLY by the server (the future settle dispatcher, Admin SDK). Nothing in this
// file may write them — the rules reject it, and that's deliberate: those
// fields decide whether real money moves.
//
// Queries use where('participants','array-contains', uid) — a single-field
// index, so no composite index is needed. Ordering/filtering by time happens
// in JS on the returned set (a person's session list is small). If that ever
// grows past a few thousand, add a composite index and paginate.
import { db } from "./firebase";
import {
  doc, collection, addDoc, updateDoc, getDocs, query, where, onSnapshot,
} from "firebase/firestore";

export const SESSION_DEFAULT_MIN = 60;

// Sort helper — soonest first. Exported so the UI never re-implements it.
export const bySoonest = (a, b) => (a.startAt || 0) - (b.startAt || 0);

// A session is "past" once its END time has gone by (a session in progress is
// still upcoming — it hasn't happened yet as far as the client is concerned).
export const sessionEndMs = (s) => (s.startAt || 0) + (s.durationMin || SESSION_DEFAULT_MIN) * 60000;
export const isPastSession = (s, now = Date.now()) => sessionEndMs(s) <= now;

// Book a session. Only a trainer can call this successfully — the rules check
// that request.auth.uid === trainerUid AND that the client is really theirs.
export async function bookSession(trainerUid, clientUid, {
  startAt, durationMin = SESSION_DEFAULT_MIN, title = "", location = "", priceCents = 0,
}) {
  const now = Date.now();
  const ref = await addDoc(collection(db, "sessions"), {
    participants: [trainerUid, clientUid],
    trainerUid, clientUid,
    startAt: Number(startAt),
    durationMin: Number(durationMin) || SESSION_DEFAULT_MIN,
    status: "scheduled",
    title: String(title || "").slice(0, 80),
    location: String(location || "").slice(0, 120),
    priceCents: Math.max(0, Math.round(Number(priceCents) || 0)),
    createdBy: trainerUid, createdAt: now, updatedAt: now,
  });
  return ref.id;
}

// Reschedule / retitle / re-price — trainer only (rules enforce it).
export function updateSession(sessionId, fields) {
  const patch = { updatedAt: Date.now() };
  for (const k of ["startAt", "durationMin", "title", "location", "priceCents"]) {
    if (fields[k] !== undefined) patch[k] = fields[k];
  }
  return updateDoc(doc(db, "sessions", sessionId), patch);
}

// Cancel — either side. The rules let a client write ONLY these fields, so the
// same call works for both roles.
export function cancelSession(sessionId, byUid, reason = "") {
  return updateDoc(doc(db, "sessions", sessionId), {
    status: "cancelled",
    cancelledBy: byUid,
    cancelledAt: Date.now(),
    cancelReason: String(reason || "").slice(0, 200),
    updatedAt: Date.now(),
  });
}

// One-shot read of every session I'm part of (trainer or client), soonest first.
export async function listMySessions(uid) {
  const snap = await getDocs(query(collection(db, "sessions"), where("participants", "array-contains", uid)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort(bySoonest);
}

// Live version — the calendar and the client's home both stay current when the
// other side books or cancels (same onSnapshot approach as the plan/log sync).
export function subscribeMySessions(uid, cb) {
  return onSnapshot(
    query(collection(db, "sessions"), where("participants", "array-contains", uid)),
    (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort(bySoonest)),
    () => cb([]), // denied/offline → empty rather than throwing into the UI
  );
}

// Group sessions by local YYYY-MM-DD so the calendar can look up a day in O(1).
// Key must be LOCAL (ymdLocal semantics) — never UTC (S45).
export function sessionsByDay(sessions) {
  const out = {};
  for (const s of sessions || []) {
    if (!s.startAt) continue;
    const d = new Date(s.startAt);
    const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    (out[k] = out[k] || []).push(s);
  }
  Object.values(out).forEach((arr) => arr.sort(bySoonest));
  return out;
}

// ─── Cancellation policy + prepaid packs (S100b, Kevin's rules) ─────────────
// The trainer sets their OWN cancellation window and pack prices — Glide never
// presets them (the trainer-set-pricing principle from the plan doc). Both live
// on the TRAINER's profile doc, which every signed-in user can already read via
// the trainer-directory rule, so a client can always see the policy they're
// agreeing to BEFORE they buy. Credits themselves are server-only.

// Offered as starting points in the UI; a trainer can pick one or write their own.
export const CANCEL_WINDOW_PRESETS = [6, 12, 24, 48, 72];

// How cancellations are treated. "never" is a real business choice (Kevin:
// "someone can also have no cancellations if they want") — it is NOT the same
// as a 0-hour window, which is the most LENIENT setting. The two live at
// opposite ends, so they get distinct types rather than a magic number.
export const CANCEL_TYPES = {
  anytime: "Free cancellation any time",
  window: "Free cancellation up to a set time before",
  never: "No free cancellations — every client cancellation is charged",
};

// When money is actually taken. Kevin wants variety, chosen by the trainer:
//  • per_session — charge as each session passes the red line. Most immediate,
//    but every session is its own Stripe transaction (see stripeFeeNote).
//  • weekly — one batched charge on Sunday for the week's sessions. Fewer
//    transactions, so less fixed-fee drag; good for trainers who want flexible
//    scheduling without packages piling up.
//  • manual — Glide tracks what's owed; the trainer bills however they like.
// Prepaid packs are orthogonal: credits are always consumed FIRST under every
// mode, and only uncovered sessions ever reach a card.
export const BILLING_MODES = {
  per_session: "Charge as each session happens",
  weekly: "Charge once a week (Sunday)",
  manual: "Track only — I'll invoice myself",
};

export const DEFAULT_SESSION_POLICY = {
  cancelType: "window",      // anytime | window | never
  cancelWindowHours: 24,     // cancel earlier than this = free (window type only)
  lateCancelChargePct: 100,  // % of the session price charged for a late CLIENT cancel
  noShowChargePct: 100,      // % charged when the client simply doesn't show
  billingMode: "weekly",     // per_session | weekly | manual
  policyNote: "",            // trainer's own wording, shown to clients verbatim
};

// Starter packs (Kevin's sizes). Every trainer can enable, rename, re-price or
// delete these, and add their own — they are suggestions, never a fixed menu.
export const STARTER_PACKS = [4, 6, 8, 12, 24, 48].map((n) => ({
  id: `pack${n}`, name: `${n} sessions`, sessions: n, priceCents: 0, active: false,
}));

// Read a trainer's policy with defaults filled in. Never throws — a missing or
// partial policy falls back to the defaults rather than leaving the UI blank.
export function policyOf(trainerProfile) {
  const p = (trainerProfile && trainerProfile.sessionPolicy) || {};
  const hrs = Number(p.cancelWindowHours);
  return {
    cancelType: CANCEL_TYPES[p.cancelType] ? p.cancelType : DEFAULT_SESSION_POLICY.cancelType,
    cancelWindowHours: Number.isFinite(hrs) && hrs >= 0 && hrs <= 336 ? hrs : DEFAULT_SESSION_POLICY.cancelWindowHours,
    lateCancelChargePct: clampPct(p.lateCancelChargePct, DEFAULT_SESSION_POLICY.lateCancelChargePct),
    noShowChargePct: clampPct(p.noShowChargePct, DEFAULT_SESSION_POLICY.noShowChargePct),
    billingMode: BILLING_MODES[p.billingMode] ? p.billingMode : DEFAULT_SESSION_POLICY.billingMode,
    policyNote: String(p.policyNote || "").slice(0, 400),
  };
}
const clampPct = (v, dflt) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n <= 100 ? Math.round(n) : dflt;
};

export function packsOf(trainerProfile) {
  const list = (trainerProfile && trainerProfile.sessionPacks) || [];
  return (Array.isArray(list) ? list : []).filter((p) => p && p.active && Number(p.sessions) > 0);
}

// Is cancelling THIS session right now inside the chargeable window?
// Deliberately pure + shared: the UI warns with it before you confirm, and the
// billing sweep will judge with the identical function, so what the client was
// warned about and what they're charged for can never drift apart.
export function isLateCancel(session, policy, atMs = Date.now()) {
  if (!session || !session.startAt) return false;
  const p = policy || DEFAULT_SESSION_POLICY;
  if (p.cancelType === "anytime") return false;  // never chargeable
  if (p.cancelType === "never") return true;     // always chargeable
  return session.startAt - atMs < (p.cancelWindowHours || 0) * 3600000;
}

// What a late cancel would actually COST — the number the client must see
// before they confirm. A trainer-initiated cancel is ALWAYS free (Kevin's
// rule: "the trainer has the option to cancel or reschedule ... and if they do
// so then they will not be charged"), so this only ever applies to the client.
export function lateCancelFeeCents(session, policy, byUid, atMs = Date.now()) {
  if (!session || byUid !== session.clientUid) return 0;      // trainer cancel → free
  if (!isLateCancel(session, policy, atMs)) return 0;          // in time → free
  const pct = policy ? policy.lateCancelChargePct : DEFAULT_SESSION_POLICY.lateCancelChargePct;
  return Math.round((Number(session.priceCents) || 0) * pct / 100);
}

// Human phrase for the notice period, e.g. "2 days before" / "6 hours before".
function noticePhrase(hrs) {
  if (hrs % 24 === 0 && hrs >= 24) return `${hrs / 24} ${hrs === 24 ? "day" : "days"} before`;
  return `${hrs} ${hrs === 1 ? "hour" : "hours"} before`;
}

// One-line human policy. Every wording branch is generated from the SAME policy
// object the billing code reads, so the sentence a client is shown is always a
// faithful description of what will actually happen.
export function describePolicy(policy) {
  const p = policy || DEFAULT_SESSION_POLICY;
  if (p.cancelType === "anytime") return "Cancel any time at no charge.";
  if (p.cancelType === "never") {
    return p.lateCancelChargePct >= 100
      ? "All sessions are final — a cancelled session is charged in full."
      : `All sessions are final — a cancelled session is charged ${p.lateCancelChargePct}% of the session price.`;
  }
  const when = noticePhrase(p.cancelWindowHours);
  return p.lateCancelChargePct > 0
    ? `Free cancellation up to ${when}. Cancelling later is charged ${p.lateCancelChargePct}% of the session.`
    : `Free cancellation up to ${when}.`;
}

// ─── The standard disclosure that appears on EVERY invoice / checkout ───────
// Kevin: "there should be a default message about the cancellation window and
// the fee ... all invoices will have it, the only difference between them is
// the window and the fee." So the STRUCTURE is fixed platform-wide and only the
// trainer's numbers vary — a client sees the same familiar terms everywhere in
// Glide, and a trainer cannot accidentally ship a checkout with no policy on it.
export function cancellationDisclosure(policy, trainerName = "your trainer") {
  const p = policyOf({ sessionPolicy: policy || {} });
  const lines = [describePolicy(p)];
  if (p.cancelType !== "anytime" && p.noShowChargePct > 0) {
    lines.push(`Not showing up for a booked session is charged ${p.noShowChargePct}% of the session price.`);
  }
  lines.push(`Sessions cancelled or rescheduled by ${trainerName} are never charged.`);
  if (p.billingMode === "per_session") {
    lines.push("Sessions not covered by prepaid credit are charged to the card on file as each session takes place.");
  } else if (p.billingMode === "weekly") {
    lines.push("Sessions not covered by prepaid credit are totalled and charged to the card on file once a week.");
  }
  if (p.policyNote) lines.push(p.policyNote);
  return lines;
}

// The exact sentence next to the agreement checkbox. Kept separate from the
// bullet list so the affirmative act of consent is its own explicit statement.
export function consentLineFor(policy, trainerName = "your trainer") {
  const p = policyOf({ sessionPolicy: policy || {} });
  const core = p.cancelType === "anytime"
    ? "I understand I can cancel any session at no charge"
    : p.cancelType === "never"
      ? "I understand cancelled sessions are not refunded"
      : `I understand I must give ${noticePhrase(p.cancelWindowHours).replace(" before", "")} notice to cancel free of charge`;
  return `${core}, and I authorize ${trainerName} to charge my saved card for sessions and any cancellation fees described above.`;
}

// A frozen copy of the terms AT PURCHASE TIME. Stored with the purchase so a
// later policy edit can never retroactively change what someone agreed to —
// and so there is a record of the exact wording shown, which is what makes an
// electronic agreement worth anything in a dispute.
// NOTE ON EVIDENCE: the research is explicit that acceptance needs a timestamp,
// IP and the exact text version. IP and user-agent are deliberately NOT captured
// here — anything the browser reports about itself is self-asserted and worth
// little in a dispute. They must be stamped by the Cloud Function that records
// the agreement (request.ip), which is where the checkout consent will be written.
export function policySnapshot(policy, trainerName, extra = {}) {
  const p = policyOf({ sessionPolicy: policy || {} });
  return {
    agreedAt: Date.now(),
    policyVersion: POLICY_TEXT_VERSION,
    policy: p,
    shownText: cancellationDisclosure(p, trainerName),
    consentLine: consentLineFor(p, trainerName),
    ...extra,
  };
}
// ─── Dispute evidence (S100c — from the chargeback research) ───────────────
// A late-cancellation fee is the single most disputable charge this system can
// make, and the research was blunt about two things:
//  (1) the merchant does NOT choose the reason code — the issuer picks it from
//      the client's story — so the record has to answer "no service received",
//      "I cancelled", AND "I never authorized this" at the same time; and
//  (2) Visa's Compelling Evidence 3.0 does NOT apply to consumer-dispute (13.x)
//      codes, so there is no safe harbour to fall back on. The defence is
//      entirely upstream: versioned terms, timestamped acceptance, and showing
//      the lateness arithmetic so the issuer has to do no work.
// This renders that arithmetic explicitly rather than leaving "it was late" as
// an assertion. Pure + derived from stored facts, so it can't drift.
export function cancellationEvidence(session, policy) {
  if (!session || !session.startAt || !session.cancelledAt) return null;
  const p = policyOf({ sessionPolicy: policy || {} });
  const noticeMs = session.startAt - session.cancelledAt;
  const noticeHrs = Math.round((noticeMs / 3600000) * 10) / 10;
  const late = isLateCancel(session, p, session.cancelledAt);
  const byClient = session.cancelledBy === session.clientUid;
  const fmt = (ms) => new Date(ms).toISOString();
  return {
    sessionStart: fmt(session.startAt),
    cancelledAt: fmt(session.cancelledAt),
    cancelledBy: byClient ? "client" : "trainer",
    noticeGivenHours: noticeHrs,
    requiredNoticeHours: p.cancelType === "window" ? p.cancelWindowHours : null,
    policyType: p.cancelType,
    late,
    chargeable: late && byClient,
    feeCents: lateCancelFeeCents(session, p, session.cancelledBy, session.cancelledAt),
    // The one-liner to paste into a representment.
    summary: !byClient
      ? `Cancelled by the trainer — not charged.`
      : p.cancelType === "anytime"
        ? `Cancelled ${noticeHrs}h before the session; policy allows free cancellation at any time — not charged.`
        : p.cancelType === "never"
          ? `Cancelled ${noticeHrs}h before the session; policy is no-free-cancellation, disclosed and accepted at purchase.`
          : late
            ? `Session started ${fmt(session.startAt)}. Policy required ${p.cancelWindowHours}h notice. Client cancelled ${fmt(session.cancelledAt)} — ${noticeHrs}h notice, i.e. ${Math.round((p.cancelWindowHours - noticeHrs) * 10) / 10}h inside the window. Fee charged per the terms accepted at purchase.`
            : `Client cancelled ${noticeHrs}h before the session, meeting the ${p.cancelWindowHours}h requirement — not charged.`,
  };
}

// Bump when the WORDING above changes, so snapshots stay interpretable.
export const POLICY_TEXT_VERSION = 1;

// ─── Stripe fee awareness (Kevin: trainers "must be aware of the Stripe fees
// adding up on them like this and need to price accordingly") ───────────────
// Standard US Stripe pricing. The fixed per-transaction slice is what makes
// charging every single session cost more than batching them.
export const STRIPE_PCT = 0.029, STRIPE_FIXED_CENTS = 30;
export const stripeFeeCents = (cents) => Math.round(cents * STRIPE_PCT) + STRIPE_FIXED_CENTS;

// Compare the two automatic modes for a trainer's real numbers.
export function feeComparison(sessionPriceCents, sessionsPerWeek) {
  const price = Math.max(0, Number(sessionPriceCents) || 0);
  const n = Math.max(0, Number(sessionsPerWeek) || 0);
  if (!price || !n) return null;
  const perSession = n * stripeFeeCents(price);          // one charge per session
  const weekly = stripeFeeCents(price * n);              // one charge for the week
  return {
    perSessionWeekly: perSession, weeklyBatched: weekly,
    savingPerWeek: perSession - weekly,
    savingPerYear: (perSession - weekly) * 52,
    netPerSessionMode: price * n - perSession,
    netWeeklyMode: price * n - weekly,
  };
}

// Save a trainer's policy / packs onto their own profile doc.
export function saveSessionPolicy(trainerUid, policy) {
  return updateDoc(doc(db, "users", trainerUid), { sessionPolicy: policy });
}
export function saveSessionPacks(trainerUid, packs) {
  return updateDoc(doc(db, "users", trainerUid), { sessionPacks: packs });
}
