// Glidna — session billing, phase 3 step 1: CARD ON FILE (S101).
// docs/SESSIONS-BILLING-PLAN.md + docs/LEGAL-SESSIONS.md.
//
// This file saves a client's card and records their authorization to charge it
// later. It deliberately does NOT charge anything — the per-session and weekly
// dispatchers come next, and they can only run against a card saved here with a
// consent record attached.
//
// WHY THE CONSENT RECORD IS THE POINT (from the research):
//  • Card networks require a stored-credential CONSENT AGREEMENT captured BEFORE
//    the credential is stored, retained for the life of the consent, and
//    producible on request. Off-session charging without it is a rules
//    violation independent of any consumer-law question.
//  • Mastercard Rule 5.12.6 forbids conditioning acceptance on the cardholder
//    waiving dispute rights — so this records what they AGREED TO, and never
//    asks them to give anything up.
//  • Reg Z billing-error rights run against the card ISSUER, so no wording here
//    can (or tries to) limit them.
//  • The IP + user-agent are stamped SERVER-side from the request. Anything the
//    browser reports about itself is self-asserted and near-worthless as
//    evidence — that is why the client never sends them.
//
// CARD ENTRY IS STRIPE-HOSTED (Checkout in setup mode — the same pattern as
// billing.js): no card field ever renders in Glide, no publishable key ships in
// the bundle, and billing_address_collection:"required" makes Stripe gather the
// address we need the STATE from.
//
// STATE IS STORED, ADDRESSES ARE NOT (Kevin's constraint, S101):
// which state's rules apply depends on where the PAYING CLIENT is, not just
// where the trainer is (virtual sessions). But we don't hold anyone's home
// address. Stripe stays the system of record for the billing address (they
// already hold it for AVS, and they're the PCI-compliant party); Glide keeps
// only the two-letter STATE code off the saved card. A state is not an address.

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");

const STRIPE_SECRET_KEY = defineSecret("STRIPE_SECRET_KEY");
const STRIPE_TEST_SECRET_KEY = defineSecret("STRIPE_TEST_SECRET_KEY");
const REGION = "us-central1";

const ALLOWED_ORIGINS = [
  "https://glidna.com", "https://www.glidna.com", "https://glidna.app",
  "http://localhost:5173",
];
const safeOrigin = (o) => (ALLOWED_ORIGINS.includes(o) ? o : ALLOWED_ORIGINS[0]);

// Test-flagged clients (sessionBillingTest, admin-set, server-only in rules)
// ride the TEST key so full card+charge cycles can run with 4242-cards while
// real clients use the live key side by side.
const stripeClient = (profile) => require("stripe")(
  profile && profile.sessionBillingTest === true ? STRIPE_TEST_SECRET_KEY.value() : STRIPE_SECRET_KEY.value());

// Is trainerUid actually this client's trainer? Mirrors firestore.rules
// isTrainerOf EXACTLY: the direct trainer, or the head ABOVE that trainer —
// the chain runs client.assignedTrainerId → that trainer's headTrainerId.
// (A client's own headTrainerId field is not part of the chain; checking it
// was the S101 first-draft bug.)
async function isTrainerOfClient(db, trainerUid, clientProfile) {
  const direct = clientProfile.assignedTrainerId || null;
  if (!direct) return false;
  if (direct === trainerUid) return true;
  const trainerDoc = await db.doc(`users/${direct}`).get();
  const t = trainerDoc.exists ? trainerDoc.data() : null;
  return !!t && t.headTrainerId === trainerUid;
}

// Get-or-create the Stripe customer for a user, reusing the id billing.js
// already stores so a client never ends up with two customer records.
async function ensureCustomer(db, uid, profile, stripe) {
  if (profile && profile.stripeCustomerId) return profile.stripeCustomerId;
  const customer = await stripe.customers.create({
    email: profile && profile.email ? profile.email : undefined,
    name: profile && profile.displayName ? profile.displayName : undefined,
    metadata: { uid },
  });
  await db.doc(`users/${uid}`).set({ stripeCustomerId: customer.id }, { merge: true });
  return customer.id;
}

// Keep only the policy fields we know, at bounded sizes — a consent record
// must not be a vehicle for writing arbitrary payloads into Firestore.
function cleanPolicy(p) {
  if (!p || typeof p !== "object") return null;
  const num = (v, lo, hi) => (Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Number(v))) : null);
  return {
    cancelType: ["anytime", "window", "never"].includes(p.cancelType) ? p.cancelType : "window",
    cancelWindowHours: num(p.cancelWindowHours, 0, 336),
    lateCancelChargePct: num(p.lateCancelChargePct, 0, 100),
    noShowChargePct: num(p.noShowChargePct, 0, 100),
    billingMode: ["per_session", "weekly", "manual"].includes(p.billingMode) ? p.billingMode : "weekly",
    policyNote: String(p.policyNote || "").slice(0, 400),
  };
}

