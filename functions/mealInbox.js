// Send a meal photo to Glidna from an iPhone Shortcut (S222).
//
// WHY THIS EXISTS. S221 put Glidna in the phone's share sheet, which Android
// honours and Apple does not: Safari lets a web app SEND to the share sheet but
// never RECEIVE from it. Shortcuts is the only route into an iOS device's photo
// flow that does not require Apple's permission, and a Shortcut can POST — so
// the photo comes to us instead of us reaching for it.
//
// ⚠️ A SHORTCUT CANNOT SIGN IN. It has no Firebase session, cannot send an ID
// token, and cannot be asked to. So the URL carries the credential, exactly as
// the calendar feed's does (S187) and for exactly the same reason. That design
// is copied deliberately: 160 random bits, the uid narrowing the lookup while
// the TOKEN decides access, a timing-safe compare, and a reset that kills the
// old link instantly.
//
// ⚠️ BUT THIS TOKEN WRITES, AND THE CALENDAR'S ONLY READS. That difference is
// the whole security design here. A leaked calendar URL exposes session times;
// a leaked write endpoint could put food in somebody's log, and Shortcuts get
// shared between people far more casually than calendar subscriptions do. So:
//
//   THIS ENDPOINT CANNOT LOG A MEAL. It parks a photo, nothing more. The
//   estimate and the logging still happen in the app, behind the same
//   confirm-before-write card every other meal goes through (S68). The worst a
//   stolen link can do is leave junk photos the owner declines — annoying, not
//   corrupting, and never a wrong number in someone's history.
//
//   IT ALSO SPENDS NO AI. Running an estimate here would let a leaked link burn
//   the owner's daily allowance while they slept.
//
// ⚠️ THE PHOTO ARRIVES ALREADY SMALL, BY DESIGN. Shortcuts has a Resize Image
// action, so the recipe shrinks to 1024px before sending. That matters because
// there is no image library in this runtime — accepting a 5MB original would
// mean either shipping one or storing it whole, and a base64 image has to fit
// inside a 1MB Firestore document.
const { onRequest, onCall, HttpsError } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const crypto = require("crypto");

if (!admin.apps.length) admin.initializeApp();

const REGION = "us-central1";
const PUBLIC_BASE = `https://${REGION}-calorieiq-29762.cloudfunctions.net/mealInbox`;

// Raw bytes. base64 inflates by 4/3, so 500KB in is ~667KB stored — comfortably
// inside Firestore's 1MB document limit with the wrapper on top. A 1024px JPEG
// is typically 100–250KB, so this is generous rather than tight.
const MAX_BYTES = 500 * 1024;
const MAX_PER_DAY = 50;     // a rate limit, not a product cap
const MAX_PENDING = 20;     // matches the chat's photos-per-message ceiling

const INBOX_PREFIX = "caliq-inbox-";

// ⚠️ THE TOKEN DOES NOT LIVE ON THE PROFILE, AND THAT IS NOT A STYLE CHOICE.
// firestore.rules makes TRAINER profiles a readable directory — any signed-in
// user may read any head_trainer/sub_trainer document, because a client has to
// resolve a trainer at join time (S59). Firestore read rules are per-DOCUMENT:
// there is no way to expose a profile and hide one field of it. A token written
// to users/{uid} would therefore be readable by every signed-in account, and
// anyone could POST photos into any trainer's food log.
//
// So it lives in its own top-level collection with NO rules block at all, which
// Firestore denies by default — the same Admin-SDK-only pattern trainerizeCreds
// and webauthnCreds already use for credentials.
const TOKENS = "mealInboxTokens";

const kvRef = (db, uid, key) =>
  db.doc(`users/${uid}/kv/${encodeURIComponent(key)}`);

