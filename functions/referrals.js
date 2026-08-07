// Glidna — referral rewards (S181). Kevin's design, with the S180 safety rule.
//
// Anyone — client or trainer — can share a link. When someone signs up through
// it AND STARTS PAYING, the referrer earns account credit.
//
// ── THE RULE THAT KEEPS THIS SOLVENT (docs/PRICING.md S180) ──────────────────
// A reward may never exceed ONE MONTH of the net recurring revenue the
// referrals actually generate. Kevin: "we don't wanna lose money giving away
// months." Checking every combination found exactly one that failed — a
// Premium referrer bringing 3 Connect clients would have been given $28.52
// against $14.24/mo earned, a two-month payback that goes underwater the moment
// one of them churns. So the reward is COMPUTED from what was really referred
// rather than promised as a flat "2 or 3 months", and capped at one month of it.
//
// ── VESTING ─────────────────────────────────────────────────────────────────
// Credit is earned only when a referred subscription is genuinely PAID and
// ACTIVE (Kevin: "if they send 15 referrals and two have paid, they wait for
// the third"). A signup alone earns nothing, so fake accounts cost the faker
// real money to no benefit. Churn is handled honestly too: the ledger records
// what was earned at grant time and does not claw back, but a lapsed referral
// stops counting toward FUTURE rewards.
//
// ── CREDIT, NOT CASH ────────────────────────────────────────────────────────
// The reward is a Stripe customer-balance credit, which automatically reduces
// the next invoice(s). That covers both of Kevin's cases with one mechanism:
// stay on your plan and the credit pays for months of it, or upgrade and the
// same credit is simply consumed faster against the bigger invoice.
//
// ⚖️ Deliberately NOT built: ongoing cash payouts as a share of referred spend.
// That is an affiliate program (tax reporting, 1099s, state rules) and needs
// counsel before a line of it is written. See docs/PRICING.md S179i.

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");

const REGION = "us-central1";

// Net monthly revenue per tier, after Stripe's 2.9% + 30c. These are what the
// reward is measured against — never list price, or we would over-grant by the
// processing fee on every single referral.
const NET_MONTHLY = {
  connect: 4.55, premium: 14.26, max: 28.82, ultra: 48.24,
  coach_connect: 19.11, coach: 47.28, coach_max: 76.41, coach_ultra: 124.96,
};
// What a month of the REFERRER's own plan is worth to us — the unit we give.
const OWN_MONTH = { ...NET_MONTHLY };

const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";   // no O/0/I/1/L
const CODE_LEN = 7;
// A referral must be paid-and-active this long before it counts. Long enough
// that a sign-up-then-cancel cannot mint credit, short enough to feel fair.
const VEST_DAYS = 30;
// Backstop against an account farming rewards indefinitely.
const MAX_CREDIT_PER_YEAR = 300;

