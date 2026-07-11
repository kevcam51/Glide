// Glidna — Stripe billing v1 (Session 89): SIMPLE SUBSCRIPTIONS, no Connect.
// Kevin's calls (S89): both audiences pay (trainer plan + client premium),
// flat monthly pricing, premium locks at trial end while basics stay free.
// Stripe Connect revenue splits (sub 75 / head 10 / platform 15) are a LATER
// phase — this file deliberately doesn't touch them.
//
// FINAL PRICES (Kevin's S89c decision — see docs/PRICING.md + the decision sheet):
//   client  → Glidna Premium $14.99/mo · $119.99/yr   |  Glidna Max $29.99/mo · $299.99/yr
//   trainer → Glidna Coach   $49/mo    · $490/yr      |  Coach Max $79/mo    · $790/yr
// "Max" = the honest high-allowance tier (published ~100 AI conversations/day,
// enforced by the clientMax/trainerMax BUDGETS in aichat.js) — NEVER branded
// "unlimited" (Kevin's liability/honesty call, S89c). Products/prices are
// get-or-created BY LOOKUP KEY on first use; a changed amount mints a new
// price and MOVES the lookup key (transfer_lookup_key) — which is how the
// Premium $9.99 placeholder became $14.99 without dashboard surgery.
//
// SETUP (Kevin, one-time — functions won't deploy until the secrets exist):
//   1. Stripe dashboard → Developers → API keys → copy the TEST secret key.
//      printf 'sk_test_…' | firebase functions:secrets:set STRIPE_SECRET_KEY --data-file=-
//   2. Deploy, then Stripe dashboard → Developers → Webhooks → Add endpoint:
//      https://us-central1-calorieiq-29762.cloudfunctions.net/stripeWebhook
//      events: checkout.session.completed, customer.subscription.updated,
//              customer.subscription.deleted
//      → copy the signing secret (whsec_…):
//      printf 'whsec_…' | firebase functions:secrets:set STRIPE_WEBHOOK_SECRET --data-file=-
//      → redeploy stripeWebhook.
//   (Live mode later = replace both secrets with the live-mode values.)
//
// The webhook is the ONLY writer of subscriptionStatus — owner updates to the
// billing fields are blocked by firestore.rules (S85); the Admin SDK here
// bypasses rules by design. Everything else in the app keys off
// profile.subscriptionStatus === "active" (trialInfo/isPremium/isProUser).