// ⚠️ {k, value} WITH value AS A JSON STRING. src/storage.js stores `value`
// VERBATIM and every app caller hands it a stringified object; a native object
// written here would read back as the wrong shape and the app would show an
// empty inbox with nothing in the logs to say why.
async function kvPut(db, uid, key, obj) {
  await kvRef(db, uid, key).set({ k: key, value: JSON.stringify(obj) });
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

// ── the endpoint the Shortcut posts to ──────────────────────────────────────
exports.mealInbox = onRequest(
  { region: REGION, maxInstances: 10, cors: false },
  async (req, res) => {
    res.set("X-Robots-Tag", "noindex, nofollow");
    res.set("Cache-Control", "no-store");
    if (req.method !== "POST") { res.status(405).send("Send a photo with POST."); return; }

    const uid = String(req.query.u || "").slice(0, 128);
    const token = String(req.query.t || "").slice(0, 128);
    if (!uid || !token) { res.status(400).send("Missing photo key."); return; }

    const db = admin.firestore();
    let rec = null;
    try { rec = (await db.doc(`${TOKENS}/${uid}`).get()).data(); } catch { rec = null; }
    const expected = rec && rec.token;
    // Equal lengths first so timingSafeEqual gets equal-length buffers, then the
    // constant-time compare. This URL is a bearer credential.
    const ok = !!expected && expected.length === token.length
      && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(token));
    if (!ok) { res.status(403).send("This photo link is no longer valid."); return; }

    const type = String(req.get("content-type") || "").split(";")[0].trim().toLowerCase();
    if (!type.startsWith("image/")) {
      res.status(415).send("That wasn't a photo. Set the Shortcut's request body to File.");
      return;
    }
    const body = req.rawBody;
    if (!body || !body.length) { res.status(400).send("The photo was empty."); return; }
    if (body.length > MAX_BYTES) {
      res.status(413).send(`That photo is ${Math.round(body.length / 1024)}KB. Add a Resize Image step (1024px) before the request.`);
      return;
    }

    // Rate limit, same shape as sendInvite's (S85). Cheap, per-day, and it
    // bounds what a leaked link can cost in writes.
    const usageRef = db.doc(`users/${uid}/mealInboxUsage/${today()}`);
    try {
      const n = await db.runTransaction(async (tx) => {
        const cur = (await tx.get(usageRef)).data() || {};
        const used = Number(cur.count) || 0;
        if (used >= MAX_PER_DAY) return -1;
        tx.set(usageRef, { count: used + 1, at: Date.now() }, { merge: true });
        return used + 1;
      });
      if (n < 0) { res.status(429).send("That's a lot of photos today. Try again tomorrow."); return; }
    } catch (e) {
      console.error("mealInbox usage error:", e && e.message);
      // A counter failure must not block a real person's lunch.
    }

    // Don't let the inbox grow without bound — a Shortcut automation misfiring
    // in a loop would otherwise fill the account with photos nobody asked for.
    try {
      // \u26a0\ufe0f TWO TRAPS MEET ON THE UPPER BOUND, AND I HIT BOTH WRITING IT.
      // First: it must differ from the lower bound. A first draft had them
      // equal, which matches only the bare prefix and would have reported an
      // empty inbox forever while the build passed.
      // Second: "\uf8ff" must stay ESCAPED in source. A raw pasted character
      // silently became an empty string once (S85) and made a prefix query
      // return nothing \u2014 and it reads identically in a diff either way.
      const existing = await db.collection(`users/${uid}/kv`)
        .where("k", ">=", INBOX_PREFIX)
        .where("k", "<=", `${INBOX_PREFIX}\uf8ff`)
        .limit(MAX_PENDING + 1)
        .get();
      if (existing.size > MAX_PENDING) {
        res.status(409).send(`You already have ${MAX_PENDING} photos waiting in Glidna. Open the app and log them first.`);
        return;
      }
    } catch (e) {
      console.error("mealInbox pending-count error:", e && e.message);
    }

    const id = `${Date.now().toString(36)}${crypto.randomBytes(4).toString("hex")}`;
    try {
      await kvPut(db, uid, `${INBOX_PREFIX}${id}`, {
        id,
        dataUrl: `data:${type};base64,${body.toString("base64")}`,
        at: Date.now(),
        via: "shortcut",
      });
    } catch (e) {
      console.error("mealInbox write error:", e && e.message);
      res.status(500).send("Couldn't save that photo. Try again.");
      return;
    }
    res.status(200).send("Sent to Glidna. Open the app to log it.");
  }
);

// ── mint / rotate the link (signed in, from the app) ────────────────────────
exports.mealInboxLink = onCall(
  { region: REGION, maxInstances: 10 },
  async (request) => {
    const uid = request.auth && request.auth.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Please sign in.");
    const reset = !!(request.data && request.data.reset);
    const db = admin.firestore();
    const ref = db.doc(`${TOKENS}/${uid}`);
    const cur = (await ref.get()).data() || {};
    let token = cur.token;
    // ⚠️ ONLY MINTS WHEN THERE IS NOTHING, OR WHEN ASKED TO RESET. Minting on
    // every call would silently break the Shortcut the person already set up,
    // every time they opened the panel to look at it.
    if (!token || reset) {
      token = crypto.randomBytes(20).toString("hex");
      await ref.set({ uid, token, at: Date.now() }, { merge: true });
    }
    return { url: `${PUBLIC_BASE}?u=${encodeURIComponent(uid)}&t=${token}`, reset };
  }
);
