// Glidna — session billing, phase 3 step 2: THE SETTLE DISPATCHER (S101c).
// docs/SESSIONS-BILLING-PLAN.md + docs/LEGAL-SESSIONS.md.
//
// Turns completed sessions and chargeable late-cancellations into money —
// under the rules Kevin set and the client agreed to:
//   • PACKAGE FIRST, always: prepaid credits are consumed before any card
//     charge, for late-cancels too (S92 rule). A client with sessions in the
//     bank is never charged extra.
//   • The trainer's billingMode decides WHEN: per_session = every sweep;
//     weekly = one batched charge Sunday evening ET; manual = never touched
//     (the trainer invoices themselves).
//   • A TRAINER-cancelled session is never billable, in any mode.
//   • The fee terms come from the client's LATEST CONSENT SNAPSHOT for that
//     trainer — what they actually agreed to — not the trainer's current
//     policy, so a policy edit can never retroactively re-price a booking.
//   • No card + no credits = the session simply stays unsettled. It is picked
//     up automatically once a card exists. Nothing is ever sent to collections
//     by code.
//   • DECLINE → sessionBillingHold on the client profile + both sides
//     notified (Kevin's flow: the client must cover the balance before
//     continuing; the trainer knows the payment didn't go through).
//
// TEST MODE (S101c): a client profile with sessionBillingTest === true is
// billed against STRIPE_TEST_SECRET_KEY instead of the live key. The flag is
// server-only in firestore.rules (client-writable would be free training).
// This is what lets the full charge cycle run with 4242-cards on test
// accounts while real clients ride the live key, side by side.
//
// IDEMPOTENCY: sessions are claimed (settled:"processing") in a transaction
// before any Stripe call; the PaymentIntent uses the ledger doc id as its
// idempotency key; an overlapping run cannot double-claim or double-charge.
//
// ⚠️ FAILURE-PATH RULES (S186, from the pre-go-live review). Test mode with
// 4242-cards never fails, so none of these paths had ever run. The invariants:
//
//  1. ONLY A CARD ERROR IS A DECLINE. `paymentIntents.create` is wrapped alone,
//     and only `e.type === "StripeCardError"` sets a hold and tells the client
//     their card was declined. A connection reset, a Stripe 5xx, a bad secret
//     or a Firestore blip means WE DON'T KNOW whether the money moved — that is
//     `needs_reconcile`, which never accuses the cardholder and never opens the
//     Pay-now path (which would charge again).
//  2. BOOKKEEPING FAILURE IS NEVER A DECLINE. Everything after the charge sits
//     in its own try. If Stripe took the money and Firestore then fails, the
//     ledger goes to `charged_needs_reconcile` — never `declined`.
//  3. NEVER CHARGE WITHOUT LOOKING FIRST. Both the sweep's retry and Pay-now
//     ask Stripe for an existing PaymentIntent carrying this ledgerId before
//     creating another one. A found succeeded/processing intent is treated as
//     paid, because it is.
//  4. CLAIM BEFORE CHARGING, ALWAYS. Pay-now claims the ledger in a transaction
//     with an attempt counter, and that counter (never Date.now()) is the
//     idempotency key — so a double tap either loses the race or replays the
//     same key and gets Stripe's cached answer.
//  5. A CLAIM MUST BE RECOVERABLE. `settled:"processing"` is invisible to every
//     candidate query, so a run that dies mid-flight would strand the money
//     forever. reclaimStranded() re-reads those against Stripe on every sweep.
//  6. DELIVERED BEATS CANCELLED. A session with `completedAt`, or one cancelled
//     after it started, is billed as delivered no matter what `status` says —
//     the rules pin `cancelledBy` now, but the server does not rely on that.

const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");
const { sendPushTo } = require("./push");

const STRIPE_SECRET_KEY = defineSecret("STRIPE_SECRET_KEY");
const STRIPE_TEST_SECRET_KEY = defineSecret("STRIPE_TEST_SECRET_KEY");
const VAPID_PRIVATE_KEY = defineSecret("VAPID_PRIVATE_KEY");
const REGION = "us-central1";
const ADMIN_UIDS = ["G7QUZ8Kat1fgyoMjdGKz4DYoVHi1"];
const { canBillSessions } = require("./sessionBillingGate");
// For the ON-session pay-now retry: Stripe requires a return_url on a confirmed
// intent that could need a redirect (e.g. a 3DS card check), so we pass the
// caller's validated origin. (The off_session sweep never redirects, so it needs
// none.) Mirrors sessionBilling.js.
const ALLOWED_ORIGINS = [
  "https://glidna.com", "https://www.glidna.com", "https://glidna.app",
  "http://localhost:5173",
];
const safeOrigin = (o) => (ALLOWED_ORIGINS.includes(o) ? o : ALLOWED_ORIGINS[0]);

// How far back the sweep looks for unsettled items. This was 30 days, which
// quietly WAS the bug: a client on a billing hold (or one who removed their
// card) keeps training, and everything delivered more than 30 days before they
// settle up fell out of the window and could never be billed by any later run —
// no error, no ledger row, nothing on any screen. A year is past every
// plausible stall, and the candidate scan is paged, so the window costs reads
// rather than correctness.
const LOOKBACK_MS = 365 * 86400000;
// Page size for the candidate scan. The old code used a hard .limit(200) with
// no cursor and filtered `settled` in JS AFTERWARDS, so settled and
// never-settleable docs ate the cap and real work was silently crowded out.
// Now we page until exhausted; this is just the batch size.
const PAGE_SIZE = 300;
// A claim older than this with no matching Stripe intent is presumed abandoned
// (instance killed mid-run) and is reconciled or released.
const CLAIM_STALE_MS = 15 * 60000;
// Unsettled work older than this is surfaced as arrears rather than left to rot.
const ARREARS_AFTER_MS = 21 * 86400000;

// ── error classification — the heart of the double-charge fix ────────────────
// Stripe throws for a refused card AND for "the network ate the response", and
// those two mean opposite things: one is the customer's card saying no, the
// other may well be money already captured. Only the first may ever be called a
// decline. Everything else is an UNKNOWN, and an unknown must never accuse the
// cardholder, never set a hold, and never unlock a retry button.
const isCardDecline = (e) => !!e && e.type === "StripeCardError";
const codeOf = (e) => String((e && (e.decline_code || e.code)) || "charge_failed").slice(0, 60);
// A 3DS challenge on an off-session charge. It IS a StripeCardError, but the
// card was not refused — the issuer wants the cardholder present. Telling them
// "declined" sends them to replace a perfectly good card, forever.
const needsAuthentication = (e) => !!e && (e.code === "authentication_required"
  || (e.raw && e.raw.code === "authentication_required"));

