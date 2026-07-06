// Glide — Stripe billing v1 (Session 89): SIMPLE SUBSCRIPTIONS, no Connect.
// Kevin's calls (S89): both audiences pay (trainer plan + client premium),
// flat monthly pricing, premium locks at trial end while basics stay free.
// Stripe Connect revenue splits (sub 75 / head 10 / platform 15) are a LATER
// phase — this file deliberately doesn't touch them.
//
// PLACEHOLDER PRICES (test mode — Kevin confirms real numbers before live):
//   head_trainer / sub_trainer → "Glide Coach"   $49/mo flat
//   client                     → "Glide Premium" $9.99/mo
// Products/prices are get-or-created BY LOOKUP KEY on first use, so no manual
// Stripe-dashboard setup is needed; changing a price later = create a new
// price with the same lookup_key (transfer_lookup_key) or edit PRICE_CENTS.
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
  "https://calorieiq-jet.vercel.app",
  "http://localhost:5173",
];
const safeOrigin = (o) => (ALLOWED_ORIGINS.includes(o) ? o : ALLOWED_ORIGINS[0]);

// Role → plan. Trainers (head or sub) get the coach plan; clients get premium.
const PLANS = {
  trainer: { lookupKey: "glide_coach_monthly", name: "Glide Coach", cents: 4900 },
  client: { lookupKey: "glide_premium_monthly", name: "Glide Premium", cents: 999 },
};
const planFor = (role) =>
  role === "head_trainer" || role === "sub_trainer" || role === "admin" ? PLANS.trainer : PLANS.client;

// Lazy Stripe client (the secret only exists at runtime).
let stripeClient = null;
function stripe() {
  if (!stripeClient) stripeClient = require("stripe")(STRIPE_SECRET_KEY.value());
  return stripeClient;
}

// Get-or-create the recurring price for a plan, by lookup key. Cached per
// instance so repeat checkouts don't re-query Stripe.
const priceCache = {};
async function ensurePrice(plan) {
  if (priceCache[plan.lookupKey]) return priceCache[plan.lookupKey];
  const found = await stripe().prices.list({ lookup_keys: [plan.lookupKey], active: true, limit: 1 });
  if (found.data.length) return (priceCache[plan.lookupKey] = found.data[0].id);
  const product = await stripe().products.create({ name: plan.name });
  const price = await stripe().prices.create({
    product: product.id, currency: "usd", unit_amount: plan.cents,
    recurring: { interval: "month" }, lookup_key: plan.lookupKey,
  });
  return (priceCache[plan.lookupKey] = price.id);
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
    const plan = planFor(profile.role);
    const origin = safeOrigin(String((request.data && request.data.origin) || ""));
    try {
      const price = await ensurePrice(plan);
      const session = await stripe().checkout.sessions.create({
        mode: "subscription",
        line_items: [{ price, quantity: 1 }],
        client_reference_id: uid,
        // Reuse the Stripe customer on re-subscribe; else let Checkout create
        // one (webhook stores it on the profile).
        ...(profile.stripeCustomerId ? { customer: profile.stripeCustomerId }
          : profile.email ? { customer_email: profile.email } : {}),
        subscription_data: { metadata: { uid } },
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
      });
      return { url: session.url };
    } catch (e) {
      console.error("createPortalSession error:", e && e.message);
      throw new HttpsError("internal", "Couldn't open the billing portal. Please try again.");
    }
  }
);

// ── Webhook: Stripe → profile.subscriptionStatus ─────────────────────────────
// Signature-verified (raw body). Resolves the Glide uid from
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
            stripeCustomerId: s.customer || null,
            stripeSubscriptionId: s.subscription || null,
          }, { merge: true });
          console.log("stripeWebhook: activated", uid);
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
          await db.doc(`users/${uid}`).set({
            subscriptionStatus: keep ? "active" : "canceled",
          }, { merge: true });
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
