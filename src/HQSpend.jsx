// Smooth Training HQ — the spending sheet (S238).
//
// Kevin: "I want that to be clickable so we can look at all of our spending
// within a certain time frame" — weekly, every two weeks, monthly and yearly.
// Opened from the station's AI-spend and Claude numbers.
//
// Every figure comes from functions/hqSpend.js through the owner-checked hqApi
// callable; this file only draws what the server summed. Three lines, never
// blended without a label: Glidna AI (what members' AI cost Glidna), the crew
// on Glidna cloud, and the owner's flat Claude plan. The plan's live usage
// meter isn't readable by any app, so it links to claude.ai instead of
// inventing a number.

import { useCallback, useEffect, useRef, useState } from "react";

export const SPEND_PERIODS = [
  { id: "week", label: "Week" },
  { id: "2weeks", label: "2 weeks" },
  { id: "month", label: "Month" },
  { id: "year", label: "Year" },
];
export const CLAUDE_USAGE_URL = "https://claude.ai/settings/usage";
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July",
  "August", "September", "October", "November", "December"];
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// Dollars from cents. A real amount under a cent says so, rather than "$0.00",
// which would read as nothing at all.
export function money(cents) {
  const c = Number(cents) || 0;
  if (c > 0 && c < 1) return "<$0.01";
  return `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// What one bar of the chart is worth: the spending that moves with use.
export function bucketCents(b) {
  return (Number(b.glidnaMicros) || 0) / 10000 + (Number(b.crewCents) || 0);
}

function bucketName(b, unit) {
  if (unit === "month") {
    const m = Number(b.key.slice(5, 7));
    return `${MONTH_NAMES[m - 1]} ${b.key.slice(0, 4)}`;
  }
  const [y, m, d] = b.key.split("-").map(Number);
  const wd = DAY_NAMES[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${wd}, ${MONTH_NAMES[m - 1].slice(0, 3)} ${d}`;
}

// The small label under a bar: every day for a week, a few for longer spans.
function tickFor(b, i, n, unit) {
  if (unit === "month") return MONTH_NAMES[Number(b.key.slice(5, 7)) - 1].slice(0, 1);
  const [y, m, d] = b.key.split("-").map(Number);
  if (n <= 7) return DAY_NAMES[new Date(Date.UTC(y, m - 1, d)).getUTCDay()].slice(0, 1);
  if (n <= 14) return i % 2 === 0 ? String(d) : "";
  return d === 1 || d % 7 === 1 ? String(d) : "";
}

const plural = (n, one, many) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

