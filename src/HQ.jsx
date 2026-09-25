// Smooth Training HQ — Kevin's business crew, drawn as a building (S238).
//
// Piece 1 of the HQ: the building and the org chart. Every department is a room
// in a cutaway of a Miami gym at night; every seat has a title; hired workers
// sit at their desks and open seats are empty chairs. Tap a room to see who
// works there and how Kevin will use that department.
//
// Piece 2: the desk and the time cards are live. Both come from the `hqApi`
// callable (functions/hq.js), which checks the owner's uid on the server —
// the collections themselves are Admin-SDK-only, so the app never reads them
// directly and no other account can either.
//
// ⚠️ ADMIN ONLY, AND LAZY ON PURPOSE. The ≡ menu row that opens this renders
// only for the owner's uid, and App.jsx imports this file with lazy(), so no
// other account ever downloads it. The bundle holds NO business data — titles
// and job descriptions only (see hqOrg.js). Reports and drafts arrive at run
// time from the server-checked callable, never baked into this file.
//
// ⚠️ NOT THE REEL'S ART. The Instagram reel that started this used StarNet,
// whose sprites and artwork belong to its author. Everything here is drawn in
// hqPixels.js from rectangles, in Smooth Training's black and cyan.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { httpsCallable } from "firebase/functions";
import { functions } from "./firebase.js";
import {
  ROOMS, FLOORS, SEATS, CREW_RULES, BLUEPRINT, ENGINES,
  roomById, seatById, roomsOnFloor, orgCounts, roomSummary, liveSeats, headOf,
} from "./hqOrg.js";
import { W, H, roomScene, seatCenters, palmTree, van, PALM_W, PALM_H, VAN_W, VAN_H } from "./hqPixels.js";
import HQStation from "./HQStation.jsx";
import { deliveriesDue } from "./hqStation.js";
import HQSpend, { SPEND_CSS, money } from "./HQSpend.jsx";

const FONT_ID = "hq-silkscreen";
const FONT_HREF = "https://fonts.googleapis.com/css2?family=Silkscreen:wght@400;700&display=swap";

// The Chief of Staff's wall board lights one bar per department, in this order.
const BOARD_ORDER = ["finance", "ops", "marketing", "research", "front", "coaching"];
const DEPT_ROOMS = ROOMS.filter((r) => r.id !== "owner" && r.id !== "chief");

const STATUS_LABEL = { you: "You", "on-shift": "On shift", working: "Working", training: "In training", open: "Open position" };
const BLUEPRINT_LABEL = { built: "Built", next: "Next", planned: "Planned" };
const KIND_LABEL = { report: "Report", draft: "Draft to review", question: "Question for you", alert: "Heads-up", note: "Note" };
const SHIFT_LABEL = { done: "Done", failed: "Didn't finish", skipped: "Skipped" };

// The one door to the desk: owner-checked on the server (functions/hq.js).
const callHq = httpsCallable(functions, "hqApi");

// A failed call says what happened and what to do, never a bare error code.
// "not-found" means two different things: on a load, the desk's server piece
// isn't there to answer (not deployed yet); on a status change, the item
// itself is gone.
function deskError(e, during = "load") {
  const code = String((e && e.code) || "").replace(/^functions\//, "");
  if (code === "permission-denied") return "This desk only opens for the owner's account.";
  if (code === "unauthenticated") return "Your sign-in has expired. Close the HQ, sign in again and reopen it.";
  if (code === "not-found") {
    return during === "resolve"
      ? "That item is no longer on your desk. Refresh to see the latest."
      : "Your desk isn't switched on yet. Try again in a few minutes.";
  }
  return "Couldn't reach your desk. Check your connection, then tap Refresh.";
}

function fmtWhen(ms) {
  if (!Number.isFinite(ms)) return "";
  const d = new Date(ms);
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const today = new Date();
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return `Today ${time}`;
  if (d.toDateString() === yesterday.toDateString()) return `Yesterday ${time}`;
  return `${d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })} · ${time}`;
}

function fmtDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return "";
  const m = Math.round(ms / 60000);
  if (m < 1) return "under a minute";
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

const workerTitle = (id) => (seatById(id) || {}).title || id;
const workerShort = (id) => (seatById(id) || {}).short || id;
const deptName = (id) => (roomById(id) || {}).name || id;

// The departments list on the station's left, in building order.
const DEPT_ORDER = ["owner", "chief", "finance", "ops", "coaching", "marketing", "research", "front"];
const VIEW_KEY = "glidna-hq-view";
const DELIVERED_KEY = "glidna-hq-delivered";
const DELIVERED_CAP = 300;
const POLL_MS = 60000;

function readDelivered() {
  try {
    const arr = JSON.parse(localStorage.getItem(DELIVERED_KEY) || "[]");
    return new Set(Array.isArray(arr) ? arr.filter((x) => typeof x === "string") : []);
  } catch { return new Set(); }
}

function readView() {
  try { return localStorage.getItem(VIEW_KEY) === "building" ? "building" : "station"; } catch { return "station"; }
}

function clock(ms) {
  if (!Number.isFinite(ms)) return "";
  const d = new Date(ms);
  const today = new Date();
  const hm = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
  return d.toDateString() === today.toDateString() ? hm : `${d.toLocaleDateString([], { month: "numeric", day: "numeric" })} ${hm}`;
}

// The crew log: real events only — a shift clocked, an item filed, an item
// handled. With none yet, it says where each hired worker stands.
function crewLog(desk) {
  const rows = [];
  for (const a of desk.active || []) {
    rows.push({ at: a.since, who: workerShort(a.worker), text: `clocked in${a.task ? ` · ${a.task}` : ""}` });
  }
  for (const sh of desk.shifts || []) {
    rows.push({ at: sh.startedAt, who: workerShort(sh.worker), text: `${SHIFT_LABEL[sh.status] || sh.status}${sh.summary ? ` · ${sh.summary}` : ""}` });
  }
  for (const it of desk.open || []) rows.push({ at: it.createdAt, who: workerShort(it.worker), text: `to your desk · ${it.title}` });
  for (const it of desk.recent || []) rows.push({ at: it.resolvedAt, who: "You", text: `${it.status === "done" ? "done" : "dismissed"} · ${it.title}` });
  return rows.filter((r) => Number.isFinite(r.at)).sort((a, b) => b.at - a.at).slice(0, 12);
}

// Fixed star positions, so the sky doesn't reshuffle on every render.
const STARS = [
  [4, 14, 0], [11, 38, 1.2], [19, 9, 2.1], [27, 30, 0.6], [34, 16, 1.8], [45, 8, 0.3],
  [52, 34, 2.4], [61, 13, 1.1], [68, 27, 0.9], [76, 7, 2.7], [83, 36, 1.5], [91, 18, 0.2], [96, 31, 2],
];

// A small pixel moon, 9 × 9.
const MOON = [
  [3, 0, 3, 1], [1, 1, 7, 1], [1, 2, 8, 1], [0, 3, 9, 3], [1, 6, 8, 1], [1, 7, 7, 1], [3, 8, 3, 1],
].map(([x, y, w, h]) => [x, y, w, h, "#E6F4F2"]).concat([
  [2, 3, 2, 2, "#C9DEDC"], [6, 5, 1, 1, "#C9DEDC"], [5, 2, 1, 1, "#C9DEDC"],
]);

// Live seats (hqOrg.js liveSeats), filtered to one room.
const inRoom = (seats, roomId) => seats.filter((s) => s.room === roomId);
const headIn = (seats, roomId) => seats.find((s) => s.room === roomId && (s.role === "head" || s.role === "owner")) || null;

function deptState(roomId, seats = SEATS) {
  const mine = inRoom(seats, roomId);
  if (mine.some((s) => s.status === "working" || s.status === "on-shift")) return "on";
  if (mine.some((s) => s.status === "training")) return "training";
  return "open";
}

function Pixels({ rects, w, h, className }) {
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className={className} shapeRendering="crispEdges"
      preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false">
      {rects.map(([x, y, rw, rh, fill, cls], i) => (
        <rect key={i} x={x} y={y} width={rw} height={rh} fill={fill} className={cls} />
      ))}
    </svg>
  );
}

