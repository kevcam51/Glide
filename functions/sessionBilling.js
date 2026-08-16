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
const { onDocumentUpdated } = require("firebase-functions/v2/firestore");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");
const { sendPushTo, VAPID_PRIVATE_KEY } = require("./push");

const { canBillSessions, BILLING_UNAVAILABLE_MSG } = require("./sessionBillingGate");

const STRIPE_SECRET_KEY = defineSecret("STRIPE_SECRET_KEY");
const STRIPE_TEST_SECRET_KEY = defineSecret("STRIPE_TEST_SECRET_KEY");
const REGION = "us-central1";
// Keep in lock-step with POLICY_TEXT_VERSION in src/sessions.js (CommonJS here
// can't import the ESM constant). Used only as a fallback if a consent snapshot
// somehow arrives without its own version — never stamp a stale label on the
// current wording. Currently 2 (S106).
const CURRENT_POLICY_VERSION = 2;

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
//
// ⚠️ MODE MATTERS (S186). A Stripe customer belongs to exactly one mode: a test
// `cus_…` does not exist to the live key. `stripeCustomerId` is SHARED with
// subscription billing, so rehearsing session billing on a client flagged
// `sessionBillingTest` used to mint a TEST customer into that shared field —
// and once the flag came off, every live charge for that person threw
// `resource_missing`. The old catch-all read that as a card decline, so the
// client was told their (perfectly good) card was refused, put on a billing
// hold, and their delivered training was never collected. It also broke their
// subscription checkout, which passes the same id to the live key.
//
// So the mode is stamped alongside the id, and a mismatch mints a fresh
// customer for the mode in use rather than reusing one that cannot work.
// billing.js learned this exact lesson for referral credits (`stripeLivemode`);
// the session path simply never adopted it.
async function ensureCustomer(db, uid, profile, stripe, wantLive) {
  const stored = profile && profile.stripeCustomerId;
  if (stored) {
    const storedLive = profile.stripeLivemode;
    // Unknown mode (written before this stamp existed) is trusted only when it
    // matches the live key — the historical default — and verified either way.
    if (storedLive === undefined ? wantLive : storedLive === wantLive) {
      try {
        const cus = await stripe.customers.retrieve(stored);
        if (cus && !cus.deleted) {
          if (storedLive === undefined) await db.doc(`users/${uid}`).set({ stripeLivemode: wantLive }, { merge: true });
          return stored;
        }
      } catch (e) {
        // ⚠️ ONLY a customer that Stripe says is GONE may be replaced. Re-minting
        // on a timeout or a 5xx would fork the customer for a reason that isn't
        // real — and the duplicate-charge check (findIntentByLedger) is scoped to
        // a customer, so a wrongly-forked id makes "has this ledger been charged?"
        // answer a confident NO about the wrong account. That turns the guard
        // against double-charging into the cause of one.
        if (!(e && (e.code === "resource_missing" || (e.raw && e.raw.code === "resource_missing")))) {
          console.error("could not verify stripeCustomerId — refusing to re-mint", uid, e && e.message);
          throw e;
        }
        console.warn("stored stripeCustomerId no longer exists at Stripe, minting a fresh one", uid);
      }
    } else {
      console.warn("stripeCustomerId belongs to the other Stripe mode — minting a fresh one", uid);
    }
  }
  const customer = await stripe.customers.create({
    email: profile && profile.email ? profile.email : undefined,
    name: profile && profile.displayName ? profile.displayName : undefined,
    metadata: { uid },
  });
  // The saved card belonged to the OLD customer and cannot be charged on the new
  // one, so clear the pointer rather than leave a payment method that will throw
  // on every future sweep. Keep the old id so a charge made against it can still
  // be found when reconciling.
  const patch = { stripeCustomerId: customer.id, stripeLivemode: wantLive };
  if (stored) {
    patch.stripeCustomerIdPrev = admin.firestore.FieldValue.arrayUnion(stored);
    patch.sessionPaymentMethod = admin.firestore.FieldValue.delete();
  }
  await db.doc(`users/${uid}`).set(patch, { merge: true });
  return customer.id;
}

