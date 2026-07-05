// Showcase.jsx — a dev-only style showcase + live theme switcher (Part 2 of the
// Tailwind design brief). Reached at /?showcase=1. Renders the key building
// blocks under the active theme so Kevin can compare looks side by side.
//
// It is fully isolated: main.jsx mounts this INSTEAD of the app when ?showcase=1
// is present, so it never touches the real app or its auth flow. Everything here
// uses Tailwind utilities backed by the semantic theme tokens (themes.css), so
// flipping the theme re-skins the whole page instantly.
//
// Note: preflight (Tailwind's reset) is intentionally off app-wide, so elements
// here are styled explicitly (no reliance on default button/heading resets).
import { useState, useEffect } from "react";
import "./showcase-fonts.css";

const THEMES = [
  { id: "clean", label: "Clean / Minimal", blurb: "Light, airy, restrained" },
  { id: "bold",  label: "Bold / Energetic", blurb: "High-contrast, motivating" },
  { id: "warm",  label: "Warm / Friendly", blurb: "Soft, approachable, rounded" },
  { id: "pro",   label: "Dark / Pro", blurb: "Premium, sharp data" },
];

const SWATCHES = [
  ["Background", "bg-bg"], ["Surface", "bg-surface"], ["Surface 2", "bg-surface2"],
  ["Primary", "bg-primary"], ["Accent", "bg-accent"], ["Success", "bg-success"],
  ["Warn", "bg-warn"], ["Danger", "bg-danger"],
];

// Reusable token-driven pieces ------------------------------------------------
function Btn({ kind = "primary", children }) {
  const base = "px-4 py-2.5 rounded-card font-sans font-semibold text-sm cursor-pointer transition";
  const styles = {
    primary: "bg-primary text-primaryfg border-0",
    secondary: "bg-surface2 text-fg border border-border",
    ghost: "bg-transparent text-primary border border-primary",
    danger: "bg-danger text-white border-0",
  };
  return <button className={`${base} ${styles[kind]}`}>{children}</button>;
}

function Card({ children, className = "" }) {
  return (
    <div className={`bg-surface border border-border rounded-card p-5 ${className}`}
      style={{ boxShadow: "0 1px 3px rgba(0,0,0,.06), 0 8px 24px rgba(0,0,0,.06)" }}>
      {children}
    </div>
  );
}

function Ring({ pct = 68 }) {
  const r = 46, c = 2 * Math.PI * r, off = c - (pct / 100) * c;
  return (
    <div className="relative inline-grid place-items-center">
      <svg width="120" height="120" viewBox="0 0 120 120" className="-rotate-90">
        <circle cx="60" cy="60" r={r} fill="none" stroke="var(--color-surface2)" strokeWidth="11" />
        <circle cx="60" cy="60" r={r} fill="none" stroke="var(--color-primary)" strokeWidth="11"
          strokeLinecap="round" strokeDasharray={c} strokeDashoffset={off} />
      </svg>
      <div className="absolute text-center">
        <div className="font-display text-3xl leading-none text-fg">1,540</div>
        <div className="text-[11px] uppercase tracking-wide text-muted">cal left</div>
      </div>
    </div>
  );
}

function StatTile({ icon, value, label, tone = "fg" }) {
  const toneClass = { fg: "text-fg", primary: "text-primary", accent: "text-accent", success: "text-success", danger: "text-danger" }[tone];
  return (
    <div className="bg-surface2 rounded-card p-4 text-center">
      <div className="text-xl">{icon}</div>
      <div className={`font-display text-2xl leading-tight ${toneClass}`}>{value}</div>
      <div className="text-[11px] uppercase tracking-wide text-muted">{label}</div>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div className="mb-10">
      <div className="font-display text-lg tracking-wide text-muted uppercase mb-3">{title}</div>
      {children}
    </div>
  );
}