const norm = (s) => String(s || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
const toMs = (v) => (v && typeof v.toMillis === "function" ? v.toMillis()
  : typeof v === "number" ? v : (typeof v === "string" ? Date.parse(v) : null));
const money = (n) => Math.round(n * 100) / 100;

function tierOf(profile) {
  const t = String((profile && profile.subscriptionTier) || "").toLowerCase();
  if (!t) return null;
  if (t.includes("coach")) {
    if (t.includes("connect")) return "coach_connect";   // connect BEFORE coach — substring hazard
    if (t.includes("ultra")) return "coach_ultra";
    if (t.includes("max")) return "coach_max";
    return "coach";
  }
  if (t.includes("connect")) return "connect";
  if (t.includes("ultra")) return "ultra";
  if (t.includes("max")) return "max";
  return "premium";
}

// ── the referrer's own share code ───────────────────────────────────────────
async function ensureCode(db, uid) {
  const ref = db.doc(`users/${uid}`);
  const prof = (await ref.get()).data() || {};
  if (prof.referralCode) return prof.referralCode;
  for (let attempt = 0; attempt < 6; attempt++) {
    let code = "";
    for (let i = 0; i < CODE_LEN; i++) code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    const taken = await db.doc(`referralCodes/${code}`).get();
    if (taken.exists) continue;
    await db.doc(`referralCodes/${code}`).set({ uid, createdAt: Date.now() });
    await ref.set({ referralCode: code }, { merge: true });
    return code;
  }
  throw new HttpsError("internal", "Couldn't create a referral code — please try again.");
}

exports.myReferralCode = onCall({ region: REGION, maxInstances: 10 }, async (request) => {
  const uid = request.auth && request.auth.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Please sign in.");
  const code = await ensureCode(admin.firestore(), uid);
  return { code };
});

// ── attribution: called once, at signup, from the client ────────────────────
// Writes a referral row ONLY if this user has never had one. Self-referral and
// unknown codes are silently ignored — a bad link should never block a signup.
exports.claimReferral = onCall({ region: REGION, maxInstances: 10 }, async (request) => {
  const uid = request.auth && request.auth.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Please sign in.");
  const code = norm(request.data && request.data.code);
  if (!code) return { ok: false, reason: "no-code" };
  const db = admin.firestore();

  const existing = await db.doc(`referrals/${uid}`).get();
  if (existing.exists) return { ok: false, reason: "already-attributed" };

  const codeSnap = await db.doc(`referralCodes/${code}`).get();
  const referrerUid = codeSnap.exists ? codeSnap.data().uid : null;
  if (!referrerUid || referrerUid === uid) return { ok: false, reason: "invalid" };

  const me = (await db.doc(`users/${uid}`).get()).data() || {};
  const them = (await db.doc(`users/${referrerUid}`).get()).data() || {};
  await db.doc(`referrals/${uid}`).set({
    referrerUid, code,
    referredName: me.displayName || [me.firstName, me.lastName].filter(Boolean).join(" ") || "New member",
    referrerName: them.displayName || "",
    signedUpAt: Date.now(),
    status: "signed-up",        // signed-up → paying → vested (or lapsed)
    tier: null, activatedAt: null, vestedAt: null, creditedAt: null,
  });
  return { ok: true };
});

// ── called by the Stripe webhook when a subscription activates or lapses ────
// Never throws into the webhook: a referral bookkeeping failure must not cost
// us the billing event itself.
async function onSubscriptionChanged(db, uid, active, profile) {
  try {
    const ref = db.doc(`referrals/${uid}`);
    const snap = await ref.get();
    if (!snap.exists) return;
    const r = snap.data();
    if (active) {
      const patch = { tier: tierOf(profile), status: "paying" };
      if (!r.activatedAt) patch.activatedAt = Date.now();
      await ref.set(patch, { merge: true });
    } else {
      // Lapsed: stops counting toward future rewards. Anything already granted
      // is left alone — we do not claw back credit someone has been given.
      await ref.set({ status: "lapsed" }, { merge: true });
    }
  } catch (e) {
    console.error("referrals.onSubscriptionChanged", uid, e && e.message);
  }
}

// ── the tracker + the reward ────────────────────────────────────────────────
// One read of the caller's referrals, shaped for the screen: who signed up, who
// is paying, who has vested, what that is worth, and what is still owed.
async function summarize(db, uid) {
  const [rowsSnap, meSnap, ledgerSnap] = await Promise.all([
    db.collection("referrals").where("referrerUid", "==", uid).limit(200).get(),
    db.doc(`users/${uid}`).get(),
    db.doc(`users/${uid}/referralLedger/summary`).get(),
  ]);
  const me = meSnap.data() || {};
  const ledger = ledgerSnap.data() || { granted: 0, grantedThisYear: 0, year: new Date().getUTCFullYear() };
  const now = Date.now();

  const people = [];
  let vestedNet = 0;         // net monthly revenue from referrals that have vested
  let payingNotVested = 0;
  rowsSnap.forEach((d) => {
    const r = d.data();
    const tier = r.tier || null;
    const net = tier ? (NET_MONTHLY[tier] || 0) : 0;
    const vested = r.status === "paying" && r.activatedAt && (now - r.activatedAt) >= VEST_DAYS * 86400000;
    if (vested) vestedNet += net;
    else if (r.status === "paying") payingNotVested += 1;
    people.push({
      name: r.referredName || "New member",
      status: r.status === "paying" ? (vested ? "vested" : "paying") : r.status,
      tier, net: money(net),
      daysToVest: r.status === "paying" && r.activatedAt && !vested
        ? Math.max(1, Math.ceil((VEST_DAYS * 86400000 - (now - r.activatedAt)) / 86400000)) : null,
    });
  });

  // THE RULE: never more than one month of what the referrals actually earn us.
  const ownMonth = OWN_MONTH[tierOf(me)] || OWN_MONTH.premium;
  const yearNow = new Date().getUTCFullYear();
  const grantedThisYear = ledger.year === yearNow ? (ledger.grantedThisYear || 0) : 0;
  const roomThisYear = Math.max(0, MAX_CREDIT_PER_YEAR - grantedThisYear);
  const earnable = money(Math.min(vestedNet, roomThisYear));
  const available = money(Math.max(0, earnable - (ledger.granted || 0)));
  const monthsCovered = ownMonth > 0 ? Math.floor(available / ownMonth) : 0;

  return {
    code: me.referralCode || null,
    people: people.sort((a, b) => (a.status === "vested" ? -1 : 1)),
    counts: {
      total: people.length,
      signedUp: people.filter((p) => p.status === "signed-up").length,
      paying: payingNotVested,
      vested: people.filter((p) => p.status === "vested").length,
    },
    available, monthsCovered, ownMonth: money(ownMonth),
    upgrade: (() => { const p = UPGRADE_PATHS[tierOf(me)];
      return p ? { label: p.label, cost: p.cost, affordable: available >= p.cost } : null; })(),
    rewardTier: me.rewardTier && me.rewardTierUntil && Date.now() < toMs(me.rewardTierUntil)
      ? { tier: me.rewardTier, until: toMs(me.rewardTierUntil) } : null,
    alreadyGranted: money(ledger.granted || 0),
    vestDays: VEST_DAYS,
  };
}

exports.myReferrals = onCall({ region: REGION, maxInstances: 10 }, async (request) => {
  const uid = request.auth && request.auth.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Please sign in.");
  const db = admin.firestore();
  await ensureCode(db, uid);
  return summarize(db, uid);
});

// Claim what has vested. Applies it as Stripe customer-balance credit, which
// reduces upcoming invoices automatically — so it works whether they stay on
// their plan or upgrade (an upgrade just consumes it faster).
// The upgrade a reward can buy, per audience. Priced at the DIFFERENCE between
// the tiers, because that is what we actually forgo by lifting someone for a
// month — charging them the full higher price would be double-counting the
// plan they are already paying for.
const UPGRADE_PATHS = {
  premium: { to: "max", label: "Elite", cost: money(NET_MONTHLY.max - NET_MONTHLY.premium) },
  connect: { to: "premium", label: "Premium", cost: money(NET_MONTHLY.premium - NET_MONTHLY.connect) },
  max: { to: "ultra", label: "Apex", cost: money(NET_MONTHLY.ultra - NET_MONTHLY.max) },
  coach: { to: "coach_max", label: "Coach Elite", cost: money(NET_MONTHLY.coach_max - NET_MONTHLY.coach) },
  coach_connect: { to: "coach", label: "Coach", cost: money(NET_MONTHLY.coach - NET_MONTHLY.coach_connect) },
  coach_max: { to: "coach_ultra", label: "Coach Apex", cost: money(NET_MONTHLY.coach_ultra - NET_MONTHLY.coach_max) },
};

exports.claimReferralCredit = onCall({ region: REGION, secrets: ["STRIPE_SECRET_KEY", "STRIPE_SECRET_KEY_TEST"], maxInstances: 5 },
  async (request) => {
    const uid = request.auth && request.auth.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Please sign in.");
    const db = admin.firestore();
    const s = await summarize(db, uid);
    const choice = String((request.data && request.data.choice) || "credit");
    if (s.available <= 0) {
      throw new HttpsError("failed-precondition",
        "Nothing to claim yet — credit unlocks once a referral has been subscribed for "
        + `${VEST_DAYS} days.`);
    }
    const me = (await db.doc(`users/${uid}`).get()).data() || {};

    // ── Complimentary upgrade ────────────────────────────────────────────
    // Granted as OUR entitlement with an expiry, deliberately NOT as a Stripe
    // subscription schedule. A schedule would have to swap their price and
    // swap it back, and a revert that fails to fire silently charges someone
    // the higher rate — the worst kind of billing bug. This just lapses.
    if (choice === "upgrade") {
      const myTier = tierOf(me);
      const path = myTier ? UPGRADE_PATHS[myTier] : null;
      if (!path) {
        // Two different situations wearing one message before this: someone on
        // the top tier, and someone with no subscription at all. Telling a
        // non-subscriber they're "on the top plan" is nonsense.
        throw new HttpsError("failed-precondition", myTier
          ? "You're already on the top plan — take the credit instead and it'll come off your next invoice."
          : "Start a subscription first, then a reward can upgrade you for a month — or take it as credit once you're on a plan.");
      }
      if (s.available < path.cost) {
        throw new HttpsError("failed-precondition",
          `A month of ${path.label} needs $${path.cost.toFixed(2)} of credit — you have $${s.available.toFixed(2)}.`);
      }
      const until = Date.now() + 30 * 86400000;
      await db.doc(`users/${uid}`).set({ rewardTier: path.to, rewardTierUntil: until }, { merge: true });
      const yearNow = new Date().getUTCFullYear();
      const prev0 = (await db.doc(`users/${uid}/referralLedger/summary`).get()).data() || {};
      await db.doc(`users/${uid}/referralLedger/summary`).set({
        granted: money((prev0.granted || 0) + path.cost),
        grantedThisYear: money((prev0.year === yearNow ? (prev0.grantedThisYear || 0) : 0) + path.cost),
        year: yearNow, lastGrantAt: Date.now(),
      }, { merge: true });
      return { ok: true, mode: "upgrade", tier: path.to, label: path.label, until, spent: path.cost };
    }

    if (!me.stripeCustomerId) {
      throw new HttpsError("failed-precondition",
        "Start a subscription first — credit is applied against your own plan.");
    }
    // S182: use the key matching the customer's Stripe MODE. The webhook stamps
    // stripeLivemode when it first records the customer; a test customer read
    // with the live key 404s and reads as "customer missing", which is a
    // genuinely confusing way to fail. Defaults to live when unstamped, so
    // every existing account is unaffected.
    const useTest = me.stripeLivemode === false && process.env.STRIPE_SECRET_KEY_TEST;
    const stripe = require("stripe")(useTest ? process.env.STRIPE_SECRET_KEY_TEST : process.env.STRIPE_SECRET_KEY);
    // Negative balance = credit in Stripe's model.
    await stripe.customers.createBalanceTransaction(me.stripeCustomerId, {
      amount: -Math.round(s.available * 100),
      currency: "usd",
      description: `Glidna referral credit (${s.counts.vested} referral${s.counts.vested === 1 ? "" : "s"})`,
    });
    const yearNow = new Date().getUTCFullYear();
    const prev = (await db.doc(`users/${uid}/referralLedger/summary`).get()).data() || {};
    await db.doc(`users/${uid}/referralLedger/summary`).set({
      granted: money((prev.granted || 0) + s.available),
      grantedThisYear: money((prev.year === yearNow ? (prev.grantedThisYear || 0) : 0) + s.available),
      year: yearNow,
      lastGrantAt: Date.now(),
    }, { merge: true });
    return { ok: true, credited: s.available, monthsCovered: s.monthsCovered };
  });

module.exports.onSubscriptionChanged = onSubscriptionChanged;
module.exports.NET_MONTHLY = NET_MONTHLY;
module.exports.VEST_DAYS = VEST_DAYS;

// ── Admin-only test hook (S181b) ────────────────────────────────────────────
// The vest check uses OUR wall clock, so a Stripe test clock alone can't
// rehearse the full chain — advancing Stripe's time doesn't move ours. This
// back-dates a referral's activation so an admin can walk
// signup → paying → vested → claim → Stripe credit in one sitting, in TEST
// MODE, without touching the real 30-day rule.
const ADMIN_UIDS = ["G7QUZ8Kat1fgyoMjdGKz4DYoVHi1"];
exports.testVestReferral = onCall({ region: REGION, maxInstances: 2 }, async (request) => {
  const uid = request.auth && request.auth.uid;
  if (!uid || !ADMIN_UIDS.includes(uid)) throw new HttpsError("permission-denied", "Admin only.");
  const target = String((request.data && request.data.referredUid) || "").trim();
  if (!target) throw new HttpsError("invalid-argument", "referredUid is required.");
  const db = admin.firestore();
  const ref = db.doc(`referrals/${target}`);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "No referral row for that user.");
  await ref.set({
    status: "paying",
    tier: String((request.data && request.data.tier) || snap.data().tier || "premium"),
    activatedAt: Date.now() - (VEST_DAYS + 1) * 86400000,   // back-dated past the vest
  }, { merge: true });
  return { ok: true, note: `Back-dated past the ${VEST_DAYS}-day vest — claim should now be available.` };
});