// ─── 1. Start saving a card (hosted page) ──────────────────────────────────
// Returns a Stripe-hosted Checkout URL in SETUP mode. Card details go from the
// client's browser straight to Stripe — they never touch Glide.
exports.createSessionSetupIntent = onCall(
  { secrets: [STRIPE_SECRET_KEY, STRIPE_TEST_SECRET_KEY], region: REGION, maxInstances: 10 },
  async (request) => {
    const uid = request.auth && request.auth.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Please sign in.");
    const trainerUid = String((request.data && request.data.trainerUid) || "").trim();
    if (!trainerUid) throw new HttpsError("invalid-argument", "Missing trainer.");

    const db = admin.firestore();
    const profile = (await db.doc(`users/${uid}`).get()).data() || {};
    if (!(await isTrainerOfClient(db, trainerUid, profile))) {
      throw new HttpsError("permission-denied", "You're not linked to that trainer.");
    }

    const stripe = stripeClient(profile);
    const customerId = await ensureCustomer(db, uid, profile, stripe);
    const origin = safeOrigin(String((request.rawRequest && request.rawRequest.headers && request.rawRequest.headers.origin) || ""));
    const session = await stripe.checkout.sessions.create({
      mode: "setup",
      customer: customerId,
      payment_method_types: ["card"],
      // The billing address lives at Stripe; Glide will read back only the state.
      billing_address_collection: "required",
      setup_intent_data: { metadata: { uid, trainerUid, purpose: "glidna_sessions" } },
      metadata: { uid, trainerUid, purpose: "glidna_sessions" },
      success_url: `${origin}/?cardsetup=success&cs={CHECKOUT_SESSION_ID}&trainer=${encodeURIComponent(trainerUid)}`,
      cancel_url: `${origin}/?cardsetup=cancelled`,
    });
    return { url: session.url };
  },
);