// Has this ledger already been charged at Stripe? Asked BEFORE any retry.
// `list` (not `search`) on purpose: the search index lags by up to a minute,
// which is exactly the window where a duplicate charge happens. list is
// immediately consistent.
// `customerIds` is every customer this ledger could have been charged against —
// the one stamped on the ledger at claim time PLUS any the profile has since
// been re-pointed away from. Scoping the search to the profile's CURRENT
// customer was itself a double-charge bug: if the id ever changes, the charge
// that exists on the old customer is invisible and the code concludes,
// confidently and wrongly, that no charge was ever made.
async function findIntentByLedger(stripe, customerIds, ledgerId) {
  const ids = [...new Set((Array.isArray(customerIds) ? customerIds : [customerIds]).filter(Boolean))];
  if (!ids.length || !ledgerId) return null;
  let sawFailure = false;
  for (const customer of ids) {
    try {
      const res = await stripe.paymentIntents.list({ customer, limit: 100 });
      const hit = (res.data || []).find((pi) => pi && pi.metadata && pi.metadata.ledgerId === ledgerId);
      if (hit) return hit;
    } catch (e) {
      console.error("findIntentByLedger failed", ledgerId, customer, e && e.message);
      sawFailure = true;
    }
  }
  // A definite "no" only if every lookup actually succeeded. Otherwise the
  // caller must treat it as UNKNOWN and refuse to charge.
  return sawFailure ? undefined : null;
}
// Every customer id a ledger could have been charged against.
const customerIdsFor = (ledger, client) => [
  ledger && ledger.customerId,
  client && client.stripeCustomerId,
  ...((client && client.stripeCustomerIdPrev) || []),
];

// ── policy math — mirrors src/sessions.js (keep in sync) ────────────────────
const DEFAULT_POLICY = { cancelType: "window", cancelWindowHours: 24, lateCancelChargePct: 100, noShowChargePct: 100, billingMode: "weekly" };
function policyOf(p) {
  p = p || {};
  const num = (v, dflt, lo, hi) => (Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Number(v))) : dflt);
  return {
    cancelType: ["anytime", "window", "never"].includes(p.cancelType) ? p.cancelType : DEFAULT_POLICY.cancelType,
    cancelWindowHours: num(p.cancelWindowHours, DEFAULT_POLICY.cancelWindowHours, 0, 336),
    lateCancelChargePct: num(p.lateCancelChargePct, DEFAULT_POLICY.lateCancelChargePct, 0, 100),
    noShowChargePct: num(p.noShowChargePct, DEFAULT_POLICY.noShowChargePct, 0, 100),
    billingMode: ["per_session", "weekly", "biweekly", "manual"].includes(p.billingMode) ? p.billingMode : DEFAULT_POLICY.billingMode,
  };
}
// firestore.rules accepts cancelledAt within ±5 min of server time, to tolerate
// honest device-clock skew without locking anyone out of cancelling. The forward
// half of that tolerance shortens the apparent notice period, so a phone running
// four minutes fast could turn a genuinely in-time cancellation into a
// full-price late fee. We credit the same 5 minutes back here: skew is absorbed
// in the client's favour, and the most it can ever cost the trainer is five
// minutes of a window measured in hours. (S186)
const SKEW_GRACE_MS = 300000;
function isLateCancel(session, policy) {
  if (!session.startAt || !session.cancelledAt) return false;
  if (policy.cancelType === "anytime") return false;
  if (policy.cancelType === "never") return true;
  const notice = session.startAt - session.cancelledAt + SKEW_GRACE_MS;
  return notice < policy.cancelWindowHours * 3600000;
}
// The amount a delivered session bills at. `billableCents` is stamped SERVER-side
// when the session completes, freezing the price at the moment the obligation was
// created — so a later edit to priceCents (a typo, or a trainer re-pricing after
// the fact) can't change what an already-delivered session costs. Falls back to
// priceCents for sessions completed before that stamp existed.
function baseCents(session) {
  const frozen = session.billableCents;
  const v = Number(frozen != null ? frozen : session.priceCents) || 0;
  return Math.max(0, v);
}
function lateFeeCents(session, policy) {
  if (session.cancelledBy !== session.clientUid) return 0; // trainer cancel = free, always
  if (!isLateCancel(session, policy)) return 0;
  return Math.round(baseCents(session) * policy.lateCancelChargePct / 100);
}
// A no-show is a session nobody cancelled and nobody attended. Until S186 it was
// indistinguishable from a delivered session and therefore billed at 100% — while
// the client had been shown, and had agreed to, "not showing up is charged N%".
// The trainer marks it (`noShow: true`), and it prices from the CONSENTED policy,
// so the number charged is the number that was disclosed.
function noShowFeeCents(session, policy) {
  if (!policy) return baseCents(session);
  return Math.round(baseCents(session) * policy.noShowChargePct / 100);
}

// What is this session, for money purposes? DELIVERED BEATS CANCELLED, always.
// A `completedAt` stamp is written only by the server when the end time passed,
// so it is the one trustworthy statement that training happened; `status` is
// owned by the two participants. A cancellation stamped after the session
// started is likewise not a cancellation — it's a delivered session someone
// tried to walk back. (firestore.rules now blocks both, but this file must not
// depend on a rule being right.)
function classifyForBilling(v) {
  if (v.waived === true) return "waived";
  // ⚠️ THE TRAINER-CANCEL GUARD COMES FIRST, before "delivered beats cancelled".
  // Without it, a trainer who cancels at or after the start time (an emergency
  // ten minutes in) produced a doc that fell into the delivered branch below and
  // billed the CLIENT the full session price — the exact opposite of this file's
  // stated invariant and of terms.html §6, which promises a trainer cancellation
  // is never charged. An absent cancelledBy also lands here and is treated as
  // not-billable, because when we can't tell who cancelled, the client wins.
  if (v.status === "cancelled" && v.cancelledBy !== v.clientUid) return null;
  if (v.completedAt) return "session";
  if (v.status === "cancelled" && Number(v.cancelledAt) >= Number(v.startAt)) return "session";
  if (v.status === "cancelled") return "cancel";
  return null; // not finished yet
}
// The representment one-liner, stored on the ledger at charge time (research:
// spell out the arithmetic so an issuer has to do no work).
function evidenceSummary(session, policy) {
  const iso = (ms) => new Date(ms).toISOString();
  const hrs = Math.round(((session.startAt - session.cancelledAt) / 3600000) * 10) / 10;
  if (policy.cancelType === "never") {
    return `Cancelled ${hrs}h before the session; policy is no-free-cancellation, disclosed and accepted at card setup.`;
  }
  return `Session started ${iso(session.startAt)}. Policy required ${policy.cancelWindowHours}h notice. `
    + `Client cancelled ${iso(session.cancelledAt)} — ${hrs}h notice, i.e. `
    + `${Math.round((policy.cancelWindowHours - hrs) * 10) / 10}h inside the window. Fee per the terms accepted at card setup.`;
}