export default function HQSpend({ load, saveCosts, initial = null, focus = null, onClose }) {
  const [period, setPeriod] = useState(initial ? initial.period : "month");
  const [offset, setOffset] = useState(0);
  const cache = useRef(new Map(initial ? [[`${initial.period}:${initial.offset}`, initial]] : []));
  const [report, setReport] = useState(initial);
  const [state, setState] = useState(initial ? "ready" : "loading");
  const [err, setErr] = useState("");
  const [picked, setPicked] = useState(null);
  const [editing, setEditing] = useState(false);
  const [price, setPrice] = useState("");
  const [saving, setSaving] = useState(false);
  const sheetRef = useRef(null);
  const claudeRef = useRef(null);

  const fetchReport = useCallback(async (p, o, { fresh = false } = {}) => {
    const key = `${p}:${o}`;
    if (!fresh && cache.current.has(key)) {
      setReport(cache.current.get(key));
      setState("ready");
      return;
    }
    setState((s) => (s === "ready" ? "refreshing" : "loading"));
    try {
      const r = await load(p, o);
      cache.current.set(key, r);
      setReport(r);
      setState("ready");
      setErr("");
    } catch (e) {
      setState("error");
      setErr((e && e.message) || "Couldn't load spending. Check your connection and try again.");
    }
  }, [load]);

  useEffect(() => { fetchReport(period, offset); setPicked(null); }, [period, offset, fetchReport]);

  useEffect(() => {
    if (sheetRef.current) sheetRef.current.focus({ preventScroll: true });
    if (focus === "claude" && claudeRef.current) {
      requestAnimationFrame(() => claudeRef.current && claudeRef.current.scrollIntoView({ block: "center" }));
    }
  }, [focus]);

  const choosePeriod = (p) => { setPeriod(p); setOffset(0); };
  const r = state === "ready" || state === "refreshing" ? report : null;
  const buckets = (r && r.buckets) || [];
  const values = buckets.map(bucketCents);
  const max = Math.max(0, ...values);
  const anySpend = max > 0;
  const pickedBucket = picked != null ? buckets[picked] : null;

  const startEdit = () => {
    setPrice(r ? String(Math.round(r.claude.planCents) / 100) : "");
    setEditing(true);
  };
  const submitPrice = async (e) => {
    e.preventDefault();
    const dollars = Number(price);
    if (!Number.isFinite(dollars) || dollars < 0 || dollars > 10000) {
      setErr("Enter the plan's monthly price in dollars, like 200.");
      return;
    }
    setSaving(true);
    try {
      await saveCosts({ claudePlanCents: Math.round(dollars * 100) });
      cache.current.clear();
      setEditing(false);
      setErr("");
      await fetchReport(period, offset, { fresh: true });
    } catch (e2) {
      setErr((e2 && e2.message) || "Couldn't save the new price. Try again.");
    } finally {
      setSaving(false);
    }
  };

  const unitWord = r && r.unit === "month" ? "month" : "day";
  const chartLabel = r
    ? (anySpend
      ? `AI spending per ${unitWord} for ${r.label}. Highest: ${money(max)}.`
      : `No AI spending recorded for ${r.label}.`)
    : "Loading spending.";

  return (
    <div className="hq-spend-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <section className="hq-spend" role="dialog" aria-modal="true" aria-labelledby="hq-spend-title"
        ref={sheetRef} tabIndex={-1}>
        <div className="hq-spend-head">
          <h2 id="hq-spend-title" className="hq-h2">Spending</h2>
          <button type="button" className="hq-spend-x" onClick={onClose} aria-label="Close spending">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2"
              strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
          </button>
        </div>

        <div className="hq-spend-periods" role="group" aria-label="Time frame">
          {SPEND_PERIODS.map((p) => (
            <button key={p.id} type="button" aria-pressed={period === p.id} onClick={() => choosePeriod(p.id)}>
              {p.label}
            </button>
          ))}
        </div>

        <div className="hq-spend-nav">
          <button type="button" onClick={() => setOffset((o) => o - 1)} aria-label="Earlier">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2"
              strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m15 6-6 6 6 6" /></svg>
          </button>
          <span className="hq-spend-when" aria-live="polite">{r ? r.label : "…"}</span>
          <button type="button" onClick={() => setOffset((o) => Math.min(0, o + 1))} disabled={!r || !r.hasNext}
            aria-label="Later">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2"
              strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>
          </button>
        </div>

        {state === "loading" && <p className="hq-spend-status">Adding it up…</p>}
        {state === "error" && (
          <div className="hq-spend-status hq-spend-error" role="alert">
            <p>{err}</p>
            <button type="button" className="hq-btn hq-btn-ghost" onClick={() => fetchReport(period, offset, { fresh: true })}>Try again</button>
          </div>
        )}

        {r && (
          <>
            <div className={`hq-spend-total${state === "refreshing" ? " is-refreshing" : ""}`}>
              <b>{money(r.totalCents)}</b>
              <span>in all for {r.label}</span>
            </div>

            <div className="hq-chart" role="img" aria-label={chartLabel}>
              <div className="hq-chart-bars">
                {buckets.map((b, i) => {
                  const v = values[i];
                  const h = anySpend ? Math.max(v > 0 ? 3 : 0, (v / max) * 100) : 0;
                  return (
                    <button key={b.key} type="button" aria-hidden="true" tabIndex={-1}
                      className={`hq-bar${picked === i ? " is-picked" : ""}${b.future ? " is-future" : ""}`}
                      onClick={() => setPicked(picked === i ? null : i)}>
                      <i style={{ height: `${h}%` }} />
                    </button>
                  );
                })}
              </div>
              <div className="hq-chart-ticks" aria-hidden="true">
                {buckets.map((b, i) => <span key={b.key}>{tickFor(b, i, buckets.length, r.unit)}</span>)}
              </div>
            </div>
            <p className="hq-chart-note">
              {pickedBucket
                ? `${bucketName(pickedBucket, r.unit)}: ${money(bucketCents(pickedBucket))} · ${plural(pickedBucket.calls, "AI request", "AI requests")}`
                : anySpend ? `Tap a bar to see that ${unitWord}.` : "No AI spending recorded in this time frame."}
            </p>

            <ul className="hq-spend-lines">
              <li>
                <span className="hq-swatch hq-swatch-ai" aria-hidden="true" />
                <div>
                  <div className="hq-line-top"><b>Glidna AI</b><b>{money(r.glidna.cents)}</b></div>
                  <p>{plural(r.glidna.calls, "AI request", "AI requests")} from members: chats, food estimates and photos.</p>
                  {r.glidna.untrackedTokens > 0 && (
                    <p>Some AI use in this period came before Glidna started recording what each request cost, so it isn&rsquo;t priced here.</p>
                  )}
                </div>
              </li>
              <li>
                <span className="hq-swatch hq-swatch-cloud" aria-hidden="true" />
                <div>
                  <div className="hq-line-top"><b>Crew on Glidna cloud</b><b>{money(r.crew.cloudCents)}</b></div>
                  <p>{r.crew.cloudShifts
                    ? `${plural(r.crew.cloudShifts, "shift", "shifts")} on Glidna's servers.`
                    : "No cloud shifts in this time frame."}</p>
                </div>
              </li>
              <li ref={claudeRef}>
                <span className="hq-swatch hq-swatch-claude" aria-hidden="true" />
                <div>
                  <div className="hq-line-top"><b>{r.claude.planName}</b><b>{money(r.claude.shareCents)}</b></div>
                  <p>
                    {money(r.claude.planCents)} a month, flat
                    {r.period === "month" ? "." : r.period === "year" ? ", for each month in this year so far." : ". This is this time frame's share of it."}
                    {" "}{r.crew.claudeShifts
                      ? `${plural(r.crew.claudeShifts, "crew shift", "crew shifts")} ran on it (${plural(r.crew.claudeMinutes, "minute", "minutes")}).`
                      : "No crew shifts ran on it in this time frame."}
                  </p>
                  {r.claude.meter && r.claude.meter.windows && (
                    <ul className="hq-meter">
                      {r.claude.meter.windows.map((w) => (
                        <li key={w.label}><span>{w.label}</span><b>{Math.round(w.percentUsed)}% used</b></li>
                      ))}
                    </ul>
                  )}
                  {editing ? (
                    <form className="hq-price" onSubmit={submitPrice}>
                      <label htmlFor="hq-plan-price">Monthly price in dollars</label>
                      <div>
                        <input id="hq-plan-price" inputMode="decimal" value={price}
                          onChange={(e) => setPrice(e.target.value.replace(/[^\d.]/g, ""))} />
                        <button type="submit" className="hq-btn hq-btn-primary" disabled={saving}>{saving ? "Saving…" : "Save"}</button>
                        <button type="button" className="hq-btn hq-btn-ghost" onClick={() => setEditing(false)} disabled={saving}>Cancel</button>
                      </div>
                    </form>
                  ) : (
                    <div className="hq-line-actions">
                      <a className="hq-link" href={CLAUDE_USAGE_URL} target="_blank" rel="noopener noreferrer">
                        See your live Claude limits
                      </a>
                      <button type="button" className="hq-link" onClick={startEdit}>Change the price</button>
                    </div>
                  )}
                </div>
              </li>
            </ul>
            {err && state !== "error" && <p className="hq-spend-error" role="alert">{err}</p>}
            <p className="hq-spend-foot">
              Glidna AI is what each AI request cost at Anthropic&rsquo;s published prices, recorded as it happens.
              Your Claude plan is a flat subscription, so it shows as its share of the time frame. Claude
              doesn&rsquo;t let apps read its usage meter, so the live limits open on claude.ai.
            </p>
          </>
        )}
      </section>
    </div>
  );
}

