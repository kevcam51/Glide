// Smooth Training HQ — your agents, from the Glidna AI chat (S238b).
//
// Kevin: "I should be able to click on agents and then a pop will show me a
// list of all of my agents and categorize them based on their department."
// Each one can be talked to here (HQCrewChat) or in the Claude app.
//
// ⚠️ OWNER ONLY AND LAZY, like the HQ itself: App.jsx loads this file with
// lazy() and renders it only for the owner's uid, so no other account
// downloads the org chart. The server checks the uid again on every call.

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { httpsCallable } from "firebase/functions";
import { functions } from "./firebase.js";
import { ROOMS, SEATS, agentBrief, findAgents } from "./hqOrg.js";
import HQCrewChat, { claudeNewChatUrl } from "./HQCrewChat.jsx";

const callHq = httpsCallable(functions, "hqApi");
const STATUS = { training: "In training", open: "Open position" };

export default function HQCrewPicker({ onClose }) {
  const [links, setLinks] = useState({});
  const [q, setQ] = useState("");
  const [talkId, setTalkId] = useState(null);
  const rootRef = useRef(null);
  const talkRef = useRef(null);
  talkRef.current = talkId;
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  useEffect(() => {
    let alive = true;
    callHq({ action: "crewLinks" }).then(({ data }) => { if (alive) setLinks((data && data.links) || {}); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // An open conversation handles its own Escape; this list closes on the next.
    const onKey = (e) => {
      if (e.key !== "Escape" || talkRef.current) return;
      e.stopPropagation();
      onCloseRef.current();
    };
    window.addEventListener("keydown", onKey, true);
    if (rootRef.current) rootRef.current.focus({ preventScroll: true });
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey, true);
    };
  }, []);

  const depts = useMemo(() => ROOMS.filter((r) => r.id !== "owner")
    .map((room) => ({ room, seats: SEATS.filter((s) => s.room === room.id && s.role !== "owner") }))
    .filter((d) => d.seats.length), []);
  const found = q.trim() ? findAgents(q, SEATS).filter((r) => r.seat.role !== "owner") : null;
  const roomName = (id) => (ROOMS.find((r) => r.id === id) || {}).name || "";
  const talkSeat = talkId ? SEATS.find((s) => s.id === talkId) : null;

  const row = (s, why) => (
    <li key={s.id} className="hqp-row">
      <div className="hqp-who">
        <span className="hqp-title">{s.title}</span>
        <span className="hqp-sub">{why || (s.role === "head" ? "Department head" : STATUS[s.status] || "")}</span>
      </div>
      <button type="button" className="hqp-talk" onClick={() => setTalkId(s.id)}>Talk here</button>
      <a className="hqp-claude" href={links[s.id] || claudeNewChatUrl(agentBrief(s))} target="_blank" rel="noopener noreferrer"
        aria-label={`${s.title} in Claude`}>In Claude</a>
    </li>
  );

  return createPortal(
    <div className="hqp-root" role="dialog" aria-modal="true" aria-labelledby="hqp-title" ref={rootRef} tabIndex={-1}>
      <style>{CSS}</style>
      <header className="hqp-head">
        <h2 id="hqp-title">Your agents</h2>
        <button type="button" className="hqp-x" onClick={onClose} aria-label="Close">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2"
            strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
        </button>
      </header>
      <div className="hqp-body">
        <input className="hqp-search" type="search" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off"
          enterKeyHint="search" placeholder="A name, a job or a problem" aria-label="Find the right agent" />
        {found ? (
          found.length ? <ul className="hqp-list">{found.map(({ seat, why }) => row(seat, why))}</ul>
            : <p className="hqp-quiet">Nobody on the crew does that yet.</p>
        ) : depts.map(({ room, seats }) => (
          <section key={room.id} className="hqp-dept">
            <h3>{room.name}</h3>
            <ul className="hqp-list">{seats.map((s) => row(s))}</ul>
          </section>
        ))}
        <p className="hqp-quiet hqp-foot">"In Claude" opens the chat you saved on their HQ profile, or starts a new one with their brief typed in.</p>
      </div>
      {talkSeat && (
        <HQCrewChat
          seat={{ id: talkSeat.id, title: talkSeat.title, short: talkSeat.short, roomName: roomName(talkSeat.room) }}
          link={links[talkSeat.id] || null} brief={agentBrief(talkSeat)} onClose={() => setTalkId(null)} />
      )}
    </div>,
    document.body,
  );
}

const CSS = `
.hqp-root {
  position: fixed; inset: 0; z-index: 2590; display: flex; flex-direction: column;
  background: #05080A; color: #EAFCFC; font-family: "DM Sans", system-ui, -apple-system, "Segoe UI", sans-serif;
  font-size: 15px; line-height: 1.5; color-scheme: dark; overscroll-behavior: contain;
}
.hqp-root *, .hqp-root *::before, .hqp-root *::after { box-sizing: border-box; }
.hqp-root button, .hqp-root input { font: inherit; color: inherit; }
.hqp-root:focus { outline: none; }
.hqp-head {
  display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-shrink: 0;
  padding: calc(12px + env(safe-area-inset-top, 0px)) 16px 12px; border-bottom: 1px solid #1F3236;
  max-width: 720px; width: 100%; margin: 0 auto;
}
.hqp-head h2 { margin: 0; font: 700 18px/1.2 "Sora", system-ui, sans-serif; }
.hqp-x {
  width: 38px; height: 38px; display: inline-flex; align-items: center; justify-content: center;
  border-radius: 10px; border: 1px solid #2E4241; background: transparent; cursor: pointer;
}
.hqp-body {
  flex: 1; min-height: 0; overflow-y: auto; -webkit-overflow-scrolling: touch;
  padding: 14px 16px calc(20px + env(safe-area-inset-bottom, 0px)); max-width: 720px; width: 100%; margin: 0 auto;
}
.hqp-search {
  width: 100%; min-height: 44px; padding: 10px 12px; border-radius: 12px; border: 1px solid #2E4241;
  background: #0C1417; font-size: 16px; margin-bottom: 6px;
}
.hqp-search:focus { outline: 2px solid rgba(8,220,224,.55); outline-offset: 1px; }
.hqp-dept h3 { margin: 16px 0 6px; font-size: 12px; letter-spacing: .08em; text-transform: uppercase; color: #08DCE0; }
.hqp-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
.hqp-row {
  display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-radius: 12px;
  border: 1px solid #1F3236; background: #0A1114;
}
.hqp-who { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.hqp-title { font-weight: 600; line-height: 1.3; }
.hqp-sub { font-size: 12.5px; color: #93ADAD; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hqp-talk, .hqp-claude {
  flex-shrink: 0; min-height: 36px; padding: 6px 12px; border-radius: 9px; font-size: 13px; font-weight: 600;
  display: inline-flex; align-items: center; cursor: pointer; text-decoration: none;
}
/* Two classes, so the root's button colour rule can't turn this white on cyan. */
.hqp-root .hqp-talk { border: 1px solid #08DCE0; background: #08DCE0; color: #03161A; }
.hqp-claude { border: 1px solid #2E4241; background: transparent; color: #EAFCFC; }
.hqp-quiet { margin: 10px 0 0; color: #93ADAD; font-size: 13.5px; }
.hqp-foot { margin-top: 18px; font-size: 12.5px; }
`;