// Sunday evening in the trainer's market timezone (single-tenant: ET).
function isWeeklySettleWindow(now = new Date()) {
  const et = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "numeric", hour12: false })
    .formatToParts(now).reduce((o, p) => (o[p.type] = p.value, o), {});
  return et.weekday === "Sun" && Number(et.hour) >= 18;
}
// Every OTHER Sunday, for trainers who bill fortnightly.
//
// The cadence is derived from the calendar, not from "when did we last run" —
// a stored last-run marker would drift, and a missed run would silently shift
// every future charge date for that trainer. Sundays alternate by their week
// number since the epoch, so the answer is the same no matter when it's asked,
// how many times it's asked, or whether last fortnight's run happened at all.
function isBiweeklySettleWindow(now = new Date()) {
  if (!isWeeklySettleWindow(now)) return false;
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(now).reduce((o, x) => (o[x.type] = x.value, o), {});
  // Days since epoch for THAT ET calendar day (built in UTC so no tz shifts it).
  const days = Math.floor(Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day)) / 86400000);
  return Math.floor(days / 7) % 2 === 0;
}
// Is this the run that settles the given mode?
function settleWindowFor(mode, now, force) {
  if (force) return true;
  if (mode === "per_session") return true;
  if (mode === "weekly") return isWeeklySettleWindow(now);
  if (mode === "biweekly") return isBiweeklySettleWindow(now);
  return false; // manual — never automatic
}

// Every consent this client has given this trainer, oldest first.
async function consentHistory(db, clientUid, trainerUid) {
  const snap = await db.collection(`users/${clientUid}/sessionConsents`)
    .where("trainerUid", "==", trainerUid).get();
  const all = [];
  snap.forEach((d) => all.push(d.data()));
  return all.sort((a, b) => (a.agreedAt || 0) - (b.agreedAt || 0));
}
// The consent that was IN FORCE when the obligation arose — not simply the
// newest one. Taking the newest meant a routine card re-save after a policy
// edit retroactively re-priced an already-cancelled session: the client is
// shown 25% at the moment they cancel, updates an expiring card that week, and
// is charged 100% on Sunday. Terms §6 promises the opposite, so the promise is
// what the code now does.
function consentInForce(history, atMs) {
  const t = Number(atMs) || 0;
  let best = null;
  for (const c of history) {
    if ((c.agreedAt || 0) <= t && (!best || (c.agreedAt || 0) > (best.agreedAt || 0))) best = c;
  }
  return best;
}
// When did the obligation arise? That's the moment the client did the thing
// being billed for — cancelling, or being delivered a session.
const obligationAt = (s) => Number(
  s.kind === "cancel" ? s.cancelledAt : (s.completedAt || s.startAt)) || 0;

// Page through every session matching a date range, with a cursor. Unbounded by
// design: the alternative — truncating — is what silently stopped billing.
async function scanAll(db, field, sinceMs) {
  const out = [];
  let cursor = null;
  for (let page = 0; page < 40; page++) { // 12k docs of headroom, then we shout
    let q = db.collection("sessions").where(field, ">", sinceMs).orderBy(field, "asc").limit(PAGE_SIZE);
    if (cursor) q = q.startAfter(cursor);
    const snap = await q.get();
    if (snap.empty) return out;
    snap.forEach((d) => out.push({ id: d.id, ...d.data() }));
    if (snap.size < PAGE_SIZE) return out;
    cursor = snap.docs[snap.docs.length - 1];
  }
  console.error(`scanAll(${field}) hit the page ceiling — candidates are being dropped`);
  return out;
}

// ── the reaper ──────────────────────────────────────────────────────────────
// A session is claimed `settled:"processing"` before the Stripe call, so that an
// overlapping run can't double-charge it. The cost of that safety is that a run
// which dies between the claim and the bookkeeping strands the session outside
// every future query — permanently, and possibly with the money already taken.
// This asks Stripe what actually happened and then either finishes the job or
// hands the session back.
async function reclaimStranded(db, now) {
  const snap = await db.collection("sessions").where("settled", "==", "processing").limit(200).get();
  const stale = [];
  snap.forEach((d) => {
    const v = d.data();
    if (!v.settledAt || now - Number(v.settledAt) > CLAIM_STALE_MS) stale.push({ id: d.id, ...v });
  });
  if (!stale.length) return { checked: 0, finalized: 0, released: 0 };

  const byLedger = new Map();
  for (const s of stale) {
    const k = s.ledgerId || `none_${s.id}`;
    (byLedger.get(k) || byLedger.set(k, []).get(k)).push(s);
  }

  let finalized = 0, released = 0;
  for (const [ledgerId, items] of byLedger) {
    const release = async (why) => {
      await Promise.all(items.map((s) => db.doc(`sessions/${s.id}`)
        .update({ settled: null, settledAt: null, ledgerId: null }).catch(() => {})));
      released += items.length;
      console.warn(`reclaimStranded: released ${items.length} session(s) (${why})`, ledgerId);
    };
    if (ledgerId.startsWith("none_")) { await release("no ledger"); continue; }

    const ledgerRef = db.doc(`sessionCharges/${ledgerId}`);
    const ledger = (await ledgerRef.get()).data();
    if (!ledger) { await release("ledger vanished"); continue; }
    if (ledger.status === "succeeded") {
      await Promise.all(items.map((s) => db.doc(`sessions/${s.id}`)
        .update({ settled: "charged", chargeId: ledger.chargeId || null }).catch(() => {})));
      finalized += items.length;
      continue;
    }

    // The ledger doesn't say it succeeded — but that is exactly the state a
    // crash leaves behind, so ask Stripe rather than believing our own record.
    const client = (await db.doc(`users/${ledger.clientUid}`).get()).data() || {};
    let intent;
    try {
      // The LEDGER's mode, not the profile's — toggling sessionBillingTest
      // between the charge and the reconcile would otherwise send us looking in
      // the wrong Stripe account entirely and find nothing.
      const stripe = require("stripe")(ledger.testMode === true
        ? STRIPE_TEST_SECRET_KEY.value() : STRIPE_SECRET_KEY.value());
      intent = await findIntentByLedger(stripe, customerIdsFor(ledger, client), ledgerId);
    } catch (e) { intent = undefined; }

    if (intent === undefined) { console.error("reclaimStranded: could not reach Stripe, leaving claim", ledgerId); continue; }
    if (intent && intent.status === "processing") {
      // Money is MOVING, not moved. Record the intent so a later run reconciles
      // against it instead of charging again, but leave the sessions claimed —
      // marking them "charged" here would book revenue that can still fail.
      await ledgerRef.update({ status: "processing", chargeId: intent.id, chargedAt: Date.now(), reconciled: true }).catch(() => {});
      console.warn("reclaimStranded: intent still processing, leaving claim", ledgerId, intent.id);
    } else if (intent && intent.status === "succeeded") {
      // The money moved. Finish the bookkeeping the dead run owed.
      await ledgerRef.update({
        status: "succeeded", chargeId: intent.id, chargedAt: Date.now(), reconciled: true,
      }).catch(() => {});
      await Promise.all(items.map((s) => db.doc(`sessions/${s.id}`)
        .update({ settled: "charged", chargeId: intent.id }).catch(() => {})));
      finalized += items.length;
      console.warn(`reclaimStranded: finalized ${items.length} session(s) from Stripe`, ledgerId, intent.id);
    } else {
      await ledgerRef.update({ status: "released", releasedAt: Date.now() }).catch(() => {});
      await release("no charge at Stripe");
    }
  }
  return { checked: stale.length, finalized, released };
}