// Keep only the policy fields we know, at bounded sizes — a consent record
// must not be a vehicle for writing arbitrary payloads into Firestore.
//
// Exported because it is also the NORMALIZER the policy-change trigger compares
// through (below): what counts as "the terms changed" is decided here, and that
// decision is worth being able to test on its own.
function cleanPolicy(p) {
  if (!p || typeof p !== "object") return null;
  const num = (v, lo, hi) => (Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Number(v))) : null);
  return {
    cancelType: ["anytime", "window", "never"].includes(p.cancelType) ? p.cancelType : "window",
    cancelWindowHours: num(p.cancelWindowHours, 0, 336),
    lateCancelChargePct: num(p.lateCancelChargePct, 0, 100),
    noShowChargePct: num(p.noShowChargePct, 0, 100),
    // ⚠️ `biweekly` was missing here while it was a real, selectable mode
    // everywhere else (S186b added it to BILLING_MODES, the disclosure text and
    // the settle engine). A fortnightly trainer's consent record therefore
    // froze the word "weekly" — so the one document that is supposed to prove
    // what the client agreed to described a charging cadence they were never
    // put on. Kept in lock-step with BILLING_MODES in src/sessions.js.
    billingMode: ["per_session", "weekly", "biweekly", "manual"].includes(p.billingMode) ? p.billingMode : "weekly",
    // The standard rate (S195). Part of the terms because every percentage
    // above is a percentage OF it.
    standardPriceCents: Math.round(num(p.standardPriceCents, 0, 500000) || 0),
    policyNote: String(p.policyNote || "").slice(0, 400),
  };
}

exports.cleanPolicy = cleanPolicy;

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

    // Safety interlock (S178): no Connect yet, so a non-allowlisted trainer's
    // client money would land in the platform account with no payout path.
    // Checked BEFORE any Stripe object is created, so nothing is left dangling.
    if (!canBillSessions(trainerUid)) {
      throw new HttpsError("failed-precondition", BILLING_UNAVAILABLE_MSG, { reason: "session-billing-unavailable" });
    }

    const stripe = stripeClient(profile);
    const customerId = await ensureCustomer(db, uid, profile, stripe, profile.sessionBillingTest !== true);
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

    // Same interlock as the setup call. Belt and braces: the setup intent can
    // only exist if the trainer was allowlisted when it was created, but a
    // trainer could be de-listed between the two calls, and storing a card
    // pointer we can never legitimately charge would be the worst outcome.
    if (!canBillSessions(trainerUid)) {
      throw new HttpsError("failed-precondition", BILLING_UNAVAILABLE_MSG, { reason: "session-billing-unavailable" });
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
      policyVersion: Number(snapshot.policyVersion) || CURRENT_POLICY_VERSION,
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
    //
    // `sessionConsentPolicy` mirrors the terms that now GOVERN this client's
    // charges. The consent log itself is server-only and unreadable from the
    // browser, which is why the cancel dialog used to price from the trainer's
    // CURRENT policy while the sweep billed the frozen snapshot — so a client
    // could be shown "no charge" and then billed the full session price, or the
    // trainer silently paid $0 on a fee the client was told they owed. Mirroring
    // it here lets the UI quote the exact terms that will be charged, without
    // opening the append-only log to client reads. (S186)
    await db.doc(`users/${uid}`).set({
      sessionPaymentMethod: {
        id: pmId, brand: card.brand || null, last4: card.last4 || null,
        expMonth: card.exp_month || null, expYear: card.exp_year || null,
        billingState, billingCountry,
        savedAt: now, trainerUid,
      },
      sessionConsentPolicy: { ...consent.policy, trainerUid, agreedAt: now, policyVersion: consent.policyVersion },
    }, { merge: true });

    return {
      ok: true,
      card: { brand: card.brand || null, last4: card.last4 || null, expMonth: card.exp_month || null, expYear: card.exp_year || null },
      billingState,
    };
  },
);

