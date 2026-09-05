// Drive time between sessions, and the back-to-back feasibility check (S197i).
//
// Kevin's ask: a trainer who drives to clients needs to know when two bookings
// cannot both be kept. That is the part of "drive to you" with the real value —
// it is what stops someone double-booking themselves across town.
//
// ⚠️ TWO ESTIMATORS ON PURPOSE (Kevin's decision, S190). The straight-line one
// is free, needs no key, and is WRONG PRECISELY WHEN IT MATTERS — it knows
// nothing about traffic, so it is at its most optimistic during rush hour, which
// is when back-to-back sessions actually collide. The Google Routes one is
// traffic-aware and costs ~$5–10 per 1,000 lookups. Both are here so they can be
// compared, and every estimate is LABELLED with which produced it: a warning
// that cannot say how confident it is would be worse than none.
//
// Nothing here requires a key to work. With no GOOGLE_MAPS_API_KEY configured
// the module geocodes through OpenStreetMap's Nominatim (free, no key) and
// estimates by straight line. Adding the key upgrades both halves in place —
// same shape as the voice provider swap in S79.

const ROAD_FACTOR = 1.3;        // straight line → actual road distance, roughly
const AVG_MPH = 25;             // city driving with lights; deliberately not highway
const OVERHEAD_MIN = 5;         // parking, walking to and from the car, saying goodbye
const TIGHT_BUFFER_MIN = 10;    // less slack than this and it is not a real gap
const GEO_TTL_MS = 180 * 86400000;   // an address's coordinates do not move
const DRIVE_TTL_MS = 30 * 86400000;  // the drive between two fixed points barely changes

