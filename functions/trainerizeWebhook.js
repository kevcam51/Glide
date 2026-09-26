// Trainerize webhooks — the receiving end (S238b).
//
// Trainerize can POST an event the moment something happens in Kevin's
// account: a client's message, a finished workout, a goal hit, a program
// changed. Its API team registers the address on request (there is no
// settings page; docs/TRAINERIZE-API.md §S238b). Kevin asked for every
// available event to be sent to https://glidna.com/hooks/trainerize, which
// vercel.json forwards here, the same way /mcp reaches its function.
//
// ⚠️ HALF A SECOND. Trainerize waits 500 ms for an answer and retries three
// times, so this only checks the sender and stores the event:
// trainerizeEvents/{event id}. Whatever acts on an event (the Workout
// Programmer, first) runs from there, never inside this request. A retry of an
// event already stored is acknowledged without a second copy.
//
// ⚠️ NEVER THE ONLY PATH (Kevin: "We need to always have a plan to make it work
// on our own if necessary"). Everything an event says can also be learned by
// asking Trainerize — trainerizeAutoSync already polls every 30 minutes — so a
// missed or late event delays something; it never loses it.
//
// Verification: every delivery carries the key Trainerize issued, in a
// TR-SecretKey header. Until Kevin sets the real one
// (`firebase functions:secrets:set TRAINERIZE_WEBHOOK_SECRET`, then a
// redeploy), the secret holds a random placeholder nobody knows, so every
// delivery is refused. Admin-SDK only: firestore.rules has no match for
// trainerizeEvents, so no browser can read or write it.

const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");
const crypto = require("crypto");

const TRAINERIZE_WEBHOOK_SECRET = defineSecret("TRAINERIZE_WEBHOOK_SECRET");

const COLLECTION = "trainerizeEvents";
// An event is a few hundred bytes; this is room for a hundred of them.
const MAX_BODY = 64 * 1024;
// The event's own id becomes the document id, which is what makes a retry a
// no-op. It must start with a letter or digit: Firestore refuses "." and ".."
// as ids, and a slash would open a subcollection.
const EVENT_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,119}$/;
const EVENT_TYPE = /^[A-Za-z][A-Za-z0-9_.]{0,63}$/;

// Equal lengths first: timingSafeEqual throws on unequal buffers, which would
// turn a wrong-length key into a 500 instead of a refusal. An empty expected
// key never matches, so a secret that was never set lets nothing in.
function keyMatches(expected, given) {
  const a = Buffer.from(String(expected || ""));
  const b = Buffer.from(String(given || ""));
  if (!a.length || a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// What Trainerize sent → what gets stored, or null when it isn't an event.
// `data` is stored as JSON text: Firestore refuses arrays inside arrays, and a
// payload shape Trainerize adds tomorrow must not turn every delivery into a
// 500 that only its retries would notice.
function eventFrom(body, now) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const id = typeof body.id === "string" ? body.id.trim() : "";
  const type = typeof body.eventType === "string" ? body.eventType.trim() : "";
  if (!EVENT_ID.test(id) || !EVENT_TYPE.test(type)) return null;
  const data = body.data && typeof body.data === "object" && !Array.isArray(body.data) ? body.data : {};
  const userID = Number(data.userID);
  const created = typeof body.created === "string" || typeof body.created === "number"
    ? String(body.created).slice(0, 40) : null;
  return {
    eventId: id, eventType: type, created,
    userID: Number.isInteger(userID) && userID > 0 ? userID : null,
    dataJson: JSON.stringify(data).slice(0, MAX_BODY),
    receivedAt: now, handled: false,
  };
}

async function handleWebhook(req, res, { db, secret, now = Date.now() }) {
  if (req.method !== "POST") { res.set("Allow", "POST"); res.status(405).send("POST only."); return; }
  if (!keyMatches(secret, req.get("tr-secretkey"))) { res.status(401).send("Unrecognised sender."); return; }
  if (req.rawBody && req.rawBody.length > MAX_BODY) { res.status(413).send("Too large."); return; }
  const ev = eventFrom(req.body, now);
  if (!ev) { res.status(400).send("Not a Trainerize event."); return; }
  try {
    await db.collection(COLLECTION).doc(ev.eventId).create(ev);
  } catch (e) {
    // ALREADY_EXISTS (gRPC code 6): Trainerize retrying an event we already
    // hold, usually because the first answer missed its half second.
    const dup = e && (e.code === 6 || e.code === "already-exists");
    if (!dup) {
      console.error("trainerizeWebhook: could not store", ev.eventType, e && e.code);
      res.status(500).send("Could not store the event.");
      return;
    }
  }
  res.status(200).json({ ok: true });
}

exports.trainerizeWebhook = onRequest(
  { secrets: [TRAINERIZE_WEBHOOK_SECRET], region: "us-central1", maxInstances: 10, timeoutSeconds: 10 },
  (req, res) => handleWebhook(req, res, { db: admin.firestore(), secret: TRAINERIZE_WEBHOOK_SECRET.value() }),
);

// For the suite.
exports._handleWebhook = handleWebhook;
exports._eventFrom = eventFrom;
exports._keyMatches = keyMatches;
exports.WEBHOOK_LIMITS = { COLLECTION, MAX_BODY };