// ── the engine ──────────────────────────────────────────────────────────────
async function runSettle({ dryRun = false, force = false } = {}) {
  const db = admin.firestore();
  const now = Date.now();
  const nowDate = new Date(now);

  // FIRST: rescue anything a previous run claimed and then died holding. A
  // `settled:"processing"` session is invisible to the candidate scan below, so
  // without this it would never be billed again — with the card possibly
  // already charged.
  const reclaimed = dryRun ? { checked: 0, finalized: 0, released: 0, skipped: "dry-run" }
    : await reclaimStranded(db, now).catch((e) => {
      console.error("reclaimStranded failed", e && e.message);
      return { checked: 0, finalized: 0, released: 0 };
    });

  // Candidates: completed-and-unsettled + cancelled-and-unsettled. Both are
  // single-field range queries; `settled` can't be queried for "missing", so
  // it's filtered in code — which is exactly why the scan must be PAGED rather
  // than capped. A hard .limit() returns the OLDEST matches (an inequality
  // query sorts by that field), so settled and never-settleable documents used
  // to consume the entire cap and real work was silently dropped.
  const [done, canc] = await Promise.all([
    scanAll(db, "completedAt", now - LOOKBACK_MS),
    scanAll(db, "cancelledAt", now - LOOKBACK_MS),
  ]);
  const candidates = new Map();
  const arrears = [];
  for (const d of [...done, ...canc]) {
    if (candidates.has(d.id) || d.settled) continue;
    const kind = classifyForBilling(d);
    if (!kind) continue;
    if (kind === "waived") { if (!dryRun) await db.doc(`sessions/${d.id}`).update({ settled: "waived", settledAt: now }).catch(() => {}); continue; }
    candidates.set(d.id, { ...d, kind });
    if (now - obligationAt({ ...d, kind }) > ARREARS_AFTER_MS) arrears.push(d.id);
  }
  // Aged, still-unbilled work is a fact the trainer needs to see, not a silence.
  if (arrears.length) console.warn(`sessionsSettle: ARREARS — ${arrears.length} item(s) unsettled >21d: ${arrears.slice(0, 20).join(",")}`);
  if (!candidates.size) return { groups: 0, charged: 0, packageOnly: 0, declined: 0, skipped: 0, reclaimed, arrears: arrears.length };

  // Group by trainer→client pair.
  const groups = new Map();
  for (const s of candidates.values()) {
    const k = `${s.trainerUid}_${s.clientUid}`;
    (groups.get(k) || groups.set(k, []).get(k)).push(s);
  }

  const out = { groups: groups.size, charged: 0, packageOnly: 0, declined: 0, skipped: 0, reclaimed, arrears: arrears.length, details: [] };
  for (const [key, items] of groups) {
    try {
      const r = await settleGroup(db, items, { now, nowDate, force, dryRun });
      out[r.outcome] = (out[r.outcome] || 0) + 1;
      out.details.push({ group: key, ...r });
    } catch (e) {
      console.error("settleGroup failed", key, e && e.message);
      out.skipped++;
      out.details.push({ group: key, outcome: "error", error: String(e && e.message).slice(0, 200) });
    }
  }
  // WHY each group did nothing, not just how many did nothing (S195). The
  // outcome counts alone can't distinguish "waiting for Sunday" from "this
  // trainer can't bill" from "no card on file" — so the one question anyone
  // actually asks of this log ("my session didn't charge, why?") needed a
  // separate investigation every time. Reasons only, never client or trainer
  // ids: this line lands in Cloud Logging, and who trains with whom isn't
  // something to leave lying around there.
  const why = {};
  for (const d of out.details) if (d.why) why[d.why] = (why[d.why] || 0) + 1;
  console.log(`sessionsSettle: ${JSON.stringify({ ...out, details: undefined, why })}`);
  return out;
}

