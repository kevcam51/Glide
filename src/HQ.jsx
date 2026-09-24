// Smooth Training HQ — Kevin's business crew, drawn as a building (S238).
//
// Piece 1 of the HQ: the building and the org chart. Every department is a room
// in a cutaway of a Miami gym at night; every seat has a title; hired workers
// sit at their desks and open seats are empty chairs. Tap a room to see who
// works there and how Kevin will use that department.
//
// ⚠️ ADMIN ONLY, AND LAZY ON PURPOSE. The ≡ menu row that opens this renders
// only for the owner's uid, and App.jsx imports this file with lazy(), so no
// other account ever downloads it. It holds NO business data — titles and job
// descriptions only (see hqOrg.js). Reports, drafts and anything from
// QuickBooks or Gmail arrive with later pieces, server-side behind an admin
// check, never in this bundle.
//
// ⚠️ NOT THE REEL'S ART. The Instagram reel that started this used StarNet,
// whose sprites and artwork belong to its author. Everything here is drawn in
// hqPixels.js from rectangles, in Smooth Training's black and cyan.

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ROOMS, FLOORS, SEATS, CREW_RULES, BLUEPRINT,
  roomById, seatsIn, roomsOnFloor, orgCounts, roomSummary, headOf,
} from "./hqOrg.js";
import { W, H, roomScene, seatCenters, palmTree, van, PALM_W, PALM_H, VAN_W, VAN_H } from "./hqPixels.js";

const FONT_ID = "hq-silkscreen";
const FONT_HREF = "https://fonts.googleapis.com/css2?family=Silkscreen:wght@400;700&display=swap";

// The Chief of Staff's wall board lights one bar per department, in this order.
const BOARD_ORDER = ["finance", "ops", "marketing", "research", "front", "coaching"];
const DEPT_ROOMS = ROOMS.filter((r) => r.id !== "owner" && r.id !== "chief");

const STATUS_LABEL = { you: "You", training: "In training", open: "Open position" };
const BLUEPRINT_LABEL = { built: "Built", next: "Next", planned: "Planned" };

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

function deptState(roomId) {
  const seats = seatsIn(roomId);
  if (seats.some((s) => s.status === "working" || s.status === "on-shift")) return "on";
  if (seats.some((s) => s.status === "training")) return "training";
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

function Room({ room, selected, onSelect, boardLights }) {
  const seats = seatsIn(room.id);
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
      aria-label={`${room.name}. ${roomSummary(room.id)}.`}
      className={`hq-room${selected ? " is-selected" : ""}${lit ? "" : " is-dark"}`}>
      <Pixels rects={rects} w={W} h={H} className="hq-room-art" />
      <span className="hq-room-label" aria-hidden="true">
        <span className="hq-room-name">{room.name}</span>
        <span className="hq-room-sum">{roomSummary(room.id)}</span>
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

function SeatRow({ s }) {
  return (
    <li className={`hq-seat hq-seat-${s.status}`}>
      <div className="hq-seat-head">
        <span className="hq-seat-title">{s.title}</span>
        <StatusPill status={s.status} />
      </div>
      {s.role === "head" && <span className="hq-seat-role">Department head</span>}
      <p className="hq-seat-job">{s.job}</p>
      {s.waitingOn && <p className="hq-seat-note">First shift after: {s.waitingOn}</p>}
      {s.hireWhen && <p className="hq-seat-note">When to hire: {s.hireWhen}</p>}
    </li>
  );
}

function DeptPanel({ roomId, panelRef }) {
  const room = roomById(roomId);
  const seats = seatsIn(roomId);
  return (
    <section className="hq-card hq-dept" aria-labelledby="hq-dept-title" ref={panelRef} tabIndex={-1}>
      <div className="hq-eyebrow">Floor {room.floor} · {room.tagline}</div>
      <h2 id="hq-dept-title" className="hq-h2">{room.name}</h2>
      <p className="hq-uses"><span className="hq-uses-label">How you&rsquo;ll use it</span>{room.uses}</p>
      <ul className="hq-seats">
        {seats.map((s) => <SeatRow key={s.id} s={s} />)}
      </ul>
    </section>
  );
}

export default function HQ({ onClose, ownerName = "" }) {
  const [selected, setSelected] = useState("finance");
  const rootRef = useRef(null);
  const panelRef = useRef(null);
  const deskRef = useRef(null);
  const counts = orgCounts();
  const firstName = String(ownerName || "").trim().split(/\s+/)[0] || "";
  const boardLights = useMemo(() => BOARD_ORDER.map(deptState), []);
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
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e) => { if (e.key === "Escape" && onCloseRef.current) onCloseRef.current(); };
    window.addEventListener("keydown", onKey);
    if (rootRef.current) rootRef.current.focus({ preventScroll: true });
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, []);

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

  const owner = SEATS.find((s) => s.role === "owner");
  const chief = headOf("chief");

  return createPortal(
    <div className="hq-root" role="dialog" aria-modal="true" aria-label="Smooth Training HQ" ref={rootRef} tabIndex={-1}>
      <style>{CSS}</style>
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
        <div className="hq-intro">
          <p className="hq-hello">{firstName ? `Welcome in, ${firstName}.` : "Welcome in."}</p>
          <div className="hq-glance">
            <span className="hq-chip"><b>{counts.total}</b> seats</span>
            <span className="hq-chip hq-chip-training"><b>{counts.training}</b> in training</span>
            <span className="hq-chip"><b>{counts.open}</b> open</span>
            <button type="button" className="hq-chip hq-chip-desk" onClick={showDesk}><b>0</b> waiting on you</button>
          </div>
        </div>

        <section className="hq-building" aria-label="The building. Tap a room to see that department.">
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
                      onSelect={pick} boardLights={boardLights} />
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

        <DeptPanel roomId={selected} panelRef={panelRef} />

        <section className="hq-card hq-desk" aria-labelledby="hq-desk-title" ref={deskRef} tabIndex={-1}>
          <div className="hq-row">
            <h2 id="hq-desk-title" className="hq-h2">Your desk</h2>
            <span className="hq-count">0 waiting</span>
          </div>
          <div className="hq-empty">
            <p><strong>Nothing needs you right now.</strong></p>
            <p>When a worker finishes a draft, a report or a question for you, it lands here with its
              department head&rsquo;s note on top. Nothing goes out until you say so.</p>
          </div>
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
              const head = headOf(room.id);
              const workers = seatsIn(room.id).filter((s) => s.role === "worker");
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

.hq-wrap { max-width: 980px; margin: 0 auto; padding-inline: 16px; padding-block: 16px calc(48px + env(safe-area-inset-bottom, 0px)); display: grid; gap: 20px; }
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
.hq-pill-training { color: var(--hq-amber); border-color: rgba(251,191,36,.5); background: rgba(251,191,36,.08); }
.hq-pill-open { color: var(--hq-muted); border-color: var(--hq-line2); background: transparent; }

.hq-desk .hq-count { font-size: 13px; color: var(--hq-muted); font-variant-numeric: tabular-nums; }
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
