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
// For the ON-session pay-now retry: Stripe requires a return_url on a confirmed
// intent that could need a redirect (e.g. a 3DS card check), so we pass the
// caller's validated origin. (The off_session sweep never redirects, so it needs
// none.) Mirrors sessionBilling.js.
const ALLOWED_ORIGINS = [
  "https://glidna.com", "https://www.glidna.com", "https://glidna.app",
  "http://localhost:5173",
];
const safeOrigin = (o) => (ALLOWED_ORIGINS.includes(o) ? o : ALLOWED_ORIGINS[0]);

const LOOKBACK_MS = 30 * 86400000; // how far back the sweep looks for unsettled items
const MAX_PER_RUN = 200;

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
    billingMode: ["per_session", "weekly", "manual"].includes(p.billingMode) ? p.billingMode : DEFAULT_POLICY.billingMode,
  };
}
function isLateCancel(session, policy) {
  if (!session.startAt || !session.cancelledAt) return false;
  if (policy.cancelType === "anytime") return false;
  if (policy.cancelType === "never") return true;
  return session.startAt - session.cancelledAt < policy.cancelWindowHours * 3600000;
}
function lateFeeCents(session, policy) {
  if (session.cancelledBy !== session.clientUid) return 0; // trainer cancel = free, always
  if (!isLateCancel(session, policy)) return 0;
  return Math.round((Number(session.priceCents) || 0) * policy.lateCancelChargePct / 100);
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

// Latest consent snapshot for this client+trainer — the policy that GOVERNS.
async function latestConsent(db, clientUid, trainerUid) {
  const snap = await db.collection(`users/${clientUid}/sessionConsents`)
    .where("trainerUid", "==", trainerUid).get();
  let best = null;
  snap.forEach((d) => { const v = d.data(); if (!best || (v.agreedAt || 0) > (best.agreedAt || 0)) best = v; });
  return best;
}

// ── the engine ──────────────────────────────────────────────────────────────
async function runSettle({ dryRun = false, force = false } = {}) {
  const db = admin.firestore();
  const now = Date.now();
  const weeklyWindow = force || isWeeklySettleWindow();

  // Candidates: completed-and-unsettled + cancelled-and-unsettled (30-day window).
  // Both are single-field range queries; `settled` can't be queried for
  // "missing", so it's filtered in code.
  const [doneSnap, cancSnap] = await Promise.all([
    db.collection("sessions").where("completedAt", ">", now - LOOKBACK_MS).limit(MAX_PER_RUN).get(),
    db.collection("sessions").where("cancelledAt", ">", now - LOOKBACK_MS).limit(MAX_PER_RUN).get(),
  ]);
  const candidates = new Map();
  doneSnap.forEach((d) => { const v = d.data(); if (!v.settled && v.status !== "cancelled") candidates.set(d.id, { id: d.id, ...v, kind: "session" }); });
  cancSnap.forEach((d) => { const v = d.data(); if (!v.settled && v.status === "cancelled" && v.cancelledBy === v.clientUid) candidates.set(d.id, { id: d.id, ...v, kind: "cancel" }); });
  if (!candidates.size) return { groups: 0, charged: 0, packageOnly: 0, declined: 0, skipped: 0 };

  // Group by trainer→client pair.
  const groups = new Map();
  for (const s of candidates.values()) {
    const k = `${s.trainerUid}_${s.clientUid}`;
    (groups.get(k) || groups.set(k, []).get(k)).push(s);
  }

  const out = { groups: groups.size, charged: 0, packageOnly: 0, declined: 0, skipped: 0, details: [] };
  for (const [key, items] of groups) {
    try {
      const r = await settleGroup(db, items, { now, weeklyWindow, dryRun });
      out[r.outcome] = (out[r.outcome] || 0) + 1;
      out.details.push({ group: key, ...r });
    } catch (e) {
      console.error("settleGroup failed", key, e && e.message);
      out.skipped++;
      out.details.push({ group: key, outcome: "error", error: String(e && e.message).slice(0, 200) });
    }
  }
  console.log(`sessionsSettle: ${JSON.stringify({ ...out, details: undefined })}`);
  return out;
}

async function settleGroup(db, items, { now, weeklyWindow, dryRun }) {
  const { trainerUid, clientUid } = items[0];
  const [trainerDoc, clientDoc] = await Promise.all([
    db.doc(`users/${trainerUid}`).get(), db.doc(`users/${clientUid}`).get(),
  ]);
  const trainer = trainerDoc.exists ? trainerDoc.data() : {};
  const client = clientDoc.exists ? clientDoc.data() : {};

  const trainerPolicy = policyOf(trainer.sessionPolicy);
  if (trainerPolicy.billingMode === "manual") return { outcome: "skipped", why: "manual-mode" };
  if (trainerPolicy.billingMode === "weekly" && !weeklyWindow) return { outcome: "skipped", why: "awaiting-sunday" };
  if (client.sessionBillingHold) return { outcome: "skipped", why: "existing-hold" };

  // The GOVERNING policy for fees = what the client agreed to at card setup.
  const consent = await latestConsent(db, clientUid, trainerUid);
  const feePolicy = consent && consent.policy ? policyOf(consent.policy) : null;

  // Price the items. Completed sessions bill at their booked price; cancelled
  // ones bill the fee — judged ONLY under a consented policy. No consent = no
  // fee, ever (nothing was agreed to).
  const billable = [];
  for (const s of items) {
    if (s.kind === "session") {
      billable.push({ s, cents: Math.max(0, Number(s.priceCents) || 0), settledAs: "charged" });
    } else if (feePolicy) {
      const fee = lateFeeCents(s, feePolicy);
      if (fee > 0) billable.push({ s, cents: fee, settledAs: "charged", evidence: evidenceSummary(s, feePolicy), isFee: true });
      else if (!dryRun) await db.doc(`sessions/${s.id}`).update({ settled: "waived", settledAt: now }).catch(() => {});
    }
    // cancel + no consent → leave untouched (a consent may exist later? No —
    // fees can't be applied retroactively to a cancel that predates consent,
    // so mark it waived to keep the sweep clean).
    else if (!dryRun) await db.doc(`sessions/${s.id}`).update({ settled: "waived", settledAt: now }).catch(() => {});
  }
  if (!billable.length) return { outcome: "skipped", why: "nothing-billable" };

  const pm = client.sessionPaymentMethod;
  const credits = Number((client.sessionCredits || {})[trainerUid]) || 0;
  if (dryRun) {
    return { outcome: "skipped", why: "dry-run",
      would: billable.map((b) => ({ id: b.s.id, cents: b.cents, fee: !!b.isFee })), credits, hasCard: !!(pm && pm.id) };
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
    for (const b of live) {
      // Package first (Kevin's rule) — one credit covers one session OR one
      // late-cancelled session; a credit-covered item costs the card nothing.
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
      creditsUsed: covered.length,
      items: toCharge.map((b) => ({ id: b.s.id, cents: b.cents, fee: !!b.isFee, evidence: b.evidence || null, title: b.s.title || null, startAt: b.s.startAt })),
      amountCents,
      status: amountCents > 0 ? "pending" : "covered_by_package",
      testMode: client.sessionBillingTest === true,
      consentAgreedAt: consent ? consent.agreedAt : null,
    });
    return { covered, toCharge, amountCents };
  });
  if (!claim) return { outcome: "skipped", why: "raced-already-settled" };
  if (claim.amountCents === 0) {
    await notifyBoth(db, trainer, client, trainerUid, clientUid,
      `${claim.covered.length} session${claim.covered.length === 1 ? "" : "s"} covered by your package`,
      `Your prepaid package covered ${claim.covered.length}. No card charge.`);
    return { outcome: "packageOnly", credits: claim.covered.length };
  }

  // No card → release the claim (back to unsettled) so a future card picks it up.
  if (!pm || !pm.id || !client.stripeCustomerId) {
    await Promise.all(claim.toCharge.map((b) => db.doc(`sessions/${b.s.id}`).update({ settled: null, settledAt: null, ledgerId: null })));
    await ledgerRef.update({ status: "no_card" });
    return { outcome: "skipped", why: "no-card", wouldHaveCharged: claim.amountCents };
  }

  // ── the charge ────────────────────────────────────────────────────────────
  const stripeKey = client.sessionBillingTest === true ? STRIPE_TEST_SECRET_KEY.value() : STRIPE_SECRET_KEY.value();
  const stripe = require("stripe")(stripeKey);
  const trainerName = trainer.displayName || "your trainer";
  try {
    const pi = await stripe.paymentIntents.create({
      amount: claim.amountCents, currency: "usd",
      customer: client.stripeCustomerId, payment_method: pm.id,
      off_session: true, confirm: true,
      description: `Training sessions with ${trainerName}`.slice(0, 100),
      metadata: { trainerUid, clientUid, ledgerId: ledgerRef.id, purpose: "glidna_sessions" },
    }, { idempotencyKey: ledgerRef.id });
    await ledgerRef.update({ status: "succeeded", chargeId: pi.id, chargedAt: Date.now() });
    await Promise.all(claim.toCharge.map((b) => db.doc(`sessions/${b.s.id}`).update({ settled: "charged", chargeId: pi.id })));
    const dollars = (claim.amountCents / 100).toFixed(2);
    await notifyBoth(db, trainer, client, trainerUid, clientUid,
      `$${dollars} received for training`, `Charged to ${clientName(client)}'s card as agreed.`,
      `Training billed — $${dollars}`, `${claim.toCharge.length} item${claim.toCharge.length === 1 ? "" : "s"} charged to your saved card, as agreed with ${trainerName}.`);
    return { outcome: "charged", amountCents: claim.amountCents, chargeId: pi.id };
  } catch (e) {
    const code = (e && (e.decline_code || e.code)) || "charge_failed";
    console.warn("charge declined/failed", ledgerRef.id, code);
    await ledgerRef.update({ status: "declined", declineCode: String(code).slice(0, 60), declinedAt: Date.now() });
    await Promise.all(claim.toCharge.map((b) => db.doc(`sessions/${b.s.id}`).update({ settled: "hold" })));
    // Kevin's decline flow: hold the account, tell BOTH sides.
    await db.doc(`users/${clientUid}`).set({
      sessionBillingHold: { trainerUid, amountCents: claim.amountCents, ledgerId: ledgerRef.id, at: Date.now() },
    }, { merge: true });
    const dollars = (claim.amountCents / 100).toFixed(2);
    await notifyBoth(db, trainer, client, trainerUid, clientUid,
      `Payment didn't go through`, `${clientName(client)}'s card was declined for $${dollars}. They've been asked to update it.`,
      `Card declined — action needed`, `Your card was declined for $${dollars} of training with ${trainerName}. Update your card in Sessions to keep training.`);
    return { outcome: "declined", amountCents: claim.amountCents };
  }
}

