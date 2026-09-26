// Smooth Training HQ — the crew's front door (S238, piece 3).
//
// Workers that run on the owner's own Claude plan — Claude routines, in
// Anthropic's cloud, running whether his Mac is on or not — hand their work to
// the HQ desk through the Glidna connector he adds to his Claude account. These
// are the tools that connector shows, and it shows them to ONE connection: the
// owner's. functions/mcp.js registers them only when the connection's uid is
// the admin uid, and checks it again on every call.
//
// ⚠️ NOT PART OF buildTools(), ON PURPOSE. aitools.js is the fitness toolset
// every member reaches through the in-app assistant and the connector alike
// (the S111 parity rule). The HQ is not a member feature — it is the owner's
// business back office — so these tools live here, outside that toolset, and
// can never appear for a client or a trainer however their roles change.
//
// ⚠️ THE CREW'S RULES ARE ENFORCED HERE, NOT TRUSTED TO A PROMPT. A routine is
// a model and its output is input: it can only ADD a desk item (always "open",
// never pre-approved), log a time card, read the desk, or
// clock in. There is no tool to send, pay, publish or delete anything, and
// the seat's department and the engine are set here, never taken from the
// caller. Everything goes through hq.js's sanitizers.
//
// Kevin wanted the HQ to show the crew really working, the way StarNet's
// station mirrors its agents' live state: hq_clock_in marks a worker on shift
// (drawn at its desk, working) and filing its work clocks it out — and the
// worker then walks what it filed to the owner's desk on the map.

const { postDeskItem, logShift, HQ_LIMITS } = require("./hq");

// Every seat on the org chart and the room it sits in, mirrored from
// src/hqOrg.js (functions can't import the app's modules).
// scripts/test-hq-door.mjs fails the moment the two disagree.
const HQ_SEATS = {
  owner: "owner",
  "chief-of-staff": "chief",
  "finance-manager": "finance",
  bookkeeper: "finance",
  "billing-specialist": "finance",
  "operations-manager": "ops",
  "systems-watchdog": "ops",
  "web-designer": "ops",
  "marketing-manager": "marketing",
  "content-creator": "marketing",
  "reviews-referrals": "marketing",
  "growth-manager": "research",
  "market-researcher": "research",
  "partnerships-scout": "research",
  "front-office-manager": "front",
  "front-desk": "front",
  scheduling: "front",
  onboarding: "front",
  "client-success-manager": "coaching",
  "progress-analyst": "coaching",
  "check-in-coordinator": "coaching",
};
// The owner files nothing through the door; the crew does.
const CREW_SEATS = Object.keys(HQ_SEATS).filter((id) => id !== "owner");
const { KINDS, SHIFT_STATUSES } = HQ_LIMITS;

const SHIFT_PROPS = {
  startedAt: { type: "string", description: "When the shift began, as an ISO 8601 time (e.g. 2026-09-28T11:00:00Z). Note it at the start of the run." },
  status: { type: "string", enum: SHIFT_STATUSES, description: "done, failed (couldn't finish — say why in summary) or skipped (nothing to do)." },
  summary: { type: "string", description: "One or two plain sentences: what this shift looked at and what came of it." },
  actions: { type: "array", items: { type: "string" }, description: "The steps taken, in order, each a short plain sentence (at most 30)." },
};

// `scope` is the connector permission a tool needs: reading the desk needs
// "read"; filing to it needs "write:logs", the same permission as any other
// write through the connector.
const HQ_TOOLS = [
  {
    name: "hq_file_report",
    scope: "write:logs",
    description:
      "Smooth Training HQ, owner only: put a finished piece of crew work on the owner's HQ desk AND log "
      + "the worker's time card, in one call. Use it once, at the END of a crew shift. Filing sends, pays "
      + "or publishes NOTHING — the desk is where the owner decides. Write for a busy owner: a one-line "
      + "title, a one-to-three sentence summary, the full plain-text report in body, and the department "
      + "head's review in headNote (what they checked, and anything the owner should double-check). "
      + "Quote only figures you actually read from a source; never estimate a money figure.",
    input_schema: {
      type: "object",
      properties: {
        worker: { type: "string", enum: CREW_SEATS, description: "The crew seat that did the work, e.g. bookkeeper or front-desk." },
        kind: { type: "string", enum: KINDS, description: "report (findings), draft (something written for the owner to review and send himself), question (needs his answer), alert (needs attention soon) or note." },
        title: { type: "string", description: "One line, under 120 characters." },
        summary: { type: "string", description: "One to three plain sentences the owner reads first." },
        body: { type: "string", description: "The full report in plain text. Short headed sections and dash lists read best." },
        headNote: { type: "string", description: "The department head's review: what was checked and what to double-check." },
        link: {
          type: "object",
          properties: {
            label: { type: "string", description: "Button text, e.g. Open draft in Gmail." },
            url: { type: "string", description: "An https:// address." },
          },
          description: "Optional: where the work lives (a Gmail draft, a QuickBooks report).",
        },
        shift: { type: "object", properties: SHIFT_PROPS, description: "The time card for this shift." },
      },
      required: ["worker", "kind", "title", "summary"],
    },
  },
  {
    name: "hq_log_shift",
    scope: "write:logs",
    description:
      "Smooth Training HQ, owner only: log a crew worker's time card when a shift has nothing to put on "
      + "the desk (for example, the inbox had no new inquiries). If there IS something for the owner, use "
      + "hq_file_report instead — it logs the time card too.",
    input_schema: {
      type: "object",
      properties: { worker: { type: "string", enum: CREW_SEATS, description: "The crew seat that worked the shift." }, ...SHIFT_PROPS },
      required: ["worker", "summary"],
    },
  },
  {
    name: "hq_read_desk",
    scope: "read",
    description:
      "Smooth Training HQ, owner only: read what is waiting on the owner's HQ desk (open items, newest "
      + "first) and the latest crew time cards. Use it to avoid filing something already on the desk, or "
      + "to brief the owner on what is waiting.",
    input_schema: {
      type: "object",
      properties: {
        includeBody: { type: "boolean", description: "Include each item's full body text (off by default)." },
      },
    },
  },
  {
    name: "hq_clock_in",
    scope: "write:logs",
    description:
      "Smooth Training HQ, owner only: clock in at the START of a crew shift, before any other work. "
      + "While the shift runs, the owner's HQ shows this worker at their desk, working. The shift ends "
      + "when you call hq_file_report or hq_log_shift for the same worker (or after two hours).",
    input_schema: {
      type: "object",
      properties: {
        worker: { type: "string", enum: CREW_SEATS, description: "The crew seat starting its shift." },
        task: { type: "string", description: "What this shift is for, in a few words, e.g. Monday money check." },
      },
      required: ["worker"],
    },
  },
];