function Room({ room, selected, onSelect, boardLights, allSeats }) {
  const seats = inRoom(allSeats, room.id);
  const xs = seatCenters(room.id, seats.length);
  const lit = seats.some((s) => s.status !== "open");
  const rects = useMemo(
    // `seats` is static structure keyed by the room, and the parent memoizes
    // `boardLights`, so the room id, lighting and board are the whole input.
    () => roomScene(room.id, seats, { lit, boardLights }),
    [room.id, lit, boardLights],
  );
  return (
    <button type="button" onClick={() => onSelect(room.id)} aria-pressed={selected}
      aria-label={`${room.name}. ${roomSummary(room.id, allSeats)}.`}
      className={`hq-room${selected ? " is-selected" : ""}${lit ? "" : " is-dark"}`}>
      <Pixels rects={rects} w={W} h={H} className="hq-room-art" />
      <span className="hq-room-label" aria-hidden="true">
        <span className="hq-room-name">{room.name}</span>
        <span className="hq-room-sum">{roomSummary(room.id, allSeats)}</span>
      </span>
      {/* In a room of three or four, every other tag rides one row higher, so
          neighbouring tags never overlap on a phone-width room. */}
      {seats.map((s, i) => (
        <span key={s.id} aria-hidden="true"
          className={`hq-tag hq-tag-${s.status}${seats.length > 2 && i % 2 ? " hq-tag-up" : ""}`}
          style={{ left: `${(xs[i] / W) * 100}%` }}>{s.short}</span>
      ))}
      {seats.map((s, i) => (s.status === "training" ? (
        <span key={`${s.id}-bubble`} aria-hidden="true" className="hq-bubble"
          style={{ left: `${((xs[i] + 7) / W) * 100}%` }}>&hellip;</span>
      ) : null))}
      {!lit && <span className="hq-hiring" aria-hidden="true">Hiring</span>}
    </button>
  );
}

function StatusPill({ status }) {
  return <span className={`hq-pill hq-pill-${status}`}>{STATUS_LABEL[status] || status}</span>;
}

function SeatRow({ s, lastShift }) {
  return (
    <li className={`hq-seat hq-seat-${s.status}`}>
      <div className="hq-seat-head">
        <span className="hq-seat-title">{s.title}</span>
        <StatusPill status={s.status} />
      </div>
      {s.role === "head" && <span className="hq-seat-role">Department head</span>}
      <p className="hq-seat-job">{s.job}</p>
      {s.engine && ENGINES[s.engine] && <p className="hq-seat-meta">Runs on: {ENGINES[s.engine].label}</p>}
      {lastShift && (
        <p className="hq-seat-meta">Last shift: {fmtWhen(lastShift.startedAt)} · {SHIFT_LABEL[lastShift.status] || lastShift.status}</p>
      )}
      {s.waitingOn && <p className="hq-seat-note">First shift after: {s.waitingOn}</p>}
      {s.hireWhen && <p className="hq-seat-note">When to hire: {s.hireWhen}</p>}
    </li>
  );
}

function DeptPanel({ roomId, panelRef, shifts, allSeats }) {
  const room = roomById(roomId);
  const seats = inRoom(allSeats, roomId);
  // Shifts arrive newest first, so the first one per worker is its latest.
  const lastShift = (seatId) => (shifts || []).find((sh) => sh.worker === seatId) || null;
  return (
    <section className="hq-card hq-dept" aria-labelledby="hq-dept-title" ref={panelRef} tabIndex={-1}>
      <div className="hq-eyebrow">Floor {room.floor} · {room.tagline}</div>
      <h2 id="hq-dept-title" className="hq-h2">{room.name}</h2>
      <p className="hq-uses"><span className="hq-uses-label">How you&rsquo;ll use it</span>{room.uses}</p>
      <ul className="hq-seats">
        {seats.map((s) => <SeatRow key={s.id} s={s} lastShift={lastShift(s.id)} />)}
      </ul>
    </section>
  );
}

function DeskItem({ item, onStatus }) {
  const head = headOf(item.dept);
  return (
    <li className={`hq-item hq-item-${item.kind}`}>
      {/* The kind rides in the meta line, not beside the title: beside it, a
          phone squeezed the title into a one-word-wide column. */}
      <div className="hq-item-meta">
        <span className="hq-eyebrow">{deptName(item.dept)}</span>
        <span>{workerTitle(item.worker)}</span>
        <span>{fmtWhen(item.createdAt)}</span>
        <span className="hq-kind">{KIND_LABEL[item.kind] || item.kind}</span>
      </div>
      <h3 className="hq-item-title">{item.title}</h3>
      {item.summary && <p className="hq-item-summary">{item.summary}</p>}
      {item.headNote && (
        <div className="hq-headnote">
          <span className="hq-headnote-label">{head && head.role === "head" ? `${head.title}'s note` : "Manager's note"}</span>
          <p>{item.headNote}</p>
        </div>
      )}
      {item.body && (
        <details className="hq-item-body">
          <summary>Read the full {item.kind === "draft" ? "draft" : item.kind === "report" ? "report" : "details"}</summary>
          <div className="hq-body">{item.body}</div>
        </details>
      )}
      <div className="hq-item-actions">
        {item.link && (
          <a className="hq-btn hq-btn-primary" href={item.link.url} target="_blank" rel="noopener noreferrer">{item.link.label}</a>
        )}
        <button type="button" className={`hq-btn ${item.link ? "hq-btn-ghost" : "hq-btn-primary"}`}
          onClick={() => onStatus(item, "done")}>Mark done</button>
        <button type="button" className="hq-btn hq-btn-ghost" onClick={() => onStatus(item, "dismissed")}>Dismiss</button>
      </div>
    </li>
  );
}

function ShiftRow({ sh }) {
  const engine = ENGINES[sh.engine];
  return (
    <li className={`hq-shift hq-shift-${sh.status}`}>
      <div className="hq-row">
        <span className="hq-shift-who">{workerTitle(sh.worker)}</span>
        <span className={`hq-pill hq-pill-shift-${sh.status}`}>{SHIFT_LABEL[sh.status] || sh.status}</span>
      </div>
      <div className="hq-shift-meta">
        <span>{fmtWhen(sh.startedAt)}</span>
        {sh.endedAt > sh.startedAt && <span>{fmtDuration(sh.endedAt - sh.startedAt)}</span>}
        {engine && <span>{engine.label}</span>}
        {Number.isFinite(sh.costCents) && <span>{sh.costCents < 1 ? "under 1¢" : `${Math.round(sh.costCents)}¢`}</span>}
      </div>
      {sh.summary && <p className="hq-shift-summary">{sh.summary}</p>}
      {Array.isArray(sh.actions) && sh.actions.length > 0 && (
        <details className="hq-shift-actions">
          <summary>What it did ({sh.actions.length})</summary>
          <ol>{sh.actions.map((a, i) => <li key={i}>{a}</li>)}</ol>
        </details>
      )}
    </li>
  );
}

