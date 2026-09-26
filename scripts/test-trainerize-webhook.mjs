// Trainerize webhooks — the receiving end (S238b, functions/trainerizeWebhook.js).
//
// The handler is RUN against fake requests, not pattern-matched: a key check
// replaced with `if (false)` has to go red here. What must hold:
//   • nothing is stored without the key Trainerize issued (and a key that was
//     never set lets nothing in);
//   • a retry of an event already stored is acknowledged, never stored twice;
//   • a body that isn't an event, or is too big, is refused and stores nothing;
//   • the route and the rules are wired the way the comments say.

import { createRequire } from "module";
import { readFileSync } from "fs";

const require = createRequire(import.meta.url);
const { _handleWebhook: handle, _eventFrom: eventFrom, _keyMatches: keyMatches, WEBHOOK_LIMITS } =
  require("../functions/trainerizeWebhook.js");

let fails = 0, checks = 0;
const ok = (cond, msg) => { checks++; if (!cond) { fails++; console.log("  ✗ " + msg); } };

const KEY = "k".repeat(40);
const fakeDb = ({ failWith = null } = {}) => {
  const docs = new Map();
  let writes = 0;
  return {
    docs, writes: () => writes,
    collection: (name) => ({
      doc: (id) => ({
        create: async (data) => {
          writes++;
          if (failWith) throw failWith;
          const key = `${name}/${id}`;
          if (docs.has(key)) { const e = new Error("exists"); e.code = 6; throw e; }
          docs.set(key, data);
        },
      }),
    }),
  };
};
const req = ({ method = "POST", key = KEY, body, raw } = {}) => ({
  method,
  // key: null means the header is absent (undefined would fall back to KEY).
  get: (h) => (h.toLowerCase() === "tr-secretkey" && key !== null ? key : undefined),
  body,
  rawBody: raw !== undefined ? raw : Buffer.from(JSON.stringify(body || {})),
});
const res = () => {
  const r = { statusCode: 0, body: null, headers: {} };
  r.set = (k, v) => { r.headers[k] = v; return r; };
  r.status = (c) => { r.statusCode = c; return r; };
  r.send = (b) => { r.body = b; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
};
const EVENT = { id: "evt_123abc", eventType: "dailyWorkout.completed", created: "2026-09-26T14:00:00Z",
  data: { userID: 21029731, dailyWorkoutID: 99, nested: [[1, 2], [3]] } };
const send = async (opts, db, secret = KEY) => { const r = res(); await handle(req(opts), r, { db, secret, now: 1000 }); return r; };

console.log("who may deliver");
{
  const db = fakeDb();
  ok((await send({ method: "GET", body: EVENT }, db)).statusCode === 405, "only POST is accepted");
  ok((await send({ key: null, body: EVENT }, db)).statusCode === 401, "no key: refused");
  ok((await send({ key: "x".repeat(40), body: EVENT }, db)).statusCode === 401, "a wrong key of the right length: refused");
  ok((await send({ key: "short", body: EVENT }, db)).statusCode === 401, "a wrong key of another length: refused, not a crash");
  ok((await send({ key: "", body: EVENT }, db, "")).statusCode === 401 && (await send({ key: null, body: EVENT }, db, null)).statusCode === 401,
    "a secret that was never set lets nothing in, not even an empty key");
  ok(db.docs.size === 0 && db.writes() === 0, "…and nothing refused touched the database");
  ok(keyMatches(KEY, KEY) && !keyMatches(KEY, KEY + "x") && !keyMatches("", "") && !keyMatches(null, null), "keyMatches, by hand");
}

console.log("storing events");
{
  const db = fakeDb();
  const r = await send({ body: EVENT }, db);
  ok(r.statusCode === 200 && r.body && r.body.ok === true, "Trainerize's key and a real event: accepted");
  const stored = db.docs.get("trainerizeEvents/evt_123abc");
  ok(stored && stored.eventType === "dailyWorkout.completed" && stored.userID === 21029731 && stored.receivedAt === 1000
    && stored.handled === false && stored.created === "2026-09-26T14:00:00Z",
    "stored under the event's own id, with its type, client, times and a not-yet-handled flag");
  ok(stored && JSON.parse(stored.dataJson).nested[0][1] === 2, "the payload is kept whole as JSON text (Firestore refuses arrays in arrays)");
  const again = await send({ body: EVENT }, db);
  ok(again.statusCode === 200 && db.docs.size === 1, "a retry of the same event is acknowledged and stored once");
  const bad = await send({ body: EVENT }, fakeDb({ failWith: Object.assign(new Error("down"), { code: 14 }) }));
  ok(bad.statusCode === 500, "a storage failure answers 500, so Trainerize retries");
}

console.log("what counts as an event");
{
  const db = fakeDb();
  for (const [body, why] of [
    [null, "no body"], [[EVENT], "an array"], [{ ...EVENT, id: "" }, "no id"], [{ ...EVENT, id: "." }, "the id \".\""],
    [{ ...EVENT, id: "../x" }, "an id with a slash"], [{ ...EVENT, id: "__x__" }, "an id Firestore reserves"],
    [{ ...EVENT, id: "a".repeat(121) }, "an id over 120 characters"], [{ ...EVENT, eventType: "" }, "no event type"],
    [{ ...EVENT, eventType: "msg received!" }, "an event type with spaces"],
  ]) {
    const r = await send({ body }, db);
    ok(r.statusCode === 400, `refused: ${why} (got ${r.statusCode})`);
  }
  ok(db.writes() === 0, "…and none of them reached the database");
  const big = await send({ body: EVENT, raw: Buffer.alloc(WEBHOOK_LIMITS.MAX_BODY + 1) }, db);
  ok(big.statusCode === 413 && db.writes() === 0, "a body over the size limit is refused before anything is stored");
  const e = eventFrom({ ...EVENT, data: { userID: "nope" } }, 5);
  ok(e && e.userID === null && eventFrom({ ...EVENT, data: [1] }, 5).dataJson === "{}", "a missing or odd client id is stored as unknown, not guessed");
  ok(eventFrom({ id: "evt_1", eventType: "msg.received" }, 5).created === null, "an event without a time still stores");
}

console.log("wiring");
{
  const index = readFileSync(new URL("../functions/index.js", import.meta.url), "utf8");
  ok(/exports\.trainerizeWebhook = require\("\.\/trainerizeWebhook"\)\.trainerizeWebhook;/.test(index), "the function is exported");
  const vercel = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));
  const route = vercel.rewrites.find((r) => r.source === "/hooks/trainerize");
  ok(route && route.destination === "https://us-central1-calorieiq-29762.cloudfunctions.net/trainerizeWebhook",
    "glidna.com/hooks/trainerize (the address in the email to Trainerize) reaches it");
  const rules = readFileSync(new URL("../firestore.rules", import.meta.url), "utf8");
  ok(!/trainerizeEvents/.test(rules), "firestore.rules has no match for trainerizeEvents, so no browser can read or write it");
  const src = readFileSync(new URL("../functions/trainerizeWebhook.js", import.meta.url), "utf8");
  ok(/secrets: \[TRAINERIZE_WEBHOOK_SECRET\]/.test(src) && /secret: TRAINERIZE_WEBHOOK_SECRET\.value\(\)/.test(src),
    "the key comes from Secret Manager, never from the code");
}

console.log(`\n${checks - fails}/${checks} Trainerize webhook checks passed`);
if (fails) process.exit(1);
