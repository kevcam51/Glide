// Address autocomplete (S207, Kevin: "can it start to auto populate options like
// it does on google maps?").
//
// ⚠️ THE REAL POINT IS NOT TYPING CONVENIENCE. Someone typing "Coconut Grove" or
// "the gym" produces an address BOTH geocoders answer with the middle of
// somewhere — and the precision guard added in S199u/v then correctly refuses
// it, so the drive estimate silently produces nothing and nobody can see why.
// A suggestion list means what lands in the field is a real, resolvable place.
// This fixes that failure at the source rather than catching it afterwards.
//
// ⚠️ A PROXY, NOT A BROWSER KEY, AND THE REASON IS FORCED. Google API key
// restrictions are EXCLUSIVE: putting a "Websites" restriction on the existing
// GOOGLE_MAPS_API_KEY would break the server-side Geocoding and Routes it
// already does, so a browser path needs a SECOND key shipped in the bundle —
// and Google's own security guidance warns referrer restrictions "may cause
// requests to fail" because modern browsers redact the Referer header. Google
// explicitly endorses this shape instead: "Using a secure proxy server provides
// a solid source for interacting with a Google Maps Platform web service
// endpoint from a client-side application without exposing your API key."
// It also matches what this codebase already says out loud — driveTime.js keeps
// this key server-side because "the browser must never hold" it — and
// foodsearch.js is the same pattern.
//
// Google's conditions for a proxy, and how each is met here:
//   "Construct your requests on the proxy server"      → the body is built here;
//                                                        the client sends text.
//   "Don't allow clients to relay arbitrary API calls" → one endpoint, one
//                                                        shape, no passthrough.
//   "Post-process the responses. Filter out data the   → only the display text
//    client doesn't need"                                 leaves this function.
//
// ⚠️ NO SESSION TOKENS, DELIBERATELY. They exist to bundle a typing session with
// a terminating Place Details call — and we never make one, because we do not
// want coordinates. The address TEXT is what we store and what the existing
// geocode-and-cache pipeline already consumes, so adding Place Details would be
// a second billed SKU to obtain something we then throw away.
//
// Cost (verified S207 against Google's SKU tables, three independent readings
// plus a refutation): SKU "Autocomplete Requests" 4EF4-B17C-B31A — 10,000 free
// events a month, then $2.83/1,000. Debounced, an address costs a handful of
// requests, so ordinary use never leaves the free tier.
//
// ⚠️ REQUIRES "Places API (New)" TO BE ENABLED on the Cloud project. It was NOT
// at the time of writing, and an unenabled API answers 403 PERMISSION_DENIED to
// every call. That is why every failure here degrades to an EMPTY LIST rather
// than an error: the field must stay a working text input, and typing must
// never be blocked by a suggestion service.
//   Enable: console.cloud.google.com/apis/library/places.googleapis.com

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");
const { geocode } = require("./driveTime");

const GOOGLE_MAPS_API_KEY = defineSecret("GOOGLE_MAPS_API_KEY");
const REGION = "us-central1";

const MIN_CHARS = 3;      // below this the suggestions are noise, and each costs a request
const MAX_INPUT = 200;
const MAX_RESULTS = 5;
const TIMEOUT_MS = 4000;  // a suggestion that arrives after the next keystroke is worthless
// How far around the person's own saved place to prefer results. Wide enough to
// cover a metro area they might train across, tight enough that it actually
// reorders anything — this is a BIAS, never a restriction, so somewhere outside
// it still appears, just lower down.
const BIAS_RADIUS_M = 50000;
const MEETING_ADDRESS_KEY = "caliq-meeting-address";

// Where this person is likely typing about. Their own saved meeting address is
// the only signal we have that costs nothing and asks for nothing — no browser
// location prompt for a text field.
// ⚠️ The geocode is CACHED (180 days, shared) by driveTime.js, so this is a
// Firestore read rather than a lookup, and it is best-effort: no saved address,
// or an address that will not resolve, simply means unbiased results.
async function biasCenterFor(db, uid, apiKey) {
  try {
    const doc = await db.doc(`users/${uid}/kv/${encodeURIComponent(MEETING_ADDRESS_KEY)}`).get();
    if (!doc.exists) return null;
    const raw = JSON.parse(doc.data().value || "{}");
    const addr = raw && typeof raw === "object" ? raw.address : raw;
    if (!addr) return null;
    const hit = await geocode(db, String(addr), apiKey);
    return hit && isFinite(hit.lat) ? { latitude: hit.lat, longitude: hit.lng } : null;
  } catch { return null; }
}

