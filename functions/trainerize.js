// Glide — Trainerize import (read-only migration + wearable calorieOut).
//
// Lets a trainer pull their Trainerize clients + history into Glide, and (later)
// their wearable calories-burned via healthData.calorieOut — so we don't need a
// paid unified-wearable service for existing clients. See docs/TRAINERIZE-API.md.
//
// AUTH (from the API reference): all endpoints are POST to https://api.trainerize.com/v03/…,
// JSON body, HTTP Basic where the credential is base64("<GroupID>:<APIToken>").
//
// SETUP (Kevin, one-time — the function won't deploy until BOTH secrets exist):
//   1. In Trainerize (Studio), find your Group API ID + API token.
//   2. printf 'YOUR_GROUP_ID' | firebase functions:secrets:set TRAINERIZE_GROUP_ID --data-file=-
//   3. printf 'YOUR_API_TOKEN' | firebase functions:secrets:set TRAINERIZE_API_TOKEN --data-file=-
//   4. firebase deploy --only functions:trainerizeTest
// This first function just TESTS the connection (lists clients) so we confirm auth
// before building the full importer. Trainer/admin only. Read-only.

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");

const TRAINERIZE_GROUP_ID = defineSecret("TRAINERIZE_GROUP_ID");
const TRAINERIZE_API_TOKEN = defineSecret("TRAINERIZE_API_TOKEN");

const BASE = "https://api.trainerize.com/v03";

// One authenticated POST to a Trainerize endpoint. Returns {ok,status,json}.
async function tz(path, body, auth) {
  const res = await fetch(`${BASE}/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body || {}),
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 500) }; }
  return { ok: res.ok, status: res.status, json };
}

// Verify the caller is a trainer/admin (only they may connect a Trainerize group).
async function requireTrainer(uid) {
  if (!uid) throw new HttpsError("unauthenticated", "Sign in first.");
  const db = admin.firestore();
  const profile = (await db.doc(`users/${uid}`).get()).data() || {};
  const role = profile.role || "client";
  if (!["head_trainer", "sub_trainer", "admin"].includes(role)) {
    throw new HttpsError("permission-denied", "Only trainers can connect Trainerize.");
  }
}

// Connection test: authenticate + fetch the client list. Returns a small summary
// (count + a 3-client sample) so we can confirm auth works and see the real shape
// before building the full field-by-field importer.
exports.trainerizeTest = onCall(
  { secrets: [TRAINERIZE_GROUP_ID, TRAINERIZE_API_TOKEN], cors: true },
  async (request) => {
    await requireTrainer(request.auth && request.auth.uid);
    const auth = Buffer.from(`${TRAINERIZE_GROUP_ID.value()}:${TRAINERIZE_API_TOKEN.value()}`).toString("base64");

    const r = await tz("user/getClientList", { start: 0, count: 100 }, auth);
    if (!r.ok) {
      throw new HttpsError("internal", `Trainerize returned ${r.status}. Check the Group ID / API token.`,
        { status: r.status, body: r.json });
    }
    // The exact list key varies by account/version — surface whatever came back.
    const list = (r.json && (r.json.clients || r.json.users || r.json.list || r.json.data)) || null;
    return {
      ok: true,
      status: r.status,
      count: Array.isArray(list) ? list.length : null,
      sample: Array.isArray(list) ? list.slice(0, 3) : r.json,
    };
  }
);