const { onCall, onRequest, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");

const STRIPE_SECRET_KEY = defineSecret("STRIPE_SECRET_KEY");
const STRIPE_WEBHOOK_SECRET = defineSecret("STRIPE_WEBHOOK_SECRET");

// Where Checkout/Portal may send the user back to — same allowlist idea as
// functions/webauthn.js ALLOWED_ORIGINS. Add the custom domain here when it lands.
const ALLOWED_ORIGINS = [
  "https://glidna.com",
  "https://calorieiq-jet.vercel.app", // legacy origin — keep during transition
  "http://localhost:5173",
];
// Billing-portal configuration id (bpc_…) from the live-setup script — enables
// self-serve plan switching + cancel-at-period-end. Empty string = default config.
const PORTAL_CONFIG_ID = "bpc_1Tr5VXPNvdBWM053fFHIYzYY"; // live-mode config (S90)
const safeOrigin = (o) => (ALLOWED_ORIGINS.includes(o) ? o : ALLOWED_ORIGINS[0]);

// The catalog. `key` builds lookup keys (glide_{key}_monthly / _annual);
// `tier` is what the webhook stores on profile.subscriptionTier (the *Max
// budget in aichat.js keys off it). Amounts in cents.
const CATALOG = {
  premium:   { key: "premium",   tier: "premium",   name: "Glidna Premium",   month: 1499, year: 11999 },
  max:       { key: "max",       tier: "max",       name: "Glidna Max",       month: 2999, year: 29999 },
  coach:     { key: "coach",     tier: "coach",     name: "Glidna Coach",     month: 4900, year: 49000 },
  coach_max: { key: "coach_max", tier: "coach_max", name: "Glidna Coach Max", month: 7900, year: 79000 },
};
// Role + wants-Max → plan. Trainers (head or sub) buy coach plans; clients premium.
function planFor(role, wantMax) {
  const isTrainer = role === "head_trainer" || role === "sub_trainer" || role === "admin";
  if (isTrainer) return wantMax ? CATALOG.coach_max : CATALOG.coach;
  return wantMax ? CATALOG.max : CATALOG.premium;
}

// Lazy Stripe client (the secret only exists at runtime).
let stripeClient = null;
function stripe() {
  if (!stripeClient) stripeClient = require("stripe")(STRIPE_SECRET_KEY.value());
  return stripeClient;
}

// Get-or-create the recurring price for a plan + interval, by lookup key.
// Self-healing: if the price exists but the amount is stale (a price change in
// CATALOG), a fresh price is minted and the lookup key transfers to it —
// existing subscribers keep their old price; new checkouts get the new one.
// Cached per instance so repeat checkouts don't re-query Stripe.
const priceCache = {};
const productOf = (price) => (typeof price.product === "string" ? price.product : price.product.id);
async function ensurePrice(plan, interval) {
  const lk = `glide_${plan.key}_${interval === "year" ? "annual" : "monthly"}`;
  const cents = interval === "year" ? plan.year : plan.month;
  if (priceCache[lk]) return priceCache[lk];
  const found = await stripe().prices.list({ lookup_keys: [lk], active: true, limit: 1 });
  if (found.data.length) {
    const p = found.data[0];
    if (p.unit_amount === cents && p.recurring && p.recurring.interval === interval) {
      return (priceCache[lk] = p.id);
    }
    const np = await stripe().prices.create({
      product: productOf(p), currency: "usd", unit_amount: cents,
      recurring: { interval }, lookup_key: lk, transfer_lookup_key: true,
    });
    return (priceCache[lk] = np.id);
  }
  // No price for this interval yet — hang it on the sibling interval's product
  // when one exists (one Stripe product per plan, two prices), else create the
  // product now.
  const sibLk = `glide_${plan.key}_${interval === "year" ? "monthly" : "annual"}`;
  const sib = await stripe().prices.list({ lookup_keys: [sibLk], active: true, limit: 1 });
  const productId = sib.data.length
    ? productOf(sib.data[0])
    : (await stripe().products.create({ name: plan.name })).id;
  const price = await stripe().prices.create({
    product: productId, currency: "usd", unit_amount: cents,
    recurring: { interval }, lookup_key: lk,
  });
  return (priceCache[lk] = price.id);
}

// ── Checkout: start a subscription for the signed-in user's role ────────────
exports.createCheckoutSession = onCall(
  { secrets: [STRIPE_SECRET_KEY], region: "us-central1", maxInstances: 10 },
  async (request) => {
    const uid = request.auth && request.auth.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Sign in to upgrade.");
    const db = admin.firestore();
    const profile = (await db.doc(`users/${uid}`).get()).data() || {};
    if (profile.subscriptionStatus === "active") {
      throw new HttpsError("failed-precondition", "You already have an active subscription.");
    }
    // The caller picks WHICH of their role's plans (base vs max) and the
    // billing interval — never the price. Anything unexpected falls back to
    // the base monthly plan.
    const sel = (request.data && request.data.plan) || {};
    const wantMax = sel.tier === "max";
    const interval = sel.interval === "year" ? "year" : "month";
    const plan = planFor(profile.role, wantMax);
    const origin = safeOrigin(String((request.data && request.data.origin) || ""));
    // Reverse trial (S92): if the user is still inside their free trial, don't
    // charge until it ends — honor the promised free days even when they add a
    // card early. Past expiry → no trial_end → billed now. Stripe needs
    // trial_end ≥ ~48h out, so only set it when real time remains.
    let trialEnd = null;
    const t = profile.trialStartedAt;
    const startMs = t && typeof t.toMillis === "function" ? t.toMillis()
      : typeof t === "number" ? t : null;
    if (startMs) {
      const endMs = startMs + (profile.trialLengthDays || 30) * 86400000;
      if (endMs - Date.now() > 2 * 86400000) trialEnd = Math.floor(endMs / 1000);
    }
    try {
      const price = await ensurePrice(plan, interval);
      const session = await stripe().checkout.sessions.create({
        mode: "subscription",
        line_items: [{ price, quantity: 1 }],
        client_reference_id: uid,
        // Reuse the Stripe customer on re-subscribe; else let Checkout create
        // one (webhook stores it on the profile).
        ...(profile.stripeCustomerId ? { customer: profile.stripeCustomerId }
          : profile.email ? { customer_email: profile.email } : {}),
        // tier rides BOTH the session and the subscription so every webhook
        // event can stamp profile.subscriptionTier (drives the Max AI budget).
        metadata: { uid, tier: plan.tier },
        subscription_data: { metadata: { uid, tier: plan.tier },
          ...(trialEnd ? { trial_end: trialEnd } : {}) },
        allow_promotion_codes: true,
        success_url: `${origin}/?billing=success`,
        cancel_url: `${origin}/?billing=cancelled`,
      });
      return { url: session.url };
    } catch (e) {
      console.error("createCheckoutSession error:", e && e.message);
      throw new HttpsError("internal", "Couldn't start checkout. Please try again.");
    }
  }
);

// ── Portal: manage / cancel an existing subscription ────────────────────────
exports.createPortalSession = onCall(
  { secrets: [STRIPE_SECRET_KEY], region: "us-central1", maxInstances: 10 },
  async (request) => {
    const uid = request.auth && request.auth.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Sign in first.");
    const db = admin.firestore();
    const profile = (await db.doc(`users/${uid}`).get()).data() || {};
    if (!profile.stripeCustomerId) {
      throw new HttpsError("failed-precondition", "No subscription found for this account.");
    }
    const origin = safeOrigin(String((request.data && request.data.origin) || ""));
    try {
      const session = await stripe().billingPortal.sessions.create({
        customer: profile.stripeCustomerId, return_url: `${origin}/`,
        // Kevin's fairness call (S90): explicit portal configuration with
        // self-serve plan switching (upgrades prorated NOW, downgrades at
        // period end) + cancel at period end. Created by the live-setup
        // script; empty = Stripe's default config (pre-live behavior).
        ...(PORTAL_CONFIG_ID ? { configuration: PORTAL_CONFIG_ID } : {}),
      });
      return { url: session.url };
    } catch (e) {
      console.error("createPortalSession error:", e && e.message);
      throw new HttpsError("internal", "Couldn't open the billing portal. Please try again.");
    }
  }
);

// ── Webhook: Stripe → profile.subscriptionStatus ─────────────────────────────
// Signature-verified (raw body). Resolves the Glidna uid from
// client_reference_id (checkout) or subscription.metadata.uid, with a
// stripeCustomerId profile query as the fallback.
async function uidForCustomer(db, customerId) {
  if (!customerId) return null;
  const snap = await db.collection("users").where("stripeCustomerId", "==", customerId).limit(1).get();
  return snap.empty ? null : snap.docs[0].id;
}

exports.stripeWebhook = onRequest(
  { secrets: [STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET], region: "us-central1", maxInstances: 5 },
  async (req, res) => {
    let event;
    try {
      event = stripe().webhooks.constructEvent(
        req.rawBody, req.headers["stripe-signature"], STRIPE_WEBHOOK_SECRET.value());
    } catch (e) {
      console.error("stripeWebhook bad signature:", e && e.message);
      res.status(400).send("bad signature");
      return;
    }
    const db = admin.firestore();
    try {
      if (event.type === "checkout.session.completed") {
        const s = event.data.object;
        const uid = s.client_reference_id;
        if (uid) {
          await db.doc(`users/${uid}`).set({
            subscriptionStatus: "active",
            // Which plan they bought (premium|max|coach|coach_max) — the *Max
            // tiers unlock the high AI budgets in aichat.js tierFor().
            subscriptionTier: (s.metadata && s.metadata.tier) || "premium",
            stripeCustomerId: s.customer || null,
            stripeSubscriptionId: s.subscription || null,
          }, { merge: true });
          console.log("stripeWebhook: activated", uid, (s.metadata && s.metadata.tier) || "");
        }
      } else if (event.type === "customer.subscription.updated"
        || event.type === "customer.subscription.deleted") {
        const sub = event.data.object;
        const uid = (sub.metadata && sub.metadata.uid) || (await uidForCustomer(db, sub.customer));
        if (uid) {
          // active/trialing (and past_due, as grace) keep access; a deleted or
          // truly lapsed subscription drops back to "canceled" — trialInfo()
          // then shows the expired state and the premium gate locks.
          const keep = event.type !== "customer.subscription.deleted"
            && ["active", "trialing", "past_due"].includes(sub.status);
          const update = { subscriptionStatus: keep ? "active" : "canceled" };
          if (keep && sub.metadata && sub.metadata.tier) update.subscriptionTier = sub.metadata.tier;
          if (!keep) update.subscriptionTier = admin.firestore.FieldValue.delete();
          await db.doc(`users/${uid}`).set(update, { merge: true });
          console.log("stripeWebhook:", event.type, uid, "→", keep ? "active" : "canceled");
        } else {
          console.error("stripeWebhook: no uid for customer", sub.customer);
        }
      }
      res.status(200).send("ok");
    } catch (e) {
      console.error("stripeWebhook handler error:", e && e.message);
      res.status(500).send("handler error");
    }
  }
);
