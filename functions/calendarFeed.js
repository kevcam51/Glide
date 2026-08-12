// Glidna — subscribe to your sessions from your own calendar (S187).
//
// Serves the signed-in person's booked sessions as an iCalendar feed, so Google
// Calendar / Apple Calendar / Outlook can subscribe once and then keep showing
// Glidna sessions alongside everything else in their life. Book, reschedule or
// cancel in Glidna and the subscribed calendar follows.
//
// ⚠️ WHY THE URL IS THE CREDENTIAL. A calendar app subscribing to a feed cannot
// send an Authorization header, an ID token, or anything else we choose — it
// issues a bare anonymous GET, forever, from Google's servers rather than the
// user's device. So the secret has to live in the URL itself. That makes the
// token exactly as sensitive as a password, and the design follows from it:
//
//   • 160 bits from crypto.randomBytes — not a uid, not a guessable id.
//   • The token is checked against the ONE user it belongs to. The uid in the
//     URL narrows the lookup; the token alone decides access.
//   • Rotatable. "Reset link" mints a new token and the old URL dies at once,
//     which is the only remedy once a URL has leaked into someone's screen
//     share, a shared family calendar, or a support ticket.
//   • The feed carries times, titles, locations and the other person's NAME.
//     Nothing about money, health, or anyone the subscriber isn't training
//     with. A leaked feed should be embarrassing, not harmful.
//   • noindex + no-store, because a calendar URL that turns up in a search
//     index is a breach that nobody performed.

const { onRequest, onCall, HttpsError } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const crypto = require("crypto");

const REGION = "us-central1";
const PUBLIC_BASE = `https://${REGION}-calorieiq-29762.cloudfunctions.net/calendarFeed`;
// How much history to carry. Enough for a client to look back over a training
// block, not so much that the feed grows without bound.
const PAST_DAYS = 90;
const FUTURE_DAYS = 365;
const MAX_EVENTS = 800;

// ── iCalendar formatting ────────────────────────────────────────────────────
// RFC 5545 is unforgiving: a stray comma or an over-long line and the whole
// calendar silently fails to parse in some clients while working in others.
const esc = (s) => String(s == null ? "" : s)
  .replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,")
  .replace(/\r?\n/g, "\\n");