class DoorError extends Error {
  constructor(msg) { super(msg); this.code = "invalid-argument"; }
}

// "2026-09-28T11:00:00Z" or a millisecond number → milliseconds, or null.
function toMs(v) {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Date.parse(String(v));
  return Number.isFinite(n) ? n : null;
}

function seatRoom(worker) {
  const w = String(worker || "");
  if (!CREW_SEATS.includes(w)) {
    throw new DoorError(`worker must be one of the crew's seats: ${CREW_SEATS.join(", ")}.`);
  }
  return HQ_SEATS[w];
}

function shiftFrom(worker, dept, s, now, deskItems = []) {
  const shift = s && typeof s === "object" ? s : {};
  return {
    worker, dept, engine: "claude",
    status: shift.status, startedAt: toMs(shift.startedAt), endedAt: now,
    summary: shift.summary, actions: shift.actions, deskItems,
  };
}

async function fileReport(db, input, now) {
  const i = input || {};
  const dept = seatRoom(i.worker);
  // The engine and the department come from here, never from the caller: a
  // routine on the owner's Claude plan is, by definition, on the Claude engine.
  const id = await postDeskItem(db, {
    worker: i.worker, dept, kind: i.kind, title: i.title, summary: i.summary, body: i.body,
    headNote: i.headNote, link: i.link || null, engine: "claude",
  }, now);
  const shiftId = await logShift(db, shiftFrom(i.worker, dept, { summary: i.summary, ...(i.shift || {}) }, now, [id]), now);
  await clockOut(db, i.worker, now);
  return { ok: true, deskItemId: id, shiftId, filed: "On the owner's HQ desk, waiting for him. Nothing was sent." };
}

async function logOnly(db, input, now) {
  const i = input || {};
  const dept = seatRoom(i.worker);
  const shiftId = await logShift(db, shiftFrom(i.worker, dept, i, now), now);
  await clockOut(db, i.worker, now);
  return { ok: true, shiftId };
}

const iso = (ms) => (Number.isFinite(ms) ? new Date(ms).toISOString() : null);

async function readDesk(db, input) {
  const withBody = !!(input && input.includeBody);
  const [openSnap, shiftSnap] = await Promise.all([
    db.collection("hqDesk").where("status", "==", "open").limit(300).get(),
    db.collection("hqShifts").orderBy("startedAt", "desc").limit(10).get(),
  ]);
  const open = openSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  return {
    waiting: open.length,
    items: open.slice(0, 50).map((d) => ({
      id: d.id, worker: d.worker, kind: d.kind, title: d.title, summary: d.summary,
      headNote: d.headNote || null, filedAt: iso(d.createdAt), ...(withBody ? { body: d.body || "" } : {}),
    })),
    moreNotShown: Math.max(0, open.length - 50),
    recentShifts: shiftSnap.docs.map((d) => {
      const s = d.data() || {};
      return { worker: s.worker, status: s.status, engine: s.engine, startedAt: iso(s.startedAt), summary: s.summary };
    }),
  };
}

// eslint-disable-next-line no-control-regex
const plain = (v, max) => String(v == null ? "" : v).replace(/[\u0000-\u001F\u007F]/g, "").trim().slice(0, max);

// Presence, not data: a worker's hqActive doc says it is on shift right now,
// so the HQ can draw it at its desk working. Filing or logging the shift ends
// it; the HQ also ignores one older than two hours (a run that died quietly).
async function clockIn(db, input, now) {
  const i = input || {};
  const dept = seatRoom(i.worker);
  await db.collection("hqActive").doc(i.worker).set({
    worker: i.worker, dept, task: plain(i.task, 120) || null, since: now, endedAt: null,
  });
  return { ok: true, clockedIn: i.worker, note: "The owner's HQ now shows you at your desk. File or log the shift to clock out." };
}

async function clockOut(db, worker, now) {
  try {
    await db.collection("hqActive").doc(worker).set({ endedAt: now }, { merge: true });
  } catch (e) {
    // Best effort: the HQ stops showing a stale shift after two hours anyway.
  }
}

// Run one HQ tool. Throws DoorError (code "invalid-argument") for bad input;
// the connector turns that into a readable tool error.
async function runHqTool(name, input, { db, now = Date.now() }) {
  switch (name) {
    case "hq_file_report": return fileReport(db, input, now);
    case "hq_log_shift": return logOnly(db, input, now);
    case "hq_read_desk": return readDesk(db, input);
    case "hq_clock_in": return clockIn(db, input, now);
    default: throw new DoorError(`Unknown HQ tool "${name}".`);
  }
}

module.exports = { HQ_TOOLS, HQ_SEATS, CREW_SEATS, runHqTool };