// ─── 2. Record the card + the authorization ────────────────────────────────
// Called after the hosted page completes. Re-reads everything FROM STRIPE
// rather than trusting anything the browser says about it. Accepts either the
// checkout session id (the app's return path) or a raw SetupIntent id (test
// harnesses and any future in-app flow).
exports.recordSessionConsent = onCall(
  { secrets: [STRIPE_SECRET_KEY, STRIPE_TEST_SECRET_KEY], region: REGION, maxInstances: 10 },
  async (request) => {
    const uid = request.auth && request.auth.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Please sign in.");
    const d = request.data || {};
    const checkoutSessionId = String(d.checkoutSessionId || "").trim();
    const setupIntentId = String(d.setupIntentId || "").trim();
    const trainerUid = String(d.trainerUid || "").trim();
    if ((!checkoutSessionId && !setupIntentId) || !trainerUid) {
      throw new HttpsError("invalid-argument", "Missing setup details.");
    }
    // The exact wording the client was shown, echoed back so the record proves
    // WHAT was agreed to — not merely that some box was ticked.
    const snapshot = d.policySnapshot && typeof d.policySnapshot === "object" ? d.policySnapshot : null;
    if (!snapshot || !snapshot.consentLine) {
      throw new HttpsError("invalid-argument", "Missing the agreement text.");
    }

    const db = admin.firestore();
    const profile = (await db.doc(`users/${uid}`).get()).data() || {};
    if (!(await isTrainerOfClient(db, trainerUid, profile))) {
      throw new HttpsError("permission-denied", "You're not linked to that trainer.");
    }

    const stripe = stripeClient(profile);
    let si;
    if (checkoutSessionId) {
      const cs = await stripe.checkout.sessions.retrieve(checkoutSessionId, { expand: ["setup_intent"] });
      if (!cs || (cs.metadata || {}).uid !== uid) throw new HttpsError("permission-denied", "That setup isn't yours.");
      si = cs.setup_intent && typeof cs.setup_intent === "object" ? cs.setup_intent : null;
      if (!si && typeof cs.setup_intent === "string") si = await stripe.setupIntents.retrieve(cs.setup_intent);
    } else {
      si = await stripe.setupIntents.retrieve(setupIntentId);
    }
    if (!si || (si.metadata || {}).uid !== uid) throw new HttpsError("permission-denied", "That setup isn't yours.");
    if ((si.metadata || {}).trainerUid !== trainerUid) throw new HttpsError("permission-denied", "Trainer mismatch on that setup.");
    if (si.status !== "succeeded") throw new HttpsError("failed-precondition", "The card wasn't confirmed.");
    const pmId = typeof si.payment_method === "string" ? si.payment_method : (si.payment_method || {}).id;
    if (!pmId) throw new HttpsError("failed-precondition", "No card on that setup.");

    const pm = await stripe.paymentMethods.retrieve(pmId);
    const card = pm.card || {};
    const addr = (pm.billing_details && pm.billing_details.address) || {};

    // Server-stamped evidence. The IP and user-agent come from the connection,
    // not the payload.
    const req = request.rawRequest || {};
    const hdrs = req.headers || {};
    const ip = String(hdrs["x-forwarded-for"] || req.ip || "").split(",")[0].trim() || null;
    const userAgent = String(hdrs["user-agent"] || "").slice(0, 300) || null;
    const origin = String(hdrs.origin || "");

    const now = Date.now();
    // ONLY the state — never the street, city or postcode. Stripe keeps the
    // full address; Glide keeps the one field the compliance rules turn on.
    const billingState = String(addr.state || "").slice(0, 4).toUpperCase() || null;
    const billingCountry = String(addr.country || "").slice(0, 2).toUpperCase() || null;

    const consent = {
      uid, trainerUid,
      agreedAt: now,
      consentLine: String(snapshot.consentLine).slice(0, 600),
      shownText: Array.isArray(snapshot.shownText) ? snapshot.shownText.slice(0, 12).map((t) => String(t).slice(0, 400)) : [],
      policy: cleanPolicy(snapshot.policy),
      policyVersion: Number(snapshot.policyVersion) || 1,
      // Evidence, stamped here rather than accepted from the client.
      ip, userAgent, origin: ALLOWED_ORIGINS.includes(origin) ? origin : null,
      setupIntentId: si.id, paymentMethodId: pmId,
      checkoutSessionId: checkoutSessionId || null,
      cardBrand: card.brand || null, cardLast4: card.last4 || null,
      cardExpMonth: card.exp_month || null, cardExpYear: card.exp_year || null,
      billingState, billingCountry,
    };

    // Append-only consent log: every agreement ever given is kept, because a
    // dispute is always about what was agreed on a PARTICULAR date. Never
    // overwritten when a card is replaced or a policy changes.
    await db.collection(`users/${uid}/sessionConsents`).add(consent);

    // The current card pointer, server-written (rules block the owner from
    // touching it — a client must not be able to fake having a card).
    await db.doc(`users/${uid}`).set({
      sessionPaymentMethod: {
        id: pmId, brand: card.brand || null, last4: card.last4 || null,
        expMonth: card.exp_month || null, expYear: card.exp_year || null,
        billingState, billingCountry,
        savedAt: now, trainerUid,
      },
    }, { merge: true });

    return {
      ok: true,
      card: { brand: card.brand || null, last4: card.last4 || null, expMonth: card.exp_month || null, expYear: card.exp_year || null },
      billingState,
    };
  },
);

// ─── 3. Remove the card ────────────────────────────────────────────────────
// Detaching must be as easy as saving — both because state auto-renewal laws
// increasingly require cancellation to be as easy as sign-up, and because a
// client who cannot remove their card will simply dispute the next charge.
// The consent LOG is kept (it is the record of what was true at the time); only
// the live pointer is cleared and the credential detached at Stripe.
exports.removeSessionCard = onCall(
  { secrets: [STRIPE_SECRET_KEY, STRIPE_TEST_SECRET_KEY], region: REGION, maxInstances: 10 },
  async (request) => {
    const uid = request.auth && request.auth.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Please sign in.");
    const db = admin.firestore();
    const profile = (await db.doc(`users/${uid}`).get()).data() || {};
    const pm = profile.sessionPaymentMethod;
    if (!pm || !pm.id) return { ok: true, alreadyGone: true };

    try { await stripeClient(profile).paymentMethods.detach(pm.id); }
    catch (e) { console.warn("detach failed (continuing to clear the pointer)", e && e.message); }

    await db.doc(`users/${uid}`).set({
      sessionPaymentMethod: admin.firestore.FieldValue.delete(),
      sessionCardRemovedAt: Date.now(),
    }, { merge: true });
    return { ok: true };
  },
);
