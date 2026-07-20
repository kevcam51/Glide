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
// STATE IS STORED, ADDRESSES ARE NOT (Kevin's constraint, S101):
// which state's rules apply depends on where the PAYING CLIENT is, not just
// where the trainer is. But we don't want to hold anyone's home address. So
// Stripe stays the system of record for the billing address (they already hold
// it for AVS, and they're the PCI-compliant party), and Glide keeps only the
// two-letter STATE code off the saved card. A state is not an address.

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");

const STRIPE_SECRET_KEY = defineSecret("STRIPE_SECRET_KEY");
const REGION = "us-central1";

// Reuse the same origin allowlist shape as billing.js / webauthn.js.
const ALLOWED_ORIGINS = [
  "https://glidna.com", "https://www.glidna.com", "https://glidna.app",
  "http://localhost:5173",
];

const stripeClient = () => require("stripe")(STRIPE_SECRET_KEY.value());

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

// ─── 1. Start saving a card ────────────────────────────────────────────────
// Returns a SetupIntent client secret. The card details go from the browser
// STRAIGHT to Stripe — they never touch Glide's servers or Firestore.
exports.createSessionSetupIntent = onCall(
  { secrets: [STRIPE_SECRET_KEY], region: REGION, maxInstances: 10 },
  async (request) => {
    const uid = request.auth && request.auth.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Please sign in.");
    const trainerUid = String((request.data && request.data.trainerUid) || "").trim();
    if (!trainerUid) throw new HttpsError("invalid-argument", "Missing trainer.");

    const db = admin.firestore();
    const profile = (await db.doc(`users/${uid}`).get()).data() || {};

    // The client must actually be this trainer's client — same rule the
    // sessions collection enforces. Prevents saving a card "for" a stranger.
    const linked = profile.assignedTrainerId === trainerUid || profile.headTrainerId === trainerUid;
    if (!linked) throw new HttpsError("permission-denied", "You're not linked to that trainer.");

    const stripe = stripeClient();
    const customerId = await ensureCustomer(db, uid, profile, stripe);
    const si = await stripe.setupIntents.create({
      customer: customerId,
      payment_method_types: ["card"],
      // off_session: this credential will be charged when the client isn't
      // present. Declaring it here is what makes Stripe set up the mandate and
      // the correct stored-credential indicators on later charges.
      usage: "off_session",
      metadata: { uid, trainerUid, purpose: "glidna_sessions" },
    });
    return { clientSecret: si.client_secret, customerId };
  },
);

// ─── 2. Record the card + the authorization ────────────────────────────────
// Called after Stripe confirms the SetupIntent. Re-reads the payment method
// FROM STRIPE rather than trusting anything the browser says about it.
exports.recordSessionConsent = onCall(
  { secrets: [STRIPE_SECRET_KEY], region: REGION, maxInstances: 10 },
  async (request) => {
    const uid = request.auth && request.auth.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Please sign in.");
    const d = request.data || {};
    const setupIntentId = String(d.setupIntentId || "").trim();
    const trainerUid = String(d.trainerUid || "").trim();
    if (!setupIntentId || !trainerUid) throw new HttpsError("invalid-argument", "Missing setup details.");
    // The exact wording the client was shown, echoed back so the record proves
    // WHAT was agreed to — not merely that some box was ticked.
    const snapshot = d.policySnapshot && typeof d.policySnapshot === "object" ? d.policySnapshot : null;
    if (!snapshot || !snapshot.consentLine) {
      throw new HttpsError("invalid-argument", "Missing the agreement text.");
    }

    const db = admin.firestore();
    const profile = (await db.doc(`users/${uid}`).get()).data() || {};
    const linked = profile.assignedTrainerId === trainerUid || profile.headTrainerId === trainerUid;
    if (!linked) throw new HttpsError("permission-denied", "You're not linked to that trainer.");

    const stripe = stripeClient();
    const si = await stripe.setupIntents.retrieve(setupIntentId);
    if (!si || si.metadata.uid !== uid) throw new HttpsError("permission-denied", "That setup isn't yours.");
    if (si.status !== "succeeded") throw new HttpsError("failed-precondition", "The card wasn't confirmed.");
    const pmId = typeof si.payment_method === "string" ? si.payment_method : (si.payment_method || {}).id;
    if (!pmId) throw new HttpsError("failed-precondition", "No card on that setup.");

    const pm = await stripe.paymentMethods.retrieve(pmId);
    const card = pm.card || {};
    const addr = (pm.billing_details && pm.billing_details.address) || {};

    // Server-stamped evidence. request.rawRequest is the underlying Express
    // request; the IP and user-agent come from the connection, not the payload.
    const req = request.rawRequest || {};
    const hdrs = req.headers || {};
    const ip = String(hdrs["x-forwarded-for"] || req.ip || "").split(",")[0].trim() || null;
    const userAgent = String(hdrs["user-agent"] || "").slice(0, 300) || null;
    const origin = String(hdrs.origin || "");
    const originOk = ALLOWED_ORIGINS.includes(origin);

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
      policy: snapshot.policy || null,
      policyVersion: Number(snapshot.policyVersion) || 1,
      // Evidence, stamped here rather than accepted from the client.
      ip, userAgent, origin: originOk ? origin : null,
      setupIntentId, paymentMethodId: pmId,
      cardBrand: card.brand || null, cardLast4: card.last4 || null,
      cardExpMonth: card.exp_month || null, cardExpYear: card.exp_year || null,
      billingState, billingCountry,
    };

    // Append-only consent log: every agreement ever given is kept, because a
    // dispute is always about what was agreed on a PARTICULAR date. Never
    // overwritten when a card is replaced or a policy changes.
    await db.collection(`users/${uid}/sessionConsents`).add(consent);

    // The current card pointer, server-written (rules block the owner from
    // touching these — a client must not be able to fake having a card).
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
  { secrets: [STRIPE_SECRET_KEY], region: REGION, maxInstances: 10 },
  async (request) => {
    const uid = request.auth && request.auth.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Please sign in.");
    const db = admin.firestore();
    const profile = (await db.doc(`users/${uid}`).get()).data() || {};
    const pm = profile.sessionPaymentMethod;
    if (!pm || !pm.id) return { ok: true, alreadyGone: true };

    try { await stripeClient().paymentMethods.detach(pm.id); }
    catch (e) { console.warn("detach failed (continuing to clear the pointer)", e && e.message); }

    await db.doc(`users/${uid}`).set({
      sessionPaymentMethod: admin.firestore.FieldValue.delete(),
      sessionCardRemovedAt: Date.now(),
    }, { merge: true });
    return { ok: true };
  },
);