async function settleGroup(db, items, { now, nowDate, force, dryRun }) {
  const { trainerUid, clientUid } = items[0];
  const [trainerDoc, clientDoc] = await Promise.all([
    db.doc(`users/${trainerUid}`).get(), db.doc(`users/${clientUid}`).get(),
  ]);
  const trainer = trainerDoc.exists ? trainerDoc.data() : {};
  const client = clientDoc.exists ? clientDoc.data() : {};

  // Safety interlock (S178) — the single chokepoint for ALL automatic charging.
  // Every charge lands on the platform Stripe account (no Connect yet), so a
  // non-allowlisted trainer's sweep must never create a PaymentIntent: the money
  // would be ours to hold with no way to pay them. Checked FIRST, before mode or
  // hold, so the skip reason is unambiguous in the logs.
  if (!canBillSessions(trainerUid)) return { outcome: "skipped", why: "billing-not-enabled" };

  const trainerPolicy = policyOf(trainer.sessionPolicy);
  if (trainerPolicy.billingMode === "manual") return { outcome: "skipped", why: "manual-mode" };
  if (!settleWindowFor(trainerPolicy.billingMode, nowDate, force)) {
    return { outcome: "skipped", why: trainerPolicy.billingMode === "biweekly" ? "awaiting-fortnight" : "awaiting-sunday" };
  }
  if (client.sessionBillingHold) return { outcome: "skipped", why: "existing-hold" };

  // The GOVERNING policy for fees = what the client agreed to, AS IT STOOD when
  // each obligation arose. Chosen per item, not per group: a client who
  // re-saved an expiring card between cancelling and Sunday must not be
  // re-priced under the newer snapshot.
  const consents = await consentHistory(db, clientUid, trainerUid);
  const policyFor = (s) => {
    const c = consentInForce(consents, obligationAt(s));
    return { consent: c, policy: c && c.policy ? policyOf(c.policy) : null };
  };
  // For a NO-SHOW specifically, fall back to the earliest consent when none was
  // in force at the time. The common shape is: client trains, no-shows once,
  // THEN saves a card — with no fallback that no-show prices at 100% even though
  // every version of the policy they ever agreed to said (say) 50%. The fee can
  // only ever come down from this, so the fallback can't surprise anyone.
  const noShowPolicyFor = (s) => policyFor(s).policy || (consents.length && consents[0].policy ? policyOf(consents[0].policy) : null);

  // Price the items. Delivered sessions bill their frozen price (or the no-show
  // percentage the client was actually shown); cancelled ones bill the late fee
  // — judged ONLY under a consented policy. No consent = no fee, ever.
  const billable = [];
  const freebies = [];   // $0 items — real, but nothing to charge
  const waive = async (id) => { if (!dryRun) await db.doc(`sessions/${id}`).update({ settled: "waived", settledAt: now }).catch(() => {}); };
  for (const s of items) {
    const { consent, policy } = policyFor(s);
    if (s.kind === "session") {
      const cents = s.noShow === true ? noShowFeeCents(s, noShowPolicyFor(s)) : baseCents(s);
      // A $0 item is not billable, but it IS finished. Letting it into the claim
      // was what stranded unpriced sessions in "processing" forever and fired a
      // "your package covered 0 sessions" notice at people with no package.
      if (cents <= 0) { freebies.push(s); continue; }
      billable.push({ s, cents, settledAs: "charged", isNoShow: s.noShow === true, consentAgreedAt: consent ? consent.agreedAt : null });
    } else if (policy) {
      const fee = lateFeeCents(s, policy);
      if (fee > 0) billable.push({ s, cents: fee, settledAs: "charged", evidence: evidenceSummary(s, policy), isFee: true, consentAgreedAt: consent ? consent.agreedAt : null });
      else await waive(s.id);
    } else {
      // A cancel with no consent in force at the time: nothing was agreed to,
      // so nothing can be charged. Mark it waived to keep the sweep clean.
      await waive(s.id);
    }
  }
  // Free/unpriced work reaches a terminal state without consuming a claim.
  if (!dryRun) await Promise.all(freebies.map((s) => db.doc(`sessions/${s.id}`).update({ settled: "free", settledAt: now }).catch(() => {})));
  if (!billable.length) return { outcome: "skipped", why: "nothing-billable", free: freebies.length };

  const pm = client.sessionPaymentMethod;
  const credits = Number((client.sessionCredits || {})[trainerUid]) || 0;
  if (dryRun) {
    return { outcome: "skipped", why: "dry-run",
      would: billable.map((b) => ({ id: b.s.id, cents: b.cents, fee: !!b.isFee, noShow: !!b.isNoShow })), credits, hasCard: !!(pm && pm.id) };
  }

  // No card and no credits → nothing can happen this run. Checked BEFORE the
  // transaction so we don't mint a ledger row: allocating it first meant every
  // hourly run filed another "awaiting card" ledger for the same sessions, and
  // the trainer's Earnings tile summed them all as pending.
  if ((!pm || !pm.id || !client.stripeCustomerId) && credits <= 0) {
    return { outcome: "skipped", why: "no-card", wouldHaveCharged: billable.reduce((a, b) => a + b.cents, 0) };
  }

  // ── claim + credits, transactionally ──────────────────────────────────────
  const ledgerRef = db.collection("sessionCharges").doc();
  const claim = await db.runTransaction(async (tx) => {
    const fresh = await Promise.all(billable.map((b) => tx.get(db.doc(`sessions/${b.s.id}`))));
    const live = billable.filter((b, i) => fresh[i].exists && !fresh[i].data().settled);
    if (!live.length) return null;
    const profRef = db.doc(`users/${clientUid}`);
    const prof = (await tx.get(profRef)).data() || {};
    let creditsLeft = Number((prof.sessionCredits || {})[trainerUid]) || 0;

    const covered = [], toCharge = [];
    // Package first (Kevin's rule) — one credit covers one session OR one
    // late-cancelled session; a credit-covered item costs the card nothing.
    // MOST EXPENSIVE FIRST: credits used to be spent in scan order, so a $0
    // consult or a half-price late fee could burn a credit the client paid
    // $120 for while the real session went to the card. A credit is worth what
    // it saves, so spend it where it saves most.
    for (const b of [...live].sort((x, y) => y.cents - x.cents)) {
      if (creditsLeft > 0) { creditsLeft--; covered.push(b); }
      else toCharge.push(b);
    }
    for (const b of covered) tx.update(db.doc(`sessions/${b.s.id}`), { settled: "package", settledAt: now, ledgerId: ledgerRef.id });
    for (const b of toCharge) tx.update(db.doc(`sessions/${b.s.id}`), { settled: "processing", settledAt: now, ledgerId: ledgerRef.id });
    if (covered.length) tx.set(profRef, { sessionCredits: { [trainerUid]: creditsLeft } }, { merge: true });

    const amountCents = toCharge.reduce((a, b) => a + b.cents, 0);
    tx.set(ledgerRef, {
      trainerUid, clientUid, createdAt: now,
      kind: toCharge.some((b) => b.isFee) ? (toCharge.every((b) => b.isFee) ? "late_fee" : "mixed") : "sessions",
      sessionIds: live.map((b) => b.s.id),
      // Which of those the CARD actually pays for. Pay-now used to write
      // "charged" over every id in sessionIds, including package-covered ones,
      // so the session record and the ledger contradicted each other on exactly
      // the sessions a chargeback defence would rest on.
      chargedSessionIds: toCharge.map((b) => b.s.id),
      creditsUsed: covered.length,
      items: toCharge.map((b) => ({ id: b.s.id, cents: b.cents, fee: !!b.isFee, noShow: !!b.isNoShow, evidence: b.evidence || null, title: b.s.title || null, startAt: b.s.startAt, consentAgreedAt: b.consentAgreedAt || null })),
      amountCents,
      status: amountCents > 0 ? "pending" : "covered_by_package",
      // Pinned at claim time. Recovery must not re-derive either of these from
      // the profile, which can change between the charge and the reconcile.
      customerId: client.stripeCustomerId || null,
      testMode: client.sessionBillingTest === true,
      consentAgreedAt: toCharge.reduce((a, b) => Math.max(a, b.consentAgreedAt || 0), 0) || null,
    });
    return { covered, toCharge, amountCents };
  });
  if (!claim) return { outcome: "skipped", why: "raced-already-settled" };
  if (claim.amountCents === 0) {
    // Only say "your package covered it" when a package actually covered it.
    if (claim.covered.length) {
      await notifyBoth(db, trainer, client, trainerUid, clientUid,
        `${claim.covered.length} session${claim.covered.length === 1 ? "" : "s"} covered by your package`,
        `Your prepaid package covered ${claim.covered.length}. No card charge.`);
    }
    return { outcome: "packageOnly", credits: claim.covered.length };
  }

  // Credits covered some but there's still a balance and no card → release only
  // the uncovered claims so a future card picks them up. (The covered ones are
  // legitimately settled and must stay that way.)
  if (!pm || !pm.id || !client.stripeCustomerId) {
    await Promise.all(claim.toCharge.map((b) => db.doc(`sessions/${b.s.id}`).update({ settled: null, settledAt: null, ledgerId: null }).catch(() => {})));
    await ledgerRef.update({ status: "no_card", amountCents: 0, chargedSessionIds: [] }).catch(() => {});
    return { outcome: "skipped", why: "no-card", wouldHaveCharged: claim.amountCents };
  }

  // ── the charge ────────────────────────────────────────────────────────────
  // ⚠️ ONLY the paymentIntents.create call lives in the decline-classifying try.
  // Everything after it is bookkeeping, and bookkeeping that fails after Stripe
  // has taken the money must never be recorded as "your card was declined" —
  // that is what made the client tap Pay now and get charged a second time.
  const dollars = (claim.amountCents / 100).toFixed(2);
  const trainerName = trainer.displayName || "your trainer";
  const releaseToHold = async (status, extra) => {
    // ⚠️ THE HOLD IS WRITTEN FIRST. It is the ONLY key to the Pay-now recovery
    // path — paySessionBalance does nothing without `sessionBillingHold` — while
    // the session `hold` stamps merely take those sessions out of the sweep. If
    // the profile write were last and failed, the sessions would sit at "hold"
    // (invisible to every future sweep) with no hold on the profile to unlock
    // paying: an unrecoverable balance. Ordered so the recovery key exists
    // before anything is parked behind it.
    await db.doc(`users/${clientUid}`).set({
      sessionBillingHold: { trainerUid, amountCents: claim.amountCents, ledgerId: ledgerRef.id, at: Date.now() },
    }, { merge: true }).catch((e) => console.error("failed to set sessionBillingHold", ledgerRef.id, e && e.message));
    await ledgerRef.update({ status, ...extra }).catch(() => {});
    await Promise.all(claim.toCharge.map((b) => db.doc(`sessions/${b.s.id}`).update({ settled: "hold" }).catch(() => {})));
  };

  let pi = null;
  try {
    // Constructed INSIDE the try: a missing or misnamed secret used to throw
    // here and strand every group the run touched.
    const stripe = require("stripe")(client.sessionBillingTest === true
      ? STRIPE_TEST_SECRET_KEY.value() : STRIPE_SECRET_KEY.value());
    pi = await stripe.paymentIntents.create({
      amount: claim.amountCents, currency: "usd",
      customer: client.stripeCustomerId, payment_method: pm.id,
      off_session: true, confirm: true,
      description: `Training sessions with ${trainerName}`.slice(0, 100),
      metadata: { trainerUid, clientUid, ledgerId: ledgerRef.id, purpose: "glidna_sessions" },
    }, { idempotencyKey: ledgerRef.id });
  } catch (e) {
    const code = codeOf(e);

    // (a) The issuer wants the cardholder present (3DS). The card is fine —
    // telling them it was declined sends them to replace a good card forever.
    if (needsAuthentication(e)) {
      console.warn("charge needs authentication", ledgerRef.id, code);
      await releaseToHold("needs_authentication", { declineCode: code, declinedAt: Date.now() });
      await notifyBoth(db, trainer, client, trainerUid, clientUid,
        `${clientName(client)}'s bank needs to verify a payment`, `$${dollars} is waiting on a bank check. They've been asked to confirm it.`,
        `Your bank needs to approve $${dollars}`, `Your bank asked us to confirm this payment with you. Open Sessions and tap Pay now to approve it.`);
      return { outcome: "declined", amountCents: claim.amountCents, needsAuthentication: true };
    }

    // (b) A genuine card refusal — the only case that is a decline.
    if (isCardDecline(e)) {
      console.warn("charge declined", ledgerRef.id, code);
      await releaseToHold("declined", { declineCode: code, declinedAt: Date.now() });
      await notifyBoth(db, trainer, client, trainerUid, clientUid,
        `Payment didn't go through`, `${clientName(client)}'s card was declined for $${dollars}. They've been asked to update it.`,
        `Card declined — action needed`, `Your card was declined for $${dollars} of training with ${trainerName}. Update your card in Sessions to keep training.`);
      return { outcome: "declined", amountCents: claim.amountCents };
    }

    // (c) Everything else — connection reset, Stripe 5xx, rate limit, a
    // test-mode customer id hit with the live key, a bad secret. The request may
    // well have reached Stripe and captured the money. We DO NOT know, so we say
    // nothing to the client, set no hold, and leave the sessions claimed for the
    // reaper to resolve against Stripe on the next run.
    console.error("charge failed with a non-card error — NOT a decline", ledgerRef.id, e && e.type, code, e && e.message);
    await ledgerRef.update({
      status: "needs_reconcile", errorType: String((e && e.type) || "unknown").slice(0, 60),
      declineCode: code, failedAt: Date.now(),
    }).catch(() => {});
    await notifyBoth(db, trainer, client, trainerUid, clientUid,
      `A payment needs checking`, `We couldn't confirm a $${dollars} charge for ${clientName(client)}. Nothing was reported to them; it'll be checked automatically.`,
      null, null);
    return { outcome: "skipped", why: "needs-reconcile", amountCents: claim.amountCents };
  }

  // Stripe answered. Believe the STATUS, not merely the absence of a throw:
  // `processing` is not money in the bank, and booking it as revenue meant the
  // trainer's Earnings tile counted a payment that could still fail.
  if (pi.status !== "succeeded") {
    if (pi.status === "processing") {
      await ledgerRef.update({ status: "processing", chargeId: pi.id, chargedAt: Date.now() }).catch(() => {});
      return { outcome: "skipped", why: "processing", amountCents: claim.amountCents, chargeId: pi.id };
    }
    await releaseToHold("needs_authentication", { chargeId: pi.id, piStatus: String(pi.status).slice(0, 40), declinedAt: Date.now() });
    await notifyBoth(db, trainer, client, trainerUid, clientUid,
      `${clientName(client)}'s payment needs their approval`, `$${dollars} is waiting on a bank check.`,
      `Your bank needs to approve $${dollars}`, `Open Sessions and tap Pay now to approve this payment.`);
    return { outcome: "declined", amountCents: claim.amountCents, piStatus: pi.status };
  }

  // ── bookkeeping (money has moved — this can no longer fail into a decline) ──
  try {
    await ledgerRef.update({ status: "succeeded", chargeId: pi.id, chargedAt: Date.now() });
    await Promise.all(claim.toCharge.map((b) => db.doc(`sessions/${b.s.id}`).update({ settled: "charged", chargeId: pi.id })));
  } catch (e) {
    // Stripe has the money and Firestore didn't take the note. Say so loudly and
    // leave a status the reaper understands — never a decline, never a hold.
    console.error("CHARGED BUT BOOKKEEPING FAILED — reconcile", ledgerRef.id, pi.id, e && e.message);
    await ledgerRef.update({ status: "charged_needs_reconcile", chargeId: pi.id, chargedAt: Date.now() }).catch(() => {});
    return { outcome: "charged", amountCents: claim.amountCents, chargeId: pi.id, bookkeepingFailed: true };
  }

  await notifyBoth(db, trainer, client, trainerUid, clientUid,
    `$${dollars} received for training`, `Charged to ${clientName(client)}'s card as agreed.`,
    `Training billed — $${dollars}`, `${claim.toCharge.length} item${claim.toCharge.length === 1 ? "" : "s"} charged to your saved card, as agreed with ${trainerName}.`);
  return { outcome: "charged", amountCents: claim.amountCents, chargeId: pi.id };
}

