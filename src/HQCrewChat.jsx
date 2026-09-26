// Smooth Training HQ — talking to one of the crew, in the app (S238b).
//
// Kevin: "a place that i can talk to them directly, or have a link that will
// take me directly to them in claude app", with "the visual of them at the
// desk, almost like a front camera view of them writing on the desk". This is
// that conversation: the desk camera on top (hqDeskCam.js), the conversation
// below it, and a way out to the Claude app when the job needs Gmail,
// QuickBooks or Zapier.
//
// It opens from an agent's HQ profile and from Agents in the Glidna AI chat,
// so it brings its own styles and portals to <body> rather than relying on
// either screen's. The conversation itself lives server-side (hqChat.js,
// owner-checked): nothing about it is stored on this device.

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { httpsCallable } from "firebase/functions";
import { functions } from "./firebase.js";
import { CAM_W, CAM_H, deskCamScene } from "./hqDeskCam.js";

const callChat = httpsCallable(functions, "hqCrewChat");

// What starts a new Claude chat with the agent's brief already typed in (it
// waits for Enter; claude.ai/new?q= fills, never sends).
export const claudeNewChatUrl = (brief) => `https://claude.ai/new?q=${encodeURIComponent(brief || "")}`;

function chatError(e) {
  const code = String((e && e.code) || "").replace(/^functions\//, "");
  if (code === "permission-denied") return "Only the owner's account can talk to the crew.";
  if (code === "unauthenticated") return "Your sign-in has expired. Sign in again and reopen this.";
  if (code === "unavailable") return (e && e.message) || "Couldn't reach the AI just now. Try again in a moment.";
  if (code === "not-found") return "This part of the HQ isn't switched on yet.";
  if (code === "invalid-argument") return (e && e.message) || "That couldn't be sent.";
  return "Something went wrong. Try again in a moment.";
}

// Replies are plain text with **bold** and dash lists, the way the crew is
// told to write for a phone. React escapes everything; nothing here is HTML.
function Bold({ text }) {
  const parts = String(text).split(/\*\*([^*]+)\*\*/g);
  return parts.map((p, i) => (i % 2 ? <strong key={i}>{p}</strong> : <span key={i}>{p}</span>));
}
function Reply({ text }) {
  const blocks = String(text || "").split(/\n{2,}/);
  return blocks.map((b, i) => {
    const lines = b.split("\n");
    if (lines.every((l) => /^\s*[-•]\s+/.test(l))) {
      return <ul key={i}>{lines.map((l, j) => <li key={j}><Bold text={l.replace(/^\s*[-•]\s+/, "")} /></li>)}</ul>;
    }
    return <p key={i}>{lines.map((l, j) => <span key={j}>{j > 0 && <br />}<Bold text={l} /></span>)}</p>;
  });
}

function DeskCam({ writing, still, plate }) {
  const ref = useRef(null);
  useEffect(() => {
    const cv = ref.current;
    const ctx = cv && cv.getContext && cv.getContext("2d");
    if (!ctx) return undefined;
    let raf = 0, last = -1e9;
    const start = typeof performance !== "undefined" ? performance.now() : Date.now();
    const draw = (now) => {
      // Pixel art needs ten frames a second, not sixty.
      if (now - last >= 100 || still) {
        last = now;
        for (const [x, y, w, h, fill] of deskCamScene({ t: now - start, writing, still })) {
          ctx.fillStyle = fill;
          ctx.fillRect(x, y, w, h);
        }
      }
      if (!still) raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [writing, still]);
  return (
    <div className="hqt-cam">
      <canvas ref={ref} width={CAM_W} height={CAM_H} aria-hidden="true" />
      <span className="hqt-plate" aria-hidden="true">{plate}</span>
    </div>
  );
}

export default function HQCrewChat({ seat, link = null, brief = "", onClose, preview = false }) {
  const [phase, setPhase] = useState(preview ? "ready" : "loading");
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState("");
  const rootRef = useRef(null);
  const listRef = useRef(null);
  const still = typeof window !== "undefined" && window.matchMedia
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const close = useCallback(() => {
    // The agent leaves its desk now rather than ten minutes from now.
    if (!preview) callChat({ action: "end", seat: seat.id }).catch(() => {});
    onClose();
  }, [onClose, preview, seat.id]);
  const closeRef = useRef(close);
  useEffect(() => { closeRef.current = close; }, [close]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // Capture, so Escape closes this conversation and not the profile or the
    // HQ underneath it.
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      closeRef.current();
    };
    window.addEventListener("keydown", onKey, true);
    if (rootRef.current) rootRef.current.focus({ preventScroll: true });
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey, true);
    };
  }, []);

  useEffect(() => {
    if (preview) return undefined;
    let alive = true;
    callChat({ action: "load", seat: seat.id })
      .then(({ data }) => { if (alive) { setMessages(Array.isArray(data && data.messages) ? data.messages : []); setPhase("ready"); } })
      .catch((e) => { if (alive) { setPhase("error"); setErr(chatError(e)); } });
    return () => { alive = false; };
  }, [preview, seat.id]);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, sending]);

  const send = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    setErr("");
    setDraft("");
    const before = messages;
    setMessages([...before, { role: "user", text, at: Date.now() }]);
    try {
      if (preview) {
        await new Promise((r) => setTimeout(r, 2200));
        setMessages([...before, { role: "user", text, at: Date.now() },
          { role: "assistant", text: "This is the preview, so I can't really answer. On your account, I would.", at: Date.now() }]);
      } else {
        const { data } = await callChat({ action: "send", seat: seat.id, text });
        setMessages(Array.isArray(data && data.messages) ? data.messages : before);
      }
    } catch (e) {
      // Nothing was kept on the server; put the words back to try again.
      setMessages(before);
      setDraft(text);
      setErr(chatError(e));
    } finally {
      setSending(false);
    }
  };

  const newTopic = async () => {
    if (sending) return;
    setErr("");
    if (preview) { setMessages((m) => (m.length && m[m.length - 1].role !== "topic" ? [...m, { role: "topic", text: "" }] : m)); return; }
    try {
      const { data } = await callChat({ action: "newTopic", seat: seat.id });
      setMessages(Array.isArray(data && data.messages) ? data.messages : messages);
    } catch (e) {
      setErr(chatError(e));
    }
  };

  const onKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    }
  };

  const outHref = link || claudeNewChatUrl(brief);
  const last = messages[messages.length - 1];
  return createPortal(
    <div className="hqt-root" role="dialog" aria-modal="true" aria-labelledby="hqt-title" ref={rootRef} tabIndex={-1}>
      <style>{CSS}</style>
      <header className="hqt-head">
        <button type="button" className="hqt-icon" onClick={close} aria-label="Close the conversation">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2"
            strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 12H4" /><path d="m10 6-6 6 6 6" /></svg>
        </button>
        <div className="hqt-who">
          <h2 id="hqt-title">{seat.title}</h2>
          <span>{sending ? "Writing…" : seat.roomName || "At their desk"}</span>
        </div>
        <button type="button" className="hqt-topic" onClick={newTopic} disabled={sending || !messages.length || (last && last.role === "topic")}>
          New topic
        </button>
      </header>

      <DeskCam writing={sending} still={still} plate={seat.short || seat.title} />

      <div className="hqt-out">
        <a href={outHref} target="_blank" rel="noopener noreferrer">
          {link ? "Open their chat in Claude" : "Start a chat with them in Claude"}
        </a>
        <span>{link ? "For work that needs Gmail, QuickBooks or Zapier." : "Their brief is typed in for you: press Enter."}</span>
      </div>

      <div className="hqt-list" ref={listRef} aria-live="polite">
        {phase === "loading" && <p className="hqt-quiet">Opening the conversation…</p>}
        {phase === "error" && <p className="hqt-error">{err}</p>}
        {phase === "ready" && messages.length === 0 && (
          <p className="hqt-quiet">Ask {seat.title.startsWith("the ") ? seat.title : `your ${seat.title}`} anything about their work. Anything worth keeping, they can put on your desk.</p>
        )}
        {messages.map((m, i) => (m.role === "topic"
          ? <div key={i} className="hqt-divider"><span>New topic</span></div>
          : (
            <div key={i} className={m.role === "user" ? "hqt-msg hqt-me" : "hqt-msg hqt-them"}>
              {m.role === "user" ? m.text : <Reply text={m.text} />}
            </div>
          )))}
        {sending && <div className="hqt-msg hqt-them hqt-typing" aria-label="Writing a reply"><i /><i /><i /></div>}
      </div>

      {phase === "ready" && err && <p className="hqt-error hqt-error-bar" role="alert">{err}</p>}
      <form className="hqt-compose" onSubmit={(e) => { e.preventDefault(); send(); }}>
        <textarea value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={onKeyDown}
          placeholder={`Message ${seat.short || seat.title}`} rows={2} maxLength={4000}
          aria-label={`Message to ${seat.title}`} disabled={phase !== "ready"} />
        <button type="submit" disabled={!draft.trim() || sending || phase !== "ready"}>Send</button>
      </form>
    </div>,
    document.body,
  );
}