export const SPEND_CSS = `
.hq-spend-backdrop {
  position: fixed; inset: 0; z-index: 2500; display: flex; align-items: flex-end; justify-content: center;
  background: rgba(0,0,0,.62);
}
@media (min-width: 700px) { .hq-spend-backdrop { align-items: center; padding: 24px; } }
.hq-spend {
  width: 100%; max-width: 560px; max-height: min(92vh, 900px); overflow-y: auto; overscroll-behavior: contain;
  background: var(--hq-panel); border: 1px solid var(--hq-line2); border-radius: 16px 16px 0 0;
  padding: 16px 16px calc(20px + env(safe-area-inset-bottom, 0px));
}
@media (min-width: 700px) { .hq-spend { border-radius: 16px; } }
.hq-spend:focus { outline: none; }
.hq-spend-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.hq-spend-x {
  display: inline-grid; place-items: center; width: 36px; height: 36px; border-radius: 10px;
  border: 1px solid var(--hq-line2); background: transparent; cursor: pointer;
}
.hq-spend-periods {
  display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 4px; margin-top: 12px;
  padding: 3px; border: 1px solid var(--hq-line2); border-radius: 10px;
}
.hq-spend-periods button {
  border: 0; border-radius: 7px; background: transparent; color: var(--hq-muted); padding: 8px 4px;
  font-size: 13px; cursor: pointer; white-space: nowrap;
}
.hq-spend-periods button[aria-pressed="true"] { background: rgba(8,220,224,.16); color: var(--hq-cyan); font-weight: 600; }
.hq-spend-nav { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 12px; }
.hq-spend-nav button {
  display: inline-grid; place-items: center; width: 36px; height: 36px; border-radius: 10px;
  border: 1px solid var(--hq-line2); background: transparent; cursor: pointer;
}
.hq-spend-nav button:disabled { opacity: .35; cursor: default; }
.hq-spend-when { font-family: var(--hq-display); font-weight: 600; font-size: 15px; text-align: center; }
.hq-spend-status { margin: 18px 0; color: var(--hq-muted); text-align: center; }
.hq-spend-error { color: #FCA5A5; }
.hq-spend-total { margin: 14px 0 6px; display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; transition: opacity .2s; }
.hq-spend-total.is-refreshing { opacity: .55; }
.hq-spend-total b { font-family: var(--hq-display); font-size: 32px; letter-spacing: -.01em; font-variant-numeric: tabular-nums; }
.hq-spend-total span { color: var(--hq-muted); font-size: 13px; }
.hq-chart { margin-top: 6px; }
.hq-chart-bars {
  display: flex; align-items: flex-end; gap: 2px; height: 120px; padding: 0 2px;
  border-bottom: 1px solid var(--hq-line2);
}
.hq-bar {
  flex: 1 1 0; min-width: 0; height: 100%; display: flex; align-items: flex-end; padding: 0; border: 0;
  background: transparent; cursor: pointer;
}
.hq-bar i { display: block; width: 100%; border-radius: 2px 2px 0 0; background: var(--hq-cyan); opacity: .8; }
.hq-bar.is-picked i { opacity: 1; box-shadow: 0 0 8px rgba(8,220,224,.6); }
.hq-bar.is-future i { opacity: .25; }
.hq-chart-ticks { display: flex; gap: 2px; padding: 3px 2px 0; }
.hq-chart-ticks span { flex: 1 1 0; min-width: 0; text-align: center; font-size: 10px; color: var(--hq-muted); overflow: visible; white-space: nowrap; }
.hq-chart-note { margin: 8px 0 0; font-size: 13px; color: var(--hq-muted); min-height: 1.5em; }
.hq-spend-lines { list-style: none; margin: 14px 0 0; padding: 0; display: grid; gap: 10px; }
.hq-spend-lines > li {
  display: grid; grid-template-columns: 10px 1fr; gap: 10px; padding: 12px; border-radius: 12px;
  background: var(--hq-panel2); border: 1px solid var(--hq-line);
}
.hq-spend-lines p { margin: 4px 0 0; font-size: 13px; color: var(--hq-muted); }
.hq-line-top { display: flex; justify-content: space-between; gap: 12px; }
.hq-line-top b:last-child { font-variant-numeric: tabular-nums; }
.hq-swatch { width: 10px; height: 10px; border-radius: 3px; margin-top: 6px; }
.hq-swatch-ai { background: var(--hq-cyan); }
.hq-swatch-cloud { background: #60A5FA; }
.hq-swatch-claude { background: #D97757; }
.hq-line-actions { display: flex; flex-wrap: wrap; gap: 6px 16px; margin-top: 8px; }
.hq-line-actions .hq-link { color: var(--hq-cyan); padding: 2px 0; font-size: 13px; }
.hq-meter { list-style: none; margin: 8px 0 0; padding: 0; display: grid; gap: 2px; font-size: 13px; }
.hq-meter li { display: flex; justify-content: space-between; gap: 12px; }
.hq-price { margin-top: 10px; }
.hq-price label { display: block; font-size: 12px; color: var(--hq-muted); margin-bottom: 4px; }
.hq-price div { display: flex; gap: 8px; flex-wrap: wrap; }
.hq-price input {
  width: 110px; font-size: 16px; padding: 7px 10px; border-radius: 8px; border: 1px solid var(--hq-line2);
  background: var(--hq-bg); color: var(--hq-text);
}
.hq-spend-foot { margin: 14px 0 0; font-size: 12px; color: var(--hq-muted); line-height: 1.5; }
`;