export default function Showcase() {
  const [theme, setTheme] = useState(() => {
    try {
      const url = new URLSearchParams(location.search).get("theme");
      return url || localStorage.getItem("caliq-showcase-theme") || "clean";
    } catch { return "clean"; }
  });
  useEffect(() => {
    try {
      localStorage.setItem("caliq-showcase-theme", theme);
      const u = new URL(location.href);
      u.searchParams.set("showcase", "1");
      u.searchParams.set("theme", theme);
      history.replaceState(null, "", u);
    } catch { /* ignore */ }
  }, [theme]);

  return (
    <div data-theme={theme} className="min-h-screen bg-bg text-fg font-sans">
      {/* Theme switcher bar */}
      <div className="sticky top-0 z-10 bg-surface border-b border-border px-4 py-3"
        style={{ backdropFilter: "saturate(140%) blur(6px)" }}>
        <div className="max-w-3xl mx-auto flex flex-wrap items-center gap-3">
          <div className="font-display text-xl tracking-wide text-fg mr-1">
            GLIDE
            <span className="ml-2 text-[11px] uppercase tracking-widest text-muted align-middle">design preview</span>
          </div>
          <div className="flex flex-wrap gap-2 ml-auto">
            {THEMES.map((t) => (
              <button key={t.id} onClick={() => setTheme(t.id)}
                className={`px-3 py-1.5 rounded-card text-xs font-semibold cursor-pointer transition border ${
                  theme === t.id ? "bg-primary text-primaryfg border-0" : "bg-transparent text-muted border-border"}`}>
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 py-8">
        <div className="mb-8">
          <div className="font-display text-4xl text-fg leading-tight">Style showcase</div>
          <div className="text-muted mt-1">
            Active theme: <span className="text-primary font-semibold">{THEMES.find((t) => t.id === theme)?.label}</span>
            {" — "}{THEMES.find((t) => t.id === theme)?.blurb}. Flip themes above to compare.
          </div>
        </div>

        <Section title="Palette">
          <div className="grid grid-cols-4 gap-3">
            {SWATCHES.map(([name, cls]) => (
              <div key={name} className="text-center">
                <div className={`h-14 rounded-card border border-border ${cls}`} />
                <div className="text-[11px] text-muted mt-1">{name}</div>
              </div>
            ))}
          </div>
        </Section>

        <Section title="Buttons">
          <div className="flex flex-wrap gap-3">
            <Btn kind="primary">Primary</Btn>
            <Btn kind="secondary">Secondary</Btn>
            <Btn kind="ghost">Ghost</Btn>
            <Btn kind="danger">Danger</Btn>
          </div>
        </Section>

        <Section title="Inputs">
          <div className="grid sm:grid-cols-2 gap-4 max-w-lg">
            <div>
              <label className="block text-xs uppercase tracking-wide text-muted mb-1.5">Current weight</label>
              <input placeholder="e.g. 182" className="w-full bg-surface2 border border-border rounded-card px-3.5 py-2.5 text-fg outline-none"
                style={{ fontFamily: "var(--font-sans)" }} />
            </div>
            <div>
              <label className="block text-xs uppercase tracking-wide text-muted mb-1.5">Goal weight</label>
              <input placeholder="e.g. 165" className="w-full bg-surface2 border border-border rounded-card px-3.5 py-2.5 text-fg outline-none"
                style={{ fontFamily: "var(--font-sans)" }} />
            </div>
          </div>
        </Section>

        <Section title="Cards">
          <div className="grid sm:grid-cols-2 gap-4">
            <Card>
              <div className="font-display text-xl text-primary mb-1">Weight &amp; goal</div>
              <div className="text-muted text-sm mb-3">On track — 15 lbs to go</div>
              <div className="font-display text-4xl text-fg">182 <span className="text-muted text-2xl">→ 165 lbs</span></div>
            </Card>
            <Card>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-success text-white">On track</span>
                <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-warn text-white">3 days left</span>
              </div>
              <div className="text-fg text-sm leading-relaxed">
                Color signals meaning (progress, warnings) — not decoration. Contrast targets WCAG AA.
              </div>
            </Card>
          </div>
        </Section>

        <Section title="Progress & data">
          <Card>
            <div className="flex flex-wrap items-center gap-6">
              <Ring pct={68} />
              <div className="flex-1 min-w-[220px]">
                <div className="grid grid-cols-3 gap-3 mb-4">
                  <StatTile icon="🎯" value="2,365" label="Target" tone="primary" />
                  <StatTile icon="🍽️" value="825" label="Eaten" tone="fg" />
                  <StatTile icon="🔥" value="0" label="Burn" tone="accent" />
                </div>
                <div className="text-xs text-muted mb-1.5">Protein · 96 / 150 g</div>
                <div className="h-2.5 rounded-full bg-surface2 overflow-hidden">
                  <div className="h-full bg-accent" style={{ width: "64%" }} />
                </div>
              </div>
            </div>
          </Card>
        </Section>

        <Section title="Mini dashboard">
          <div className="bg-bg rounded-card border border-border p-5">
            <div className="text-muted text-sm">Sunday, June 22</div>
            <div className="font-display text-3xl text-fg mb-4">Hey, Casey 👋</div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
              <StatTile icon="⚖️" value="182" label="Current" />
              <StatTile icon="📉" value="-18" label="Since start" tone="success" />
              <StatTile icon="🔥" value="6" label="Day streak" tone="accent" />
              <StatTile icon="📅" value="4/5" label="Workouts" tone="primary" />
            </div>
            <div className="flex gap-3">
              <Btn kind="primary">Log today</Btn>
              <Btn kind="secondary">Full plan</Btn>
            </div>
          </div>
        </Section>

        <div className="text-center text-muted text-xs py-6">
          Dev-only preview · /?showcase=1 · theme: {theme}
        </div>
      </div>
    </div>
  );
}