const CSS = `
.hqt-root {
  --t-bg: #05080A; --t-panel: #0C1417; --t-line: #1F3236; --t-line2: #2E4241;
  --t-text: #EAFCFC; --t-muted: #93ADAD; --t-cyan: #08DCE0;
  position: fixed; inset: 0; z-index: 2600; display: flex; flex-direction: column;
  background: var(--t-bg); color: var(--t-text);
  font-family: "DM Sans", system-ui, -apple-system, "Segoe UI", sans-serif; font-size: 15px; line-height: 1.5;
  color-scheme: dark; overscroll-behavior: contain;
  padding-bottom: var(--kb, 0px);
}
.hqt-root *, .hqt-root *::before, .hqt-root *::after { box-sizing: border-box; }
.hqt-root button, .hqt-root textarea { font: inherit; color: inherit; }
.hqt-root:focus { outline: none; }
.hqt-head {
  display: flex; align-items: center; gap: 10px; flex-shrink: 0;
  padding: calc(10px + env(safe-area-inset-top, 0px)) 14px 10px; border-bottom: 1px solid var(--t-line);
  max-width: 760px; width: 100%; margin: 0 auto;
}
.hqt-icon {
  width: 38px; height: 38px; display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0;
  border-radius: 10px; border: 1px solid var(--t-line2); background: transparent; cursor: pointer;
}
.hqt-who { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.hqt-who h2 { margin: 0; font: 700 16px/1.25 "Sora", system-ui, sans-serif; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hqt-who span { font-size: 12.5px; color: var(--t-muted); }
.hqt-topic {
  flex-shrink: 0; min-height: 34px; padding: 4px 12px; border-radius: 9px; border: 1px solid var(--t-line2);
  background: transparent; font-size: 13px; font-weight: 600; cursor: pointer;
}
.hqt-topic:disabled { opacity: .45; cursor: default; }
/* Width capped by the screen's height too (50vh wide = 30vh tall), so the
   conversation keeps its room; the plate's % position stays true. */
.hqt-cam { position: relative; flex-shrink: 0; width: min(100%, 760px, 50vh); margin: 0 auto; }
.hqt-cam canvas { display: block; width: 100%; height: auto; image-rendering: pixelated; background: #0A1215; }
.hqt-plate {
  position: absolute; left: 36.25%; width: 27.5%; top: 81.2%; height: 11.5%;
  display: flex; align-items: center; justify-content: center; overflow: hidden;
  font: 700 clamp(7px, 1.9vw, 12px)/1 "Silkscreen", ui-monospace, monospace; letter-spacing: .04em;
  text-transform: uppercase; color: var(--t-cyan); white-space: nowrap;
}
.hqt-out {
  display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 10px; flex-shrink: 0;
  padding: 8px 14px; border-bottom: 1px solid var(--t-line); max-width: 760px; width: 100%; margin: 0 auto;
}
.hqt-out a { color: var(--t-cyan); font-weight: 600; font-size: 13.5px; text-decoration: none; }
.hqt-out a:hover { text-decoration: underline; }
.hqt-out span { color: var(--t-muted); font-size: 12.5px; }
.hqt-list {
  flex: 1; min-height: 0; overflow-y: auto; -webkit-overflow-scrolling: touch;
  display: flex; flex-direction: column; gap: 10px; padding: 14px;
  max-width: 760px; width: 100%; margin: 0 auto;
}
.hqt-msg { max-width: 88%; padding: 10px 13px; border-radius: 14px; font-size: 14.5px; line-height: 1.5; overflow-wrap: anywhere; }
.hqt-me { align-self: flex-end; background: var(--t-cyan); color: #03161A; border-bottom-right-radius: 4px; white-space: pre-wrap; }
.hqt-them { align-self: flex-start; background: var(--t-panel); border: 1px solid var(--t-line2); border-bottom-left-radius: 4px; }
.hqt-them p { margin: 0 0 8px; }
.hqt-them p:last-child, .hqt-them ul:last-child { margin-bottom: 0; }
.hqt-them ul { margin: 0 0 8px; padding-left: 18px; }
.hqt-typing { display: inline-flex; gap: 5px; align-items: center; padding: 14px; }
.hqt-typing i { width: 6px; height: 6px; border-radius: 50%; background: var(--t-cyan); animation: hqt-dot 1.2s infinite ease-in-out; }
.hqt-typing i:nth-child(2) { animation-delay: .15s; }
.hqt-typing i:nth-child(3) { animation-delay: .3s; }
@keyframes hqt-dot { 0%, 80%, 100% { opacity: .25; } 40% { opacity: 1; } }
@media (prefers-reduced-motion: reduce) { .hqt-typing i { animation: none; opacity: .7; } }
.hqt-divider { display: flex; align-items: center; gap: 10px; color: var(--t-muted); font-size: 12px; }
.hqt-divider::before, .hqt-divider::after { content: ""; flex: 1; height: 1px; background: var(--t-line2); }
.hqt-quiet { margin: 0; color: var(--t-muted); font-size: 13.5px; }
.hqt-error { margin: 0; padding: 10px 12px; border-radius: 10px; border: 1px solid rgba(248,113,113,.45); background: rgba(248,113,113,.08); color: #FCA5A5; font-size: 13.5px; }
.hqt-error-bar { max-width: 760px; width: calc(100% - 28px); margin: 0 auto 8px; }
.hqt-compose {
  display: flex; gap: 8px; align-items: flex-end; flex-shrink: 0;
  padding: 10px 14px calc(10px + env(safe-area-inset-bottom, 0px)); border-top: 1px solid var(--t-line);
  max-width: 760px; width: 100%; margin: 0 auto;
}
.hqt-compose textarea {
  flex: 1; min-width: 0; resize: none; min-height: 44px; max-height: 140px; padding: 10px 12px;
  border-radius: 12px; border: 1px solid var(--t-line2); background: var(--t-panel);
  font-size: 16px; line-height: 1.4;
}
.hqt-compose textarea:focus { outline: 2px solid rgba(8,220,224,.55); outline-offset: 1px; }
.hqt-compose button {
  min-height: 44px; padding: 0 16px; border-radius: 12px; border: 1px solid var(--t-cyan);
  background: var(--t-cyan); color: #03161A; font-weight: 700; cursor: pointer;
}
.hqt-compose button:disabled { opacity: .45; cursor: default; }
`;