const clientName = (c) => c.displayName || [c.firstName, c.lastName].filter(Boolean).join(" ") || "your client";

async function notifyBoth(db, trainer, client, trainerUid, clientUid, trainerTitle, trainerBody, clientTitle, clientBody) {
  // Feed always; push respects each side's Notification Center prefs.
  await Promise.all([
    sendPushTo(db, trainerUid, { title: trainerTitle, body: trainerBody, tag: "session-billing", url: "/" }, "sessionBilling").catch(() => {}),
    sendPushTo(db, clientUid, { title: clientTitle || trainerTitle, body: clientBody || trainerBody, tag: "session-billing", url: "/" }, "sessionBilling").catch(() => {}),
  ]);
}

// ── entry points ────────────────────────────────────────────────────────────
// Hourly sweep: per_session groups settle every run; weekly groups only settle
// inside the Sunday-evening window (the function itself still runs hourly —
// idempotency makes the repeat runs harmless).
exports.sessionsSettle = onSchedule(
  { schedule: "every 60 minutes", region: REGION, secrets: [STRIPE_SECRET_KEY, STRIPE_TEST_SECRET_KEY, VAPID_PRIVATE_KEY], maxInstances: 1 },
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
    const stripe = require("stripe")(client.sessionBillingTest === true ? STRIPE_TEST_SECRET_KEY.value() : STRIPE_SECRET_KEY.value());

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
        metadata: { trainerUid, clientUid: uid, ledgerId: ledgerRef.id, purpose: "glidna_sessions", retry: "1" },
        // Per-attempt idempotency key: a stable one (ledger+pm) would cache the
        // FIRST result for 24h, so a transient decline the client then fixes
        // (topped-up balance, same card) couldn't be retried. Double-charge is
        // instead prevented by the checks above — a succeeded ledger or a
        // cleared hold both short-circuit before we ever reach here.
      }, { idempotencyKey: `${ledgerRef.id}-retry-${Date.now()}` });

      if (pi.status !== "succeeded") {
        // requires_action / processing — don't lift the hold yet.
        return { ok: false, pending: true, status: pi.status, amountCents };
      }

      await ledgerRef.update({ status: "succeeded", chargeId: pi.id, chargedAt: Date.now(), paidViaRetry: true });
      // Lift the held sessions this ledger covered.
      const ids = Array.isArray(ledger.sessionIds) ? ledger.sessionIds : [];
      await Promise.all(ids.map((sid) => db.doc(`sessions/${sid}`).update({ settled: "charged", chargeId: pi.id }).catch(() => {})));
      await db.doc(`users/${uid}`).set({ sessionBillingHold: admin.firestore.FieldValue.delete() }, { merge: true });

      const dollars = (amountCents / 100).toFixed(2);
      await notifyBoth(db, trainer, client, trainerUid, uid,
        `$${dollars} received for training`, `${clientName(client)} cleared their balance.`,
        `Payment received — $${dollars}`, `Thanks — your balance with ${trainerName} is cleared and you're all set.`);
      return { ok: true, paid: true, amountCents };
    } catch (e) {
      const code = (e && (e.decline_code || e.code)) || "charge_failed";
      console.warn("paySessionBalance declined", ledgerRef.id, code, e && e.message);
      await ledgerRef.update({ lastRetryDeclineCode: String(code).slice(0, 60), lastRetryAt: Date.now() });
      return { ok: false, declined: true, code: String(code).slice(0, 60), amountCents };
    }
  },
);