const clientName = (c) => c.displayName || [c.firstName, c.lastName].filter(Boolean).join(" ") || "your client";

// Mark a ledger paid and lift the sessions it covers.
// ⚠️ Only the sessions the CARD paid for. This used to write settled:"charged"
// over every id in `sessionIds`, which includes package-covered ones — so a
// session that cost the client a prepaid credit ended up stamped with a Stripe
// charge id it was never part of. In a system whose whole chargeback defence is
// "our record shows exactly what happened", that contradiction is the damage.
async function finalizePaid(db, ledgerRef, ledger, clientUid, chargeId, stillProcessing) {
  await ledgerRef.update({
    status: stillProcessing ? "processing" : "succeeded",
    chargeId, chargedAt: Date.now(), paidViaRetry: true,
  }).catch(() => {});
  // A `processing` intent is not money in the bank — it can still fail. Record
  // the intent, but don't stamp the sessions as charged and don't lift the hold
  // until Stripe actually says succeeded.
  if (stillProcessing) return;

  const ids = Array.isArray(ledger.chargedSessionIds) && ledger.chargedSessionIds.length
    ? ledger.chargedSessionIds
    // Older ledgers predate chargedSessionIds; fall back, but never touch one
    // already settled as package.
    : (Array.isArray(ledger.sessionIds) ? ledger.sessionIds : []);
  await Promise.all(ids.map(async (sid) => {
    const ref = db.doc(`sessions/${sid}`);
    const cur = (await ref.get().catch(() => null));
    if (cur && cur.exists && cur.data().settled === "package") return; // never overwrite a credit
    await ref.update({ settled: "charged", chargeId }).catch(() => {});
  }));
  await db.doc(`users/${clientUid}`).set({ sessionBillingHold: admin.firestore.FieldValue.delete() }, { merge: true }).catch(() => {});
}