// Lines must be folded at 75 octets, continued with a leading space. Folding by
// BYTES rather than characters — an emoji in a session title is multi-byte, and
// splitting one mid-sequence corrupts the line.
function fold(line) {
  const bytes = Buffer.from(line, "utf8");
  if (bytes.length <= 75) return line;
  const out = [];
  let start = 0;
  while (start < bytes.length) {
    const limit = out.length === 0 ? 75 : 74; // continuation lines carry a leading space
    let end = Math.min(start + limit, bytes.length);
    // Don't split a UTF-8 continuation byte (10xxxxxx) from its leader.
    while (end > start && end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--;
    out.push((out.length ? " " : "") + bytes.slice(start, end).toString("utf8"));
    start = end;
  }
  return out.join("\r\n");
}
const utc = (ms) => new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

const nameOf = (u) => (u && (u.displayName || [u.firstName, u.lastName].filter(Boolean).join(" "))) || "";

function buildIcs(uid, sessions, peers) {
  const now = Date.now();
  const lines = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Glidna//Sessions//EN",
    "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    "X-WR-CALNAME:Glidna training",
    "X-WR-CALDESC:Your booked training sessions",
    // Apple and Outlook honour these and will re-poll roughly this often.
    // Google ignores them and refreshes on its own schedule — see the note the
    // UI shows the user, which says so plainly rather than pretending.
    "REFRESH-INTERVAL;VALUE=DURATION:PT15M", "X-PUBLISHED-TTL:PT15M",
  ];
  for (const s of sessions) {
    const startAt = Number(s.startAt) || 0;
    if (!startAt) continue;
    const mins = Math.max(1, Number(s.durationMin) || 60);
    const otherUid = uid === s.trainerUid ? s.clientUid : s.trainerUid;
    const other = nameOf(peers.get(otherUid)) || (uid === s.trainerUid ? "Client" : "Trainer");
    const summary = s.title ? `${s.title} — ${other}` : `Training with ${other}`;
    lines.push("BEGIN:VEVENT");
    // A STABLE uid is what makes this a sync rather than a re-import: change a
    // session's time and the subscriber MOVES the existing event instead of
    // leaving the old one behind next to a duplicate.
    lines.push(fold(`UID:session-${s.id}@glidna.com`));
    lines.push(`DTSTAMP:${utc(now)}`);
    lines.push(`DTSTART:${utc(startAt)}`);
    lines.push(`DTEND:${utc(startAt + mins * 60000)}`);
    lines.push(fold(`SUMMARY:${esc(summary)}`));
    if (s.location) lines.push(fold(`LOCATION:${esc(s.location)}`));
    // Cancelled sessions stay in the feed as CANCELLED rather than vanishing:
    // dropping the event outright leaves it on some subscribers' calendars
    // forever, and "cancelled" is the thing they actually need to see.
    lines.push(`STATUS:${s.status === "cancelled" ? "CANCELLED" : "CONFIRMED"}`);
    lines.push(`LAST-MODIFIED:${utc(Number(s.updatedAt) || Number(s.createdAt) || now)}`);
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}

exports._buildIcs = buildIcs; // exported for the RFC-compliance test

// ── the feed ────────────────────────────────────────────────────────────────
exports.calendarFeed = onRequest(
  { region: REGION, maxInstances: 10, cors: false },
  async (req, res) => {
    res.set("X-Robots-Tag", "noindex, nofollow");
    res.set("Cache-Control", "no-store");
    const uid = String(req.query.u || "").slice(0, 128);
    const token = String(req.query.t || "").slice(0, 128);
    if (!uid || !token) { res.status(400).send("Missing calendar key."); return; }

    const db = admin.firestore();
    let profile = null;
    try { profile = (await db.doc(`users/${uid}`).get()).data(); } catch { profile = null; }
    const expected = profile && profile.calendarFeedToken;
    // Length check first so the comparison below is over equal-length buffers,
    // then a timing-safe compare — a feed URL is a bearer credential and
    // deserves the same care as one.
    const ok = !!expected && expected.length === token.length
      && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(token));
    if (!ok) { res.status(403).send("This calendar link is no longer valid."); return; }

    const now = Date.now();
    let snap;
    try {
      // Deliberately a single array-contains with NO range on startAt: pairing
      // array-contains with an inequality on another field would demand a
      // composite index, and a feed that 500s until someone remembers to deploy
      // an index is worse than reading a few hundred extra documents. Same
      // reasoning the session queries in firestore.rules already follow — the
      // window is applied below, in code.
      snap = await db.collection("sessions")
        .where("participants", "array-contains", uid)
        .limit(2000)
        .get();
    } catch (e) {
      console.error("calendarFeed query failed", uid, e && e.message);
      res.status(500).send("Could not build the calendar right now.");
      return;
    }

    const from = now - PAST_DAYS * 86400000;
    const to = now + FUTURE_DAYS * 86400000;
    const sessions = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((s) => { const t = Number(s.startAt) || 0; return t > from && t <= to; })
      .sort((a, b) => (Number(a.startAt) || 0) - (Number(b.startAt) || 0))
      .slice(0, MAX_EVENTS);
    const peerUids = [...new Set(sessions.map((s) => (uid === s.trainerUid ? s.clientUid : s.trainerUid)).filter(Boolean))];
    const peers = new Map();
    await Promise.all(peerUids.slice(0, 100).map(async (p) => {
      try { const d = await db.doc(`users/${p}`).get(); if (d.exists) peers.set(p, d.data()); } catch { /* name is optional */ }
    }));

    res.set("Content-Type", "text/calendar; charset=utf-8");
    res.set("Content-Disposition", 'inline; filename="glidna.ics"');
    res.status(200).send(buildIcs(uid, sessions, peers));
  },
);

// ── get (or rotate) my subscribe link ───────────────────────────────────────
exports.calendarFeedLink = onCall(
  { region: REGION, maxInstances: 10 },
  async (request) => {
    const uid = request.auth && request.auth.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Please sign in.");
    const db = admin.firestore();
    const ref = db.doc(`users/${uid}`);
    const cur = (await ref.get()).data() || {};
    let token = cur.calendarFeedToken;
    const reset = (request.data || {}).reset === true;
    if (!token || reset) {
      token = crypto.randomBytes(20).toString("hex");
      await ref.set({ calendarFeedToken: token, calendarFeedAt: Date.now() }, { merge: true });
    }
    const url = `${PUBLIC_BASE}?u=${encodeURIComponent(uid)}&t=${token}`;
    // webcal:// makes Apple Calendar and Outlook subscribe on a single tap
    // instead of downloading a one-off snapshot that never updates again.
    return { url, webcal: url.replace(/^https:\/\//, "webcal://"), rotated: !!reset || !cur.calendarFeedToken };
  },
);