// `sample` is the dev-only preview's example desk (src/hqSamples.js). With it,
// nothing is fetched and a tap only changes the screen.
export default function HQ({ onClose, ownerName = "", sample = null }) {
  const [selected, setSelected] = useState("finance");
  const [desk, setDesk] = useState(() => (sample
    ? { phase: "ready", open: sample.open, recent: sample.recent, shifts: sample.shifts, active: sample.active || [], openMore: false }
    : { phase: "loading", open: [], recent: [], shifts: [], active: [], openMore: false }));
  const [deskErr, setDeskErr] = useState("");
  // This month's spending for the station's numbers; the sheet asks for more.
  const [spend, setSpend] = useState(() => (sample ? sample.spend("month", 0) : null));
  const [spendView, setSpendView] = useState(null);
  const spendViewRef = useRef(null);
  const spendOpener = useRef(null);
  const rootRef = useRef(null);
  const panelRef = useRef(null);
  const deskRef = useRef(null);
  // The seats as the crew has actually left them: clocked in → on shift, has
  // done real work → working (hqOrg.js liveSeats). Keyed by a signature so a
  // poll that changes nothing doesn't rebuild the map under the walkers.
  const live = liveSeats(SEATS, desk);
  const seatSig = live.map((s) => `${s.id}:${s.status}`).join(",");
  const seats = useMemo(() => live, [seatSig]);
  const counts = orgCounts(seats);
  const firstName = String(ownerName || "").trim().split(/\s+/)[0] || "";
  const boardLights = useMemo(() => BOARD_ORDER.map((id) => deptState(id, seats)), [seats]);
  // Each room's door light on the station map: the owner's office is always
  // lit, since that is where Kevin sits.
  const roomStates = useMemo(() => Object.fromEntries(
    ROOMS.map((r) => [r.id, r.id === "owner" ? "on" : deptState(r.id, seats)])), [seats]);
  const [view, setView] = useState(readView);
  const chooseView = (v) => {
    setView(v);
    try { localStorage.setItem(VIEW_KEY, v); } catch { /* a private window keeps the default */ }
  };
  const palm = useMemo(() => palmTree(), []);
  const vanRects = useMemo(() => van(), []);
  const reduceMotion = typeof window !== "undefined" && window.matchMedia
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // The pixel face, loaded only when the HQ opens.
  useEffect(() => {
    if (document.getElementById(FONT_ID)) return;
    const link = document.createElement("link");
    link.id = FONT_ID;
    link.rel = "stylesheet";
    link.href = FONT_HREF;
    document.head.appendChild(link);
  }, []);

  // Full-screen: the page behind stops scrolling, Escape closes, and focus
  // moves into the dialog (onto the dialog itself, so no button wears a focus
  // ring the moment it opens). Runs ONCE: the menu passes a fresh onClose on
  // every render, and re-running this would yank focus back each time the menu
  // behind it re-rendered. The ref keeps Escape calling the latest one.
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  const closeSpendRef = useRef(() => {});
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // Escape closes the spending sheet first, and the HQ only when nothing
    // is open over it.
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      if (spendViewRef.current) { closeSpendRef.current(); return; }
      if (onCloseRef.current) onCloseRef.current();
    };
    window.addEventListener("keydown", onKey);
    if (rootRef.current) rootRef.current.focus({ preventScroll: true });
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  // The whole desk in one round trip: open items, recently handled ones and
  // the latest time cards.
  const load = useCallback(async ({ quiet = false } = {}) => {
    if (sample) return;
    if (!quiet) setDesk((d) => ({ ...d, phase: d.phase === "loading" ? "loading" : "refreshing" }));
    try {
      const { data } = await callHq({ action: "overview" });
      setDesk({
        phase: "ready",
        open: Array.isArray(data && data.open) ? data.open : [],
        recent: Array.isArray(data && data.recent) ? data.recent : [],
        shifts: Array.isArray(data && data.shifts) ? data.shifts : [],
        active: Array.isArray(data && data.active) ? data.active : [],
        openMore: !!(data && data.openMore),
      });
      setDeskErr("");
    } catch (e) {
      // Keep whatever was already on screen; only a first load has nothing to show.
      if (!quiet) {
        setDesk((d) => ({ ...d, phase: d.phase === "loading" ? "error" : "ready" }));
        setDeskErr(deskError(e));
      }
    }
  }, [sample]);
  useEffect(() => { load(); }, [load]);

  // While the HQ is open and on screen, look again every minute, so a worker
  // clocking in or filing something shows up without a tap on Refresh.
  useEffect(() => {
    if (sample) return undefined;
    const id = setInterval(() => {
      if (typeof document === "undefined" || document.visibilityState === "visible") load({ quiet: true });
    }, POLL_MS);
    return () => clearInterval(id);
  }, [sample, load]);

  // Deliveries: every new item on the desk is walked to the owner's office by
  // the worker who filed it. Which items have already been carried is
  // remembered on this device, so a report is delivered once, not every time
  // the HQ opens. Items older than a week just count as delivered.
  const [delivered, setDelivered] = useState(readDelivered);
  const markDelivered = useCallback((ids) => {
    if (!ids || !ids.length) return;
    setDelivered((prev) => {
      const next = [...new Set([...prev, ...ids])].slice(-DELIVERED_CAP);
      try { localStorage.setItem(DELIVERED_KEY, JSON.stringify(next)); } catch { /* this device only */ }
      return new Set(next);
    });
  }, []);
  const toDeliver = useMemo(() => deliveriesDue(desk.open, delivered), [desk.open, delivered]);

  // Spending, through the same owner-checked door. A failure here leaves the
  // station's money numbers as dashes rather than zeros that look real.
  const loadSpend = useCallback(async (period, offset) => {
    if (sample) return sample.spend(period, offset);
    try {
      const { data } = await callHq({ action: "spend", period, offset });
      return data;
    } catch (e) {
      throw new Error(deskError(e));
    }
  }, [sample]);
  const saveCosts = useCallback(async (patch) => {
    if (sample) throw new Error("The preview can't change prices.");
    try {
      await callHq({ action: "setCosts", ...patch });
    } catch (e) {
      throw new Error(deskError(e));
    }
    try { setSpend(await loadSpend("month", 0)); } catch { /* the sheet shows its own error */ }
  }, [sample, loadSpend]);
  useEffect(() => {
    if (sample) return;
    let alive = true;
    loadSpend("month", 0).then((r) => { if (alive) setSpend(r); }).catch(() => {});
    return () => { alive = false; };
  }, [sample, loadSpend]);
  const openSpend = (focus, e) => {
    spendOpener.current = e && e.currentTarget;
    spendViewRef.current = focus;
    setSpendView(focus);
  };
  const closeSpend = () => {
    spendViewRef.current = null;
    setSpendView(null);
    const back = spendOpener.current;
    if (back && back.focus) requestAnimationFrame(() => back.focus({ preventScroll: true }));
  };
  closeSpendRef.current = closeSpend;

  // Mark done, dismiss or undo. The screen changes at once; if the server
  // refuses, the item goes back where it was and the reason is shown.
  const setStatus = async (item, status) => {
    const before = desk;
    const now = Date.now();
    setDesk((d) => {
      const without = (list) => list.filter((x) => x.id !== item.id);
      if (status === "open") {
        const back = { ...item, status: "open", resolvedAt: null };
        return { ...d, recent: without(d.recent), open: [back, ...without(d.open)].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)) };
      }
      return { ...d, open: without(d.open), recent: [{ ...item, status, resolvedAt: now }, ...without(d.recent)] };
    });
    if (sample) return;
    try {
      await callHq({ action: "resolve", id: item.id, status });
      setDeskErr("");
    } catch (e) {
      setDesk(before);
      setDeskErr(`Couldn't update “${item.title}”. ${deskError(e, "resolve")}`);
    }
  };

  // The station's numbers. AI spend is this month's Glidna AI plus the crew's
  // cloud shifts — the spending that moves with use. The Claude plan is flat,
  // so its number is how many crew shifts ran on it this month.
  const deskKnown = desk.phase === "ready" || desk.phase === "refreshing";
  const onShift = counts.onShift;
  const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
  const shiftsToday = desk.shifts.filter((sh) => sh.startedAt >= dayStart.getTime()).length;
  const aiSpendCents = spend ? spend.glidna.cents + spend.crew.cloudCents : null;
  const claudeRuns = spend ? spend.crew.claudeShifts : null;
  const log = crewLog(desk);

  const behavior = reduceMotion ? "auto" : "smooth";
  const pick = (roomId) => {
    setSelected(roomId);
    // The panel's heading has to be on screen, or the tap looks like it did
    // nothing: on a phone the panel sits below the whole building, and from the
    // org chart it sits above. Only its TOP counts — a tall panel can have its
    // tail in view while the name of the department you picked is not.
    requestAnimationFrame(() => {
      const el = panelRef.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top;
      if (top < 64 || top > window.innerHeight - 160) el.scrollIntoView({ behavior, block: "start" });
    });
  };
  const showDesk = () => deskRef.current && deskRef.current.scrollIntoView({ behavior, block: "start" });

  const owner = seats.find((s) => s.role === "owner");
  const chief = headIn(seats, "chief");

  return createPortal(
    <div className="hq-root" role="dialog" aria-modal="true" aria-label="Smooth Training HQ" ref={rootRef} tabIndex={-1}>
      <style>{CSS + SPEND_CSS}</style>
      <header className="hq-top">
        <button type="button" className="hq-close" onClick={onClose} aria-label="Close HQ">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2"
            strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 12H4" /><path d="m10 6-6 6 6 6" /></svg>
        </button>
        <div className="hq-brand">
          <span className="hq-brand-name">Smooth Training</span>
          <span className="hq-brand-hq">HQ</span>
        </div>
        <span className="hq-only">Only you can see this</span>
      </header>

      <main className="hq-wrap">
        <p className="hq-hello">{firstName ? `Welcome in, ${firstName}.` : "Welcome in."}</p>

        {sample && (
          <p className="hq-preview-note" role="note">
            Preview with example items. The real desk only opens for the owner&rsquo;s account.
          </p>
        )}

        <section className="hq-console" aria-label="The station">
          <div className="hq-console-top">
            {/* Six numbers, so a phone shows two even rows of three. Labels stay
                short enough not to be cut off at that width. */}
            <div className="hq-stat hq-stat-green"><span>On shift</span><b>{onShift}</b></div>
            <div className="hq-stat hq-stat-amber"><span>In training</span><b>{counts.training}</b></div>
            <div className="hq-stat"><span>Open seats</span><b>{counts.open}</b></div>
            <button type="button" className="hq-stat hq-stat-desk" onClick={showDesk}>
              <span>Your desk</span><b>{deskKnown ? desk.open.length : "–"}</b>
            </button>
            <button type="button" className="hq-stat hq-stat-desk" onClick={(e) => openSpend("all", e)}
              aria-label={aiSpendCents == null ? "AI spend this month. Open spending." : `AI spend this month: ${money(aiSpendCents)}. Open spending.`}>
              <span>AI spend</span><b>{aiSpendCents == null ? "–" : money(aiSpendCents)}</b>
            </button>
            <button type="button" className="hq-stat hq-stat-desk" onClick={(e) => openSpend("claude", e)}
              aria-label={claudeRuns == null ? "Crew shifts on your Claude plan this month. Open spending." : `${claudeRuns} crew shifts on your Claude plan this month. Open spending.`}>
              <span>Claude runs</span><b>{claudeRuns == null ? "–" : claudeRuns}</b>
            </button>
          </div>

          <div className="hq-console-grid">
            <aside className="hq-side hq-side-left" aria-label="Departments">
              <div className="hq-side-title">Departments</div>
              <ul className="hq-dept-list">
                {DEPT_ORDER.map((id) => {
                  const room = roomById(id);
                  const mine = inRoom(seats, id);
                  const filled = mine.filter((s) => s.status !== "open").length;
                  const training = mine.filter((s) => s.status === "training").length;
                  const working = mine.filter((s) => s.status === "working" || s.status === "on-shift").length;
                  const state = id === "owner" ? "you" : deptState(id, seats);
                  return (
                    <li key={id}>
                      <button type="button" onClick={() => pick(id)} aria-pressed={selected === id}
                        className={`hq-dept-row${selected === id ? " is-selected" : ""}`}>
                        <span className={`hq-dot hq-dot-${state === "on" ? "working" : state}`} aria-hidden="true" />
                        <span className="hq-dept-name">{room.name}</span>
                        <span className="hq-dept-num">{filled}/{seats.length}</span>
                        <span className="hq-dept-bar" aria-hidden="true"><i style={{ width: `${(filled / seats.length) * 100}%` }} /></span>
                        <span className="hq-dept-sub">{training ? `${training} in training` : filled ? "Staffed" : "Hiring"}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </aside>

            <div className="hq-center">
              {view === "station" ? (
                <HQStation seats={seats} roomStates={roomStates} board={boardLights}
                  selected={selected} onSelect={pick} reduceMotion={reduceMotion}
                  deliveries={toDeliver} onDelivered={markDelivered} deskCount={desk.open.length} />
              ) : (
                <section className="hq-building" aria-label="The building, floor by floor. Tap a room to see that department.">
                  <div className="hq-sky" aria-hidden="true">
                    {STARS.map(([left, top, delay], i) => (
                      <span key={i} className="hq-star" style={{ left: `${left}%`, top, animationDelay: `${delay}s` }} />
                    ))}
                    <Pixels rects={MOON} w={9} h={9} className="hq-moon" />
                  </div>
                  <div className="hq-sign" aria-hidden="true">
                    <span className="hq-sign-text">Smooth Training</span>
                    <span className="hq-sign-hq">HQ</span>
                  </div>
                  <div className="hq-tower">
                    {FLOORS.map((f) => (
                      <div className="hq-floor" key={f}>
                        <span className="hq-floor-no" aria-hidden="true">{f}F</span>
                        <div className="hq-floor-rooms">
                          {roomsOnFloor(f).map((room) => (
                            <Room key={room.id} room={room} selected={selected === room.id}
                              onSelect={pick} boardLights={boardLights} allSeats={seats} />
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="hq-street" aria-hidden="true">
                    <Pixels rects={palm} w={PALM_W} h={PALM_H} className="hq-palm hq-palm-l" />
                    <Pixels rects={vanRects} w={VAN_W} h={VAN_H} className="hq-van" />
                    <Pixels rects={palm} w={PALM_W} h={PALM_H} className="hq-palm hq-palm-r" />
                  </div>
                </section>
              )}
            </div>

            <aside className="hq-side hq-side-right" aria-label="Crew activity">
              <div className="hq-side-title">Your desk</div>
              <button type="button" className="hq-side-big" onClick={showDesk}>
                <b>{deskKnown ? desk.open.length : "–"}</b><span>waiting on you</span>
              </button>
              <div className="hq-side-title">Crew log{deskKnown && <span className="hq-side-count"> · {shiftsToday} today</span>}</div>
              {log.length > 0 ? (
                <ol className="hq-log">
                  {log.map((row, i) => (
                    <li key={i}><time>{clock(row.at)}</time><b>{row.who}</b><span>{row.text}</span></li>
                  ))}
                </ol>
              ) : (
                <ol className="hq-log hq-log-quiet">
                  {seats.filter((s) => s.status === "training").map((s) => (
                    <li key={s.id}><time>--:--</time><b>{s.short}</b><span>in training · first shift after {s.waitingOn}</span></li>
                  ))}
                </ol>
              )}
            </aside>
          </div>

          <div className="hq-console-foot">
            <span className="hq-legend-item"><span className="hq-dot hq-dot-on-shift" aria-hidden="true" /> On shift</span>
            <span className="hq-legend-item"><span className="hq-dot hq-dot-working" aria-hidden="true" /> Working</span>
            <span className="hq-legend-item"><span className="hq-dot hq-dot-training" aria-hidden="true" /> In training</span>
            <span className="hq-legend-item"><span className="hq-dot hq-dot-open" aria-hidden="true" /> Open seat</span>
            <span className="hq-view" role="group" aria-label="Map style">
              <button type="button" aria-pressed={view === "station"} onClick={() => chooseView("station")}>Station</button>
              <button type="button" aria-pressed={view === "building"} onClick={() => chooseView("building")}>Building</button>
            </span>
          </div>
        </section>

        <DeptPanel roomId={selected} panelRef={panelRef} shifts={desk.shifts} allSeats={seats} />

        <section className="hq-card hq-desk" aria-labelledby="hq-desk-title" ref={deskRef} tabIndex={-1}>
          <div className="hq-row">
            <h2 id="hq-desk-title" className="hq-h2">Your desk</h2>
            <div className="hq-row-end">
              <span className="hq-count">{desk.phase === "ready" || desk.phase === "refreshing" ? `${desk.open.length} waiting` : ""}</span>
              {!sample && (
                <button type="button" className="hq-btn hq-btn-ghost" onClick={load}
                  disabled={desk.phase === "loading" || desk.phase === "refreshing"}>
                  {desk.phase === "refreshing" ? "Refreshing…" : "Refresh"}
                </button>
              )}
            </div>
          </div>
          {deskErr && <p className="hq-error" role="alert">{deskErr}</p>}
          {desk.phase === "loading" && <p className="hq-quiet">Checking your desk…</p>}
          {(desk.phase === "ready" || desk.phase === "refreshing") && desk.open.length === 0 && (
            <div className="hq-empty">
              <p><strong>Nothing needs you right now.</strong></p>
              <p>When a worker finishes a draft, a report or a question for you, it lands here with its
                department head&rsquo;s note on top. Nothing goes out until you say so.</p>
            </div>
          )}
          {desk.open.length > 0 && (
            <ul className="hq-items">
              {desk.open.map((item) => <DeskItem key={item.id} item={item} onStatus={setStatus} />)}
            </ul>
          )}
          {desk.openMore && <p className="hq-quiet">Showing your 300 newest waiting items.</p>}
          {desk.recent.length > 0 && (
            <details className="hq-recent">
              <summary>Recently handled ({desk.recent.length})</summary>
              <ul className="hq-recent-list">
                {desk.recent.map((item) => (
                  <li key={item.id}>
                    <span className={`hq-pill hq-pill-${item.status}`}>{item.status === "done" ? "Done" : "Dismissed"}</span>
                    <span className="hq-recent-title">{item.title}</span>
                    <span className="hq-recent-when">{fmtWhen(item.resolvedAt)}</span>
                    <button type="button" className="hq-link" onClick={() => setStatus(item, "open")}
                      aria-label={`Put “${item.title}” back on your desk`}>Undo</button>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>

        <section className="hq-card" aria-labelledby="hq-shifts-title">
          <h2 id="hq-shifts-title" className="hq-h2">Time cards</h2>
          <p className="hq-sub">Every shift is logged: when a worker clocked in, what it looked at and what it handed you.</p>
          {desk.phase === "loading" && <p className="hq-quiet">Loading time cards…</p>}
          {desk.phase !== "loading" && desk.shifts.length === 0 && (
            <div className="hq-empty"><p>No shifts yet. Each worker&rsquo;s first shift will show up here.</p></div>
          )}
          {desk.shifts.length > 0 && (
            <ul className="hq-shifts">
              {desk.shifts.map((sh) => <ShiftRow key={sh.id} sh={sh} />)}
            </ul>
          )}
        </section>

        <section className="hq-card" aria-labelledby="hq-org-title">
          <h2 id="hq-org-title" className="hq-h2">Org chart</h2>
          <p className="hq-sub">Every seat in the building, from the top down.</p>
          <div className="hq-org-top">
            <div className="hq-org-node hq-org-owner">
              <span className="hq-org-title">{owner.title}</span>
              <span className="hq-org-who">{firstName || "You"}</span>
            </div>
            <div className="hq-org-line" aria-hidden="true" />
            <div className="hq-org-node">
              <span className="hq-org-title">{chief.title}</span>
              <StatusPill status={chief.status} />
            </div>
            <div className="hq-org-line" aria-hidden="true" />
          </div>
          <div className="hq-org-grid">
            {DEPT_ROOMS.map((room) => {
              const head = headIn(seats, room.id);
              const workers = inRoom(seats, room.id).filter((s) => s.role === "worker");
              return (
                <article key={room.id} className="hq-org-dept">
                  <div className="hq-row">
                    <h3 className="hq-org-name">{room.name}</h3>
                    <button type="button" className="hq-link" onClick={() => pick(room.id)}
                      aria-label={`Show ${room.name}`}>Show</button>
                  </div>
                  <div className="hq-org-head">
                    <span className={`hq-dot hq-dot-${head.status}`} aria-hidden="true" />
                    <span>{head.title}</span>
                    <span className="hq-org-tag">Head</span>
                  </div>
                  <ul className="hq-org-workers">
                    {workers.map((w) => (
                      <li key={w.id}>
                        <span className={`hq-dot hq-dot-${w.status}`} aria-hidden="true" />
                        <span>{w.title}</span>
                        <span className="hq-sr">({STATUS_LABEL[w.status]})</span>
                      </li>
                    ))}
                  </ul>
                </article>
              );
            })}
          </div>
          <p className="hq-legend">
            <span><span className="hq-dot hq-dot-working" aria-hidden="true" /> Working</span>
            <span><span className="hq-dot hq-dot-training" aria-hidden="true" /> In training</span>
            <span><span className="hq-dot hq-dot-open" aria-hidden="true" /> Open position</span>
          </p>
        </section>

        <section className="hq-card" aria-labelledby="hq-rules-title">
          <h2 id="hq-rules-title" className="hq-h2">How the crew works</h2>
          <p className="hq-sub">Workers, not machines left to run loose. Every one of them follows these rules.</p>
          <ul className="hq-rules">
            {CREW_RULES.map((r) => (
              <li key={r.title}><strong>{r.title}</strong><span>{r.body}</span></li>
            ))}
          </ul>
        </section>

        <section className="hq-card" aria-labelledby="hq-plan-title">
          <h2 id="hq-plan-title" className="hq-h2">Building plan</h2>
          <p className="hq-sub">The HQ goes up one piece at a time, in this order.</p>
          <ol className="hq-plan">
            {BLUEPRINT.map((b) => (
              <li key={b.id} className={`hq-plan-item hq-plan-${b.status}`}>
                <div className="hq-row">
                  <span className="hq-plan-title">{b.title}</span>
                  <span className={`hq-pill hq-pill-plan-${b.status}`}>{BLUEPRINT_LABEL[b.status]}</span>
                </div>
                <span className="hq-plan-use">{b.use}</span>
              </li>
            ))}
          </ol>
        </section>
      </main>
      {spendView && (
        <HQSpend load={loadSpend} saveCosts={saveCosts} initial={spend} focus={spendView} onClose={closeSpend} />
      )}
    </div>,
    document.body,
  );
}

const CSS = `
.hq-root {
  --hq-bg: #05080A; --hq-panel: #0C1417; --hq-panel2: #111C20;
  --hq-line: #1F3236; --hq-line2: #2E4241;
  --hq-text: #EAFCFC; --hq-muted: #93ADAD; --hq-cyan: #08DCE0; --hq-amber: #FBBF24;
  --hq-pixel: "Silkscreen", ui-monospace, "SF Mono", Menlo, Consolas, monospace;
  --hq-display: "Sora", system-ui, -apple-system, "Segoe UI", sans-serif;
  --hq-body: "DM Sans", system-ui, -apple-system, "Segoe UI", sans-serif;
  position: fixed; inset: 0; z-index: 2400; overflow-y: auto; -webkit-overflow-scrolling: touch;
  background: var(--hq-bg); color: var(--hq-text); font-family: var(--hq-body); font-size: 15px; line-height: 1.5;
  color-scheme: dark; overscroll-behavior: contain;
}
.hq-root *, .hq-root *::before, .hq-root *::after { box-sizing: border-box; }
.hq-root button { font: inherit; color: inherit; }
.hq-root :focus-visible { outline: 2px solid var(--hq-cyan); outline-offset: 2px; }
.hq-root:focus, .hq-root:focus-visible { outline: none; }

.hq-top {
  position: sticky; top: 0; z-index: 5; display: flex; align-items: center; gap: 12px;
  padding: calc(10px + env(safe-area-inset-top, 0px)) 16px 10px;
  background: rgba(5, 8, 10, .92); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);
  border-bottom: 1px solid var(--hq-line);
}
.hq-close {
  display: grid; place-items: center; width: 38px; height: 38px; flex: none; cursor: pointer;
  border-radius: 10px; border: 1px solid var(--hq-line2); background: var(--hq-panel); color: var(--hq-cyan);
}
.hq-brand { display: flex; align-items: baseline; gap: 8px; min-width: 0; }
.hq-brand-name { font-family: var(--hq-pixel); font-size: 15px; letter-spacing: .04em; text-transform: uppercase; white-space: nowrap; }
.hq-brand-hq { font-family: var(--hq-pixel); font-size: 15px; color: var(--hq-cyan); text-shadow: 0 0 10px rgba(8,220,224,.55); }
.hq-only { margin-left: auto; font-size: 12px; color: var(--hq-muted); white-space: nowrap; }
@media (max-width: 420px) { .hq-only { display: none; } }

.hq-wrap { max-width: 1200px; margin: 0 auto; padding-inline: 16px; padding-block: 16px calc(48px + env(safe-area-inset-bottom, 0px)); display: grid; gap: 20px; }
.hq-intro { display: grid; gap: 10px; }
.hq-hello { margin: 0; font-family: var(--hq-display); font-size: 22px; font-weight: 700; letter-spacing: -.01em; text-wrap: balance; }
.hq-glance { display: flex; flex-wrap: wrap; gap: 8px; }
.hq-chip {
  display: inline-flex; align-items: baseline; gap: 6px; padding: 6px 12px; border-radius: 999px;
  border: 1px solid var(--hq-line2); background: var(--hq-panel); font-size: 13px; color: var(--hq-muted);
  font-variant-numeric: tabular-nums;
}
.hq-chip b { color: var(--hq-text); font-family: var(--hq-display); font-size: 14px; }
.hq-chip-training { border-color: rgba(251,191,36,.45); }
.hq-chip-training b { color: var(--hq-amber); }
.hq-chip-desk { cursor: pointer; border-color: rgba(8,220,224,.45); }
.hq-chip-desk b { color: var(--hq-cyan); }

/* ── The station console ────────────────────────────────────── */
.hq-console {
  border: 1px solid rgba(8,220,224,.4); border-radius: 12px; overflow: hidden;
  background: #020607; box-shadow: 0 0 0 1px #000, 0 0 28px rgba(8,220,224,.08);
}
/* Six numbers: three by two until there's room for all six in one row, so a
   row is never left with one number on its own. */
.hq-console-top {
  display: grid; grid-template-columns: repeat(3, minmax(0, 1fr));
  border-bottom: 1px solid rgba(8,220,224,.28); background: #03090A;
}
@media (min-width: 820px) { .hq-console-top { grid-template-columns: repeat(6, minmax(0, 1fr)); } }
.hq-stat {
  display: grid; gap: 2px; padding: 8px 12px; min-width: 0; text-align: left;
  border: 0; border-right: 1px solid rgba(8,220,224,.14); background: transparent; color: inherit;
  background-image: repeating-linear-gradient(0deg, rgba(8,220,224,.03) 0 1px, transparent 1px 3px);
}
.hq-stat span { font-family: var(--hq-pixel); font-size: 9px; letter-spacing: .06em; text-transform: uppercase; color: var(--hq-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.hq-stat b { font-family: var(--hq-pixel); font-weight: 400; font-size: 20px; line-height: 1.1; color: var(--hq-cyan); text-shadow: 0 0 8px rgba(8,220,224,.55); font-variant-numeric: tabular-nums; }
.hq-stat-green b { color: #2FE0A8; text-shadow: 0 0 8px rgba(47,224,168,.5); }
.hq-stat-amber b { color: var(--hq-amber); text-shadow: 0 0 8px rgba(251,191,36,.45); }
.hq-stat-desk { cursor: pointer; }
.hq-stat-desk:hover { background-color: rgba(8,220,224,.06); }

.hq-console-grid { display: grid; grid-template-columns: minmax(0, 1fr); grid-template-areas: "center" "left" "right"; }
@media (min-width: 760px) {
  .hq-console-grid { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); grid-template-areas: "center center" "left right"; }
}
@media (min-width: 1100px) {
  .hq-console-grid { grid-template-columns: 230px minmax(0, 1fr) 250px; grid-template-areas: "left center right"; }
}
.hq-center { grid-area: center; min-width: 0; background: #020405; }
.hq-side-left { grid-area: left; }
.hq-side-right { grid-area: right; }
.hq-side {
  display: grid; align-content: start; gap: 8px; padding: 12px; min-width: 0;
  border-top: 1px solid rgba(8,220,224,.14);
  background: #030809 repeating-linear-gradient(0deg, rgba(8,220,224,.025) 0 1px, transparent 1px 3px);
}
@media (min-width: 1100px) {
  .hq-side { border-top: 0; }
  .hq-side-left { border-right: 1px solid rgba(8,220,224,.2); }
  .hq-side-right { border-left: 1px solid rgba(8,220,224,.2); }
}
@media (min-width: 760px) and (max-width: 1099px) { .hq-side-left { border-right: 1px solid rgba(8,220,224,.14); } }
.hq-side-title { font-family: var(--hq-pixel); font-size: 10px; letter-spacing: .08em; text-transform: uppercase; color: var(--hq-cyan); padding-bottom: 4px; border-bottom: 1px dashed rgba(8,220,224,.25); }
.hq-side-count { color: var(--hq-muted); }
.hq-dept-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; }
.hq-dept-row {
  display: grid; grid-template-columns: 10px minmax(0, 1fr) auto; grid-template-rows: auto auto auto; column-gap: 8px; row-gap: 3px;
  width: 100%; padding: 7px 8px; border-radius: 6px; border: 1px solid transparent; background: transparent; color: inherit; cursor: pointer; text-align: left;
}
.hq-dept-row:hover { background: rgba(8,220,224,.05); }
.hq-dept-row.is-selected { border-color: rgba(8,220,224,.45); background: rgba(8,220,224,.07); }
.hq-dept-row .hq-dot { grid-row: 1; margin-top: 4px; }
.hq-dept-name { font-size: 13px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.hq-dept-num { font-family: var(--hq-pixel); font-size: 12px; color: var(--hq-cyan); font-variant-numeric: tabular-nums; }
.hq-dept-bar { grid-column: 2 / 4; height: 3px; background: #0E1A1D; border-radius: 2px; overflow: hidden; }
.hq-dept-bar i { display: block; height: 100%; background: var(--hq-cyan); box-shadow: 0 0 6px rgba(8,220,224,.6); }
.hq-dept-sub { grid-column: 2 / 4; font-size: 11.5px; color: var(--hq-muted); }
.hq-side-big { display: grid; justify-items: start; gap: 0; padding: 6px 2px; border: 0; background: transparent; color: inherit; cursor: pointer; text-align: left; }
.hq-side-big b { font-family: var(--hq-pixel); font-weight: 400; font-size: 34px; line-height: 1; color: var(--hq-cyan); text-shadow: 0 0 10px rgba(8,220,224,.6); }
.hq-side-big span { font-size: 12px; color: var(--hq-muted); }
.hq-log { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; font-size: 12px; line-height: 1.4; }
.hq-log li { display: grid; grid-template-columns: auto auto minmax(0, 1fr); gap: 6px; align-items: baseline; }
.hq-log time { font-family: var(--hq-pixel); font-size: 10px; color: #5F7878; font-variant-numeric: tabular-nums; }
.hq-log b { font-family: var(--hq-pixel); font-weight: 400; font-size: 10px; text-transform: uppercase; color: var(--hq-cyan); white-space: nowrap; }
.hq-log span { color: #C9DCDC; overflow-wrap: anywhere; }
.hq-log-quiet b { color: var(--hq-amber); }
.hq-console-foot {
  display: flex; flex-wrap: wrap; align-items: center; gap: 8px 16px; padding: 8px 12px;
  border-top: 1px solid rgba(8,220,224,.28); background: #03090A; font-size: 12px; color: var(--hq-muted);
}
.hq-legend-item { display: inline-flex; align-items: center; gap: 6px; }
.hq-view { margin-left: auto; display: inline-flex; border: 1px solid var(--hq-line2); border-radius: 8px; overflow: hidden; }
.hq-view button { border: 0; background: transparent; color: var(--hq-muted); padding: 5px 12px; font-family: var(--hq-pixel); font-size: 10px; letter-spacing: .06em; text-transform: uppercase; cursor: pointer; }
.hq-view button[aria-pressed="true"] { background: rgba(8,220,224,.14); color: var(--hq-cyan); }
.hq-dot-on { background: #2FE0A8; }

/* the map itself */
.hq-map { position: relative; line-height: 0; }
/* A faint screen over the map — scan lines and a darkened edge — so it reads
   as a live monitor rather than a picture. Purely visual; it never takes a tap. */
.hq-map::after {
  content: ""; position: absolute; inset: 0; pointer-events: none;
  background:
    repeating-linear-gradient(0deg, rgba(0,0,0,.16) 0 1px, transparent 1px 3px),
    radial-gradient(ellipse at center, transparent 58%, rgba(0,0,0,.45) 100%);
  box-shadow: inset 0 0 24px rgba(8,220,224,.12);
}
.hq-map canvas { display: block; width: 100%; height: auto; image-rendering: pixelated; image-rendering: crisp-edges; }
/* The painted station: the building is an image, the desks and crew a canvas
   laid exactly over it at the screen's own resolution. */
.hq-map-art { display: block; width: 100%; height: auto; aspect-ratio: 4 / 3; user-select: none; -webkit-user-drag: none; pointer-events: none; }
.hq-map.is-painted canvas { position: absolute; inset: 0; height: 100%; image-rendering: auto; }
.hq-map.is-painted::after {
  background:
    repeating-linear-gradient(0deg, rgba(0,0,0,.08) 0 1px, transparent 1px 3px),
    radial-gradient(ellipse at center, transparent 62%, rgba(0,0,0,.4) 100%);
}
.hq-map-dot { display: inline-block; width: .6em; height: .6em; border-radius: 50%; margin-right: .4em; vertical-align: .02em; background: #3A4B4D; }
.hq-map-dot-on { background: #2FE0A8; box-shadow: 0 0 5px rgba(47,224,168,.8); }
.hq-map-dot-training { background: var(--hq-amber); box-shadow: 0 0 5px rgba(251,191,36,.7); }
.hq-map-label {
  position: absolute; line-height: 1.2; pointer-events: none; white-space: nowrap;
  font-family: var(--hq-pixel); font-size: clamp(7px, 1.25vw, 11px); letter-spacing: .04em; text-transform: uppercase;
  color: #CFE7E7; text-shadow: 0 1px 0 #000, 0 0 4px #000;
}
.hq-map-label.is-selected { color: var(--hq-cyan); text-shadow: 0 0 6px rgba(8,220,224,.7), 0 1px 0 #000; }
.hq-map-tag {
  position: absolute; transform: translate(-50%, -100%); line-height: 1.2; pointer-events: none; white-space: nowrap;
  padding: 1px 3px; border-radius: 3px; background: rgba(2,5,6,.85); border: 1px solid;
  font-family: var(--hq-pixel); font-size: clamp(7px, 1vw, 9px); text-transform: uppercase;
}
.hq-map-tag-you { color: var(--hq-cyan); border-color: rgba(8,220,224,.6); }
.hq-map-tag-training { color: var(--hq-amber); border-color: rgba(251,191,36,.6); }
.hq-map-tag-working { color: #2FE0A8; border-color: rgba(47,224,168,.6); }
.hq-map-tag-on-shift { color: #03161A; background: #2FE0A8; border-color: #2FE0A8; }
.hq-center .hq-building { border: 0; border-radius: 0; }

/* ── The building ───────────────────────────────────────────── */
.hq-building {
  position: relative; border-radius: 16px; overflow: hidden; border: 1px solid var(--hq-line);
  background: linear-gradient(180deg, #02050A 0%, #06121D 40%, #0A1B27 100%);
  padding-top: 20px;
}
.hq-sky { position: absolute; inset: 0 0 auto 0; height: 110px; pointer-events: none; }
.hq-star { position: absolute; width: 2px; height: 2px; background: #CFEFEF; opacity: .75; animation: hq-twinkle 3.2s steps(2) infinite; }
.hq-moon { position: absolute; right: 7%; top: 14px; width: 27px; height: 27px; }
.hq-sign {
  position: relative; z-index: 1; display: flex; align-items: center; justify-content: center; gap: 10px;
  width: max-content; max-width: calc(100% - 32px); margin: 8px auto 0; padding: 8px 16px;
  border: 2px solid rgba(8,220,224,.55); border-radius: 6px; background: #031012;
  box-shadow: 0 0 22px rgba(8,220,224,.28), inset 0 0 12px rgba(8,220,224,.18);
}
.hq-sign-text { font-family: var(--hq-pixel); font-size: clamp(15px, 4vw, 26px); text-transform: uppercase; letter-spacing: .05em; color: var(--hq-cyan); text-shadow: 0 0 8px rgba(8,220,224,.8), 0 0 18px rgba(8,220,224,.45); animation: hq-flicker 7s linear infinite; }
.hq-sign-hq { font-family: var(--hq-pixel); font-size: clamp(12px, 3vw, 18px); color: #03161A; background: var(--hq-cyan); padding: 1px 6px; border-radius: 3px; }
.hq-tower {
  position: relative; z-index: 1; width: calc(100% - 28px); max-width: 900px; margin: 12px auto 0;
  background: #0A1215; border: 3px solid var(--hq-line2); border-bottom: 0; border-radius: 4px 4px 0 0;
  box-shadow: 0 -2px 0 #1B2A2E;
}
.hq-floor { display: grid; grid-template-columns: 30px 1fr; border-top: 4px solid #1B2A2E; }
.hq-floor:first-child { border-top: 0; }
.hq-floor-no {
  display: grid; place-items: center; background: #0B1417; border-right: 3px solid #1B2A2E;
  font-family: var(--hq-pixel); font-size: 10px; color: var(--hq-muted); writing-mode: vertical-rl; transform: rotate(180deg);
}
.hq-floor-rooms { display: grid; grid-template-columns: 1fr 1fr; gap: 3px; background: #1B2A2E; }
@media (max-width: 640px) {
  .hq-floor { grid-template-columns: 22px 1fr; }
  .hq-floor-rooms { grid-template-columns: 1fr; }
  .hq-tower { width: calc(100% - 16px); }
}

.hq-room {
  position: relative; display: block; width: 100%; aspect-ratio: 120 / 64; padding: 0; margin: 0;
  border: 0; background: #0B1316; cursor: pointer; overflow: hidden; text-align: left;
  transition: filter .15s ease;
}
.hq-room:hover { filter: brightness(1.1); }
.hq-room.is-selected::after, .hq-room:focus-visible::after {
  content: ""; position: absolute; inset: 0; box-shadow: inset 0 0 0 2px var(--hq-cyan), inset 0 0 18px rgba(8,220,224,.25); pointer-events: none;
}
.hq-room:focus-visible { outline: none; }
.hq-room-art { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
.hq-room-label { position: absolute; left: 8px; top: 7px; right: 8px; display: flex; flex-direction: column; gap: 1px; pointer-events: none; }
.hq-room-name { font-family: var(--hq-pixel); font-size: 11px; letter-spacing: .04em; text-transform: uppercase; color: var(--hq-text); text-shadow: 0 1px 0 #000, 0 0 6px rgba(0,0,0,.8); }
.hq-room.is-dark .hq-room-name { color: #B9CFCF; }
.hq-room-sum { font-size: 11px; color: var(--hq-muted); text-shadow: 0 1px 0 #000; }
.hq-tag {
  position: absolute; top: 43%; transform: translate(-50%, -100%); padding: 1px 4px 2px; border-radius: 3px;
  font-family: var(--hq-pixel); font-size: 8px; line-height: 1.2; letter-spacing: .02em; text-transform: uppercase; white-space: nowrap;
  background: rgba(5,8,10,.86); border: 1px solid var(--hq-line2); color: #9DB5B5; pointer-events: none;
}
.hq-tag-up { top: 33%; }
.hq-tag-you { color: var(--hq-cyan); border-color: rgba(8,220,224,.6); }
.hq-tag-training { color: var(--hq-amber); border-color: rgba(251,191,36,.6); }
.hq-tag-open { opacity: .7; }
.hq-bubble {
  position: absolute; top: 45%; padding: 0 4px; border-radius: 4px; background: var(--hq-amber); color: #1A1204;
  font-family: var(--hq-pixel); font-size: 9px; line-height: 1.3; pointer-events: none; animation: hq-bob 1.6s ease-in-out infinite;
}
.hq-hiring {
  position: absolute; right: 8px; bottom: 7px; padding: 1px 5px; border: 1px dashed rgba(234,252,252,.35); border-radius: 3px;
  font-family: var(--hq-pixel); font-size: 8px; text-transform: uppercase; color: #B9CFCF; background: rgba(5,8,10,.6); pointer-events: none;
}
@media (min-width: 641px) {
  .hq-room-name { font-size: 12px; }
  .hq-tag { font-size: 9px; }
}

.hq-street {
  position: relative; height: 92px;
  background:
    linear-gradient(180deg, #16262B 0 4px, #0E181B 4px 26px, #070B0D 26px 100%);
}
.hq-street::after {
  content: ""; position: absolute; left: 0; right: 0; bottom: 22px; height: 2px;
  background: repeating-linear-gradient(90deg, rgba(251,191,36,.55) 0 18px, transparent 18px 36px);
}
.hq-palm { position: absolute; bottom: 20px; height: 86px; width: auto; }
.hq-palm-l { left: 2%; }
.hq-palm-r { right: 2%; }
.hq-van { position: absolute; bottom: 10px; left: 18%; height: 48px; width: auto; }

/* SVG animation hooks set by hqPixels.js */
.hq-root .hq-blink { animation: hq-blink 1.8s steps(2) infinite; }
.hq-root .hq-blink-1 { animation-delay: .45s; }
.hq-root .hq-blink-2 { animation-delay: .9s; }
.hq-root .hq-blink-3 { animation-delay: 1.35s; }
.hq-root .hq-twinkle { animation: hq-twinkle 2.6s steps(2) infinite; }
.hq-root .hq-neon { animation: hq-flicker 6s linear infinite; }

@keyframes hq-twinkle { 50% { opacity: .2; } }
@keyframes hq-blink { 50% { opacity: .25; } }
@keyframes hq-bob { 50% { transform: translateY(-3px); } }
@keyframes hq-flicker { 0%, 92%, 100% { opacity: 1; } 93% { opacity: .55; } 95% { opacity: 1; } 96% { opacity: .7; } }

/* ── Cards ──────────────────────────────────────────────────── */
.hq-card { scroll-margin-top: calc(72px + env(safe-area-inset-top, 0px)); background: var(--hq-panel); border: 1px solid var(--hq-line); border-radius: 14px; padding: 18px 16px; display: grid; gap: 12px; }
.hq-card:focus { outline: none; }
.hq-h2 { margin: 0; font-family: var(--hq-display); font-size: 19px; font-weight: 700; letter-spacing: -.01em; text-wrap: balance; }
.hq-sub { margin: -6px 0 0; color: var(--hq-muted); font-size: 14px; }
.hq-eyebrow { font-family: var(--hq-pixel); font-size: 10px; letter-spacing: .06em; text-transform: uppercase; color: var(--hq-cyan); }
.hq-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.hq-uses { margin: 0; padding: 10px 12px; border-radius: 10px; background: var(--hq-panel2); border: 1px solid var(--hq-line); font-size: 14px; display: grid; gap: 2px; }
.hq-uses-label { font-size: 11px; letter-spacing: .06em; text-transform: uppercase; color: var(--hq-muted); }

.hq-seats { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
.hq-seat { padding: 12px; border-radius: 10px; border: 1px solid var(--hq-line); background: #0A1114; display: grid; gap: 4px; }
.hq-seat-training { border-color: rgba(251,191,36,.35); }
.hq-seat-you { border-color: rgba(8,220,224,.35); }
.hq-seat-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
.hq-seat-title { font-family: var(--hq-display); font-weight: 600; font-size: 15px; }
.hq-seat-role { font-size: 11px; letter-spacing: .06em; text-transform: uppercase; color: var(--hq-cyan); }
.hq-seat-job { margin: 0; font-size: 14px; color: #C9DCDC; max-width: 65ch; }
.hq-seat-note { margin: 0; font-size: 13px; color: var(--hq-amber); }
.hq-pill { display: inline-block; padding: 2px 9px; border-radius: 999px; font-size: 11.5px; font-weight: 600; white-space: nowrap; border: 1px solid; }
.hq-pill-you { color: var(--hq-cyan); border-color: rgba(8,220,224,.5); background: rgba(8,220,224,.08); }
.hq-pill-working, .hq-pill-on-shift { color: #2FE0A8; border-color: rgba(47,224,168,.5); background: rgba(47,224,168,.08); }
.hq-pill-training { color: var(--hq-amber); border-color: rgba(251,191,36,.5); background: rgba(251,191,36,.08); }
.hq-pill-open { color: var(--hq-muted); border-color: var(--hq-line2); background: transparent; }

.hq-desk .hq-count { font-size: 13px; color: var(--hq-muted); font-variant-numeric: tabular-nums; }
.hq-row-end { display: flex; align-items: center; gap: 10px; }
.hq-btn {
  display: inline-flex; align-items: center; justify-content: center; min-height: 36px; padding: 6px 14px;
  border-radius: 9px; font-size: 13.5px; font-weight: 600; text-decoration: none; cursor: pointer; border: 1px solid;
}
.hq-btn:disabled { opacity: .55; cursor: default; }
.hq-btn-primary { background: var(--hq-cyan); border-color: var(--hq-cyan); color: #03161A !important; }
.hq-btn-ghost { background: transparent; border-color: var(--hq-line2); color: var(--hq-text); }
.hq-error { margin: 0; padding: 10px 12px; border-radius: 10px; border: 1px solid rgba(248,113,113,.45); background: rgba(248,113,113,.08); color: #FCA5A5; font-size: 13.5px; }
.hq-quiet { margin: 0; color: var(--hq-muted); font-size: 13.5px; }
.hq-preview-note { margin: 0; padding: 8px 12px; border-radius: 10px; border: 1px dashed rgba(251,191,36,.5); color: var(--hq-amber); font-size: 13px; }
.hq-items { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
.hq-item { padding: 14px; border-radius: 12px; border: 1px solid var(--hq-line2); background: #0A1114; display: grid; gap: 8px; }
.hq-item-draft { border-color: rgba(8,220,224,.4); }
.hq-item-question { border-color: rgba(251,191,36,.4); }
.hq-item-alert { border-color: rgba(248,113,113,.45); }
.hq-item-meta { display: flex; flex-wrap: wrap; gap: 4px 10px; font-size: 12.5px; color: var(--hq-muted); align-items: baseline; }
.hq-item-title { margin: 0; font-family: var(--hq-display); font-size: 16px; font-weight: 600; text-wrap: balance; }
.hq-kind { margin-left: auto; font-size: 11px; letter-spacing: .05em; text-transform: uppercase; color: var(--hq-text); padding: 1px 7px; border-radius: 999px; border: 1px solid var(--hq-line2); }
.hq-item-summary { margin: 0; font-size: 14px; color: #C9DCDC; max-width: 70ch; }
.hq-headnote { padding: 10px 12px; border-radius: 10px; border: 1px solid rgba(8,220,224,.28); background: rgba(8,220,224,.05); display: grid; gap: 2px; }
.hq-headnote-label { font-size: 11px; letter-spacing: .06em; text-transform: uppercase; color: var(--hq-cyan); }
.hq-headnote p { margin: 0; font-size: 13.5px; color: #C9DCDC; }
.hq-item-body summary, .hq-recent summary, .hq-shift-actions summary { cursor: pointer; color: var(--hq-cyan); font-size: 13.5px; }
.hq-body { margin-top: 8px; padding: 12px; border-radius: 10px; background: #070C0E; border: 1px solid var(--hq-line); white-space: pre-wrap; font-size: 13.5px; line-height: 1.55; color: #D5E5E5; max-height: 420px; overflow: auto; }
.hq-item-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.hq-pill-done { color: #2FE0A8; border-color: rgba(47,224,168,.5); }
.hq-pill-dismissed { color: var(--hq-muted); border-color: var(--hq-line2); }
.hq-recent-list { list-style: none; margin: 10px 0 0; padding: 0; display: grid; gap: 8px; }
.hq-recent-list li { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; font-size: 13.5px; }
.hq-recent-title { flex: 1 1 200px; min-width: 0; }
.hq-recent-when { color: var(--hq-muted); font-size: 12.5px; }
.hq-shifts { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
.hq-shift { padding: 12px; border-radius: 10px; border: 1px solid var(--hq-line); background: #0A1114; display: grid; gap: 4px; }
.hq-shift-who { font-family: var(--hq-display); font-weight: 600; font-size: 14.5px; }
.hq-shift-meta { display: flex; flex-wrap: wrap; gap: 4px 12px; font-size: 12.5px; color: var(--hq-muted); font-variant-numeric: tabular-nums; }
.hq-shift-summary { margin: 0; font-size: 13.5px; color: #C9DCDC; }
.hq-shift-actions ol { margin: 6px 0 0; padding-left: 20px; font-size: 13px; color: #C9DCDC; display: grid; gap: 2px; }
.hq-pill-shift-done { color: #2FE0A8; border-color: rgba(47,224,168,.5); }
.hq-pill-shift-failed { color: #FCA5A5; border-color: rgba(248,113,113,.5); }
.hq-pill-shift-skipped { color: var(--hq-muted); border-color: var(--hq-line2); }
.hq-seat-meta { margin: 0; font-size: 12.5px; color: var(--hq-muted); }
.hq-empty { padding: 14px; border-radius: 10px; border: 1px dashed var(--hq-line2); display: grid; gap: 4px; font-size: 14px; color: #C9DCDC; }
.hq-empty p { margin: 0; max-width: 65ch; }
.hq-empty strong { color: var(--hq-text); }

.hq-org-top { display: grid; justify-items: center; gap: 0; }
.hq-org-node { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; justify-content: center; padding: 8px 14px; border-radius: 10px; border: 1px solid var(--hq-line2); background: var(--hq-panel2); }
.hq-org-owner { border-color: rgba(8,220,224,.5); }
.hq-org-title { font-family: var(--hq-display); font-weight: 600; font-size: 14.5px; }
.hq-org-who { font-size: 13px; color: var(--hq-cyan); }
.hq-org-line { width: 2px; height: 14px; background: var(--hq-line2); }
.hq-org-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 260px), 1fr)); gap: 10px; }
.hq-org-dept { padding: 12px; border-radius: 10px; border: 1px solid var(--hq-line); background: #0A1114; display: grid; gap: 6px; align-content: start; }
.hq-org-name { margin: 0; font-family: var(--hq-pixel); font-size: 11px; font-weight: 400; letter-spacing: .05em; text-transform: uppercase; color: var(--hq-cyan); }
.hq-org-head { display: flex; align-items: center; gap: 8px; font-weight: 600; font-size: 14px; }
.hq-org-tag { margin-left: auto; font-size: 10.5px; letter-spacing: .06em; text-transform: uppercase; color: var(--hq-muted); }
.hq-org-workers { list-style: none; margin: 0; padding: 0 0 0 10px; border-left: 2px solid var(--hq-line2); display: grid; gap: 4px; font-size: 13.5px; color: #C9DCDC; }
.hq-org-workers li { display: flex; align-items: center; gap: 8px; }
.hq-link { border: 0; background: none; padding: 2px 4px; color: var(--hq-cyan); font-size: 13px; cursor: pointer; text-decoration: underline; text-underline-offset: 3px; }
.hq-dot { display: inline-block; width: 8px; height: 8px; flex: none; border-radius: 2px; }
.hq-dot-you { background: var(--hq-cyan); }
.hq-dot-working { background: #2FE0A8; }
.hq-dot-on-shift { background: #2FE0A8; box-shadow: 0 0 6px rgba(47,224,168,.9); animation: hq-blink 1.8s steps(2) infinite; }
.hq-dot-training { background: var(--hq-amber); }
.hq-dot-open { background: transparent; border: 1.5px solid #5F7878; }
.hq-legend { margin: 0; display: flex; gap: 16px; flex-wrap: wrap; font-size: 12.5px; color: var(--hq-muted); }
.hq-legend > span { display: inline-flex; align-items: center; gap: 6px; }
.hq-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }

.hq-rules { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 260px), 1fr)); gap: 10px; }
.hq-rules li { padding: 12px; border-radius: 10px; background: #0A1114; border: 1px solid var(--hq-line); display: grid; gap: 3px; font-size: 13.5px; color: #C9DCDC; }
.hq-rules strong { font-family: var(--hq-display); font-size: 14.5px; color: var(--hq-text); }

.hq-plan { margin: 0; padding: 0 0 0 22px; display: grid; gap: 10px; }
.hq-plan-item { padding-left: 4px; }
.hq-plan-item::marker { font-family: var(--hq-pixel); color: var(--hq-muted); font-size: 11px; }
.hq-plan-title { font-weight: 600; font-size: 14.5px; }
.hq-plan-use { display: block; font-size: 13.5px; color: var(--hq-muted); }
.hq-pill-plan-built { color: #2FE0A8; border-color: rgba(47,224,168,.5); background: rgba(47,224,168,.08); }
.hq-pill-plan-next { color: var(--hq-cyan); border-color: rgba(8,220,224,.5); background: rgba(8,220,224,.08); }
.hq-pill-plan-planned { color: var(--hq-muted); border-color: var(--hq-line2); }

@media (prefers-reduced-motion: reduce) {
  .hq-root *, .hq-root .hq-blink, .hq-root .hq-twinkle, .hq-root .hq-neon { animation: none !important; transition: none !important; }
}
`;