async function notifyBoth(db, trainer, client, trainerUid, clientUid, trainerTitle, trainerBody, clientTitle, clientBody) {
  // Feed always; push respects each side's Notification Center prefs.
  // Passing clientTitle === null means TRAINER ONLY, deliberately: when we don't
  // yet know whether a charge succeeded, the client must not be told anything —
  // a wrong "declined" is what leads them to pay twice.
  const sends = [sendPushTo(db, trainerUid, { title: trainerTitle, body: trainerBody, tag: "session-billing", url: "/" }, "sessionBilling").catch(() => {})];
  if (clientTitle !== null) {
    sends.push(sendPushTo(db, clientUid, { title: clientTitle || trainerTitle, body: clientBody || trainerBody, tag: "session-billing", url: "/" }, "sessionBilling").catch(() => {}));
  }
  await Promise.all(sends);
}

// ── entry points ────────────────────────────────────────────────────────────
// Hourly sweep: per_session groups settle every run; weekly groups only settle
// inside the Sunday-evening window (the function itself still runs hourly —
// idempotency makes the repeat runs harmless).
// ⚠️ timeoutSeconds is load-bearing, not tuning. This was the only scheduled
// function in the repo still on the 60s default while every other sweep sets
// 300-540s — and it is the one that claims sessions before calling Stripe. On a
// Sunday, when weekly mode makes every client settle in the same run, a kill at
// 60s left whoever was in flight claimed-but-uncharged. The reaper now recovers
// that, but the run should not be dying in the first place.
exports.sessionsSettle = onSchedule(
  { schedule: "every 60 minutes", region: REGION, secrets: [STRIPE_SECRET_KEY, STRIPE_TEST_SECRET_KEY, VAPID_PRIVATE_KEY], maxInstances: 1, timeoutSeconds: 540 },
  async () => { await runSettle({}); },
);

// Admin-only manual trigger — testing and Kevin's "settle now" control.
// dryRun returns what WOULD happen without touching anything.
exports.settleNow = onCall(
  { secrets: [STRIPE_SECRET_KEY, STRIPE_TEST_SECRET_KEY, VAPID_PRIVATE_KEY], region: REGION, maxInstances: 1 },
  async (request) => {
    const uid = request.auth && request.auth.uid;
    if (!uid || !ADMIN_UIDS.includes(uid)) throw new HttpsError("permission-denied", "Admin only.");
    const d = request.data || {};
    return runSettle({ dryRun: d.dryRun === true, force: d.force === true });
  },
);