// ── address handling ────────────────────────────────────────────────────────
// The cache key. Two people typing the same address differently must land on
// the same entry, or every booking pays for a fresh lookup.
function normalizeAddress(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[.,#]/g, " ")
    .replace(/\b(street|str)\b/g, "st")
    .replace(/\b(avenue|ave)\b/g, "ave")
    .replace(/\b(road)\b/g, "rd")
    .replace(/\b(drive)\b/g, "dr")
    .replace(/\b(boulevard|blvd)\b/g, "blvd")
    // Unit numbers do not move the pin, so they are dropped — but ONLY when what
    // follows actually looks like a unit. Swallowing the next token whatever it
    // was turned "100 Ste Catherine St" into "100 st", destroying the street
    // name and collapsing unrelated addresses onto one cache key. A unit starts
    // with a digit ("Suite 200", "Apt 3B") or is a lone letter ("Apt B").
    .replace(/\b(apartment|apt|unit|suite|ste)\b\.?\s*#?\s*(\d[\w-]*|[a-z]\b)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// A stable, filename-safe cache id. Not a security hash — just a short key.
function addressKey(addr) {
  const n = normalizeAddress(addr);
  let h = 5381;
  for (let i = 0; i < n.length; i++) h = ((h * 33) ^ n.charCodeAt(i)) >>> 0;
  return `a${h.toString(36)}_${n.length}`;
}

// ── distance ────────────────────────────────────────────────────────────────
function haversineMiles(a, b) {
  if (!a || !b || !isFinite(a.lat) || !isFinite(a.lng) || !isFinite(b.lat) || !isFinite(b.lng)) return null;
  const R = 3958.8, toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

// The free estimate. Rounded UP: when the number is a guess, the guess that
// makes someone leave earlier is the safe one.
function straightLineMinutes(from, to) {
  const miles = haversineMiles(from, to);
  if (miles == null) return null;
  if (miles < 0.1) return 0;               // same place
  return Math.ceil((miles * ROAD_FACTOR / AVG_MPH) * 60 + OVERHEAD_MIN);
}

// ── the feasibility check — PURE, and the part worth trusting ───────────────
// `sessions`: [{ id, startAt, durationMin, location, status }]
// `travelMin(fromSession, toSession)`: minutes (or {minutes, source}), or null
// when it cannot be known. It receives the SESSIONS, not their addresses —
// looking a leg up by address is ambiguous the moment two different pairs share
// one, and the caller already knows the pair it estimated.
//
// Returns one entry per adjacent pair that is a problem. Deliberately silent
// where it cannot know: an unknown drive produces NO warning rather than a
// guess, because a warning nobody can act on trains people to ignore them.
function feasibilityWarnings(sessions, travelMin, opts = {}) {
  const tight = opts.tightBufferMin != null ? opts.tightBufferMin : TIGHT_BUFFER_MIN;
  const live = (sessions || [])
    .filter((s) => s && s.status !== "cancelled" && isFinite(s.startAt))
    .sort((a, b) => a.startAt - b.startAt);
  const out = [];
  for (let i = 0; i < live.length - 1; i++) {
    const a = live[i], b = live[i + 1];
    const endA = a.startAt + (Number(a.durationMin) || 0) * 60000;
    const gapMin = Math.round((b.startAt - endA) / 60000);

    // An outright overlap is a different, worse problem than a tight drive, and
    // it is true regardless of where the two sessions are.
    if (b.startAt < endA) {
      out.push({ fromId: a.id, toId: b.id, kind: "overlap",
        gapMin, driveMin: null, slackMin: gapMin, source: null });
      continue;
    }
    const drive = travelMin ? travelMin(a, b) : null;
    if (drive == null) continue;            // unknown — say nothing
    const driveMin = drive.minutes != null ? drive.minutes : drive;
    if (driveMin == null) continue;
    const slackMin = gapMin - driveMin;
    if (slackMin < 0) {
      out.push({ fromId: a.id, toId: b.id, kind: "impossible",
        gapMin, driveMin, slackMin, source: drive.source || null });
    } else if (driveMin > 0 && slackMin < tight) {
      // ⚠️ ONLY WHEN THERE IS ACTUALLY A DRIVE. Two sessions back to back at the
      // same gym have zero travel and zero slack, which is how most trainers
      // work all day — flagging every one of those would put a warning on a
      // normal schedule and teach people to ignore the ones that mean
      // something.
      out.push({ fromId: a.id, toId: b.id, kind: "tight",
        gapMin, driveMin, slackMin, source: drive.source || null });
    }
  }
  return out;
}

// ── geocoding ───────────────────────────────────────────────────────────────
// Google when a key is configured, otherwise Nominatim. Nominatim's usage
// policy asks for an identifying User-Agent and low volume; every result is
// cached for months and one trainer geocodes a handful of addresses ever, so
// this sits well inside it.
// ⚠️ A CONFIGURED KEY MUST NOT REMOVE THE FREE FALLBACK (S199). Every exit
// inside the `if (apiKey)` branch used to be `return null`, which made the
// Nominatim block below unreachable the moment a key existed. Geocoding and
// Routes are separately-enabled Google APIs and a key can be restricted,
// rate-limited, or simply have billing lapse — and in every one of those cases
// this returned null, estimateDrive returned null, feasibilityWarnings fell
// silent, and the panel did not render AT ALL. Turning the key on turned the
// safety check off, and only for the paying accounts that had one.
//
// Google is now tried FIRST and Nominatim is the fallback, for everyone.
//
// The return distinguishes two things the old shape could not:
//   hit       — coordinates, or null
//   definite  — true when the providers actually AGREE the address is unknown,
//               false when the lookup itself failed. Only a definite miss may
//               be cached; a 429 cached as "not found" would disable the drive
//               check for that address for a day, for every trainer.
async function geocodeLive(address, apiKey, fetchFn) {
  const f = fetchFn || fetch;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  let definite = false;
  try {
    if (apiKey) {
      try {
        const url = "https://maps.googleapis.com/maps/api/geocode/json?address="
          + encodeURIComponent(address) + "&key=" + encodeURIComponent(apiKey);
        const r = await f(url, { signal: ctrl.signal });
        if (r.ok) {
          const j = await r.json();
          const loc = j && j.results && j.results[0] && j.results[0].geometry && j.results[0].geometry.location;
          if (loc) return { hit: { lat: Number(loc.lat), lng: Number(loc.lng), provider: "google" }, definite: true };
          // ZERO_RESULTS is Google saying the address is not real. Anything else
          // — REQUEST_DENIED, OVER_QUERY_LIMIT, an unreadable body — is Google
          // failing to answer, which is not the same claim and must not be
          // cached as one.
          if (j && j.status === "ZERO_RESULTS") definite = true;
        }
      } catch { /* fall through to the free provider */ }
    }
    const url = "https://nominatim.openstreetmap.org/search?format=json&limit=1&q="
      + encodeURIComponent(address);
    const r = await f(url, { signal: ctrl.signal, headers: { "User-Agent": "Glidna/1.0 (support@glidna.com)" } });
    if (!r.ok) return { hit: null, definite };
    const j = await r.json();
    const hit = Array.isArray(j) && j[0];
    if (!hit) return { hit: null, definite: true };
    return { hit: { lat: Number(hit.lat), lng: Number(hit.lon), provider: "nominatim" }, definite: true };
  } catch { return { hit: null, definite }; } finally { clearTimeout(t); }
}

// Cached geocode. A MISS IS CACHED TOO (as {failed:true}), for a shorter time —
// otherwise a typo'd address is looked up again on every single calendar open.
async function geocode(db, address, apiKey, fetchFn) {
  const norm = normalizeAddress(address);
  if (!norm) return null;
  const ref = db.doc(`geocache/${addressKey(address)}`);
  try {
    const snap = await ref.get();
    if (snap.exists) {
      const d = snap.data() || {};
      const age = Date.now() - (d.at || 0);
      if (d.failed && age < 86400000) return null;              // retry a failure tomorrow
      if (!d.failed && age < GEO_TTL_MS && isFinite(d.lat)) {
        return { lat: d.lat, lng: d.lng, provider: d.provider, cached: true };
      }
    }
  } catch { /* a cache read failure must not stop the lookup */ }
  const { hit, definite } = await geocodeLive(norm, apiKey, fetchFn);
  try {
    if (hit) {
      await ref.set({ at: Date.now(), lat: hit.lat, lng: hit.lng, provider: hit.provider, q: norm.slice(0, 120) });
    } else if (definite) {
      // A real miss: both providers agree there is no such address. Worth
      // remembering for a day so a typo is not looked up on every calendar open.
      await ref.set({ at: Date.now(), failed: true, q: norm.slice(0, 120) });
    }
    // ⚠️ AND WHEN IT IS NOT DEFINITE, WRITE NOTHING. A rate-limit, a timeout or
    // a 5xx used to be stored as `{failed:true}` for 24 hours — in
    // `geocache/{addressKey}`, which has NO uid in it. So one account's unlucky
    // second disabled the drive check at that address for EVERY trainer with a
    // session there, for a day, and the two concurrent lookups per leg against
    // Nominatim's ~1-request-per-second budget made it likely rather than
    // theoretical. Writing nothing also means a transient failure can no longer
    // overwrite a good cached hit, which `ref.set` would otherwise do.
  } catch { /* best-effort */ }
  return hit;
}

// ── drive estimate ──────────────────────────────────────────────────────────
// Cached by (origin, destination, weekday, hour) exactly as the spec asks: the
// drive between two fixed addresses barely changes for a given time of week, so
// a warm cache makes this pennies a month.
function driveKey(fromAddr, toAddr, departMs) {
  const d = new Date(departMs || Date.now());
  return `${addressKey(fromAddr)}__${addressKey(toAddr)}__${d.getUTCDay()}_${d.getUTCHours()}`;
}

async function routesLive(from, to, departMs, apiKey, fetchFn) {
  const f = fetchFn || fetch;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    const body = {
      origin: { location: { latLng: { latitude: from.lat, longitude: from.lng } } },
      destination: { location: { latLng: { latitude: to.lat, longitude: to.lng } } },
      travelMode: "DRIVE",
      routingPreference: "TRAFFIC_AWARE",
      // Routes rejects a departureTime in the past, and a session that already
      // started is exactly that case.
      departureTime: new Date(Math.max(Date.now() + 60000, departMs || 0)).toISOString(),
    };
    const r = await f("https://routes.googleapis.com/directions/v2:computeRoutes", {
      method: "POST", signal: ctrl.signal,
      headers: { "Content-Type": "application/json", "X-Goog-Api-Key": apiKey,
                 "X-Goog-FieldMask": "routes.duration,routes.distanceMeters" },
      body: JSON.stringify(body),
    });
    if (!r.ok) return null;
    const j = await r.json();
    const route = j && j.routes && j.routes[0];
    if (!route || !route.duration) return null;
    const secs = Number(String(route.duration).replace("s", ""));
    if (!isFinite(secs)) return null;
    return { minutes: Math.ceil(secs / 60) + OVERHEAD_MIN,
             miles: route.distanceMeters ? route.distanceMeters / 1609.34 : null,
             source: "routes" };
  } catch { return null; } finally { clearTimeout(t); }
}

// The one entry point. Always returns a labelled estimate or null — and falls
// back to the straight line whenever Routes is unavailable, so a key problem
// degrades the estimate instead of removing the warning.
async function estimateDrive(db, fromAddr, toAddr, departMs, apiKey, fetchFn) {
  if (!normalizeAddress(fromAddr) || !normalizeAddress(toAddr)) return null;
  if (normalizeAddress(fromAddr) === normalizeAddress(toAddr)) {
    return { minutes: 0, miles: 0, source: "same-place", cached: false };
  }
  const ref = db.doc(`drivecache/${driveKey(fromAddr, toAddr, departMs)}`);
  try {
    const snap = await ref.get();
    if (snap.exists) {
      const d = snap.data() || {};
      // ⚠️ A CACHED GUESS MUST NOT OUTLIVE THE ABILITY TO DO BETTER (S198w).
      // Entries live 30 days. Every estimate made before a Maps key existed is
      // a straight line, so without this the day the key arrives changes
      // nothing for any route already looked at — the trainer keeps reading
      // "no traffic" estimates for a month and reasonably concludes the key did
      // not work. A straight-line entry is therefore treated as a MISS once a
      // key is available, and recomputed for real.
      const staleGuess = d.source === "straight-line" && !!apiKey;
      if (!staleGuess && Date.now() - (d.at || 0) < DRIVE_TTL_MS && isFinite(d.minutes)) {
        return { minutes: d.minutes, miles: d.miles != null ? d.miles : null, source: d.source, cached: true };
      }
    }
  } catch { /* fall through to a live estimate */ }

  const [from, to] = await Promise.all([
    geocode(db, fromAddr, apiKey, fetchFn),
    geocode(db, toAddr, apiKey, fetchFn),
  ]);
  if (!from || !to) return null;

  let est = apiKey ? await routesLive(from, to, departMs, apiKey, fetchFn) : null;
  if (!est) {
    const minutes = straightLineMinutes(from, to);
    if (minutes == null) return null;
    est = { minutes, miles: haversineMiles(from, to), source: "straight-line" };
  }
  try { await ref.set({ at: Date.now(), minutes: est.minutes, miles: est.miles, source: est.source }); }
  catch { /* best-effort */ }
  return { ...est, cached: false };
}

module.exports = {
  normalizeAddress, addressKey, haversineMiles, straightLineMinutes,
  feasibilityWarnings, geocode, estimateDrive, driveKey,
  ROAD_FACTOR, AVG_MPH, OVERHEAD_MIN, TIGHT_BUFFER_MIN,
};