// ─── 2b. RE-AGREE to updated terms (S192) ──────────────────────────────────
//
// One policy governs everyone — that is deliberate, and it is what makes the
// terms defensible: there is a single thing the client agreed to and a single
// thing to produce in a dispute. But a client's charges are priced from the
// snapshot frozen when they last agreed, so until now a trainer who changed
// their policy could never actually move existing clients onto it. The only
// path was "re-save your card", which is both obscure and the wrong ask —
// nothing is wrong with their card.
//
// This is that missing path: the client reviews the CURRENT terms and agrees,
// and a fresh consent record is appended using the card they already have.
//
// ⚠️ IT MUST BE THE CLIENT WHO CALLS THIS. A trainer cannot accept new terms on
// someone else's behalf — that is the entire point of consent — so the uid comes
// from auth and there is no clientId parameter. The evidence (IP, user agent,
// the exact text shown) is stamped here from the connection, exactly as at card
// setup, because a consent record is only worth what its provenance is worth.
exports.reconsentSessionPolicy = onCall(
  { region: REGION, maxInstances: 10 },
  async (request) => {
    const uid = request.auth && request.auth.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Please sign in.");
    const db = admin.firestore();
    const d = request.data || {};
    const trainerUid = String(d.trainerUid || "");
    const snapshot = d.snapshot || {};
    if (!trainerUid) throw new HttpsError("invalid-argument", "Missing trainer.");
    if (!snapshot.consentLine || !Array.isArray(snapshot.shownText)) {
      throw new HttpsError("invalid-argument", "Missing the terms that were shown.");
    }

    const me = (await db.doc(`users/${uid}`).get()).data() || {};
    // Re-consent only makes sense for a client of THIS trainer who already has a
    // card on file — otherwise the ordinary card-setup flow is the right path
    // and already captures consent.
    if (me.assignedTrainerId !== trainerUid && me.headTrainerId !== trainerUid) {
      throw new HttpsError("permission-denied", "Not your trainer.");
    }
    const pm = me.sessionPaymentMethod;
    if (!pm || !pm.id) throw new HttpsError("failed-precondition", "No card on file.");

    // ⚠️ The policy agreed to is read from the TRAINER'S PROFILE, never from the
    // payload. Taking it from the client would let a modified request agree to
    // terms nobody offered — cheaper fees, or none — and that forged snapshot
    // would then govern every future charge.
    const trainer = (await db.doc(`users/${trainerUid}`).get()).data() || {};
    const policy = cleanPolicy(trainer.sessionPolicy);

    const req = request.rawRequest || {};
    const hdrs = req.headers || {};
    const ip = String(hdrs["x-forwarded-for"] || req.ip || "").split(",")[0].trim() || null;
    const userAgent = String(hdrs["user-agent"] || "").slice(0, 300) || null;
    const origin = String(hdrs.origin || "");
    const now = Date.now();

    const consent = {
      uid, trainerUid,
      agreedAt: now,
      consentLine: String(snapshot.consentLine).slice(0, 600),
      shownText: snapshot.shownText.slice(0, 12).map((t) => String(t).slice(0, 400)),
      policy,
      policyVersion: Number(snapshot.policyVersion) || CURRENT_POLICY_VERSION,
      ip, userAgent, origin: ALLOWED_ORIGINS.includes(origin) ? origin : null,
      // No new SetupIntent — this re-affirms terms for the card already saved.
      paymentMethodId: pm.id,
      cardBrand: pm.brand || null, cardLast4: pm.last4 || null,
      cardExpMonth: pm.expMonth || null, cardExpYear: pm.expYear || null,
      billingState: pm.billingState || null, billingCountry: pm.billingCountry || null,
      kind: "reconsent",
    };
    // Append-only, like every other agreement: the old consent stays as the
    // record of what governed the charges made under it.
    await db.collection(`users/${uid}/sessionConsents`).add(consent);
    await db.doc(`users/${uid}`).set({
      sessionConsentPolicy: { ...policy, trainerUid, agreedAt: now, policyVersion: consent.policyVersion },
    }, { merge: true });

    return { ok: true, agreedAt: now };
  },
);