// ── PAY NOW (S103): the client clears a declined balance on the spot ─────────
// The decline flow already holds the account + banners the client. This is the
// button on that banner: retry the held ledger against whatever card is on file
// RIGHT NOW (which may be one they just replaced), without waiting for the next
// Sunday sweep. On success the hold lifts and training resumes; a repeat
// decline just says so and points them at replacing the card.
//
// The client pays their OWN hold (uid from auth — no clientId, so nobody can
// trigger a charge on someone else). It re-reads everything server-side and
// re-charges only the exact ledger the hold names, so the amount can't be
// tampered with.
exports.paySessionBalance = onCall(
  { secrets: [STRIPE_SECRET_KEY, STRIPE_TEST_SECRET_KEY, VAPID_PRIVATE_KEY], region: REGION, maxInstances: 5 },
  async (request) => {
    const uid = request.auth && request.auth.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Please sign in.");
    const db = admin.firestore();
    const client = (await db.doc(`users/${uid}`).get()).data() || {};
    const hold = client.sessionBillingHold;
    if (!hold || !hold.ledgerId) return { ok: true, nothingDue: true };

    const pm = client.sessionPaymentMethod;
    if (!pm || !pm.id || !client.stripeCustomerId) return { ok: false, needCard: true, amountCents: hold.amountCents || 0 };

    const ledgerRef = db.doc(`sessionCharges/${hold.ledgerId}`);
    const ledgerSnap = await ledgerRef.get();
    const ledger = ledgerSnap.exists ? ledgerSnap.data() : null;
    if (!ledger) {
      // The ledger vanished (shouldn't happen) — clear the stale hold so the
      // client isn't stuck behind a balance we can no longer identify.
      await db.doc(`users/${uid}`).set({ sessionBillingHold: admin.firestore.FieldValue.delete() }, { merge: true });
      return { ok: true, nothingDue: true };
    }
    if (ledger.status === "succeeded") {
      // Already paid (e.g. the sweep beat the button) — just lift the hold.
      await db.doc(`users/${uid}`).set({ sessionBillingHold: admin.firestore.FieldValue.delete() }, { merge: true });
      return { ok: true, alreadyPaid: true };
    }
    const amountCents = Number(ledger.amountCents) || Number(hold.amountCents) || 0;
    if (amountCents <= 0) {
      await db.doc(`users/${uid}`).set({ sessionBillingHold: admin.firestore.FieldValue.delete() }, { merge: true });
      return { ok: true, nothingDue: true };
    }

    const trainerUid = ledger.trainerUid || hold.trainerUid;
    const trainer = trainerUid ? ((await db.doc(`users/${trainerUid}`).get()).data() || {}) : {};
    const trainerName = trainer.displayName || "your trainer";
    // The ledger's recorded mode governs, not the profile's current flag.
    const stripe = require("stripe")(ledger.testMode === true ? STRIPE_TEST_SECRET_KEY.value() : STRIPE_SECRET_KEY.value());

    // ── 1. ASK STRIPE FIRST ───────────────────────────────────────────────
    // The ledger says this wasn't paid. The ledger can be wrong — that is the
    // whole failure mode we're defending against, because the write that would
    // have marked it paid is exactly the write that may have failed. So before
    // taking any money, ask the only authority that knows.
    const existing = await findIntentByLedger(stripe, customerIdsFor(ledger, client), ledgerRef.id);
    if (existing === undefined) {
      // Couldn't reach Stripe. Refuse rather than risk a second charge.
      return { ok: false, retryLater: true, amountCents };
    }
    if (existing && (existing.status === "succeeded" || existing.status === "processing")) {
      await finalizePaid(db, ledgerRef, ledger, uid, existing.id, existing.status === "processing");
      return { ok: true, alreadyPaid: true, amountCents };
    }

    // ── 2. CLAIM THE LEDGER ───────────────────────────────────────────────
    // maxInstances is 5 and the call is slow (Stripe + several writes + two
    // pushes), so nothing visibly happens and the client taps again — or opens
    // it on a second device. The React `payNowBusy` flag dies on reload; only a
    // transaction is a real lock. The attempt counter also becomes the
    // idempotency key, so a duplicate that slips through replays the same key
    // and gets Stripe's cached answer instead of a second charge.
    let attempt = 0;
    const claimed = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ledgerRef);
      const cur = snap.exists ? snap.data() : null;
      if (!cur) return false;
      if (cur.status === "succeeded" || cur.status === "processing") return false;
      if (cur.status === "retry_processing" && Date.now() - Number(cur.retryStartedAt || 0) < 120000) return false;
      attempt = Number(cur.retryAttempts || 0) + 1;
      tx.update(ledgerRef, { status: "retry_processing", retryAttempts: attempt, retryStartedAt: Date.now() });
      return true;
    });
    if (!claimed) {
      // Another tap (or the sweep) is mid-flight, or it's already paid.
      const now = (await ledgerRef.get()).data() || {};
      if (now.status === "succeeded") {
        await db.doc(`users/${uid}`).set({ sessionBillingHold: admin.firestore.FieldValue.delete() }, { merge: true });
        return { ok: true, alreadyPaid: true };
      }
      return { ok: false, inFlight: true, amountCents };
    }

    try {
      // ON-session confirm — the client is right here, so a card that needs a
      // bank check (3DS) can prompt on the hosted card flow if it must. A fresh
      // idempotency key (the retry is a NEW attempt, distinct from the sweep's).
      const origin = safeOrigin(String((request.rawRequest && request.rawRequest.headers && request.rawRequest.headers.origin) || ""));
      const pi = await stripe.paymentIntents.create({
        amount: amountCents, currency: "usd",
        customer: client.stripeCustomerId, payment_method: pm.id,
        payment_method_types: ["card"],
        off_session: false, confirm: true,
        // Required by Stripe when a confirmed on-session card intent may need a
        // redirect for a 3DS bank check — where the browser returns after auth.
        return_url: `${origin}/?sessionpay=done`,
        description: `Training sessions with ${trainerName}`.slice(0, 100),
        metadata: { trainerUid, clientUid: uid, ledgerId: ledgerRef.id, purpose: "glidna_sessions", retry: String(attempt) },
        // Keyed to the ATTEMPT, never to the clock. A stable key would cache the
        // first result for 24h so a fixed card couldn't be retried; a Date.now()
        // key made every duplicate tap a brand-new charge. The attempt counter
        // is both: distinct per real retry, identical for a duplicate of the
        // same one — so Stripe collapses the duplicate itself.
      }, { idempotencyKey: `${ledgerRef.id}-retry-${attempt}` });

      if (pi.status !== "succeeded") {
        // requires_action / processing — don't lift the hold yet. Record the
        // intent so a later attempt reconciles against it instead of re-charging.
        await ledgerRef.update({
          status: pi.status === "processing" ? "processing" : "needs_authentication",
          chargeId: pi.id, piStatus: String(pi.status).slice(0, 40),
        }).catch(() => {});
        return { ok: false, pending: true, status: pi.status, amountCents };
      }

      await finalizePaid(db, ledgerRef, ledger, uid, pi.id, false);

      const dollars = (amountCents / 100).toFixed(2);
      await notifyBoth(db, trainer, client, trainerUid, uid,
        `$${dollars} received for training`, `${clientName(client)} cleared their balance.`,
        `Payment received — $${dollars}`, `Thanks — your balance with ${trainerName} is cleared and you're all set.`);
      return { ok: true, paid: true, amountCents };
    } catch (e) {
      const code = codeOf(e);
      // Release the retry claim so the client can try again once they've fixed
      // whatever it was — but ONLY when we know the charge didn't happen.
      if (isCardDecline(e)) {
        console.warn("paySessionBalance declined", ledgerRef.id, code, e && e.message);
        await ledgerRef.update({
          status: needsAuthentication(e) ? "needs_authentication" : "declined",
          lastRetryDeclineCode: code, lastRetryAt: Date.now(),
        }).catch(() => {});
        return { ok: false, declined: true, needsAuthentication: needsAuthentication(e), code, amountCents };
      }
      // Non-card failure: the charge may have landed. Do NOT reopen the retry
      // path — leave it for the reaper to settle against Stripe.
      console.error("paySessionBalance failed with a non-card error", ledgerRef.id, e && e.type, code, e && e.message);
      await ledgerRef.update({
        status: "needs_reconcile", errorType: String((e && e.type) || "unknown").slice(0, 60),
        lastRetryDeclineCode: code, lastRetryAt: Date.now(),
      }).catch(() => {});
      return { ok: false, retryLater: true, amountCents };
    }
  },
);