// Pull the display strings out of a v1 autocomplete response, and NOTHING else.
// Exported and pure so the shape can be tested without a network.
// The response also carries placeId and types; neither is returned, because the
// client has no use for them and Google's proxy guidance says to filter.
function parseSuggestions(json, max = MAX_RESULTS) {
  const out = [];
  const list = (json && Array.isArray(json.suggestions)) ? json.suggestions : [];
  for (const s of list) {
    const p = s && s.placePrediction;
    if (!p) continue;                       // queryPrediction entries are searches, not places
    const full = p.text && typeof p.text.text === "string" ? p.text.text.trim() : "";
    if (!full) continue;
    const sf = p.structuredFormat || {};
    out.push({
      // What goes IN the field when picked — the whole address, because that is
      // what gets geocoded.
      value: full,
      // Split for display only: "1111 Lincoln Rd" over "Miami Beach, FL, USA".
      main: (sf.mainText && sf.mainText.text) || full,
      secondary: (sf.secondaryText && sf.secondaryText.text) || "",
    });
    if (out.length >= max) break;
  }
  return out;
}

// Is this worth spending a request on? PURE. Every keystroke that passes costs
// a billable event, so the cheap rejections happen before the network.
function worthAsking(input) {
  const q = String(input || "").trim();
  if (q.length < MIN_CHARS || q.length > MAX_INPUT) return "";
  // A pasted URL is a Zoom link, not a place — the Location field's own
  // placeholder invites one ("Studio, or a Zoom link"), and geocoding it is how
  // a dead address gets cached for 24 hours.
  if (/^https?:\/\//i.test(q) || /\s/.test(q) === false && q.includes("://")) return "";
  return q;
}

exports.placesAutocomplete = onCall(
  { region: REGION, maxInstances: 10, secrets: [GOOGLE_MAPS_API_KEY] },
  async (request) => {
    // Signed-in only. Not because the data is sensitive — it is Google's public
    // place index — but because an open endpoint is somebody else's free
    // autocomplete billed to this project.
    const uid = request.auth && request.auth.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Please sign in.");

    const q = worthAsking(request.data && request.data.input);
    if (!q) return { suggestions: [] };

    const raw = (GOOGLE_MAPS_API_KEY.value() || "").trim();
    // Same shape check as the drive estimator: a deploy-time placeholder behaves
    // as "no key" rather than as a broken one.
    if (!raw.startsWith("AIza")) return { suggestions: [], configured: false };

    const bias = await biasCenterFor(admin.firestore(), uid, raw);

    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const r = await fetch("https://places.googleapis.com/v1/places:autocomplete", {
        method: "POST", signal: ctrl.signal,
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": raw,
          // ⚠️ THE FIELD MASK IS A COST CONTROL, NOT A TIDINESS ONE. Places bills
          // by the fields requested; asking for everything moves the request to
          // a dearer SKU. These three are the Essentials set we actually render.
          "X-Goog-FieldMask":
            "suggestions.placePrediction.text,suggestions.placePrediction.structuredFormat",
        },
        body: JSON.stringify({
          input: q,
          // ⚠️ TYPES ARE NO LONGER RESTRICTED (S208, Kevin: "it struggles to find
          // general locations in my area... more than just addresses"). The
          // first version asked only for street_address/premise/subpremise/route
          // on the reasoning that a POI geocodes less reliably than an address —
          // true, but it made the field unable to find the places a mobile
          // trainer actually works at: a named gym, a park, a building. Google
          // returns a full formatted address for an establishment anyway, so the
          // thing that lands in the field is still geocodable.
          //
          // Biased to where this person already trains, so their own city wins
          // over an identically-named street two states away. A BIAS, not a
          // restriction: somewhere genuinely elsewhere still appears, lower down.
          ...(bias ? { locationBias: { circle: { center: bias, radius: BIAS_RADIUS_M } } } : {}),
        }),
      });
      if (!r.ok) {
        // ⚠️ NEVER THROW AT THE FIELD. A suggestion service that is down, not
        // enabled, or rate-limited must leave a working text input behind — the
        // person is mid-sentence. Logged once so the cause is findable, since
        // "no suggestions ever" is otherwise indistinguishable from "no matches".
        console.warn("placesAutocomplete upstream", r.status);
        return { suggestions: [], upstream: r.status };
      }
      return { suggestions: parseSuggestions(await r.json()) };
    } catch (e) {
      console.warn("placesAutocomplete failed:", e && e.message);
      return { suggestions: [] };
    } finally { clearTimeout(t); }
  },
);

exports.parseSuggestions = parseSuggestions;
exports.worthAsking = worthAsking;
exports.BIAS_RADIUS_M = BIAS_RADIUS_M;
exports.MIN_CHARS = MIN_CHARS;