// ─── 2c. TELL CLIENTS WHEN THE TERMS CHANGE (S194) ─────────────────────────
//
// Re-consent is worthless if nobody knows there is anything to re-consent to.
// Without this, a client would only discover changed terms by happening to open
// the Sessions screen — so the trainer's policy and the client's agreement could
// sit apart indefinitely, which is the situation the whole consent record exists
// to prevent.
//
// A TRIGGER, not a call from the app, deliberately: the notification then cannot
// be skipped by a client that crashed, lost signal, or simply wasn't updated.
// The write to the trainer's profile IS the event.
//
// Only clients who have ALREADY AGREED to something are notified — someone with
// no card has nothing to re-agree to and will meet the current terms at card
// setup, so pinging them would be noise about a decision they haven't made yet.
exports.onSessionPolicyChanged = onDocumentUpdated(
  { document: "users/{uid}", region: REGION, secrets: [VAPID_PRIVATE_KEY], maxInstances: 3 },
  async (event) => {
    const before = (event.data && event.data.before && event.data.before.data()) || {};
    const after = (event.data && event.data.after && event.data.after.data()) || {};
    const trainerUid = event.params.uid;

    // Only the terms that decide money. billingMode is deliberately included:
    // "when you'll be charged" is part of what someone agreed to. So is
    // standardPriceCents (S195) — a rate change is the most consequential edit
    // on this list, since every fee below it is a percentage of that number,
    // and a client who agreed to "$85, 100% late-cancel fee" has not agreed to
    // "$150, 100% late-cancel fee".
    const FIELDS = ["cancelType", "cancelWindowHours", "lateCancelChargePct", "noShowChargePct", "billingMode", "standardPriceCents", "policyNote"];
    // ⚠️ NORMALIZE BEFORE COMPARING. The raw comparison was `String(x ?? "")`,
    // which makes an ABSENT field ("") differ from a zero field ("0") — and
    // every policy saved after S195 gains `standardPriceCents: 0` whether or not
    // the trainer typed a rate. So the first save of an unchanged policy looked
    // like a terms change to this trigger, while the app's own drift check runs
    // both sides through policyOf and correctly saw no change. The result was
    // the worst kind of notification: every existing client pushed "your
    // trainer updated their payment terms", opening an app that then showed
    // them nothing had changed and offered nothing to agree to.
    const norm = (p) => {
      const c = cleanPolicy(p) || {};
      return (k) => String(c[k] ?? "");
    };
    const a = norm(before.sessionPolicy), b = norm(after.sessionPolicy);
    if (!FIELDS.some((k) => a(k) !== b(k))) return;

    const db = admin.firestore();
    const name = after.displayName || [after.firstName, after.lastName].filter(Boolean).join(" ") || "Your trainer";
    const snap = await db.collection("users").where("assignedTrainerId", "==", trainerUid).limit(200).get();
    let notified = 0;
    await Promise.all(snap.docs.map(async (d) => {
      const c = d.data() || {};
      // Already-agreed clients only, and only where the terms they hold actually
      // differ from the new ones — a cosmetic edit that lands back on the same
      // numbers should not ask anyone to re-agree to what they already accepted.
      const held = c.sessionConsentPolicy;
      if (!held || !c.sessionPaymentMethod || !c.sessionPaymentMethod.id) return;
      // Same normalization as above, and for the same reason: a consent
      // snapshot written before standardPriceCents existed has no such field,
      // and "absent" must compare equal to "0" or every one of these clients is
      // told their terms changed when they did not.
      const h = norm(held);
      if (!FIELDS.some((k) => h(k) !== b(k))) return;
      await sendPushTo(db, d.id, {
        title: `${name} updated their payment terms`,
        body: "Open Sessions to see what changed and agree to the new terms. You stay on your current terms until you do.",
        tag: "session-policy-changed", url: "/",
      }, "sessionBilling").catch(() => {});
      notified++;
    }));
    if (notified) console.log("onSessionPolicyChanged", JSON.stringify({ trainerUid, notified }));
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
