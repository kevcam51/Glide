import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { ROLES, getProfile, joinTrainer, getMyClients, ensureInviteCode, formatInviteCode, setName, splitName, leaveTrainer, trialInfo } from "./profile.js";
import { getForUser, setForUser, deleteForUser, listForUser, subscribeForUser } from "./clientData.js";
import { auth, functions } from "./firebase.js";
import { signOut } from "firebase/auth";
import { httpsCallable } from "firebase/functions";
import { Icon } from "./icons.jsx";

// ─── Data ─────────────────────────────────────────────────────────────────────

const ACTIVITY_LEVELS = [
  { id:"sedentary", label:"Sedentary",         emoji:"🪑", desc:"Desk/office job, mostly sitting all day, drive everywhere",                multiplier:1.2   },
  { id:"light",     label:"Lightly Active",    emoji:"🚶", desc:"Some walking during the day, light on-your-feet tasks, occasional errands", multiplier:1.375 },
  { id:"moderate",  label:"Moderately Active", emoji:"🏃", desc:"On your feet most of the day — retail, teaching, nursing, warehouse work",  multiplier:1.55  },
  { id:"very",      label:"Very Active",       emoji:"⚡", desc:"Physically demanding job — construction, landscaping, manual labor",         multiplier:1.725 },
  { id:"extra",     label:"Extremely Active",  emoji:"🔥", desc:"Intense physical labor all day — roofing, farming, moving heavy loads",      multiplier:1.9   },
];

const CARDIO_GROUPS = [
  { group:"🏃 Treadmill & Walking", options:[
    { id:"walk_flat",        label:"Treadmill Walk – Flat",        icon:"🚶", met:3.5  },
    { id:"incline_walk_5",   label:"Incline Walk 5%",              icon:"🚶", met:4.5  },
    { id:"incline_walk_8",   label:"Incline Walk 8%",              icon:"⛰️", met:6.0  },
    { id:"incline_walk_10",  label:"Incline Walk 10%",             icon:"⛰️", met:7.0  },
    { id:"incline_walk_12",  label:"Incline Walk 12%",             icon:"🏔️", met:7.5  },
    { id:"incline_walk_15",  label:"Incline Walk 15%",             icon:"🏔️", met:8.5  },
    { id:"treadmill_jog",    label:"Treadmill Jog (~5 mph)",       icon:"🏃", met:8.3  },
    { id:"treadmill_run",    label:"Treadmill Run (~6–7 mph)",     icon:"🏅", met:10.0 },
    { id:"treadmill_sprint", label:"Sprint Intervals",             icon:"⚡", met:12.5 },
  ]},
  { group:"🔄 Elliptical", options:[
    { id:"elliptical_easy",  label:"Elliptical – Easy",            icon:"🔄", met:4.0  },
    { id:"elliptical_mod",   label:"Elliptical – Moderate",        icon:"🔄", met:5.0  },
    { id:"elliptical_vig",   label:"Elliptical – Vigorous",        icon:"⚡", met:7.5  },
  ]},
  { group:"🪜 Stair Machines", options:[
    { id:"stairmaster_slow", label:"StairMaster – Slow",           icon:"🪜", met:7.0  },
    { id:"stairmaster_mod",  label:"StairMaster – Moderate",       icon:"🪜", met:9.0  },
    { id:"stairmaster_fast", label:"StairMaster – Fast",           icon:"🏗️", met:11.0 },
    { id:"stair_real",       label:"Climbing Real Stairs",         icon:"🏢", met:8.0  },
  ]},
  { group:"🚴 Cycling", options:[
    { id:"cycling_easy",     label:"Cycling – Easy",               icon:"🚴", met:5.5  },
    { id:"cycling_mod",      label:"Cycling – Moderate",           icon:"🚴", met:6.8  },
    { id:"cycling_vig",      label:"Cycling – Vigorous",           icon:"💨", met:10.0 },
    { id:"spin_class",       label:"Spin Class",                   icon:"🔥", met:8.5  },
  ]},
  { group:"🚣 Rowing & Machines", options:[
    { id:"rowing_easy",      label:"Rowing – Easy",                icon:"🚣", met:5.0  },
    { id:"rowing_mod",       label:"Rowing – Moderate",            icon:"🚣", met:7.0  },
    { id:"rowing_hard",      label:"Rowing – Hard",                icon:"🚣", met:10.0 },
    { id:"ski_erg",          label:"Ski Erg",                      icon:"⛷️", met:9.5  },
    { id:"assault_bike",     label:"Assault / Air Bike",           icon:"💀", met:13.0 },
    { id:"versa_climber",    label:"VersaClimber",                 icon:"🧗", met:11.5 },
    { id:"jacob_ladder",     label:"Jacob's Ladder",               icon:"🪜", met:12.0 },
  ]},
  { group:"🏊 Swimming & Water", options:[
    { id:"swim_easy",        label:"Swimming – Easy",              icon:"🏊", met:5.0  },
    { id:"swim_mod",         label:"Swimming – Moderate",          icon:"🏊", met:7.0  },
    { id:"swim_hard",        label:"Swimming – Hard",              icon:"🏊", met:9.8  },
    { id:"water_aerobics",   label:"Water Aerobics",               icon:"💧", met:4.0  },
  ]},
  { group:"🥊 HIIT, Boxing & Jump Rope", options:[
    { id:"hiit",             label:"HIIT Cardio",                  icon:"🔥", met:12.0 },
    { id:"boxing_bag",       label:"Heavy Bag Boxing",             icon:"🥊", met:9.8  },
    { id:"shadow_boxing",    label:"Shadow Boxing",                icon:"🥋", met:7.5  },
    { id:"kickboxing",       label:"Kickboxing Class",             icon:"🥊", met:8.0  },
    { id:"jump_rope",        label:"Jump Rope – Moderate",         icon:"🪢", met:11.0 },
    { id:"jump_rope_fast",   label:"Jump Rope – Fast/Double",      icon:"⚡", met:13.0 },
  ]},
  { group:"🏀 Sports & Outdoor", options:[
    { id:"basketball",       label:"Basketball – Game",            icon:"🏀", met:8.0  },
    { id:"bball_drills",     label:"Basketball – Drills",          icon:"🏀", met:4.5  },
    { id:"soccer",           label:"Soccer / Football",            icon:"⚽", met:8.0  },
    { id:"tennis",           label:"Tennis – Singles",             icon:"🎾", met:7.3  },
    { id:"pickleball",       label:"Pickleball",                   icon:"🏓", met:6.0  },
    { id:"volleyball",       label:"Volleyball",                   icon:"🏐", met:4.0  },
    { id:"flag_football",    label:"Flag Football",                icon:"🏈", met:7.0  },
    { id:"hiking",           label:"Hiking",                       icon:"🥾", met:6.0  },
    { id:"outdoor_jog",      label:"Outdoor Jog (~5 mph)",         icon:"🏃", met:8.3  },
    { id:"outdoor_run",      label:"Outdoor Run (~7–8 mph)",       icon:"🏅", met:11.0 },
    { id:"rollerblading",    label:"Rollerblading",                icon:"🛼", met:7.0  },
    { id:"dancing",          label:"Dance Cardio / Zumba",         icon:"💃", met:6.5  },
    { id:"martial_arts",     label:"Martial Arts",                 icon:"🥋", met:10.0 },
    { id:"wrestling",        label:"Wrestling / Grappling",        icon:"🤼", met:8.0  },
  ]},
  { group:"😴 Rest", options:[
    { id:"rest", label:"Rest Day", icon:"😴", met:0 },
  ]},
];

const ALL_CARDIO = CARDIO_GROUPS.flatMap(g => g.options);
const DURATIONS  = [10,15,20,25,30,35,40,45,50,60,75,90];
const DAYS       = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];
const DAY_SHORT  = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function calcBMR(gender, weightLbs, heightFt, heightIn, age) {
  const kg = weightLbs * 0.453592;
  const cm = (heightFt * 12 + Number(heightIn)) * 2.54;
  return gender === "male"
    ? 10*kg + 6.25*cm - 5*age + 5
    : 10*kg + 6.25*cm - 5*age - 161;
}
function calcBurn(met, weightLbs, minutes) {
  if (!met || !minutes) return 0;
  return Math.round(met * weightLbs * 0.453592 * (minutes / 60));
}
function weeksToGoal(totalLbs, weeklyDeficitCal) {
  if (weeklyDeficitCal <= 0) return null;
  return totalLbs / (weeklyDeficitCal / 3500);
}

// Clean time label: whole weeks under 8 weeks, then "X months" or "X months Y weeks"
function friendlyTime(wks) {
  if (wks == null) return "—";
  const totalWks = Math.round(wks);
  if (totalWks < 1)  return "< 1 week";
  if (totalWks < 8)  return `${totalWks} week${totalWks !== 1 ? "s" : ""}`;
  const months   = Math.floor(totalWks / 4.33);
  const remWeeks = Math.round(totalWks - months * 4.33);
  if (remWeeks < 1)  return `${months} month${months !== 1 ? "s" : ""}`;
  return `${months} month${months !== 1 ? "s" : ""} ${remWeeks} week${remWeeks !== 1 ? "s" : ""}`;
}

// Short version for cards: "6 wks" / "3 mo" / "~3 mo"
function formatWeeks(w) {
  if (w == null) return "—";
  const wk = Math.round(w);
  if (wk < 8) return `~${wk} week${wk !== 1 ? "s" : ""}`;
  const mo = Math.round(w / 4.33);
  return `~${mo} month${mo !== 1 ? "s" : ""}`;
}

// Observed weight trend from logged weigh-ins, via least-squares regression of
// weight vs. time. Returns { ratePerWeek (lbs/wk; negative = losing), spanDays,
// n } or null when there isn't enough spread to be meaningful (need 2+ points
// across at least ~3 days, so same-day logs don't produce a bogus rate).
function weightTrend(checkIns) {
  const pts = [...(checkIns || [])].filter(c => c.weight && c.timestamp)
    .sort((a, b) => a.timestamp - b.timestamp);
  if (pts.length < 2) return null;
  const t0 = pts[0].timestamp;
  const spanDays = (pts[pts.length - 1].timestamp - t0) / 86400000;
  if (spanDays < 3) return null;
  const xs = pts.map(p => (p.timestamp - t0) / 86400000); // days since first
  const ys = pts.map(p => p.weight);
  const n = xs.length;
  const sx = xs.reduce((a, b) => a + b, 0);
  const sy = ys.reduce((a, b) => a + b, 0);
  const sxx = xs.reduce((a, b) => a + b * b, 0);
  const sxy = xs.reduce((a, _, i) => a + xs[i] * ys[i], 0);
  const denom = n * sxx - sx * sx;
  if (denom === 0) return null;
  const slopePerDay = (n * sxy - sx * sy) / denom; // lbs/day
  return { ratePerWeek: slopePerDay * 7, spanDays, n };
}

// Weeks to move from `current` to `target` at `ratePerWeek`. Returns null when
// the trend isn't heading toward the target (wrong direction / flat).
function etaWeeks(current, target, ratePerWeek) {
  const remaining = target - current; // signed
  if (Math.abs(remaining) < 0.05) return 0; // effectively there
  if (!ratePerWeek) return null;
  if ((remaining < 0) === (ratePerWeek < 0)) return remaining / ratePerWeek;
  return null; // trending away
}
function projectedLoss(weeks, weeklyDeficitCal) {
  return (weeklyDeficitCal / 3500) * weeks;
}

// ─── CSS ──────────────────────────────────────────────────────────────────────

const css = `
@import url('https://fonts.googleapis.com/css2?family=DM+Sans:ital,wght@0,400;0,500;0,600;0,700;1,400&display=swap');

/* ── Reset ── */
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}

/* ── Design tokens ── */
:root{
  /* Core palette — aligned to the Smooth Training brand "pro" theme (Session 31):
     cyan-tinted near-black, replacing the old purple-tinted dark. This brings the
     remaining old-var in-plan screens (Results, DailyDashboard, MealLog,
     ActivityFeed, AICoach, the exercise pickers) on-brand without a markup
     rewrite. Mirrors src/themes.css [data-theme="pro"]. */
  --bg:#05080a;
  --surface:#161f24;
  --s2:#1e2a2e;
  --s3:#28383a;
  --border:#2e4241;
  --border-light:#3a5250;

  /* Brand colors */
  --accent:#08dce0;
  --accent-fill:#18afb3;
  --accent-dim:rgba(8,220,224,.12);
  --orange:#ff6b35;
  --green:#2fe0a8;
  --yellow:#fbbf24;
  --red:#f87171;
  --purple:#b57bff;
  --blue:#4fc3f7;

  /* Text */
  --text:#eafcfc;
  --text-secondary:#c4dede;
  --muted:#7e9a9a;
  --muted-light:#9bb8b8;

  /* Interaction */
  --tap:52px;
  --radius:14px;
  --radius-sm:10px;
  --radius-lg:18px;

  /* Shadows */
  --shadow-sm:0 2px 8px rgba(0,0,0,.35);
  --shadow-md:0 4px 16px rgba(0,0,0,.5);
}

/* ── Base ── */
html{
  -webkit-text-size-adjust:100%;
  font-size:16px;
  scroll-behavior:smooth;
  overflow-y:auto;
  height:auto;
}
body{
  background:var(--bg);
  color:var(--text);
  font-family:'DM Sans',sans-serif;
  font-weight:400;
  line-height:1.5;
  min-height:100vh;
  overflow-y:auto;
  overflow-x:hidden;
}

/* ── App shell ── */
.app{
  min-height:100vh;
  background:var(--bg);
  /* Clear the fixed bottom nav (about 101px tall) at every width — the nav is
     position fixed on all viewports, so the page always needs this gap or the
     last controls sit behind it (the old desktop sticky-nav assumption is gone
     since the nav was rebuilt with Tailwind fixed positioning). */
  padding-bottom:calc(120px + env(safe-area-inset-bottom,0px));
}

/* ── Header — slim top bar (hamburger sits at the left; logo centered) ── */
.header{
  padding:13px 52px;
  text-align:center;
  background:linear-gradient(180deg,rgba(8,220,224,.04) 0%,transparent 100%);
  border-bottom:1px solid var(--border);
  margin-bottom:18px;
}
.logo{
  font-family:'Sora',sans-serif;
  font-size:1.5rem;letter-spacing:4px;
  color:var(--accent);line-height:1;
}
.logo span{color:var(--text)}
.tagline{
  display:none;
  color:var(--muted);font-size:.65rem;
  letter-spacing:2px;text-transform:uppercase;
  margin-top:5px;
}

/* ── Container ── */
.container{max-width:640px;margin:0 auto;padding:0 16px}

/* ── Step progress ── */
.steps-wrap{margin-bottom:24px}
.step-name-row{
  display:flex;justify-content:center;gap:4px;margin-bottom:8px;
}
.step-name-item{
  font-size:.65rem;letter-spacing:.5px;text-transform:uppercase;
  color:var(--muted);flex:1;text-align:center;
  transition:color .3s;max-width:80px;
}
.step-name-item.active{color:var(--accent);font-weight:700}
.step-name-item.done{color:var(--accent);opacity:.45}
.step-lbl{
  font-size:.72rem;color:var(--muted-light);
  letter-spacing:1px;text-transform:uppercase;
  text-align:center;margin-bottom:10px;font-weight:500;
}
.steps-bar{display:flex;gap:6px;justify-content:center}
.step-dot{
  flex:1;max-width:56px;height:4px;
  border-radius:2px;background:var(--border);
  transition:all .35s ease;
}
.step-dot.active{
  background:var(--accent-fill);
  box-shadow:0 0 10px rgba(8,220,224,.5);
}
.step-dot.done{background:var(--accent-fill);opacity:.3}

/* ── Card — the main building block ── */
.card{
  background:var(--surface);
  border:1px solid var(--border);
  border-radius:var(--radius-lg);
  padding:22px 18px;
  margin-bottom:16px;
  box-shadow:var(--shadow-sm);
}
.card-title{
  font-family:'Sora',sans-serif;
  font-size:1.5rem;letter-spacing:2.5px;
  color:var(--accent);margin-bottom:4px;
}
.card-sub{
  color:var(--muted-light);font-size:.85rem;
  margin-bottom:22px;line-height:1.55;
}

/* ── Welcome banner ── */
.welcome-banner{
  background:linear-gradient(135deg,rgba(8,220,224,.07),rgba(79,255,176,.04));
  border:1px solid rgba(8,220,224,.22);
  border-radius:var(--radius-lg);
  padding:18px;margin-bottom:16px;
  display:flex;align-items:flex-start;gap:14px;
  box-shadow:0 0 0 1px rgba(8,220,224,.05);
}
.wb-emoji{font-size:2.2rem;flex-shrink:0;line-height:1;margin-top:2px}
.wb-title{
  font-family:'Sora',sans-serif;font-size:1.4rem;
  letter-spacing:2px;color:var(--accent);margin-bottom:5px;
}
.wb-sub{font-size:.84rem;color:var(--muted-light);line-height:1.55}

/* ── Fields ── */
.field{margin-bottom:16px}
.field label{
  display:block;font-size:.72rem;letter-spacing:.8px;
  text-transform:uppercase;color:var(--muted-light);
  margin-bottom:8px;font-weight:600;
}
.field-hint{
  font-size:.65rem;font-weight:400;color:var(--muted);
  letter-spacing:.2px;margin-left:5px;text-transform:none;
}
.field input,.field select{
  width:100%;
  min-height:var(--tap);
  padding:14px 16px;
  background:var(--s2);
  border:1.5px solid var(--border);
  border-radius:var(--radius-sm);
  color:var(--text);
  font-family:inherit;font-size:16px;
  outline:none;
  transition:border-color .2s,box-shadow .2s;
  appearance:none;-webkit-appearance:none;
}
.field input:focus,.field select:focus{
  border-color:var(--accent);
  box-shadow:0 0 0 3px rgba(8,220,224,.1);
}
.field input::placeholder{color:var(--muted);opacity:.7}
.field-row{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.field-tip{
  font-size:.78rem;color:var(--muted);line-height:1.55;
  padding:11px 14px;margin-top:10px;
  background:rgba(112,112,160,.08);
  border-radius:var(--radius-sm);
  border-left:3px solid rgba(112,112,160,.3);
}
.privacy-note{
  font-size:.7rem;color:var(--muted);text-align:center;
  margin-top:16px;padding-top:14px;border-top:1px solid var(--border);
  line-height:1.5;
}

/* ── Gender toggle — big, clear ── */
.gender-toggle{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.gbtn{
  min-height:var(--tap);
  padding:16px;border-radius:var(--radius-sm);
  border:2px solid var(--border);background:var(--s2);
  color:var(--muted-light);cursor:pointer;
  font-family:inherit;font-size:1rem;font-weight:600;
  transition:all .2s;text-align:center;
  display:flex;align-items:center;justify-content:center;gap:8px;
  -webkit-tap-highlight-color:transparent;
}
.gbtn.active{
  border-color:var(--accent);color:var(--accent);
  background:rgba(8,220,224,.08);
  box-shadow:0 0 0 1px rgba(8,220,224,.2);
}
.gbtn:active{transform:scale(.97)}

/* ── Activity buttons — large, scannable ── */
.abtn{
  width:100%;min-height:60px;
  padding:15px 16px;border-radius:var(--radius-sm);
  border:2px solid var(--border);background:var(--s2);
  color:var(--text);cursor:pointer;font-family:inherit;
  transition:all .15s;text-align:left;
  display:flex;align-items:center;gap:14px;
  margin-bottom:9px;
  -webkit-tap-highlight-color:transparent;
}
.abtn-emoji{font-size:1.6rem;line-height:1;flex-shrink:0}
.abtn .al{font-weight:700;font-size:.97rem;margin-bottom:2px}
.abtn .ad{font-size:.76rem;color:var(--muted);line-height:1.4}
.abtn.active{
  border-color:var(--accent);
  background:rgba(8,220,224,.06);
  box-shadow:0 0 0 1px rgba(8,220,224,.15);
}
.abtn.active .al{color:var(--accent)}
.abtn-check{
  margin-left:auto;color:var(--accent);
  font-size:1.2rem;flex-shrink:0;
  background:rgba(8,220,224,.15);
  width:28px;height:28px;border-radius:50%;
  display:flex;align-items:center;justify-content:center;
}
.abtn:active{transform:scale(.99)}

/* ── Bottom nav / CTA ── */
.bottom-nav{
  position:fixed;bottom:0;left:0;right:0;
  background:rgba(13,13,24,.97);
  border-top:1px solid var(--border);
  padding:14px 16px;
  padding-bottom:calc(14px + env(safe-area-inset-bottom,0px));
  display:flex;gap:10px;
  z-index:30;
  backdrop-filter:blur(20px);
  -webkit-backdrop-filter:blur(20px);
}
.btn{
  flex:1;min-height:var(--tap);
  padding:0 22px;border-radius:12px;border:none;cursor:pointer;
  font-family:'Sora',sans-serif;
  font-size:1.15rem;letter-spacing:2px;
  transition:all .15s;
  display:flex;align-items:center;justify-content:center;
  -webkit-tap-highlight-color:transparent;
}
.btn-p{
  background:var(--accent-fill);color:#0b0b12;font-weight:700;
  box-shadow:0 4px 18px rgba(8,220,224,.3);
}
.btn-p:active{transform:scale(.97);box-shadow:none}
.btn-p:disabled{background:var(--s2);color:var(--muted);border:1.5px solid var(--border);opacity:1;cursor:not-allowed;box-shadow:none}
.btn-g{
  background:var(--s2);color:var(--muted-light);
  border:1.5px solid var(--border);
  flex:0 0 auto;padding:0 20px;
}
.btn-g:active{border-color:var(--muted-light)}

/* ── Result tabs — scrollable row ── */
.rtabs{
  display:grid;grid-template-columns:repeat(4,1fr);gap:4px;
  background:var(--s2);padding:4px;
  border-radius:14px;border:1px solid var(--border);
  margin-bottom:20px;
}
.rtab{
  min-height:50px;min-width:0;
  padding:7px 8px;border-radius:10px;border:none;
  background:transparent;
  font-family:'DM Sans',sans-serif;font-size:.78rem;font-weight:600;
  color:var(--muted);cursor:pointer;transition:all .2s;
  text-align:center;white-space:nowrap;
  -webkit-tap-highlight-color:transparent;
}
.rtab.active{
  background:var(--surface);color:var(--text);
  box-shadow:0 2px 8px rgba(0,0,0,.4);
}

/* ── Hero stat box ── */
.hero{
  background:var(--surface);border:1px solid var(--border);
  border-radius:var(--radius-lg);padding:24px 18px;
  text-align:center;margin-bottom:16px;
  position:relative;overflow:hidden;
}
.hero::before{
  content:'';position:absolute;top:-60px;right:-60px;
  width:160px;height:160px;border-radius:50%;
  background:radial-gradient(circle,rgba(8,220,224,.06) 0%,transparent 70%);
  pointer-events:none;
}
.hero-lbl{font-size:.66rem;letter-spacing:2px;text-transform:uppercase;color:var(--muted);margin-bottom:6px}
.hero-val{font-family:'Sora',sans-serif;font-size:3.6rem;color:var(--accent);line-height:1}
.hero-unit{font-size:.84rem;color:var(--muted-light);margin-top:3px}
.hero-detail{font-size:.74rem;color:var(--muted);margin-top:10px;line-height:1.5}

/* ── Section titles ── */
.sec-title{
  font-family:'Sora',sans-serif;font-size:1.1rem;
  letter-spacing:2px;color:var(--text-secondary);
  margin:20px 0 12px;
  display:flex;align-items:center;gap:10px;
}
.sec-title::after{content:'';flex:1;height:1px;background:var(--border)}

/* ── Deficit cards ── */
.dgrid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px}
.dcard{
  background:var(--surface);border:1px solid var(--border);
  border-radius:var(--radius-sm);padding:16px 10px;text-align:center;
  transition:border-color .2s;
}
.dc-lbl{font-size:.62rem;letter-spacing:.5px;text-transform:uppercase;color:var(--muted);margin-bottom:5px;line-height:1.4}
.dc-val{font-family:'Sora',sans-serif;font-size:1.9rem}
.dc-unit{font-size:.68rem;color:var(--muted)}
.dc-note{font-size:.65rem;color:var(--orange);margin-top:3px;line-height:1.3}

/* ── Day result cards — editable ── */
.day-result-card{
  background:var(--surface);border:1.5px solid var(--border);
  border-radius:var(--radius-sm);margin-bottom:10px;overflow:hidden;
  transition:border-color .2s,box-shadow .2s;
}
.day-result-card.editable{cursor:pointer}
.day-result-card.editable .drc-header::after{
  content:'✏️';font-size:.68rem;flex-shrink:0;opacity:.3;transition:opacity .15s;
}
.day-result-card.drc-open{
  border-color:var(--accent);
  box-shadow:0 0 0 1px rgba(8,220,224,.15);
}
.day-result-card.drc-open .drc-header::after{opacity:0}
.drc-header{
  display:flex;align-items:center;gap:9px;padding:13px 14px;
  cursor:pointer;-webkit-tap-highlight-color:transparent;
  transition:background .15s;
}
.drc-header:active{background:rgba(255,255,255,.02)}
.drc-day{font-weight:700;font-size:.95rem;min-width:34px;flex-shrink:0;color:var(--text-secondary)}
.drc-cardio{font-size:.82rem;color:var(--muted);flex:1;line-height:1.4}
.drc-burn{font-family:'Sora',sans-serif;font-size:.95rem;color:var(--orange);letter-spacing:.5px;flex-shrink:0}
.drc-chevron{color:var(--muted);font-size:.65rem;transition:transform .2s;flex-shrink:0;margin-left:2px}
.drc-chevron.open{transform:rotate(180deg);color:var(--accent)}
.drc-edit-body{
  padding:14px 16px;
  border-top:1px solid rgba(8,220,224,.12);
  background:rgba(8,220,224,.02);
  animation:fadeUp .18s ease both;
}
.drc-edit-body .field{margin-bottom:10px}
.drc-edit-body .field:last-child{margin-bottom:0}
.drc-edit-live{
  display:flex;align-items:center;gap:10px;
  margin-top:10px;padding:10px 13px;
  background:rgba(255,107,53,.07);border:1px solid rgba(255,107,53,.18);
  border-radius:var(--radius-sm);font-size:.79rem;color:var(--text);line-height:1.5;
}
.drc-edit-live .burn-num{
  font-family:'Sora',sans-serif;font-size:1.25rem;
  color:var(--orange);letter-spacing:.5px;white-space:nowrap;
}
.drc-row{
  display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:6px;
  padding:10px 14px 12px;border-top:1px solid var(--border);
}
.drc-cell{text-align:center;padding:9px 4px;background:var(--s2);border-radius:8px}
.drc-cell-lbl{font-size:.58rem;text-transform:uppercase;letter-spacing:.5px;color:var(--muted);margin-bottom:3px}
.drc-cell-val{font-family:'Sora',sans-serif;font-size:1.1rem;letter-spacing:.5px}

/* ── Weekly totals bar ── */
.weekly-total-bar{
  background:var(--s2);border:1px solid var(--border);
  border-radius:var(--radius-sm);padding:14px;margin-bottom:14px;
}
.wtb-row{display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--border)}
.wtb-row:last-child{border-bottom:none;padding-bottom:0}
.wtb-label{font-size:.8rem;color:var(--muted)}
.wtb-val{font-family:'Sora',sans-serif;font-size:1.1rem;letter-spacing:.5px}

/* ── Cardio summary pill ── */
.csumm{
  background:rgba(8,220,224,.03);border:1px solid rgba(8,220,224,.12);
  border-radius:var(--radius-sm);padding:14px;margin-bottom:16px;
  display:flex;gap:12px;align-items:flex-start;
}
.cs-icon{font-size:1.6rem;line-height:1;flex-shrink:0}
.cs-title{font-weight:700;font-size:.9rem;margin-bottom:4px}
.cs-body{color:var(--muted);font-size:.8rem;line-height:1.55}
.cs-body strong{color:var(--text)}

/* ── Timeline ── */
.goal-banner{
  background:rgba(181,123,255,.07);border:1px solid rgba(181,123,255,.2);
  border-radius:var(--radius-sm);padding:16px;margin-bottom:18px;
  display:flex;gap:14px;align-items:center;
}
.gb-icon{font-size:2rem}
.gb-title{font-weight:700;font-size:.95rem;margin-bottom:3px}
.gb-sub{color:var(--muted);font-size:.79rem;line-height:1.5}
.tl-toggle{display:flex;gap:7px;margin-bottom:14px}
.tl-toggle span{font-size:.75rem;color:var(--muted);display:flex;align-items:center}
.tl-tbtn{
  flex:1;min-height:42px;
  padding:9px 12px;border-radius:10px;
  border:1.5px solid var(--border);background:var(--s2);
  color:var(--muted);cursor:pointer;
  font-family:inherit;font-size:.82rem;font-weight:600;
  transition:all .15s;text-align:center;
  -webkit-tap-highlight-color:transparent;
}
.tl-tbtn.active{border-color:var(--accent);color:var(--accent);background:var(--accent-dim)}
.tl-tbtn:active{transform:scale(.97)}
.tl-grid{display:flex;flex-direction:column;gap:10px;margin-bottom:18px}
.tl-card{
  background:var(--surface);border:1px solid var(--border);
  border-radius:var(--radius-sm);padding:16px;
  display:flex;align-items:center;gap:16px;
  position:relative;overflow:hidden;
}
.tl-card::before{content:'';position:absolute;left:0;top:0;bottom:0;width:4px;border-radius:2px}
.tl-card.half::before{background:var(--green)}
.tl-card.one::before{background:var(--yellow)}
.tl-card.two::before{background:var(--red)}
.tlc-left{flex:1}
.tlc-pace{font-size:.65rem;letter-spacing:1.5px;text-transform:uppercase;color:var(--muted);margin-bottom:3px}
.tlc-time{font-family:'Sora',sans-serif;font-size:1.6rem;line-height:1;margin-bottom:2px}
.tlc-sub{font-size:.74rem;color:var(--muted)}
.tlc-right{text-align:right}
.tlc-rate{font-family:'Sora',sans-serif;font-size:1.35rem;color:var(--orange)}
.tlc-rate-lbl{font-size:.65rem;color:var(--muted);margin-top:1px}

/* Milestone cards */
.ms-card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-sm);padding:14px;margin-bottom:10px}
.ms-card-header{font-weight:700;font-size:.93rem;margin-bottom:12px;color:var(--accent)}
.ms-row-inline{display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-bottom:1px solid var(--border)}
.ms-row-inline:last-child{border-bottom:none;padding-bottom:0}
.ms-pace{font-size:.79rem;color:var(--muted)}
.ms-loss{font-family:'Sora',sans-serif;font-size:1.15rem;letter-spacing:.5px}
.ms-wt{font-size:.72rem;color:var(--muted);margin-top:1px}
.ms-card-goal{border-color:rgba(8,220,224,.3);background:rgba(8,220,224,.025)}
.ms-card-goal .ms-card-header{color:var(--accent)}
.prog-bar-bg{height:5px;border-radius:3px;background:var(--border);overflow:hidden;margin-top:3px}
.prog-bar-fill{height:100%;border-radius:3px;transition:width .5s}

/* ── Goal weight step ── */
.weight-compare{display:grid;grid-template-columns:1fr auto 1fr;gap:10px;align-items:center;margin-bottom:16px}
.wc-box{background:var(--s2);border:1.5px solid var(--border);border-radius:var(--radius-sm);padding:16px;text-align:center;transition:border-color .2s}
.wc-lbl{font-size:.65rem;letter-spacing:1px;text-transform:uppercase;color:var(--muted);margin-bottom:4px}
.wc-val{font-family:'Sora',sans-serif;font-size:2.1rem;color:var(--accent)}
.wc-unit{font-size:.72rem;color:var(--muted)}
.wc-arrow{color:var(--orange);font-size:1.3rem;text-align:center}
.lose-badge{
  background:rgba(255,107,53,.08);border:1px solid rgba(255,107,53,.22);
  border-radius:var(--radius-sm);padding:14px 16px;text-align:center;margin-bottom:16px;
}
.lb-lbl{font-size:.68rem;letter-spacing:1px;text-transform:uppercase;color:var(--orange);margin-bottom:4px}
.lb-val{font-family:'Sora',sans-serif;font-size:2.4rem;color:var(--orange)}
.lb-unit{font-size:.76rem;color:var(--muted)}

/* ── Color utility classes ── */
.c-acc{color:var(--accent)}.c-grn{color:var(--green)}.c-yel{color:var(--yellow)}
.c-red{color:var(--red)}.c-org{color:var(--orange)}.c-mut{color:var(--muted)}

/* ── Misc ── */
.footnote{font-size:.68rem;color:var(--muted);margin-top:12px;line-height:1.6;padding:0 2px}
.error-box{
  background:rgba(255,79,107,.07);border:1px solid rgba(255,79,107,.22);
  border-radius:var(--radius-sm);padding:12px 14px;font-size:.83rem;color:var(--red);margin-bottom:12px;
}
.warn-box{
  background:rgba(255,204,68,.07);border:1px solid rgba(255,204,68,.22);
  border-radius:var(--radius-sm);padding:12px 14px;font-size:.83rem;color:var(--yellow);margin-bottom:12px;line-height:1.55;
}

/* ── Ideal Body Weight Card ── */
.ibw-card{
  background:var(--surface);border:1px solid var(--border);
  border-radius:var(--radius-lg);padding:0;margin-bottom:20px;
  box-shadow:var(--shadow-sm);overflow:hidden;
}
.ibw-toggle{
  display:flex;align-items:center;justify-content:space-between;gap:12px;
  padding:16px 18px;cursor:pointer;-webkit-tap-highlight-color:transparent;
  transition:background .15s;
}
.ibw-toggle:active{background:rgba(255,255,255,.02)}
.ibw-toggle-left{display:flex;align-items:center;gap:10px;flex:1;min-width:0}
.ibw-toggle-title{font-family:'Sora',sans-serif;font-size:1.2rem;letter-spacing:2px;color:var(--accent);white-space:nowrap}
.ibw-toggle-summary{font-size:.76rem;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ibw-toggle-chevron{color:var(--muted);font-size:.8rem;transition:transform .2s;flex-shrink:0}
.ibw-toggle-chevron.open{transform:rotate(180deg);color:var(--accent)}
.ibw-body{padding:0 18px 20px;animation:fadeUp .18s ease both}
.ibw-title{font-family:'Sora',sans-serif;font-size:1.3rem;letter-spacing:2px;color:var(--accent);margin-bottom:3px}
.ibw-subtitle{font-size:.76rem;color:var(--muted);margin-bottom:16px;line-height:1.5}
.ibw-range-row{display:flex;justify-content:space-between;align-items:flex-start;gap:14px;margin-bottom:18px;flex-wrap:wrap}
.ibw-range-val{flex:1}
.ibw-range-num{font-family:'Sora',sans-serif;font-size:2.3rem;color:var(--green);line-height:1}
.ibw-range-lbl{font-size:.73rem;color:var(--muted);margin-top:4px}
.ibw-bmi-badge{text-align:center;padding:12px 16px;border-radius:10px;background:var(--s2);border:1px solid var(--border);min-width:90px}
.ibw-bmi-num{font-family:'Sora',sans-serif;font-size:1.9rem;line-height:1}
.ibw-bmi-lbl{font-size:.65rem;color:var(--muted);margin-top:2px;white-space:nowrap}
.ibw-bar-wrap{margin-bottom:18px}
.ibw-bar-labels{display:flex;justify-content:space-between;font-size:.62rem;color:var(--muted);margin-bottom:5px;letter-spacing:.3px}
.ibw-bar-track{
  position:relative;height:12px;border-radius:6px;
  background:linear-gradient(90deg,var(--yellow) 0%,var(--green) 35%,var(--green) 65%,var(--orange) 100%);
  opacity:.65;margin-bottom:5px;
}
.ibw-bar-healthy{
  position:absolute;left:33%;right:33%;top:0;bottom:0;
  background:rgba(79,255,176,.25);border-radius:6px;
  border-left:2px solid var(--green);border-right:2px solid var(--green);
}
.ibw-bar-marker{
  position:absolute;top:-5px;width:4px;height:22px;
  border-radius:2px;transform:translateX(-50%);transition:left .3s;
}
.ibw-marker-label{
  position:absolute;bottom:24px;left:50%;transform:translateX(-50%);
  background:var(--surface);border:1px solid var(--border);
  border-radius:5px;padding:2px 6px;
  font-size:.65rem;font-weight:700;color:var(--text);white-space:nowrap;
}
.ibw-bar-range-ticks{display:flex;justify-content:space-between;font-size:.65rem;color:var(--green);padding:0 33%}
.ibw-formulas{border:1px solid var(--border);border-radius:10px;overflow:hidden;margin-bottom:14px}
.ibw-formula-row{
  display:grid;grid-template-columns:1fr auto auto;gap:8px;
  align-items:center;padding:10px 13px;border-bottom:1px solid var(--border);font-size:.8rem;
}
.ibw-formula-row:last-child{border-bottom:none}
.ibw-formula-name{font-weight:600;color:var(--text);display:flex;align-items:center;gap:6px}
.ibw-formula-val{font-family:'Sora',sans-serif;font-size:1rem;color:var(--accent);text-align:right;white-space:nowrap}
.ibw-formula-note{font-size:.65rem;color:var(--muted);text-align:right}
.info-icon{
  display:inline-flex;align-items:center;justify-content:center;
  width:18px;height:18px;border-radius:50%;
  background:rgba(117,117,160,.18);border:1px solid rgba(117,117,160,.3);
  color:var(--muted);font-size:.65rem;font-weight:700;
  cursor:pointer;flex-shrink:0;transition:all .15s;
  font-family:'DM Sans',sans-serif;line-height:1;
  -webkit-tap-highlight-color:transparent;user-select:none;
}
.info-icon:hover,.info-icon.active{background:rgba(8,220,224,.16);border-color:var(--accent);color:var(--accent)}
.info-panel{
  padding:13px 14px;
  background:rgba(8,220,224,.04);border-top:1px solid rgba(8,220,224,.1);
  font-size:.8rem;color:var(--muted);line-height:1.6;
  animation:fadeUp .18s ease both;
}
.info-panel strong{display:block;font-size:.85rem;color:var(--accent);margin-bottom:5px;font-weight:600}
.ibw-goal-note{border-radius:var(--radius-sm);padding:10px 13px;font-size:.8rem;line-height:1.5;margin-bottom:12px}
.ibw-goal-good{background:rgba(79,255,176,.07);border:1px solid rgba(79,255,176,.22);color:var(--green)}
.ibw-goal-check{background:rgba(255,204,68,.06);border:1px solid rgba(255,204,68,.22);color:var(--yellow)}
.ibw-footnote{font-size:.67rem;color:var(--muted);line-height:1.5;font-style:italic}
@media(max-width:400px){
  .ibw-formula-row{grid-template-columns:1fr auto;gap:4px}
  .ibw-formula-note{display:none}
}

/* ── Chart carousel ── */
.carousel-nav-row{
  display:flex;align-items:center;justify-content:center;
  gap:14px;margin-bottom:14px;
}
.carousel-arrow-btn{
  width:38px;height:38px;border-radius:50%;
  border:2px solid var(--border);background:var(--s2);
  color:var(--text-secondary);cursor:pointer;font-size:1.5rem;line-height:1;
  display:flex;align-items:center;justify-content:center;
  transition:all .15s;-webkit-tap-highlight-color:transparent;flex-shrink:0;
}
.carousel-arrow-btn:hover:not(:disabled){border-color:var(--accent);color:var(--accent);background:var(--accent-dim)}
.carousel-arrow-btn:disabled{opacity:.2;cursor:not-allowed}
.carousel-dots{display:flex;gap:9px;align-items:center;justify-content:center}
.carousel-dot{
  width:10px;height:10px;border-radius:50%;border:none;cursor:pointer;
  opacity:.4;transition:all .25s;padding:0;-webkit-tap-highlight-color:transparent;
}
.carousel-dot.active{opacity:1;transform:scale(1.4)}
.carousel-scenario-tag{
  border-radius:var(--radius-sm);padding:10px 14px;margin-bottom:12px;
  display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;
}
.cst-label{font-family:'Sora',sans-serif;font-size:1.1rem;letter-spacing:1.5px;font-weight:700}
.cst-sub{font-size:.74rem;color:var(--muted)}
.chart-arrow-overlay{
  position:absolute;top:50%;transform:translateY(-50%);
  left:0;right:0;display:flex;justify-content:space-between;
  pointer-events:none;z-index:5;padding:0 4px;
}
.chart-overlay-arrow{
  pointer-events:all;width:36px;height:54px;border-radius:8px;
  border:1.5px solid rgba(255,255,255,.12);
  background:rgba(13,13,24,.75);color:rgba(255,255,255,.7);
  font-size:1.8rem;line-height:1;cursor:pointer;
  display:flex;align-items:center;justify-content:center;
  transition:all .15s;backdrop-filter:blur(6px);
  -webkit-tap-highlight-color:transparent;
}
.chart-overlay-arrow:hover:not(:disabled){background:rgba(8,220,224,.14);border-color:var(--accent);color:var(--accent)}
.chart-overlay-arrow:disabled{opacity:.1;cursor:not-allowed;pointer-events:none}
.pace-selector{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.pace-sel-btn{
  display:flex;align-items:center;gap:7px;
  padding:9px 15px;border-radius:22px;border:1.5px solid var(--border);
  background:var(--s2);cursor:pointer;font-family:inherit;
  font-size:.83rem;font-weight:600;transition:all .18s;
  -webkit-tap-highlight-color:transparent;
}
.pace-sel-btn:active{transform:scale(.96)}
.psb-swatch{width:10px;height:10px;border-radius:50%;flex-shrink:0}
.pace-sel-clear{
  padding:8px 13px;border-radius:22px;border:1px solid var(--border);
  background:transparent;color:var(--muted);cursor:pointer;
  font-family:inherit;font-size:.76rem;transition:all .15s;
}
.pace-sel-clear:hover{border-color:var(--muted-light);color:var(--text)}

/* ── Goal time blocks ── */
.gtt-block{border:1px solid var(--border);border-radius:var(--radius-sm);overflow:hidden;margin-bottom:0}
.gtt-block-header{padding:10px 14px;font-size:.72rem;letter-spacing:1.2px;text-transform:uppercase;font-weight:700}
.diet-header{background:rgba(117,117,160,.1);color:var(--muted)}
.cardio-header{background:rgba(255,107,53,.08);color:var(--orange)}
.gtt-block-row{display:flex;justify-content:space-between;align-items:center;padding:11px 14px;border-top:1px solid var(--border)}

/* ── Explainer box ── */
.explainer-box{
  background:rgba(8,220,224,.025);border:1px solid rgba(8,220,224,.1);
  border-radius:var(--radius-sm);padding:17px;margin-bottom:14px;
}
.exp-title{font-weight:700;font-size:.92rem;margin-bottom:9px;color:var(--text)}
.exp-body{font-size:.83rem;color:var(--muted);line-height:1.6;margin-bottom:10px}
.exp-body strong{color:var(--text)}
.exp-callout{
  background:rgba(255,107,53,.07);border:1px solid rgba(255,107,53,.18);
  border-radius:var(--radius-sm);padding:10px 13px;font-size:.8rem;color:var(--muted);line-height:1.5;margin-bottom:10px;
}
.exp-callout strong{color:var(--text)}
.exp-rows{display:flex;flex-direction:column;gap:8px;margin-bottom:10px}
.exp-row{display:flex;gap:10px;align-items:flex-start;font-size:.83rem;line-height:1.5;color:var(--muted)}
.exp-row strong{color:var(--text)}
.exp-dot{width:10px;height:10px;border-radius:50%;flex-shrink:0;margin-top:4px}
.exp-dot.c-grn{background:var(--green)}.exp-dot.c-yel{background:var(--yellow)}.exp-dot.c-red{background:var(--red)}
.exp-row-sub{color:var(--muted)}
.exp-tip{font-size:.79rem;color:var(--muted);line-height:1.5;padding-top:8px;border-top:1px solid var(--border)}
.exp-tip strong{color:var(--text)}

/* ── Chart card ── */
.chart-card{
  background:var(--surface);border:1px solid var(--border);
  border-radius:var(--radius-sm);padding:18px;margin-bottom:16px;
}
.chart-legend{display:flex;gap:14px;flex-wrap:wrap;margin-top:12px}
.chart-legend-item{display:flex;align-items:center;gap:6px;font-size:.76rem;color:var(--muted)}
.chart-legend-line{width:20px;height:3px;border-radius:2px;flex-shrink:0}

/* ── Checkpoint table ── */
.checkpoint-table{border:1px solid var(--border);border-radius:var(--radius-sm);overflow:hidden;margin-bottom:14px}
.cpt-header{
  display:grid;grid-template-columns:1fr repeat(3,1fr);
  background:var(--s2);padding:9px 14px;
  font-size:.62rem;letter-spacing:1px;text-transform:uppercase;color:var(--muted);font-weight:700;
}
.cpt-row{
  display:grid;grid-template-columns:1fr repeat(3,1fr);
  padding:10px 14px;border-top:1px solid var(--border);font-size:.83rem;
}
.cpt-row:nth-child(even){background:rgba(255,255,255,.015)}
.cpt-period{color:var(--muted-light);font-weight:600}
.cpt-val{font-family:'Sora',sans-serif;font-size:1rem;letter-spacing:.5px;text-align:center}

/* ── Quick fill ── */
.quick-fill-toggle{
  width:100%;padding:13px 15px;border-radius:10px;
  border:1.5px dashed rgba(8,220,224,.25);background:rgba(8,220,224,.025);
  color:var(--accent);cursor:pointer;font-family:inherit;
  font-size:.84rem;font-weight:600;text-align:left;
  margin-bottom:14px;transition:all .2s;
  -webkit-tap-highlight-color:transparent;
}
.quick-fill-toggle:hover{border-color:var(--accent);background:rgba(8,220,224,.05)}
.quick-fill-panel{
  background:var(--s2);border:1px solid var(--border);
  border-radius:var(--radius-sm);padding:16px;margin-bottom:16px;
}
.fill-day-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:5px;margin-top:6px}
.fill-day-btn{
  min-height:38px;border-radius:8px;border:1.5px solid var(--border);
  background:var(--s3);color:var(--muted);cursor:pointer;
  font-family:inherit;font-size:.72rem;font-weight:600;
  transition:all .15s;-webkit-tap-highlight-color:transparent;
}
.fill-day-btn.selected{border-color:var(--accent);color:var(--accent);background:var(--accent-dim)}
.fill-day-btn:active{transform:scale(.94)}
.fill-preset-btn{
  padding:6px 12px;border-radius:8px;border:1px solid var(--border);
  background:var(--s3);color:var(--muted-light);cursor:pointer;
  font-family:inherit;font-size:.76rem;transition:all .15s;
}
.fill-preset-btn:hover{border-color:var(--accent);color:var(--accent)}

/* ── Day accordion cards (step) ── */
.day-card{
  background:var(--s2);border:1.5px solid var(--border);
  border-radius:var(--radius-sm);margin-bottom:10px;overflow:hidden;
  transition:border-color .2s;
}
.day-card:hover{border-color:var(--border-light)}
.day-card-header{
  display:flex;align-items:center;gap:11px;padding:14px;
  cursor:pointer;min-height:58px;-webkit-tap-highlight-color:transparent;
  transition:background .15s;
}
.day-card-header:active{background:rgba(255,255,255,.025)}
.day-chip{
  font-family:'Sora',sans-serif;font-size:.85rem;
  letter-spacing:1px;color:var(--muted);width:36px;flex-shrink:0;
}
.day-cardio-name{flex:1;font-size:.9rem;font-weight:500;line-height:1.4}
.day-cardio-name.rest{color:var(--muted)}
.day-burn{font-family:'Sora',sans-serif;font-size:.9rem;color:var(--orange);letter-spacing:.5px;white-space:nowrap}
.day-burn.zero{color:var(--muted)}
.day-chevron{color:var(--muted);font-size:.8rem;transition:transform .2s;margin-left:4px}
.day-chevron.open{transform:rotate(180deg);color:var(--accent)}
.day-card-body{padding:0 14px 14px;border-top:1px solid var(--border)}
.day-card-body .field{margin-bottom:10px;margin-top:13px}
.day-card-body .field:last-child{margin-bottom:0}

/* ── Clear day button ── */
.clear-day-btn{
  width:100%;min-height:40px;margin-top:12px;
  border-radius:8px;border:1px solid rgba(255,79,107,.25);
  background:rgba(255,79,107,.05);color:var(--red);
  cursor:pointer;font-family:inherit;font-size:.8rem;font-weight:600;
  transition:all .15s;-webkit-tap-highlight-color:transparent;
}
.clear-day-btn:hover{background:rgba(255,79,107,.1)}

/* ── Edit bar ── */
.edit-bar{
  display:flex;gap:10px;margin-top:20px;padding-top:16px;
  border-top:1px solid var(--border);
}
.edit-bar-btn{
  flex:1;min-height:44px;border-radius:10px;border:1.5px solid var(--border);
  background:var(--s2);color:var(--muted-light);cursor:pointer;
  font-family:inherit;font-size:.84rem;font-weight:600;transition:all .15s;
}
.edit-bar-btn:hover{border-color:var(--accent);color:var(--accent)}
.edit-bar-reset{
  min-height:44px;padding:0 16px;border-radius:10px;border:1.5px solid rgba(255,79,107,.25);
  background:rgba(255,79,107,.05);color:var(--red);cursor:pointer;
  font-family:inherit;font-size:.84rem;font-weight:600;transition:all .15s;
}
.edit-bar-reset:hover{background:rgba(255,79,107,.1)}
.edit-panel{
  background:var(--s2);border:1px solid var(--border);
  border-radius:var(--radius-sm);padding:16px;margin-top:10px;
}
.edit-panel-title{font-size:.78rem;color:var(--muted);margin-bottom:12px;line-height:1.5}
.edit-panel-grid{display:flex;flex-direction:column;gap:8px}
.edit-jump-btn{
  display:flex;align-items:center;gap:12px;width:100%;
  min-height:52px;padding:12px 14px;
  border-radius:var(--radius-sm);border:1.5px solid var(--border);
  background:var(--surface);color:var(--text);cursor:pointer;
  font-family:inherit;text-align:left;transition:all .15s;
  -webkit-tap-highlight-color:transparent;
}
.edit-jump-btn:hover{border-color:var(--accent);background:var(--accent-dim)}
.edit-jump-btn:active{transform:scale(.98)}
.ejb-icon{font-size:1.4rem;flex-shrink:0}
.ejb-label{font-weight:700;font-size:.88rem;margin-bottom:2px}
.ejb-sub{font-size:.72rem;color:var(--muted)}
.ejb-arrow{margin-left:auto;color:var(--muted);font-size:.9rem;flex-shrink:0}

/* ── Nutrients Tab ── */
.nutr-goal-bar{
  background:var(--s2);border:1px solid var(--border);border-radius:var(--radius-sm);
  padding:14px 16px;margin-bottom:18px;
}
.nutr-goal-lbl{font-size:.7rem;text-transform:uppercase;letter-spacing:1px;color:var(--muted);margin-bottom:9px;font-weight:700}
.nutr-goal-btns{display:flex;gap:7px;flex-wrap:wrap;margin-bottom:9px}
.nutr-goal-btn{
  padding:8px 13px;border-radius:9px;border:1.5px solid var(--border);
  background:var(--surface);color:var(--muted);cursor:pointer;
  font-family:inherit;font-size:.79rem;font-weight:600;transition:all .15s;
  -webkit-tap-highlight-color:transparent;
}
.nutr-goal-btn:active{transform:scale(.96)}
.nutr-cals-badge{font-family:'Sora',sans-serif;font-size:1rem;letter-spacing:1px;color:var(--accent)}
.macro-bar-wrap{margin-bottom:18px}
.macro-bar{height:13px;border-radius:7px;overflow:hidden;display:flex;margin-bottom:7px}
.macro-bar-seg{height:100%;transition:width .4s ease}
.macro-bar-seg.protein{background:#ff6b9d}
.macro-bar-seg.carbs{background:#ffcc44}
.macro-bar-seg.fat{background:#4fc3f7}
.macro-bar-legend{display:flex;gap:14px;flex-wrap:wrap}
.macro-bar-legend span{font-size:.74rem;color:var(--muted);display:flex;align-items:center;gap:5px}
.macro-dot{width:9px;height:9px;border-radius:50%;flex-shrink:0}
.macro-dot.protein{background:#ff6b9d}.macro-dot.carbs{background:#ffcc44}.macro-dot.fat{background:#4fc3f7}
.macro-grid{display:grid;grid-template-columns:1fr 1fr;gap:11px;margin-bottom:16px}
.macro-card{border-radius:var(--radius-sm);padding:15px 13px;border:1px solid var(--border);background:var(--surface)}
.macro-protein{border-top:3px solid #ff6b9d}.macro-carbs{border-top:3px solid #ffcc44}
.macro-fat{border-top:3px solid #4fc3f7}.macro-fibre{border-top:3px solid var(--green)}
.mc-emoji{font-size:1.3rem;margin-bottom:5px}
.mc-name{font-size:.68rem;text-transform:uppercase;letter-spacing:1px;color:var(--muted);margin-bottom:2px}
.mc-grams{font-family:'Sora',sans-serif;font-size:2.1rem;line-height:1;color:var(--text)}
.mc-grams span{font-size:1rem;color:var(--muted);margin-left:2px}
.mc-cals{font-size:.7rem;color:var(--muted);margin-bottom:7px}
.mc-why{font-size:.72rem;color:var(--muted);line-height:1.55;border-top:1px solid var(--border);padding-top:7px;margin-top:4px}
.nutr-hydration{
  background:rgba(79,195,247,.06);border:1px solid rgba(79,195,247,.18);
  border-radius:var(--radius-sm);padding:15px;margin-bottom:18px;
  display:flex;gap:13px;align-items:flex-start;
}
.nutr-hydration-icon{font-size:1.7rem;line-height:1;flex-shrink:0}
.nutr-hydration-title{font-weight:700;font-size:.92rem;margin-bottom:4px}
.nutr-hydration-val{font-family:'Sora',sans-serif;font-size:1.15rem;letter-spacing:.5px;color:#4fc3f7;margin-bottom:3px}
.nutr-hydration-note{font-size:.75rem;color:var(--muted);line-height:1.5}
.micro-cat-label{font-size:.68rem;letter-spacing:1.5px;text-transform:uppercase;color:var(--muted);font-weight:700;margin:16px 0 7px}
.micro-row{
  background:var(--surface);border:1px solid var(--border);
  border-radius:var(--radius-sm);margin-bottom:9px;overflow:hidden;transition:border-color .15s;
}
.micro-row.micro-open{border-color:rgba(8,220,224,.28)}
.micro-header{
  display:flex;align-items:center;gap:11px;padding:13px 15px;
  cursor:pointer;-webkit-tap-highlight-color:transparent;transition:background .15s;
}
.micro-header:active{background:rgba(255,255,255,.025)}
.micro-emoji{font-size:1.35rem;flex-shrink:0;line-height:1}
.micro-name-wrap{flex:1}
.micro-name{font-weight:600;font-size:.9rem}
.micro-amount{font-size:.74rem;color:var(--orange);margin-top:2px}
.micro-chevron{color:var(--muted);font-size:.65rem;transition:transform .2s;flex-shrink:0}
.micro-chevron.open{transform:rotate(180deg);color:var(--accent)}
.micro-detail{padding:13px 15px 15px;border-top:1px solid var(--border);background:rgba(8,220,224,.02)}
.micro-why{font-size:.81rem;color:var(--muted);line-height:1.6;margin-bottom:11px}
.micro-foods-label{font-size:.7rem;text-transform:uppercase;letter-spacing:1px;color:var(--muted);font-weight:700;margin-bottom:7px}
.micro-foods{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:11px}
.micro-food-chip{
  padding:4px 11px;border-radius:20px;
  background:var(--s2);border:1px solid var(--border);
  font-size:.75rem;color:var(--text);white-space:nowrap;
}
.micro-tip{
  font-size:.77rem;color:var(--muted);line-height:1.55;
  padding:9px 11px;background:rgba(8,220,224,.04);
  border-radius:var(--radius-sm);border-left:3px solid var(--accent);
}
@media(min-width:640px){.macro-grid{grid-template-columns:repeat(4,1fr)}}

/* ── Surplus Tab ── */
.surplus-hero{
  display:flex;align-items:flex-start;gap:14px;
  background:rgba(255,107,53,.06);border:1px solid rgba(255,107,53,.18);
  border-radius:var(--radius-sm);padding:16px;margin-bottom:16px;
}
.surplus-hero-icon{font-size:2rem;line-height:1;flex-shrink:0}
.surplus-hero-title{font-family:'Sora',sans-serif;font-size:1.4rem;letter-spacing:2px;color:var(--orange);margin-bottom:3px}
.surplus-hero-sub{font-size:.81rem;color:var(--muted);line-height:1.5}
.surplus-science{
  background:var(--s2);border:1px solid var(--border);border-radius:var(--radius-sm);
  padding:13px 15px;margin-bottom:16px;
}
.ss-label{font-size:.7rem;letter-spacing:1px;text-transform:uppercase;color:var(--muted);font-weight:700;margin-bottom:7px}
.surplus-science p{font-size:.79rem;color:var(--muted);line-height:1.6}
.surplus-science strong{color:var(--text)}.surplus-science em{color:var(--accent)}
.surplus-toggle-wrap{background:var(--s2);border:1px solid var(--border);border-radius:var(--radius-sm);padding:13px 15px;margin-bottom:16px}
.surplus-toggle-lbl{font-size:.73rem;color:var(--muted);letter-spacing:.5px;display:block;margin-bottom:9px;font-weight:600}
.surplus-toggle-btns{display:flex;gap:8px;margin-bottom:8px}
.surplus-cardio-note{font-size:.79rem;color:var(--muted);line-height:1.5;padding-top:9px;border-top:1px solid var(--border)}
.surplus-cardio-note strong{color:var(--text)}
.surplus-table-wrap{overflow-x:auto;-webkit-overflow-scrolling:touch;border-radius:var(--radius-sm);border:1px solid var(--border);margin-bottom:16px}
.surplus-table{min-width:560px;display:grid}
.st-header-row{display:grid;grid-template-columns:90px repeat(7,1fr);background:var(--s2);border-bottom:1px solid var(--border)}
.st-corner{padding:10px 8px;font-size:.6rem;color:var(--muted);letter-spacing:.5px;line-height:1.4;border-right:1px solid var(--border)}
.st-col-header{padding:8px 4px;text-align:center;border-right:1px solid var(--border)}
.st-col-header:last-child{border-right:none}
.st-surplus-num{font-family:'Sora',sans-serif;font-size:1.05rem;color:var(--orange);letter-spacing:.5px}
.st-surplus-unit{font-size:.6rem;color:var(--muted);text-transform:uppercase}
.st-net-surplus{font-size:.58rem;color:var(--accent);margin-top:2px}
.st-data-row{display:grid;grid-template-columns:90px repeat(7,1fr);border-bottom:1px solid var(--border)}
.st-data-row:last-child{border-bottom:none}
.st-data-row:nth-child(even){background:rgba(255,255,255,.012)}
.st-row-label{padding:10px 8px;border-right:1px solid var(--border);display:flex;flex-direction:column;justify-content:center}
.st-lbs{font-family:'Sora',sans-serif;font-size:1.1rem;letter-spacing:.5px;color:var(--text)}
.st-fat-label{font-size:.6rem;color:var(--muted);text-transform:uppercase;letter-spacing:.5px}
.st-cell{padding:10px 4px;text-align:center;font-family:'Sora',sans-serif;font-size:.9rem;letter-spacing:.5px;border-right:1px solid var(--border);display:flex;align-items:center;justify-content:center}
.st-cell:last-child{border-right:none}
.surplus-cards{display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin-bottom:18px}
.surplus-card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-sm);padding:14px 13px}
.surplus-card-offset{border-color:rgba(79,255,176,.22);background:rgba(79,255,176,.025)}
.sc-surplus{font-family:'Sora',sans-serif;font-size:1.4rem;letter-spacing:1px;color:var(--orange);margin-bottom:7px}
.sc-surplus-unit{font-size:.75rem;color:var(--muted);letter-spacing:0;font-family:'DM Sans',sans-serif}
.sc-row{display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-bottom:1px solid var(--border)}
.sc-row:last-of-type{border-bottom:none;padding-bottom:0}
.sc-label{font-size:.73rem;color:var(--muted)}.sc-val{font-family:'Sora',sans-serif;font-size:1rem;letter-spacing:.5px}
.sc-cardio-note{font-size:.65rem;color:var(--green);margin-top:5px;text-align:center}
.sc-offset{font-size:.79rem;color:var(--green);line-height:1.4;margin-top:4px}
.surplus-takeaway{
  background:rgba(8,220,224,.04);border:1px solid rgba(8,220,224,.12);
  border-radius:var(--radius-sm);padding:15px 16px;margin-bottom:14px;
  display:flex;gap:13px;align-items:flex-start;
}
.st-icon{font-size:1.5rem;flex-shrink:0}
.st-title{font-weight:700;font-size:.9rem;margin-bottom:4px}
.st-body{font-size:.8rem;color:var(--muted);line-height:1.6}
.st-body strong{color:var(--text)}
@media(min-width:640px){
  .surplus-cards{grid-template-columns:repeat(4,1fr)}
  .st-header-row,.st-data-row{grid-template-columns:100px repeat(7,1fr)}
}

/* ── Muscle Building Tab ── */
.muscle-hero{
  display:flex;align-items:flex-start;gap:13px;
  background:rgba(79,255,176,.05);border:1px solid rgba(79,255,176,.18);
  border-radius:var(--radius-sm);padding:16px;margin-bottom:16px;
}
.muscle-hero-icon{font-size:2rem;flex-shrink:0}
.muscle-hero-title{font-family:'Sora',sans-serif;font-size:1.4rem;letter-spacing:2px;color:var(--green);margin-bottom:3px}
.muscle-hero-sub{font-size:.81rem;color:var(--muted);line-height:1.5}
.exp-grid{display:grid;grid-template-columns:1fr;gap:9px;margin-bottom:16px}
.exp-btn{
  padding:14px 15px;border-radius:var(--radius-sm);border:2px solid var(--border);
  background:var(--s2);color:var(--text);cursor:pointer;font-family:inherit;
  text-align:left;transition:all .15s;-webkit-tap-highlight-color:transparent;
}
.exp-btn.exp-active{border-color:var(--green);background:rgba(79,255,176,.05)}
.exp-label{font-weight:700;font-size:.93rem;margin-bottom:2px}
.exp-btn.exp-active .exp-label{color:var(--green)}
.exp-desc{font-size:.76rem;color:var(--muted);margin-bottom:3px}
.exp-gain{font-size:.73rem;color:var(--orange);font-weight:600}
.muscle-cal-hero{
  background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-sm);
  padding:17px;margin-bottom:16px;display:flex;gap:13px;align-items:flex-start;flex-wrap:wrap;
}
.mch-left{flex:1;min-width:140px}
.mch-lbl{font-size:.68rem;text-transform:uppercase;letter-spacing:1px;color:var(--muted);margin-bottom:4px}
.mch-cals{font-family:'Sora',sans-serif;font-size:2.9rem;color:var(--green);line-height:1}
.mch-unit{font-size:.79rem;color:var(--muted);margin-bottom:7px}
.mch-breakdown{font-size:.7rem;color:var(--muted);line-height:1.5;border-top:1px solid var(--border);padding-top:7px}
.mch-right{display:flex;gap:9px;flex-wrap:wrap}
.mch-box{background:var(--s2);border:1px solid var(--border);border-radius:10px;padding:11px 13px;min-width:100px;text-align:center}
.mch-box-lbl{font-size:.62rem;text-transform:uppercase;letter-spacing:.8px;color:var(--muted);margin-bottom:3px}
.mch-box-val{font-family:'Sora',sans-serif;font-size:1.3rem;letter-spacing:.5px;line-height:1}
.mch-box-val.muscle{color:var(--green)}.mch-box-val.fat{color:var(--orange)}
.mch-box-sub{font-size:.62rem;color:var(--muted);margin-top:2px}
.recomp-note{
  background:rgba(181,123,255,.07);border:1px solid rgba(181,123,255,.18);
  border-radius:var(--radius-sm);padding:13px 15px;font-size:.8rem;color:var(--muted);
  line-height:1.6;margin-bottom:15px;
}
.recomp-note strong{color:#b57bff}
.muscle-macro-bar{height:13px;border-radius:7px;overflow:hidden;display:flex;margin-bottom:7px}
.muscle-macro-grid{display:grid;grid-template-columns:1fr 1fr;gap:11px;margin-bottom:15px}
.muscle-macro-card{border-top-width:3px}
.supp-grid{display:grid;grid-template-columns:1fr;gap:10px;margin-bottom:15px}
.supp-card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-sm);padding:14px}
.sc2-header{display:flex;align-items:flex-start;gap:11px;margin-bottom:11px}
.sc2-emoji{font-size:1.4rem;flex-shrink:0;line-height:1}
.sc2-name{font-weight:700;font-size:.9rem}
.sc2-evidence{font-size:.69rem;color:var(--orange);margin-top:2px}
.sc2-row{display:flex;justify-content:space-between;gap:8px;padding:5px 0;border-bottom:1px solid var(--border);font-size:.77rem}
.sc2-row:last-of-type{border-bottom:none}
.sc2-lbl{color:var(--muted);flex-shrink:0}.sc2-val{color:var(--text);text-align:right}
.sc2-benefit{font-size:.74rem;color:var(--muted);line-height:1.55;margin-top:7px;padding-top:7px;border-top:1px solid var(--border)}
.muscle-table{border-radius:var(--radius-sm);overflow:hidden;border:1px solid var(--border)}
.mt-header{display:grid;grid-template-columns:140px repeat(4,1fr);background:var(--s2);border-bottom:1px solid var(--border);font-size:.65rem;text-transform:uppercase;letter-spacing:.8px;color:var(--muted)}
.mt-header>div,.mt-col,.mt-label-col{padding:10px 9px}
.mt-row{display:grid;grid-template-columns:140px repeat(4,1fr);border-bottom:1px solid var(--border);align-items:center}
.mt-row:last-child{border-bottom:none}
.mt-row-rec{background:rgba(79,255,176,.04);border-left:3px solid var(--green)}
.mt-label-col{font-size:.8rem;padding:10px 9px;border-right:1px solid var(--border)}
.mt-col{padding:10px 7px;text-align:center;border-right:1px solid var(--border)}
.mt-col:last-child{border-right:none}
.mt-surplus{font-family:'Sora',sans-serif;font-size:1.05rem;color:var(--orange)}
.mt-unit{font-size:.7rem;color:var(--muted)}
.mt-rec-badge{
  display:inline-block;margin-left:5px;
  background:rgba(79,255,176,.13);border:1px solid rgba(79,255,176,.28);
  color:var(--green);border-radius:4px;padding:1px 6px;
  font-size:.6rem;letter-spacing:.5px;text-transform:uppercase;
}
.muscle-timeline{display:grid;grid-template-columns:repeat(3,1fr);gap:11px;margin-bottom:15px}
.mtl-card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-sm);padding:14px 12px}
.mtl-period{font-family:'Sora',sans-serif;font-size:1.1rem;letter-spacing:1px;color:var(--accent);margin-bottom:11px}
.mtl-row{display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-bottom:1px solid var(--border);font-size:.75rem}
.mtl-row:last-of-type{border-bottom:none}
.mtl-lbl{color:var(--muted);font-size:.72rem}
.mtl-val{font-family:'Sora',sans-serif;font-size:.95rem;letter-spacing:.5px}
.mtl-val.muscle{color:var(--green)}.mtl-val.fat{color:var(--orange)}
.mtl-bar{height:8px;border-radius:4px;overflow:hidden;display:flex;margin-top:9px}
.mtl-muscle-bar{background:var(--green);height:100%}.mtl-fat-bar{background:var(--orange);height:100%}
.mtl-bar-legend{display:flex;justify-content:space-between;font-size:.62rem;margin-top:4px}
@media(min-width:480px){.exp-grid{grid-template-columns:repeat(3,1fr)}.supp-grid{grid-template-columns:repeat(2,1fr)}}
@media(min-width:640px){.muscle-macro-grid{grid-template-columns:repeat(4,1fr)}.mt-header,.mt-row{grid-template-columns:160px repeat(4,1fr)}}

/* ── Strength Tab ── */
.str-hero{
  display:flex;align-items:flex-start;gap:13px;
  background:rgba(79,195,247,.06);border:1px solid rgba(79,195,247,.18);
  border-radius:var(--radius-sm);padding:16px;margin-bottom:16px;
}
.str-hero-icon{font-size:2rem;flex-shrink:0}
.str-hero-title{font-family:'Sora',sans-serif;font-size:1.4rem;letter-spacing:2px;color:#4fc3f7;margin-bottom:3px}
.str-hero-sub{font-size:.81rem;color:var(--muted);line-height:1.5}
.str-hero-sub strong{color:var(--text)}
.str-stat-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin-bottom:16px}
.str-stat{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-sm);padding:15px 13px;text-align:center}
.str-stat-val{font-family:'Sora',sans-serif;font-size:1.6rem;letter-spacing:.5px;line-height:1;margin-bottom:3px}
.str-stat-lbl{font-size:.68rem;text-transform:uppercase;letter-spacing:.8px;color:var(--muted)}
.str-compound-note{
  background:rgba(255,204,68,.05);border:1px solid rgba(255,204,68,.18);
  border-radius:var(--radius-sm);padding:12px 15px;font-size:.8rem;color:var(--muted);line-height:1.6;margin-bottom:15px;
}
.str-compound-note strong{color:var(--yellow)}.str-compound-note em{color:var(--text)}
.str-proj-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin-bottom:15px}
.str-proj-card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-sm);padding:14px 13px}
.str-proj-period{font-family:'Sora',sans-serif;font-size:1.05rem;letter-spacing:1px;color:var(--accent);margin-bottom:9px}
.str-proj-row{display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-bottom:1px solid var(--border);font-size:.77rem}
.str-proj-row:last-child{border-bottom:none;padding-bottom:0}
.str-proj-lbl{color:var(--muted)}.str-proj-val{font-family:'Sora',sans-serif;font-size:.95rem;letter-spacing:.5px}
@media(min-width:640px){.str-stat-grid{grid-template-columns:repeat(4,1fr)}.str-proj-grid{grid-template-columns:repeat(4,1fr)}}

/* ── Welcome & step UX ── */
.step-name-row{display:flex;justify-content:center;gap:4px;margin-bottom:8px}
.step-name-item{font-size:.65rem;letter-spacing:.5px;text-transform:uppercase;color:var(--muted);flex:1;text-align:center;transition:color .3s;max-width:80px}
.step-name-item.active{color:var(--accent);font-weight:700}
.step-name-item.done{color:var(--accent);opacity:.45}
.field-tip{font-size:.78rem;color:var(--muted);line-height:1.55;padding:11px 14px;margin-top:10px;background:rgba(112,112,160,.08);border-radius:var(--radius-sm);border-left:3px solid rgba(112,112,160,.3)}
.privacy-note{font-size:.7rem;color:var(--muted);text-align:center;margin-top:16px;padding-top:14px;border-top:1px solid var(--border);line-height:1.5}

/* ── Results summary ── */
.results-summary-banner{
  background:linear-gradient(135deg,rgba(8,220,224,.07),rgba(255,107,53,.04));
  border:1px solid rgba(8,220,224,.18);border-radius:var(--radius-lg);
  padding:18px;margin-bottom:20px;
  display:grid;grid-template-columns:1fr 1fr;gap:10px;
}
.rsb-stat{text-align:center;padding:8px}
.rsb-val{font-family:'Sora',sans-serif;font-size:1.85rem;line-height:1;margin-bottom:3px}
.rsb-lbl{font-size:.63rem;text-transform:uppercase;letter-spacing:1px;color:var(--muted)}
.rsb-divider{border:none;border-top:1px solid var(--border);margin:0;grid-column:1/-1}

/* ── Responsive desktop ── */
@media(min-width:480px){
  /* NOTE: the bottom nav is position:fixed at all widths (Tailwind-rebuilt,
     Session 30), so we keep the .app padding-bottom from the base rule here —
     do NOT zero it, or the fixed nav covers the last controls on wider screens. */
  .dgrid{grid-template-columns:repeat(4,1fr)}
}
@media(min-width:640px){
  .card{padding:24px 22px}
  .dgrid{grid-template-columns:repeat(4,1fr)}
  .tl-grid{display:grid;grid-template-columns:repeat(3,1fr)}
  .hero-val{font-size:4rem}
}

/* ── Daily Dashboard ── */
.dash{animation:fadeUp .2s ease both}
.dash-date{font-size:.72rem;letter-spacing:1.5px;text-transform:uppercase;color:var(--muted);text-align:center;margin-bottom:6px}
.dash-greeting{font-family:'Sora',sans-serif;font-size:2rem;letter-spacing:3px;color:var(--text);text-align:center;margin-bottom:18px}
.dash-streak{
  display:flex;align-items:center;justify-content:center;gap:8px;
  background:linear-gradient(135deg,rgba(8,220,224,.08),rgba(255,107,53,.04));
  border:1px solid rgba(8,220,224,.2);border-radius:var(--radius-lg);
  padding:14px;margin-bottom:18px;text-align:center;
}
.dash-streak-num{font-family:'Sora',sans-serif;font-size:2.4rem;color:var(--accent);line-height:1}
.dash-streak-lbl{font-size:.78rem;color:var(--muted);line-height:1.3}
.dash-ring-wrap{display:flex;justify-content:center;margin-bottom:18px}
.dash-cta-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px}
.dash-cta{
  background:var(--surface);border:1.5px solid var(--border);border-radius:var(--radius-sm);
  padding:16px 14px;cursor:pointer;text-align:center;transition:all .15s;
  -webkit-tap-highlight-color:transparent;
}
.dash-cta:active{transform:scale(.97);border-color:var(--accent)}
.dash-cta-icon{font-size:1.6rem;margin-bottom:6px}
.dash-cta-val{font-family:'Sora',sans-serif;font-size:1.5rem;color:var(--accent);letter-spacing:.5px}
.dash-cta-lbl{font-size:.7rem;color:var(--muted);letter-spacing:.5px;text-transform:uppercase}
.dash-log-row{
  display:flex;align-items:center;gap:10px;
  background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-sm);
  padding:14px;margin-bottom:8px;
}
.dash-log-icon{font-size:1.3rem;flex-shrink:0}
.dash-log-info{flex:1}
.dash-log-title{font-weight:600;font-size:.85rem;margin-bottom:2px}
.dash-log-sub{font-size:.73rem;color:var(--muted)}
.dash-log-input{
  width:72px;min-height:38px;padding:6px 10px;border-radius:8px;
  border:1.5px solid var(--border);background:var(--s2);color:var(--text);
  font-family:'Sora',sans-serif;font-size:1.1rem;text-align:center;
  outline:none;letter-spacing:.5px;
}
.dash-log-input:focus{border-color:var(--accent)}
.dash-log-unit{font-size:.72rem;color:var(--muted);flex-shrink:0}
.dash-today-workout{
  background:rgba(79,195,247,.06);border:1px solid rgba(79,195,247,.18);
  border-radius:var(--radius-sm);padding:14px;margin-bottom:14px;
}
.dash-nav{display:flex;gap:8px;margin-top:18px}
.dash-nav-btn{
  flex:1;min-height:44px;border-radius:10px;border:1.5px solid var(--border);
  background:var(--s2);color:var(--muted-light);cursor:pointer;
  font-family:inherit;font-size:.82rem;font-weight:600;transition:all .15s;
  display:flex;align-items:center;justify-content:center;gap:6px;
}
.dash-nav-btn:hover{border-color:var(--accent);color:var(--accent)}
.share-card{
  background:linear-gradient(135deg,var(--surface),var(--s2));
  border:1.5px solid rgba(8,220,224,.2);border-radius:var(--radius-lg);
  padding:24px 20px;text-align:center;margin-top:16px;
}
.share-card-name{font-family:'Sora',sans-serif;font-size:1.8rem;letter-spacing:3px;color:var(--accent);margin-bottom:4px}
.share-card-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:14px 0}
.share-stat{padding:10px 6px;background:var(--s2);border-radius:8px}
.share-stat-val{font-family:'Sora',sans-serif;font-size:1.4rem;color:var(--accent)}
.share-stat-lbl{font-size:.62rem;color:var(--muted);text-transform:uppercase;letter-spacing:.5px}
.share-brand{font-size:.65rem;color:var(--muted);margin-top:10px;letter-spacing:1px}

@keyframes fadeUp{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
@keyframes pulse{0%,100%{opacity:.6}50%{opacity:1}}

/* Page-level transition — replays whenever its keyed wrapper remounts on navigation. */
.page-transition{animation:fadeUp .28s ease both}
@media (prefers-reduced-motion:reduce){
  .page-transition,.dash{animation:none}
  html{scroll-behavior:auto}
}

/* ── Client Profiles ── */
.profiles-btn{
  display:inline-flex;align-items:center;gap:6px;
  padding:8px 16px;border-radius:20px;
  border:1.5px solid var(--border);background:var(--s2);
  color:var(--muted-light);cursor:pointer;font-family:inherit;
  font-size:.78rem;font-weight:600;transition:all .15s;
  -webkit-tap-highlight-color:transparent;margin-top:10px;
}
.profiles-btn:hover{border-color:var(--accent);color:var(--accent)}
.profiles-btn .pbtn-count{
  background:var(--accent-fill);color:#0b0b12;
  font-size:.65rem;font-weight:700;padding:2px 7px;
  border-radius:10px;min-width:20px;text-align:center;
}
.profiles-panel{
  background:var(--surface);border:1px solid var(--border);
  border-radius:var(--radius-lg);padding:18px;margin-bottom:20px;
  animation:fadeUp .18s ease both;
}
.profiles-panel-title{
  font-family:'Sora',sans-serif;font-size:1.2rem;
  letter-spacing:2px;color:var(--accent);margin-bottom:4px;
}
.profiles-panel-sub{font-size:.78rem;color:var(--muted);margin-bottom:14px;line-height:1.5}
.profile-card{
  display:flex;align-items:center;gap:12px;
  padding:14px;border-radius:var(--radius-sm);
  border:1.5px solid var(--border);background:var(--s2);
  margin-bottom:8px;cursor:pointer;transition:all .15s;
  -webkit-tap-highlight-color:transparent;
}
.profile-card:hover{border-color:var(--accent);background:rgba(8,220,224,.03)}
.profile-card.pc-active{border-color:var(--accent);background:rgba(8,220,224,.06)}
.pc-avatar{
  width:40px;height:40px;border-radius:50%;
  background:var(--s3);border:1px solid var(--border);
  display:flex;align-items:center;justify-content:center;
  font-size:1.1rem;flex-shrink:0;
}
.pc-info{flex:1;min-width:0}
.pc-name{font-weight:700;font-size:.9rem;margin-bottom:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pc-meta{font-size:.72rem;color:var(--muted);line-height:1.4}
.pc-actions{display:flex;gap:6px;flex-shrink:0}
.pc-load-btn{
  padding:6px 14px;border-radius:8px;border:1.5px solid var(--accent);
  background:var(--accent-dim);color:var(--accent);cursor:pointer;
  font-family:inherit;font-size:.75rem;font-weight:600;transition:all .15s;
}
.pc-load-btn:hover{background:rgba(8,220,224,.15)}
.pc-del-btn{
  padding:6px 10px;border-radius:8px;border:1.5px solid rgba(255,79,107,.25);
  background:rgba(255,79,107,.05);color:var(--red);cursor:pointer;
  font-family:inherit;font-size:.75rem;transition:all .15s;
}
.pc-del-btn:hover{background:rgba(255,79,107,.1)}
.save-indicator{
  display:inline-flex;align-items:center;gap:5px;
  font-size:.68rem;color:var(--green);letter-spacing:.5px;
  animation:fadeUp .3s ease both;
}
.profiles-empty{
  text-align:center;padding:20px;color:var(--muted);font-size:.84rem;line-height:1.6;
}
.save-bar{
  display:flex;gap:8px;margin-bottom:14px;
}
.save-bar-btn{
  flex:1;min-height:44px;border-radius:10px;
  border:1.5px solid var(--accent);background:var(--accent-dim);
  color:var(--accent);cursor:pointer;font-family:inherit;
  font-size:.84rem;font-weight:600;transition:all .15s;
  display:flex;align-items:center;justify-content:center;gap:6px;
}
.save-bar-btn:hover{background:rgba(8,220,224,.15)}
.save-bar-btn:active{transform:scale(.97)}
.save-bar-new{
  flex:0 0 auto;min-height:44px;padding:0 16px;border-radius:10px;
  border:1.5px solid var(--border);background:var(--s2);
  color:var(--muted-light);cursor:pointer;font-family:inherit;
  font-size:.84rem;font-weight:600;transition:all .15s;
}
.save-bar-new:hover{border-color:var(--accent);color:var(--accent)}

/* ── Folders ── */
.folder-section{
  margin-bottom:16px;border:1.5px solid var(--border);
  border-radius:var(--radius-sm);overflow:hidden;
  transition:border-color .2s;
}
.folder-section.drag-over{border-color:var(--accent);box-shadow:0 0 12px rgba(8,220,224,.15)}
.folder-header{
  display:flex;align-items:center;gap:10px;
  padding:14px 16px;background:var(--s2);
  cursor:pointer;-webkit-tap-highlight-color:transparent;
  transition:background .15s;
}
.folder-header:active{background:rgba(255,255,255,.03)}
.folder-icon{font-size:1.2rem;flex-shrink:0}
.folder-name{flex:1;font-weight:700;font-size:.9rem}
.folder-count{
  font-size:.7rem;color:var(--muted);background:var(--s3);
  padding:2px 8px;border-radius:10px;
}
.folder-chevron{color:var(--muted);font-size:.7rem;transition:transform .2s;flex-shrink:0}
.folder-chevron.open{transform:rotate(180deg);color:var(--accent)}
.folder-body{border-top:1px solid var(--border);padding:8px}
.folder-actions{
  display:flex;gap:6px;padding:8px 10px 4px;justify-content:flex-end;
}
.folder-act-btn{
  padding:4px 10px;border-radius:6px;border:1px solid var(--border);
  background:transparent;color:var(--muted);cursor:pointer;
  font-family:inherit;font-size:.7rem;transition:all .15s;
}
.folder-act-btn:hover{border-color:var(--accent);color:var(--accent)}
.folder-act-btn.del:hover{border-color:var(--red);color:var(--red)}
.folder-bar{
  display:flex;gap:8px;margin-bottom:14px;
}
.folder-new-btn{
  flex:1;min-height:40px;border-radius:10px;
  border:1.5px dashed rgba(8,220,224,.25);background:rgba(8,220,224,.025);
  color:var(--accent);cursor:pointer;font-family:inherit;
  font-size:.8rem;font-weight:600;transition:all .15s;
}
.folder-new-btn:hover{border-color:var(--accent);background:rgba(8,220,224,.06)}
.folder-input{
  width:100%;padding:10px 14px;border-radius:8px;
  border:1.5px solid var(--accent);background:var(--s2);
  color:var(--text);font-family:inherit;font-size:.88rem;
  outline:none;
}
.drag-ghost{opacity:.5}
.prof-card{cursor:grab}
.prof-card:active{cursor:grabbing}
.drop-zone-hint{
  padding:16px;text-align:center;color:var(--muted);
  font-size:.78rem;border:1.5px dashed var(--border);
  border-radius:8px;margin:4px;
}

/* ── Trainer Dashboard ── */
.dash-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:16px}
.dash-stat{background:var(--s2);border:1px solid var(--border);border-radius:var(--radius-sm);padding:14px 10px;text-align:center}
.dash-stat-val{font-family:'Sora',sans-serif;font-size:1.8rem;line-height:1;margin-bottom:2px}
.dash-stat-lbl{font-size:.62rem;text-transform:uppercase;letter-spacing:.8px;color:var(--muted)}

/* ── Daily Check-In ── */
.checkin-card{
  background:linear-gradient(135deg,rgba(79,255,176,.05),rgba(8,220,224,.03));
  border:1.5px solid rgba(79,255,176,.2);border-radius:var(--radius-lg);
  padding:18px;margin-bottom:16px;
}
.checkin-title{font-family:'Sora',sans-serif;font-size:1.2rem;letter-spacing:2px;color:var(--green);margin-bottom:4px}
.checkin-sub{font-size:.78rem;color:var(--muted);margin-bottom:14px;line-height:1.5}
.checkin-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px}
.checkin-field label{display:block;font-size:.68rem;text-transform:uppercase;letter-spacing:.5px;color:var(--muted);margin-bottom:5px;font-weight:600}
.checkin-field input,.checkin-field select{
  width:100%;padding:10px 12px;border-radius:8px;border:1.5px solid var(--border);
  background:var(--s2);color:var(--text);font-family:inherit;font-size:.88rem;outline:none;
}
.checkin-mood{display:flex;gap:6px}
.mood-btn{
  flex:1;padding:10px 4px;border-radius:8px;border:1.5px solid var(--border);
  background:var(--s2);color:var(--text);cursor:pointer;font-size:1.2rem;text-align:center;
  transition:all .15s;-webkit-tap-highlight-color:transparent;
}
.mood-btn.active{border-color:var(--accent);background:var(--accent-dim)}
.checkin-submit{
  width:100%;min-height:44px;border-radius:10px;border:none;
  background:var(--green);color:#0b0b12;cursor:pointer;
  font-family:'Sora',sans-serif;font-size:1.1rem;letter-spacing:2px;
  transition:all .15s;
}
.checkin-submit:active{transform:scale(.97)}
.checkin-submit:disabled{background:var(--s2);color:var(--muted);opacity:1;cursor:not-allowed}

/* ── Streak & Badges ── */
.streak-bar{
  display:flex;align-items:center;gap:10px;
  padding:12px 16px;border-radius:var(--radius-sm);
  background:rgba(8,220,224,.04);border:1px solid rgba(8,220,224,.12);
  margin-bottom:14px;
}
.streak-fire{font-size:1.4rem}
.streak-num{font-family:'Sora',sans-serif;font-size:1.6rem;color:var(--accent);line-height:1}
.streak-lbl{font-size:.72rem;color:var(--muted)}
.badge-row{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px}
.badge{
  display:flex;align-items:center;gap:6px;
  padding:6px 12px;border-radius:20px;
  border:1px solid var(--border);background:var(--s2);
  font-size:.73rem;color:var(--muted);
}
.badge.earned{border-color:var(--accent);color:var(--accent);background:var(--accent-dim)}

/* ── Share Card ── */
.share-card{
  background:linear-gradient(135deg,var(--surface),var(--s2));
  border:2px solid var(--accent);border-radius:var(--radius-lg);
  padding:24px 20px;text-align:center;margin-bottom:16px;
  position:relative;overflow:hidden;
}
.share-card::before{
  content:'';position:absolute;top:-40px;right:-40px;width:120px;height:120px;
  border-radius:50%;background:radial-gradient(circle,rgba(8,220,224,.08) 0%,transparent 70%);
}
.share-card-brand{font-family:'Sora',sans-serif;font-size:1rem;letter-spacing:3px;color:var(--accent);opacity:.6;margin-bottom:8px}
.share-card-name{font-family:'Sora',sans-serif;font-size:1.8rem;color:var(--text);margin-bottom:4px}
.share-card-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:16px 0}
.scs-item{padding:10px 6px}
.scs-val{font-family:'Sora',sans-serif;font-size:1.5rem;line-height:1;margin-bottom:2px}
.scs-lbl{font-size:.6rem;text-transform:uppercase;letter-spacing:.5px;color:var(--muted)}
.share-card-footer{font-size:.7rem;color:var(--muted);margin-top:12px}
.share-btn{
  width:100%;min-height:46px;border-radius:10px;border:none;
  background:var(--accent-fill);color:#0b0b12;cursor:pointer;
  font-family:'Sora',sans-serif;font-size:1.05rem;letter-spacing:2px;
  display:flex;align-items:center;justify-content:center;gap:8px;
  transition:all .15s;margin-top:12px;
}
.share-btn:active{transform:scale(.97)}

/* ── Status indicators ── */
.status-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0}
.status-dot.active{background:var(--green)}
.status-dot.warning{background:var(--yellow)}
.status-dot.inactive{background:var(--red)}

/* ── Profile Selector ── */
.prof-screen{min-height:100vh;background:var(--bg);padding-bottom:40px}
.prof-list{display:flex;flex-direction:column;gap:10px;margin-bottom:18px}
.prof-card{
  display:flex;align-items:center;gap:14px;
  padding:16px;border-radius:var(--radius-sm);
  border:2px solid var(--border);background:var(--surface);
  cursor:pointer;font-family:inherit;text-align:left;width:100%;
  transition:all .15s;-webkit-tap-highlight-color:transparent;
}
.prof-card:active{transform:scale(.98)}
.prof-card:hover{border-color:var(--accent);background:rgba(8,220,224,.03)}
.prof-avatar{
  width:44px;height:44px;border-radius:50%;
  background:var(--accent-dim);border:2px solid var(--accent);
  display:flex;align-items:center;justify-content:center;
  font-family:'Sora',sans-serif;font-size:1.1rem;color:var(--accent);
  letter-spacing:1px;flex-shrink:0;
}
.prof-info{flex:1;min-width:0}
.prof-name{font-weight:700;font-size:.95rem;color:var(--text);margin-bottom:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.prof-meta{font-size:.74rem;color:var(--muted);line-height:1.4}
.prof-del{
  width:32px;height:32px;border-radius:8px;border:1px solid rgba(255,79,107,.2);
  background:rgba(255,79,107,.05);color:var(--red);cursor:pointer;
  font-size:.85rem;display:flex;align-items:center;justify-content:center;
  flex-shrink:0;transition:all .15s;-webkit-tap-highlight-color:transparent;
}
.prof-del:hover{background:rgba(255,79,107,.12);border-color:var(--red)}
.prof-new-btn{
  width:100%;min-height:56px;border-radius:var(--radius-sm);
  border:2px dashed rgba(8,220,224,.3);background:rgba(8,220,224,.02);
  color:var(--accent);cursor:pointer;font-family:'Sora',sans-serif;
  font-size:1.1rem;letter-spacing:2px;transition:all .15s;
  display:flex;align-items:center;justify-content:center;gap:10px;
}
.prof-new-btn:hover{border-color:var(--accent);background:rgba(8,220,224,.06)}
.prof-new-btn:active{transform:scale(.98)}
.prof-save-badge{
  position:fixed;top:12px;right:12px;
  padding:6px 12px;border-radius:20px;
  background:rgba(79,255,176,.12);border:1px solid rgba(79,255,176,.3);
  color:var(--green);font-size:.7rem;font-weight:600;letter-spacing:.5px;
  z-index:40;animation:fadeUp .2s ease both;pointer-events:none;
}
.prof-header-bar{
  display:flex;align-items:center;justify-content:space-between;gap:10px;
  padding:8px 16px;margin-bottom:8px;
}
.prof-header-name{font-size:.78rem;color:var(--muted);font-weight:600}
.prof-switch-btn{
  padding:6px 14px;border-radius:8px;border:1.5px solid var(--border);
  background:var(--s2);color:var(--muted-light);cursor:pointer;
  font-family:inherit;font-size:.74rem;font-weight:600;transition:all .15s;
}
.prof-switch-btn:hover{border-color:var(--accent);color:var(--accent)}
`;

// ─── Components ───────────────────────────────────────────────────────────────

// ─── Helpers ─────────────────────────────────────────────────────────────────

const fullName = (data) => {
  const fn = [data.firstName, data.lastName].filter(Boolean).join(" ");
  return fn || data.name || ""; // fallback to old name field
};

const advanceOnEnter = (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    const form = e.target.closest(".card, .fu, .checkin-card");
    if (!form) return;
    const inputs = [...form.querySelectorAll("input, select, textarea")];
    const idx = inputs.indexOf(e.target);
    if (idx >= 0 && idx < inputs.length - 1) {
      inputs[idx + 1].focus();
    } else {
      e.target.blur();
    }
  }
};

// ─── Searchable Exercise Picker ───────────────────────────────────────────────

function SearchableSelect({ exercises, groups, value, onChange, placeholder }) {
  const [search, setSearch] = useState("");
  const [showResults, setShowResults] = useState(false);
  const inputRef = useRef(null);

  const query = search.toLowerCase().trim();
  const filtered = query.length >= 2
    ? exercises.filter(e =>
        e.label.toLowerCase().includes(query) ||
        (e.cat && e.cat.toLowerCase().includes(query)) ||
        (e.note && e.note.toLowerCase().includes(query)) ||
        (e.icon && e.icon.includes(query))
      ).slice(0, 12)
    : [];

  const current = exercises.find(e => e.id === value);

  return (
    <div className="relative">
      <input
        ref={inputRef}
        type="text"
        placeholder={placeholder || "Search exercises..."}
        value={search}
        onChange={e => { setSearch(e.target.value); setShowResults(true); }}
        onFocus={() => setShowResults(true)}
        onBlur={() => setTimeout(() => setShowResults(false), 200)}
        className={`${WZ.input} mb-1.5`}
      />
      {showResults && filtered.length > 0 && (
        <div className="absolute top-full left-0 right-0 z-20 max-h-[240px] overflow-y-auto rounded-lg border border-primary bg-surface shadow-lg">
          {filtered.map(ex => (
            <div key={ex.id}
              onMouseDown={e => { e.preventDefault(); onChange(ex.id); setSearch(""); setShowResults(false); }}
              className={`flex items-center gap-2 px-3.5 py-2.5 cursor-pointer border-b border-border ${ex.id === value ? "bg-[rgba(8,220,224,.06)]" : "bg-transparent"}`}
            >
              <span className="text-base">{ex.icon}</span>
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-[.84rem] text-fg">{ex.label}</div>
                <div className="text-[.7rem] text-muted">{ex.cat||""}{ex.note ? ` · ${ex.note}` : ""}</div>
              </div>
            </div>
          ))}
        </div>
      )}
      {query.length >= 2 && filtered.length === 0 && showResults && (
        <div className="text-[.78rem] text-muted py-1.5">No matches — try a different term</div>
      )}
    </div>
  );
}

// ─── Custom Exercise Creator ──────────────────────────────────────────────────

function CustomExerciseCreator({ exerciseType, onAdd }) {
  const [show, setShow] = useState(false);
  const [name, setName] = useState("");
  const [calPerMin, setCalPerMin] = useState("");
  const [category, setCategory] = useState(exerciseType === "cardio" ? "Custom Cardio" : "Custom Strength");
  const [saved, setSaved] = useState(false);

  const canSave = name.trim() && calPerMin && Number(calPerMin) > 0;

  const handleSave = () => {
    const ex = {
      id: `custom_${Date.now()}`,
      label: name.trim(),
      icon: "⭐",
      met: 0,
      calPerMin: Number(calPerMin),
      cat: category,
      note: "Custom exercise — user-entered calorie estimate",
      isCustom: true,
      type: exerciseType,
    };
    onAdd(ex);
    setSaved(true);
    setName("");
    setCalPerMin("");
    setTimeout(() => { setSaved(false); setShow(false); }, 1500);
  };

  return (
    <div className="my-2.5">
      <button
        className={`w-full text-left px-3.5 py-3 rounded-lg border border-[rgba(181,123,255,.3)] bg-[rgba(181,123,255,.05)] text-[#b57bff] text-sm font-semibold cursor-pointer ${show ? "mb-2" : ""}`}
        onClick={()=>setShow(v=>!v)}>
        ⭐ Create Custom {exerciseType === "cardio" ? "Cardio" : "Strength"} Exercise {show?"▲":"▼"}
      </button>
      {show && (
        <div className="fu rounded-lg border border-[rgba(181,123,255,.25)] bg-bg p-3.5">
          <div className="mb-4">
            <label className={WZ.label}>Exercise Name</label>
            <input type="text" placeholder="e.g. Battle Ropes, TRX Row, Sled Push" value={name}
              onChange={e=>setName(e.target.value)} className={WZ.input} />
          </div>
          <div className="mb-4">
            <label className={WZ.label}>Estimated Calories Burned Per Minute <span className={WZ.hint}>your best estimate</span></label>
            <input type="text" inputMode="decimal" placeholder="e.g. 8" value={calPerMin}
              onChange={e=>setCalPerMin(e.target.value.replace(/[^0-9.]/g,""))} className={WZ.input} />
            <div className="text-[.7rem] text-muted mt-1 leading-snug">
              💡 Reference: walking ≈ 4 cal/min, jogging ≈ 9 cal/min, intense HIIT ≈ 14 cal/min. If unsure, estimate conservatively.
            </div>
          </div>
          <button
            className="w-full min-h-[42px] rounded-lg border-none bg-[#b57bff] text-[#0b0b12] font-bold text-[.9rem] cursor-pointer disabled:opacity-55 disabled:cursor-not-allowed"
            disabled={!canSave||saved} onClick={handleSave}>
            {saved ? "✓ Added!" : `Save Custom Exercise`}
          </button>
          <div className="text-[.6rem] text-muted mt-1.5 italic text-center">
            ⭐ Custom exercises are marked with a star and labeled "User Estimate" to distinguish them from Glide's library. Calorie values are your estimates, not validated.
          </div>
        </div>
      )}
    </div>
  );
}

// Shared wizard Tailwind class strings (Session 30 brand redesign — pro theme).
// Used across all five step components for a consistent look.
const WZ = {
  card: "bg-surface border border-border rounded-card p-5 mb-4",
  title: "font-display text-lg tracking-wider text-primary mb-1",
  sub: "text-sm text-muted mb-5 leading-relaxed",
  label: "block text-[.72rem] tracking-wide uppercase text-muted mb-2 font-semibold",
  hint: "text-[.65rem] font-normal text-muted ml-1.5 normal-case",
  input: "w-full min-h-[48px] px-4 py-3 bg-surface2 border border-border rounded-lg text-fg text-base outline-none focus:border-primary placeholder:text-muted",
  err: "text-[.78rem] text-danger bg-[rgba(248,113,113,.08)] border border-[rgba(248,113,113,.3)] rounded-lg px-3 py-2 mt-2",
  tip: "text-[.78rem] text-muted leading-relaxed px-3.5 py-3 mt-2.5 bg-surface2 rounded-lg border-l-2 border-border",
};
// Big toggle button (gender, etc.) — cyan when active.
const wzGbtn = (active) => `min-h-[48px] p-4 rounded-lg border-2 cursor-pointer font-semibold flex items-center justify-center gap-2 transition-colors ${active ? "border-primary text-primary bg-[rgba(8,220,224,.08)]" : "border-border text-muted bg-surface2"}`;
// Large scannable selection row (activity levels, exercises) — cyan when active.
const wzAbtn = (active) => `w-full min-h-[60px] px-4 py-3.5 rounded-lg border-2 cursor-pointer flex items-center gap-3.5 text-left transition-colors ${active ? "border-primary bg-[rgba(8,220,224,.06)]" : "border-border bg-surface2"}`;
// Shared widget classes for the workout steps (Strength + Cardio): quick-fill
// panels, per-day cards, etc.
const WZW = {
  toggle: "w-full text-left px-3.5 py-3 rounded-lg border border-border bg-surface2 text-fg text-sm font-semibold cursor-pointer mb-2.5",
  panel: "fu rounded-lg border border-border bg-bg p-3.5 mb-3",
  select: WZ.input + " appearance-none",
  dayCard: "rounded-lg border border-border bg-surface2 mb-2.5 overflow-hidden",
  dayHeader: "flex items-center gap-3 px-3 py-3 cursor-pointer",
  dayChip: "shrink-0 min-w-[44px] text-center text-[.7rem] font-bold uppercase tracking-wide text-primary bg-[rgba(8,220,224,.1)] rounded-md py-1",
  dayBody: "px-3 pb-3 border-t border-border",
  warn: "text-[.82rem] text-warn bg-[rgba(251,191,36,.08)] border border-[rgba(251,191,36,.3)] rounded-lg px-3.5 py-3 my-2 leading-relaxed",
  clearDay: "w-full mt-2 py-2.5 rounded-lg border border-border bg-transparent text-muted text-sm font-semibold cursor-pointer",
  primaryBtn: "min-h-[44px] rounded-lg bg-primaryfill text-primaryfg font-bold text-sm px-4 cursor-pointer disabled:bg-surface2 disabled:text-muted disabled:cursor-not-allowed",
  ghostBtn: "min-h-[44px] rounded-lg border border-border bg-surface2 text-fg font-semibold text-sm px-4 cursor-pointer",
};
const wzFillDay = (sel) => `min-h-[40px] rounded-md border text-sm font-semibold cursor-pointer ${sel ? "border-primary bg-[rgba(8,220,224,.12)] text-primary" : "border-border bg-surface2 text-fg"}`;
const wzPreset = "px-2.5 py-1 rounded-md border border-border bg-surface2 text-fg text-[.72rem] cursor-pointer";

function BottomNav({ onBack, onNext, nextLabel = "Next →", nextDisabled = false, showBack = true }) {
  // Brand-themed fixed bottom bar (Session 30). Rendered through a portal to
  // document.body so it anchors to the viewport — the wizard steps live inside
  // the .page-transition wrapper, which keeps a CSS transform that would
  // otherwise become the containing block for this position:fixed bar (the same
  // trap fixed for the modals). data-theme="pro" keeps it self-themed.
  return createPortal(
    <div data-theme="pro" style={{ paddingBottom: "calc(14px + env(safe-area-inset-bottom,0px))" }}
      className="fixed bottom-0 left-0 right-0 z-30 flex gap-2.5 px-4 py-3.5 border-t border-border bg-bg/95 backdrop-blur-xl">
      {showBack && (
        <button onClick={onBack}
          className="flex-none px-5 min-h-[52px] rounded-xl border border-border bg-surface2 text-fg font-bold text-base cursor-pointer">
          ← Back
        </button>
      )}
      <button disabled={nextDisabled} onClick={onNext}
        className="flex-1 px-5 min-h-[52px] rounded-xl border-none bg-primaryfill text-primaryfg font-bold text-base cursor-pointer disabled:bg-surface2 disabled:text-muted disabled:cursor-not-allowed">
        {nextLabel}
      </button>
    </div>,
    document.body
  );
}

// ─── Step 1: Personal ─────────────────────────────────────────────────────────

function StepPersonal({ data, onChange, onNext }) {
  const valid = data.age && data.weightLbs && data.heightFt && data.heightIn !== "" && data.gender;

  const numOnly = (key) => (e) => {
    const filtered = e.target.value.replace(/[^0-9]/g, "");
    onChange(key, filtered);
  };
  const decOnly = (key) => (e) => {
    let v = e.target.value.replace(/[^0-9.]/g, "");
    const parts = v.split(".");
    if (parts.length > 2) v = parts[0] + "." + parts.slice(1).join("");
    onChange(key, v);
  };
  const textOnly = (key) => (e) => {
    const filtered = e.target.value.replace(/[^a-zA-Z\s\-']/g, "");
    onChange(key, filtered);
  };

  return (
    <div data-theme="pro" className="fu text-fg">
      {/* Welcome banner */}
      <div className="flex items-start gap-3.5 p-4 mb-4 rounded-card border border-primary bg-[rgba(8,220,224,.06)]">
        <div className="text-[2.2rem] leading-none shrink-0 mt-0.5">👋</div>
        <div>
          <div className="font-display text-xl tracking-wide text-primary mb-1">Welcome to Glide</div>
          <div className="text-[.84rem] text-muted leading-relaxed">Answer a few quick questions and we'll build your personalized plan. Takes about 2 minutes.</div>
        </div>
      </div>

      <div className={WZ.card}>
        <div className={WZ.title}>About You</div>
        <div className={WZ.sub}>This lets us calculate your exact metabolism using a clinically validated formula.</div>

        <div className="mb-4">
          <label className={WZ.label}>I am a</label>
          <div className="grid grid-cols-2 gap-3">
            <button className={wzGbtn(data.gender==="male")} onClick={()=>onChange("gender","male")}>
              <span className="text-xl">♂</span> Male
            </button>
            <button className={wzGbtn(data.gender==="female")} onClick={()=>onChange("gender","female")}>
              <span className="text-xl">♀</span> Female
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 mb-4">
          <div>
            <label className={WZ.label}>Age <span className={WZ.hint}>years</span></label>
            <input className={WZ.input} inputMode="numeric" placeholder="28" value={data.age} onChange={numOnly("age")} maxLength={3} onKeyDown={advanceOnEnter}/>
          </div>
          <div>
            <label className={WZ.label}>Current Weight <span className={WZ.hint}>lbs</span></label>
            <input className={WZ.input} inputMode="decimal" placeholder="185" value={data.weightLbs} onChange={decOnly("weightLbs")} maxLength={6} onKeyDown={advanceOnEnter}/>
          </div>
        </div>

        <div className="mb-4">
          <label className={WZ.label}>Height</label>
          <div className="grid grid-cols-2 gap-3">
            <input className={WZ.input} inputMode="numeric" placeholder="Feet — e.g. 5" value={data.heightFt} onChange={numOnly("heightFt")} maxLength={1} onKeyDown={advanceOnEnter}/>
            <input className={WZ.input} inputMode="numeric" placeholder="Inches — e.g. 10" value={data.heightIn} onChange={numOnly("heightIn")} maxLength={2} onKeyDown={advanceOnEnter}/>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 mb-4">
          <div>
            <label className={WZ.label}>First Name</label>
            <input className={WZ.input} inputMode="text" placeholder="e.g. Alex" value={data.firstName} onChange={textOnly("firstName")} maxLength={25} onKeyDown={advanceOnEnter}/>
          </div>
          <div>
            <label className={WZ.label}>Last Name</label>
            <input className={WZ.input} inputMode="text" placeholder="e.g. Smith" value={data.lastName} onChange={textOnly("lastName")} maxLength={25} onKeyDown={advanceOnEnter}/>
          </div>
        </div>

        <div className="mb-4">
          <label className={WZ.label}>Body Fat % <span className={WZ.hint}>optional — from calipers, scale, or DEXA</span></label>
          <input className={WZ.input} inputMode="decimal" placeholder="e.g. 22" value={data.bodyFat} onChange={decOnly("bodyFat")} maxLength={5} onKeyDown={advanceOnEnter}/>
          {data.bodyFat && Number(data.bodyFat) > 0 && (()=>{
            const bf = Number(data.bodyFat);
            const isMale = data.gender === "male";
            const cat = isMale
              ? bf < 6 ? {label:"Essential Fat",color:"var(--red)"} : bf < 14 ? {label:"Athletic",color:"var(--green)"} : bf < 18 ? {label:"Fitness",color:"var(--green)"} : bf < 25 ? {label:"Average",color:"var(--yellow)"} : {label:"Above Average",color:"var(--orange)"}
              : bf < 14 ? {label:"Essential Fat",color:"var(--red)"} : bf < 21 ? {label:"Athletic",color:"var(--green)"} : bf < 25 ? {label:"Fitness",color:"var(--green)"} : bf < 32 ? {label:"Average",color:"var(--yellow)"} : {label:"Above Average",color:"var(--orange)"};
            const lbmLbs = Math.round(Number(data.weightLbs) * (1 - bf/100));
            const fatLbs = Math.round(Number(data.weightLbs) * (bf/100));
            return (
              <div className="flex gap-2.5 mt-2 text-[.78rem] text-muted flex-wrap">
                <span style={{color:cat.color}} className="font-semibold">{cat.label}</span>
                <span>·</span>
                <span>{fatLbs} lbs fat</span>
                <span>·</span>
                <span>{lbmLbs} lbs lean mass</span>
              </div>
            );
          })()}
          <div className="text-[.6rem] text-muted mt-1 italic">*BF% from consumer scales can be off by 3-8%. DEXA and calipers by a trained professional are more accurate.</div>
        </div>

        {/* Privacy note */}
        <div className="text-[.7rem] text-muted text-center mt-4 pt-3.5 border-t border-border leading-snug">🔒 Your information is used only to calculate your results — nothing is stored or shared.</div>
        <div className="text-[.6rem] text-muted text-center mt-1.5 italic">⚠️ All calculations are estimates based on published formulas — not medical advice.</div>
      </div>
      <BottomNav showBack={false} onNext={onNext} nextLabel="Continue →" nextDisabled={!valid}/>
    </div>
  );
}

// ─── Step 2: Goal Weight ──────────────────────────────────────────────────────

function StepGoalWeight({ data, onChange, onBack, onNext }) {
  const current = Number(data.weightLbs) || 0;
  const goal    = Number(data.goalWeight) || 0;
  const toLose  = current > 0 && goal > 0 && goal < current ? (current - goal) : null;
  const valid   = toLose !== null;

  return (
    <div data-theme="pro" className="fu text-fg">
      <div className={WZ.card}>
        <div className={WZ.title}>Your Goal Weight</div>
        <div className={WZ.sub}>
          Where do you want to be? We'll show you exactly how long it takes and what to do each day to get there.
        </div>
        <div className="flex items-center gap-3 mb-5">
          <div className="flex-1 text-center rounded-lg border border-border bg-surface2 py-3">
            <div className="text-[.62rem] uppercase tracking-wide text-muted">Starting at</div>
            <div className="font-display text-3xl text-fg leading-tight">{current||"—"}</div>
            <div className="text-[.62rem] text-muted">lbs today</div>
          </div>
          <div className="text-muted text-xl">→</div>
          <div className={`flex-1 text-center rounded-lg border bg-surface2 py-3 ${valid?"border-primary":"border-border"}`}>
            <div className="text-[.62rem] uppercase tracking-wide text-muted">Goal</div>
            <div className={`font-display text-3xl leading-tight ${valid?"text-primary":"text-muted"}`}>{goal||"?"}</div>
            <div className="text-[.62rem] text-muted">lbs target</div>
          </div>
        </div>
        <div className="mb-4">
          <label className={WZ.label}>Enter your goal weight <span className={WZ.hint}>lbs</span></label>
          <input className={`${WZ.input} text-center font-semibold text-[1.1rem]`}
            inputMode="decimal"
            placeholder="e.g. 165"
            value={data.goalWeight}
            onChange={e => {
              let v = e.target.value.replace(/[^0-9.]/g, "");
              const parts = v.split(".");
              if (parts.length > 2) v = parts[0] + "." + parts.slice(1).join("");
              onChange("goalWeight", v);
            }}
            maxLength={6}
            onKeyDown={advanceOnEnter}
          />
        </div>
        {toLose && (
          <div className="text-center rounded-lg border border-primary bg-[rgba(8,220,224,.06)] py-3 mb-3">
            <div className="text-[.62rem] uppercase tracking-wide text-muted">Total to lose</div>
            <div className="font-display text-4xl text-primary leading-tight">{toLose.toFixed(1)}</div>
            <div className="text-[.62rem] text-muted">pounds — we'll map out exactly how to get there</div>
          </div>
        )}
        {goal > 0 && goal >= current && (
          <div className={WZ.err}>⚠️ Goal must be less than your current weight ({current} lbs).</div>
        )}

        {/* Goal weight range (optional band the client aims to stay within) */}
        <div className="mb-4 mt-3">
          <label className={WZ.label}>Goal weight range <span className={WZ.hint}>optional — a healthy band to stay within</span></label>
          <div className="flex gap-2 items-center">
            <input className={`${WZ.input} text-center font-semibold`} inputMode="decimal" placeholder="Low e.g. 190" value={data.goalRangeLow || ""}
              onChange={e => { let v = e.target.value.replace(/[^0-9.]/g,""); const p=v.split("."); if(p.length>2) v=p[0]+"."+p.slice(1).join(""); onChange("goalRangeLow", v); }}
              maxLength={6} />
            <span className="text-muted text-[.85rem]">to</span>
            <input className={`${WZ.input} text-center font-semibold`} inputMode="decimal" placeholder="High e.g. 198" value={data.goalRangeHigh || ""}
              onChange={e => { let v = e.target.value.replace(/[^0-9.]/g,""); const p=v.split("."); if(p.length>2) v=p[0]+"."+p.slice(1).join(""); onChange("goalRangeHigh", v); }}
              maxLength={6} />
            <span className={WZ.hint}>lbs</span>
          </div>
          {(() => {
            const lo = Number(data.goalRangeLow), hi = Number(data.goalRangeHigh);
            if (lo > 0 && hi > 0 && lo >= hi) return <div className={WZ.err}>⚠️ The low end should be below the high end.</div>;
            if (lo > 0 && hi > 0) return <div className="text-[.72rem] text-muted mt-1">You'll aim to stay between {lo} and {hi} lbs.</div>;
            return null;
          })()}
        </div>

        {/* Body Fat Goal */}
        {data.bodyFat && Number(data.bodyFat) > 0 && (
          <div className="mb-4 mt-3">
            <label className={WZ.label}>Goal Body Fat % <span className={WZ.hint}>optional</span></label>
            <input className={`${WZ.input} text-center font-semibold`} inputMode="decimal" placeholder={`e.g. ${Math.max(8, Math.round(Number(data.bodyFat) - 5))}`}
              value={data.goalBodyFat}
              onChange={e => { let v = e.target.value.replace(/[^0-9.]/g,""); onChange("goalBodyFat",v); }}
              maxLength={5} />
            {data.goalBodyFat && Number(data.goalBodyFat) > 0 && (()=>{
              const startBf = Number(data.bodyFat);
              const goalBf = Number(data.goalBodyFat);
              const bfToLose = startBf - goalBf;
              const isMale = data.gender === "male";
              const minBf = isMale ? 6 : 14;
              const tooLow = goalBf < minBf;
              // Estimate: 0.5-1% BF loss per month with proper deficit + training
              const monthsSlow = bfToLose > 0 ? Math.round(bfToLose / 0.5) : null;
              const monthsFast = bfToLose > 0 ? Math.round(bfToLose / 1.0) : null;
              // Fat lbs to lose to hit goal BF%
              const currentFatLbs = current * (startBf / 100);
              const goalFatLbs = current * (goalBf / 100); // simplified - LBM preserved
              const fatLbsToLose = Math.round(currentFatLbs - goalFatLbs);
              return (
                <>
                  {bfToLose > 0 && (
                    <div className="text-center rounded-lg border border-[rgba(47,224,168,.3)] bg-[rgba(47,224,168,.06)] py-3 mt-2.5">
                      <div className="text-[.62rem] uppercase tracking-wide text-success">Body Fat Goal</div>
                      <div className="font-display text-3xl text-success leading-tight">{startBf}% → {goalBf}%</div>
                      <div className="text-[.62rem] text-muted">≈ {fatLbsToLose} lbs of fat to lose · est. {monthsFast}–{monthsSlow} months*</div>
                    </div>
                  )}
                  {tooLow && (
                    <div className={WZ.err}>⚠️ {goalBf}% is below the {isMale?"athletic (6%)":"athletic (14%)"} threshold for {isMale?"men":"women"}. Going below {minBf}% BF can be harmful — competition-level leanness is not sustainable long-term.</div>
                  )}
                  {bfToLose > 0 && (
                    <div className="text-[.62rem] text-muted mt-1 italic">*BF% timeline estimates 0.5–1% loss per month with consistent deficit and resistance training. Actual results vary significantly.</div>
                  )}
                  {goalBf >= startBf && <div className={WZ.err}>⚠️ Goal BF% should be lower than your current {startBf}%.</div>}
                </>
              );
            })()}
          </div>
        )}
        <div className={WZ.tip}>
          {(()=>{
            const ten = Math.round(current * 0.90);
            const fifteen = Math.round(current * 0.85);
            const totalIn = Number(data.heightFt) * 12 + Number(data.heightIn);
            const hm = totalIn * 0.0254;
            const currentBmi = hm > 0 ? (current * 0.453592) / (hm * hm) : 0;
            const minHealthyLbs = hm > 0 ? Math.round((18.5 * hm * hm) / 0.453592) : 0;
            const maxHealthyLbs = hm > 0 ? Math.round((24.9 * hm * hm) / 0.453592) : 0;
            const isHealthy = currentBmi >= 18.5 && currentBmi <= 24.9;
            const goalBmi = goal > 0 && hm > 0 ? (goal * 0.453592) / (hm * hm) : 0;
            const goalTooLow = goalBmi > 0 && goalBmi < 18.5;

            return <>
              {isHealthy ? (
                <span>✅ <strong style={{color:"var(--green)"}}>You're currently in a healthy weight range</strong> (BMI {currentBmi.toFixed(1)}). The healthy range for your height is {minHealthyLbs}–{maxHealthyLbs} lbs. If you still want to cut, a modest 5–10% reduction ({Math.round(current*0.95)}–{Math.round(current*0.90)} lbs) is a reasonable target.</span>
              ) : (
                <span>💡 Not sure? A healthy starting goal is <strong style={{color:"var(--accent)"}}>10–15% below your current weight: {fifteen}–{ten} lbs</strong>. The healthy BMI range for your height is {minHealthyLbs}–{maxHealthyLbs} lbs.</span>
              )}
              {goalTooLow && (
                <span style={{display:"block",marginTop:"6px",color:"var(--red)"}}>⚠️ Your goal of {goal} lbs (BMI {goalBmi.toFixed(1)}) would be below the healthy range. Going under {minHealthyLbs} lbs could be harmful — consider a higher target.</span>
              )}
              {minHealthyLbs > 0 && !goalTooLow && (
                <span style={{display:"block",marginTop:"4px",fontSize:".72rem",color:"var(--muted)"}}>ℹ️ Below {minHealthyLbs} lbs would be underweight for your height.</span>
              )}
            </>;
          })()}
        </div>
        <div className="text-[.6rem] text-muted text-center mt-2 italic">⚠️ Weight loss timelines are estimates. Consult a healthcare provider before starting any weight loss program.</div>
      </div>
      <BottomNav onBack={onBack} onNext={onNext} nextLabel="Continue →" nextDisabled={!valid}/>
    </div>
  );
}

// ─── Step 3: Activity ─────────────────────────────────────────────────────────

function StepActivity({ data, onChange, onBack, onNext }) {
  const [activeInfo, setActiveInfo] = useState(null);
  const ACTIVITY_DETAILS = {
    sedentary: "You sit most of the day — at a desk, in a car, on a couch. Steps per day are typically under 4,000. Examples: office worker, programmer, driver, student. Your body burns very little beyond your base metabolism from daily movement. Multiplier: 1.2× BMR.",
    light: "You're moving a bit more than just sitting — maybe a short walk at lunch, some light housework, or errands a few times a week. Steps around 4,000–7,000/day. Examples: teacher who mostly stands, stay-at-home parent, light retail. Multiplier: 1.375× BMR.",
    moderate: "You're on your feet and moving for most of your working hours. Steps typically 7,000–10,000+/day. This is genuine physical activity throughout the day, not just occasional standing. Examples: nurse, waiter/waitress, warehouse worker, postal carrier, retail floor worker. Multiplier: 1.55× BMR.",
    very: "Your job is physically demanding — you're lifting, carrying, climbing, or moving heavy things regularly. Steps 12,000+/day plus significant physical labor. Examples: construction worker, landscaper, mover, agricultural worker. Multiplier: 1.725× BMR.",
    extra: "Extremely hard physical labor for most of the day — the kind of work where you're exhausted by the end of every shift. Examples: roofer, heavy farmer, lumberjack, commercial fisherman, mining. Very few people are truly in this category. Multiplier: 1.9× BMR.",
  };
  return (
    <div data-theme="pro" className="fu text-fg" onClick={()=>activeInfo && setActiveInfo(null)}>
      <div className={WZ.card}>
        <div className={WZ.title}>Daily Activity Level</div>
        <div className={WZ.sub}>
          This measures your <strong className="text-fg">non-exercise movement</strong> — your job, daily routine, and how much you're on your feet. <strong className="text-fg">Do NOT include planned workouts</strong> — those are tracked separately in the next steps.
        </div>
        <div className={`${WZ.tip} mt-0 mb-4`}>
          📊 <strong>How this works:</strong> Your body burns a baseline number of calories just existing (BMR). This step estimates how much your daily lifestyle adds on top of that — sitting at a desk all day burns far fewer calories than being on your feet in a warehouse. Your planned cardio and strength training are calculated separately in the next steps and added to this baseline, so you get an accurate total without double-counting.
        </div>
        {ACTIVITY_LEVELS.map(a=>{
          const active = data.activityLevel===a.id;
          return (
          <div key={a.id} className="mb-2.5">
            <div className="flex items-center gap-1">
              <button className={`${wzAbtn(active)} flex-1`} onClick={()=>{onChange("activityLevel",a.id);setActiveInfo(null);}}>
                <span className="text-2xl leading-none shrink-0">{a.emoji}</span>
                <div><div className={`font-bold text-[.97rem] ${active?"text-primary":"text-fg"}`}>{a.label}</div><div className="text-[.76rem] text-muted leading-snug">{a.desc}</div></div>
                {active && <span className="ml-auto shrink-0 w-7 h-7 rounded-full bg-[rgba(8,220,224,.15)] text-primary flex items-center justify-center text-lg">✓</span>}
              </button>
              <button className={`shrink-0 w-8 h-8 rounded-full border flex items-center justify-center text-sm cursor-pointer ${activeInfo===a.id?"border-primary text-primary bg-[rgba(8,220,224,.08)]":"border-border text-muted bg-surface2"}`}
                onClick={(e)=>{e.stopPropagation();setActiveInfo(activeInfo===a.id?null:a.id);}}>i</button>
            </div>
            {activeInfo===a.id && (
              <div onClick={e=>e.stopPropagation()} className="px-3.5 py-3 mt-2 rounded-lg bg-[rgba(8,220,224,.06)] border border-[rgba(8,220,224,.2)] text-[.82rem] text-fg leading-relaxed">
                {ACTIVITY_DETAILS[a.id]}
              </div>
            )}
          </div>
          );
        })}
        <div className={WZ.tip}>💡 When in doubt, choose one level lower — most people overestimate how active they are day-to-day.</div>
        <div className="text-[.6rem] text-muted text-center mt-2 italic">⚠️ Activity multipliers are general estimates — actual energy expenditure varies by individual.</div>
      </div>
      <BottomNav onBack={onBack} onNext={onNext} nextLabel="Continue →" nextDisabled={!data.activityLevel}/>
    </div>
  );
}

// ─── Step 4: Cardio ───────────────────────────────────────────────────────────

// ─── Strength Training Data ───────────────────────────────────────────────────
// MET values from Ainsworth et al. 2011 Compendium of Physical Activities
// (Medicine & Science in Sports & Exercise 43:1575)
// Muscle gain rates: Schoenfeld BJ et al. (2017) J Strength Cond Res
// Body fat reduction: Wewege MA et al. (2022) Sports Medicine meta-analysis

const STRENGTH_EXERCISES = [
  // ── HORIZONTAL PUSH ──
  { id:"bb_bench",       label:"Barbell Bench Press",         icon:"💪", met:5.5, cat:"Horizontal Push", note:"Chest, front delts, triceps" },
  { id:"db_bench",       label:"Dumbbell Chest Press",        icon:"💪", met:5.5, cat:"Horizontal Push", note:"Chest, front delts, triceps — greater ROM than barbell" },
  { id:"incline_bb",     label:"Incline Barbell Press",       icon:"💪", met:5.5, cat:"Horizontal Push", note:"Upper chest, shoulders, triceps" },
  { id:"incline_db",     label:"Incline Dumbbell Press",      icon:"💪", met:5.5, cat:"Horizontal Push", note:"Upper chest, shoulders — unilateral stability" },
  { id:"decline_press",  label:"Decline Press",               icon:"💪", met:5.0, cat:"Horizontal Push", note:"Lower chest emphasis, triceps" },
  { id:"machine_chest",  label:"Machine Chest Press",         icon:"🔧", met:4.5, cat:"Horizontal Push", note:"Chest, front delts — great for beginners or burnout sets" },
  { id:"cable_fly",      label:"Cable Chest Fly",             icon:"🔄", met:4.0, cat:"Horizontal Push", note:"Chest isolation, constant tension through full ROM" },
  { id:"db_fly",         label:"Dumbbell Fly",                icon:"💪", met:4.0, cat:"Horizontal Push", note:"Chest stretch and squeeze, front delts" },
  { id:"push_up",        label:"Push-Ups",                    icon:"🤸", met:3.8, cat:"Horizontal Push", note:"Chest, triceps, core — bodyweight compound" },
  { id:"dips_chest",     label:"Dips (Chest Focus)",          icon:"💪", met:5.0, cat:"Horizontal Push", note:"Lower chest, triceps, front delts" },
  { id:"close_grip_bp",  label:"Close-Grip Bench Press",      icon:"💪", met:5.5, cat:"Horizontal Push", note:"Triceps emphasis, inner chest" },
  { id:"tricep_push",    label:"Tricep Pushdown",             icon:"💪", met:3.5, cat:"Horizontal Push", note:"Triceps isolation" },
  { id:"skull_crusher",  label:"Skull Crushers / Lying Ext",  icon:"💪", met:3.5, cat:"Horizontal Push", note:"Triceps — long head emphasis" },
  { id:"overhead_tri",   label:"Overhead Tricep Extension",   icon:"💪", met:3.5, cat:"Horizontal Push", note:"Triceps long head stretch" },
  // ── HORIZONTAL PULL ──
  { id:"bb_row",         label:"Barbell Bent-Over Row",       icon:"🔄", met:5.5, cat:"Horizontal Pull", note:"Lats, rhomboids, biceps, rear delts" },
  { id:"db_row",         label:"Dumbbell Bent-Over Row",      icon:"🔄", met:5.0, cat:"Horizontal Pull", note:"Unilateral back, lats, biceps" },
  { id:"db_single_row",  label:"Single Arm Dumbbell Row",     icon:"🔄", met:5.0, cat:"Horizontal Pull", note:"Lats, rhomboids — anti-rotation core work" },
  { id:"seated_cable",   label:"Seated Cable Row",            icon:"🔄", met:4.5, cat:"Horizontal Pull", note:"Mid back, lats, biceps — constant tension" },
  { id:"single_cable_r", label:"Single Arm Cable Row",        icon:"🔄", met:4.5, cat:"Horizontal Pull", note:"Lats, obliques — unilateral cable pull" },
  { id:"tbar_row",       label:"T-Bar Row",                   icon:"🔄", met:5.5, cat:"Horizontal Pull", note:"Mid/upper back, lats, biceps" },
  { id:"chest_sup_row",  label:"Chest-Supported Row",         icon:"🔄", met:4.5, cat:"Horizontal Pull", note:"Upper back, rear delts — removes lower back stress" },
  { id:"machine_row",    label:"Machine Row",                 icon:"🔧", met:4.5, cat:"Horizontal Pull", note:"Lats, mid back — stable, beginner-friendly" },
  { id:"inverted_row",   label:"Inverted Row (Bodyweight)",   icon:"🤸", met:4.0, cat:"Horizontal Pull", note:"Upper back, biceps, core — bodyweight pull" },
  { id:"face_pull",      label:"Face Pull / Rear Delt Fly",   icon:"🎯", met:3.5, cat:"Horizontal Pull", note:"Rear delts, rotator cuff, posture" },
  { id:"bb_curl",        label:"Barbell Curl",                icon:"💪", met:3.5, cat:"Horizontal Pull", note:"Biceps — heavy bilateral loading" },
  { id:"db_curl",        label:"Dumbbell Curl",               icon:"💪", met:3.5, cat:"Horizontal Pull", note:"Biceps — unilateral, supination control" },
  { id:"hammer_curl",    label:"Hammer Curl",                 icon:"💪", met:3.5, cat:"Horizontal Pull", note:"Brachialis, brachioradialis, biceps" },
  // ── VERTICAL PUSH ──
  { id:"bb_ohp",         label:"Barbell Overhead Press",      icon:"🙌", met:5.5, cat:"Vertical Push", note:"Shoulders, triceps, core stability" },
  { id:"db_ohp",         label:"Dumbbell Overhead Press",     icon:"🙌", met:5.5, cat:"Vertical Push", note:"Shoulders, triceps — unilateral balance" },
  { id:"db_seated_ohp",  label:"Seated Dumbbell Press",       icon:"🙌", met:5.0, cat:"Vertical Push", note:"Shoulders, triceps — back-supported stability" },
  { id:"arnold_press",   label:"Arnold Press",                icon:"🙌", met:5.0, cat:"Vertical Push", note:"All three delt heads through rotation" },
  { id:"cable_ohp",      label:"Cable Overhead Press",        icon:"🙌", met:4.5, cat:"Vertical Push", note:"Shoulders — constant tension through ROM" },
  { id:"machine_ohp",    label:"Machine Shoulder Press",      icon:"🔧", met:4.5, cat:"Vertical Push", note:"Shoulders, triceps — stable path" },
  { id:"landmine_press",  label:"Landmine Press",             icon:"🙌", met:5.0, cat:"Vertical Push", note:"Shoulders, upper chest, core — angled press" },
  { id:"pike_pushup",    label:"Pike Push-Up / HSPU",         icon:"🤸", met:5.0, cat:"Vertical Push", note:"Shoulders, triceps — bodyweight vertical push" },
  { id:"lateral_raise",  label:"Lateral Raise",               icon:"🙆", met:3.5, cat:"Vertical Push", note:"Lateral deltoid — isolation" },
  { id:"front_raise",    label:"Front Raise",                 icon:"🙆", met:3.5, cat:"Vertical Push", note:"Front deltoid — isolation" },
  { id:"cable_lat_raise",label:"Cable Lateral Raise",         icon:"🙆", met:3.5, cat:"Vertical Push", note:"Lateral delt — constant cable tension" },
  // ── VERTICAL PULL ──
  { id:"pullup",         label:"Pull-Ups",                    icon:"⬆️", met:5.0, cat:"Vertical Pull", note:"Lats, biceps, rear delts, core" },
  { id:"chinup",         label:"Chin-Ups",                    icon:"⬆️", met:5.0, cat:"Vertical Pull", note:"Lats, biceps (supinated grip = more biceps)" },
  { id:"lat_pulldown",   label:"Lat Pulldown",                icon:"⬇️", met:4.5, cat:"Vertical Pull", note:"Lats, teres major, biceps" },
  { id:"single_lat_pd",  label:"Single Arm Lat Pulldown",     icon:"⬇️", met:4.5, cat:"Vertical Pull", note:"Lats — unilateral focus, anti-rotation" },
  { id:"wide_pulldown",  label:"Wide-Grip Pulldown",          icon:"⬇️", met:4.5, cat:"Vertical Pull", note:"Outer lats, teres major emphasis" },
  { id:"cable_pullover", label:"Cable / Machine Pullover",    icon:"⬇️", met:4.0, cat:"Vertical Pull", note:"Lats isolation — long head stretch" },
  { id:"neutral_pullup", label:"Neutral-Grip Pull-Up",        icon:"⬆️", met:5.0, cat:"Vertical Pull", note:"Lats, brachialis — easier on shoulders" },
  { id:"assisted_pullup",label:"Assisted Pull-Up Machine",    icon:"⬆️", met:4.0, cat:"Vertical Pull", note:"Lats, biceps — scalable for beginners" },
  { id:"straight_arm_pd",label:"Straight-Arm Pulldown",       icon:"⬇️", met:4.0, cat:"Vertical Pull", note:"Lats isolation — no biceps involvement" },
  // ── LOWER PUSH ──
  { id:"bb_squat",       label:"Barbell Back Squat",          icon:"🏋️", met:6.0, cat:"Lower Push", note:"Quads, glutes, hamstrings, core" },
  { id:"front_squat",    label:"Front Squat",                 icon:"🏋️", met:6.0, cat:"Lower Push", note:"Quads emphasis, core, upper back" },
  { id:"goblet_squat",   label:"Goblet Squat",                icon:"🏋️", met:5.0, cat:"Lower Push", note:"Quads, glutes — beginner-friendly, teaches depth" },
  { id:"hack_squat",     label:"Hack Squat Machine",          icon:"🦵", met:5.5, cat:"Lower Push", note:"Quads emphasis — less spinal load" },
  { id:"leg_press",      label:"Leg Press Machine",           icon:"🦵", met:5.0, cat:"Lower Push", note:"Quads, glutes — heavy loading without barbell" },
  { id:"walking_lunge",  label:"Walking Lunges",              icon:"🚶", met:5.0, cat:"Lower Push", note:"Quads, glutes, balance, hip mobility" },
  { id:"reverse_lunge",  label:"Reverse Lunge",               icon:"🚶", met:4.5, cat:"Lower Push", note:"Quads, glutes — easier on knees than forward" },
  { id:"bulgarian_ss",   label:"Bulgarian Split Squat",       icon:"🚶", met:5.0, cat:"Lower Push", note:"Quads, glutes — unilateral strength + balance" },
  { id:"step_up",        label:"Step-Ups",                    icon:"🪜", met:4.5, cat:"Lower Push", note:"Quads, glutes — functional unilateral" },
  { id:"leg_ext",        label:"Leg Extension Machine",       icon:"🦵", met:3.5, cat:"Lower Push", note:"Quad isolation" },
  { id:"smith_squat",    label:"Smith Machine Squat",         icon:"🏋️", met:5.0, cat:"Lower Push", note:"Quads, glutes — guided bar path" },
  { id:"sissy_squat",    label:"Sissy Squat",                 icon:"🦵", met:4.0, cat:"Lower Push", note:"Quad isolation — deep knee flexion" },
  { id:"calf_raise",     label:"Calf Raise (Standing/Seated)",icon:"🦶", met:3.5, cat:"Lower Push", note:"Gastrocnemius, soleus" },
  // ── LOWER PULL ──
  { id:"bb_deadlift",    label:"Barbell Deadlift",            icon:"🏋️", met:6.0, cat:"Lower Pull", note:"Full posterior chain — glutes, hamstrings, back, traps" },
  { id:"db_deadlift",    label:"Dumbbell Deadlift",           icon:"🏋️", met:5.5, cat:"Lower Pull", note:"Posterior chain — more ROM than barbell" },
  { id:"bb_rdl",         label:"Barbell Romanian Deadlift",   icon:"🦵", met:5.5, cat:"Lower Pull", note:"Hamstrings, glutes, lower back" },
  { id:"db_rdl",         label:"Dumbbell Romanian Deadlift",  icon:"🦵", met:5.5, cat:"Lower Pull", note:"Hamstrings, glutes — unilateral option" },
  { id:"single_leg_rdl", label:"Single-Leg RDL",              icon:"🦵", met:5.0, cat:"Lower Pull", note:"Hamstrings, glutes, balance — anti-rotation" },
  { id:"hip_thrust",     label:"Barbell Hip Thrust",          icon:"🍑", met:4.5, cat:"Lower Pull", note:"Glutes — peak contraction at top" },
  { id:"glute_bridge",   label:"Glute Bridge",                icon:"🍑", met:3.5, cat:"Lower Pull", note:"Glutes, hamstrings — floor-based" },
  { id:"prone_leg_curl", label:"Prone Leg Curl Machine",      icon:"🦵", met:3.5, cat:"Lower Pull", note:"Hamstrings isolation — machine based" },
  { id:"seated_leg_curl",label:"Seated Leg Curl Machine",     icon:"🦵", met:3.5, cat:"Lower Pull", note:"Hamstrings isolation — seated variation" },
  { id:"kb_swing",       label:"Kettlebell Swing",            icon:"🔔", met:8.0, cat:"Lower Pull", note:"Glutes, hamstrings, core — explosive hip hinge" },
  { id:"good_morning",   label:"Good Morning",                icon:"🏋️", met:5.0, cat:"Lower Pull", note:"Hamstrings, glutes, lower back — hinge pattern" },
  { id:"nordic_curl",    label:"Nordic Hamstring Curl",       icon:"🦵", met:5.0, cat:"Lower Pull", note:"Hamstrings eccentric — injury prevention" },
  { id:"cable_pull_thru",label:"Cable Pull-Through",          icon:"🔄", met:4.5, cat:"Lower Pull", note:"Glutes, hamstrings — cable hip hinge" },
  { id:"ghd_raise",      label:"Glute-Ham Raise (GHD)",       icon:"🦵", met:5.0, cat:"Lower Pull", note:"Hamstrings, glutes, lower back" },
  { id:"trap_bar_dl",    label:"Trap Bar Deadlift",           icon:"🏋️", met:6.0, cat:"Lower Pull", note:"Full body — hybrid squat/deadlift, easier on lower back" },
  // ── CORE ──
  { id:"plank",          label:"Plank / Plank Variations",    icon:"🧘", met:3.8, cat:"Core", note:"Deep core, TVA, anti-extension" },
  { id:"crunches",       label:"Crunches / Sit-Ups",          icon:"🔥", met:3.5, cat:"Core", note:"Rectus abdominis — upper abs emphasis" },
  { id:"hanging_leg_r",  label:"Hanging Leg Raises",          icon:"🔥", met:4.5, cat:"Core", note:"Lower abs, hip flexors — advanced" },
  { id:"dead_bug",       label:"Dead Bugs",                   icon:"🐛", met:3.0, cat:"Core", note:"Core stability, anti-extension — beginner-friendly" },
  { id:"cable_chop",     label:"Cable Woodchop",              icon:"🔄", met:4.0, cat:"Core", note:"Obliques, rotational power" },
  { id:"ab_wheel",       label:"Ab Wheel Rollout",            icon:"🔥", met:4.5, cat:"Core", note:"Full anterior core — anti-extension" },
  { id:"russian_twist",  label:"Russian Twist",               icon:"🔄", met:3.5, cat:"Core", note:"Obliques, rotational endurance" },
  { id:"pallof_press",   label:"Pallof Press",                icon:"🎯", met:3.5, cat:"Core", note:"Anti-rotation, obliques, deep core" },
  { id:"bird_dog",       label:"Bird Dog",                    icon:"🐛", met:3.0, cat:"Core", note:"Core stability, glutes — low-impact" },
  { id:"mountain_climb", label:"Mountain Climbers",           icon:"🏔️", met:7.0, cat:"Core", note:"Core + cardio — hip flexors, abs" },
  { id:"leg_raise_floor",label:"Lying Leg Raises",            icon:"🔥", met:3.5, cat:"Core", note:"Lower abs — floor-based" },
  { id:"side_plank",     label:"Side Plank",                  icon:"🧘", met:3.5, cat:"Core", note:"Obliques, QL — anti-lateral flexion" },
  // ── CARRY ──
  { id:"farmers_walk",   label:"Farmer's Walk (Dumbbells)",   icon:"🧳", met:6.0, cat:"Carry", note:"Grip, traps, core, full body stability" },
  { id:"single_oh_carry",label:"Single Arm DB Overhead Carry",icon:"🙌", met:5.5, cat:"Carry", note:"Shoulder stability, obliques, anti-lateral flexion" },
  { id:"bb_oh_carry",    label:"Overhead Barbell Carry",      icon:"🙌", met:5.5, cat:"Carry", note:"Shoulders, core stability, traps" },
  { id:"suitcase_carry", label:"Suitcase Carry",              icon:"🧳", met:5.5, cat:"Carry", note:"Obliques, grip — anti-lateral flexion" },
  { id:"trap_bar_carry", label:"Trap Bar Carry",              icon:"🏋️", met:6.5, cat:"Carry", note:"Full body, heavy load capacity" },
  { id:"waiter_carry",   label:"Waiter Carry (KB/DB)",        icon:"🙌", met:5.0, cat:"Carry", note:"Shoulder stability, core — bottoms-up option" },
  { id:"sandbag_carry",  label:"Sandbag / Bear Hug Carry",    icon:"🧳", met:7.0, cat:"Carry", note:"Full body, grip, anterior core — odd object" },
  // ── UPPER ACCESSORY (single-joint / isolation) ──
  { id:"db_curl",        label:"Dumbbell Curl",                icon:"💪", met:3.5, cat:"Upper Accessory", note:"Biceps — unilateral, full ROM" },
  { id:"cable_curl",     label:"Cable Curl",                   icon:"💪", met:3.5, cat:"Upper Accessory", note:"Biceps — constant cable tension" },
  { id:"ez_bar_curl",    label:"EZ Bar Curl",                  icon:"💪", met:3.5, cat:"Upper Accessory", note:"Biceps — easier on wrists than straight bar" },
  { id:"preacher_curl",  label:"Preacher Curl",                icon:"💪", met:3.5, cat:"Upper Accessory", note:"Biceps — eliminates momentum, strict isolation" },
  { id:"concentration_c",label:"Concentration Curl",           icon:"💪", met:3.0, cat:"Upper Accessory", note:"Biceps — peak contraction focus" },
  { id:"incline_db_curl",label:"Incline Dumbbell Curl",        icon:"💪", met:3.5, cat:"Upper Accessory", note:"Biceps long head — stretched position" },
  { id:"cable_hammer",   label:"Cable Rope Hammer Curl",       icon:"💪", met:3.5, cat:"Upper Accessory", note:"Brachialis, brachioradialis — neutral grip" },
  { id:"reverse_curl",   label:"Reverse Curl (EZ or DB)",      icon:"💪", met:3.5, cat:"Upper Accessory", note:"Forearms, brachioradialis" },
  { id:"db_skull_crush", label:"Dumbbell Skull Crusher",       icon:"💪", met:3.5, cat:"Upper Accessory", note:"Triceps — unilateral, deep stretch" },
  { id:"cable_kickback", label:"Cable Tricep Kickback",        icon:"💪", met:3.0, cat:"Upper Accessory", note:"Triceps — peak contraction at lockout" },
  { id:"rope_pushdown",  label:"Rope Tricep Pushdown",         icon:"💪", met:3.5, cat:"Upper Accessory", note:"Triceps — lateral head emphasis" },
  { id:"vbar_pushdown",  label:"V-Bar / Straight Bar Pushdown",icon:"💪", met:3.5, cat:"Upper Accessory", note:"Triceps — heavy isolation" },
  { id:"oh_cable_tri",   label:"Overhead Cable Tricep Ext",    icon:"💪", met:3.5, cat:"Upper Accessory", note:"Triceps long head — overhead stretch" },
  { id:"db_lateral_r",   label:"Dumbbell Lateral Raise",       icon:"🙆", met:3.5, cat:"Upper Accessory", note:"Lateral deltoid — isolation" },
  { id:"cable_lat_r",    label:"Cable Lateral Raise",          icon:"🙆", met:3.5, cat:"Upper Accessory", note:"Lateral delt — constant tension" },
  { id:"rear_delt_fly",  label:"Rear Delt Fly (DB or Cable)",  icon:"🎯", met:3.5, cat:"Upper Accessory", note:"Rear delts — posture and shoulder balance" },
  { id:"pec_deck",       label:"Pec Deck / Machine Fly",       icon:"💪", met:3.5, cat:"Upper Accessory", note:"Chest — isolation, constant tension" },
  { id:"shrugs",         label:"Barbell / DB Shrugs",          icon:"💪", met:3.5, cat:"Upper Accessory", note:"Upper traps — isolation" },
  { id:"wrist_curl",     label:"Wrist Curl / Reverse Wrist",   icon:"💪", met:2.5, cat:"Upper Accessory", note:"Forearm flexors/extensors — grip strength" },
  // ── LOWER ACCESSORY (single-joint / isolation) ──
  { id:"leg_ext_acc",    label:"Leg Extension Machine",        icon:"🦵", met:3.5, cat:"Lower Accessory", note:"Quad isolation — single joint" },
  { id:"seated_curl_acc",label:"Seated Leg Curl Machine",      icon:"🦵", met:3.5, cat:"Lower Accessory", note:"Hamstrings — seated position emphasizes lower hams" },
  { id:"prone_curl_acc", label:"Prone Leg Curl Machine",       icon:"🦵", met:3.5, cat:"Lower Accessory", note:"Hamstrings — lying face down, full ROM" },
  { id:"standing_curl",  label:"Standing Single-Leg Curl",     icon:"🦵", met:3.5, cat:"Lower Accessory", note:"Hamstrings — unilateral machine curl" },
  { id:"calf_raise_acc", label:"Standing Calf Raise",          icon:"🦶", met:3.5, cat:"Lower Accessory", note:"Gastrocnemius — standing emphasis" },
  { id:"seated_calf",    label:"Seated Calf Raise",            icon:"🦶", met:3.0, cat:"Lower Accessory", note:"Soleus — seated position targets deeper calf" },
  { id:"hip_adduction",  label:"Hip Adduction Machine",        icon:"🦵", met:3.0, cat:"Lower Accessory", note:"Inner thigh — adductors" },
  { id:"hip_abduction",  label:"Hip Abduction Machine",        icon:"🦵", met:3.0, cat:"Lower Accessory", note:"Outer glute / glute medius — hip stability" },
  { id:"leg_press_calf", label:"Calf Press on Leg Press",      icon:"🦶", met:3.5, cat:"Lower Accessory", note:"Calves — heavy loading on leg press machine" },
  { id:"cable_glute_kb", label:"Cable Glute Kickback",         icon:"🍑", met:3.5, cat:"Lower Accessory", note:"Glutes — isolation, cable or machine" },
  { id:"db_calf_raise",  label:"Single-Leg DB Calf Raise",     icon:"🦶", met:3.5, cat:"Lower Accessory", note:"Calves — unilateral, balance + hypertrophy" },
  { id:"tibialis_raise", label:"Tibialis Raise (Tib Bar)",     icon:"🦵", met:2.5, cat:"Lower Accessory", note:"Tibialis anterior — shin strength, injury prevention" },
  // ── TOTAL BODY ──
  { id:"functional",     label:"Total Body — Functional",     icon:"🔄", met:7.0, cat:"Total Body", note:"Mixed movements, balance, mobility, real-world strength" },
  { id:"strength_slow",  label:"Total Body — Strength",       icon:"🏋️", met:5.0, cat:"Total Body", note:"Slow & controlled, heavy loads, long rest, form-focused" },
  { id:"conditioning",   label:"Total Body — Conditioning",   icon:"⚡", met:9.0, cat:"Total Body", note:"Strength + cardio hybrid, short rest, fast pace" },
  { id:"circuit",        label:"Circuit Training",            icon:"⚡", met:8.0, cat:"Total Body", note:"Full body, minimal rest between exercises" },
  { id:"supersets",      label:"Supersets / Giant Sets",      icon:"🔥", met:7.0, cat:"Total Body", note:"High density, back-to-back exercises" },
  { id:"crossfit",       label:"CrossFit / Functional",       icon:"🏋️", met:9.0, cat:"Total Body", note:"Mixed modalities, high intensity" },
  { id:"kettlebell_flow",label:"Kettlebell Flow / Complex",   icon:"🔔", met:8.0, cat:"Total Body", note:"Swings, cleans, presses chained together" },
  { id:"bodyweight",     label:"Bodyweight Training",         icon:"🤸", met:4.0, cat:"Total Body", note:"Calisthenics — push-ups, squats, burpees" },
];

const STRENGTH_GROUPS = [
  "Horizontal Push",
  "Horizontal Pull",
  "Vertical Push",
  "Vertical Pull",
  "Lower Push",
  "Lower Pull",
  "Upper Accessory",
  "Lower Accessory",
  "Carry",
  "Core",
  "Total Body",
];

const ST_DURATIONS = [20,30,45,60,75,90];
const defaultStrength = Object.fromEntries(DAYS.map(d=>[d,[]]));
const REST_ST = { id:"rest_st", label:"Rest Day", icon:"😴", met:0 };

function calcStrengthBurn(met, weightLbs, minutes) {
  if (!met || !minutes) return 0;
  return Math.round(met * weightLbs * 0.453592 * (minutes / 60));
}

// ── Custom-exercise support ─────────────────────────────────────────────────
// A plan can carry user-created exercises in data.customExercises (shape from
// CustomExerciseCreator: { id:"custom_…", label, icon:"⭐", calPerMin, cat,
// isCustom:true, type:"cardio"|"strength" }). These helpers fold them into the
// catalog lookups + burn math so a custom id renders its label and computes burn
// everywhere (wizard, Results, dashboards), not just where it was created.
// Custom exercises burn by their user calPerMin estimate (met is 0 for them).
function customOf(customExercises, type) {
  return (Array.isArray(customExercises) ? customExercises : []).filter(e => e && e.type === type);
}
// Resolve a cardio/strength id to its definition (standard OR the plan's custom),
// falling back to the catalog's rest/last entry for an unknown id.
function findCardioEx(id, customExercises) {
  return ALL_CARDIO.find(c => c.id === id)
    || customOf(customExercises, "cardio").find(e => e.id === id)
    || ALL_CARDIO[ALL_CARDIO.length - 1];
}
function findStrengthEx(id, customExercises) {
  return [REST_ST, ...STRENGTH_EXERCISES].find(e => e.id === id)
    || customOf(customExercises, "strength").find(e => e.id === id)
    || REST_ST;
}
// Burn for any resolved exercise — custom uses calPerMin × minutes; standard uses MET.
function exBurn(ex, weightLbs, minutes) {
  if (!ex || !minutes) return 0;
  if (ex.calPerMin) return Math.round(Number(ex.calPerMin) * minutes);
  return Math.round((Number(ex.met) || 0) * weightLbs * 0.453592 * (minutes / 60));
}
// Dropdown <optgroup> of the plan's custom exercises of a type (or nothing).
function CustomOptGroup({ customExercises, type }) {
  const custom = customOf(customExercises, type);
  if (!custom.length) return null;
  return (
    <optgroup label="⭐ Custom">
      {custom.map((e) => <option key={e.id} value={e.id}>{e.icon || "⭐"} {e.label}</option>)}
    </optgroup>
  );
}

// ─── StepStrength ─────────────────────────────────────────────────────────────

function StepStrength({ data, onChange, onBack, onNext }) {
  const [openDay, setOpenDay]         = useState(null);
  const [showFill, setShowFill]       = useState(false);
  const [fillType, setFillType]       = useState("bb_squat");
  const [fillDuration, setFillDuration] = useState(60);
  const [fillDays, setFillDays]       = useState([]);
  const [showCombos, setShowCombos]   = useState(false);
  const [comboChoice, setComboChoice] = useState("push_pull_upper");
  const [comboDays, setComboDays]     = useState([]);

  const COMBOS = [
    { id:"push_pull_upper", label:"H-Push + H-Pull (Upper)", patterns:["Horizontal Push","Horizontal Pull"], desc:"Classic push/pull upper body — bench + rows. Great for chest & back days." },
    { id:"vert_push_pull",  label:"V-Push + V-Pull (Upper)", patterns:["Vertical Push","Vertical Pull"], desc:"Overhead press + pull-ups/pulldowns. Shoulders & lats focus." },
    { id:"upper_push_lower_pull", label:"H-Push + Lower Pull", patterns:["Horizontal Push","Lower Pull"], desc:"Bench press + deadlift. Upper push paired with posterior chain." },
    { id:"upper_pull_lower_push", label:"H-Pull + Lower Push", patterns:["Horizontal Pull","Lower Push"], desc:"Rows + squats. Back work paired with quad-dominant legs." },
    { id:"vert_pull_lower_push",  label:"V-Pull + Lower Push", patterns:["Vertical Pull","Lower Push"], desc:"Pull-ups + squats. Vertical pull paired with lower body push." },
    { id:"vert_push_lower_pull",  label:"V-Push + Lower Pull", patterns:["Vertical Push","Lower Pull"], desc:"Overhead press + deadlifts. Shoulders + posterior chain." },
    { id:"full_push",      label:"All Push (H+V+Lower)", patterns:["Horizontal Push","Vertical Push","Lower Push"], desc:"Full push day — chest, shoulders, quads. Classic PPL split." },
    { id:"full_pull",      label:"All Pull (H+V+Lower)", patterns:["Horizontal Pull","Vertical Pull","Lower Pull"], desc:"Full pull day — back, biceps, hamstrings. Classic PPL split." },
    { id:"lower_full",     label:"Lower Push + Lower Pull", patterns:["Lower Push","Lower Pull"], desc:"Full leg day — squats + deadlifts/curls. Quad & hamstring balance." },
    { id:"push_pull_core", label:"H-Push + H-Pull + Core", patterns:["Horizontal Push","Horizontal Pull","Core"], desc:"Upper body push/pull with core finisher." },
    { id:"lower_carry_core",label:"Lower Push + Carry + Core", patterns:["Lower Push","Carry","Core"], desc:"Legs, loaded carries, and core — functional strength day." },
    { id:"full_body",      label:"Full Body (Push+Pull+Lower)", patterns:["Horizontal Push","Horizontal Pull","Lower Push","Lower Pull"], desc:"Complete full body session hitting all major patterns." },
  ];

  const getSessions = (day) => {
    const s = data.strength[day];
    return Array.isArray(s) ? s : (s && s.type && s.type !== "rest_st") ? [s] : [];
  };
  const setSessions = (day, sessions) =>
    onChange("strength", { ...data.strength, [day]: sessions });

  const updSession = (day, idx, field, val) => {
    const s = [...getSessions(day)];
    s[idx] = { ...s[idx], [field]: val };
    setSessions(day, s);
  };
  const addSession = (day) => setSessions(day, [...getSessions(day), { type:"bb_squat", duration:60 }]);
  const removeSession = (day, idx) => {
    const s = getSessions(day).filter((_,i)=>i!==idx);
    setSessions(day, s);
  };

  const toggleFillDay = (day) =>
    setFillDays(prev => prev.includes(day) ? prev.filter(d=>d!==day) : [...prev, day]);

  const applyFill = () => {
    if (!fillDays.length) return;
    const updated = { ...data.strength };
    fillDays.forEach(day => { updated[day] = [{ type: fillType, duration: fillDuration }]; });
    onChange("strength", updated);
    setFillDays([]);
    setShowFill(false);
  };

  const allExercises = [REST_ST, ...STRENGTH_EXERCISES, ...customOf(data.customExercises, "strength")];
  const getEx = id => allExercises.find(e=>e.id===id) || REST_ST;

  return (
    <div data-theme="pro" className="fu text-fg">
      <div className={WZ.card}>
        <div className={WZ.title}>💪 Strength Training Plan</div>
        <div className={WZ.sub}>
          Assign strength workouts to each day. You can add multiple sessions per day.
          Calorie burn is estimated using MET values from the
          <em> 2011 Compendium of Physical Activities</em> (Ainsworth et al., MSSE).
        </div>

        {/* Quick Fill */}
        <button className={WZW.toggle} onClick={()=>setShowFill(v=>!v)}>
          ⚡ Quick Fill — Apply one exercise to multiple days {showFill?"▲":"▼"}
        </button>
        {showFill && (
          <div className={WZW.panel}>
            <div className="mb-4">
              <label className={WZ.label}>Exercise</label>
              <select className={WZW.select} value={fillType} onChange={e=>setFillType(e.target.value)}>
                {STRENGTH_GROUPS.map(cat=>(
                  <optgroup key={cat} label={cat}>
                    {STRENGTH_EXERCISES.filter(e=>e.cat===cat).map(e=>(
                      <option key={e.id} value={e.id}>{e.icon} {e.label}</option>
                    ))}
                  </optgroup>
                ))}
                <CustomOptGroup customExercises={data.customExercises} type="strength" />
              </select>
            </div>
            <div className="mb-4">
              <label className={WZ.label}>Duration</label>
              <select className={WZW.select} value={fillDuration} onChange={e=>setFillDuration(Number(e.target.value))}>
                {ST_DURATIONS.map(m=><option key={m} value={m}>{m} minutes</option>)}
              </select>
            </div>
            <div className="mb-4">
              <label className={WZ.label}>Apply to days</label>
              <div className="grid grid-cols-7 gap-1.5">
                {DAYS.map((day,i)=>(
                  <button key={day} className={wzFillDay(fillDays.includes(day))} onClick={()=>toggleFillDay(day)}>
                    {DAY_SHORT[i]}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex gap-2 mt-1">
              <button className={`${WZW.primaryBtn} flex-1`} disabled={!fillDays.length} onClick={applyFill}>
                Apply to {fillDays.length||"0"} day{fillDays.length!==1?"s":""}
              </button>
            </div>
            <div className="flex gap-1.5 mt-2 flex-wrap">
              <span className="text-[.72rem] text-muted self-center">Presets:</span>
              {[
                {label:"MWF", days:["Monday","Wednesday","Friday"]},
                {label:"M–F", days:["Monday","Tuesday","Wednesday","Thursday","Friday"]},
                {label:"All 7",days:DAYS},
              ].map(p=>(
                <button key={p.label} className={wzPreset} onClick={()=>setFillDays(p.days)}>{p.label}</button>
              ))}
            </div>
          </div>
        )}

        {/* Movement Pattern Combos */}
        <button className="w-full text-left px-3.5 py-3 rounded-lg border border-[rgba(47,224,168,.3)] bg-[rgba(47,224,168,.05)] text-success text-sm font-semibold cursor-pointer mb-2.5" onClick={()=>setShowCombos(v=>!v)}>
          🔀 Movement Combos — Pair patterns for a training day {showCombos?"▲":"▼"}
        </button>
        {showCombos && (
          <div className={WZW.panel}>
            <p className="text-[.78rem] text-muted mb-3 leading-relaxed">
              Pick a combo and assign it to days. Each pattern adds one exercise to that day.
            </p>
            <div className="mb-4">
              <label className={WZ.label}>Select a combo</label>
              <select className={WZW.select} value={comboChoice} onChange={e=>setComboChoice(e.target.value)}>
                {COMBOS.map(c=><option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            </div>
            <div className="text-[.76rem] text-muted mb-2 leading-relaxed">
              {COMBOS.find(c=>c.id===comboChoice)?.desc}
            </div>
            <div className="mb-4">
              <label className={WZ.label}>Apply to days</label>
              <div className="grid grid-cols-7 gap-1.5">
                {DAYS.map((day,i)=>(
                  <button key={day} className={wzFillDay(comboDays.includes(day))}
                    onClick={()=>setComboDays(prev=>prev.includes(day)?prev.filter(d=>d!==day):[...prev,day])}>
                    {DAY_SHORT[i]}
                  </button>
                ))}
              </div>
            </div>
            <button className={`${WZW.primaryBtn} w-full`}
              disabled={!comboDays.length}
              onClick={()=>{
                const combo = COMBOS.find(c=>c.id===comboChoice);
                if(!combo||!comboDays.length) return;
                const newStrength = {...data.strength};
                comboDays.forEach(day=>{
                  newStrength[day] = combo.patterns.map(catName=>{
                    const ex = STRENGTH_EXERCISES.find(e=>e.cat===catName);
                    return ex ? {type:ex.id, duration:45} : null;
                  }).filter(Boolean);
                });
                onChange("strength", newStrength);
                setComboDays([]);
                setShowCombos(false);
              }}>
              Apply {COMBOS.find(c=>c.id===comboChoice)?.label} to {comboDays.length} day{comboDays.length!==1?"s":""}
            </button>
          </div>
        )}

        {/* Day cards */}
        {DAYS.map((day,i)=>{
          const sessions = getSessions(day);
          const isRest = sessions.length === 0;
          const totalBurned = sessions.reduce((s,sess)=>{
            const ex = getEx(sess.type);
            return s + exBurn(ex, Number(data.weightLbs), sess.duration);
          }, 0);
          const isOpen = openDay === day;
          return (
            <div className={WZW.dayCard} key={day}>
              <div className={WZW.dayHeader} onClick={()=>setOpenDay(isOpen?null:day)}>
                <div className={WZW.dayChip}>{DAY_SHORT[i]}</div>
                <div className={`text-[.88rem] ${isRest?"text-muted":"text-fg font-semibold"}`}>
                  {isRest ? "😴 Rest Day" : sessions.length === 1
                    ? `${getEx(sessions[0].type).icon} ${getEx(sessions[0].type).label} · ${sessions[0].duration}m`
                    : `${sessions.length} sessions`
                  }
                </div>
                <div className={WZW.dayBurn}>{totalBurned>0?`~${totalBurned} cal`:""}</div>
                <div className={`text-muted text-xs transition-transform ${isOpen?"rotate-0":"-rotate-90"}`}>▼</div>
              </div>
              {isOpen && (
                <div className={WZW.dayBody}>
                  {sessions.map((sess, idx) => {
                    const ex = getEx(sess.type);
                    const burn = exBurn(ex, Number(data.weightLbs), sess.duration);
                    return (
                      <div key={idx} className="py-2.5" style={{borderBottom:idx<sessions.length-1?"1px solid var(--color-border)":"none"}}>
                        {sessions.length > 1 && (
                          <div className="flex justify-between items-center mb-2">
                            <span className="text-[.72rem] text-muted font-bold tracking-wide uppercase">Session {idx+1}</span>
                            <button className="bg-transparent border-none text-danger cursor-pointer text-[.78rem] px-1.5" onClick={()=>removeSession(day,idx)}>✕ Remove</button>
                          </div>
                        )}
                        <div className="mb-4">
                          <label className={WZ.label}>Exercise <span className={WZ.hint}>type to search or browse below</span></label>
                          <SearchableSelect
                            exercises={[...STRENGTH_EXERCISES, ...customOf(data.customExercises, "strength")]}
                            groups={STRENGTH_GROUPS}
                            value={sess.type}
                            onChange={val=>updSession(day,idx,"type",val)}
                            placeholder="Search exercises... (e.g. squat, curl, press)"
                          />
                          <select className={WZW.select} value={sess.type} onChange={e=>updSession(day,idx,"type",e.target.value)}>
                            {STRENGTH_GROUPS.map(cat=>(
                              <optgroup key={cat} label={cat}>
                                {STRENGTH_EXERCISES.filter(e=>e.cat===cat).map(e=>(
                                  <option key={e.id} value={e.id}>{e.icon} {e.label}</option>
                                ))}
                              </optgroup>
                            ))}
                            <CustomOptGroup customExercises={data.customExercises} type="strength" />
                          </select>
                        </div>
                        <div className="mb-4">
                          <label className={WZ.label}>Duration</label>
                          <select className={WZW.select} value={sess.duration} onChange={e=>updSession(day,idx,"duration",Number(e.target.value))}>
                            {ST_DURATIONS.map(m=><option key={m} value={m}>{m} minutes</option>)}
                          </select>
                        </div>
                        {ex.note && <div className="text-[.75rem] text-muted py-1">🎯 Muscles: {ex.note}</div>}
                        {burn > 0 && <div className="text-[.78rem] text-warn font-semibold">~{burn} cal</div>}
                      </div>
                    );
                  })}
                  <button className={`${WZW.toggle} mt-2.5 mb-1.5`} onClick={()=>addSession(day)}>
                    + Add Another Session
                  </button>
                  {sessions.length > 0 && (
                    <button className={WZW.clearDay} onClick={()=>{ setSessions(day,[]); setOpenDay(null); }}>
                      Set as Rest Day
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <CustomExerciseCreator exerciseType="strength" onAdd={(ex)=>onChange("customExercises",[...(data.customExercises||[]),ex])} />

      {DAYS.every(day => getSessions(day).length === 0) && (
        <div className={WZW.warn}>💡 All 7 days are set to rest — no worries! Your results will still work. Adding even 1–2 strength days will unlock muscle gain projections and EPOC afterburn data.</div>
      )}
      <div className="text-[.6rem] text-muted text-center my-2 italic">⚠️ Calorie burn estimates use MET values — actual burn varies by intensity, form, and individual metabolism.</div>
      <BottomNav onBack={onBack} onNext={onNext} nextLabel="See Results →"/>
    </div>
  );
}


// ─── Step 4: Cardio (continued) ──────────────────────────────────────────────

function StepCardio({ data, onChange, onBack, onNext }) {
  const [openDay, setOpenDay]           = useState(null);
  const [showFill, setShowFill]         = useState(false);
  const [fillType, setFillType]         = useState("outdoor_jog");
  const [fillDuration, setFillDuration] = useState(30);
  const [fillDays, setFillDays]         = useState([]);

  const addWorkout = (day) => {
    const curr = data.cardio[day] || [];
    onChange("cardio", {...data.cardio, [day]: [...curr, {type:"outdoor_jog", duration:30}]});
  };
  const updateWorkout = (day, idx, field, val) => {
    const curr = [...(data.cardio[day] || [])];
    curr[idx] = {...curr[idx], [field]: val};
    onChange("cardio", {...data.cardio, [day]: curr});
  };
  const removeWorkout = (day, idx) => {
    const curr = (data.cardio[day] || []).filter((_, i) => i !== idx);
    onChange("cardio", {...data.cardio, [day]: curr});
  };

  const toggleFillDay = (day) => setFillDays(prev => prev.includes(day) ? prev.filter(d=>d!==day) : [...prev, day]);

  const applyFill = () => {
    if (!fillDays.length) return;
    const updated = { ...data.cardio };
    fillDays.forEach(day => { updated[day] = [{type: fillType, duration: fillDuration}]; });
    onChange("cardio", updated);
    setFillDays([]);
    setShowFill(false);
  };

  const fillCardioObj = ALL_CARDIO.find(c=>c.id===fillType)||ALL_CARDIO[0];

  return (
    <div data-theme="pro" className="fu text-fg">
      <div className={WZ.card}>
        <div className={WZ.title}>Weekly Cardio Plan</div>
        <div className={WZ.sub}>Tap a day to set your cardio. Calories estimated from your weight in real time.</div>

        {/* ── Quick Fill ── */}
        <button className={WZW.toggle} onClick={()=>setShowFill(v=>!v)}>
          ⚡ Quick Fill — Apply one exercise to multiple days {showFill?"▲":"▼"}
        </button>

        {showFill && (
          <div className={WZW.panel}>
            <div className="mb-4">
              <label className={WZ.label}>Exercise to apply</label>
              <select className={WZW.select} value={fillType} onChange={e=>setFillType(e.target.value)}>
                {CARDIO_GROUPS.filter(g=>g.group!=="😴 Rest").map(grp=>(
                  <optgroup key={grp.group} label={grp.group}>
                    {grp.options.map(c=><option key={c.id} value={c.id}>{c.icon} {c.label}</option>)}
                  </optgroup>
                ))}
                <CustomOptGroup customExercises={data.customExercises} type="cardio" />
              </select>
            </div>
            <div className="mb-4">
              <label className={WZ.label}>Duration</label>
              <select className={WZW.select} value={fillDuration} onChange={e=>setFillDuration(Number(e.target.value))}>
                {DURATIONS.map(m=><option key={m} value={m}>{m} minutes</option>)}
              </select>
            </div>
            <div className="mb-4">
              <label className={WZ.label}>Apply to these days</label>
              <div className="grid grid-cols-7 gap-1.5">
                {DAYS.map((day,i)=>(
                  <button key={day} className={wzFillDay(fillDays.includes(day))} onClick={()=>toggleFillDay(day)}>{DAY_SHORT[i]}</button>
                ))}
              </div>
            </div>
            <div className="flex gap-2 mt-1">
              <button className={`${WZW.primaryBtn} flex-1`} disabled={!fillDays.length} onClick={applyFill}>
                Apply to {fillDays.length||"0"} day{fillDays.length!==1?"s":""}
              </button>
              <button className={WZW.ghostBtn} onClick={()=>{ setFillDays(DAYS.slice(0,5)); }}>MWF→Fri</button>
            </div>
            {/* Quick presets */}
            <div className="flex gap-1.5 mt-2 flex-wrap">
              <span className="text-[.72rem] text-muted self-center">Presets:</span>
              {[
                {label:"MWF",  days:["Monday","Wednesday","Friday"]},
                {label:"M–F",  days:["Monday","Tuesday","Wednesday","Thursday","Friday"]},
                {label:"All 7",days:DAYS},
              ].map(p=>(
                <button key={p.label} className={wzPreset} onClick={()=>setFillDays(p.days)}>{p.label}</button>
              ))}
            </div>
          </div>
        )}

        {/* ── Day cards ── */}
        {DAYS.map((day,i)=>{
          const sessions = Array.isArray(data.cardio[day]) ? data.cardio[day] : [];
          const isRest = sessions.length === 0;
          const totalBurned = sessions.reduce((s,sess)=>{
            const co = findCardioEx(sess.type, data.customExercises);
            return s + exBurn(co, Number(data.weightLbs), sess.duration);
          }, 0);
          const isOpen = openDay===day;
          return (
            <div className={WZW.dayCard} key={day}>
              <div className={WZW.dayHeader} onClick={()=>setOpenDay(isOpen?null:day)}>
                <div className={WZW.dayChip}>{DAY_SHORT[i]}</div>
                <div className={`text-[.88rem] ${isRest?"text-muted":"text-fg font-semibold"}`}>
                  {isRest ? "😴 Rest Day" : sessions.length === 1
                    ? `${(findCardioEx(sessions[0].type, data.customExercises)||{icon:"🏃"}).icon} ${(findCardioEx(sessions[0].type, data.customExercises)||{label:"Cardio"}).label} · ${sessions[0].duration}m`
                    : `${sessions.length} sessions`
                  }
                </div>
                <div className={WZW.dayBurn}>{totalBurned>0?`~${totalBurned} cal`:""}</div>
                <div className={`text-muted text-xs transition-transform ${isOpen?"rotate-0":"-rotate-90"}`}>▼</div>
              </div>
              {isOpen && (
                <div className={WZW.dayBody}>
                  {sessions.map((sess, idx) => {
                    const co = findCardioEx(sess.type, data.customExercises);
                    const burn = exBurn(co, Number(data.weightLbs), sess.duration);
                    return (
                      <div key={idx} className="py-2.5" style={{borderBottom:idx<sessions.length-1?"1px solid var(--color-border)":"none"}}>
                        {sessions.length > 1 && (
                          <div className="flex justify-between items-center mb-2">
                            <span className="text-[.72rem] text-muted font-bold tracking-wide uppercase">Session {idx+1}</span>
                            <button className="bg-transparent border-none text-danger cursor-pointer text-[.78rem] px-1.5" onClick={()=>removeWorkout(day,idx)}>✕ Remove</button>
                          </div>
                        )}
                        <div className="mb-4">
                          <label className={WZ.label}>Exercise <span className={WZ.hint}>type to search or browse below</span></label>
                          <SearchableSelect
                            exercises={[...ALL_CARDIO, ...customOf(data.customExercises, "cardio")]}
                            groups={CARDIO_GROUPS.map(g=>g.group)}
                            value={sess.type}
                            onChange={val=>updateWorkout(day,idx,"type",val)}
                            placeholder="Search cardio... (e.g. treadmill, bike, swim)"
                          />
                          <select className={WZW.select} value={sess.type} onChange={e=>updateWorkout(day,idx,"type",e.target.value)}>
                            {CARDIO_GROUPS.map(grp=>(
                              <optgroup key={grp.group} label={grp.group}>
                                {grp.options.map(c=><option key={c.id} value={c.id}>{c.icon} {c.label}</option>)}
                              </optgroup>
                            ))}
                            <CustomOptGroup customExercises={data.customExercises} type="cardio" />
                          </select>
                        </div>
                        {sess.type!=="rest" && (
                          <div className="mb-4">
                            <label className={WZ.label}>Duration</label>
                            <select className={WZW.select} value={sess.duration} onChange={e=>updateWorkout(day,idx,"duration",Number(e.target.value))}>
                              {DURATIONS.map(m=><option key={m} value={m}>{m} minutes</option>)}
                            </select>
                          </div>
                        )}
                        {burn > 0 && <div className="text-[.78rem] text-warn font-semibold">~{burn} cal</div>}
                      </div>
                    );
                  })}
                  <button className={`${WZW.toggle} mt-2.5 mb-1.5`} onClick={()=>addWorkout(day)}>
                    + Add {sessions.length > 0 ? "Another" : "a"} Session
                  </button>
                  {sessions.length > 0 && (
                    <button className={WZW.clearDay}
                      onClick={()=>{ onChange("cardio",{...data.cardio,[day]:[]}); setOpenDay(null); }}>
                      Set as Rest Day
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <CustomExerciseCreator exerciseType="cardio" onAdd={(ex)=>onChange("customExercises",[...(data.customExercises||[]),ex])} />

      {DAYS.every(day => !Array.isArray(data.cardio[day]) || data.cardio[day].length === 0) && (
        <div className={WZW.warn}>💡 All 7 days are set to rest — that's totally fine! Your results will still calculate based on diet alone. But if you'd like to add even one cardio session, it'll speed things up.</div>
      )}
      <div className="text-[.6rem] text-muted text-center my-2 italic">⚠️ Cardio calorie estimates are approximations — actual burn depends on effort, body composition, and conditions.</div>
      <BottomNav onBack={onBack} onNext={onNext} nextLabel="Next — Strength →"/>
    </div>
  );
}

// ─── Simulation results summary (Session 20) ─────────────────────────────────
// A sales/motivation-framed before→after card shown at the top of a SIMULATION's
// Results. Reuses the same projection math as the Timeline tab (weeksToGoal /
// friendlyTime) — diet alone, and diet + the plan's weekly cardio burn.
function SimulationSummary({ data, totalBurn }) {
  const current = Number(data.weightLbs) || 0;
  const goal = Number(data.goalWeight) || 0;
  if (!current || !goal || current === goal) return null;
  const losing = goal < current;
  const diff = Math.round(Math.abs(current - goal) * 10) / 10;
  const wksDiet = losing ? weeksToGoal(diff, 3500) : null;
  const wksCardio = losing && totalBurn > 0 ? weeksToGoal(diff, 3500 + totalBurn) : null;
  const bestWks = wksCardio || wksDiet;
  const targetDate = bestWks
    ? new Date(Date.now() + bestWks * 7 * 86400000).toLocaleDateString(undefined, { month: "long", year: "numeric" })
    : null;
  const stat = { flex: 1, textAlign: "center" };
  const big = { fontFamily: "'Sora',sans-serif", fontSize: "2.4rem", lineHeight: 1 };
  const lbl = { fontSize: ".66rem", letterSpacing: ".5px", textTransform: "uppercase", color: "var(--muted)", marginTop: 4 };
  return (
    <div className="card" style={{ border: "1px solid rgba(181,123,255,.45)", background: "linear-gradient(180deg,rgba(181,123,255,.1),transparent)" }}>
      <div style={{ fontSize: ".7rem", letterSpacing: "1.5px", textTransform: "uppercase", color: "var(--purple)", textAlign: "center", marginBottom: 10 }}>
        🧪 Simulated Results · what's possible
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10 }}>
        <div style={stat}><div style={{ ...big, color: "var(--text)" }}>{current}</div><div style={lbl}>lbs today</div></div>
        <div style={{ fontSize: "1.6rem", color: "var(--purple)" }}>→</div>
        <div style={stat}><div style={{ ...big, color: "var(--accent)" }}>{goal}</div><div style={lbl}>lbs goal</div></div>
      </div>
      <div style={{ textAlign: "center", marginTop: 12, fontSize: "1.05rem", fontWeight: 700, color: "var(--text)" }}>
        {losing ? `Lose ${diff} lbs` : `Gain ${diff} lbs`}
        {bestWks ? <span style={{ color: "var(--green)" }}> in {friendlyTime(bestWks)}</span> : null}
      </div>
      {targetDate && (
        <div style={{ textAlign: "center", marginTop: 4, fontSize: ".82rem", color: "var(--muted-light)" }}>
          On track to hit goal by <strong style={{ color: "var(--text)" }}>{targetDate}</strong>
          {wksCardio && wksDiet && wksCardio < wksDiet
            ? ` — ${friendlyTime(wksDiet - wksCardio)} faster with the cardio in this plan`
            : ""}
        </div>
      )}
      <div style={{ textAlign: "center", marginTop: 10, fontSize: ".72rem", color: "var(--muted)" }}>
        Projection assumes consistent adherence — actual results vary.
      </div>
    </div>
  );
}

// ─── Results ─────────────────────────────────────────────────────────────────

function Results({ data, isSimulation, onReset, onEdit, onUpdateCardio, onUpdateStrength, onSaveCheckIn, onDeleteCheckIn, onUpdateNotes }) {
  const [tab, setTab] = useState(0);
  const [viewMode, setViewMode] = useState("pro"); // "basic" or "pro"
  const [showEdit, setShowEdit] = useState(false);
  const [showNotes, setShowNotes] = useState(false);
  const [openResultDay, setOpenResultDay] = useState(null);
  const [showWeightModal, setShowWeightModal] = useState(false); // Pro Tracking chart popup
  const { gender, age, weightLbs, heightFt, heightIn, activityLevel, firstName, cardio } = data;
  // Fall back to the first activity level when a plan is incomplete (no activity
  // set yet) so Results never crashes on a half-built plan. Matches the guarded
  // lookups elsewhere (computeClientCalories, App's computedTdee).
  const actObj = ACTIVITY_LEVELS.find(a=>a.id===activityLevel) || ACTIVITY_LEVELS[0];
  const bmr    = calcBMR(gender, Number(weightLbs), Number(heightFt), Number(heightIn), Number(age));
  const tdee   = Math.round(bmr * actObj.multiplier);
  const floor  = n => Math.max(n, 1200);

  // ── Ideal Body Weight calculations ──
  const totalInches = Number(heightFt) * 12 + Number(heightIn);
  const heightM     = totalInches * 0.0254;
  const weightKg    = Number(weightLbs) * 0.453592;

  // Current BMI
  const bmi = weightKg / (heightM * heightM);

  // BMI healthy range → weight range (18.5–24.9)
  const ibwLowKg  = 18.5 * heightM * heightM;
  const ibwHighKg = 24.9 * heightM * heightM;
  const ibwLowLbs  = Math.round(ibwLowKg  / 0.453592);
  const ibwHighLbs = Math.round(ibwHighKg / 0.453592);

  // Devine formula IBW (most widely used clinical standard)
  const inchesOver5ft = Math.max(0, totalInches - 60);
  const devineKg = gender === "male"
    ? 50   + 2.3 * inchesOver5ft
    : 45.5 + 2.3 * inchesOver5ft;
  const devineLbs = Math.round(devineKg / 0.453592);

  // Robinson formula IBW (alternate reference)
  const robinsonKg = gender === "male"
    ? 52   + 1.9 * inchesOver5ft
    : 49   + 1.7 * inchesOver5ft;
  const robinsonLbs = Math.round(robinsonKg / 0.453592);

  // BMI category
  const bmiCategory = bmi < 18.5 ? { label:"Underweight", cls:"c-yel" }
    : bmi < 25   ? { label:"Healthy Weight", cls:"c-grn" }
    : bmi < 30   ? { label:"Overweight",     cls:"c-yel" }
    : { label:"Obese", cls:"c-red" };

  // Where does goal weight land?
  const goalLbs     = Number(data.goalWeight) || null;
  const goalBmi     = goalLbs ? (goalLbs * 0.453592) / (heightM * heightM) : null;
  const goalInRange = goalBmi ? goalBmi >= 18.5 && goalBmi <= 24.9 : null;

  // Fill bar: position current weight within the IBW range (capped 0–100%)
  const barPct = Math.min(100, Math.max(0,
    ((Number(weightLbs) - ibwLowLbs) / (ibwHighLbs - ibwLowLbs + 1)) * 100 + 50
  ));
  // Simpler: show position relative to range
  const inRange = Number(weightLbs) >= ibwLowLbs && Number(weightLbs) <= ibwHighLbs;

  const targets = [
    { label:"Maintain", cut:0,    cls:"c-acc", goalLabel:"Maintain"    },
    { label:"½ lb/wk",  cut:250,  cls:"c-grn", goalLabel:"½ lb/week"  },
    { label:"1 lb/wk",  cut:500,  cls:"c-yel", goalLabel:"1 lb/week"  },
    { label:"2 lbs/wk", cut:1000, cls:"c-red", goalLabel:"2 lbs/week" },
  ];

  const dayData = DAYS.map(day=>{
    const sessions = Array.isArray(cardio[day]) ? cardio[day] : [];
    const sessionData = sessions.filter(s=>s.type!=="rest").map(s=>{
      const co = findCardioEx(s.type, data.customExercises);
      return { co, duration:s.duration, burned:exBurn(co, Number(weightLbs), s.duration), type:s.type };
    });
    const burned = sessionData.reduce((s,d)=>s+d.burned, 0);
    return { day, sessions:sessionData, burned, type:sessions.length>0?sessions[0].type:"rest",
      co:sessionData.length>0?sessionData[0].co:ALL_CARDIO[ALL_CARDIO.length-1], duration:sessions.length>0?sessions[0].duration:0 };
  });

  const totalBurn     = dayData.reduce((s,d)=>s+d.burned,0);
  const activeDays    = dayData.filter(d=>d.burned>0).length;
  const cardioFatLbs  = (totalBurn/3500).toFixed(2);
  const avgBurnPerDay = Math.round(totalBurn/7);
  const hasGoal       = data.goalWeight && Number(data.goalWeight) < Number(data.weightLbs);

  // ── Strength training data ──
  const allStrEx = [REST_ST, ...STRENGTH_EXERCISES, ...customOf(data.customExercises, "strength")];
  const strengthDayData = DAYS.map(day=>{
    const sessions = Array.isArray((data.strength||{})[day]) ? data.strength[day] : [];
    const sessionData = sessions.map(s=>{
      const ex = allStrEx.find(e=>e.id===s.type) || REST_ST;
      return { ex, duration:s.duration, burned:exBurn(ex, Number(weightLbs), s.duration), type:s.type };
    });
    const burned = sessionData.reduce((s,d)=>s+d.burned, 0);
    return { day, sessions:sessionData, burned, type:sessions.length>0?sessions[0].type:"rest_st",
      ex:sessionData.length>0?sessionData[0].ex:REST_ST, duration:sessions.length>0?sessions[0].duration:0 };
  });
  const totalStrBurn   = strengthDayData.reduce((s,d)=>s+d.burned, 0);
  const activeStrDays  = strengthDayData.filter(d=>d.burned>0).length;
  const avgStrPerDay   = Math.round(totalStrBurn/7);
  const TABS = [
    "📊 No Cardio",
    "🔥 + Cardio",
    ...(hasGoal ? ["🎯 Timeline"] : []),
    "🥗 Nutrients",
    "⚠️ Fat Gain",
    "💪 Muscle",
    "🏋️ Strength",
    "📋 Summary",
  ];

  const strengthTabIdx = TABS.indexOf("🏋️ Strength");
  const summaryTabIdx = TABS.indexOf("📋 Summary");
  // Tab strings double as keys (indexOf above), so the emoji stays in the data —
  // we render a custom <Icon> + the emoji-stripped label at display time only.
  const TAB_ICONS = {
    "📊 No Cardio": "chart", "🔥 + Cardio": "flame", "🎯 Timeline": "clock",
    "🥗 Nutrients": "leaf", "⚠️ Fat Gain": "alert", "💪 Muscle": "muscle",
    "🏋️ Strength": "dumbbell", "📋 Summary": "clipboard",
  };

  const colorsForCls = { "c-acc":"var(--accent)","c-grn":"var(--green)","c-yel":"var(--yellow)","c-red":"var(--red)" };

  const [openInfo, setOpenInfo] = useState(null); // 'devine' | 'robinson' | 'bmi'
  const [showIBW, setShowIBW] = useState(false);
  const toggleInfo = (key) => setOpenInfo(prev => prev === key ? null : key);

  const formulaInfos = {
    devine: {
      title: "Devine Formula (1974)",
      body: "The most widely used IBW formula in clinical medicine and pharmacy. Originally developed to calculate medication dosing, it gives a single target weight based on height and gender. Think of it as a classic clinical anchor point — a well-established reference your doctor or pharmacist would recognize."
    },
    robinson: {
      title: "Robinson Formula (1983)",
      body: "A refined update to the Devine formula, developed to better represent average body composition across a broader population. It tends to produce slightly different estimates by gender and is often used alongside Devine as a cross-check. When both formulas agree, that's a strong signal for what your target range should be."
    },
    bmi: {
      title: "BMI Healthy Range (18.5–24.9)",
      body: "Body Mass Index (BMI) measures your weight relative to your height. A BMI between 18.5 and 24.9 is classified as 'healthy weight' by the World Health Organization. This range gives you both the minimum and maximum healthy weight for your specific height — most people aim to land somewhere in the middle rather than at the extremes."
    },
  };

  return (
    <div className="fu">

      {isSimulation && <SimulationSummary data={data} totalBurn={totalBurn} />}

      {/* ── Basic / Pro Toggle ── */}
      <div style={{display:"flex",gap:"4px",background:"var(--s2)",padding:"4px",borderRadius:"12px",border:"1px solid var(--border)",marginBottom:"16px"}}>
        <button style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",gap:"6px",padding:"10px",borderRadius:"9px",border:"none",cursor:"pointer",fontFamily:"inherit",fontSize:".82rem",fontWeight:600,transition:"all .2s",background:viewMode==="basic"?"var(--surface)":"transparent",color:viewMode==="basic"?"var(--text)":"var(--muted)",boxShadow:viewMode==="basic"?"0 2px 8px rgba(0,0,0,.3)":"none"}}
          onClick={()=>setViewMode("basic")}>
          <Icon name="chart" size={15} />Basic Calculator
        </button>
        <button style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",gap:"6px",padding:"10px",borderRadius:"9px",border:"none",cursor:"pointer",fontFamily:"inherit",fontSize:".82rem",fontWeight:600,transition:"all .2s",background:viewMode==="pro"?"var(--surface)":"transparent",color:viewMode==="pro"?"var(--accent)":"var(--muted)",boxShadow:viewMode==="pro"?"0 2px 8px rgba(0,0,0,.3)":"none"}}
          onClick={()=>setViewMode("pro")}>
          <Icon name="bolt" size={15} />Pro Tracking
        </button>
      </div>

      {/* ── Pro Mode: Daily Check-In, Progress, AI ── */}
      {viewMode === "pro" && (
        <>
          <StreakBadges checkIns={data.checkIns || []} />
          <DailyCheckIn data={data} onSaveCheckIn={onSaveCheckIn} />
          {(data.checkIns || []).length >= 1 && (
            <div onClick={() => setShowWeightModal(true)} style={{ cursor: "pointer" }}
              title="Tap to manage weigh-ins">
              <ProgressChart checkIns={data.checkIns} goalWeight={data.goalWeight} currentWeight={data.weightLbs}
                rangeLow={data.goalRangeLow} rangeHigh={data.goalRangeHigh} showValues pxPerPoint={64} />
              <div style={{ textAlign: "center", fontSize: ".72rem", color: "var(--muted)", marginTop: -6 }}>
                Tap chart to add / remove weigh-ins
              </div>
            </div>
          )}
          {showWeightModal && (
            <WeightChartModal checkIns={data.checkIns || []} goalWeight={data.goalWeight}
              currentWeight={data.weightLbs} rangeLow={data.goalRangeLow} rangeHigh={data.goalRangeHigh}
              startWeight={data.startWeightLbs}
              onDelete={onDeleteCheckIn} onClose={() => setShowWeightModal(false)} />
          )}
          <AICoach data={data} tdee={tdee} totalBurn={totalBurn} totalStrBurn={totalStrBurn} activeDays={activeDays} activeStrDays={activeStrDays} />

          {/* ── Trainer Notes ── */}
          <div className="card" style={{padding:"16px",marginBottom:"16px"}}>
            <div style={{display:"flex",alignItems:"center",gap:"10px",marginBottom: showNotes?"12px":"0",cursor:"pointer"}} onClick={()=>setShowNotes(v=>!v)}>
              <span style={{fontSize:"1.2rem"}}>📝</span>
              <div style={{flex:1}}>
                <div style={{fontFamily:"'Sora',sans-serif",fontSize:"1rem",letterSpacing:"2px",color:"var(--text-secondary)"}}>Trainer Notes</div>
                <div style={{fontSize:".72rem",color:"var(--muted)"}}>{data.trainerNotes ? `${data.trainerNotes.length} chars · last updated` : "No notes yet — tap to add"}</div>
              </div>
              <span style={{color:"var(--muted)",fontSize:".7rem",transition:"transform .2s",transform:showNotes?"rotate(180deg)":"none"}}>▼</span>
            </div>
            {showNotes && (
              <div style={{animation:"fadeUp .18s ease both"}}>
                <textarea
                  value={data.trainerNotes || ""}
                  onChange={e => onUpdateNotes(e.target.value)}
                  placeholder="Session observations, things to follow up on, client preferences, injury notes, anything you want to remember for next time..."
                  style={{
                    width:"100%", minHeight:"120px", padding:"12px", borderRadius:"8px",
                    border:"1.5px solid var(--border)", background:"var(--s2)",
                    color:"var(--text)", fontFamily:"inherit", fontSize:".84rem",
                    lineHeight:1.6, resize:"vertical", outline:"none",
                  }}
                />
                <div style={{fontSize:".7rem",color:"var(--muted)",marginTop:"6px"}}>
                  💡 Notes save automatically. Use this for session recaps, form cues, dietary preferences, injuries, or anything you want to remember before the next session.
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {/* ── Ideal Body Weight Card (always visible) ── */}
      <div className="ibw-card">
        <div className="ibw-toggle" onClick={()=>setShowIBW(v=>!v)}>
          <div className="ibw-toggle-left">
            <span className="ibw-toggle-title" style={{display:"inline-flex",alignItems:"center",gap:"7px"}}><Icon name="ruler" size={17} color="var(--accent)" />Ideal Body Weight</span>
            <span className="ibw-toggle-summary">BMI {bmi.toFixed(1)} · {ibwLowLbs}–{ibwHighLbs} lbs range</span>
          </div>
          <div className={`ibw-toggle-chevron${showIBW?" open":""}`}>▼</div>
        </div>
        {showIBW && (
        <div className="ibw-body">
        <div className="ibw-subtitle">Based on your height ({heightFt}'{heightIn}") and gender</div>

        {/* Big range display */}
        <div className="ibw-range-row">
          <div className="ibw-range-val">
            <div className="ibw-range-num">{ibwLowLbs}–{ibwHighLbs}</div>
            <div className="ibw-range-lbl">lbs &nbsp;·&nbsp; Healthy BMI Range (18.5–24.9)</div>
          </div>
          <div className={`ibw-bmi-badge ${bmiCategory.cls}`}>
            <div className="ibw-bmi-num">{bmi.toFixed(1)}</div>
            <div className="ibw-bmi-lbl">BMI · {bmiCategory.label}</div>
          </div>
        </div>

        {/* Visual bar showing where current weight sits */}
        <div className="ibw-bar-wrap">
          <div className="ibw-bar-labels">
            <span>Underweight</span><span>Healthy</span><span>Overweight</span>
          </div>
          <div className="ibw-bar-track">
            <div className="ibw-bar-healthy"></div>
            <div className="ibw-bar-marker" style={{
              left: `${Math.min(95, Math.max(5, ((Number(weightLbs) - (ibwLowLbs - 25)) / (ibwHighLbs - ibwLowLbs + 50)) * 100))}%`,
              background: inRange ? "var(--green)" : Number(weightLbs) < ibwLowLbs ? "var(--yellow)" : "var(--orange)"
            }}>
              <div className="ibw-marker-label">{weightLbs} lbs</div>
            </div>
          </div>
          <div className="ibw-bar-range-ticks">
            <span>{ibwLowLbs}</span><span>{ibwHighLbs}</span>
          </div>
        </div>

        {/* Formula references with inline expand panels */}
        <div className="ibw-formulas">
          {[
            { key:"devine",   name:"Devine Formula",    val:`${devineLbs} lbs`,             note:"Most common clinical reference" },
            { key:"robinson", name:"Robinson Formula",  val:`${robinsonLbs} lbs`,           note:"Alternate clinical reference"   },
            { key:"bmi",      name:"BMI Healthy Range", val:`${ibwLowLbs}–${ibwHighLbs} lbs`, note:"Based on BMI 18.5–24.9"       },
          ].map(f => (
            <div key={f.key}>
              <div className="ibw-formula-row">
                <span className="ibw-formula-name">
                  {f.name}
                  <button
                    className={`info-icon${openInfo===f.key?" active":""}`}
                    onClick={()=>toggleInfo(f.key)}
                    aria-label={`Info about ${f.name}`}
                  >i</button>
                </span>
                <span className="ibw-formula-val">{f.val}</span>
                <span className="ibw-formula-note">{f.note}</span>
              </div>
              {openInfo === f.key && (
                <div className="info-panel">
                  <strong>{formulaInfos[f.key].title}</strong>
                  {formulaInfos[f.key].body}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Goal weight callout */}
        {goalLbs && (
          <div className={`ibw-goal-note ${goalInRange ? "ibw-goal-good" : "ibw-goal-check"}`}>
            {goalInRange
              ? `✅ Your goal weight of ${goalLbs} lbs (BMI ${goalBmi.toFixed(1)}) falls within the healthy range.`
              : goalBmi < 18.5
                ? `⚠️ Your goal weight of ${goalLbs} lbs (BMI ${goalBmi.toFixed(1)}) would be below the healthy range. Consider aiming for ${ibwLowLbs}+ lbs.`
                : `ℹ️ Your goal weight of ${goalLbs} lbs (BMI ${goalBmi.toFixed(1)}) is above the healthy range. The range for your height is ${ibwLowLbs}–${ibwHighLbs} lbs.`
            }
          </div>
        )}

        <p className="ibw-footnote">IBW formulas are estimates and do not account for muscle mass, bone density, or body composition. Use as a general reference, not a strict target.</p>
        </div>
        )}
      </div>

      <div className="rtabs">
        {TABS.map((t,i)=>(
          <button key={i} className={`rtab${tab===i?" active":""}`} onClick={()=>setTab(i)}
            style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:"3px",lineHeight:1.1}}>
            <Icon name={TAB_ICONS[t]} size={16} />{t.replace(/^\S+\s/,"")}</button>
        ))}
      </div>

      {/* ─ No Cardio ─ */}
      {tab===0 && (
        <div className="fu">
          <div className="hero">
            <div className="hero-lbl">{name?`${name}'s`:"Your"} Maintenance Calories</div>
            <div className="hero-val">{tdee.toLocaleString()}</div>
            <div className="hero-unit">cal/day · diet only · no cardio</div>
            <div className="hero-detail">BMR {Math.round(bmr).toLocaleString()} × {actObj.multiplier} ({actObj.label})</div>
          </div>

          <div className="sec-title">Daily Targets</div>
          <div className="dgrid">
            {targets.map(t=>(
              <div className="dcard" key={t.label}>
                <div className="dc-lbl">{t.goalLabel}</div>
                <div className={`dc-val ${t.cls}`}>{floor(tdee-t.cut).toLocaleString()}</div>
                <div className="dc-unit">cal/day</div>
                <div className="dc-note">{t.cut>0?`−${t.cut}/day`:"No deficit"}</div>
              </div>
            ))}
          </div>

          <div className="sec-title">Daily Breakdown</div>
          <p style={{fontSize:".75rem",color:"var(--muted)",marginBottom:"10px"}}>💡 Tap any day to add or change cardio — results update instantly.</p>
          {DAYS.map((day,di)=>{
            const sessions = Array.isArray(data.cardio[day]) ? data.cardio[day] : [];
            const isRest = sessions.length === 0;
            const totalBurnDay = sessions.reduce((s,sess)=>{
              const c = findCardioEx(sess.type, data.customExercises);
              return s + exBurn(c, Number(weightLbs), sess.duration);
            },0);
            const isOpen = openResultDay === day;
            return (
              <div className={`day-result-card editable${isOpen?" drc-open":""}`} key={day}>
                <div className="drc-header drc-clickable" onClick={()=>setOpenResultDay(isOpen?null:day)}>
                  <div className="drc-day">{day.slice(0,3)}</div>
                  <div className="drc-cardio">
                    {isRest
                      ? <span style={{color:"var(--muted)"}}>😴 Rest — tap to add cardio</span>
                      : sessions.length === 1
                        ? <span>{(findCardioEx(sessions[0].type, data.customExercises)||{icon:"🏃"}).icon} {(findCardioEx(sessions[0].type, data.customExercises)||{label:"Cardio"}).label.split("–")[0].trim()} · {sessions[0].duration}m</span>
                        : <span>{sessions.length} sessions</span>
                    }
                  </div>
                  {totalBurnDay>0 && <div className="drc-burn">+{totalBurnDay}</div>}
                  <div className={`drc-chevron${isOpen?" open":""}`}>▼</div>
                </div>
                {isOpen && (
                  <div className="drc-edit-body">
                    {sessions.map((sess, idx)=>{
                      const co = findCardioEx(sess.type, data.customExercises);
                      const burn = exBurn(co, Number(weightLbs), sess.duration);
                      return (
                        <div key={idx} style={{padding:"10px 0",borderBottom:idx<sessions.length-1?"1px solid var(--border)":"none"}}>
                          {sessions.length > 1 && (
                            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"6px"}}>
                              <span style={{fontSize:".7rem",color:"var(--muted)",fontWeight:700,letterSpacing:"1px",textTransform:"uppercase"}}>Session {idx+1}</span>
                            </div>
                          )}
                          <div className="field">
                            <label>Exercise</label>
                            <select value={sess.type} onChange={e=>onUpdateCardio(day,idx,"type",e.target.value)}>
                              {CARDIO_GROUPS.map(grp=>(
                                <optgroup key={grp.group} label={grp.group}>
                                  {grp.options.map(c=><option key={c.id} value={c.id}>{c.icon} {c.label}</option>)}
                                </optgroup>
                              ))}
                              <CustomOptGroup customExercises={data.customExercises} type="cardio" />
                            </select>
                          </div>
                          {sess.type!=="rest" && (
                            <div className="field" style={{marginBottom:0}}>
                              <label>Duration</label>
                              <select value={sess.duration} onChange={e=>onUpdateCardio(day,idx,"duration",Number(e.target.value))}>
                                {DURATIONS.map(m=><option key={m} value={m}>{m} minutes</option>)}
                              </select>
                            </div>
                          )}
                          {burn>0 && (
                            <div className="drc-edit-live">
                              <span>🔥</span>
                              <div>
                                <span className="burn-num">+{burn} cal</span>
                                <span style={{color:"var(--muted)",fontSize:".76rem",marginLeft:"6px"}}>burned this session — flip to the <strong style={{color:"var(--accent)"}}>🔥 + Cardio</strong> tab to see your updated targets.</span>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                    <button className="quick-fill-toggle" style={{marginTop:"8px",marginBottom:"4px",borderStyle:"solid",fontSize:".8rem",padding:"10px 14px"}}
                      onClick={()=>onUpdateCardio(day,sessions.length,"type","outdoor_jog")}>
                      + Add {sessions.length>0?"Another":"a"} Session
                    </button>
                  </div>
                )}
              </div>
            );
          })}

          <div className="explainer-box">
            <div className="exp-title">💡 What do these numbers mean?</div>
            <p className="exp-body">
              Your body needs <strong style={{color:"var(--accent)"}}>{tdee.toLocaleString()} calories per day</strong> just to stay at your current weight — that's your maintenance level. If you eat <em>less</em> than that, your body starts burning stored fat to make up the difference.
            </p>
            <div className="exp-rows">
              {targets.filter(t=>t.cut>0).map(t=>(
                <div className="exp-row" key={t.label}>
                  <div className={`exp-dot ${t.cls}`}></div>
                  <div>
                    <span style={{fontWeight:600}}>Eat {floor(tdee-t.cut).toLocaleString()} cal/day</span>
                    <span className="exp-row-sub"> — you're {t.cut} calories under your maintenance each day, which adds up to losing <strong>{t.label.replace("/wk"," of body weight every week")}</strong>.</span>
                  </div>
                </div>
              ))}
            </div>
            <p className="exp-tip">📌 <strong>Think of it this way:</strong> your daily calorie target is your budget. Spend under it, and your body cashes in fat as the difference.</p>
          </div>
          <p className="footnote">Targets below 1,200 cal/day are floored at 1,200 for safety. Based on Mifflin-St Jeor equation. ⚠️ All calorie targets are estimates — individual needs vary. Not a substitute for professional dietary guidance.</p>
        </div>
      )}

      {/* ─ With Cardio ─ */}
      {tab===1 && (
        <div className="fu">
          <div className="hero">
            <div className="hero-lbl">{name?`${name}'s`:"Your"} Base Maintenance</div>
            <div className="hero-val">{tdee.toLocaleString()}</div>
            <div className="hero-unit">cal/day baseline (cardio adds eating room)</div>
          </div>

          <div className="csumm">
            <div className="cs-icon">🔥</div>
            <div>
              <div className="cs-title">Weekly Cardio</div>
              <div className="cs-body">
                {activeDays>0
                  ? <><strong>{activeDays} active day{activeDays>1?"s":""}</strong> · <strong style={{color:"var(--orange)"}}>{totalBurn.toLocaleString()} cal/wk</strong> burned · ≈ <strong>{cardioFatLbs} lbs fat/wk</strong> · avg +{avgBurnPerDay} cal/day extra</>
                  : "No cardio set — go back to plan your week."
                }
              </div>
            </div>
          </div>

          <div className="sec-title">Avg Daily Targets (With Cardio)</div>
          <div className="dgrid">
            {targets.map(t=>{
              const eat = floor(tdee-t.cut+avgBurnPerDay);
              return (
                <div className="dcard" key={t.label}>
                  <div className="dc-lbl">{t.goalLabel}</div>
                  <div className={`dc-val ${t.cls}`}>{eat.toLocaleString()}</div>
                  <div className="dc-unit">avg cal/day</div>
                  <div className="dc-note">avg +{avgBurnPerDay} cardio</div>
                </div>
              );
            })}
          </div>

          <div className="sec-title">Day-by-Day Targets</div>
          <p style={{fontSize:".75rem",color:"var(--muted)",marginBottom:"10px"}}>💡 Tap any day to change the exercise or duration — calories update instantly.</p>
          {dayData.map(({day,sessions:daySessions,burned})=>{
            const allSessions = Array.isArray(data.cardio[day]) ? data.cardio[day] : [];
            const isRest = allSessions.length === 0;
            const isOpen = openResultDay === day;
            return (
              <div className={`day-result-card editable${isOpen?" drc-open":""}`} key={day}>
                <div className="drc-header drc-clickable" onClick={()=>setOpenResultDay(isOpen?null:day)}>
                  <div className="drc-day">{day.slice(0,3)}</div>
                  <div className="drc-cardio">
                    {isRest ? "😴 Rest — tap to add cardio"
                      : allSessions.length === 1
                        ? `${(daySessions[0]||{}).co?.icon||"🏃"} ${((daySessions[0]||{}).co?.label||"Cardio").split("–")[0].trim().split("(")[0].trim()} ${allSessions[0].duration}m`
                        : `${allSessions.length} sessions`
                    }
                  </div>
                  {burned>0 && <div className="drc-burn">+{burned} cal</div>}
                  <div className={`drc-chevron${isOpen?" open":""}`}>▼</div>
                </div>
                {isOpen && (
                  <div className="drc-edit-body">
                    {allSessions.map((sess,idx)=>{
                      const co = findCardioEx(sess.type, data.customExercises);
                      const burn = exBurn(co, Number(weightLbs), sess.duration);
                      return (
                        <div key={idx} style={{padding:"10px 0",borderBottom:idx<allSessions.length-1?"1px solid var(--border)":"none"}}>
                          {allSessions.length>1 && <div style={{fontSize:".7rem",color:"var(--muted)",fontWeight:700,letterSpacing:"1px",textTransform:"uppercase",marginBottom:"6px"}}>Session {idx+1}</div>}
                          <div className="field">
                            <label>Exercise</label>
                            <select value={sess.type} onChange={e=>onUpdateCardio(day,idx,"type",e.target.value)}>
                              {CARDIO_GROUPS.map(grp=>(
                                <optgroup key={grp.group} label={grp.group}>
                                  {grp.options.map(c=><option key={c.id} value={c.id}>{c.icon} {c.label}</option>)}
                                </optgroup>
                              ))}
                              <CustomOptGroup customExercises={data.customExercises} type="cardio" />
                            </select>
                          </div>
                          {sess.type!=="rest" && (
                            <div className="field" style={{marginBottom:0}}>
                              <label>Duration</label>
                              <select value={sess.duration} onChange={e=>onUpdateCardio(day,idx,"duration",Number(e.target.value))}>
                                {DURATIONS.map(m=><option key={m} value={m}>{m} minutes</option>)}
                              </select>
                            </div>
                          )}
                          {burn>0 && (
                            <div className="drc-edit-live">
                              <span>🔥</span>
                              <div><span className="burn-num">+{burn} cal</span><span style={{color:"var(--muted)",fontSize:".76rem",marginLeft:"6px"}}>burned — targets below updated automatically.</span></div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                    <button className="quick-fill-toggle" style={{marginTop:"8px",marginBottom:"4px",borderStyle:"solid",fontSize:".8rem",padding:"10px 14px"}}
                      onClick={()=>onUpdateCardio(day,allSessions.length,"type","outdoor_jog")}>
                      + Add {allSessions.length>0?"Another":"a"} Session
                    </button>
                  </div>
                )}
                <div className="drc-row">
                  {targets.map(t=>(
                    <div className="drc-cell" key={t.label}>
                      <div className="drc-cell-lbl">{t.goalLabel}</div>
                      <div className={`drc-cell-val ${t.cls}`}>{floor(tdee - t.cut + burned).toLocaleString()}</div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}

          <div className="explainer-box">
            <div className="exp-title">💡 How does cardio change things?</div>
            <p className="exp-body">
              Your maintenance is still <strong style={{color:"var(--accent)"}}>{tdee.toLocaleString()} cal/day</strong>. But on days you do cardio, you burn extra calories — which means you can <em>eat more that day</em> and still stay in a deficit. Think of cardio as buying yourself extra food room.
            </p>
            {activeDays>0 && (
              <div className="exp-callout">
                🔥 Your {activeDays} cardio days burn ~<strong style={{color:"var(--orange)"}}>{totalBurn.toLocaleString()} extra calories</strong> this week. That's roughly <strong>{cardioFatLbs} lbs of additional fat</strong> burned from exercise alone — on top of whatever your diet is doing.
              </div>
            )}
            <div className="exp-rows">
              {targets.filter(t=>t.cut>0).map(t=>{
                const avgEat = floor(tdee-t.cut+avgBurnPerDay);
                return (
                  <div className="exp-row" key={t.label}>
                    <div className={`exp-dot ${t.cls}`}></div>
                    <div>
                      <span style={{fontWeight:600}}>~{avgEat.toLocaleString()} cal/day average</span>
                      <span className="exp-row-sub"> to lose <strong>{t.label.replace("/wk"," per week")}</strong>. On active days you eat more; on rest days a little less.</span>
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="exp-tip">📌 <strong>The big idea:</strong> cardio doesn't change your goal — it just gives you more flexibility. More movement = more food, same result.</p>
          </div>
          {/* Heart Rate Zones */}
          <div className="sec-title">❤️ Heart Rate Training Zones</div>
          <p style={{fontSize:".78rem",color:"var(--muted)",marginBottom:"12px",lineHeight:1.5}}>
            Based on {name||"your"} age ({age}). Uses the Tanaka formula: HRmax = 208 − (0.7 × age), which is more accurate than the classic 220 − age formula for most populations.
          </p>
          {(()=>{
            const hrMax = Math.round(208 - 0.7 * Number(age));
            const zones = [
              { name:"Zone 1 — Warm Up",  range:[50,60], color:"#4fc3f7", desc:"Light activity, recovery walks, warm-up. Easy conversation pace." },
              { name:"Zone 2 — Fat Burn",  range:[60,70], color:"#4fffb0", desc:"Peak fat-burning zone. Highest % of calories from fat. Sustainable for long durations. This is your ideal steady-state cardio zone.", highlight:true },
              { name:"Zone 3 — Cardio",    range:[70,80], color:"#ffcc44", desc:"Aerobic endurance. Improves cardiovascular fitness. You can talk but not sing." },
              { name:"Zone 4 — Hard",      range:[80,90], color:"#ff6b35", desc:"Threshold training. Builds speed and power. Conversation is difficult." },
              { name:"Zone 5 — Max",       range:[90,100],color:"#ff4f6b", desc:"All-out effort. Sprint intervals. Cannot be sustained more than 1–2 minutes." },
            ];
            return (
              <>
                <div style={{background:"var(--surface)",border:"1px solid var(--border)",borderRadius:"var(--radius-sm)",padding:"14px",marginBottom:"12px",textAlign:"center"}}>
                  <div style={{fontSize:".68rem",color:"var(--muted)",textTransform:"uppercase",letterSpacing:"1px",marginBottom:"4px"}}>Estimated Max Heart Rate</div>
                  <div style={{fontFamily:"'Sora',sans-serif",fontSize:"2.4rem",color:"var(--red)",lineHeight:1}}>{hrMax}</div>
                  <div style={{fontSize:".78rem",color:"var(--muted)"}}>BPM (Tanaka formula)</div>
                </div>
                {zones.map(z=>{
                  const low = Math.round(hrMax * z.range[0]/100);
                  const high = Math.round(hrMax * z.range[1]/100);
                  return (
                    <div key={z.name} style={{
                      background: z.highlight ? "rgba(79,255,176,.04)" : "var(--surface)",
                      border: `1.5px solid ${z.highlight ? "rgba(79,255,176,.25)" : "var(--border)"}`,
                      borderRadius:"var(--radius-sm)",padding:"14px",marginBottom:"8px",
                      borderLeft: `4px solid ${z.color}`,
                    }}>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"4px"}}>
                        <div style={{fontWeight:700,fontSize:".88rem",color:z.color}}>{z.name}</div>
                        <div style={{fontFamily:"'Sora',sans-serif",fontSize:"1.15rem",color:z.color,letterSpacing:".5px"}}>{low}–{high} BPM</div>
                      </div>
                      <div style={{fontSize:".76rem",color:"var(--muted)",lineHeight:1.5}}>{z.desc}</div>
                      {z.highlight && (
                        <div style={{fontSize:".74rem",color:"var(--green)",marginTop:"6px",fontWeight:600}}>
                          ⭐ Recommended for steady-state fat loss cardio — aim to stay in this range for 30–60 minutes.
                        </div>
                      )}
                    </div>
                  );
                })}
                <div style={{fontSize:".76rem",color:"var(--muted)",lineHeight:1.5,marginTop:"8px",padding:"10px 12px",background:"rgba(8,220,224,.03)",borderRadius:"8px",borderLeft:"3px solid var(--accent)"}}>
                  💡 <strong style={{color:"var(--text)"}}>Fat Burn vs. Total Burn:</strong> Zone 2 burns the highest <em>percentage</em> of calories from fat (~60–70%). But higher zones burn more <em>total</em> calories per minute. For fat loss, Zone 2 for longer sessions (45–60 min) or Zone 4–5 intervals (HIIT) are both effective — pick what you'll stick with consistently.
                </div>
              </>
            );
          })()}

          {/* Disclaimer */}
          <div style={{marginTop:"16px",padding:"14px",background:"rgba(255,204,68,.04)",border:"1px solid rgba(255,204,68,.15)",borderRadius:"var(--radius-sm)",fontSize:".75rem",color:"var(--muted)",lineHeight:1.6}}>
            <strong style={{color:"var(--yellow)",display:"block",marginBottom:"4px"}}>⚠️ Important Disclaimer</strong>
            All calorie targets, heart rate zones, macro calculations, body weight projections, muscle gain estimates, and timelines shown in Glide are <strong style={{color:"var(--text)"}}>estimates based on established formulas and published research</strong> — they are not exact measurements. Individual results vary based on genetics, metabolism, sleep, stress, hydration, medication, and other factors. Heart rate zones are calculated from a formula and may differ from your actual physiological thresholds. These tools are intended for <strong style={{color:"var(--text)"}}>educational and coaching purposes only</strong> and should not replace advice from a physician, registered dietitian, or certified healthcare provider. Always consult a medical professional before starting any new diet or exercise program.
          </div>
          <p className="footnote">On cardio days you can eat more and still hit your deficit. Targets floored at 1,200 cal/day.</p>
        </div>
      )}

      {/* ─ Goal Timeline ─ */}
      {tab === 2 && hasGoal && <TimelineTab data={data} tdee={tdee} totalBurn={totalBurn}/>}

      {/* ─ Nutrients ─ */}
      {tab === (hasGoal ? 3 : 2) && (
        <NutrientsTab
          weightLbs={Number(weightLbs)}
          gender={gender}
          age={Number(age)}
          tdee={tdee}
          totalBurn={totalBurn}
          name={name}
          targets={targets}
          floor={floor}
          avgBurnPerDay={avgBurnPerDay}
          avgStrPerDay={avgStrPerDay}
          activeDays={activeDays}
          activeStrDays={activeStrDays}
          dayData={dayData}
          strengthDayData={strengthDayData}
        />
      )}

      {/* ─ Surplus ─ */}
      {tab === (hasGoal ? 4 : 3) && (
        <SurplusTab
          tdee={tdee}
          totalBurn={totalBurn}
          avgBurnPerDay={avgBurnPerDay}
          activeDays={activeDays}
          name={name}
        />
      )}

      {/* ─ Muscle Building ─ */}
      {tab === (hasGoal ? 5 : 4) && (
        <MuscleTab
          tdee={tdee}
          totalBurn={totalBurn}
          avgBurnPerDay={avgBurnPerDay}
          activeDays={activeDays}
          weightLbs={Number(weightLbs)}
          gender={gender}
          age={Number(age)}
          name={name}
          activeStrDays={activeStrDays}
          strengthDayData={strengthDayData}
          totalStrBurn={totalStrBurn}
        />
      )}

      {/* ─ Strength ─ */}
      {tab === strengthTabIdx && (
        <StrengthTab
          data={data}
          tdee={tdee}
          weightLbs={Number(weightLbs)}
          gender={gender}
          age={Number(age)}
          name={name}
          strengthDayData={strengthDayData}
          totalStrBurn={totalStrBurn}
          activeStrDays={activeStrDays}
          avgStrPerDay={avgStrPerDay}
          totalCardio={totalBurn}
          onUpdateStrength={onUpdateStrength}
          floor={n=>Math.max(n,1200)}
        />
      )}

      {/* ─ Summary ─ */}
      {tab === summaryTabIdx && (
        <SummaryTab
          data={data}
          bmr={bmr}
          tdee={tdee}
          actObj={actObj}
          dayData={dayData}
          strengthDayData={strengthDayData}
          totalBurn={totalBurn}
          totalStrBurn={totalStrBurn}
          activeDays={activeDays}
          activeStrDays={activeStrDays}
          avgBurnPerDay={avgBurnPerDay}
          avgStrPerDay={avgStrPerDay}
          floor={floor}
          targets={targets}
          ibwLowLbs={ibwLowLbs}
          ibwHighLbs={ibwHighLbs}
          bmi={bmi}
        />
      )}

      {/* ─ Global Disclaimer ─ */}
      <div style={{marginTop:"20px",padding:"14px",background:"rgba(255,204,68,.04)",border:"1px solid rgba(255,204,68,.15)",borderRadius:"var(--radius-sm)",fontSize:".73rem",color:"var(--muted)",lineHeight:1.6}}>
        <strong style={{color:"var(--yellow)"}}>⚠️ Disclaimer:</strong> All numbers in Glide are <strong style={{color:"var(--text)"}}>estimates</strong> based on published formulas (Mifflin-St Jeor, Tanaka, Ainsworth MET Compendium). Individual results vary. These tools are for educational and coaching purposes — not medical advice. Consult a healthcare provider before starting any diet or exercise program.
      </div>

      {/* ─ Edit / Start Over bar ─ */}
      <div className="edit-bar">
        <button className="edit-bar-btn" onClick={()=>setShowEdit(v=>!v)}>
          ✏️ Edit My Info {showEdit ? "▲" : "▼"}
        </button>
        <button className="edit-bar-reset" onClick={onReset}>↺ Start Over</button>
      </div>
      {showEdit && (
        <div className="edit-panel fu">
          <div className="edit-panel-title">Jump back to any step to make changes — your other answers are saved.</div>
          <div className="edit-panel-grid">
            {[
              { step:0, icon:"👤", label:"Personal Info",    sub:`${fullName(data)||"Name"} · ${data.weightLbs} lbs` },
              { step:1, icon:"🎯", label:"Goal Weight",      sub:data.goalWeight ? `Goal: ${data.goalWeight} lbs` : "Not set" },
              { step:2, icon:"🏃", label:"Activity Level",   sub:ACTIVITY_LEVELS.find(a=>a.id===data.activityLevel)?.label||"" },
              { step:3, icon:"🔥", label:"Cardio Plan",      sub:`${DAYS.filter(d=>Array.isArray(data.cardio[d])&&data.cardio[d].length>0).length} active days/week` },
              { step:4, icon:"💪", label:"Strength Plan",    sub:`${DAYS.filter(d=>Array.isArray(data.strength?.[d])&&data.strength[d].length>0).length} training days/week` },
            ].map(item=>(
              <button key={item.step} className="edit-jump-btn" onClick={()=>{ setShowEdit(false); onEdit(item.step); }}>
                <span className="ejb-icon">{item.icon}</span>
                <div>
                  <div className="ejb-label">{item.label}</div>
                  <div className="ejb-sub">{item.sub}</div>
                </div>
                <span className="ejb-arrow">→</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Strength Tab ─────────────────────────────────────────────────────────────
// Science:
//  MET values: Ainsworth et al. 2011 Compendium (MSSE 43:1575)
//  Muscle gain vs freq: Schoenfeld BJ (2017) J Strength Cond Res
//  Body fat: Wewege MA et al. (2022) Sports Med — meta-analysis, 116 RCTs
//  Concurrent training: Schoenfeld BJ (2011) J Strength Cond Res

// ─── Summary Tab ──────────────────────────────────────────────────────────────

function SummaryTab({ data, bmr, tdee, actObj, dayData, strengthDayData,
  totalBurn, totalStrBurn, activeDays, activeStrDays, avgBurnPerDay, avgStrPerDay,
  floor, targets, ibwLowLbs, ibwHighLbs, bmi }) {

  const { firstName, lastName, gender, age, weightLbs, heightFt, heightIn, goalWeight } = data;
  const hasGoal = goalWeight && Number(goalWeight) < Number(weightLbs);
  const toLose = hasGoal ? Number(weightLbs) - Number(goalWeight) : null;

  // Macros at 1 lb/wk deficit
  const targetCals = floor(tdee - 500 + avgBurnPerDay + avgStrPerDay);
  const proteinG = Math.round(Number(weightLbs) * 1.0);
  const fatCal = Math.round(targetCals * 0.28);
  const fatG = Math.round(fatCal / 9);
  const carbG = Math.round(Math.max(0, targetCals - proteinG * 4 - fatCal) / 4);
  const waterOz = Math.round(Number(weightLbs) * 0.5);

  // Timeline at 1 lb/wk
  const wksDiet = hasGoal ? weeksToGoal(toLose, 3500) : null;
  const wksCardio = hasGoal && totalBurn > 0 ? weeksToGoal(toLose, 3500 + totalBurn) : null;

  const Row = ({ label, value, color }) => (
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 0",borderBottom:"1px solid var(--border)",fontSize:".85rem"}}>
      <span style={{color:"var(--muted)"}}>{label}</span>
      <span style={{fontFamily:"'Sora',sans-serif",fontSize:"1.05rem",letterSpacing:".5px",color:color||"var(--text)"}}>{value}</span>
    </div>
  );

  return (
    <div className="fu">
      <div className="hero" style={{marginBottom:"18px"}}>
        <div className="hero-lbl">{fullName(data) ? `${fullName(data)}'s` : "Your"} Complete Plan Summary</div>
        <div className="hero-val" style={{fontSize:"2.6rem"}}>📋</div>
        <div className="hero-unit">Everything at a glance</div>
      </div>

      {/* Profile */}
      <div className="sec-title">Profile</div>
      <div className="card" style={{padding:"14px 16px"}}>
        <Row label="Gender" value={gender === "male" ? "♂ Male" : "♀ Female"} />
        <Row label="Age" value={`${age} years`} />
        <Row label="Weight" value={`${weightLbs} lbs`} />
        <Row label="Height" value={`${heightFt}'${heightIn}"`} />
        <Row label="Activity" value={actObj.label} />
        <Row label="BMI" value={bmi.toFixed(1)} color={bmi < 25 ? "var(--green)" : "var(--yellow)"} />
        <Row label="Healthy Range" value={`${ibwLowLbs}–${ibwHighLbs} lbs`} color="var(--green)" />
        {hasGoal && <Row label="Goal Weight" value={`${goalWeight} lbs (−${toLose} lbs)`} color="var(--accent)" />}
      </div>

      {/* Calorie Targets */}
      <div className="sec-title">Daily Calorie Targets</div>
      <div className="card" style={{padding:"14px 16px"}}>
        <Row label="BMR" value={`${Math.round(bmr).toLocaleString()} cal`} />
        <Row label={`TDEE (${actObj.label})`} value={`${tdee.toLocaleString()} cal`} color="var(--accent)" />
        {targets.filter(t=>t.cut>0).map(t=>(
          <Row key={t.label} label={t.goalLabel} value={`${floor(tdee - t.cut + avgBurnPerDay).toLocaleString()} cal`} color={`var(${t.cls==="c-grn"?"--green":t.cls==="c-yel"?"--yellow":"--red"})`} />
        ))}
      </div>

      {/* Weekly Activity */}
      <div className="sec-title">Weekly Activity</div>
      <div className="card" style={{padding:"14px 16px"}}>
        <Row label="Cardio days" value={`${activeDays}/7`} color="var(--orange)" />
        <Row label="Cardio burn" value={`${totalBurn.toLocaleString()} cal/wk`} color="var(--orange)" />
        <Row label="Strength days" value={`${activeStrDays}/7`} color="#4fc3f7" />
        <Row label="Strength burn" value={`${totalStrBurn.toLocaleString()} cal/wk`} color="#4fc3f7" />
        <Row label="Combined weekly" value={`${(totalBurn + totalStrBurn).toLocaleString()} cal/wk`} color="var(--accent)" />
      </div>

      {/* Weekly Schedule */}
      <div className="sec-title">Weekly Schedule</div>
      <div className="card" style={{padding:"14px 16px"}}>
        {DAYS.map((day, i) => {
          const cd = dayData[i];
          const sd = strengthDayData[i];
          const combined = cd.burned + sd.burned;
          const cardioSessions = cd.sessions || [];
          const strSessions = sd.sessions || [];
          const cardioLabel = cardioSessions.length === 0 ? "Rest"
            : cardioSessions.map(s => `${s.co?.icon||"🏃"} ${(s.co?.label||"").split("–")[0].trim().split("(")[0].trim()} ${s.duration}m`).join(" + ");
          const strLabel = strSessions.length === 0 ? ""
            : strSessions.map(s => `${s.ex?.icon||"🏋️"} ${(s.ex?.label||"").split("–")[0].trim()} ${s.duration}m`).join(" + ");
          return (
            <div key={day} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 0",borderBottom:i<6?"1px solid var(--border)":"none",gap:"8px"}}>
              <span style={{fontWeight:700,fontSize:".85rem",color:"var(--text-secondary)",minWidth:"32px"}}>{DAY_SHORT[i]}</span>
              <span style={{flex:1,fontSize:".78rem",color:"var(--muted)",lineHeight:1.4}}>
                {cardioLabel}{strLabel ? ` · ${strLabel}` : ""}
              </span>
              {combined > 0 && <span style={{fontFamily:"'Sora',sans-serif",fontSize:".9rem",color:"var(--orange)",whiteSpace:"nowrap"}}>{combined} cal</span>}
            </div>
          );
        })}
      </div>

      {/* Macros at 1 lb/wk */}
      <div className="sec-title">Macros (1 lb/wk deficit)</div>
      <div className="card" style={{padding:"14px 16px"}}>
        <Row label="Target calories" value={`${targetCals.toLocaleString()} cal`} color="var(--accent)" />
        <Row label="Protein" value={`${proteinG}g`} color="#ff6b9d" />
        <Row label="Carbs" value={`${carbG}g`} color="#ffcc44" />
        <Row label="Fat" value={`${fatG}g`} color="#4fc3f7" />
        <Row label="Water" value={`${waterOz} oz (~${(waterOz / 8).toFixed(1)} cups)`} color="#4fc3f7" />
      </div>

      {/* Timeline */}
      {hasGoal && (
        <>
          <div className="sec-title">Estimated Timeline (1 lb/wk)</div>
          <div className="card" style={{padding:"14px 16px"}}>
            <Row label="Diet only" value={friendlyTime(wksDiet)} color="var(--yellow)" />
            {wksCardio && <Row label="Diet + Cardio" value={friendlyTime(wksCardio)} color="var(--green)" />}
            {wksCardio && wksDiet && <Row label="Time saved w/ cardio" value={friendlyTime(wksDiet - wksCardio)} color="var(--accent)" />}
          </div>
        </>
      )}

      {/* Share Card */}
      <SharePlanCard data={data} tdee={tdee} totalBurn={dayData.reduce((s,d)=>s+d.burned,0)} totalStrBurn={strengthDayData.reduce((s,d)=>s+d.burned,0)} />
    </div>
  );
}

const STR_EXPERIENCE = [
  { id:"beginner",     label:"Beginner",      desc:"< 1 year consistent training", gainPerMo:[1.5,2.5], bfMult:1.2 },
  { id:"intermediate", label:"Intermediate",  desc:"1–3 years consistent training", gainPerMo:[0.75,1.5], bfMult:1.0 },
  { id:"advanced",     label:"Advanced",      desc:"3+ years, near genetic potential", gainPerMo:[0.25,0.5], bfMult:0.7 },
];

function StrengthTab({ data, tdee, weightLbs, gender, age, name,
  strengthDayData, totalStrBurn, activeStrDays, avgStrPerDay,
  totalCardio, onUpdateStrength, floor }) {

  const [openDay, setOpenDay] = useState(null);
  const [strExp, setStrExp] = useState("intermediate");
  const allStrEx = [REST_ST, ...STRENGTH_EXERCISES, ...customOf(data.customExercises, "strength")];
  const getEx = id => allStrEx.find(e=>e.id===id) || REST_ST;
  const expObj = STR_EXPERIENCE.find(e=>e.id===strExp);

  // Muscle gain projections — scaled by frequency AND experience
  const freqToGain = (days) => {
    if (days === 0) return [0,0];
    const freqMult = days === 1 ? 0.5 : days <= 3 ? 0.75 : 1.0;
    return [expObj.gainPerMo[0] * freqMult, expObj.gainPerMo[1] * freqMult];
  };
  const [gainLow, gainHigh] = freqToGain(activeStrDays);

  // Body fat reduction — scaled by experience
  const stdDays = 3;
  const bfReductionPer4Wks = activeStrDays > 0
    ? (1.6 / 16) * 4 * (activeStrDays / stdDays) * expObj.bfMult
    : 0;

  // EPOC (after-burn): resistance training elevates metabolism 5–9% for 12–36h
  // Practical estimate: +15% of session calories burned as EPOC
  const epocPerWeek = Math.round(totalStrBurn * 0.15);
  const totalWeeklyBurn = totalStrBurn + totalCardio + epocPerWeek;

  // Compound movement count (push/pull patterns vs accessories/total body)
  const compoundDays = strengthDayData.filter(d => {
    return (d.sessions||[]).some(s => {
      const ex = getEx(s.type);
      return ["Horizontal Push","Horizontal Pull","Vertical Push","Vertical Pull","Lower Push","Lower Pull"].includes(ex.cat);
    });
  }).length;

  const rawColor = { "Horizontal Push":"#ff6b9d","Horizontal Pull":"#4fc3f7","Vertical Push":"#b57bff","Vertical Pull":"#4fffb0","Lower Push":"#ffcc44","Lower Pull":"#ff6b35","Carry":"#ff9444","Core":"#9090c0","Total Body":"#08dce0" };

  return (
    <div className="fu">
      {/* Hero summary */}
      <div className="str-hero">
        <div className="str-hero-icon">🏋️</div>
        <div>
          <div className="str-hero-title">Strength Training Results</div>
          <div className="str-hero-sub">
            {activeStrDays > 0
              ? <>{activeStrDays} training day{activeStrDays!==1?"s":""}/week ·{" "}
                  <strong style={{color:"var(--orange)"}}>{totalStrBurn.toLocaleString()} cal/week</strong> burned ·{" "}
                  +<strong style={{color:"var(--green)"}}>{epocPerWeek} cal EPOC</strong> afterburn</>
              : "No strength days planned — go back to set up your weekly schedule."
            }
          </div>
        </div>
      </div>

      {/* Science callout */}
      <div className="surplus-science" style={{marginBottom:"14px"}}>
        <div className="ss-label">📚 Evidence Base</div>
        <p>
          Calorie burn uses MET values from <strong>Ainsworth et al. (2011)</strong> Compendium of Physical Activities.
          Muscle gain projections are based on <strong>Schoenfeld BJ (2017)</strong> meta-analysis in the
          <em> Journal of Strength & Conditioning Research</em>.
          Body fat reduction rates from <strong>Wewege MA et al. (2022)</strong> systematic review of 116 RCTs
          in <em>Sports Medicine</em> — resistance training reduces BF% by ~1.6% per 12–16 weeks at 3×/week.
          EPOC estimates based on <strong>Bersheim E & Bahr R (2003)</strong> — resistance training elevates
          post-exercise metabolism by 5–9% for 12–36 hours.
        </p>
      </div>

      {/* Experience selector */}
      <div className="sec-title">Your Training Experience</div>
      <div className="exp-grid">
        {STR_EXPERIENCE.map(e=>(
          <button key={e.id} className={`exp-btn${strExp===e.id?" exp-active":""}`} onClick={()=>setStrExp(e.id)}>
            <div className="exp-label">{e.label}</div>
            <div className="exp-desc">{e.desc}</div>
            <div className="exp-gain">~{e.gainPerMo[0]}–{e.gainPerMo[1]} lbs muscle/mo</div>
          </button>
        ))}
      </div>

      {/* Weekly summary stats */}
      {activeStrDays > 0 && (
        <>
          <div className="sec-title">Weekly Strength Summary</div>
          <div className="str-stat-grid">
            <div className="str-stat">
              <div className="str-stat-val c-org">{totalStrBurn.toLocaleString()}</div>
              <div className="str-stat-lbl">cal burned/week</div>
            </div>
            <div className="str-stat">
              <div className="str-stat-val c-acc">{epocPerWeek}</div>
              <div className="str-stat-lbl">EPOC afterburn/week</div>
            </div>
            <div className="str-stat">
              <div className="str-stat-val c-grn">{gainLow}–{gainHigh} lbs</div>
              <div className="str-stat-lbl">muscle/month (est.)</div>
            </div>
            <div className="str-stat">
              <div className="str-stat-val c-yel">{bfReductionPer4Wks > 0 ? `~${bfReductionPer4Wks.toFixed(2)}%` : "—"}</div>
              <div className="str-stat-lbl">body fat reduced/month</div>
            </div>
          </div>

          {/* Compound vs isolation breakdown */}
          {compoundDays > 0 && (
            <div className="str-compound-note">
              <strong>💡 {compoundDays} compound day{compoundDays!==1?"s":""} scheduled</strong> — compound lifts (squat, deadlift, bench, row) recruit more muscle mass per rep, burn more calories, and produce greater hormonal response than isolation work. <em>Research shows compound movements are 30–50% more metabolically costly than isolation exercises.</em>
            </div>
          )}

          {/* Long-term projections */}
          <div className="sec-title">Projected Results Over Time</div>
          <p style={{fontSize:".76rem",color:"var(--muted)",marginBottom:"10px",lineHeight:1.5}}>
            Based on {activeStrDays}×/week training. Muscle gain assumes adequate protein (0.8g/lb) and progressive overload. Body fat reduction assumes a maintained calorie deficit alongside training.
          </p>
          <div className="str-proj-grid">
            {[
              {period:"1 Month",  wks:4.33},
              {period:"3 Months", wks:13  },
              {period:"6 Months", wks:26  },
              {period:"1 Year",   wks:52  },
            ].map(({period, wks})=>{
              const muscLow  = (gainLow  * wks/4.33).toFixed(1);
              const muscHigh = (gainHigh * wks/4.33).toFixed(1);
              const bfRed    = (bfReductionPer4Wks * wks/4.33).toFixed(1);
              const calBurned= Math.round(totalStrBurn * wks);
              return (
                <div key={period} className="str-proj-card">
                  <div className="str-proj-period">{period}</div>
                  <div className="str-proj-row">
                    <span className="str-proj-lbl">Muscle gained</span>
                    <span className="str-proj-val c-grn">+{muscLow}–{muscHigh} lbs</span>
                  </div>
                  <div className="str-proj-row">
                    <span className="str-proj-lbl">BF% reduction</span>
                    <span className="str-proj-val c-yel">~{bfRed}%</span>
                  </div>
                  <div className="str-proj-row">
                    <span className="str-proj-lbl">Total cal burned</span>
                    <span className="str-proj-val c-org">{calBurned.toLocaleString()}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Day-by-day editable cards */}
      <div className="sec-title">Day-by-Day Breakdown</div>
      <p style={{fontSize:".75rem",color:"var(--muted)",marginBottom:"10px"}}>
        💡 Tap any day to change the exercise or duration — calories update instantly.
      </p>
      {strengthDayData.map(({day, sessions:daySessions, burned})=>{
        const allSessions = Array.isArray((data.strength||{})[day]) ? data.strength[day] : [];
        const isRest = allSessions.length === 0;
        const isOpen = openDay === day;
        return (
          <div key={day} className={`day-result-card editable${isOpen?" drc-open":""}`}>
            <div className="drc-header drc-clickable" onClick={()=>setOpenDay(isOpen?null:day)}>
              <div className="drc-day">{day.slice(0,3)}</div>
              <div className="drc-cardio">
                {isRest
                  ? <span style={{color:"var(--muted)"}}>😴 Rest — tap to add training</span>
                  : allSessions.length === 1
                    ? <span>{getEx(allSessions[0].type).icon} {getEx(allSessions[0].type).label} · {allSessions[0].duration}m</span>
                    : <span>{allSessions.length} sessions</span>
                }
              </div>
              {burned>0 && <div className="drc-burn">+{burned}</div>}
              <div className={`drc-chevron${isOpen?" open":""}`}>▼</div>
            </div>
            {isOpen && (
              <div className="drc-edit-body">
                {allSessions.map((sess,idx)=>{
                  const ex = getEx(sess.type);
                  const burn = exBurn(ex, Number(weightLbs), sess.duration);
                  const catColor = rawColor[ex.cat] || "var(--accent)";
                  return (
                    <div key={idx} style={{padding:"10px 0",borderBottom:idx<allSessions.length-1?"1px solid var(--border)":"none"}}>
                      {allSessions.length>1 && (
                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"6px"}}>
                          <span style={{fontSize:".7rem",color:"var(--muted)",fontWeight:700,letterSpacing:"1px",textTransform:"uppercase"}}>Session {idx+1}</span>
                          <button style={{background:"none",border:"none",color:"var(--red)",cursor:"pointer",fontSize:".78rem",fontFamily:"inherit",padding:"2px 6px"}} onClick={()=>{
                            const updated = allSessions.filter((_,i)=>i!==idx);
                            onUpdateStrength(day,null,"_replace",updated);
                          }}>✕ Remove</button>
                        </div>
                      )}
                      <div className="field">
                        <label>Exercise</label>
                        <select value={sess.type} onChange={e=>onUpdateStrength(day,idx,"type",e.target.value)}>
                          {STRENGTH_GROUPS.map(cat=>(
                            <optgroup key={cat} label={cat}>
                              {STRENGTH_EXERCISES.filter(e=>e.cat===cat).map(e=>(
                                <option key={e.id} value={e.id}>{e.icon} {e.label}</option>
                              ))}
                            </optgroup>
                          ))}
                          <CustomOptGroup customExercises={data.customExercises} type="strength" />
                        </select>
                      </div>
                      <div className="field" style={{marginBottom:0}}>
                        <label>Duration</label>
                        <select value={sess.duration} onChange={e=>onUpdateStrength(day,idx,"duration",Number(e.target.value))}>
                          {ST_DURATIONS.map(m=><option key={m} value={m}>{m} minutes</option>)}
                        </select>
                      </div>
                      {ex.note && <div style={{fontSize:".74rem",color:"var(--muted)",marginTop:"6px",padding:"6px 8px",background:"var(--s2)",borderRadius:"8px"}}>🎯 {ex.note}</div>}
                      {burn>0 && (
                        <div className="drc-edit-live">
                          <span>🏋️</span>
                          <div><span className="burn-num">+{burn} cal</span><span style={{color:"var(--muted)",fontSize:".76rem",marginLeft:"6px"}}>session · +~{Math.round(burn*0.15)} EPOC</span></div>
                        </div>
                      )}
                    </div>
                  );
                })}
                <button className="quick-fill-toggle" style={{marginTop:"8px",marginBottom:"4px",borderStyle:"solid",fontSize:".8rem",padding:"10px 14px"}}
                  onClick={()=>onUpdateStrength(day,allSessions.length,"type","bb_squat")}>
                  + Add {allSessions.length>0?"Another":"a"} Session
                </button>
              </div>
            )}
            {/* Burn display */}
            <div style={{padding:"8px 14px 10px",borderTop:"1px solid var(--border)",display:"flex",justifyContent:"space-between",alignItems:"center",fontSize:".8rem"}}>
              <span style={{color:"var(--muted)"}}>{isRest?"Recovery day": allSessions.length===1?getEx(allSessions[0].type).cat:`${allSessions.length} exercises`}</span>
              {burned > 0 && (
                <div style={{textAlign:"right"}}>
                  <span style={{fontFamily:"'Sora',sans-serif",fontSize:"1rem",color:"var(--orange)",letterSpacing:".5px"}}>{burned} cal</span>
                  <span style={{color:"var(--muted)",fontSize:".72rem",marginLeft:"4px"}}>+ ~{Math.round(burned*0.15)} EPOC</span>
                </div>
              )}
            </div>
          </div>
        );
      })}

      {/* Combined total with cardio */}
      {totalCardio > 0 && activeStrDays > 0 && (
        <div className="csumm" style={{borderColor:"rgba(8,220,224,.2)",background:"rgba(8,220,224,.03)"}}>
          <div className="cs-icon">⚡</div>
          <div>
            <div className="cs-title">Combined Weekly Burn</div>
            <div className="cs-body">
              Strength <strong style={{color:"var(--orange)"}}>{totalStrBurn.toLocaleString()} cal</strong>{" "}
              + Cardio <strong style={{color:"var(--orange)"}}>{totalCardio.toLocaleString()} cal</strong>{" "}
              + EPOC <strong style={{color:"var(--accent)"}}>{epocPerWeek.toLocaleString()} cal</strong>{" "}
              = <strong style={{color:"var(--green)"}}>{totalWeeklyBurn.toLocaleString()} total cal/week</strong>
              <br/>
              <span>≈ {(totalWeeklyBurn / 3500).toFixed(2)} lbs of fat burned from exercise alone per week.</span>
            </div>
          </div>
        </div>
      )}

      <p className="footnote">
        Muscle gain estimates assume natural training, adequate protein, and progressive overload.
        Body fat projections from Wewege et al. 2022 meta-analysis (116 RCTs). EPOC based on Bersheim &amp; Bahr 2003.
        Individual results vary based on genetics, sleep, nutrition adherence, and training quality.
      </p>
    </div>
  );
}

// ─── Muscle Building Tab ──────────────────────────────────────────────────────
// Science basis:
//   • Helms ER et al. (2014). "Evidence-based recommendations for natural
//     bodybuilding contest preparation." J Int Soc Sports Nutr 11:20.
//   • Barakat C et al. (2020). "Body Recomposition: Can Trained Individuals
//     Build Muscle and Lose Fat Simultaneously?" Strength Cond J 42(5):7–21.
//   • Morton RW et al. (2018). "A systematic review, meta-analysis and
//     meta-regression of protein supplementation for resistance exercise."
//     Br J Sports Med 52:376–384. → 1.62g/kg (0.73g/lb) optimal protein ceiling.
//   • Slater G & Phillips SM (2011). "Nutrition guidelines for strength sports."
//     J Sports Sci 29(S1):S67–S77.
//   • Lean bulk surplus of 200–500 cal/day supported by Haff & Triplett (2016),
//     NSCA Essentials of Strength Training and Conditioning, 4th Ed.

const EXPERIENCE_LEVELS = [
  { id:"beginner",     label:"Beginner",      desc:"< 1 year of consistent training",        gainPerMo:[1.5, 2.5],  surplusRec:300 },
  { id:"intermediate", label:"Intermediate",  desc:"1–3 years of consistent training",       gainPerMo:[0.75, 1.25],surplusRec:250 },
  { id:"advanced",     label:"Advanced",      desc:"3+ years, near genetic potential",       gainPerMo:[0.25, 0.5], surplusRec:200 },
];

const SURPLUS_OPTIONS_MUSCLE = [200, 250, 300, 350, 400, 500];

function MuscleTab({ tdee, totalBurn, avgBurnPerDay, activeDays, weightLbs, gender, age, name,
  activeStrDays, strengthDayData, totalStrBurn }) {
  const [experience, setExperience] = useState("intermediate");
  const [showCardio, setShowCardio]   = useState(false);
  const [openSuppCat, setOpenSuppCat] = useState(null);
  const [showMuscleDisclaimer, setShowMuscleDisclaimer] = useState(false);
  const [muscleInfo, setMuscleInfo] = useState(null);
  const hasCardio = totalBurn > 0;
  const hasStrength = activeStrDays > 0;
  const exp = EXPERIENCE_LEVELS.find(e => e.id === experience);

  // ── Gender modifier ──
  // Women gain muscle at ~50–60% the rate of men due to lower testosterone
  // (Hubal et al. 2005, Roberts et al. 2020)
  const genderMult = gender === "female" ? 0.55 : 1.0;

  // ── Training frequency factor from Step 5 ──
  // Based on Schoenfeld 2017 meta-analysis: dose-response relationship between
  // weekly training frequency and muscle hypertrophy
  const freqFactor = activeStrDays === 0 ? 0.25  // untrained — minimal stimulus
    : activeStrDays === 1 ? 0.50
    : activeStrDays === 2 ? 0.70
    : activeStrDays <= 4  ? 0.90
    : activeStrDays <= 5  ? 1.00
    : 0.95; // 6–7 days — recovery may limit gains

  // ── Training quality factor from exercise type mix ──
  // Compound movements recruit more muscle mass → greater hypertrophic stimulus
  // Schoenfeld BJ (2010): multi-joint > single-joint for hypertrophy & strength
  const COMPOUND_CATS = ["Horizontal Push","Horizontal Pull","Vertical Push","Vertical Pull","Lower Push","Lower Pull"];
  const allExSessions = (strengthDayData||[]).flatMap(d => d.sessions || []);
  const totalSessions = allExSessions.length;
  const compoundCount = allExSessions.filter(s => COMPOUND_CATS.includes(s.ex?.cat)).length;
  const totalBodyCount = allExSessions.filter(s => s.ex?.cat === "Total Body").length;
  const carryCount = allExSessions.filter(s => s.ex?.cat === "Carry").length;
  const coreCount = allExSessions.filter(s => s.ex?.cat === "Core").length;
  const accessoryCount = allExSessions.filter(s => s.ex?.cat === "Upper Accessory" || s.ex?.cat === "Lower Accessory").length;
  const customCount = allExSessions.filter(s => s.ex?.isCustom).length;

  // Compound=1.0, TotalBody=0.90, Carry=0.85, Accessory=0.55, Core=0.50, Custom=0.65 (unknown)
  const qualityFactor = totalSessions === 0 ? 0.70
    : (compoundCount * 1.0 + totalBodyCount * 0.90 + carryCount * 0.85 + accessoryCount * 0.55 + coreCount * 0.50 + customCount * 0.65) / totalSessions;

  const compoundPct = totalSessions > 0 ? Math.round((compoundCount / totalSessions) * 100) : 0;

  // ── Adjusted gain range (experience × frequency × quality × gender) ──
  const [baseGainLow, baseGainHigh] = exp.gainPerMo;
  const gainLow  = +(baseGainLow  * freqFactor * qualityFactor * genderMult).toFixed(2);
  const gainHigh = +(baseGainHigh * freqFactor * qualityFactor * genderMult).toFixed(2);

  // ── Lean Bulk Calorie Target ──
  const buildSurplus = exp.surplusRec;
  const leanBulkCals = tdee + buildSurplus;
  const leanBulkWithCardio = tdee + buildSurplus + avgBurnPerDay;

  const displayCals = showCardio && hasCardio ? leanBulkWithCardio : leanBulkCals;

  // Fat gain at lean bulk: a well-run lean bulk yields ~1 lb fat per ~2–3 lbs muscle
  // Conservative estimate: 25–35% of weight gained is fat (Barakat 2020)
  const fatGainRatioLow  = 0.20; // best case — especially with cardio
  const fatGainRatioHigh = 0.35;
  const fatPerMoLow  = (gainLow  * fatGainRatioLow).toFixed(2);
  const fatPerMoHigh = (gainHigh * fatGainRatioHigh).toFixed(2);

  // With cardio: cardio helps partition nutrients toward muscle (Barakat 2020)
  // Reduces fat ratio by ~5-10%
  const fatRatioWithCardio = showCardio && hasCardio ? fatGainRatioLow - 0.05 : fatGainRatioHigh;
  const musclePerMo = showCardio && hasCardio
    ? ((gainLow + gainHigh) / 2).toFixed(2)
    : ((gainLow + gainHigh) / 2).toFixed(2);

  // ── Macros for muscle building ──
  // Protein: 0.73–0.8g/lb (Morton et al. 2018 meta-analysis)
  const proteinG  = Math.round(weightLbs * 0.8);
  const proteinCal = proteinG * 4;
  // Fat: 20–30% of calories — keep at 25% for hormone support
  const fatCal   = Math.round(displayCals * 0.25);
  const fatG     = Math.round(fatCal / 9);
  // Carbs: remainder — primary fuel for training
  const carbCal  = Math.max(0, displayCals - proteinCal - fatCal);
  const carbG    = Math.round(carbCal / 4);
  // Fibre, creatine, hydration
  const fibreG   = Math.max(gender === "male" ? 38 : 25, Math.round(displayCals / 1000 * 14));
  const waterOz  = Math.round(weightLbs * 0.6); // slightly higher for muscle building

  // Macro %
  const pctP = Math.round((proteinCal / displayCals) * 100);
  const pctF = Math.round((fatCal     / displayCals) * 100);
  const pctC = Math.round((carbCal    / displayCals) * 100);

  // ── Surplus comparison table: fat gained vs muscle gained ──
  // At each surplus level, per month
  const tableRows = SURPLUS_OPTIONS_MUSCLE.map(s => {
    const netSurplus = showCardio && hasCardio ? Math.max(0, s - avgBurnPerDay) : s;
    const fatGainPerMonth = (netSurplus * 30 / 3500) * fatGainRatioHigh;
    const musclePerMonth  = ((gainLow + gainHigh) / 2);
    const ratio           = musclePerMonth / Math.max(fatGainPerMonth, 0.01);
    return { surplus: s, netSurplus, fatGainPerMonth, musclePerMonth, ratio };
  });

  // Body recomposition note (possible for beginners & overweight)
  const canRecomp = experience === "beginner" && activeStrDays >= 2;

  return (
    <div className="fu">

      {/* Header */}
      <div className="muscle-hero">
        <div className="muscle-hero-icon">💪</div>
        <div>
          <div className="muscle-hero-title">Lean Muscle Building Plan</div>
          <div className="muscle-hero-sub">
            How {name || "you"} can build muscle while keeping body fat low.
            Calories, macros, and projected gains — all in one place.
          </div>
        </div>
      </div>

      {/* Science note */}
      <div className="surplus-science">
        <div className="ss-label">📚 Scientific Basis</div>
        <p>
          Based on <strong>Helms et al. (2014)</strong>, <strong>Barakat et al. (2020)</strong>, and
          <strong> Morton et al. (2018)</strong>. A lean bulk surplus of <strong>200–500 cal/day</strong> above
          maintenance maximizes muscle protein synthesis while minimizing fat accumulation — confirmed by the
          <em> British Journal of Sports Medicine</em> and NSCA guidelines. Projections are adjusted by your
          <strong> actual training plan from Step 5</strong> — training frequency scales the dose-response
          (<strong>Schoenfeld 2017</strong>), and compound movement ratio reflects exercise quality
          (<strong>Schoenfeld 2010</strong>: multi-joint exercises produce greater hypertrophic stimulus than isolation work).
        </p>
      </div>

      {/* Experience selector */}
      <div className="sec-title">Your Training Experience</div>
      <div className="exp-grid">
        {EXPERIENCE_LEVELS.map(e => (
          <button
            key={e.id}
            className={`exp-btn${experience===e.id?" exp-active":""}`}
            onClick={()=>setExperience(e.id)}
          >
            <div className="exp-label">{e.label}</div>
            <div className="exp-desc">{e.desc}</div>
            <div className="exp-gain">~{e.gainPerMo[0]}–{e.gainPerMo[1]} lbs muscle/mo</div>
          </button>
        ))}
      </div>

      {/* Cardio toggle */}
      {hasCardio && (
        <div className="surplus-toggle-wrap" style={{marginBottom:"16px"}}>
          <span className="surplus-toggle-lbl">Include your cardio in the calculation?</span>
          <div className="surplus-toggle-btns">
            <button className={`tl-tbtn${!showCardio?" active":""}`} onClick={()=>setShowCardio(false)}>Lifting Only</button>
            <button className={`tl-tbtn${showCardio?" active":""}`}  onClick={()=>setShowCardio(true)}>Lifting + Cardio</button>
          </div>
          {showCardio && (
            <div className="surplus-cardio-note">
              Your cardio burns ~<strong style={{color:"var(--orange)"}}>{totalBurn.toLocaleString()} cal/week</strong>.
              Adding cardio to a lean bulk improves nutrient partitioning — more calories go to muscle, less to fat.
              Your eating target increases to account for the extra burn.
            </div>
          )}
        </div>
      )}

      {/* Training quality from Step 5 */}
      <div className="sec-title">Your Training Profile</div>
      {hasStrength ? (
        <div className="str-hero" style={{borderColor:"rgba(79,255,176,.18)",background:"rgba(79,255,176,.04)"}}>
          <div className="str-hero-icon">🏋️</div>
          <div>
            <div className="str-hero-title" style={{color:"var(--green)"}}>
              {activeStrDays} Training Day{activeStrDays!==1?"s":""}/Week — {compoundPct}% Compound
            </div>
            <div className="str-hero-sub">
              Your Step 5 workout plan drives these projections. Tap any tile below for a plain-language explanation of what it means and how to improve it.
              {compoundPct < 50 && <><br/><span style={{color:"var(--yellow)"}}>💡 Adding more compound lifts (push/pull movements) would increase your quality score and projected gains.</span></>}
              {activeStrDays < 3 && <><br/><span style={{color:"var(--yellow)"}}>💡 Training {activeStrDays < 2 ? "at least 2–3" : "3–4"} days/week would significantly improve your frequency score.</span></>}
            </div>
          </div>
        </div>
      ) : (
        <div className="str-hero" style={{borderColor:"rgba(255,204,68,.18)",background:"rgba(255,204,68,.04)"}}>
          <div className="str-hero-icon">⚠️</div>
          <div>
            <div className="str-hero-title" style={{color:"var(--yellow)"}}>No Strength Training Set</div>
            <div className="str-hero-sub">
              Go back to Step 5 to add your training plan. Without resistance training, muscle gains are minimal even with a calorie surplus.
              Projections below use a reduced baseline ({(freqFactor*qualityFactor*100).toFixed(0)}% of potential).
            </div>
          </div>
        </div>
      )}
      <div className="str-stat-grid" style={{marginBottom:"4px"}}>
        <div className="str-stat" style={{cursor:"pointer",borderColor:muscleInfo==="freq"?"var(--accent)":"var(--border)"}} onClick={()=>setMuscleInfo(muscleInfo==="freq"?null:"freq")}>
          <div className="str-stat-val" style={{color: freqFactor >= 0.9 ? "var(--green)" : freqFactor >= 0.5 ? "var(--yellow)" : "var(--red)"}}>{(freqFactor*100).toFixed(0)}%</div>
          <div className="str-stat-lbl">Frequency ℹ️</div>
        </div>
        <div className="str-stat" style={{cursor:"pointer",borderColor:muscleInfo==="quality"?"var(--accent)":"var(--border)"}} onClick={()=>setMuscleInfo(muscleInfo==="quality"?null:"quality")}>
          <div className="str-stat-val" style={{color: qualityFactor >= 0.85 ? "var(--green)" : qualityFactor >= 0.6 ? "var(--yellow)" : "var(--red)"}}>{(qualityFactor*100).toFixed(0)}%</div>
          <div className="str-stat-lbl">Quality ℹ️</div>
        </div>
        <div className="str-stat" style={{cursor:"pointer",borderColor:muscleInfo==="gain"?"var(--accent)":"var(--border)"}} onClick={()=>setMuscleInfo(muscleInfo==="gain"?null:"gain")}>
          <div className="str-stat-val c-grn">{gainLow}–{gainHigh}</div>
          <div className="str-stat-lbl">lbs/mo ℹ️</div>
        </div>
        <div className="str-stat" style={{cursor:"pointer",borderColor:muscleInfo==="burn"?"var(--accent)":"var(--border)"}} onClick={()=>setMuscleInfo(muscleInfo==="burn"?null:"burn")}>
          <div className="str-stat-val c-org">{totalStrBurn.toLocaleString()}</div>
          <div className="str-stat-lbl">cal/wk ℹ️</div>
        </div>
      </div>

      {/* Tile explanations */}
      {muscleInfo && (
        <div style={{padding:"14px 16px",background:"rgba(8,220,224,.04)",border:"1.5px solid rgba(8,220,224,.18)",borderRadius:"var(--radius-sm)",marginBottom:"14px",fontSize:".82rem",color:"var(--text-secondary)",lineHeight:1.7,animation:"fadeUp .15s ease both"}}
          onClick={()=>setMuscleInfo(null)}>
          {muscleInfo === "freq" && (<>
            <strong style={{color:"var(--accent)",display:"block",marginBottom:"6px"}}>📅 Frequency Factor — How Often You Train</strong>
            <p style={{marginBottom:"8px"}}>This measures how many days per week you do strength training. More training days means more opportunities for your muscles to be stimulated and grow.</p>
            <p style={{marginBottom:"8px"}}>Research (Schoenfeld 2017) shows a clear relationship: training a muscle group 2× per week produces roughly twice the growth as 1× per week. But there are diminishing returns — going from 5 to 6 days doesn't help as much as going from 2 to 3.</p>
            <div style={{padding:"8px 12px",background:"var(--s2)",borderRadius:"6px",fontSize:".78rem",marginBottom:"6px"}}>
              <strong>Your score: {(freqFactor*100).toFixed(0)}%</strong> — you train <strong>{activeStrDays} day{activeStrDays!==1?"s":""}/week</strong>.
              {freqFactor >= 0.9 ? " That's excellent — you're near the optimal range." : freqFactor >= 0.7 ? " That's solid. Adding 1 more day could help." : freqFactor >= 0.5 ? " There's room to grow — 3-4 days/week is the sweet spot." : " Adding more training days would significantly boost your gains."}
            </div>
            <div style={{fontSize:".7rem",color:"var(--muted)",fontStyle:"italic"}}>Tap anywhere to close</div>
          </>)}

          {muscleInfo === "quality" && (<>
            <strong style={{color:"var(--accent)",display:"block",marginBottom:"6px"}}>🎯 Quality Factor — What Exercises You're Doing</strong>
            <p style={{marginBottom:"8px"}}>Not all exercises build muscle equally. <strong>Compound movements</strong> (like squats, bench press, rows, deadlifts) work multiple large muscle groups at once and produce the strongest growth signal. <strong>Isolation exercises</strong> (like bicep curls, leg extensions, lateral raises) target one muscle and produce less total-body growth stimulus.</p>
            <p style={{marginBottom:"8px"}}>This score looks at the ratio of compound to isolation exercises in your plan. A plan that's 80% compound movements scores higher than one that's 80% isolation.</p>
            <div style={{padding:"8px 12px",background:"var(--s2)",borderRadius:"6px",fontSize:".78rem",marginBottom:"6px"}}>
              <strong>Your score: {(qualityFactor*100).toFixed(0)}%</strong> — your plan is <strong>{compoundPct}% compound</strong> movements.
              {qualityFactor >= 0.85 ? " Great exercise selection — mostly compound lifts." : qualityFactor >= 0.65 ? " Good mix. Adding more compound lifts (squats, presses, rows) would increase this." : " Consider swapping some isolation exercises for compound movements to boost muscle growth."}
            </div>
            {customCount > 0 && <div style={{padding:"6px 10px",background:"rgba(181,123,255,.06)",borderRadius:"6px",fontSize:".75rem",color:"#b57bff",marginBottom:"6px"}}>⭐ {customCount} custom exercise(s) are scored at 65% since we can't verify their muscle-building stimulus.</div>}
            <div style={{fontSize:".7rem",color:"var(--muted)",fontStyle:"italic"}}>Tap anywhere to close</div>
          </>)}

          {muscleInfo === "gain" && (<>
            <strong style={{color:"var(--accent)",display:"block",marginBottom:"6px"}}>💪 Estimated Muscle Gain Per Month</strong>
            <p style={{marginBottom:"8px"}}>This is how much muscle you could realistically gain each month, based on your experience level, training frequency, exercise quality, and gender. It uses the <strong>Aragon/Helms model</strong> — the most respected evidence-based estimate in sports science.</p>
            <p style={{marginBottom:"8px"}}>The range shown ({gainLow}–{gainHigh} lbs/mo) is already adjusted for your specific plan. The more consistently you train with progressive overload (gradually increasing weight), eat adequate protein (~1g per lb bodyweight), and sleep well, the closer you'll be to the upper end.</p>
            <div style={{padding:"8px 12px",background:"var(--s2)",borderRadius:"6px",fontSize:".78rem",marginBottom:"6px"}}>
              <strong>How it's calculated:</strong> Base rate ({baseGainLow}–{baseGainHigh} lbs/mo for {experience} {gender==="female"?"women":"men"}) × Frequency ({(freqFactor*100).toFixed(0)}%) × Quality ({(qualityFactor*100).toFixed(0)}%){gender==="female"?" × Gender (55%)":""} = <strong>{gainLow}–{gainHigh} lbs/mo</strong>
            </div>
            <div style={{fontSize:".72rem",color:"var(--yellow)",marginBottom:"6px"}}>⚠️ This is an estimate — actual muscle gain varies ±30-50% based on genetics, sleep, stress, and other factors no formula can measure.</div>
            <div style={{fontSize:".7rem",color:"var(--muted)",fontStyle:"italic"}}>Tap anywhere to close</div>
          </>)}

          {muscleInfo === "burn" && (<>
            <strong style={{color:"var(--accent)",display:"block",marginBottom:"6px"}}>🔥 Weekly Calorie Burn From Strength Training</strong>
            <p style={{marginBottom:"8px"}}>This is the estimated total calories you burn from all your strength training sessions combined in one week. It's calculated using MET values (a standard measure of exercise intensity) multiplied by your body weight and session duration.</p>
            <p style={{marginBottom:"8px"}}>This number is added to your daily calorie targets on training days — so on days you lift, you can eat slightly more and still hit your goals.</p>
            <div style={{padding:"8px 12px",background:"var(--s2)",borderRadius:"6px",fontSize:".78rem",marginBottom:"6px"}}>
              <strong>Your burn: {totalStrBurn.toLocaleString()} cal/week</strong> from {activeStrDays} training day{activeStrDays!==1?"s":""}. That's roughly <strong>{Math.round(totalStrBurn/Math.max(1,activeStrDays))} cal per session</strong>.
            </div>
            <div style={{fontSize:".72rem",color:"var(--yellow)",marginBottom:"6px"}}>⚠️ Strength training calorie burn is harder to estimate than cardio because rest periods, intensity, and tempo vary widely. These are approximate.</div>
            <div style={{fontSize:".7rem",color:"var(--muted)",fontStyle:"italic"}}>Tap anywhere to close</div>
          </>)}
        </div>
      )}

      {/* Calorie target hero */}
      <div className="muscle-cal-hero">
        <div className="mch-left">
          <div className="mch-lbl">Your Lean Bulk Target</div>
          <div className="mch-cals">{displayCals.toLocaleString()}</div>
          <div className="mch-unit">calories / day</div>
          <div className="mch-breakdown">
            Maintenance {tdee.toLocaleString()} + surplus +{buildSurplus}
            {showCardio && hasCardio && ` + cardio +${avgBurnPerDay}`}
          </div>
        </div>
        <div className="mch-right">
          <div className="mch-box">
            <div className="mch-box-lbl">Expected Muscle</div>
            <div className="mch-box-val muscle">{gainLow}–{gainHigh} lbs</div>
            <div className="mch-box-sub">per month</div>
          </div>
          <div className="mch-box">
            <div className="mch-box-lbl">Fat Gain (lean bulk)</div>
            <div className="mch-box-val fat">{fatPerMoLow}–{fatPerMoHigh} lbs</div>
            <div className="mch-box-sub">per month</div>
          </div>
        </div>
      </div>

      {/* Body recomp note for beginners */}
      {canRecomp && (
        <div className="recomp-note">
          <strong>🔄 Body Recomposition Possible</strong><br/>
          As a beginner, your body can simultaneously build muscle AND lose fat — even at or near maintenance calories.
          This "newbie gains" window typically lasts 6–12 months. Prioritize protein (0.8g/lb) and progressive overload in the gym.
        </div>
      )}

      {/* Macros */}
      <div className="sec-title">Muscle-Building Macros</div>
      <div className="muscle-macro-bar">
        <div style={{width:`${pctP}%`,background:"#ff6b9d",height:"100%"}}></div>
        <div style={{width:`${pctC}%`,background:"#ffcc44",height:"100%"}}></div>
        <div style={{width:`${pctF}%`,background:"#4fc3f7",height:"100%"}}></div>
      </div>
      <div className="macro-bar-legend" style={{marginBottom:"12px"}}>
        <span><span className="macro-dot protein"></span>Protein {pctP}%</span>
        <span><span className="macro-dot carbs"></span>Carbs {pctC}%</span>
        <span><span className="macro-dot fat"></span>Fat {pctF}%</span>
      </div>

      <div className="muscle-macro-grid">
        {[
          { emoji:"🥩", name:"Protein", g:proteinG, cal:proteinCal, cls:"protein",
            note:`0.8g per lb bodyweight — the proven ceiling for maximizing muscle protein synthesis (Morton et al. 2018). This is your most important macro.` },
          { emoji:"🌾", name:"Carbs",   g:carbG,    cal:carbCal,   cls:"carbs",
            note:`Primary fuel for your training sessions. Eat the bulk of your carbs around workouts — before for energy, after for glycogen replenishment.` },
          { emoji:"🥑", name:"Fat",     g:fatG,     cal:fatCal,    cls:"fat",
            note:`25% of total calories. Essential for testosterone and hormone production — going below 20% of calories from fat blunts anabolic hormones.` },
          { emoji:"🥦", name:"Fibre",   g:fibreG,   cal:null,      cls:"fibre",
            note:`Daily minimum for gut health and satiety. High protein diets can cause constipation without adequate fibre.` },
        ].map(m => (
          <div key={m.name} className={`macro-card macro-${m.cls} muscle-macro-card`}>
            <div className="mc-emoji">{m.emoji}</div>
            <div className="mc-name">{m.name}</div>
            <div className="mc-grams">{m.g}<span>g</span></div>
            {m.cal && <div className="mc-cals">{m.cal} kcal</div>}
            {!m.cal && <div className="mc-cals">min / day</div>}
            <div className="mc-why">{m.note}</div>
          </div>
        ))}
      </div>

      {/* Supplement spotlight */}
      {/* Supplements by category — tap to expand */}
      <div className="sec-title">Supplements for Muscle & Body Composition</div>
      <p style={{fontSize:".76rem",color:"var(--muted)",marginBottom:"12px",lineHeight:1.5}}>
        Organized by evidence tier. Tap a category to explore options. Tier 1 = strongest research support.
      </p>
      {[
        { cat:"Tier 1 — Strong Evidence", color:"var(--green)", items:[
          { emoji:"💊", name:"Creatine Monohydrate", dose:"3–5g/day", timing:"Any time (consistency matters)", benefit:"Most studied supplement in sports science. Increases strength output +8%, lean mass, and recovery. Works by replenishing ATP stores in muscles." },
          { emoji:"🥛", name:"Whey Protein", dose:"20–40g per serving, as needed to hit daily goal", timing:"Post-workout or between meals", benefit:"Fast-absorbing complete protein. Whey isolate is best for lactose-sensitive clients. Casein is slow-release for overnight recovery." },
          { emoji:"☕", name:"Caffeine", dose:"3–6mg per kg bodyweight", timing:"30–60 min pre-workout", benefit:"Increases strength, power output, and training volume. Also reduces perceived effort during cardio. Tolerance builds — cycle off 1 week/month." },
          { emoji:"☀️", name:"Vitamin D3 + K2", dose:"2,000–4,000 IU D3 / 100mcg K2", timing:"With a fat-containing meal", benefit:"Supports testosterone, muscle function, bone density, and immune health. 40–70% of adults are deficient. K2 directs calcium to bones, not arteries." },
        ]},
        { cat:"Tier 2 — Moderate Evidence", color:"var(--yellow)", items:[
          { emoji:"🐟", name:"Omega-3 (EPA/DHA)", dose:"2–3g EPA+DHA/day", timing:"With meals", benefit:"Reduces exercise-induced inflammation, supports muscle protein synthesis, and joint health. Get from fish oil or algae-based (vegan)." },
          { emoji:"🌿", name:"Beta-Alanine", dose:"3.2–6.4g/day", timing:"Daily (split doses to reduce tingling)", benefit:"Buffers lactic acid, extending high-rep sets (8–15 rep range). Most effective for sets lasting 60–240 seconds. Harmless tingling is normal." },
          { emoji:"🍉", name:"Citrulline Malate", dose:"6–8g, 30–60 min pre-workout", timing:"Pre-workout", benefit:"Boosts nitric oxide → better blood flow, pumps, and endurance. May improve rep performance by 10–15% on compound lifts." },
          { emoji:"⚡", name:"Magnesium", dose:"200–400mg/day (glycinate or citrate)", timing:"Evening — aids sleep", benefit:"Involved in 300+ enzyme reactions. Depleted by sweat. Supports muscle function, sleep quality, and testosterone production." },
          { emoji:"🔬", name:"Zinc", dose:"15–30mg/day", timing:"With food (avoid with calcium)", benefit:"Critical for testosterone production, immune function, and protein synthesis. Athletes lose zinc through sweat — common deficiency." },
          { emoji:"🌱", name:"Ashwagandha (KSM-66)", dose:"300–600mg/day", timing:"Morning or evening", benefit:"Adaptogen shown to reduce cortisol 15–30%, improve testosterone, increase VO2 max, and enhance recovery. 8-week studies show +strength gains." },
          { emoji:"🧂", name:"Electrolytes", dose:"Based on sweat rate and training duration", timing:"During and after training", benefit:"Sodium, potassium, magnesium lost through sweat. Essential for muscle contractions, hydration, and preventing cramps during intense sessions." },
        ]},
        { cat:"Tier 3 — Emerging / Situational", color:"var(--muted-light)", items:[
          { emoji:"🫐", name:"Tart Cherry Extract", dose:"500mg or 8oz juice, twice daily", timing:"Morning and evening", benefit:"Reduces muscle soreness (DOMS) and inflammation markers. Most useful during high-volume training phases or competition prep." },
          { emoji:"🧬", name:"HMB (Beta-Hydroxy Beta-Methylbutyrate)", dose:"3g/day split into 3 doses", timing:"With meals", benefit:"May reduce muscle breakdown during calorie deficits or intense training. Most effective for beginners or during a cut — less benefit for trained athletes in a surplus." },
          { emoji:"🥤", name:"Collagen Peptides", dose:"10–15g/day", timing:"30–60 min before training with vitamin C", benefit:"Supports tendons, ligaments, and joint health. Especially useful for heavy lifters or those with joint issues. Not a replacement for whey protein." },
          { emoji:"🌿", name:"Rhodiola Rosea", dose:"200–600mg/day", timing:"Morning (stimulating effect)", benefit:"Adaptogen that reduces fatigue and improves endurance. Useful for high-stress periods. May improve time-to-exhaustion by 3–5%." },
          { emoji:"🥬", name:"Beetroot / Nitrate Supplement", dose:"400–500mg nitrate (or 500ml beet juice)", timing:"2–3 hours pre-workout", benefit:"Increases nitric oxide production → improved blood flow and oxygen efficiency. Most beneficial for endurance and high-rep training." },
          { emoji:"😴", name:"Melatonin", dose:"0.5–3mg (start low)", timing:"30–60 min before bed", benefit:"Supports sleep onset — and sleep is when most muscle recovery and growth hormone release happens. Use lowest effective dose to avoid dependency." },
          { emoji:"🦠", name:"Probiotics", dose:"Strain-specific, 10B+ CFU/day", timing:"With food", benefit:"Supports gut health and nutrient absorption. Intense training can compromise gut lining. Look for Lactobacillus and Bifidobacterium strains." },
          { emoji:"🫧", name:"Digestive Enzymes", dose:"With protein-heavy meals", timing:"Start of meal", benefit:"Helps break down protein for better absorption — useful if client reports bloating on high-protein diets. Not needed for everyone." },
        ]},
      ].map(tier => (
        <div key={tier.cat} className="micro-row" style={{marginBottom:"8px"}}>
          <div className="micro-header" onClick={()=>setOpenSuppCat(prev=>prev===tier.cat?null:tier.cat)}>
            <span style={{fontSize:"1rem",fontWeight:700,color:tier.color}}>{tier.items.length}</span>
            <div className="micro-name-wrap">
              <div className="micro-name" style={{color:tier.color}}>{tier.cat}</div>
              <div className="micro-amount">{tier.items.map(i=>i.name).join(" · ")}</div>
            </div>
            <div className={`micro-chevron${openSuppCat===tier.cat?" open":""}`}>▼</div>
          </div>
          {openSuppCat===tier.cat && (
            <div style={{padding:"8px 0"}}>
              <div className="supp-grid">
                {tier.items.map(s=>(
                  <div key={s.name} className="supp-card">
                    <div className="sc2-header">
                      <span className="sc2-emoji">{s.emoji}</span>
                      <div>
                        <div className="sc2-name">{s.name}</div>
                      </div>
                    </div>
                    <div className="sc2-row"><span className="sc2-lbl">Dose</span><span className="sc2-val">{s.dose}</span></div>
                    <div className="sc2-row"><span className="sc2-lbl">Timing</span><span className="sc2-val">{s.timing}</span></div>
                    <div className="sc2-benefit">{s.benefit}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ))}

      {/* Surplus vs fat gain table */}
      <div className="sec-title">Surplus Size: Muscle vs. Fat Gain</div>
      <p style={{fontSize:".76rem",color:"var(--muted)",marginBottom:"10px",lineHeight:1.5}}>
        How different lean bulk surpluses compare — projected muscle gain, fat gain, and muscle-to-fat ratio per month as a {exp.label.toLowerCase()} trainee.
        {showCardio && hasCardio && " Cardio offsets some surplus, reducing fat gain."}
      </p>
      <div className="surplus-table-wrap">
        <div className="muscle-table">
          <div className="mt-header">
            <div className="mt-label-col">Daily Surplus</div>
            <div className="mt-col">Total Cals</div>
            <div className="mt-col">Muscle/mo</div>
            <div className="mt-col">Fat/mo</div>
            <div className="mt-col">M:F Ratio</div>
          </div>
          {tableRows.map(r => {
            const isRec = r.surplus === buildSurplus;
            const mfRatio = (((gainLow+gainHigh)/2) / Math.max(r.fatGainPerMonth,0.01)).toFixed(1);
            const mfColor = r.fatGainPerMonth < 0.3 ? "var(--green)" : r.fatGainPerMonth < 0.6 ? "var(--yellow)" : "var(--orange)";
            return (
              <div key={r.surplus} className={`mt-row${isRec?" mt-row-rec":""}`}>
                <div className="mt-label-col">
                  <span className="mt-surplus">+{r.surplus}</span>
                  <span className="mt-unit"> cal/day</span>
                  {isRec && <span className="mt-rec-badge">Recommended</span>}
                  {showCardio && hasCardio && r.netSurplus < r.surplus && (
                    <div style={{fontSize:".6rem",color:"var(--accent)"}}>net: +{r.netSurplus}</div>
                  )}
                </div>
                <div className="mt-col" style={{color:"var(--accent)",fontFamily:"'Sora',sans-serif",fontSize:"1rem"}}>{(tdee + r.surplus + (showCardio&&hasCardio?avgBurnPerDay:0)).toLocaleString()}</div>
                <div className="mt-col" style={{color:"var(--green)",fontFamily:"'Sora',sans-serif",fontSize:".95rem"}}>{((gainLow+gainHigh)/2).toFixed(2)} lbs</div>
                <div className="mt-col" style={{color:mfColor,fontFamily:"'Sora',sans-serif",fontSize:".95rem"}}>{r.fatGainPerMonth.toFixed(2)} lbs</div>
                <div className="mt-col" style={{color:mfColor,fontFamily:"'Sora',sans-serif",fontSize:".95rem"}}>{mfRatio}:1</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Projection timeline */}
      <div className="sec-title" style={{marginTop:"18px"}}>Long-Term Projection</div>
      <div className="muscle-timeline">
        {[3, 6, 12].map(months => {
          const muscleGained = ((gainLow+gainHigh)/2) * months;
          const fatGained    = (buildSurplus * 30 / 3500 * fatGainRatioHigh) * months * (showCardio&&hasCardio?0.85:1);
          const netWeight    = muscleGained + fatGained;
          return (
            <div key={months} className="mtl-card">
              <div className="mtl-period">{months} Month{months>1?"s":""}</div>
              <div className="mtl-row"><span className="mtl-lbl">Muscle gained</span><span className="mtl-val muscle">+{muscleGained.toFixed(1)} lbs</span></div>
              <div className="mtl-row"><span className="mtl-lbl">Fat gained</span><span className="mtl-val fat">+{fatGained.toFixed(1)} lbs</span></div>
              <div className="mtl-row"><span className="mtl-lbl">Net weight</span><span className="mtl-val"  style={{color:"var(--accent)"}}>+{netWeight.toFixed(1)} lbs</span></div>
              <div className="mtl-bar">
                <div className="mtl-muscle-bar" style={{width:`${Math.round((muscleGained/netWeight)*100)}%`}}></div>
                <div className="mtl-fat-bar"    style={{width:`${Math.round((fatGained/netWeight)*100)}%`}}></div>
              </div>
              <div className="mtl-bar-legend">
                <span style={{color:"var(--green)"}}>■ {Math.round((muscleGained/netWeight)*100)}% muscle</span>
                <span style={{color:"var(--orange)"}}>■ {Math.round((fatGained/netWeight)*100)}% fat</span>
              </div>
            </div>
          );
        })}
      </div>

      <p className="footnote" style={{marginTop:"14px"}}>
        Muscle gain rates based on Helms et al. (2014) and Barakat et al. (2020) using trained natural lifter averages.
        Fat gain estimates assume a well-structured lean bulk at the recommended surplus with progressive resistance training.
        Supplement evidence ratings based on ISSN Position Stands.
      </p>

      {/* ── Prominent Muscle Disclaimer Dropdown ── */}
      <div style={{marginTop:"14px",borderRadius:"var(--radius-sm)",overflow:"hidden",border:"2px solid var(--yellow)",background:"rgba(255,204,68,.06)"}}>
        <button onClick={()=>setShowMuscleDisclaimer(v=>!v)} style={{
          width:"100%",padding:"14px 16px",border:"none",cursor:"pointer",
          background:"rgba(255,204,68,.1)",color:"var(--yellow)",
          fontFamily:"'Sora',sans-serif",fontSize:"1.05rem",letterSpacing:"2px",
          display:"flex",alignItems:"center",justifyContent:"space-between",
          transition:"all .15s",
        }}>
          <span>⚠️ DISCLAIMER — Muscle Gain Estimates</span>
          <span style={{fontSize:".85rem",fontFamily:"DM Sans,sans-serif",fontWeight:600,padding:"4px 10px",borderRadius:"6px",background:showMuscleDisclaimer?"rgba(255,204,68,.15)":"rgba(255,204,68,.08)",border:"1px solid rgba(255,204,68,.3)"}}>
            {showMuscleDisclaimer ? "Hide ▲" : "Read This ▼"}
          </span>
        </button>

        {showMuscleDisclaimer && (
          <div style={{padding:"16px 18px",fontSize:".8rem",color:"var(--muted)",lineHeight:1.7,animation:"fadeUp .15s ease both"}}>
            <div style={{fontSize:".92rem",fontWeight:700,color:"var(--yellow)",marginBottom:"10px"}}>Why Muscle Gain Is Harder to Predict Than Weight Loss</div>

            <p style={{marginBottom:"12px"}}>
              <strong style={{color:"var(--text)"}}>Calorie burn prediction is reasonably accurate</strong> — we have decades of MET research, the Mifflin-St Jeor equation, and energy balance physics. If you burn more than you eat, you lose weight. The math is solid within a margin of ±10–15%.
            </p>

            <p style={{marginBottom:"12px"}}>
              <strong style={{color:"var(--text)"}}>Muscle gain prediction is fundamentally different.</strong> No formula in existence — not ours, not any app's — can accurately tell you "this exercise will build X pounds of muscle." Muscle growth depends on:
            </p>

            <div style={{padding:"10px 14px",background:"var(--s2)",borderRadius:"8px",marginBottom:"12px",fontSize:".78rem",lineHeight:1.8}}>
              • <strong style={{color:"var(--text)"}}>Genetics</strong> — muscle fiber type distribution, bone structure, natural hormone levels<br/>
              • <strong style={{color:"var(--text)"}}>Hormones</strong> — testosterone, growth hormone, IGF-1 (vary greatly by individual)<br/>
              • <strong style={{color:"var(--text)"}}>Progressive overload</strong> — are you lifting heavier over time? (we can't measure this)<br/>
              • <strong style={{color:"var(--text)"}}>Protein synthesis</strong> — how your body specifically responds to training stimulus<br/>
              • <strong style={{color:"var(--text)"}}>Sleep quality</strong> — most muscle repair and growth happens during deep sleep<br/>
              • <strong style={{color:"var(--text)"}}>Stress levels</strong> — cortisol can significantly impair muscle growth<br/>
              • <strong style={{color:"var(--text)"}}>Age</strong> — muscle-building capacity declines with age<br/>
              • <strong style={{color:"var(--text)"}}>Training history</strong> — beginners gain faster; advanced lifters are near their ceiling
            </div>

            <div style={{fontSize:".92rem",fontWeight:700,color:"var(--accent)",marginBottom:"8px"}}>What Our Formula Uses</div>

            <p style={{marginBottom:"12px"}}>
              Glide uses the <strong style={{color:"var(--text)"}}>Aragon/Helms model</strong> — the most respected evidence-based muscle gain rate model in sports science. We adjust it for:
            </p>

            <div style={{padding:"10px 14px",background:"var(--s2)",borderRadius:"8px",marginBottom:"12px",fontSize:".78rem",lineHeight:1.8}}>
              • <strong style={{color:"var(--text)"}}>Gender</strong> — women gain muscle at ~50–60% the rate of men (Hubal et al. 2005){gender === "female" ? " — this is applied to your projections" : ""}<br/>
              • <strong style={{color:"var(--text)"}}>Training experience</strong> — beginners gain faster than advanced lifters<br/>
              • <strong style={{color:"var(--text)"}}>Workout frequency</strong> — more training days = more stimulus (Schoenfeld 2017)<br/>
              • <strong style={{color:"var(--text)"}}>Exercise selection quality</strong> — compound movements (squats, presses, rows) drive more growth than isolation exercises (curls, extensions)
              {customCount > 0 && <><br/>• <strong style={{color:"#b57bff"}}>⭐ Custom exercises</strong> — assigned a moderate quality factor (0.65) since we cannot verify their muscle-building stimulus</>}
            </div>

            <div style={{fontSize:".92rem",fontWeight:700,color:"var(--green)",marginBottom:"8px"}}>What This Means for You</div>

            <p style={{marginBottom:"12px"}}>
              The muscle gain projections in Glide are <strong style={{color:"var(--text)"}}>population averages, not individual guarantees</strong>. Your actual results may be 30–50% higher or lower than projected depending on the factors listed above.
            </p>

            <p style={{marginBottom:"12px"}}>
              <strong style={{color:"var(--text)"}}>Use these numbers as a directional guide, not a promise.</strong> Track your actual progress through regular check-ins, body measurements, progress photos, and strength improvements. If your real results differ significantly from projections, adjust your training and nutrition plan accordingly.
            </p>

            <div style={{padding:"12px 14px",background:"rgba(255,204,68,.06)",borderRadius:"8px",border:"1px solid rgba(255,204,68,.2)",fontSize:".78rem",lineHeight:1.6}}>
              <strong style={{color:"var(--yellow)"}}>⚠️ Not Medical or Professional Advice:</strong> All muscle gain projections, macro recommendations, supplement information, and training suggestions in Glide are for <strong style={{color:"var(--text)"}}>educational and coaching purposes only</strong>. They are not a substitute for guidance from a certified personal trainer, registered dietitian, or physician. Always consult a qualified professional before making significant changes to your training or nutrition program.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Surplus Tab ──────────────────────────────────────────────────────────────
// Science basis:
//   • Wishnofsky M (1958). "Caloric equivalents of gained or lost weight."
//     Am J Clin Nutr 6(5):542-546. The foundational 3,500 cal/lb fat model.
//   • Hall KD et al. (2011). "Quantification of the effect of energy imbalance
//     on bodyweight." The Lancet 378(9793):826-837. Confirms the model's validity
//     for practical short-to-medium-term projections.
//   • The American Council on Exercise (ACE) and ACSM both cite 3,500 kcal ≈ 1 lb
//     of body fat as the standard clinical and coaching reference.

const SURPLUS_AMOUNTS = [100, 200, 300, 400, 500, 750, 1000];
const FAT_GAIN_LBS    = [1, 2, 3, 4, 5, 6];

function SurplusTab({ tdee, totalBurn, avgBurnPerDay, activeDays, name }) {
  const [showCardio, setShowCardio] = useState(false);
  const hasCardio = totalBurn > 0;

  // Net surplus per day accounting for cardio
  // If exercising, average daily cardio burn partially offsets the surplus
  const netSurplus = (surplus) => showCardio && hasCardio
    ? Math.max(0, surplus - avgBurnPerDay)
    : surplus;

  // Weeks to gain X lbs of fat at a given daily surplus
  // Formula: (lbs × 3500) / daily_surplus = days → / 7 = weeks
  const weeksToGain = (surplus, lbs) => {
    const net = netSurplus(surplus);
    if (net <= 0) return null; // cardio fully offsets
    return (lbs * 3500) / net / 7;
  };

  const fmtTime = (weeks) => {
    if (weeks === null) return "Offset ✓";
    if (weeks < 1)  return `< 1 wk`;
    if (weeks < 8)  return `~${Math.round(weeks)} wk${Math.round(weeks)!==1?"s":""}`;
    const mo = Math.round(weeks / 4.33);
    return `~${mo} mo`;
  };

  // Color scale: green (slow gain) → red (fast gain)
  const cellColor = (weeks) => {
    if (weeks === null) return "var(--green)";
    if (weeks > 20) return "var(--green)";
    if (weeks > 12) return "#9fff70";
    if (weeks > 8)  return "var(--yellow)";
    if (weeks > 4)  return "var(--orange)";
    return "var(--red)";
  };

  const surplusLabel = (s) => `+${s} cal`;

  return (
    <div className="fu">
      {/* Header */}
      <div className="surplus-hero">
        <div className="surplus-hero-icon">⚠️</div>
        <div>
          <div className="surplus-hero-title">Calorie Surplus = Unwanted Fat Gain</div>
          <div className="surplus-hero-sub">
            Eating consistently above maintenance ({tdee.toLocaleString()} cal/day) without a plan leads to fat accumulation — not muscle. This shows exactly how fast it adds up.
          </div>
        </div>
      </div>

      {/* Science note */}
      <div className="surplus-science">
        <div className="ss-label">📚 What This Is — and Why It Matters</div>
        <p>
          Unlike the <strong>💪 Muscle tab</strong> which shows a <em>planned</em> surplus for muscle building,
          this tab shows what happens when someone <strong>unintentionally overeats</strong> — eating more than their
          body burns without a structured training plan to direct those extra calories toward muscle.
          In that scenario, virtually all excess calories are stored as body fat.
          Based on <strong>Wishnofsky (1958)</strong> and validated by <strong>Hall et al. in The Lancet (2011)</strong> —
          the standard 3,500 kcal = 1 lb of fat model used by ACE, ACSM, and registered dietitians worldwide.
        </p>
      </div>

      {/* Cardio toggle */}
      {hasCardio && (
        <div className="surplus-toggle-wrap">
          <span className="surplus-toggle-lbl">Show effect of your cardio?</span>
          <div className="surplus-toggle-btns">
            <button className={`tl-tbtn${!showCardio?" active":""}`} onClick={()=>setShowCardio(false)}>No Exercise</button>
            <button className={`tl-tbtn${showCardio?" active":""}`}  onClick={()=>setShowCardio(true)}>With My Cardio</button>
          </div>
          {showCardio && (
            <div className="surplus-cardio-note">
              Your {activeDays}-day cardio plan burns ~<strong style={{color:"var(--orange)"}}>{totalBurn.toLocaleString()} cal/week</strong> (avg +{avgBurnPerDay} cal/day).
              This offsets some of the surplus — but overeating still adds fat if the surplus exceeds your burn.
            </div>
          )}
        </div>
      )}

      {/* Main table */}
      <div className="sec-title">How Long to Gain Each Amount of Fat</div>
      <p style={{fontSize:".76rem",color:"var(--muted)",marginBottom:"10px",lineHeight:1.5}}>
        Read across a row to see how quickly fat accumulates at a given daily overage.
        {showCardio && hasCardio && " Values shown are net surplus after your cardio burn is subtracted."}
      </p>

      <div className="surplus-table-wrap">
        <div className="surplus-table">
          {/* Header row */}
          <div className="st-header-row">
            <div className="st-corner">Daily Surplus →<br/><span>Fat Goal ↓</span></div>
            {SURPLUS_AMOUNTS.map(s => (
              <div key={s} className="st-col-header">
                <div className="st-surplus-num">+{s}</div>
                <div className="st-surplus-unit">cal/day</div>
                {showCardio && hasCardio && netSurplus(s) !== s && (
                  <div className="st-net-surplus">net: +{netSurplus(s)}</div>
                )}
              </div>
            ))}
          </div>

          {/* Data rows */}
          {FAT_GAIN_LBS.map(lbs => (
            <div key={lbs} className="st-data-row">
              <div className="st-row-label">
                <span className="st-lbs">{lbs} lb{lbs>1?"s":""}</span>
                <span className="st-fat-label">of fat</span>
              </div>
              {SURPLUS_AMOUNTS.map(s => {
                const wks = weeksToGain(s, lbs);
                const clr = cellColor(wks);
                return (
                  <div key={s} className="st-cell" style={{color: clr}}>
                    {fmtTime(wks)}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {/* Per-surplus breakdown cards */}
      <div className="sec-title" style={{marginTop:"20px"}}>Surplus Breakdown</div>
      <p style={{fontSize:".76rem",color:"var(--muted)",marginBottom:"10px",lineHeight:1.5}}>
        Each card shows what eating that amount over maintenance means per week and per year.
      </p>
      <div className="surplus-cards">
        {SURPLUS_AMOUNTS.map(s => {
          const net      = netSurplus(s);
          const lbsPerWk = net > 0 ? (net * 7 / 3500).toFixed(2) : "0";
          const lbsPerMo = net > 0 ? (net * 30 / 3500).toFixed(1) : "0";
          const lbsPerYr = net > 0 ? (net * 365 / 3500).toFixed(1) : "0";
          const isOffset = net <= 0;
          return (
            <div key={s} className={`surplus-card${isOffset?" surplus-card-offset":""}`}>
              <div className="sc-surplus">{surplusLabel(s)}<span className="sc-surplus-unit">/day</span></div>
              {isOffset ? (
                <div className="sc-offset">✅ Your cardio fully offsets this surplus</div>
              ) : (
                <>
                  <div className="sc-row">
                    <span className="sc-label">Per week</span>
                    <span className="sc-val" style={{color:"var(--yellow)"}}>{lbsPerWk} lbs fat</span>
                  </div>
                  <div className="sc-row">
                    <span className="sc-label">Per month</span>
                    <span className="sc-val" style={{color:"var(--orange)"}}>{lbsPerMo} lbs fat</span>
                  </div>
                  <div className="sc-row">
                    <span className="sc-label">Per year</span>
                    <span className="sc-val" style={{color:"var(--red)"}}>{lbsPerYr} lbs fat</span>
                  </div>
                  {showCardio && hasCardio && net < s && (
                    <div className="sc-cardio-note">Cardio saves {s - net} cal/day</div>
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>

      {/* Takeaway */}
      <div className="surplus-takeaway">
        <div className="st-icon">💡</div>
        <div>
          <div className="st-title">The Bottom Line</div>
          <p className="st-body">
            Even a modest daily overage compounds fast. <strong>+200 cal/day</strong> — the equivalent of a small handful of nuts or a glass of juice — adds roughly <strong style={{color:"var(--orange)"}}>
            {showCardio && hasCardio && netSurplus(200) === 0 ? "nothing (your cardio covers it)" : `${(netSurplus(200) * 365 / 3500).toFixed(1)} lbs of fat per year`}
            </strong> without adjustments.
            Consistency in both diet and exercise is what keeps the scale from creeping up.
          </p>
        </div>
      </div>

      <p className="footnote">
        Based on Wishnofsky (1958) and Hall et al., The Lancet (2011). The 3,500 kcal/lb model is an approximation —
        actual fat gain varies with individual metabolic rate, body composition, and hormonal factors.
        Values are estimates intended for educational and coaching purposes, not medical advice.
      </p>
    </div>
  );
}

// ─── Nutrients Tab ────────────────────────────────────────────────────────────

function NutrientsTab({ weightLbs, gender, age, tdee, totalBurn, name, targets, floor, avgBurnPerDay, avgStrPerDay = 0,
  activeDays = 0, activeStrDays = 0, dayData = [], strengthDayData = [] }) {
  const [deficitChoice, setDeficitChoice] = useState(500);
  const [openMicro, setOpenMicro] = useState(null);
  const [openFoodCat, setOpenFoodCat] = useState(null);

  // Calorie target for chosen deficit (with avg cardio + strength burn added)
  const avgTotalBurn = avgBurnPerDay + avgStrPerDay;
  const targetCals = floor(tdee - deficitChoice + avgTotalBurn);

  // ── Macro calculations ──
  // Protein: 0.8g per lb bodyweight for maintenance, 1.0g for loss (muscle sparing)
  const proteinMultiplier = deficitChoice > 0 ? 1.0 : 0.8;
  const proteinG  = Math.round(weightLbs * proteinMultiplier);
  const proteinCal = proteinG * 4;

  // Fat: 25–30% of target cals (use 28%)
  const fatCal = Math.round(targetCals * 0.28);
  const fatG   = Math.round(fatCal / 9);

  // Carbs: remaining
  const carbCal = Math.max(0, targetCals - proteinCal - fatCal);
  const carbG   = Math.round(carbCal / 4);

  // Fibre: 14g per 1000 cal, min 21–38g by gender
  const fibreG = Math.max(gender === "male" ? 38 : 25, Math.round(targetCals / 1000 * 14));

  // Macro percentages
  const pctProtein = Math.round((proteinCal / targetCals) * 100);
  const pctFat     = Math.round((fatCal     / targetCals) * 100);
  const pctCarbs   = Math.round((carbCal    / targetCals) * 100);

  // ── Activity analysis for personalized micronutrient ranking ──
  const isMale    = gender === "male";
  const over40    = age >= 40;
  const over50    = age >= 50;
  const over70    = age >= 70;
  const isCutting = deficitChoice > 0;
  const isHeavyCardio = activeDays >= 4;
  const doesEndurance = dayData.some(d=>(d.sessions||[]).some(s=>["treadmill_run","treadmill_jog","outdoor_jog","outdoor_run","cycling_vig","swim_hard","rowing_hard"].includes(s?.type)));
  const isHeavySweater = isHeavyCardio || dayData.some(d=>(d.sessions||[]).some(s=>["hiit","boxing_bag","kickboxing","jump_rope","jump_rope_fast","assault_bike","crossfit"].includes(s?.type)));
  const liftsHeavy = (strengthDayData||[]).some(d=>(d.sessions||[]).some(s=>["Horizontal Push","Horizontal Pull","Vertical Push","Vertical Pull","Lower Push","Lower Pull"].includes(s?.ex?.cat)));
  const doesHighImpact = dayData.some(d=>(d.sessions||[]).some(s=>["treadmill_run","outdoor_run","basketball","soccer","jump_rope","jump_rope_fast","treadmill_sprint"].includes(s?.type)));
  const trainsDays = activeDays + activeStrDays;

  // Relevance scorer — higher = more important for THIS client
  const score = (conditions) => conditions.filter(Boolean).length;

  const micros = [
    { id:"vitd", name:"Vitamin D", emoji:"☀️", amount:over70?800:600, unit:"IU", category:"Vitamin",
      relevance: score([true, liftsHeavy, over40, isCutting, activeStrDays>0]),
      why:"Supports bone density, immune function, testosterone, and muscle recovery. 40–70% of adults are deficient — especially indoor trainers.",
      foods:["Salmon (3oz = 570 IU)","Egg yolks","Fortified milk","Tuna","Sardines","Beef liver","Mushrooms (UV-exposed)"],
      tip:"Best obtained through sunlight or supplementation. Pair with Vitamin K2 for optimal absorption.",
      personalNote: liftsHeavy ? "🏋️ Critical for strength athletes — supports testosterone and muscle repair." : over40 ? "⚠️ Absorption decreases with age — supplementation recommended." : null },
    { id:"vitc", name:"Vitamin C", emoji:"🍊", amount:isMale?90:75, unit:"mg", category:"Vitamin",
      relevance: score([true, doesHighImpact, liftsHeavy, isHeavyCardio]),
      why:"Essential for collagen synthesis (connective tissue repair), immune support, and iron absorption from plant foods.",
      foods:["Red bell pepper (1 cup = 190mg)","Kiwi","Broccoli","Strawberries","Oranges","Guava","Brussels sprouts","Pineapple"],
      tip:"Spread intake throughout the day — the body excretes excess within hours.",
      personalNote: doesHighImpact ? "🦵 High-impact training increases collagen turnover — extra C supports joint repair." : null },
    { id:"vitb12", name:"Vitamin B12", emoji:"🩸", amount:2.4, unit:"mcg", category:"Vitamin",
      relevance: score([true, doesEndurance, over50]),
      why:"Critical for red blood cell production, nerve function, and energy metabolism. Deficiency causes fatigue.",
      foods:["Beef (3oz = 2.4mcg)","Salmon","Dairy products","Eggs","Fortified cereals","Nutritional yeast","Clams (3oz = 84mcg)"],
      tip:"If plant-based, supplementation is strongly recommended.",
      personalNote: doesEndurance ? "🏃 Endurance athletes need optimal B12 for oxygen-carrying capacity." : null },
    { id:"vita", name:"Vitamin A", emoji:"🥕", amount:isMale?900:700, unit:"mcg RAE", category:"Vitamin",
      relevance: score([true, isCutting]),
      why:"Supports immune health, vision, and skin integrity. Plays a role in protein synthesis and cell growth.",
      foods:["Sweet potato (1 med = 1403mcg)","Carrots","Beef liver","Spinach","Kale","Cantaloupe","Mango"],
      tip:"Get from whole food sources. High-dose supplementation can be toxic.",
      personalNote: null },
    { id:"vite", name:"Vitamin E", emoji:"🌻", amount:15, unit:"mg", category:"Vitamin",
      relevance: score([isHeavyCardio, doesEndurance, over40]),
      why:"Antioxidant that protects cells from exercise-induced oxidative stress. Supports immune function and skin health.",
      foods:["Sunflower seeds (1oz = 7.4mg)","Almonds (1oz = 7.3mg)","Spinach","Avocado","Wheat germ oil","Peanut butter","Hazelnuts"],
      tip:"Best from food sources. Supplementation above 400 IU/day not recommended.",
      personalNote: isHeavyCardio ? "🔥 Intense training generates free radicals — vitamin E helps neutralize oxidative damage." : null },
    { id:"vitk", name:"Vitamin K", emoji:"🥬", amount:isMale?120:90, unit:"mcg", category:"Vitamin",
      relevance: score([liftsHeavy, over40, doesHighImpact]),
      why:"Essential for blood clotting and directing calcium into bones (not arteries). K2 is especially important for bone density.",
      foods:["Kale (1 cup = 547mcg)","Spinach","Broccoli","Brussels sprouts","Natto (K2)","Fermented foods","Green peas"],
      tip:"K1 from greens, K2 from fermented foods. If supplementing D3, always pair with K2.",
      personalNote: liftsHeavy ? "🦴 Heavy lifting demands strong bones — K2 ensures calcium goes where it's needed." : null },
    { id:"vitb6", name:"Vitamin B6", emoji:"🫘", amount:over50?1.7:1.3, unit:"mg", category:"Vitamin",
      relevance: score([true, liftsHeavy, isCutting]),
      why:"Key role in protein metabolism and amino acid synthesis — directly tied to muscle building. Also supports neurotransmitter production.",
      foods:["Chicken breast (3oz = 0.5mg)","Salmon","Tuna","Chickpeas (1 cup = 1.1mg)","Potatoes","Banana","Turkey"],
      tip:"High-protein diets increase B6 requirements. Most people get enough through meat and legumes.",
      personalNote: isCutting ? "📉 Higher protein during a cut means higher B6 demand — ensure adequate intake." : null },
    { id:"folate", name:"Folate (B9)", emoji:"🥦", amount:400, unit:"mcg DFE", category:"Vitamin",
      relevance: score([!isMale, doesEndurance]),
      why:"Essential for DNA synthesis and red blood cell formation. Critical for cell division during recovery and adaptation.",
      foods:["Lentils (1 cup = 358mcg)","Black beans","Spinach","Asparagus","Avocado","Fortified cereals","Edamame","Beets"],
      tip:"Especially important for women of reproductive age. Folate-rich foods also tend to be fiber-rich.",
      personalNote: !isMale ? "♀ Women need consistent folate for cell health and blood formation." : null },
    { id:"calcium", name:"Calcium", emoji:"🦴", amount:(over50&&!isMale)||over70?1200:1000, unit:"mg", category:"Mineral",
      relevance: score([true, liftsHeavy, doesHighImpact, over40, !isMale]),
      why:"Builds and maintains bone density, supports muscle contraction and nerve signaling. Muscles use calcium with every rep.",
      foods:["Greek yogurt (1 cup = 415mg)","Milk","Mozzarella","Canned sardines","Fortified plant milk","Tofu (calcium-set)","Kale","Broccoli"],
      tip:"Absorbs best in doses under 500mg. Spread across meals.",
      personalNote: doesHighImpact ? "🏃 High-impact activities stress bones — adequate calcium prevents stress fractures." : liftsHeavy ? "🏋️ Heavy lifting builds bone when calcium is adequate — without it, bone density suffers." : null },
    { id:"iron", name:"Iron", emoji:"💪", amount:(!isMale&&!over50)?18:8, unit:"mg", category:"Mineral",
      relevance: score([true, doesEndurance, !isMale, isHeavyCardio]),
      why:"Carries oxygen to working muscles. Low iron = fatigue, poor performance, and slower recovery.",
      foods:["Beef (3oz = 2.1mg)","Lentils (1 cup = 6.6mg)","Spinach","Tofu","Fortified cereals","Pumpkin seeds","Dark chocolate","Chickpeas"],
      tip:"Pair plant-based iron with Vitamin C for 300% better absorption. Avoid coffee/tea within 1 hour of iron-rich meals.",
      personalNote: doesEndurance ? "🏃 Endurance training increases iron loss through sweat and foot-strike hemolysis — monitor levels." : (!isMale&&!over50) ? "♀ Women of reproductive age need 2x more iron than men." : null },
    { id:"magnesium", name:"Magnesium", emoji:"⚡", amount:isMale?(over50?420:400):(over50?320:310), unit:"mg", category:"Mineral",
      relevance: score([true, liftsHeavy, isHeavySweater, trainsDays>=4]),
      why:"Involved in 300+ enzyme reactions including protein synthesis, muscle function, blood sugar control, and energy production. Depleted through sweat.",
      foods:["Pumpkin seeds (1oz = 156mg)","Almonds","Dark chocolate","Spinach","Black beans","Quinoa","Cashews","Avocado"],
      tip:"Magnesium glycinate or citrate supplements are well-absorbed. Take at night — supports sleep quality.",
      personalNote: isHeavySweater ? "💦 Heavy sweating depletes magnesium fast — active clients often need supplementation." : liftsHeavy ? "🏋️ Magnesium supports muscle contractions and recovery — critical for heavy lifters." : null },
    { id:"potassium", name:"Potassium", emoji:"🍌", amount:isMale?3400:2600, unit:"mg", category:"Mineral",
      relevance: score([true, isHeavySweater, isHeavyCardio]),
      why:"Regulates fluid balance, muscle contractions, and nerve signals. Prevents cramping and supports heart health.",
      foods:["Baked potato (926mg)","Avocado (485mg)","Banana (422mg)","Spinach","Salmon","Sweet potato","Coconut water","White beans"],
      tip:"Most people get less than 50% of daily needs. Focus on whole foods — fruits, vegetables, legumes.",
      personalNote: isHeavySweater ? "💦 Lost heavily through sweat — replenish with potassium-rich foods and electrolytes during intense sessions." : null },
    { id:"sodium", name:"Sodium", emoji:"🧂", amount:2300, unit:"mg", category:"Mineral",
      relevance: score([isHeavySweater, isHeavyCardio, doesEndurance]),
      why:"Essential for fluid balance and muscle function. Active people lose significant sodium through sweat.",
      foods:["Any salted food","Cottage cheese","Pickles","Soup","Sports drinks","Olives","Salted nuts"],
      tip:"If you train hard and sweat heavily, you may need MORE sodium, not less. Add a pinch of salt to pre-workout water.",
      personalNote: isHeavySweater ? "💦 Heavy sweaters can lose 1–2g sodium per hour — replace during and after training." : null },
    { id:"zinc", name:"Zinc", emoji:"🔬", amount:isMale?11:8, unit:"mg", category:"Mineral",
      relevance: score([true, liftsHeavy, isMale, isHeavySweater]),
      why:"Critical for testosterone, immune function, protein synthesis, and wound healing. Lost through sweat.",
      foods:["Oysters (3oz = 74mg)","Beef","Pumpkin seeds","Chickpeas","Cashews","Turkey","Lentils","Crab"],
      tip:"Zinc competes with copper — don't mega-dose. Food sources are generally sufficient.",
      personalNote: (isMale && liftsHeavy) ? "🏋️♂️ Zinc directly supports testosterone production — essential for male lifters." : null },
    { id:"selenium", name:"Selenium", emoji:"🇧🇷", amount:55, unit:"mcg", category:"Mineral",
      relevance: score([isHeavyCardio, doesEndurance, over40]),
      why:"Powerful antioxidant that protects against exercise-induced oxidative stress. Supports thyroid function and immune health.",
      foods:["Brazil nuts (1 nut = 68–91mcg)","Tuna","Sardines","Turkey","Chicken","Eggs","Cottage cheese","Brown rice"],
      tip:"Just 1–2 Brazil nuts per day covers your entire selenium need. Don't over-supplement — toxicity is possible.",
      personalNote: isHeavyCardio ? "🔥 Intense exercise creates oxidative stress — selenium helps your antioxidant defense." : null },
    { id:"chromium", name:"Chromium", emoji:"🩸", amount:isMale?35:25, unit:"mcg", category:"Mineral",
      relevance: score([isCutting, trainsDays>=3]),
      why:"Enhances insulin sensitivity and helps regulate blood sugar. May support body composition during calorie restriction.",
      foods:["Broccoli (1 cup = 22mcg)","Grape juice","Turkey breast","Green beans","Potatoes","Beef","Whole grains"],
      tip:"Most useful during a cut when blood sugar management matters. Deficiency is rare but can affect insulin response.",
      personalNote: isCutting ? "📉 Chromium may help manage cravings and blood sugar swings during a deficit." : null },
    { id:"copper", name:"Copper", emoji:"🔶", amount:0.9, unit:"mg", category:"Mineral",
      relevance: score([liftsHeavy, doesEndurance]),
      why:"Supports iron metabolism, connective tissue formation, and energy production. Works with iron for red blood cell formation.",
      foods:["Beef liver (1oz = 4mg)","Oysters","Cashews","Dark chocolate","Sunflower seeds","Lentils","Shiitake mushrooms"],
      tip:"Usually adequate in a balanced diet. Excessive zinc supplementation can deplete copper.",
      personalNote: null },
    { id:"iodine", name:"Iodine", emoji:"🦪", amount:150, unit:"mcg", category:"Mineral",
      relevance: score([isCutting, isHeavySweater]),
      why:"Essential for thyroid function — your thyroid controls metabolic rate. Deficiency slows metabolism, undermining fat loss.",
      foods:["Seaweed/kelp","Cod (3oz = 99mcg)","Iodized salt","Greek yogurt","Milk","Shrimp","Eggs","Tuna"],
      tip:"If you use non-iodized salt (sea salt, pink salt), ensure iodine from other sources.",
      personalNote: isCutting ? "📉 Thyroid function is critical during a cut — iodine ensures your metabolism stays active." : null },
    { id:"omega3", name:"Omega-3 (EPA/DHA)", emoji:"🐟", amount:isMale?1600:1100, unit:"mg ALA", category:"Fat",
      relevance: score([true, liftsHeavy, doesHighImpact, isHeavyCardio, over40]),
      why:"Reduces inflammation, supports joint health, brain function, and cardiovascular health. EPA/DHA from fish are most bioavailable.",
      foods:["Salmon (3oz = 1800mg EPA+DHA)","Walnuts","Flaxseed","Chia seeds","Mackerel","Sardines","Herring","Algae oil (vegan)"],
      tip:"Aim for 2+ servings of fatty fish per week. Algae-based omega-3 covers EPA/DHA for vegans.",
      personalNote: doesHighImpact ? "🦵 High-impact training causes joint inflammation — omega-3s are your anti-inflammatory defense." : liftsHeavy ? "🏋️ Reduces exercise-induced inflammation and supports muscle protein synthesis." : null },
    { id:"vitb1", name:"Vitamin B1 (Thiamine)", emoji:"⚡", amount:isMale?1.2:1.1, unit:"mg", category:"Vitamin",
      relevance: score([doesEndurance, isHeavyCardio, isCutting]),
      why:"Converts carbohydrates into ATP for energy. Demand increases with exercise intensity and carb intake. Deficiency causes fatigue and poor performance.",
      foods:["Pork (3oz = 0.8mg)","Black beans (1/2 cup = 0.4mg)","Sunflower seeds","Fortified cereals","Lentils","Brown rice","Green peas"],
      tip:"Athletes with high carb diets have elevated B1 needs. Alcohol depletes thiamine rapidly.",
      personalNote: doesEndurance ? "🏃 Endurance training burns through glycogen fast — thiamine helps your body convert carbs to fuel." : null },
    { id:"vitb2", name:"Vitamin B2 (Riboflavin)", emoji:"💛", amount:isMale?1.3:1.1, unit:"mg", category:"Vitamin",
      relevance: score([isHeavyCardio, liftsHeavy, isCutting]),
      why:"Essential for energy production, red blood cell formation, and cellular repair after exercise. Demand rises with activity level.",
      foods:["Beef liver (3oz = 2.9mg)","Eggs (1 = 0.5mg)","Almonds","Spinach","Fortified cereals","Milk","Mushrooms","Yogurt"],
      tip:"Riboflavin is water-soluble — regular intake matters more than mega-dosing.",
      personalNote: isHeavyCardio ? "🔥 High cardio volume increases riboflavin turnover — a common overlooked deficiency." : null },
    { id:"vitb3", name:"Vitamin B3 (Niacin)", emoji:"🔋", amount:isMale?16:14, unit:"mg NE", category:"Vitamin",
      relevance: score([doesEndurance, isHeavyCardio]),
      why:"Critical for converting food into usable energy (NAD+/NADH). Supports skin health and nervous system function. Exercise increases niacin demand.",
      foods:["Chicken breast (3oz = 10mg)","Tuna (3oz = 8.6mg)","Turkey","Peanuts","Mushrooms","Green peas","Beef"],
      tip:"Easy to get from protein-rich foods. Supplementation rarely needed unless diet is very restricted.",
      personalNote: doesEndurance ? "🏃 Endurance exercise demands higher NAD+ turnover — protein-rich diets usually cover this." : null },
    { id:"vitb5", name:"Vitamin B5 (Pantothenic Acid)", emoji:"🧪", amount:5, unit:"mg", category:"Vitamin",
      relevance: score([liftsHeavy, isCutting]),
      why:"Key role in hormone synthesis (including testosterone and cortisol), fat metabolism, and coenzyme A production for energy.",
      foods:["Chicken breast (3oz = 1.3mg)","Beef liver","Avocado (1/2 = 1mg)","Mushrooms","Sunflower seeds","Sweet potato","Lentils","Eggs"],
      tip:"Widely available in foods — deficiency is rare. Supplementation unnecessary for most people.",
      personalNote: liftsHeavy ? "🏋️ Supports testosterone and cortisol regulation — both critical for training adaptation." : null },
    { id:"biotin", name:"Biotin (Vitamin B7)", emoji:"💅", amount:30, unit:"mcg", category:"Vitamin",
      relevance: score([isCutting]),
      why:"Supports hair, skin, and nail health. Also helps metabolize fats, carbs, and protein. Deficiency can cause hair thinning — common concern during calorie deficits.",
      foods:["Eggs (1 = 10mcg)","Almonds","Sweet potato","Spinach","Broccoli","Cheese","Oats","Salmon"],
      tip:"Raw egg whites contain avidin which blocks biotin absorption — cook your eggs.",
      personalNote: isCutting ? "📉 Calorie deficits can stress hair and nails — ensure adequate biotin intake during a cut." : null },
    { id:"phosphorus", name:"Phosphorus", emoji:"🦷", amount:700, unit:"mg", category:"Mineral",
      relevance: score([liftsHeavy, activeStrDays>=3]),
      why:"Second most abundant mineral in the body. Essential for bone strength, ATP production (muscle energy), and protein synthesis. Works alongside calcium.",
      foods:["Chicken (3oz = 190mg)","Salmon (3oz = 280mg)","Yogurt (1 cup = 245mg)","Lentils","Cheese","Pumpkin seeds","Beef","Eggs"],
      tip:"Most protein-rich diets provide plenty. Excessive phosphorus from processed foods can actually leach calcium from bones.",
      personalNote: liftsHeavy ? "🏋️ ATP (muscle energy) requires phosphorus — heavy training increases demand." : null },
    { id:"manganese", name:"Manganese", emoji:"🦴", amount:isMale?2.3:1.8, unit:"mg", category:"Mineral",
      relevance: score([liftsHeavy, doesHighImpact]),
      why:"Supports bone formation, connective tissue repair, and acts as an antioxidant enzyme cofactor. Important for joint and bone health under training stress.",
      foods:["Pineapple (1 cup = 1.5mg)","Pecans (1oz = 1.3mg)","Oatmeal","Brown rice","Spinach","Sweet potato","Black beans","Hazelnuts"],
      tip:"Most people get enough from whole grains and nuts. Supplementation rarely needed.",
      personalNote: doesHighImpact ? "🦵 Impact training stresses bones and joints — manganese supports repair and strengthening." : null },
    { id:"coq10", name:"CoQ10 (Coenzyme Q10)", emoji:"❤️", amount:100, unit:"mg (supplemental)", category:"Mineral",
      relevance: score([over40, doesEndurance, isHeavyCardio]),
      why:"Powers mitochondrial energy production in every cell. Natural production declines after 40. Supports heart health, reduces exercise-induced oxidative stress, and may improve training output.",
      foods:["Beef heart","Pork","Chicken","Trout","Sardines","Broccoli","Cauliflower","Soybeans","Peanuts"],
      tip:"Hard to get meaningful doses from food alone — supplementation (ubiquinol form) is more effective, especially over 40.",
      personalNote: over40 ? "⚠️ Your body produces less CoQ10 after 40 — supplementation supports energy and heart health." : doesEndurance ? "🏃 Improves mitochondrial efficiency for endurance performance." : null },
  ].sort((a,b) => b.relevance - a.relevance);

  const categories = ["Vitamin", "Mineral", "Fat"];

  return (
    <div className="fu">
      {/* Deficit selector */}
      <div className="nutr-goal-bar">
        <div className="nutr-goal-lbl">Show macros for:</div>
        <div className="nutr-goal-btns">
          {targets.map(t => (
            <button
              key={t.label}
              className={`nutr-goal-btn${deficitChoice===t.cut?" active":""}`}
              style={deficitChoice===t.cut?{borderColor:`var(${t.cls==="c-acc"?"--accent":t.cls==="c-grn"?"--green":t.cls==="c-yel"?"--yellow":"--red"})`,color:`var(${t.cls==="c-acc"?"--accent":t.cls==="c-grn"?"--green":t.cls==="c-yel"?"--yellow":"--red"})`}:{}}
              onClick={()=>setDeficitChoice(t.cut)}
            >{t.goalLabel}</button>
          ))}
        </div>
        <div className="nutr-cals-badge">{targetCals.toLocaleString()} cal/day target</div>
      </div>

      {/* Macro breakdown */}
      <div className="sec-title">Daily Macronutrients</div>
      <div className="macro-bar-wrap">
        <div className="macro-bar">
          <div className="macro-bar-seg protein" style={{width:`${pctProtein}%`}}></div>
          <div className="macro-bar-seg carbs"   style={{width:`${pctCarbs}%`}}></div>
          <div className="macro-bar-seg fat"     style={{width:`${pctFat}%`}}></div>
        </div>
        <div className="macro-bar-legend">
          <span><span className="macro-dot protein"></span>Protein {pctProtein}%</span>
          <span><span className="macro-dot carbs"></span>Carbs {pctCarbs}%</span>
          <span><span className="macro-dot fat"></span>Fat {pctFat}%</span>
        </div>
      </div>

      <div className="macro-grid">
        {[
          { name:"Protein",  g:proteinG,  cal:proteinCal, cls:"protein", emoji:"🥩",
            why:`${proteinMultiplier}g per lb of body weight. Higher protein protects muscle during a calorie deficit and keeps you full longer.` },
          { name:"Carbs",    g:carbG,     cal:carbCal,    cls:"carbs",   emoji:"🌾",
            why:"Your primary fuel source for training. Adjusted after protein and fat are set from remaining calories." },
          { name:"Fat",      g:fatG,      cal:fatCal,     cls:"fat",     emoji:"🥑",
            why:"Set at 28% of target calories. Essential for hormone production, joint health, and fat-soluble vitamin absorption." },
          { name:"Fibre",    g:fibreG,    cal:null,       cls:"fibre",   emoji:"🥦",
            why:"Supports digestion, blood sugar regulation, and satiety. Scaled to calorie intake — aim for this daily minimum." },
        ].map(m=>(
          <div key={m.name} className={`macro-card macro-${m.cls}`}>
            <div className="mc-emoji">{m.emoji}</div>
            <div className="mc-name">{m.name}</div>
            <div className="mc-grams">{m.g}<span>g</span></div>
            {m.cal && <div className="mc-cals">{m.cal} kcal</div>}
            {!m.cal && <div className="mc-cals">daily min</div>}
            <div className="mc-why">{m.why}</div>
          </div>
        ))}
      </div>

      {/* Hydration */}
      <div className="nutr-hydration">
        <span className="nutr-hydration-icon">💧</span>
        <div>
          <div className="nutr-hydration-title">Daily Water Target</div>
          <div className="nutr-hydration-val">{(weightLbs * 0.5 / 8).toFixed(1)} cups &nbsp;·&nbsp; ~{Math.round(weightLbs * 0.5)} oz &nbsp;·&nbsp; ~{(weightLbs * 0.5 * 29.574 / 1000).toFixed(1)}L</div>
          <div className="nutr-hydration-note">0.5 oz per lb of body weight. Add 16–24 oz for every hour of intense exercise.</div>
        </div>
      </div>

      {/* Food Sources by Macro */}
      <div className="sec-title">Food Sources — Hit Your Macros</div>
      <p style={{fontSize:".78rem",color:"var(--muted)",marginBottom:"12px",lineHeight:1.5}}>
        Tap a category to see top food picks with approximate macros per serving. Build meals from these to hit your {targetCals.toLocaleString()} cal target.
      </p>
      {[
        { id:"protein", label:"🥩 Protein Sources", color:"#ff6b9d", target:`${proteinG}g/day`, foods:[
          { name:"Chicken Breast (4oz)", cals:130, p:26, c:0, f:2 },
          { name:"Chicken Thigh, skinless (4oz)", cals:170, p:22, c:0, f:9 },
          { name:"Ground Turkey 93% (4oz)", cals:150, p:22, c:0, f:7 },
          { name:"Turkey Breast Deli (4oz)", cals:120, p:24, c:2, f:1 },
          { name:"Lean Ground Beef 90% (4oz)", cals:200, p:22, c:0, f:12 },
          { name:"Sirloin Steak (4oz)", cals:200, p:26, c:0, f:10 },
          { name:"Bison/Buffalo (4oz)", cals:160, p:24, c:0, f:7 },
          { name:"Pork Tenderloin (4oz)", cals:140, p:24, c:0, f:4 },
          { name:"Salmon (4oz)", cals:230, p:25, c:0, f:14 },
          { name:"Tilapia (4oz)", cals:110, p:23, c:0, f:2 },
          { name:"Cod (4oz)", cals:90, p:20, c:0, f:1 },
          { name:"Shrimp (4oz)", cals:120, p:24, c:1, f:2 },
          { name:"Tuna Steak (4oz)", cals:130, p:28, c:0, f:1 },
          { name:"Canned Tuna in Water (1 can)", cals:120, p:27, c:0, f:1 },
          { name:"Whole Eggs (2 large)", cals:140, p:12, c:1, f:10 },
          { name:"Egg Whites (4 large)", cals:68, p:14, c:1, f:0 },
          { name:"Greek Yogurt 0% (1 cup)", cals:130, p:23, c:9, f:0 },
          { name:"Skyr (1 cup)", cals:130, p:24, c:8, f:0 },
          { name:"Cottage Cheese 2% (1 cup)", cals:180, p:24, c:10, f:5 },
          { name:"Whey Protein (1 scoop)", cals:120, p:25, c:3, f:1 },
          { name:"Casein Protein (1 scoop)", cals:120, p:24, c:3, f:1 },
          { name:"Plant Protein Blend (1 scoop)", cals:130, p:22, c:5, f:2 },
          { name:"Tofu, Firm (1/2 block)", cals:180, p:20, c:4, f:10 },
          { name:"Tempeh (4oz)", cals:220, p:21, c:8, f:13 },
          { name:"Edamame, shelled (1 cup)", cals:190, p:17, c:13, f:8 },
          { name:"Beef Jerky (1oz)", cals:80, p:13, c:3, f:1 },
          { name:"Turkey Jerky (1oz)", cals:70, p:13, c:3, f:1 },
          { name:"Canned Sardines (1 can)", cals:190, p:22, c:0, f:11 },
          { name:"Mozzarella, part-skim (1oz)", cals:72, p:7, c:1, f:5 },
          { name:"String Cheese (1 stick)", cals:80, p:7, c:1, f:5 },
          { name:"Lamb Chop (4oz)", cals:250, p:24, c:0, f:17 },
          { name:"Venison / Game Meat (4oz)", cals:160, p:30, c:0, f:3 },
          { name:"Protein Pancake Mix (1 serving)", cals:200, p:20, c:22, f:4 },
          { name:"Smoked Salmon / Lox (3oz)", cals:100, p:16, c:0, f:4 },
          { name:"Bone Broth (1 cup)", cals:40, p:9, c:1, f:0 },
        ]},
        { id:"carbs", label:"🌾 Carb Sources", color:"#ffcc44", target:`${carbG}g/day`, foods:[
          { name:"White Rice, cooked (1 cup)", cals:200, p:4, c:45, f:0 },
          { name:"Brown Rice, cooked (1 cup)", cals:215, p:5, c:45, f:2 },
          { name:"Jasmine Rice, cooked (1 cup)", cals:210, p:4, c:46, f:0 },
          { name:"Oats, dry (1/2 cup)", cals:150, p:5, c:27, f:3 },
          { name:"Overnight Oats (1/2 cup dry + milk)", cals:220, p:9, c:33, f:5 },
          { name:"Sweet Potato (1 medium)", cals:100, p:2, c:24, f:0 },
          { name:"Russet Potato (1 medium)", cals:160, p:4, c:37, f:0 },
          { name:"Red Potato (1 medium)", cals:150, p:4, c:34, f:0 },
          { name:"Whole Wheat Bread (2 slices)", cals:160, p:8, c:28, f:2 },
          { name:"Ezekiel Bread (2 slices)", cals:160, p:10, c:30, f:1 },
          { name:"Pasta, cooked (1 cup)", cals:200, p:7, c:40, f:1 },
          { name:"Whole Wheat Pasta (1 cup)", cals:175, p:8, c:37, f:1 },
          { name:"Quinoa, cooked (1 cup)", cals:220, p:8, c:39, f:4 },
          { name:"Couscous, cooked (1 cup)", cals:175, p:6, c:36, f:0 },
          { name:"Banana (1 medium)", cals:105, p:1, c:27, f:0 },
          { name:"Blueberries (1 cup)", cals:85, p:1, c:21, f:0 },
          { name:"Strawberries (1 cup)", cals:50, p:1, c:12, f:0 },
          { name:"Mango (1 cup, diced)", cals:100, p:1, c:25, f:0 },
          { name:"Apple (1 medium)", cals:95, p:0, c:25, f:0 },
          { name:"Grapes (1 cup)", cals:104, p:1, c:27, f:0 },
          { name:"Black Beans (1/2 cup)", cals:115, p:8, c:20, f:0 },
          { name:"Lentils, cooked (1/2 cup)", cals:115, p:9, c:20, f:0 },
          { name:"Chickpeas (1/2 cup)", cals:135, p:7, c:23, f:2 },
          { name:"Cream of Rice, dry (1/3 cup)", cals:150, p:3, c:33, f:0 },
          { name:"Rice Cakes (2)", cals:70, p:2, c:15, f:0 },
          { name:"Corn Tortilla (2)", cals:110, p:3, c:22, f:1 },
          { name:"Flour Tortilla, 8in (1)", cals:140, p:4, c:24, f:3 },
          { name:"Honey (1 tbsp)", cals:64, p:0, c:17, f:0 },
          { name:"Maple Syrup (1 tbsp)", cals:52, p:0, c:13, f:0 },
          { name:"Granola (1/3 cup)", cals:140, p:3, c:22, f:5 },
          { name:"Frozen Mixed Berries (1 cup)", cals:70, p:1, c:17, f:0 },
          { name:"Dates, Medjool (2)", cals:130, p:1, c:36, f:0 },
          { name:"Cream of Wheat (1 packet)", cals:100, p:3, c:22, f:0 },
          { name:"Fig Bar (2 bars)", cals:200, p:2, c:40, f:4 },
          { name:"Ezekiel Bread (2 slices)", cals:160, p:8, c:30, f:1 },
          { name:"Plantain, cooked (1 medium)", cals:220, p:2, c:58, f:0 },
        ]},
        { id:"fats", label:"🥑 Healthy Fat Sources", color:"#4fc3f7", target:`${fatG}g/day`, foods:[
          { name:"Avocado (1/2 medium)", cals:120, p:1, c:6, f:11 },
          { name:"Almonds (1oz / 23 nuts)", cals:165, p:6, c:6, f:14 },
          { name:"Walnuts (1oz / 14 halves)", cals:185, p:4, c:4, f:18 },
          { name:"Cashews (1oz)", cals:155, p:5, c:9, f:12 },
          { name:"Pistachios (1oz / 49 nuts)", cals:160, p:6, c:8, f:13 },
          { name:"Macadamia Nuts (1oz)", cals:200, p:2, c:4, f:21 },
          { name:"Pecans (1oz)", cals:195, p:3, c:4, f:20 },
          { name:"Peanut Butter (2 tbsp)", cals:190, p:7, c:7, f:16 },
          { name:"Almond Butter (2 tbsp)", cals:195, p:7, c:6, f:17 },
          { name:"Tahini (2 tbsp)", cals:178, p:5, c:6, f:16 },
          { name:"Extra Virgin Olive Oil (1 tbsp)", cals:120, p:0, c:0, f:14 },
          { name:"Avocado Oil (1 tbsp)", cals:120, p:0, c:0, f:14 },
          { name:"Coconut Oil (1 tbsp)", cals:120, p:0, c:0, f:14 },
          { name:"Ghee / Butter (1 tbsp)", cals:120, p:0, c:0, f:14 },
          { name:"Chia Seeds (2 tbsp)", cals:140, p:5, c:12, f:9 },
          { name:"Flax Seeds, ground (2 tbsp)", cals:75, p:3, c:4, f:6 },
          { name:"Hemp Seeds (3 tbsp)", cals:170, p:10, c:3, f:14 },
          { name:"Pumpkin Seeds (1oz)", cals:160, p:9, c:3, f:14 },
          { name:"Sunflower Seeds (1oz)", cals:165, p:6, c:6, f:14 },
          { name:"Dark Chocolate 70%+ (1oz)", cals:170, p:2, c:13, f:12 },
          { name:"Salmon (4oz)", cals:230, p:25, c:0, f:14 },
          { name:"Whole Eggs (2 large)", cals:140, p:12, c:1, f:10 },
          { name:"Cheese, Cheddar (1oz)", cals:115, p:7, c:0, f:9 },
          { name:"Cream Cheese (2 tbsp)", cals:100, p:2, c:1, f:10 },
          { name:"MCT Oil (1 tbsp)", cals:115, p:0, c:0, f:14 },
          { name:"Coconut, shredded (2 tbsp)", cals:70, p:1, c:3, f:7 },
          { name:"Olives (10 large)", cals:50, p:0, c:2, f:5 },
          { name:"Guacamole (2 tbsp)", cals:50, p:1, c:3, f:4 },
          { name:"Full-Fat Greek Yogurt (1 cup)", cals:220, p:20, c:9, f:11 },
          { name:"Sardines in Oil (1 can)", cals:220, p:22, c:0, f:14 },
          { name:"Coconut Milk, canned (1/4 cup)", cals:110, p:1, c:2, f:12 },
          { name:"Brazil Nuts (3 nuts)", cals:100, p:2, c:1, f:10 },
          { name:"Avocado Oil (1 tbsp)", cals:120, p:0, c:0, f:14 },
          { name:"Goat Cheese (1oz)", cals:75, p:5, c:0, f:6 },
          { name:"Brie (1oz)", cals:95, p:6, c:0, f:8 },
        ]},
      ].map(cat => (
        <div key={cat.id} className={`micro-row${openFoodCat===cat.id?" micro-open":""}`} style={{marginBottom:"8px"}}>
          <div className="micro-header" onClick={()=>setOpenFoodCat(prev=>prev===cat.id?null:cat.id)}>
            <span style={{fontSize:"1.2rem"}}>{cat.label.slice(0,2)}</span>
            <div className="micro-name-wrap">
              <div className="micro-name">{cat.label.slice(2)}</div>
              <div className="micro-amount" style={{color:cat.color}}>Target: {cat.target} · {cat.foods.length} foods</div>
            </div>
            <div className={`micro-chevron${openFoodCat===cat.id?" open":""}`}>▼</div>
          </div>
          {openFoodCat===cat.id && (
            <div style={{padding:"10px 12px 14px",borderTop:"1px solid var(--border)"}}>
              <div style={{display:"grid",gridTemplateColumns:"1fr auto auto auto",gap:"0",fontSize:".72rem",color:"var(--muted)",fontWeight:700,letterSpacing:".5px",textTransform:"uppercase",padding:"0 0 8px",borderBottom:"1px solid var(--border)"}}>
                <span>Food</span><span style={{textAlign:"right",minWidth:"42px"}}>Cal</span><span style={{textAlign:"right",minWidth:"32px",color:"#ff6b9d"}}>P</span><span style={{textAlign:"right",minWidth:"32px",color:cat.color}}>{cat.id==="protein"?"F":cat.id==="carbs"?"C":"F"}</span>
              </div>
              {cat.foods.map((f,i)=>(
                <div key={i} style={{display:"grid",gridTemplateColumns:"1fr auto auto auto",gap:"0",padding:"8px 0",borderBottom:i<cat.foods.length-1?"1px solid var(--border)":"none",fontSize:".8rem",alignItems:"center"}}>
                  <span style={{color:"var(--text)",lineHeight:1.3,paddingRight:"8px"}}>{f.name}</span>
                  <span style={{textAlign:"right",fontFamily:"'Sora',sans-serif",fontSize:".9rem",color:"var(--muted)",minWidth:"42px"}}>{f.cals}</span>
                  <span style={{textAlign:"right",fontFamily:"'Sora',sans-serif",fontSize:".9rem",color:"#ff6b9d",minWidth:"32px"}}>{f.p}g</span>
                  <span style={{textAlign:"right",fontFamily:"'Sora',sans-serif",fontSize:".9rem",color:cat.color,minWidth:"32px"}}>{cat.id==="protein"?f.f+"g":cat.id==="carbs"?f.c+"g":f.f+"g"}</span>
                </div>
              ))}
              <div style={{marginTop:"10px",fontSize:".75rem",color:"var(--muted)",lineHeight:1.5,padding:"8px 10px",background:"rgba(8,220,224,.04)",borderRadius:"8px",borderLeft:"3px solid "+cat.color}}>
                💡 {cat.id==="protein"
                  ? `Aim for 25–40g protein per meal across 3–5 meals to maximize muscle protein synthesis. Spread evenly — don't back-load all ${proteinG}g into dinner.`
                  : cat.id==="carbs"
                  ? `Prioritize carbs around your workouts — before for energy, after for glycogen replenishment. Complex carbs (rice, oats, potato) for sustained energy; fruit for quick fuel.`
                  : `Don't fear fat — it's essential for hormones (including testosterone). Focus on unsaturated sources. Save saturated fats for ≤10% of daily intake.`
                }
              </div>
            </div>
          )}
        </div>
      ))}

      {/* Micronutrients */}
      <div className="sec-title">Key Micronutrients</div>
      <p style={{fontSize:".78rem",color:"var(--muted)",marginBottom:"12px",lineHeight:1.5}}>
        Ranked by relevance to {name||"your"} profile — age ({age}), gender, and training plan ({activeDays} cardio + {activeStrDays} strength days). Tap any nutrient for details, food sources, and personalized coaching notes.
      </p>

      {categories.map(cat => (
        <div key={cat}>
          <div className="micro-cat-label">{cat === "Fat" ? "Essential Fats" : `${cat}s`}</div>
          {micros.filter(m=>m.category===cat).map(m => (
            <div key={m.id} className={`micro-row${openMicro===m.id?" micro-open":""}`}>
              <div className="micro-header" onClick={()=>setOpenMicro(openMicro===m.id?null:m.id)}>
                <span className="micro-emoji">{m.emoji}</span>
                <div className="micro-name-wrap">
                  <div className="micro-name">{m.name}</div>
                  <div className="micro-amount">{m.amount} {m.unit} / day</div>
                </div>
                <div className={`micro-chevron${openMicro===m.id?" open":""}`}>▼</div>
              </div>
              {openMicro===m.id && (
                <div className="micro-detail fu">
                  <div className="micro-why">{m.why}</div>
                  <div className="micro-foods-label">Best food sources:</div>
                  <div className="micro-foods">
                    {m.foods.map((f,i)=><div key={i} className="micro-food-chip">{f}</div>)}
                  </div>
                  <div className="micro-tip">💡 {m.tip}</div>
                  {m.personalNote && (
                    <div style={{marginTop:"8px",padding:"9px 11px",background:"rgba(8,220,224,.06)",border:"1px solid rgba(8,220,224,.15)",borderRadius:"var(--radius-sm)",fontSize:".77rem",color:"var(--accent)",lineHeight:1.55}}>
                      {m.personalNote}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      ))}

      <p className="footnote" style={{marginTop:"14px"}}>
        Macro targets are estimates based on your body weight, goal deficit, and activity level using standard sports nutrition guidelines.
        Micronutrient RDAs are from NIH/NAS Dietary Reference Intakes. Individual needs vary — consult a registered dietitian for a personalized nutrition plan.
      </p>
    </div>
  );
}

// ─── Timeline ─────────────────────────────────────────────────────────────────

// Compliance-aware weight chart — shows a single "at this compliance" projection
// compliance: 0.0–1.0 (fraction of days the plan is followed)
// On compliant days: full deficit. On off days: maintenance (0 net change).
// Effective weekly loss = planned_loss_per_week × compliance
function WeightChart({ current, goal, paces, totalBurn, maxWeeks, compliance=1, selectedPace=null }) {
  const [hoverInfo, setHoverInfo] = useState(null);

  const W = 500, H = 300;
  const PAD = { top:20, right:72, bottom:52, left:78 };
  const chartW = W - PAD.left - PAD.right;
  const chartH = H - PAD.top  - PAD.bottom;

  const weightRange = current - goal;
  const yPad  = weightRange * 0.20;
  const yMin  = goal - yPad;
  const yMax  = current + yPad * 0.20;
  const yRange = yMax - yMin;

  const xScale  = w  => (w / maxWeeks) * chartW;
  const yScale  = wt => chartH - ((wt - yMin) / yRange) * chartH;
  const xToWeek = px => Math.max(0, Math.min(maxWeeks, (px / chartW) * maxWeeks));

  const rawColor = { "var(--green)":"#4fffb0","var(--yellow)":"#ffcc44","var(--red)":"#ff4f6b" };
  const rc = p => rawColor[p.color] || p.color;

  const scenarios = [
    { key:"diet",   weeklyDef: p => p.dietCutPerWeek * compliance,               dash:true,  opacity:0.45 },
    { key:"cardio", weeklyDef: p => (p.dietCutPerWeek + totalBurn) * compliance,  dash:false, opacity:1.0  },
  ].filter(s => s.key === "diet" || totalBurn > 0);

  const primaryScenario = scenarios[scenarios.length - 1];

  const buildPts = (pace, defFn) =>
    Array.from({length:121},(_,i) => {
      const wk   = (i/120)*maxWeeks;
      const lost = Math.min(defFn(pace)/3500 * wk, current-goal);
      return [xScale(wk), yScale(current-lost)];
    });

  const ptsToPath = pts => pts.map((p,i)=>`${i===0?"M":"L"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");

  // Y axis: 5 clean steps, wide spacing
  const yLabels = Array.from({length:5},(_,i)=>({
    wt: Math.round(yMin + yRange*i/4),
    y:  yScale(yMin + yRange*i/4),
  }));

  // X axis: month marks only — clean, uncluttered
  const xAxisLabels = [];
  const totalMonths = Math.ceil(maxWeeks / 4.33);
  const monthStep   = totalMonths <= 4 ? 1 : totalMonths <= 8 ? 1 : totalMonths <= 14 ? 2 : 3;
  for (let mo = 0; mo <= totalMonths; mo += monthStep) {
    const wk = mo * 4.33;
    if (wk > maxWeeks + 0.5) break;
    xAxisLabels.push({ wk, lbl: mo === 0 ? "Start" : mo < 12 ? `${mo} mo` : "1 yr" });
  }

  const goalY = yScale(goal);

  // Endpoint dots — primary scenario only
  const endpoints = paces.map(p => {
    const lpw = primaryScenario.weeklyDef(p)/3500;
    if (!lpw) return null;
    const goalWk = (current-goal)/lpw;
    const atWk   = Math.min(goalWk, maxWeeks);
    const atWt   = Math.max(current - lpw*atWk, goal);
    return { pace:p, wk:atWk, wt:atWt, reached:goalWk<=maxWeeks };
  }).filter(Boolean);

  const handleMove = (clientX, rect) => {
    const chartX = (clientX - rect.left)/rect.width*W - PAD.left;
    if (chartX < 0 || chartX > chartW) { setHoverInfo(null); return; }
    const wk = xToWeek(chartX);
    const lines = scenarios.flatMap(s =>
      paces.map(p => {
        const lpw  = s.weeklyDef(p)/3500;
        const lost = lpw ? Math.min(lpw*wk, current-goal) : 0;
        return { pace:p, scenario:s, wt:Math.max(current-lost,goal).toFixed(1), lost:Math.min(lost,current-goal).toFixed(1) };
      })
    );
    setHoverInfo({ x:PAD.left+chartX, timeLbl: friendlyTime(wk), lines });
  };

  return (
    <svg viewBox={`0 0 ${W} ${H}`}
      style={{width:"100%",height:"auto",display:"block",overflow:"visible",cursor:"crosshair",touchAction:"none"}}
      onMouseMove={e=>handleMove(e.clientX,e.currentTarget.getBoundingClientRect())}
      onMouseLeave={()=>setHoverInfo(null)}
      onTouchMove={e=>{e.preventDefault();handleMove(e.touches[0].clientX,e.currentTarget.getBoundingClientRect());}}
      onTouchEnd={()=>setHoverInfo(null)}
    >
      <defs>
        {paces.map(p=>(
          <linearGradient key={p.id} id={`ag3-${p.id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={rc(p)} stopOpacity="0.12"/>
            <stop offset="100%" stopColor={rc(p)} stopOpacity="0.0"/>
          </linearGradient>
        ))}
      </defs>

      {/* Chart bg */}
      <rect x={PAD.left} y={PAD.top} width={chartW} height={chartH} fill="rgba(255,255,255,.013)" rx="5"/>

      {/* Y grid — just 4 clean horizontal lines, no vertical clutter */}
      {yLabels.map(({wt,y},i)=>(
        <g key={i}>
          <line x1={PAD.left} y1={PAD.top+y} x2={PAD.left+chartW} y2={PAD.top+y}
            stroke={i===0?"rgba(8,220,224,.25)":"rgba(255,255,255,.07)"} strokeWidth="1"/>
          {/* BRIGHT, large Y labels */}
          <text x={PAD.left-14} y={PAD.top+y+5} textAnchor="end"
            fill="#ffffff" fontSize="13.5" fontWeight="700" fontFamily="DM Sans,sans-serif"
            opacity="0.88">{wt}</text>
        </g>
      ))}

      {/* Y axis label */}
      <text transform={`translate(16,${PAD.top+chartH/2}) rotate(-90)`}
        textAnchor="middle" fill="#a8a8cc" fontSize="9" fontFamily="DM Sans,sans-serif" letterSpacing="1.5">
        WEIGHT (LBS)
      </text>

      {/* Goal band */}
      <rect x={PAD.left} y={PAD.top+goalY-2} width={chartW} height={3} fill="rgba(8,220,224,.55)" rx="1.5"/>
      <rect x={PAD.left} y={PAD.top+goalY} width={chartW} height={chartH-goalY} fill="rgba(8,220,224,.023)"/>
      <rect x={PAD.left+chartW+6} y={PAD.top+goalY-12} width={60} height={22} rx="6" fill="rgba(8,220,224,.2)"/>
      <text x={PAD.left+chartW+36} y={PAD.top+goalY+4} textAnchor="middle"
        fill="#08dce0" fontSize="11.5" fontWeight="700" fontFamily="DM Sans,sans-serif">{goal} lbs</text>

      {/* Area fills */}
      {scenarios.filter(s=>!s.dash).flatMap(s=>
        [...paces].reverse().map(p=>(
          <path key={`area-${s.key}-${p.id}`}
            d={ptsToPath(buildPts(p,s.weeklyDef))+` L${xScale(maxWeeks).toFixed(1)},${chartH} L0,${chartH} Z`}
            fill={`url(#ag3-${p.id})`}
            transform={`translate(${PAD.left},${PAD.top})`}/>
        ))
      )}

      {/* Lines — thicker, more space between them */}
      {scenarios.flatMap(s=>
        [...paces].reverse().map(p=>(
          <path key={`line-${s.key}-${p.id}`}
            d={ptsToPath(buildPts(p,s.weeklyDef))}
            fill="none" stroke={rc(p)}
            strokeWidth={s.dash ? 1.8 : 3.5}
            strokeDasharray={s.dash ? "9 6" : undefined}
            strokeLinecap="round" strokeLinejoin="round"
            opacity={s.opacity}
            transform={`translate(${PAD.left},${PAD.top})`}/>
        ))
      )}

      {/* Endpoint dots */}
      {endpoints.filter(e=>e.reached).map(({pace,wk,wt})=>{
        const cx=PAD.left+xScale(wk), cy=PAD.top+yScale(wt);
        return (
          <g key={`ep-${pace.id}`}>
            <circle cx={cx} cy={cy} r="13" fill={rc(pace)} opacity="0.08"/>
            <circle cx={cx} cy={cy} r="7"  fill={rc(pace)} opacity="0.25"/>
            <circle cx={cx} cy={cy} r="4.5" fill={rc(pace)}/>
          </g>
        );
      })}

      {/* Start marker */}
      <circle cx={PAD.left} cy={PAD.top+yScale(current)} r="5.5" fill="#eeeeff" opacity="0.88"/>
      <text x={PAD.left+10} y={PAD.top+yScale(current)-11}
        fill="#eeeeff" fontSize="11" fontFamily="DM Sans,sans-serif" fontWeight="700" opacity="0.88">
        {current} lbs
      </text>

      {/* X axis — month labels, bright */}
      {xAxisLabels.map(({wk,lbl})=>(
        <g key={wk}>
          <line x1={PAD.left+xScale(wk)} y1={PAD.top+chartH}
            x2={PAD.left+xScale(wk)} y2={PAD.top+chartH+8} stroke="#606090" strokeWidth="1.5"/>
          <text x={PAD.left+xScale(wk)} y={PAD.top+chartH+22} textAnchor="middle"
            fill="#d0d0f8" fontSize="12" fontWeight="700" fontFamily="DM Sans,sans-serif">{lbl}</text>
        </g>
      ))}

      {/* Axis lines */}
      <line x1={PAD.left} y1={PAD.top-4} x2={PAD.left} y2={PAD.top+chartH+4} stroke="#505075" strokeWidth="2"/>
      <line x1={PAD.left-2} y1={PAD.top+chartH} x2={PAD.left+chartW} y2={PAD.top+chartH} stroke="#505075" strokeWidth="2"/>

      {/* Hover tooltip */}
      {hoverInfo && (()=>{
        const tx=hoverInfo.x;
        const rows=hoverInfo.lines.length;
        const boxW=162, boxH=26+rows*20;
        const bx=tx+14+boxW>W-4?tx-boxW-14:tx+14;
        return (
          <g>
            <line x1={tx} y1={PAD.top} x2={tx} y2={PAD.top+chartH}
              stroke="rgba(255,255,255,.22)" strokeWidth="1.5" strokeDasharray="4 3"/>
            {hoverInfo.lines.map(({pace,scenario,wt})=>{
              const cy=PAD.top+yScale(parseFloat(wt));
              return <circle key={`${scenario.key}-${pace.id}`} cx={tx} cy={cy}
                r={scenario.dash?3:5.5} fill={rc(pace)} stroke="#0b0b12" strokeWidth="1.5" opacity={scenario.opacity}/>;
            })}
            <rect x={bx} y={PAD.top+6} width={boxW} height={boxH} rx="9" fill="#1c1c2e" stroke="#3a3a55" strokeWidth="1.5"/>
            <text x={bx+13} y={PAD.top+20} fill="#f0f0f8" fontSize="11.5" fontWeight="700" fontFamily="DM Sans,sans-serif">
              📅 {hoverInfo.timeLbl}
            </text>
            {hoverInfo.lines.map(({pace,scenario,wt,lost},i)=>(
              <g key={`tt-${scenario.key}-${pace.id}`}>
                <circle cx={bx+14} cy={PAD.top+33+i*20} r="4.5" fill={rc(pace)} opacity={scenario.opacity}/>
                <text x={bx+25} y={PAD.top+37.5+i*20} fill="#f0f0f8" fontSize="10.5" fontFamily="DM Sans,sans-serif">
                  <tspan fontWeight="700">{wt} lbs</tspan>
                  <tspan fill={rc(pace)} fontSize="9.5"> (−{lost})</tspan>
                </text>
              </g>
            ))}
          </g>
        );
      })()}
    </svg>
  );
}
// Chart carousel scenarios
const COMPLIANCE_SCENARIOS = [
  { id:"full",    label:"100% On Plan",        subtitle:"Every day dialed in — no missed workouts or off-plan meals",       compliance:1.00, color:"#4fffb0", tagColor:"rgba(79,255,176,.15)",  tagBorder:"rgba(79,255,176,.35)"  },
  { id:"mostly",  label:"60–80% Compliance",   subtitle:"A few slip-ups per week — most days on track, occasional off days", compliance:0.70, color:"#ffcc44", tagColor:"rgba(255,204,68,.1)",   tagBorder:"rgba(255,204,68,.3)"   },
  { id:"partial", label:"30–50% Compliance",   subtitle:"On-and-off — following the plan roughly half the time",            compliance:0.40, color:"#ff9444", tagColor:"rgba(255,148,68,.1)",   tagBorder:"rgba(255,148,68,.3)"   },
  { id:"low",     label:"0–40% Compliance",    subtitle:"Rarely following the plan — mostly off track",                     compliance:0.20, color:"#ff4f6b", tagColor:"rgba(255,79,107,.1)",   tagBorder:"rgba(255,79,107,.3)"   },
];

function TimelineTab({ data, tdee, totalBurn }) {
  const [chartIdx, setChartIdx]       = useState(0);
  const [touchStart, setTouchStart]   = useState(null);
  const [selectedPace, setSelectedPace] = useState(null); // null = all shown equally

  const current = Number(data.weightLbs);
  const goal    = Number(data.goalWeight);
  const toLose  = current - goal;
  const hasCardio = totalBurn > 0;

  const paces = [
    { id:"half", label:"½ lb/wk",  dietCutPerWeek:1750, color:"var(--green)",  textCls:"c-grn" },
    { id:"one",  label:"1 lb/wk",  dietCutPerWeek:3500, color:"var(--yellow)", textCls:"c-yel" },
    { id:"two",  label:"2 lbs/wk", dietCutPerWeek:7000, color:"var(--red)",    textCls:"c-red" },
  ];

  const rawColor = { "var(--green)":"#4fffb0","var(--yellow)":"#ffcc44","var(--red)":"#ff4f6b" };
  const rc = p => rawColor[p.color] || p.color;

  const defDiet   = p => p.dietCutPerWeek;
  const defCardio = p => p.dietCutPerWeek + totalBurn;
  const wksNeeded = (p, defFn, comp=1) => weeksToGoal(toLose, defFn(p) * comp);

  const slowestWks    = wksNeeded(paces[0], defDiet) || 52;
  const maxChartWeeks = Math.min(Math.ceil(slowestWks), 104);

  // Smart milestone filter
  const ALL_MILESTONES = [
    { label:"2 Weeks",  weeks:2    },
    { label:"1 Month",  weeks:4.33 },
    { label:"2 Months", weeks:8.66 },
    { label:"3 Months", weeks:13   },
    { label:"6 Months", weeks:26   },
    { label:"1 Year",   weeks:52   },
  ];
  const slowestGoalWks = wksNeeded(paces[0], defDiet);
  const visibleMilestones = (() => {
    if (!slowestGoalWks) return ALL_MILESTONES;
    const before = ALL_MILESTONES.filter(ms => ms.weeks < slowestGoalWks - 1);
    const final  = { label:friendlyTime(slowestGoalWks), weeks:slowestGoalWks, _goalCard:true };
    return [...before, final];
  })();

  const scenario = COMPLIANCE_SCENARIOS[chartIdx];
  const comp     = scenario.compliance;

  // Swipe handlers
  const onTouchStart = e => setTouchStart(e.touches[0].clientX);
  const onTouchEnd   = e => {
    if (touchStart === null) return;
    const diff = touchStart - e.changedTouches[0].clientX;
    if (Math.abs(diff) > 40) {
      if (diff > 0) setChartIdx(i => Math.min(i+1, COMPLIANCE_SCENARIOS.length-1));
      else           setChartIdx(i => Math.max(i-1, 0));
    }
    setTouchStart(null);
  };

  return (
    <div className="fu">
      <div className="goal-banner">
        <div className="gb-icon">🎯</div>
        <div>
          <div className="gb-title">
            {fullName(data)||"Client"}: <span style={{color:"var(--accent)"}}>{current} → {goal} lbs</span>
          </div>
          <div className="gb-sub">
            Lose <strong style={{color:"var(--orange)"}}>{toLose} lbs total</strong>
            {hasCardio && <span style={{color:"var(--accent)"}}> · Swipe charts to see compliance scenarios</span>}
          </div>
        </div>
      </div>

      {/* ── Chart carousel ── */}
      <div className="sec-title">Weight Loss Projection</div>

      <div className="field-tip" style={{marginTop:0,marginBottom:"14px"}}>
        💡 Use the arrows or swipe to see how different compliance levels (100% → 20%) affect your timeline. Tap a pace below the chart to highlight it.
      </div>

      {/* Scenario dot navigation */}
      <div className="carousel-nav-row">
        <button className="carousel-arrow-btn" disabled={chartIdx===0}
          onClick={()=>setChartIdx(i=>i-1)} aria-label="Previous chart">
          <span>‹</span>
        </button>
        <div className="carousel-dots">
          {COMPLIANCE_SCENARIOS.map((s,i)=>(
            <button key={s.id}
              className={`carousel-dot${i===chartIdx?" active":""}`}
              style={{background:i===chartIdx?s.color:"var(--border)",
                      boxShadow:i===chartIdx?`0 0 8px ${s.color}60`:""}}
              onClick={()=>setChartIdx(i)} aria-label={s.label}/>
          ))}
        </div>
        <button className="carousel-arrow-btn" disabled={chartIdx===COMPLIANCE_SCENARIOS.length-1}
          onClick={()=>setChartIdx(i=>i+1)} aria-label="Next chart">
          <span>›</span>
        </button>
      </div>

      {/* Chart card with swipe */}
      <div className="chart-card"
        onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}
        style={{position:"relative",userSelect:"none"}}
      >
        {/* Scenario label */}
        <div className="carousel-scenario-tag" style={{background:scenario.tagColor, border:`1px solid ${scenario.tagBorder}`}}>
          <span className="cst-label" style={{color:scenario.color}}>{scenario.label}</span>
          <span className="cst-sub">{scenario.subtitle}</span>
        </div>

        {/* Left / right arrows overlaid on chart */}
        <div className="chart-arrow-overlay">
          <button className="chart-overlay-arrow left" disabled={chartIdx===0}
            onClick={()=>setChartIdx(i=>i-1)}>‹</button>
          <button className="chart-overlay-arrow right" disabled={chartIdx===COMPLIANCE_SCENARIOS.length-1}
            onClick={()=>setChartIdx(i=>i+1)}>›</button>
        </div>

        <WeightChart
          current={current}
          goal={goal}
          paces={paces}
          totalBurn={totalBurn}
          maxWeeks={maxChartWeeks}
          compliance={comp}
          selectedPace={selectedPace}
        />

        {/* Clickable pace legend */}
        <div style={{marginTop:"12px"}}>
          <div style={{fontSize:".7rem",color:"var(--muted)",letterSpacing:"1px",textTransform:"uppercase",marginBottom:"8px"}}>
            Tap a pace to highlight it:
          </div>
          <div className="pace-selector">
            {paces.map(p=>{
              const isSelected = selectedPace === p.id;
              const isGhosted  = selectedPace !== null && !isSelected;
              return (
                <button
                  key={p.id}
                  className={`pace-sel-btn${isSelected?" pace-sel-active":""}`}
                  style={{
                    borderColor: isSelected ? rc(p) : isGhosted ? "var(--border)" : "var(--border)",
                    background:  isSelected ? `${rc(p)}18` : "var(--s2)",
                    opacity:     isGhosted ? 0.4 : 1,
                    color:       isSelected ? rc(p) : isGhosted ? "var(--muted)" : "var(--text)",
                  }}
                  onClick={()=>setSelectedPace(prev => prev===p.id ? null : p.id)}
                >
                  <span className="psb-swatch" style={{background:rc(p), opacity: isGhosted?0.4:1}}></span>
                  <span className="psb-label">{p.label}</span>
                  {isSelected && <span className="psb-check">✓</span>}
                </button>
              );
            })}
            {selectedPace && (
              <button className="pace-sel-clear" onClick={()=>setSelectedPace(null)}>
                Show All
              </button>
            )}
          </div>

          {hasCardio && (
            <div className="chart-legend" style={{marginTop:"10px",gap:"14px"}}>
              <div className="chart-legend-item">
                <div style={{width:"20px",height:"2px",borderTop:"2px dashed rgba(255,255,255,.5)"}}></div>
                <span style={{fontSize:".72rem",color:"var(--muted)"}}>Diet only</span>
              </div>
              <div className="chart-legend-item">
                <div style={{width:"20px",height:"3px",background:"rgba(255,255,255,.6)",borderRadius:"2px"}}></div>
                <span style={{fontSize:".72rem",color:"var(--muted)"}}>Diet + Cardio</span>
              </div>
            </div>
          )}
        </div>

        {comp < 1 && (
          <div style={{marginTop:"10px",padding:"8px 10px",background:"rgba(255,107,53,.07)",border:"1px solid rgba(255,107,53,.18)",borderRadius:"8px",fontSize:".75rem",color:"var(--muted)",lineHeight:1.5}}>
            ⚠️ At <strong style={{color:scenario.color}}>{Math.round(comp*100)}% compliance</strong>, effective weekly loss is reduced proportionally. Off-plan days are modeled at maintenance.
          </div>
        )}
        <p style={{fontSize:".68rem",color:"var(--muted)",marginTop:"8px",lineHeight:1.5,fontStyle:"italic"}}>
          Weights shown every 2 weeks. Hover or tap the chart for exact values.
        </p>
      </div>

      {/* ── 2-Week Checkpoint Table ── */}
      <div className="sec-title">Every 2 Weeks — Where You'll Be</div>
      <p style={{fontSize:".76rem",color:"var(--muted)",marginBottom:"10px",lineHeight:1.5}}>
        Projected bodyweight at each 2-week mark, at {Math.round(comp*100)}% plan compliance.
      </p>
      <div className="checkpoint-table">
        <div className="cpt-header">
          <div>Checkpoint</div>
          {paces.map(p=>(
            <div key={p.id} className="cpt-col" style={{color:rc(p)}}>{p.label}</div>
          ))}
          {hasCardio && <div className="cpt-col" style={{color:"var(--orange)"}}>+Cardio</div>}
        </div>
        {(() => {
          const twoWkRows = [];
          for (let wk = 2; wk <= Math.min(maxChartWeeks, 52); wk += 2) {
            const vals = paces.map(p => {
              const lpw = defDiet(p) * comp / 3500;
              const lost = Math.min(lpw * wk, toLose);
              return (current - lost).toFixed(1);
            });
            const cardioVal = hasCardio ? (() => {
              const lpw = defCardio(paces[1]) * comp / 3500;
              const lost = Math.min(lpw * wk, toLose);
              return (current - lost).toFixed(1);
            })() : null;
            const allAtGoal = paces.every(p => {
              const lpw = defDiet(p) * comp / 3500;
              return lpw * wk >= toLose;
            });
            const mo = wk / 4.33;
            const lbl = wk < 4 ? `${wk} weeks` : mo < 11.5 ? `${Math.round(mo)} month${Math.round(mo)!==1?"s":""}` : "1 year";
            twoWkRows.push({ wk, lbl, vals, cardioVal, allAtGoal });
            if (allAtGoal) break;
          }
          return twoWkRows.map(({ wk, lbl, vals, cardioVal, allAtGoal }) => (
            <div key={wk} className={`cpt-row${allAtGoal?" cpt-row-goal":""}`}>
              <div className="cpt-period">
                {allAtGoal && <span className="cpt-star">🎯 </span>}
                {lbl}
                {wk % 4 === 0 && !allAtGoal && <span className="cpt-month-tick"></span>}
              </div>
              {vals.map((v,i)=>(
                <div key={i} className="cpt-col" style={{
                  color: parseFloat(v) <= goal ? "#08dce0" : rc(paces[i]),
                  fontWeight: allAtGoal ? "700" : "600"
                }}>
                  {parseFloat(v) <= goal ? `${goal} ✓` : `${v} lbs`}
                </div>
              ))}
              {hasCardio && (
                <div className="cpt-col" style={{
                  color: parseFloat(cardioVal) <= goal ? "#08dce0" : "var(--orange)",
                  fontWeight: allAtGoal ? "700" : "600"
                }}>
                  {parseFloat(cardioVal) <= goal ? `${goal} ✓` : `${cardioVal} lbs`}
                </div>
              )}
            </div>
          ));
        })()}
      </div>

      {/* ── Time-to-goal tables ── */}
      <div className="sec-title">Time to Reach {goal} lbs</div>

      <div className="gtt-block">
        <div className="gtt-block-header diet-header">🥗 Diet Only</div>
        {paces.map(p=>(
          <div key={p.id} className="gtt-block-row">
            <div style={{display:"flex",alignItems:"center",gap:"8px"}}>
              <div style={{width:"10px",height:"10px",borderRadius:"50%",background:rc(p),flexShrink:0}}></div>
              <span style={{fontSize:".82rem",fontWeight:600}}>{p.label}</span>
            </div>
            <div style={{textAlign:"right"}}>
              <div className={p.textCls} style={{fontWeight:700,fontSize:"1rem"}}>{formatWeeks(wksNeeded(p, defDiet, comp))}</div>
              {comp < 1 && <div style={{fontSize:".68rem",color:scenario.color}}>at {Math.round(comp*100)}% compliance</div>}
            </div>
          </div>
        ))}
      </div>

      {hasCardio && (
        <div className="gtt-block" style={{marginTop:"10px"}}>
          <div className="gtt-block-header cardio-header">🔥 Diet + Cardio</div>
          {paces.map(p=>{
            const wksDiet   = wksNeeded(p, defDiet,   comp);
            const wksCardio = wksNeeded(p, defCardio, comp);
            const savedWks  = wksDiet && wksCardio ? wksDiet - wksCardio : null;
            const savedLbl  = savedWks ? friendlyTime(savedWks) : null;
            return (
              <div key={p.id} className="gtt-block-row">
                <div style={{display:"flex",alignItems:"center",gap:"8px"}}>
                  <div style={{width:"10px",height:"10px",borderRadius:"50%",background:rc(p),flexShrink:0}}></div>
                  <span style={{fontSize:".82rem",fontWeight:600}}>{p.label}</span>
                </div>
                <div style={{textAlign:"right"}}>
                  <div className={p.textCls} style={{fontWeight:700,fontSize:"1rem"}}>{formatWeeks(wksCardio)}</div>
                  {savedLbl && <div style={{fontSize:".72rem",color:"var(--accent)",marginTop:"2px"}}>⚡ {savedLbl} faster</div>}
                  {comp < 1 && <div style={{fontSize:".68rem",color:scenario.color}}>at {Math.round(comp*100)}% compliance</div>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Progress milestones ── */}
      <div className="sec-title">Progress by Timeframe</div>
      {visibleMilestones.map(ms=>{
        const isGoalCard = ms._goalCard;
        const lossesD = paces.map(p=>Math.min(projectedLoss(ms.weeks, defDiet(p)*comp),   toLose));
        const lossesC = paces.map(p=>Math.min(projectedLoss(ms.weeks, defCardio(p)*comp), toLose));
        return (
          <div className={`ms-card${isGoalCard?" ms-card-goal":""}`} key={ms.label}>
            <div className="ms-card-header">
              {isGoalCard ? "🎉 Goal Reached!" : ms.label}
              {isGoalCard && <span style={{fontSize:".75rem",fontWeight:400,color:"var(--muted)",marginLeft:"8px"}}>({ms.label})</span>}
            </div>
            {paces.map((p,i)=>{
              const lossD = lossesD[i], lossC = hasCardio ? lossesC[i] : null;
              const pctD  = Math.min((lossD/toLose)*100, 100);
              const wtD   = (current-lossD).toFixed(1);
              const wtC   = hasCardio ? (current-lossC).toFixed(1) : null;
              const doneD = lossD >= toLose-0.01;
              const doneC = hasCardio && lossC >= toLose-0.01;
              return (
                <div className="ms-row-inline" key={p.id}>
                  <div style={{flex:1}}>
                    <div style={{display:"flex",alignItems:"center",gap:"6px",marginBottom:"4px"}}>
                      <div style={{width:"8px",height:"8px",borderRadius:"50%",background:rc(p),flexShrink:0}}></div>
                      <div className="ms-pace">{p.label}</div>
                    </div>
                    <div className="prog-bar-bg" style={{width:"100%",maxWidth:"120px"}}>
                      <div className="prog-bar-fill" style={{width:`${pctD}%`,background:p.color}}></div>
                    </div>
                  </div>
                  <div style={{textAlign:"right"}}>
                    {hasCardio ? (
                      <>
                        <div className={`ms-loss ${p.textCls}`}>
                          <span style={{opacity:.65}}>Diet: {doneD?"✓":` −${lossD.toFixed(1)} lbs`}</span>
                          <span style={{marginLeft:"6px"}}>+Cardio: {doneC?"✓ goal!":` −${lossC.toFixed(1)} lbs`}</span>
                        </div>
                        <div className="ms-wt">{doneC?`${goal} lbs ✓`:`${wtC} lbs (w/cardio)`}</div>
                      </>
                    ) : (
                      <>
                        <div className={`ms-loss ${p.textCls}`}>{doneD?"✓ Goal!":` −${lossD.toFixed(1)} lbs`}</div>
                        <div className="ms-wt">{doneD?`${goal} lbs`:wtD+" lbs"}</div>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}

      <p className="footnote">
        Projections assume consistent adherence at the selected compliance level. Compliance is modeled as a fraction of days at full deficit; off-plan days are assumed at maintenance.
        Real results vary. Consult a healthcare provider before starting any program.
      </p>
    </div>
  );
}

// ─── Profile Selector ─────────────────────────────────────────────────────────

// ─── Daily Dashboard ──────────────────────────────────────────────────────────
// The primary view after plan setup — transforms Glide from a calculator
// into a daily-use platform. This is what drives retention and daily engagement.

// ─── Meal / food log (Session 9) ────────────────────────────────────────────
// Itemized food logging that rolls into the day's totals. Each entry can be as
// detailed (named food + macros + meal type) or as simple (just calories,
// optionally tagged to a meal) as the user wants. This is the manual/free tier;
// the food-library API (Blaze) will later auto-fill these same fields.
// Food-database search via USDA FoodData Central (free, CORS-enabled, no server
// needed). Uses the public DEMO_KEY by default (heavily rate-limited); set
// VITE_USDA_API_KEY (a free api.data.gov key) for production-grade limits. The
// key is read-only food data, so exposing it in the browser bundle is low-risk;
// it can be proxied through a Cloud Function once on Blaze. Returns normalized
// per-100g foods: { name, kcal, p, c, f }.
async function searchFoods(query) {
  const key = (import.meta.env && import.meta.env.VITE_USDA_API_KEY) || "DEMO_KEY";
  const url = `https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${key}` +
    `&query=${encodeURIComponent(query)}&pageSize=8`;
  let r;
  try {
    r = await fetch(url);
  } catch {
    // Network-level failure. On the shared DEMO_KEY this is usually a quota
    // block (the rate-limit response has no CORS header, so it surfaces here).
    throw new Error("Food search is temporarily unavailable — try again in a moment.");
  }
  if (!r.ok) {
    throw new Error(r.status === 429
      ? "Food search limit reached — try again in a bit (or add a free USDA API key)."
      : "Food search is temporarily unavailable — try again in a moment.");
  }
  const j = await r.json();
  const tidy = (s) => (s || "Food").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
  return (j.foods || []).map((x) => {
    const n = {};
    (x.foodNutrients || []).forEach((z) => {
      // "Energy" appears in both KCAL and kJ — keep only the kcal value.
      if (z.nutrientName === "Energy" && z.unitName && z.unitName !== "KCAL") return;
      n[z.nutrientName] = z.value;
    });
    return { name: tidy(x.description), brand: x.brandOwner || x.brandName || "",
      kcal: Math.round(n["Energy"] || 0), p: Math.round(n["Protein"] || 0),
      c: Math.round(n["Carbohydrate, by difference"] || 0), f: Math.round(n["Total lipid (fat)"] || 0) };
  }).filter((f) => f.kcal > 0);
}

// Brand wordmark — "GLI" in brand cyan + "DE" in white, mirroring the old
// CALORIE+IQ two-tone. Centralized so the treatment lives in one place; used in
// every screen's header bar.
function BrandLogo() {
  return (
    <span className="font-display text-2xl tracking-[2px] text-primary">GLI<span className="text-fg">DE</span></span>
  );
}

function MealLog({ meals, onAddMeal, onRemoveMeal, onEditMeal, recentFoods }) {
  const [name, setName] = useState("");
  const [cals, setCals] = useState("");
  const [showMacros, setShowMacros] = useState(false);
  const [protein, setProtein] = useState("");
  const [carbs, setCarbs] = useState("");
  const [fat, setFat] = useState("");
  // Which meal's add-form is open: "Breakfast"/"Lunch"/"Dinner"/"Snack",
  // "other", or null (none open).
  const [addingTo, setAddingTo] = useState(null);
  const [editingId, setEditingId] = useState(null); // set when editing an existing entry
  const [open, setOpen] = useState(false); // the whole section is a collapsible dropdown
  // Food-database search (USDA) within the add-form.
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQ, setSearchQ] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searchErr, setSearchErr] = useState("");
  const [picked, setPicked] = useState(null); // chosen food's per-100g macros, for serving rescale
  const [grams, setGrams] = useState("100");

  const list = meals || [];
  const loggedTotal = list.reduce((s, m) => s + (m.calories || 0), 0);
  // Daily macro totals (each food can carry protein/carbs/fat grams).
  const totP = list.reduce((s, m) => s + (m.protein || 0), 0);
  const totC = list.reduce((s, m) => s + (m.carbs || 0), 0);
  const totF = list.reduce((s, m) => s + (m.fat || 0), 0);
  const hasMacros = totP > 0 || totC > 0 || totF > 0;
  const TYPES = ["Breakfast", "Lunch", "Dinner", "Snack"];
  // Compact protein/carbs/fat chips — colour-coded, shown when any are logged.
  const MacroSummary = ({ small }) => (
    <span style={{ display:"inline-flex", gap: small ? "8px" : "12px", flexWrap:"wrap",
      fontSize: small ? ".72rem" : ".8rem", fontWeight:600 }}>
      <span style={{ color:"var(--accent)" }}>{totP}g <span style={{ color:"var(--muted)", fontWeight:400 }}>protein</span></span>
      <span style={{ color:"var(--yellow)" }}>{totC}g <span style={{ color:"var(--muted)", fontWeight:400 }}>carbs</span></span>
      <span style={{ color:"var(--orange)" }}>{totF}g <span style={{ color:"var(--muted)", fontWeight:400 }}>fat</span></span>
    </span>
  );

  const resetSearch = () => { setSearchOpen(false); setSearchQ(""); setResults([]); setSearching(false); setSearchErr(""); setPicked(null); setGrams("100"); };
  const resetFields = () => { setName(""); setCals(""); setProtein(""); setCarbs(""); setFat(""); setShowMacros(false); resetSearch(); };
  // Run a USDA food search for the current query.
  const runSearch = async () => {
    const q = searchQ.trim();
    if (q.length < 2) return;
    setSearching(true); setSearchErr(""); setResults([]);
    try { setResults(await searchFoods(q)); }
    catch (e) { setSearchErr(e.message || "Search failed."); }
    finally { setSearching(false); }
  };
  // Fill the form from a per-100g food scaled to a serving size (grams).
  const applyServing = (food, g) => {
    const factor = (parseFloat(g) || 0) / 100;
    setCals(String(Math.round(food.kcal * factor) || ""));
    setProtein(String(Math.round(food.p * factor) || ""));
    setCarbs(String(Math.round(food.c * factor) || ""));
    setFat(String(Math.round(food.f * factor) || ""));
  };
  // Pick a search result: remember its per-100g macros, fill the form at 100g.
  const pickFood = (food) => {
    setPicked(food); setGrams("100"); setName(food.name);
    applyServing(food, "100"); setShowMacros(true);
  };
  // Adjust serving size after a pick — rescales the filled macros live.
  const setServing = (g) => { setGrams(g); if (picked) applyServing(picked, g); };
  const openForm = (key) => { resetFields(); setEditingId(null); setAddingTo(key); };
  const closeForm = () => { resetFields(); setEditingId(null); setAddingTo(null); };
  // Open the form pre-filled to fix an existing entry.
  const openEdit = (m) => {
    setName(m.name || "");
    setCals(String(m.calories || ""));
    setProtein(m.protein ? String(m.protein) : "");
    setCarbs(m.carbs ? String(m.carbs) : "");
    setFat(m.fat ? String(m.fat) : "");
    setShowMacros(!!(m.protein || m.carbs || m.fat));
    setEditingId(m.id);
    setAddingTo(m.type || "other");
  };
  const submit = () => {
    const c = parseInt(cals);
    if (!c || c <= 0) return; // calories are the one required field
    const payload = { name: name.trim(), type: addingTo === "other" ? "" : addingTo, calories: c,
      protein: parseInt(protein) || 0, carbs: parseInt(carbs) || 0, fat: parseInt(fat) || 0 };
    if (editingId) onEditMeal(editingId, payload);
    else onAddMeal(payload);
    closeForm();
  };

  const inp = { padding:"9px 11px", fontSize:".85rem", borderRadius:"8px",
    border:"1px solid var(--border)", background:"var(--s2)", color:"var(--text)", minWidth:0 };
  const addBtn = { marginTop:"4px", padding:"9px 12px", fontSize:".8rem", fontWeight:700,
    borderRadius:"8px", border:"1px solid var(--accent)", background:"rgba(8,220,224,.08)",
    color:"var(--accent)", cursor:"pointer" };

  const mealRow = (m) => (
    <div key={m.id} style={{ display:"flex", alignItems:"center", gap:"8px",
      padding:"6px 8px", borderRadius:"6px", background:"rgba(255,255,255,.04)" }}>
      <span style={{ flex:1, fontSize:".82rem" }}>
        {m.name || <span style={{ color:"var(--muted)" }}>Quick entry</span>}
        {(m.protein || m.carbs || m.fat) ? (
          <span style={{ color:"var(--muted)", fontSize:".72rem" }}>
            {"  "}({m.protein||0}p / {m.carbs||0}c / {m.fat||0}f)
          </span>
        ) : null}
        {m.time ? (
          <span style={{ color:"var(--muted)", fontSize:".72rem" }}>{"  · "}{fmtClock(m.time)}</span>
        ) : null}
      </span>
      <span style={{ fontWeight:700, fontSize:".82rem" }}>{(m.calories||0).toLocaleString()} cal</span>
      <button onClick={() => openEdit(m)} title="Edit"
        style={{ border:"none", background:"transparent", color:"var(--muted)",
          cursor:"pointer", fontSize:".9rem", lineHeight:1 }}>✎</button>
      <button onClick={() => onRemoveMeal(m.id)} title="Remove"
        style={{ border:"none", background:"transparent", color:"var(--muted)",
          cursor:"pointer", fontSize:"1rem", lineHeight:1 }}>✕</button>
    </div>
  );

  // One-tap re-add of a recently logged food into the meal type being added.
  const quickAddRecent = (f) => {
    onAddMeal({ name: f.name, type: addingTo === "other" ? "" : addingTo,
      calories: f.calories || 0, protein: f.protein || 0, carbs: f.carbs || 0, fat: f.fat || 0 });
    closeForm();
  };

  // The inline add-form, shown under whichever meal you tapped "+ Add" on.
  const addForm = () => (
    <div style={{ marginTop:"6px", display:"flex", flexDirection:"column", gap:"6px",
      padding:"8px", borderRadius:"8px", background:"rgba(255,255,255,.04)" }}>
      {/* Recently logged foods — tap to re-add instantly (only when adding new) */}
      {!editingId && (recentFoods || []).length > 0 && (
        <div>
          <div style={{ fontSize:".68rem", color:"var(--muted)", marginBottom:"4px",
            textTransform:"uppercase", letterSpacing:".5px", fontWeight:700 }}>Recent — tap to add</div>
          <div style={{ display:"flex", gap:"6px", flexWrap:"wrap" }}>
            {(recentFoods || []).slice(0, 8).map((f, i) => (
              <button key={i} onClick={() => quickAddRecent(f)}
                style={{ padding:"5px 9px", fontSize:".74rem", borderRadius:"999px", cursor:"pointer",
                  border:"1px solid var(--border)", background:"var(--s2)", color:"var(--text)",
                  whiteSpace:"nowrap", maxWidth:"100%", overflow:"hidden", textOverflow:"ellipsis" }}>
                {f.name} <span style={{ color:"var(--muted)" }}>· {(f.calories||0)} cal</span>
              </button>
            ))}
          </div>
        </div>
      )}
      {/* Food-database search — find a food and auto-fill calories + macros (only when adding new) */}
      {!editingId && (
        <div>
          <button onClick={() => { const n = !searchOpen; setSearchOpen(n); if (!n) resetSearch(); }}
            style={{ border:"none", background:"transparent", color:"var(--accent)", cursor:"pointer",
              fontSize:".74rem", fontWeight:700, padding:"0", textAlign:"left" }}>
            {searchOpen ? "✕ Close food search" : "🔍 Search food database"}
          </button>
          {searchOpen && (
            <div style={{ marginTop:"6px", display:"flex", flexDirection:"column", gap:"6px" }}>
              <div style={{ display:"flex", gap:"6px" }}>
                <input style={{ ...inp, flex:1 }} placeholder="Search foods (e.g. chicken breast)"
                  value={searchQ} onChange={(e) => setSearchQ(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && runSearch()} />
                <button onClick={runSearch} disabled={searching || searchQ.trim().length < 2}
                  style={{ padding:"8px 14px", fontSize:".8rem", fontWeight:700, borderRadius:"8px",
                    border:"none", background:"var(--accent-fill)", color:"#0b0b12", cursor:"pointer",
                    opacity: (searching || searchQ.trim().length < 2) ? .5 : 1 }}>
                  {searching ? "…" : "Search"}
                </button>
              </div>
              {searchErr && <div style={{ fontSize:".74rem", color:"var(--red)" }}>{searchErr}</div>}
              {!searching && !searchErr && results.length === 0 && searchQ.trim().length >= 2 && (
                <div style={{ fontSize:".74rem", color:"var(--muted)" }}>No matches — try a simpler term, or enter it manually below.</div>
              )}
              {results.length > 0 && (
                <div style={{ display:"flex", flexDirection:"column", gap:"4px", maxHeight:"168px", overflowY:"auto" }}>
                  {results.map((f, i) => (
                    <button key={i} onClick={() => pickFood(f)}
                      style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:"8px",
                        padding:"7px 9px", borderRadius:"6px", cursor:"pointer", textAlign:"left",
                        border:"1px solid " + (picked && picked.name === f.name ? "var(--accent)" : "var(--border)"),
                        background: picked && picked.name === f.name ? "rgba(8,220,224,.08)" : "var(--s2)", color:"var(--text)" }}>
                      <span style={{ flex:1, fontSize:".78rem", minWidth:0 }}>
                        <span style={{ display:"block", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{f.name}</span>
                        {f.brand && <span style={{ color:"var(--muted)", fontSize:".68rem" }}>{f.brand}</span>}
                      </span>
                      <span style={{ fontSize:".7rem", color:"var(--muted)", whiteSpace:"nowrap", textAlign:"right" }}>
                        {f.kcal} cal<br />{f.p}p/{f.c}c/{f.f}f <span style={{ opacity:.7 }}>/100g</span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
              {picked && (
                <div style={{ display:"flex", alignItems:"center", gap:"8px", fontSize:".76rem", color:"var(--muted)" }}>
                  <span>Serving:</span>
                  <input style={{ ...inp, width:"72px", flex:"none", padding:"6px 8px" }} type="number" inputMode="numeric"
                    value={grams} onChange={(e) => setServing(e.target.value)} />
                  <span>g → fills below. Adjust then Add.</span>
                </div>
              )}
            </div>
          )}
        </div>
      )}
      <div style={{ display:"flex", gap:"6px", flexWrap:"wrap" }}>
        <input autoFocus style={{ ...inp, flex:"2 1 140px" }} placeholder="Food (optional)"
          value={name} onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()} />
        <input style={{ ...inp, flex:"1 1 90px" }} type="number" inputMode="numeric"
          placeholder="Calories" value={cals} onChange={(e) => setCals(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()} />
      </div>
      <button onClick={() => setShowMacros((s) => !s)}
        style={{ border:"none", background:"transparent", color:"var(--muted)", cursor:"pointer",
          fontSize:".72rem", textDecoration:"underline", padding:"0", textAlign:"left" }}>
        {showMacros ? "Hide macros" : "+ Add macros (optional)"}
      </button>
      {showMacros && (
        <div style={{ display:"flex", gap:"6px" }}>
          <input style={{ ...inp, flex:1 }} type="number" inputMode="numeric" placeholder="Protein g"
            value={protein} onChange={(e) => setProtein(e.target.value)} />
          <input style={{ ...inp, flex:1 }} type="number" inputMode="numeric" placeholder="Carbs g"
            value={carbs} onChange={(e) => setCarbs(e.target.value)} />
          <input style={{ ...inp, flex:1 }} type="number" inputMode="numeric" placeholder="Fat g"
            value={fat} onChange={(e) => setFat(e.target.value)} />
        </div>
      )}
      <div style={{ display:"flex", gap:"6px" }}>
        <button onClick={submit}
          style={{ padding:"8px 16px", fontSize:".82rem", fontWeight:700, borderRadius:"8px",
            border:"none", background:"var(--accent-fill)", color:"#0b0b12", cursor:"pointer" }}>
          {editingId ? "Save changes" : "Add"}
        </button>
        <button onClick={closeForm}
          style={{ padding:"8px 12px", fontSize:".82rem", borderRadius:"8px",
            border:"1px solid var(--border)", background:"transparent", color:"var(--muted)", cursor:"pointer" }}>Cancel</button>
      </div>
    </div>
  );

  return (
    <div style={{ padding:"12px 14px", background:"var(--s2)", borderRadius:"8px",
      border:"1px solid var(--border)", marginBottom:"6px" }}>
      <div onClick={() => setOpen((o) => !o)}
        style={{ display:"flex", justifyContent:"space-between", alignItems:"center", cursor:"pointer", gap:"8px" }}>
        <div className="sec-title" style={{ marginTop:0, marginBottom:0, display:"flex", alignItems:"center", gap:"8px" }}><Icon name="meal" size={17} color="var(--accent)" />Meals &amp; Food Today</div>
        <div style={{ display:"flex", alignItems:"center", gap:"8px" }}>
          {list.length > 0 && (
            <span style={{ fontSize:".78rem", color:"var(--muted)", whiteSpace:"nowrap" }}>
              {loggedTotal.toLocaleString()} cal · {list.length} item{list.length!==1?"s":""}
            </span>
          )}
          {/* Clear, button-like cue that this section is where you log food. */}
          <span style={{ display:"inline-flex", alignItems:"center", gap:"5px", padding:"6px 11px",
            borderRadius:"999px", border:"1px solid var(--accent)",
            background: open ? "transparent" : "rgba(8,220,224,.1)",
            color:"var(--accent)", fontSize:".76rem", fontWeight:700, whiteSpace:"nowrap" }}>
            {open ? "▾ Close" : (list.length > 0 ? "＋ Add food" : "＋ Log food")}
          </span>
        </div>
      </div>

      {/* When collapsed, still surface the day's macro totals at a glance. */}
      {!open && hasMacros && (
        <div style={{ marginTop:"6px" }}>
          <MacroSummary small />
        </div>
      )}

      {open && (
      <div style={{ display:"flex", flexDirection:"column", gap:"10px", marginTop:"10px" }}>
        {TYPES.map((t) => {
          const items = list.filter((m) => m.type === t);
          const subtotal = items.reduce((s, m) => s + (m.calories||0), 0);
          return (
            <div key={t}>
              <div style={{ fontSize:".72rem", fontWeight:700, color:"var(--muted)",
                textTransform:"uppercase", letterSpacing:".5px", marginBottom:"4px",
                display:"flex", justifyContent:"space-between" }}>
                <span>{t}</span>
                {items.length > 0 && <span>{subtotal.toLocaleString()} cal</span>}
              </div>
              {items.length > 0 && (
                <div style={{ display:"flex", flexDirection:"column", gap:"4px" }}>{items.map(mealRow)}</div>
              )}
              {addingTo === t ? addForm() : (
                <button style={addBtn} onClick={() => openForm(t)}>+ Add food to {t}</button>
              )}
            </div>
          );
        })}

        {/* Quick / untyped entries */}
        <div>
          <div style={{ fontSize:".72rem", fontWeight:700, color:"var(--muted)",
            textTransform:"uppercase", letterSpacing:".5px", marginBottom:"4px" }}>
            Other / quick entries
          </div>
          {list.filter((m) => !m.type).length > 0 && (
            <div style={{ display:"flex", flexDirection:"column", gap:"4px" }}>
              {list.filter((m) => !m.type).map(mealRow)}
            </div>
          )}
          {addingTo === "other" ? addForm() : (
            <button style={addBtn} onClick={() => openForm("other")}>+ Add a quick entry</button>
          )}
        </div>

        {list.length > 0 && (
          <div style={{ borderTop:"1px solid var(--border)", paddingTop:"8px",
            display:"flex", justifyContent:"space-between", alignItems:"center", gap:"8px", flexWrap:"wrap" }}>
            {hasMacros
              ? <MacroSummary />
              : <span style={{ fontSize:".72rem", color:"var(--muted)" }}>Tip: add macros when logging to track protein, carbs &amp; fat.</span>}
            <span style={{ fontSize:".78rem", fontWeight:700, color:"var(--text)" }}>
              {loggedTotal.toLocaleString()} cal · {list.length} item{list.length!==1?"s":""}
            </span>
          </div>
        )}
      </div>
      )}
    </div>
  );
}

// ─── Recent activity feed (Session 10) ──────────────────────────────────────
// A collapsible who-changed-what log for the plan. Cooperative tier (each side
// records its own actions); a tamper-proof version arrives with Blaze.
// Trainer vs client name colours so it's obvious who made a change.
const histNameColor = (role) => (role === ROLES.CLIENT ? "#4fc3f7" : "var(--accent)");

function ActivityRow({ ev }) {
  return (
    <div style={{ display:"flex", gap:"8px", fontSize:".8rem", alignItems:"baseline" }}>
      <span style={{ fontWeight:700, color: histNameColor(ev.role) }}>{ev.name}</span>
      <span style={{ fontSize:".64rem", color:"var(--muted)", border:"1px solid var(--border)",
        borderRadius:"4px", padding:"0 4px" }}>
        {ev.role === ROLES.CLIENT ? "client" : "trainer"}
      </span>
      <span style={{ flex:1 }}>{ev.action}</span>
      <span style={{ color:"var(--muted)", fontSize:".7rem", whiteSpace:"nowrap" }}>{timeAgo(ev.ts)}</span>
    </div>
  );
}

// Match an activity event's timestamp against a relative-time search query like
// "today", "yesterday", "3 days ago", "2 weeks", "last month", "1 mo ago". Lets
// the activity search filter by age, not just the literal date/name/action text.
// Returns true on a match, false if the query isn't a recognized time phrase.
function relativeTimeMatch(eventDate, q) {
  const startOfDay = (dt) => new Date(dt.getFullYear(), dt.getMonth(), dt.getDate());
  const now = new Date();
  const today = startOfDay(now);
  const evDay = startOfDay(eventDate);
  const daysAgo = Math.round((today - evDay) / 86400000);

  if (q === "today") return daysAgo === 0;
  if (q === "yesterday") return daysAgo === 1;
  if (q === "this week") return daysAgo >= 0 && daysAgo <= 6;
  if (q === "last week") return daysAgo >= 7 && daysAgo <= 13;
  if (q === "this month") return eventDate.getFullYear() === now.getFullYear() && eventDate.getMonth() === now.getMonth();
  if (q === "last month") {
    const t = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    return eventDate.getFullYear() === t.getFullYear() && eventDate.getMonth() === t.getMonth();
  }
  // "N unit [ago]" — e.g. "3 days ago", "2 weeks", "1 mo", "6 months ago".
  const m = q.match(/^(\d+)\s*(days?|d|weeks?|w|months?|mo|m)\.?\s*(ago)?$/);
  if (!m) return false;
  const n = parseInt(m[1], 10);
  const unit = m[2];
  if (unit === "d" || unit.startsWith("day")) return daysAgo === n;               // exact day
  if (unit === "w" || unit.startsWith("week")) return Math.abs(daysAgo - n * 7) <= 3; // ~that week
  // months ("m", "mo", "month", "months") — that calendar month N months back
  const t = new Date(now.getFullYear(), now.getMonth() - n, 1);
  return eventDate.getFullYear() === t.getFullYear() && eventDate.getMonth() === t.getMonth();
}

function ActivityFeed({ history, onRefresh }) {
  const [showFull, setShowFull] = useState(false);
  const [query, setQuery] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const list = history || [];

  const doRefresh = async (e) => {
    if (e) e.stopPropagation();
    if (!onRefresh) return;
    setRefreshing(true);
    try { await onRefresh(); } catch (err) { /* ignore */ }
    setTimeout(() => setRefreshing(false), 400);
  };

  const matches = (ev) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    const d = new Date(ev.ts);
    const hay = `${ev.name} ${ev.action} ${d.toLocaleDateString()} ` +
      `${d.toLocaleString("en-US", { month:"long", day:"numeric", year:"numeric" })}`.toLowerCase();
    if (hay.toLowerCase().includes(q)) return true;
    // Also match relative-time phrases like "3 days ago", "2 weeks", "last month".
    return relativeTimeMatch(d, q);
  };
  const filtered = list.filter(matches);

  return (
    <>
      <div style={{ padding:"12px 14px", background:"var(--s2)", borderRadius:"8px",
        border:"1px solid var(--border)", marginBottom:"6px" }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <div className="sec-title" style={{ marginTop:0, marginBottom:0 }}>🕓 Recent Activity</div>
          <div style={{ display:"flex", alignItems:"center", gap:"10px" }}>
            {list.length > 0 && (
              <span style={{ fontSize:".72rem", color:"var(--muted)" }}>
                {list.length} change{list.length!==1?"s":""}
              </span>
            )}
            {onRefresh && (
              <button onClick={doRefresh} title="Refresh"
                style={{ border:"none", background:"transparent", color:"var(--accent)",
                  cursor:"pointer", fontSize:".95rem", lineHeight:1, padding:0 }}>
                {refreshing ? "…" : "↻"}
              </button>
            )}
          </div>
        </div>

        {list.length === 0 ? (
          <div style={{ fontSize:".8rem", color:"var(--muted)", marginTop:"8px" }}>
            No activity yet. Logging food, weight, or editing the plan will show up here.
          </div>
        ) : (
          <div style={{ display:"flex", flexDirection:"column", gap:"7px", marginTop:"10px" }}>
            {list.slice(0, 3).map((ev) => <ActivityRow key={ev.id} ev={ev} />)}
          </div>
        )}

        {list.length > 0 && (
          <button onClick={() => { setQuery(""); setShowFull(true); }}
            style={{ marginTop:"8px", border:"none", background:"transparent", color:"var(--accent)",
              cursor:"pointer", fontSize:".76rem", fontWeight:600, padding:"2px 0" }}>
            View all changes →
          </button>
        )}
      </div>

      {showFull && (
        <div onClick={() => setShowFull(false)}
          style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.6)", zIndex:10000,
            display:"flex", alignItems:"flex-start", justifyContent:"center", padding:"24px 16px", overflowY:"auto" }}>
          <div onClick={(e) => e.stopPropagation()}
            style={{ width:"100%", maxWidth:"560px", maxHeight:"85vh", background:"#14141c",
              border:"1px solid var(--border)", borderRadius:"12px", padding:"16px",
              display:"flex", flexDirection:"column", gap:"10px" }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
              <div className="sec-title" style={{ margin:0 }}>🕓 All Activity ({list.length})</div>
              <button onClick={() => setShowFull(false)}
                style={{ border:"none", background:"transparent", color:"var(--muted)",
                  cursor:"pointer", fontSize:"1.2rem", lineHeight:1 }}>✕</button>
            </div>
            <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name, action, date, or '3 days ago', '2 weeks', 'last month'…"
              style={{ padding:"10px 12px", fontSize:".88rem", borderRadius:"8px",
                border:"1px solid var(--border)", background:"var(--s2)", color:"var(--text)" }} />
            <div style={{ display:"flex", flexDirection:"column", gap:"8px", overflowY:"auto", flex:1 }}>
              {filtered.length === 0 ? (
                <div style={{ fontSize:".82rem", color:"var(--muted)", padding:"8px 0" }}>
                  No changes match “{query}”.
                </div>
              ) : filtered.map((ev) => <ActivityRow key={ev.id} ev={ev} />)}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// LOCAL-calendar YYYY-MM-DD (NOT UTC). The daily log / check-in keys must reflect
// the user's own day: Smooth Training is in Miami (Eastern), where after ~8pm the
// UTC date is already tomorrow, so a UTC key wrote evening logs onto the wrong day
// and marked the wrong "today" on the calendars (Session 45 fix). Use this for any
// "now → date key" computation so reads and writes agree on the local day.
const ymdLocal = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// Local clock time as 24h "HH:MM" — stamped on a meal when it's logged, so the
// AI (and the user) can later see when meals were eaten for time-of-day trends.
const hhmmLocal = (d = new Date()) =>
  `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
// "HH:MM" (24h) → "h:mm AM/PM" for display; passes through anything unparseable.
const fmtClock = (t) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(t || ""));
  if (!m) return t || "";
  let h = +m[1]; const ap = h >= 12 ? "PM" : "AM"; h = h % 12 || 12;
  return `${h}:${m[2]} ${ap}`;
};

// ─── Calendar view (Session 22) ──────────────────────────────────────────────
// Month / week / day calendar over a plan's daily logs + check-ins. Each day
// shows indicators (food logged / weigh-in / workout / scheduled workout) and
// can be opened to log or back-date food, weight, and workouts. Date keys are
// local YYYY-MM-DD (Session 45) so they match the user's own calendar day.
function CalendarView({ data, tdee, onClose, onReadDay, onWriteDay, onListLoggedDays, onSaveCheckIn, onDeleteCheckIn }) {
  const todayKey = ymdLocal();
  const keyOf = (y, m, d) => new Date(Date.UTC(y, m, d)).toISOString().slice(0, 10);
  const parseKey = (k) => { const [y, m, d] = k.split("-").map(Number); return { y, m: m - 1, d }; };
  const mondayIdx = (k) => (new Date(k + "T00:00:00Z").getUTCDay() + 6) % 7; // Mon=0..Sun=6
  const weekdayName = (k) => DAYS[mondayIdx(k)];
  const fmtLong = (k) => new Date(k + "T00:00:00Z").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
  const fmtShort = (k) => new Date(k + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

  const [view, setView] = useState("month");
  const tp = parseKey(todayKey);
  const [cur, setCur] = useState({ y: tp.y, m: tp.m });   // month cursor
  const [weekStart, setWeekStart] = useState(null);       // Monday key of the shown week
  const [sel, setSel] = useState(todayKey);               // selected day
  const [loggedDays, setLoggedDays] = useState([]);       // dates with a log entry
  const [dayLog, setDayLog] = useState(null);             // selected day's log
  const [dayCals, setDayCals] = useState({});             // date -> logged calories (month view tinting)
  const [dayProt, setDayProt] = useState({});             // date -> logged protein g (week macro adherence)

  // Daily calorie target — same formula the dashboard/Results use, for adherence tinting.
  const calTarget = (computeClientCalories(data) || {}).target || null;
  // Daily protein target — custom override, else the dashboard default (~1 g per lb bodyweight).
  const protTarget = (data.macroTargets && data.macroTargets.protein != null)
    ? Number(data.macroTargets.protein)
    : (data.weightLbs ? Math.round(Number(data.weightLbs)) : null);

  useEffect(() => { (async () => setLoggedDays(await onListLoggedDays()))(); }, []);
  useEffect(() => { (async () => setDayLog(await onReadDay(sel)))(); }, [sel]);
  // Read calorie totals for a set of dates (only logged + not-yet-cached), merge
  // into dayCals. Used by both the month and week adherence views; cached so a
  // month/week isn't re-read on revisit.
  const loadCals = async (keys) => {
    const need = keys.filter((k) => loggedDays.includes(k) && !(k in dayCals));
    if (need.length === 0) return;
    const entries = await Promise.all(need.map(async (k) => {
      try { const d = await onReadDay(k); return [k, d && d.calories ? d.calories : 0, d && d.protein ? d.protein : 0]; }
      catch { return [k, 0, 0]; }
    }));
    setDayCals((prev) => { const next = { ...prev }; entries.forEach(([k, v]) => { next[k] = v; }); return next; });
    setDayProt((prev) => { const next = { ...prev }; entries.forEach(([k, , p]) => { next[k] = p; }); return next; });
  };
  // Visible-month logged days (bounded ≤31). Loaded regardless of whether a
  // calorie target exists: the totals feed the week-view numbers + roll-ups and
  // the month tooltips; the target only drives the green/amber adherence tint
  // (which degrades gracefully when absent). Gating on calTarget previously left
  // dayCals empty for any plan missing gender/age/height (e.g. a partially set-up
  // client a trainer opens), making logged days show "🍽️ logged" instead of "N cal".
  useEffect(() => {
    const prefix = `${cur.y}-${String(cur.m + 1).padStart(2, "0")}-`;
    loadCals(loggedDays.filter((k) => k.startsWith(prefix)));
  }, [cur, loggedDays]);
  // Visible week's 7 days (can cross a month boundary, so loaded separately).
  useEffect(() => {
    if (view !== "week") return;
    const ws = weekStart || (() => { const off = (new Date(sel + "T00:00:00Z").getUTCDay() + 6) % 7; const p = sel.split("-").map(Number); return new Date(Date.UTC(p[0], p[1] - 1, p[2] - off)).toISOString().slice(0, 10); })();
    const wp = ws.split("-").map(Number);
    const days = Array.from({ length: 7 }, (_, i) => new Date(Date.UTC(wp[0], wp[1] - 1, wp[2] + i)).toISOString().slice(0, 10));
    loadCals(days);
  }, [weekStart, view, sel, loggedDays]);

  // Check-in lookup by date (weight / workout / mood).
  const ciByDate = {};
  (data.checkIns || []).forEach((c) => { ciByDate[c.date] = c; });
  const scheduledFor = (k) => {
    const dn = weekdayName(k);
    const c = (data.cardio && data.cardio[dn]) || [];
    const s = (data.strength && data.strength[dn]) || [];
    return c.length + s.length;
  };
  const markLogged = (k) => setLoggedDays((prev) => prev.includes(k) ? prev : [...prev, k]);

  // Indicator dots for a day cell.
  const dots = (k) => {
    const ci = ciByDate[k];
    return { food: loggedDays.includes(k), weight: !!(ci && ci.weight), workout: !!(ci && ci.workedOut), sched: scheduledFor(k) > 0 };
  };

  // ── Day-detail back-dated logging ──
  const writeDay = (next) => { setDayLog(next); onWriteDay(sel, next); if ((next.calories || 0) > 0 || (next.meals || []).length) markLogged(sel); };
  const addCal = (n) => writeDay({ ...(dayLog || {}), calories: Math.max(0, (dayLog?.calories || 0) + n) });
  const addMeal = (meal) => {
    const m = { id: `m${Date.now()}${Math.floor(Math.random() * 1000)}`, name: meal.name || "", type: meal.type || "",
      calories: Number(meal.calories) || 0, protein: Number(meal.protein) || 0, carbs: Number(meal.carbs) || 0, fat: Number(meal.fat) || 0 };
    const d = dayLog || {};
    writeDay({ ...d, meals: [...(d.meals || []), m], calories: (d.calories || 0) + m.calories,
      protein: (d.protein || 0) + m.protein, carbs: (d.carbs || 0) + m.carbs, fat: (d.fat || 0) + m.fat });
  };
  const removeMeal = (id) => {
    const d = dayLog || {}; const m = (d.meals || []).find((x) => x.id === id); if (!m) return;
    writeDay({ ...d, meals: (d.meals || []).filter((x) => x.id !== id), calories: Math.max(0, (d.calories || 0) - m.calories),
      protein: Math.max(0, (d.protein || 0) - m.protein), carbs: Math.max(0, (d.carbs || 0) - m.carbs), fat: Math.max(0, (d.fat || 0) - m.fat) });
  };
  const editMeal = (id, fields) => {
    const d = dayLog || {}; const old = (d.meals || []).find((x) => x.id === id); if (!old) return;
    const nm = { ...old, ...fields, calories: Number(fields.calories) || 0, protein: Number(fields.protein) || 0, carbs: Number(fields.carbs) || 0, fat: Number(fields.fat) || 0 };
    writeDay({ ...d, meals: (d.meals || []).map((x) => x.id === id ? nm : x),
      calories: Math.max(0, (d.calories || 0) - old.calories + nm.calories),
      protein: Math.max(0, (d.protein || 0) - old.protein + nm.protein),
      carbs: Math.max(0, (d.carbs || 0) - old.carbs + nm.carbs),
      fat: Math.max(0, (d.fat || 0) - old.fat + nm.fat) });
  };

  const navBtn = { padding: "6px 12px", fontSize: ".85rem", fontWeight: 700, borderRadius: 8, cursor: "pointer",
    border: "1px solid var(--border)", background: "var(--s2)", color: "var(--text)" };
  const tabBtn = (on) => ({ flex: 1, padding: "8px", borderRadius: 8, border: "none", cursor: "pointer", fontFamily: "inherit",
    fontSize: ".82rem", fontWeight: 700, background: on ? "var(--accent)" : "transparent", color: on ? "#0b0b12" : "var(--muted)" });

  // Header (shared across views)
  const header = (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div style={{ fontSize: "1.15rem", fontWeight: 800 }}>📅 Calendar</div>
        <button style={navBtn} onClick={onClose}>✕ Close</button>
      </div>
      <div style={{ display: "flex", gap: 4, background: "var(--s2)", padding: 4, borderRadius: 10, marginBottom: 14 }}>
        {["month", "week", "day"].map((v) => (
          <button key={v} style={tabBtn(view === v)} onClick={() => {
            if (v === "week" && !weekStart) { const off = mondayIdx(sel); const p = parseKey(sel); setWeekStart(keyOf(p.y, p.m, p.d - off)); }
            setView(v);
          }}>{v[0].toUpperCase() + v.slice(1)}</button>
        ))}
      </div>
    </>
  );

  const legend = (
    <div style={{ marginTop: 10 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, justifyContent: "center", fontSize: ".68rem", color: "var(--muted)" }}>
        <span><span style={{ color: "var(--green)" }}>●</span> food</span>
        <span><span style={{ color: "var(--blue)" }}>●</span> weigh-in</span>
        <span><span style={{ color: "var(--orange)" }}>●</span> workout</span>
        <span><span style={{ color: "var(--muted)" }}>◦</span> scheduled</span>
      </div>
      {calTarget && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, justifyContent: "center", fontSize: ".68rem", color: "var(--muted)", marginTop: 6 }}>
          <span><span style={{ display: "inline-block", width: 9, height: 9, borderRadius: 3, background: "rgba(47,224,168,.5)", verticalAlign: "middle" }} /> at/under target</span>
          <span><span style={{ display: "inline-block", width: 9, height: 9, borderRadius: 3, background: "rgba(251,191,36,.5)", verticalAlign: "middle" }} /> over target</span>
        </div>
      )}
    </div>
  );

  const DayDots = ({ k }) => {
    const d = dots(k);
    return (
      <div style={{ display: "flex", gap: 2, justifyContent: "center", height: 6, marginTop: 2 }}>
        {d.food && <span style={{ width: 5, height: 5, borderRadius: 3, background: "var(--green)" }} />}
        {d.weight && <span style={{ width: 5, height: 5, borderRadius: 3, background: "var(--blue)" }} />}
        {d.workout && <span style={{ width: 5, height: 5, borderRadius: 3, background: "var(--orange)" }} />}
        {!d.workout && d.sched && <span style={{ width: 5, height: 5, borderRadius: 3, border: "1px solid var(--muted)" }} />}
      </div>
    );
  };

  // ── Month view ──
  const monthView = () => {
    const first = new Date(Date.UTC(cur.y, cur.m, 1));
    const startPad = (first.getUTCDay() + 6) % 7; // Mon-first
    const daysIn = new Date(Date.UTC(cur.y, cur.m + 1, 0)).getUTCDate();
    const cells = [];
    for (let i = 0; i < startPad; i++) cells.push(null);
    for (let d = 1; d <= daysIn; d++) cells.push(d);
    while (cells.length % 7) cells.push(null);
    const monthLbl = first.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
    return (
      <>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <button style={navBtn} onClick={() => setCur((c) => c.m === 0 ? { y: c.y - 1, m: 11 } : { y: c.y, m: c.m - 1 })}>‹</button>
          <div style={{ fontWeight: 800, fontSize: "1rem" }}>{monthLbl}</div>
          <button style={navBtn} onClick={() => setCur((c) => c.m === 11 ? { y: c.y + 1, m: 0 } : { y: c.y, m: c.m + 1 })}>›</button>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 4 }}>
          {DAY_SHORT.map((d) => <div key={d} style={{ textAlign: "center", fontSize: ".62rem", color: "var(--muted)", textTransform: "uppercase" }}>{d[0]}</div>)}
          {cells.map((d, i) => {
            if (!d) return <div key={i} />;
            const k = keyOf(cur.y, cur.m, d);
            const isToday = k === todayKey;
            // Adherence tint: green if calories were at/under target, amber if over.
            const cal = dayCals[k];
            const over = calTarget && cal != null && cal > 0 && cal > calTarget * 1.05;
            const onTrack = calTarget && cal != null && cal > 0 && !over;
            const bg = k === sel ? "rgba(8,220,224,.12)"
              : over ? "rgba(251,191,36,.13)"
              : onTrack ? "rgba(47,224,168,.13)"
              : "var(--surface)";
            return (
              <button key={i} onClick={() => { setSel(k); setView("day"); }}
                title={cal != null && cal > 0 ? `${cal.toLocaleString()} cal${calTarget ? ` · target ${calTarget.toLocaleString()}` : ""}` : undefined}
                style={{ aspectRatio: "1", borderRadius: 8, cursor: "pointer", padding: 2,
                  border: isToday ? "1px solid var(--accent)" : "1px solid var(--border)",
                  background: bg, color: "var(--text)",
                  display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
                <span style={{ fontSize: ".8rem", fontWeight: isToday ? 800 : 500 }}>{d}</span>
                <DayDots k={k} />
              </button>
            );
          })}
        </div>
        {legend}
      </>
    );
  };

  // ── Week view ──
  const weekView = () => {
    const ws = weekStart || (() => { const off = mondayIdx(sel); const p = parseKey(sel); return keyOf(p.y, p.m, p.d - off); })();
    const wp = parseKey(ws);
    const days = Array.from({ length: 7 }, (_, i) => keyOf(wp.y, wp.m, wp.d + i));
    const shift = (n) => { const p = parseKey(ws); setWeekStart(keyOf(p.y, p.m, p.d + n)); };
    return (
      <>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <button style={navBtn} onClick={() => shift(-7)}>‹</button>
          <div style={{ fontWeight: 800, fontSize: ".9rem" }}>{fmtShort(days[0])} – {fmtShort(days[6])}</div>
          <button style={navBtn} onClick={() => shift(7)}>›</button>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {days.map((k) => {
            const ci = ciByDate[k]; const isToday = k === todayKey;
            const cal = dayCals[k];
            const over = calTarget && cal != null && cal > 0 && cal > calTarget * 1.05;
            const onTrack = calTarget && cal != null && cal > 0 && !over;
            // Left accent conveys calorie adherence (green at/under, amber over).
            const accent = over ? "var(--yellow)" : onTrack ? "var(--green)" : null;
            return (
              <button key={k} onClick={() => { setSel(k); setView("day"); }}
                style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 10, cursor: "pointer",
                  border: isToday ? "1px solid var(--accent)" : "1px solid var(--border)",
                  borderLeft: accent ? `4px solid ${accent}` : (isToday ? "1px solid var(--accent)" : "1px solid var(--border)"),
                  background: "var(--surface)", color: "var(--text)", textAlign: "left" }}>
                <div style={{ width: 42 }}>
                  <div style={{ fontSize: ".66rem", color: "var(--muted)", textTransform: "uppercase" }}>{DAY_SHORT[mondayIdx(k)]}</div>
                  <div style={{ fontSize: "1.1rem", fontWeight: 800 }}>{parseKey(k).d}</div>
                </div>
                <div style={{ flex: 1, fontSize: ".78rem", color: "var(--muted)", display: "flex", flexWrap: "wrap", gap: 10 }}>
                  {cal != null && cal > 0 && <span style={{ color: over ? "var(--yellow)" : "var(--green)", fontWeight: 700 }}>{cal.toLocaleString()} cal</span>}
                  {dayProt[k] > 0 && <span style={{ color: protTarget && dayProt[k] >= protTarget ? "var(--green)" : "var(--muted)" }}>🍗 {dayProt[k]}g{protTarget ? `/${protTarget}` : ""}</span>}
                  {loggedDays.includes(k) && !(cal > 0) && <span style={{ color: "var(--green)" }}>🍽️ logged</span>}
                  {ci && ci.weight && <span style={{ color: "var(--blue)" }}>⚖️ {ci.weight}</span>}
                  {ci && ci.workedOut && <span style={{ color: "var(--orange)" }}>🏋️ done</span>}
                  {scheduledFor(k) > 0 && !(ci && ci.workedOut) && (
                    k < todayKey
                      ? <span style={{ color: "var(--red)" }}>✗ missed workout</span>
                      : <span>◦ {scheduledFor(k)} scheduled</span>
                  )}
                  {!loggedDays.includes(k) && !(ci && (ci.weight || ci.workedOut)) && scheduledFor(k) === 0 && <span>—</span>}
                </div>
              </button>
            );
          })}
        </div>
        {/* Weekly calorie roll-up */}
        {(() => {
          const logged = days.filter((k) => dayCals[k] != null && dayCals[k] > 0);
          if (logged.length === 0) return null;
          const totalCal = logged.reduce((s, k) => s + dayCals[k], 0);
          const avg = Math.round(totalCal / logged.length);
          return (
            <div style={{ marginTop: 12, padding: "10px 12px", borderRadius: 10, background: "var(--s2)", border: "1px solid var(--border)",
              display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
              <span style={{ fontSize: ".74rem", color: "var(--muted)" }}>
                {logged.length}/7 day{logged.length !== 1 ? "s" : ""} logged
              </span>
              <span style={{ fontSize: ".82rem", fontWeight: 700 }}>
                avg <span style={{ color: "var(--accent)" }}>{avg.toLocaleString()}</span> cal/day
                {calTarget ? <span style={{ color: "var(--muted)", fontWeight: 400 }}> · target {calTarget.toLocaleString()}</span> : null}
              </span>
            </div>
          );
        })()}
        {/* Weekly protein-adherence roll-up: avg logged protein vs target */}
        {(() => {
          const logged = days.filter((k) => dayProt[k] > 0);
          if (logged.length === 0) return null;
          const avgProt = Math.round(logged.reduce((s, k) => s + dayProt[k], 0) / logged.length);
          const met = protTarget && avgProt >= protTarget;
          return (
            <div style={{ marginTop: 8, padding: "10px 12px", borderRadius: 10, background: "var(--s2)", border: "1px solid var(--border)",
              display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
              <span style={{ fontSize: ".74rem", color: "var(--muted)" }}>🍗 Protein</span>
              <span style={{ fontSize: ".82rem", fontWeight: 700 }}>
                avg <span style={{ color: met ? "var(--green)" : "var(--accent)" }}>{avgProt}g</span>
                {protTarget ? <span style={{ color: "var(--muted)", fontWeight: 400 }}>/day · target {protTarget}g</span> : <span style={{ color: "var(--muted)", fontWeight: 400 }}>/day</span>}
              </span>
            </div>
          );
        })()}
        {/* Weekly workout-adherence roll-up: completed vs scheduled this week */}
        {(() => {
          const scheduledDays = days.filter((k) => scheduledFor(k) > 0);
          const doneDays = days.filter((k) => ciByDate[k] && ciByDate[k].workedOut);
          if (scheduledDays.length === 0 && doneDays.length === 0) return null;
          const onPace = doneDays.length >= scheduledDays.length;
          return (
            <div style={{ marginTop: 8, padding: "10px 12px", borderRadius: 10, background: "var(--s2)", border: "1px solid var(--border)",
              display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
              <span style={{ fontSize: ".74rem", color: "var(--muted)" }}>🏋️ Workouts</span>
              <span style={{ fontSize: ".82rem", fontWeight: 700 }}>
                {scheduledDays.length > 0
                  ? <><span style={{ color: onPace ? "var(--green)" : "var(--yellow)" }}>{doneDays.length}</span><span style={{ color: "var(--muted)", fontWeight: 400 }}> / {scheduledDays.length} scheduled done</span></>
                  : <><span style={{ color: "var(--green)" }}>{doneDays.length}</span><span style={{ color: "var(--muted)", fontWeight: 400 }}> done this week</span></>}
              </span>
            </div>
          );
        })()}
      </>
    );
  };

  // ── Day view (with back-dated logging) ──
  const dayView = () => {
    const ci = ciByDate[sel] || {};
    const dn = weekdayName(sel);
    const cardio = (data.cardio && data.cardio[dn]) || [];
    const strength = (data.strength && data.strength[dn]) || [];
    const cals = dayLog ? (dayLog.calories || 0) : 0;
    const target = tdee ? Math.round(tdee) : null;
    const goStep = (n) => { const p = parseKey(sel); setSel(keyOf(p.y, p.m, p.d + n)); };
    const card = { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: 16, marginBottom: 12 };
    const lbl = { fontFamily: "'Sora',sans-serif", fontSize: "1.1rem", letterSpacing: 1.5, color: "var(--accent)", marginBottom: 10 };
    const quick = { padding: "6px 10px", fontSize: ".78rem", fontWeight: 700, borderRadius: 7, cursor: "pointer", border: "1px solid var(--border)", background: "var(--s2)", color: "var(--text)" };
    return (
      <>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <button style={navBtn} onClick={() => goStep(-1)}>‹</button>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontWeight: 800, fontSize: ".95rem" }}>{fmtLong(sel)}</div>
            {sel === todayKey ? <div style={{ fontSize: ".7rem", color: "var(--accent)" }}>Today</div>
              : sel < todayKey ? <div style={{ fontSize: ".7rem", color: "var(--muted)" }}>Back-dated entry</div>
              : <div style={{ fontSize: ".7rem", color: "var(--muted)" }}>Future date</div>}
          </div>
          <button style={navBtn} onClick={() => goStep(1)}>›</button>
        </div>

        {/* Food */}
        <div style={card}>
          <div style={lbl}>🍽️ Food</div>
          <div style={{ fontSize: "1.6rem", fontWeight: 800, fontFamily: "'Sora',sans-serif" }}>
            {cals.toLocaleString()}{target ? <span style={{ fontSize: ".9rem", color: "var(--muted)", fontWeight: 400 }}> / {target.toLocaleString()} cal</span> : " cal"}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
            {[100, 250, 500].map((n) => <button key={n} style={quick} onClick={() => addCal(n)}>+{n}</button>)}
            <button style={quick} onClick={() => addCal(-(dayLog?.calories || 0))}>Clear</button>
          </div>
          <div style={{ marginTop: 12 }}>
            <MealLog meals={(dayLog && dayLog.meals) || []} onAddMeal={addMeal} onRemoveMeal={removeMeal} onEditMeal={editMeal} />
          </div>
        </div>

        {/* Weight */}
        <div style={card}>
          <div style={lbl}>⚖️ Weight</div>
          <WeightDayLogger date={sel} existing={ci.weight} onSave={(w) => {
            onSaveCheckIn({ date: sel, timestamp: new Date(sel + "T12:00:00Z").getTime(), weight: w,
              calories: null, hitTarget: null, workedOut: ci.workedOut ?? null, mood: ci.mood ?? null,
              notes: ci.notes || "", bodyFat: ci.bodyFat ?? null, loggedBy: "calendar", isFuturePlan: sel > todayKey });
          }} />
        </div>

        {/* Workout */}
        <div style={card}>
          <div style={lbl}>🏋️ Workout</div>
          {(cardio.length + strength.length) > 0 ? (
            <div style={{ fontSize: ".82rem", color: "var(--text-secondary)", marginBottom: 10 }}>
              Scheduled for {dn}: {[...cardio.map((x) => x.type || "cardio"), ...strength.map((x) => x.type || "strength")].join(", ")}
            </div>
          ) : (
            <div style={{ fontSize: ".82rem", color: "var(--muted)", marginBottom: 10 }}>No workout scheduled for {dn}.</div>
          )}
          <button onClick={() => onSaveCheckIn({ date: sel, timestamp: new Date(sel + "T12:00:00Z").getTime(),
            weight: ci.weight ?? null, calories: null, hitTarget: null, workedOut: !ci.workedOut, mood: ci.mood ?? null,
            notes: ci.notes || "", bodyFat: ci.bodyFat ?? null, loggedBy: "calendar", isFuturePlan: sel > todayKey })}
            style={{ padding: "9px 14px", fontSize: ".84rem", fontWeight: 700, borderRadius: 9, cursor: "pointer", border: "none",
              background: ci.workedOut ? "var(--orange)" : "var(--accent)", color: "#0b0b12" }}>
            {ci.workedOut ? "✓ Worked out — tap to undo" : "Mark workout done"}
          </button>
        </div>
      </>
    );
  };

  return (
    <div>
      {header}
      {view === "month" && monthView()}
      {view === "week" && weekView()}
      {view === "day" && dayView()}
    </div>
  );
}

// Small controlled weight input for a calendar day (commits on Log/Enter only).
function WeightDayLogger({ date, existing, onSave }) {
  const [draft, setDraft] = useState("");
  useEffect(() => { setDraft(existing ? String(existing) : ""); }, [date, existing]);
  const commit = () => { const v = parseFloat(draft); if (v > 0) onSave(v); };
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
      <input value={draft} onChange={(e) => setDraft(e.target.value)} inputMode="decimal" placeholder="e.g. 182"
        onKeyDown={(e) => { if (e.key === "Enter") commit(); }}
        style={{ flex: 1, padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--s2)", color: "var(--text)", fontSize: ".95rem" }} />
      <button onClick={commit} style={{ padding: "10px 16px", fontWeight: 700, borderRadius: 8, border: "none", background: "var(--accent-fill)", color: "#0b0b12", cursor: "pointer" }}>
        {existing ? "Update" : "Log"}
      </button>
    </div>
  );
}

function DailyDashboard({ data, step, tdee, dayData, strengthDayData, avgBurnPerDay,
  onOpenPlan, onOpenResults, onEditWorkouts, onLogUpdate, dailyLog, streak,
  onUpdateCardio, onUpdateStrength, onAddMeal, onRemoveMeal, onEditMeal, recentFoods, weekSummary, history, onRefresh, isRemote,
  onReadDay, onWriteDay, onListLoggedDays, onSaveCheckIn, onDeleteCheckIn, onSetMacroTargets, onAddCustomExercise }) {

  const [showCalendar, setShowCalendar] = useState(false);
  const [editingWorkout, setEditingWorkout] = useState(null);
  const [expandedStat, setExpandedStat] = useState(null);
  const [expandedSnap, setExpandedSnap] = useState(false);
  const [showMacros, setShowMacros] = useState(false);
  const [editMacros, setEditMacros] = useState(false); // macro-target editor open
  const [mtDraft, setMtDraft] = useState({ protein:"", carbs:"", fat:"" });
  // Drafts so water/weight only save when you press Enter or tap Log — not on
  // every keystroke (which used to log "weight: 1 lbs" as you typed).
  const [waterDraft, setWaterDraft] = useState("");
  const [weightDraft, setWeightDraft] = useState("");
  const [calDraft, setCalDraft] = useState("");
  useEffect(() => { setWaterDraft(dailyLog.water ? String(dailyLog.water) : ""); }, [dailyLog.water]);
  useEffect(() => { setWeightDraft(dailyLog.weight ? String(dailyLog.weight) : ""); }, [dailyLog.weight]);
  const commitWater = () => { const v = parseInt(waterDraft); onLogUpdate("water", isNaN(v) ? 0 : v); };
  const commitWeight = () => { const v = parseFloat(weightDraft); onLogUpdate("weight", isNaN(v) ? 0 : v); };
  const commitCal = () => { const v = parseInt(calDraft); if (v > 0) { onLogUpdate("calories", (dailyLog.calories||0) + v); setCalDraft(""); } };
  const logBtn = { padding:"7px 12px", fontSize:".8rem", fontWeight:700, borderRadius:"8px",
    border:"none", background:"var(--accent-fill)", color:"#0b0b12", cursor:"pointer", whiteSpace:"nowrap" };

  useEffect(() => {
    if (editingWorkout) {
      setTimeout(() => {
        const el = document.getElementById(`workout-${editingWorkout}`);
        if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 100);
    }
  }, [editingWorkout]);
  const { firstName, lastName, weightLbs, goalWeight } = data;
  const today = new Date();
  const dayName = DAYS[today.getDay() === 0 ? 6 : today.getDay() - 1]; // Mon=0
  const dayIdx = DAYS.indexOf(dayName);

  // Today's scheduled workouts
  const todayCardio = dayData[dayIdx] || { burned: 0, workouts: [] };
  const todayStrength = strengthDayData[dayIdx] || { burned: 0, sessions: [] };
  const todayTotalBurn = todayCardio.burned + todayStrength.burned;

  // Calorie target (1 lb/wk deficit + burns)
  const target = Math.max(1200, tdee - 500 + Math.round((todayCardio.burned + todayStrength.burned)));
  const logged = dailyLog.calories || 0;
  const remaining = Math.max(0, target - logged);
  const pct = Math.min(100, Math.round((logged / target) * 100));
  // Macro targets. Default (estimates): protein 1g/lb bodyweight, fat 28% of
  // calories, carbs fill the remaining calories. A coach or client can override
  // any/all of them per plan via data.macroTargets — those take precedence.
  const mt = data.macroTargets || null;
  const autoProtein = Math.round(Number(weightLbs) * 1.0) || 0;
  const autoFat = Math.round(target * 0.28 / 9);
  const proteinTarget = mt && mt.protein != null ? mt.protein : autoProtein;
  const fatTarget = mt && mt.fat != null ? mt.fat : autoFat;
  const carbsTarget = mt && mt.carbs != null ? mt.carbs
    : Math.max(0, Math.round((target - proteinTarget * 4 - fatTarget * 9) / 4));
  const macrosCustom = !!mt;

  // Ring SVG
  const ringR = 58, ringC = 2 * Math.PI * ringR;
  const ringOffset = ringC - (pct / 100) * ringC;
  const ringColor = pct > 100 ? "var(--red)" : pct > 80 ? "var(--yellow)" : "var(--green)";

  const hasGoal = goalWeight && Number(goalWeight) < Number(weightLbs);
  const toLose = hasGoal ? Number(weightLbs) - Number(goalWeight) : null;
  const currentWeight = dailyLog.weight || Number(weightLbs);

  if (showCalendar) {
    return (
      <div className="dash">
        <CalendarView data={data} tdee={tdee} onClose={() => setShowCalendar(false)}
          onReadDay={onReadDay} onWriteDay={onWriteDay} onListLoggedDays={onListLoggedDays}
          onSaveCheckIn={onSaveCheckIn} onDeleteCheckIn={onDeleteCheckIn} />
      </div>
    );
  }
  return (
    <div className="dash">
      {isRemote && (
        <div style={{ padding:"8px 12px", borderRadius:"8px", marginBottom:"10px",
          background:"rgba(8,220,224,.08)", border:"1px solid var(--accent)",
          color:"var(--accent)", fontSize:".78rem", fontWeight:600,
          display:"flex", alignItems:"flex-start", gap:"8px" }}>
          <Icon name="link" size={16} color="var(--accent)" style={{ marginTop:1 }} />
          <span>Shared client plan — you're viewing {fullName(data) || "this client"}'s account. Your changes save to their login, and you both see the same activity.</span>
        </div>
      )}
      <div className="dash-date">{today.toLocaleDateString("en-US",{weekday:"long",month:"long",day:"numeric"})}</div>
      <div className="dash-greeting">{firstName ? `Hey ${firstName}` : "Your Daily Plan"}</div>
      <button onClick={() => setShowCalendar(true)}
        style={{ display:"flex", alignItems:"center", gap:"7px", margin:"0 auto 16px", padding:"9px 16px", fontSize:".82rem", fontWeight:700,
          borderRadius:"10px", cursor:"pointer", border:"1px solid var(--border)",
          background:"var(--s2)", color:"var(--text)" }}>
        <Icon name="calendar" size={16} color="var(--accent)" />Calendar
      </button>

      {/* Streak */}
      <div className="dash-streak">
        <div>
          <div className="dash-streak-num" style={{display:"flex",alignItems:"center",justifyContent:"center",gap:"7px"}}><Icon name="flame" size={24} color="var(--orange)" />{streak}</div>
          <div className="dash-streak-lbl">day streak</div>
        </div>
        {hasGoal && toLose > 0 && (
          <div style={{borderLeft:"1px solid var(--border)",paddingLeft:"14px",marginLeft:"6px"}}>
            <div className="dash-streak-num" style={{fontSize:"1.8rem",color:"var(--orange)"}}>{toLose.toFixed(1)}</div>
            <div className="dash-streak-lbl">lbs to goal</div>
          </div>
        )}
      </div>

      {/* Calorie ring */}
      <div className="dash-ring-wrap">
        <div style={{position:"relative",width:"150px",height:"150px"}}>
          <svg viewBox="0 0 140 140" style={{width:"100%",height:"100%",transform:"rotate(-90deg)"}}>
            <circle cx="70" cy="70" r={ringR} fill="none" stroke="var(--border)" strokeWidth="8"/>
            <circle cx="70" cy="70" r={ringR} fill="none" stroke={ringColor} strokeWidth="8"
              strokeDasharray={ringC} strokeDashoffset={ringOffset}
              strokeLinecap="round" style={{transition:"stroke-dashoffset .5s ease"}}/>
          </svg>
          <div style={{position:"absolute",inset:0,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center"}}>
            <div style={{fontFamily:"'Sora',sans-serif",fontSize:"2.2rem",color:"var(--accent)",lineHeight:1}}>{remaining}</div>
            <div style={{fontSize:".65rem",color:"var(--muted)",letterSpacing:".5px"}}>CAL REMAINING</div>
          </div>
        </div>
      </div>

      {/* Quick stats — tappable */}
      <div className="dash-cta-grid">
        <div className="dash-cta" style={{cursor:"pointer",borderColor:expandedStat==="target"?"var(--accent)":"var(--border)"}} onClick={()=>setExpandedStat(expandedStat==="target"?null:"target")}>
          <div className="dash-cta-icon" style={{display:"flex",justifyContent:"center"}}><Icon name="target" size={23} color="var(--accent)" /></div>
          <div className="dash-cta-val">{target.toLocaleString()}</div>
          <div className="dash-cta-lbl">Today's Target</div>
        </div>
        <div className="dash-cta" style={{cursor:"pointer",borderColor:expandedStat==="logged"?"var(--accent)":"var(--border)"}} onClick={()=>setExpandedStat(expandedStat==="logged"?null:"logged")}>
          <div className="dash-cta-icon" style={{display:"flex",justifyContent:"center"}}><Icon name="meal" size={23} color="var(--accent)" /></div>
          <div className="dash-cta-val">{logged.toLocaleString()}</div>
          <div className="dash-cta-lbl">Logged So Far</div>
        </div>
        <div className="dash-cta" style={{cursor:"pointer",borderColor:expandedStat==="burn"?"var(--accent)":"var(--border)"}} onClick={()=>setExpandedStat(expandedStat==="burn"?null:"burn")}>
          <div className="dash-cta-icon" style={{display:"flex",justifyContent:"center"}}><Icon name="flame" size={23} color="var(--orange)" /></div>
          <div className="dash-cta-val">{todayTotalBurn}</div>
          <div className="dash-cta-lbl">Workout Burn</div>
        </div>
        <div className="dash-cta" style={{cursor:"pointer",borderColor:expandedStat==="water"?"var(--accent)":"var(--border)"}} onClick={()=>setExpandedStat(expandedStat==="water"?null:"water")}>
          <div className="dash-cta-icon" style={{display:"flex",justifyContent:"center"}}><Icon name="water" size={23} color="#4fc3f7" /></div>
          <div className="dash-cta-val">{dailyLog.water || 0}</div>
          <div className="dash-cta-lbl">oz Water</div>
        </div>
      </div>

      {/* Expanded stat detail */}
      {expandedStat && (
        <div className="card" style={{padding:"14px 16px",marginBottom:"14px",borderColor:"rgba(8,220,224,.2)",animation:"fadeUp .15s ease both"}}>
          {expandedStat === "target" && (
            <>
              <div style={{fontWeight:700,fontSize:".88rem",marginBottom:"10px",color:"var(--accent)",display:"flex",alignItems:"center",gap:"7px"}}><Icon name="target" size={16} color="var(--accent)" />How Your Target Is Calculated</div>
              <div style={{display:"flex",justifyContent:"space-between",padding:"6px 0",borderBottom:"1px solid var(--border)",fontSize:".82rem"}}>
                <span style={{color:"var(--muted)"}}>Base TDEE</span>
                <span style={{fontFamily:"'Sora',sans-serif",fontSize:"1rem"}}>{tdee.toLocaleString()} cal</span>
              </div>
              <div style={{display:"flex",justifyContent:"space-between",padding:"6px 0",borderBottom:"1px solid var(--border)",fontSize:".82rem"}}>
                <span style={{color:"var(--muted)"}}>Deficit (1 lb/wk)</span>
                <span style={{fontFamily:"'Sora',sans-serif",fontSize:"1rem",color:"var(--red)"}}>−500 cal</span>
              </div>
              <div style={{display:"flex",justifyContent:"space-between",padding:"6px 0",borderBottom:"1px solid var(--border)",fontSize:".82rem"}}>
                <span style={{color:"var(--muted)"}}>Today's workout burn</span>
                <span style={{fontFamily:"'Sora',sans-serif",fontSize:"1rem",color:"var(--green)"}}>+{todayTotalBurn} cal</span>
              </div>
              <div style={{display:"flex",justifyContent:"space-between",padding:"8px 0",fontSize:".88rem",fontWeight:700}}>
                <span>Today's Target</span>
                <span style={{fontFamily:"'Sora',sans-serif",fontSize:"1.1rem",color:"var(--accent)"}}>{target.toLocaleString()} cal</span>
              </div>
              <div style={{fontSize:".72rem",color:"var(--muted)",marginTop:"6px"}}>💡 To change your target, tap "Edit Info" to adjust your weight, goal, or activity level, or "Edit Workouts" to change your exercise plan.</div>
            </>
          )}
          {expandedStat === "logged" && (
            <>
              <div style={{fontWeight:700,fontSize:".88rem",marginBottom:"10px",color:"var(--accent)",display:"flex",alignItems:"center",gap:"7px"}}><Icon name="meal" size={16} color="var(--accent)" />Calories Logged Today</div>
              <div style={{display:"flex",justifyContent:"space-between",padding:"6px 0",borderBottom:"1px solid var(--border)",fontSize:".82rem"}}>
                <span style={{color:"var(--muted)"}}>Logged</span>
                <span style={{fontFamily:"'Sora',sans-serif",fontSize:"1rem"}}>{logged.toLocaleString()} cal</span>
              </div>
              <div style={{display:"flex",justifyContent:"space-between",padding:"6px 0",borderBottom:"1px solid var(--border)",fontSize:".82rem"}}>
                <span style={{color:"var(--muted)"}}>Target</span>
                <span style={{fontFamily:"'Sora',sans-serif",fontSize:"1rem"}}>{target.toLocaleString()} cal</span>
              </div>
              <div style={{display:"flex",justifyContent:"space-between",padding:"8px 0",fontSize:".88rem",fontWeight:700,borderBottom:"1px solid var(--border)"}}>
                <span>Remaining</span>
                <span style={{fontFamily:"'Sora',sans-serif",fontSize:"1.1rem",color:remaining>0?"var(--green)":"var(--red)"}}>{remaining} cal</span>
              </div>
              <div style={{marginTop:"10px"}}>
                <div style={{fontSize:".72rem",color:"var(--muted)",fontWeight:600,textTransform:"uppercase",letterSpacing:".5px",marginBottom:"6px"}}>Quick Add</div>
                <div style={{display:"flex",gap:"8px",alignItems:"center"}}>
                  <input type="number" inputMode="numeric" placeholder="Add calories" onClick={e=>e.stopPropagation()}
                    onKeyDown={e=>{if(e.key==="Enter"){const v=parseInt(e.target.value);if(v>0){onLogUpdate("calories",(dailyLog.calories||0)+v);e.target.value="";}}}}
                    onBlur={e=>{const v=parseInt(e.target.value);if(v>0){onLogUpdate("calories",(dailyLog.calories||0)+v);e.target.value="";}}}
                    style={{flex:1,padding:"10px 12px",borderRadius:"8px",border:"1.5px solid var(--accent)",background:"var(--s2)",color:"var(--text)",fontFamily:"inherit",fontSize:".88rem"}} />
                  <span style={{fontSize:".78rem",color:"var(--muted)"}}>cal</span>
                </div>
                <div style={{display:"flex",gap:"8px",marginTop:"8px"}}>
                  {[100,250,500].map(v=>(
                    <button key={v} onClick={e=>{e.stopPropagation();onLogUpdate("calories",(dailyLog.calories||0)+v);}}
                      style={{flex:1,padding:"8px",borderRadius:"8px",border:"1px solid var(--border)",background:"var(--s2)",color:"var(--accent)",cursor:"pointer",fontFamily:"inherit",fontSize:".8rem",fontWeight:600}}>
                      +{v}
                    </button>
                  ))}
                  <button onClick={e=>{e.stopPropagation();onLogUpdate("calories",0);}}
                    style={{padding:"8px 12px",borderRadius:"8px",border:"1px solid var(--red)",background:"rgba(255,79,107,.06)",color:"var(--red)",cursor:"pointer",fontFamily:"inherit",fontSize:".75rem",fontWeight:600}}>
                    Reset
                  </button>
                </div>
              </div>
            </>
          )}
          {expandedStat === "burn" && (
            <>
              <div style={{fontWeight:700,fontSize:".88rem",marginBottom:"6px",color:"var(--orange)",display:"flex",alignItems:"center",gap:"7px"}}><Icon name="flame" size={16} color="var(--orange)" />Workout Burn Breakdown</div>
              <div style={{fontSize:".7rem",color:"var(--muted)",marginBottom:"8px"}}>Tap any exercise to edit or remove it</div>
              {(todayCardio.workouts||[]).map((w,i) => (
                <div key={`cb${i}`} style={{display:"flex",justifyContent:"space-between",padding:"8px 6px",borderBottom:"1px solid var(--border)",fontSize:".82rem",cursor:"pointer",borderRadius:"6px",background:editingWorkout===`c${i}`?"rgba(79,195,247,.06)":"transparent"}}
                  onClick={e=>{e.stopPropagation();setExpandedStat(null);setEditingWorkout(editingWorkout===`c${i}`?null:`c${i}`);}}>
                  <span><span style={{fontSize:".65rem",color:"#4fc3f7",fontWeight:700,marginRight:"6px"}}>CARDIO</span>{w.co?.icon} {w.co?.label}</span>
                  <span style={{display:"flex",alignItems:"center",gap:"8px"}}>
                    <span style={{fontFamily:"'Sora',sans-serif",color:"var(--orange)"}}>{w.burned} cal</span>
                    <span style={{fontSize:".6rem",color:"var(--muted)"}}>✏️</span>
                  </span>
                </div>
              ))}
              {(todayStrength.sessions||[]).map((s,i) => (
                <div key={`sb${i}`} style={{display:"flex",justifyContent:"space-between",padding:"8px 6px",borderBottom:"1px solid var(--border)",fontSize:".82rem",cursor:"pointer",borderRadius:"6px",background:editingWorkout===`s${i}`?"rgba(255,107,157,.06)":"transparent"}}
                  onClick={e=>{e.stopPropagation();setExpandedStat(null);setEditingWorkout(editingWorkout===`s${i}`?null:`s${i}`);}}>
                  <span><span style={{fontSize:".65rem",color:"#ff6b9d",fontWeight:700,marginRight:"6px"}}>STRENGTH</span>{s.ex?.icon} {s.ex?.label}</span>
                  <span style={{display:"flex",alignItems:"center",gap:"8px"}}>
                    <span style={{fontFamily:"'Sora',sans-serif",color:"var(--orange)"}}>{s.burned} cal</span>
                    <span style={{fontSize:".6rem",color:"var(--muted)"}}>✏️</span>
                  </span>
                </div>
              ))}
              {todayTotalBurn === 0 && <div style={{fontSize:".82rem",color:"var(--muted)",padding:"8px 0"}}>No workouts scheduled for today.</div>}
              <div style={{display:"flex",justifyContent:"space-between",padding:"8px 0",fontSize:".88rem",fontWeight:700,borderBottom:"1px solid var(--border)"}}>
                <span>Total</span>
                <span style={{fontFamily:"'Sora',sans-serif",fontSize:"1.1rem",color:"var(--orange)"}}>{todayTotalBurn} cal</span>
              </div>
              <div style={{display:"flex",gap:"8px",marginTop:"10px"}}>
                <button onClick={e=>{e.stopPropagation();const idx=(Array.isArray(data.cardio[dayName])?data.cardio[dayName]:[]).length;onUpdateCardio(dayName,idx,"type","outdoor_jog");setEditingWorkout(`c${idx}`);setExpandedStat(null);}}
                  style={{flex:1,padding:"10px",borderRadius:"8px",border:"1px solid rgba(79,195,247,.3)",background:"rgba(79,195,247,.06)",color:"#4fc3f7",cursor:"pointer",fontFamily:"inherit",fontSize:".8rem",fontWeight:600}}>
                  + Add Cardio
                </button>
                <button onClick={e=>{e.stopPropagation();const idx=(Array.isArray(data.strength[dayName])?data.strength[dayName]:[]).length;onUpdateStrength(dayName,idx,"type","bb_squat");setEditingWorkout(`s${idx}`);setExpandedStat(null);}}
                  style={{flex:1,padding:"10px",borderRadius:"8px",border:"1px solid rgba(255,107,157,.3)",background:"rgba(255,107,157,.06)",color:"#ff6b9d",cursor:"pointer",fontFamily:"inherit",fontSize:".8rem",fontWeight:600}}>
                  + Add Strength
                </button>
              </div>
            </>
          )}
          {expandedStat === "water" && (
            <>
              <div style={{fontWeight:700,fontSize:".88rem",marginBottom:"10px",color:"#4fc3f7",display:"flex",alignItems:"center",gap:"7px"}}><Icon name="water" size={16} color="#4fc3f7" />Hydration</div>
              <div style={{display:"flex",justifyContent:"space-between",padding:"6px 0",borderBottom:"1px solid var(--border)",fontSize:".82rem"}}>
                <span style={{color:"var(--muted)"}}>Logged</span>
                <span style={{fontFamily:"'Sora',sans-serif",fontSize:"1rem"}}>{dailyLog.water || 0} oz</span>
              </div>
              <div style={{display:"flex",justifyContent:"space-between",padding:"6px 0",borderBottom:"1px solid var(--border)",fontSize:".82rem"}}>
                <span style={{color:"var(--muted)"}}>Daily target</span>
                <span style={{fontFamily:"'Sora',sans-serif",fontSize:"1rem"}}>{Math.round(Number(weightLbs)*0.5)} oz</span>
              </div>
              <div style={{height:"8px",borderRadius:"4px",background:"var(--border)",overflow:"hidden",marginTop:"8px"}}>
                <div style={{height:"100%",borderRadius:"4px",background:"#4fc3f7",width:`${Math.min(100,((dailyLog.water||0)/(Number(weightLbs)*0.5))*100)}%`,transition:"width .3s"}}></div>
              </div>
              <div style={{fontSize:".72rem",color:"var(--muted)",marginTop:"4px",textAlign:"center"}}>{Math.round(((dailyLog.water||0)/(Number(weightLbs)*0.5))*100)}% of daily goal</div>
              <div style={{marginTop:"10px"}}>
                <div style={{fontSize:".72rem",color:"var(--muted)",fontWeight:600,textTransform:"uppercase",letterSpacing:".5px",marginBottom:"6px"}}>Quick Add</div>
                <div style={{display:"flex",gap:"8px",alignItems:"center",marginBottom:"8px"}}>
                  <input type="number" inputMode="numeric" placeholder="Set water oz" value={waterDraft} onClick={e=>e.stopPropagation()}
                    onChange={e=>{e.stopPropagation();setWaterDraft(e.target.value);}}
                    onKeyDown={e=>{ if(e.key==="Enter"){ e.stopPropagation(); commitWater(); } }}
                    style={{flex:1,padding:"10px 12px",borderRadius:"8px",border:"1.5px solid #4fc3f7",background:"var(--s2)",color:"var(--text)",fontFamily:"inherit",fontSize:".88rem"}} />
                  <span style={{fontSize:".78rem",color:"var(--muted)"}}>oz</span>
                  <button onClick={e=>{e.stopPropagation();commitWater();}} style={logBtn}>Log</button>
                </div>
                <div style={{display:"flex",gap:"8px"}}>
                  {[8,16,32].map(v=>(
                    <button key={v} onClick={e=>{e.stopPropagation();onLogUpdate("water",(dailyLog.water||0)+v);}}
                      style={{flex:1,padding:"8px",borderRadius:"8px",border:"1px solid var(--border)",background:"var(--s2)",color:"#4fc3f7",cursor:"pointer",fontFamily:"inherit",fontSize:".8rem",fontWeight:600}}>
                      +{v}oz
                    </button>
                  ))}
                  <button onClick={e=>{e.stopPropagation();onLogUpdate("water",0);}}
                    style={{padding:"8px 12px",borderRadius:"8px",border:"1px solid var(--red)",background:"rgba(255,79,107,.06)",color:"var(--red)",cursor:"pointer",fontFamily:"inherit",fontSize:".75rem",fontWeight:600}}>
                    Reset
                  </button>
                </div>
                <div style={{fontSize:".65rem",color:"var(--muted)",marginTop:"6px",textAlign:"center"}}>8oz = 1 cup · 16oz = 1 bottle · 32oz = 1 large bottle</div>
              </div>
            </>
          )}
        </div>
      )}

      {/* Quick log */}
      <div className="sec-title">Quick Log</div>
      <div className="dash-log-row" style={{cursor:"pointer",borderLeft:showMacros?"3px solid var(--accent)":"3px solid transparent",transition:"all .15s"}} onClick={()=>setShowMacros(v=>!v)}>
        <span className="dash-log-icon" style={{display:"flex",alignItems:"center"}}><Icon name="meal" size={20} color="var(--accent)" /></span>
        <div className="dash-log-info">
          <div className="dash-log-title">Add Calories</div>
          <div className="dash-log-sub" style={{color:showMacros?"var(--accent)":"var(--muted)"}}>
            {showMacros ? "▲ Macros expanded — tap to collapse" : "▼ Tap here to add macros (Protein / Carbs / Fat)"}
          </div>
        </div>
        <input className="dash-log-input" type="number" inputMode="numeric" placeholder="0"
          value={calDraft}
          onClick={e=>e.stopPropagation()}
          onChange={e=>setCalDraft(e.target.value)}
          onKeyDown={e=>{ if(e.key==="Enter"){ e.stopPropagation(); commitCal(); }}}
        />
        <span className="dash-log-unit">cal</span>
        <button style={logBtn} onClick={e=>{e.stopPropagation();commitCal();}}>Log</button>
      </div>

      {showMacros && (
        <div style={{animation:"fadeUp .15s ease both"}}>
          <div className="dash-log-row">
            <span className="dash-log-icon">🥩</span>
            <div className="dash-log-info">
              <div className="dash-log-title" style={{color:"#ff6b9d"}}>Protein</div>
              <div className="dash-log-sub">Target: ~{proteinTarget}g*</div>
            </div>
            <input className="dash-log-input" type="number" inputMode="numeric" placeholder="0"
              onBlur={e=>{ const v=parseInt(e.target.value); if(v>0){ onLogUpdate("protein",(dailyLog.protein||0)+v); e.target.value=""; }}}
              onKeyDown={e=>{ if(e.key==="Enter"){ e.target.blur(); }}}
            />
            <span className="dash-log-unit">g</span>
          </div>
          <div className="dash-log-row">
            <span className="dash-log-icon">🌾</span>
            <div className="dash-log-info">
              <div className="dash-log-title" style={{color:"#ffcc44"}}>Carbs</div>
              <div className="dash-log-sub">Target: ~{carbsTarget}g*</div>
            </div>
            <input className="dash-log-input" type="number" inputMode="numeric" placeholder="0"
              onBlur={e=>{ const v=parseInt(e.target.value); if(v>0){ onLogUpdate("carbs",(dailyLog.carbs||0)+v); e.target.value=""; }}}
              onKeyDown={e=>{ if(e.key==="Enter"){ e.target.blur(); }}}
            />
            <span className="dash-log-unit">g</span>
          </div>
          <div className="dash-log-row">
            <span className="dash-log-icon">🥑</span>
            <div className="dash-log-info">
              <div className="dash-log-title" style={{color:"#4fc3f7"}}>Fat</div>
              <div className="dash-log-sub">Target: ~{fatTarget}g*</div>
            </div>
            <input className="dash-log-input" type="number" inputMode="numeric" placeholder="0"
              onBlur={e=>{ const v=parseInt(e.target.value); if(v>0){ onLogUpdate("fat",(dailyLog.fat||0)+v); e.target.value=""; }}}
              onKeyDown={e=>{ if(e.key==="Enter"){ e.target.blur(); }}}
            />
            <span className="dash-log-unit">g</span>
          </div>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:"8px",padding:"4px 8px",flexWrap:"wrap"}}>
            <span style={{fontSize:".6rem",color:"var(--muted)",fontStyle:"italic"}}>
              *{macrosCustom ? "Custom targets set by you" : "Estimates from bodyweight & calorie goal"}
            </span>
            {onSetMacroTargets && (
              <button onClick={()=>{ setMtDraft({ protein:String(proteinTarget), carbs:String(carbsTarget), fat:String(fatTarget) }); setEditMacros(v=>!v); }}
                style={{border:"none",background:"transparent",color:"var(--accent)",cursor:"pointer",fontSize:".72rem",fontWeight:600,padding:0,textDecoration:"underline"}}>
                {editMacros ? "Close" : "✎ Edit targets"}
              </button>
            )}
          </div>
          {editMacros && onSetMacroTargets && (
            <div style={{padding:"10px 8px",display:"flex",flexDirection:"column",gap:"8px"}}>
              <div style={{display:"flex",gap:"6px"}}>
                {[["protein","Protein"],["carbs","Carbs"],["fat","Fat"]].map(([k,lbl])=>(
                  <div key={k} style={{flex:1}}>
                    <div style={{fontSize:".62rem",color:"var(--muted)",textTransform:"uppercase",letterSpacing:".5px",marginBottom:"3px"}}>{lbl} g</div>
                    <input type="number" inputMode="numeric" value={mtDraft[k]}
                      onChange={e=>setMtDraft(d=>({...d,[k]:e.target.value}))}
                      style={{width:"100%",boxSizing:"border-box",padding:"8px 10px",borderRadius:"7px",border:"1px solid var(--border)",background:"var(--s2)",color:"var(--text)",fontSize:".85rem"}} />
                  </div>
                ))}
              </div>
              <div style={{display:"flex",gap:"6px"}}>
                <button onClick={()=>{
                    onSetMacroTargets({ protein:Math.max(0,parseInt(mtDraft.protein)||0), carbs:Math.max(0,parseInt(mtDraft.carbs)||0), fat:Math.max(0,parseInt(mtDraft.fat)||0) });
                    setEditMacros(false);
                  }}
                  style={{padding:"8px 14px",fontSize:".8rem",fontWeight:700,borderRadius:"7px",border:"none",background:"var(--accent-fill)",color:"#0b0b12",cursor:"pointer"}}>Save targets</button>
                {macrosCustom && (
                  <button onClick={()=>{ onSetMacroTargets(null); setEditMacros(false); }}
                    style={{padding:"8px 12px",fontSize:".8rem",borderRadius:"7px",border:"1px solid var(--border)",background:"transparent",color:"var(--muted)",cursor:"pointer"}}>Reset to auto</button>
                )}
              </div>
              <div style={{fontSize:".62rem",color:"var(--muted)",fontStyle:"italic"}}>
                Saving locks these targets for this plan. "Reset to auto" returns to the
                bodyweight/calorie-based estimates that adjust as the plan changes.
              </div>
            </div>
          )}
        </div>
      )}

      {/* Macro progress vs target — per-macro bars (logged / target) */}
      {(dailyLog.protein > 0 || dailyLog.carbs > 0 || dailyLog.fat > 0) && (
        <div style={{padding:"10px 14px",background:"var(--s2)",borderRadius:"8px",border:"1px solid var(--border)",marginBottom:"6px"}}>
          {[
            { icon:"🥩", label:"Protein", color:"#ff6b9d", val:dailyLog.protein||0, tgt:proteinTarget },
            { icon:"🌾", label:"Carbs",   color:"#ffcc44", val:dailyLog.carbs||0,   tgt:carbsTarget },
            { icon:"🥑", label:"Fat",     color:"#4fc3f7", val:dailyLog.fat||0,     tgt:fatTarget },
          ].map((m) => {
            const fill = m.tgt > 0 ? Math.min(100, Math.round((m.val / m.tgt) * 100)) : 0;
            const over = m.tgt > 0 && m.val > m.tgt;
            return (
              <div key={m.label} style={{ marginBottom:"8px" }}>
                <div style={{ display:"flex", justifyContent:"space-between", fontSize:".74rem", marginBottom:"3px" }}>
                  <span style={{ color:m.color, fontWeight:600 }}>{m.icon} {m.label}</span>
                  <span style={{ color: over ? "var(--orange)" : "var(--muted)" }}>
                    {m.val}g <span style={{ opacity:.7 }}>/ {m.tgt}g</span>{over ? " ⚠️" : m.tgt>0 && fill>=100 ? " ✓" : ""}
                  </span>
                </div>
                <div style={{ height:"7px", borderRadius:"4px", overflow:"hidden", background:"var(--border)" }}>
                  <div style={{ width:`${fill}%`, height:"100%", borderRadius:"4px",
                    background: over ? "var(--orange)" : m.color, transition:"width .3s ease" }} />
                </div>
              </div>
            );
          })}
          <div style={{fontSize:".65rem",color:"var(--muted)",marginTop:"2px",textAlign:"center"}}>
            {((dailyLog.protein||0)*4 + (dailyLog.carbs||0)*4 + (dailyLog.fat||0)*9).toLocaleString()} cal from macros · targets are estimates
          </div>
        </div>
      )}

      <MealLog meals={dailyLog.meals} onAddMeal={onAddMeal} onRemoveMeal={onRemoveMeal} onEditMeal={onEditMeal} recentFoods={recentFoods} />

      <div className="dash-log-row">
        <span className="dash-log-icon" style={{display:"flex",alignItems:"center"}}><Icon name="water" size={20} color="#4fc3f7" /></span>
        <div className="dash-log-info">
          <div className="dash-log-title">Water Intake</div>
          <div className="dash-log-sub">Target: ~{Math.round(Number(weightLbs)*0.5)} oz/day</div>
        </div>
        <input className="dash-log-input" type="number" inputMode="numeric"
          value={waterDraft} onChange={e=>setWaterDraft(e.target.value)}
          onKeyDown={e=>{ if(e.key==="Enter") commitWater(); }}/>
        <span className="dash-log-unit">oz</span>
        <button style={logBtn} onClick={commitWater}>Log</button>
      </div>
      <div className="dash-log-row">
        <span className="dash-log-icon" style={{display:"flex",alignItems:"center"}}><Icon name="scale" size={21} color="var(--muted)" /></span>
        <div className="dash-log-info">
          <div className="dash-log-title">Today's Weight</div>
          <div className="dash-log-sub">{hasGoal?`Goal: ${goalWeight} lbs`:"Track your trend"}</div>
        </div>
        <input className="dash-log-input" type="number" inputMode="decimal" step="0.1"
          value={weightDraft} onChange={e=>setWeightDraft(e.target.value)}
          onKeyDown={e=>{ if(e.key==="Enter") commitWeight(); }}/>
        <span className="dash-log-unit">lbs</span>
        <button style={logBtn} onClick={commitWeight}>Log</button>
      </div>

      {/* Today's workout — editable */}
      <div className="sec-title">Today's Workout — {dayName}</div>
      {((todayCardio.workouts||[]).length > 0 || (todayStrength.sessions||[]).length > 0) && (
        <div style={{fontSize:".7rem",color:"var(--muted)",marginBottom:"8px"}}>Tap any workout to edit or remove it</div>
      )}
      {((todayCardio.workouts||[]).length > 0 || (todayStrength.sessions||[]).length > 0) ? (
        <div className="dash-today-workout">
          {(todayCardio.workouts||[]).map((w,i)=>(
            <div key={`c${i}`} id={`workout-c${i}`}>
              <div style={{display:"flex",alignItems:"center",gap:"8px",padding:"12px 8px",marginBottom:"4px",borderRadius:"8px",border:editingWorkout===`c${i}`?"1.5px solid var(--accent)":"1.5px solid var(--border)",background:editingWorkout===`c${i}`?"rgba(8,220,224,.04)":"var(--s2)",cursor:"pointer",transition:"all .15s"}}
                onClick={()=>setEditingWorkout(editingWorkout===`c${i}`?null:`c${i}`)}>
                <span style={{fontSize:"1rem"}}>{w.co?.icon||"🏃"}</span>
                <div style={{flex:1}}>
                  <div style={{fontSize:".84rem",fontWeight:600}}>{w.co?.label||"Unknown Exercise"} <span style={{fontSize:".72rem",color:"var(--muted)"}}>· {(todayCardio.workouts[i]||{}).duration||30}m</span></div>
                  <div style={{fontSize:".65rem",color:"#4fc3f7",letterSpacing:".5px",textTransform:"uppercase",fontWeight:700}}>Cardio</div>
                </div>
                <span style={{color:"var(--orange)",fontFamily:"'Sora',sans-serif",fontSize:".95rem"}}>{w.burned} cal</span>
                <span style={{color:"var(--accent)",fontSize:".7rem",fontWeight:700}}>{editingWorkout===`c${i}`?"▲":"TAP"}</span>
              </div>
              {editingWorkout===`c${i}` && (
                <div style={{padding:"10px 0 12px",borderBottom:"1px solid var(--border)",animation:"fadeUp .15s ease both"}}>
                  <SearchableSelect
                    exercises={[...ALL_CARDIO, ...customOf(data.customExercises, "cardio")]}
                    groups={CARDIO_GROUPS.map(g=>g.group)}
                    value={w.type}
                    onChange={val=>onUpdateCardio(dayName,i,"type",val)}
                    placeholder="Search cardio exercises..."
                  />
                  <select value={w.type} onChange={e=>onUpdateCardio(dayName,i,"type",e.target.value)}
                    style={{width:"100%",padding:"10px",borderRadius:"8px",border:"1.5px solid var(--border)",background:"var(--s2)",color:"var(--text)",fontFamily:"inherit",fontSize:".84rem",marginTop:"6px"}}>
                    {CARDIO_GROUPS.map(grp=>(
                      <optgroup key={grp.group} label={grp.group}>
                        {grp.options.map(c=><option key={c.id} value={c.id}>{c.icon} {c.label}</option>)}
                      </optgroup>
                    ))}
                    <CustomOptGroup customExercises={data.customExercises} type="cardio" />
                  </select>
                  <select value={(todayCardio.workouts[i]||{}).duration||30} onChange={e=>onUpdateCardio(dayName,i,"duration",Number(e.target.value))}
                    style={{width:"100%",padding:"10px",borderRadius:"8px",border:"1.5px solid var(--border)",background:"var(--s2)",color:"var(--text)",fontFamily:"inherit",fontSize:".84rem",marginTop:"6px"}}>
                    {DURATIONS.map(m=><option key={m} value={m}>{m} minutes</option>)}
                  </select>
                  <div style={{display:"flex",gap:"8px",marginTop:"8px"}}>
                    <button style={{flex:1,padding:"10px",borderRadius:"8px",border:"none",background:"var(--green)",color:"#0b0b12",fontFamily:"'Sora',sans-serif",fontSize:".95rem",letterSpacing:"2px",cursor:"pointer"}}
                      onClick={()=>setEditingWorkout(null)}>
                      ✓ Confirmed
                    </button>
                    <button style={{padding:"10px 16px",borderRadius:"8px",border:"1.5px solid var(--red)",background:"rgba(255,79,107,.06)",color:"var(--red)",fontFamily:"'Sora',sans-serif",fontSize:".95rem",letterSpacing:"1px",cursor:"pointer"}}
                      onClick={()=>{
                        const sessions = Array.isArray(data.cardio[dayName]) ? [...data.cardio[dayName]] : [];
                        sessions.splice(i, 1);
                        onUpdateCardio(dayName, 0, "_replace", sessions);
                        setEditingWorkout(null);
                      }}>
                      🗑️ Remove
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
          {(todayStrength.sessions||[]).map((s,i)=>(
            <div key={`s${i}`} id={`workout-s${i}`}>
              <div style={{display:"flex",alignItems:"center",gap:"8px",padding:"12px 8px",marginBottom:"4px",borderRadius:"8px",border:editingWorkout===`s${i}`?"1.5px solid var(--accent)":"1.5px solid var(--border)",background:editingWorkout===`s${i}`?"rgba(8,220,224,.04)":"var(--s2)",cursor:"pointer",transition:"all .15s"}}
                onClick={()=>setEditingWorkout(editingWorkout===`s${i}`?null:`s${i}`)}>
                <span style={{fontSize:"1rem"}}>{s.ex?.icon||"🏋️"}</span>
                <div style={{flex:1}}>
                  <div style={{fontSize:".84rem",fontWeight:600}}>{s.ex?.label||"Unknown Exercise"} <span style={{fontSize:".72rem",color:"var(--muted)"}}>· {s.duration||60}m</span></div>
                  <div style={{fontSize:".65rem",color:"#ff6b9d",letterSpacing:".5px",textTransform:"uppercase",fontWeight:700}}>Strength · {s.ex?.cat||"Custom"}</div>
                </div>
                <span style={{color:"var(--orange)",fontFamily:"'Sora',sans-serif",fontSize:".95rem"}}>{s.burned} cal</span>
                <span style={{color:"var(--accent)",fontSize:".7rem",fontWeight:700}}>{editingWorkout===`s${i}`?"▲":"TAP"}</span>
              </div>
              {editingWorkout===`s${i}` && (
                <div style={{padding:"10px 0 12px",borderBottom:"1px solid var(--border)",animation:"fadeUp .15s ease both"}}>
                  <SearchableSelect
                    exercises={[...STRENGTH_EXERCISES, ...customOf(data.customExercises, "strength")]}
                    groups={STRENGTH_GROUPS}
                    value={s.type}
                    onChange={val=>onUpdateStrength(dayName,i,"type",val)}
                    placeholder="Search strength exercises..."
                  />
                  <select value={s.type} onChange={e=>onUpdateStrength(dayName,i,"type",e.target.value)}
                    style={{width:"100%",padding:"10px",borderRadius:"8px",border:"1.5px solid var(--border)",background:"var(--s2)",color:"var(--text)",fontFamily:"inherit",fontSize:".84rem",marginTop:"6px"}}>
                    {STRENGTH_GROUPS.map(cat=>(
                      <optgroup key={cat} label={cat}>
                        {STRENGTH_EXERCISES.filter(e=>e.cat===cat).map(e=>(
                          <option key={e.id} value={e.id}>{e.icon} {e.label}</option>
                        ))}
                      </optgroup>
                    ))}
                    <CustomOptGroup customExercises={data.customExercises} type="strength" />
                  </select>
                  <select value={s.duration||60} onChange={e=>onUpdateStrength(dayName,i,"duration",Number(e.target.value))}
                    style={{width:"100%",padding:"10px",borderRadius:"8px",border:"1.5px solid var(--border)",background:"var(--s2)",color:"var(--text)",fontFamily:"inherit",fontSize:".84rem",marginTop:"6px"}}>
                    {ST_DURATIONS.map(m=><option key={m} value={m}>{m} minutes</option>)}
                  </select>
                  <div style={{display:"flex",gap:"8px",marginTop:"8px"}}>
                    <button style={{flex:1,padding:"10px",borderRadius:"8px",border:"none",background:"var(--green)",color:"#0b0b12",fontFamily:"'Sora',sans-serif",fontSize:".95rem",letterSpacing:"2px",cursor:"pointer"}}
                      onClick={()=>setEditingWorkout(null)}>
                      ✓ Confirmed
                    </button>
                    <button style={{padding:"10px 16px",borderRadius:"8px",border:"1.5px solid var(--red)",background:"rgba(255,79,107,.06)",color:"var(--red)",fontFamily:"'Sora',sans-serif",fontSize:".95rem",letterSpacing:"1px",cursor:"pointer"}}
                      onClick={()=>{
                        const sessions = Array.isArray(data.strength[dayName]) ? [...data.strength[dayName]] : [];
                        sessions.splice(i, 1);
                        onUpdateStrength(dayName, 0, "_replace", sessions);
                        setEditingWorkout(null);
                      }}>
                      🗑️ Remove
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="dash-today-workout" style={{display:"flex",alignItems:"center",justifyContent:"center",gap:"8px",padding:"16px",color:"var(--muted)",fontSize:".84rem"}}>
          <Icon name="moon" size={16} />Rest day — no workouts scheduled
        </div>
      )}
      {/* Add workout to today */}
      <div style={{display:"flex",gap:"8px",marginBottom:"16px"}}>
        <button className="quick-fill-toggle" style={{flex:1,marginBottom:0,borderStyle:"solid",fontSize:".8rem",padding:"10px 14px",borderColor:"rgba(79,195,247,.25)",color:"#4fc3f7",background:"rgba(79,195,247,.03)"}}
          onClick={()=>{
            const idx = (Array.isArray(data.cardio[dayName])?data.cardio[dayName]:[]).length;
            onUpdateCardio(dayName,idx,"type","outdoor_jog");
            setEditingWorkout(`c${idx}`);
          }}>
          + Add Cardio
        </button>
        <button className="quick-fill-toggle" style={{flex:1,marginBottom:0,borderStyle:"solid",fontSize:".8rem",padding:"10px 14px",borderColor:"rgba(255,107,157,.25)",color:"#ff6b9d",background:"rgba(255,107,157,.03)"}}
          onClick={()=>{
            const idx = (Array.isArray(data.strength[dayName])?data.strength[dayName]:[]).length;
            onUpdateStrength(dayName,idx,"type","bb_squat");
            setEditingWorkout(`s${idx}`);
          }}>
          + Add Strength
        </button>
      </div>

      {/* Create a custom exercise right here too (not just in Edit Workouts).
          Once added it appears in the Add Cardio / Add Strength pickers above. */}
      {onAddCustomExercise && (
        <div style={{marginBottom:"16px"}}>
          <CustomExerciseCreator exerciseType="strength" onAdd={onAddCustomExercise} />
          <CustomExerciseCreator exerciseType="cardio" onAdd={onAddCustomExercise} />
        </div>
      )}

      {/* ── Progress & insights (display, not entry) ── */}
      <div className="sec-title">📈 Progress &amp; Insights</div>

      {/* This week — nutrition averages over the days logged in the last 7 (Session 40) */}
      {weekSummary && weekSummary.days > 0 && (
        <div style={{padding:"12px 14px",background:"var(--s2)",borderRadius:"8px",border:"1px solid var(--border)",marginBottom:"6px"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",marginBottom:"8px"}}>
            <span style={{fontFamily:"'Sora',sans-serif",fontSize:"1rem",letterSpacing:".5px"}}>📅 This Week</span>
            <span style={{fontSize:".72rem",color:"var(--muted)"}}>avg over {weekSummary.days} logged day{weekSummary.days!==1?"s":""}</span>
          </div>
          <div style={{display:"flex",gap:"8px",flexWrap:"wrap"}}>
            {[
              { label:"Calories", val:weekSummary.avgCal, tgt:target,        color:"var(--accent)", unit:"" },
              { label:"Protein",  val:weekSummary.avgP,   tgt:proteinTarget, color:"#ff6b9d",       unit:"g" },
              { label:"Carbs",    val:weekSummary.avgC,   tgt:carbsTarget,   color:"#ffcc44",       unit:"g" },
              { label:"Fat",      val:weekSummary.avgF,   tgt:fatTarget,     color:"#4fc3f7",       unit:"g" },
            ].map((s)=>(
              <div key={s.label} style={{flex:"1 1 calc(50% - 4px)",minWidth:"120px",padding:"8px 10px",borderRadius:"7px",background:"var(--bg)",border:"1px solid var(--border)"}}>
                <div style={{fontSize:".64rem",color:"var(--muted)",textTransform:"uppercase",letterSpacing:".5px"}}>{s.label}</div>
                <div style={{fontFamily:"'Sora',sans-serif",fontSize:"1.25rem",color:s.color,lineHeight:1.1}}>
                  {s.val.toLocaleString()}{s.unit}
                </div>
                <div style={{fontSize:".64rem",color:"var(--muted)"}}>avg/day · target {s.tgt.toLocaleString()}{s.unit}</div>
              </div>
            ))}
          </div>
          <div style={{fontSize:".6rem",color:"var(--muted)",marginTop:"8px",fontStyle:"italic"}}>
            Averaged over days with logged food in the last 7 · reflects saved logs
          </div>
        </div>
      )}

      <ActivityFeed history={history} onRefresh={onRefresh} />

      {/* Shareable progress card — tappable */}
      <div className="share-card" style={{cursor:"pointer",borderColor:expandedSnap?"var(--green)":"var(--accent)"}} onClick={()=>setExpandedSnap(v=>!v)}>
        <div style={{fontSize:".65rem",color:"var(--muted)",letterSpacing:"2px",textTransform:"uppercase",marginBottom:"6px"}}>Progress Snapshot {expandedSnap?"▲":"· Tap for details"}</div>
        <div className="share-card-name">{fullName(data) || "Client"}</div>
        <div className="share-card-stats">
          <div className="share-stat">
            <div className="share-stat-val">{currentWeight}</div>
            <div className="share-stat-lbl">Current lbs</div>
            <div style={{fontSize:".58rem",color:"var(--muted)",marginTop:"3px",lineHeight:1.3}}>Most recent weigh-in</div>
          </div>
          <div className="share-stat">
            <div className="share-stat-val" style={{display:"flex",alignItems:"center",justifyContent:"center",gap:"6px"}}><Icon name="flame" size={20} color="var(--orange)" />{streak}</div>
            <div className="share-stat-lbl">Day Streak</div>
            <div style={{fontSize:".58rem",color:"var(--muted)",marginTop:"3px",lineHeight:1.3}}>Consecutive check-ins</div>
          </div>
          <div className="share-stat">
            <div className="share-stat-val">{target}</div>
            <div className="share-stat-lbl">Daily Target</div>
            <div style={{fontSize:".58rem",color:"var(--muted)",marginTop:"3px",lineHeight:1.3}}>Calories to eat today</div>
          </div>
        </div>
        <div className="share-card-stats" style={{marginTop:"4px"}}>
          <div className="share-stat">
            <div className="share-stat-val" style={{color:"var(--orange)"}}>{todayTotalBurn}</div>
            <div className="share-stat-lbl">Today's Burn</div>
            <div style={{fontSize:".58rem",color:"var(--muted)",marginTop:"3px",lineHeight:1.3}}>Workout calories</div>
          </div>
          <div className="share-stat">
            <div className="share-stat-val" style={{color:"var(--green)"}}>{hasGoal ? ((tdee - target + Math.round(todayTotalBurn * 0.15)) / 500).toFixed(1) : "—"}</div>
            <div className="share-stat-lbl">lbs/week</div>
            <div style={{fontSize:".58rem",color:"var(--muted)",marginTop:"3px",lineHeight:1.3}}>Projected loss rate*</div>
          </div>
          <div className="share-stat">
            <div className="share-stat-val" style={{color:"var(--accent)"}}>{hasGoal ? Math.ceil(toLose / Math.max(0.5, (tdee - target + Math.round(todayTotalBurn * 0.15)) / 500)) : "—"}</div>
            <div className="share-stat-lbl">Weeks to Goal</div>
            <div style={{fontSize:".58rem",color:"var(--muted)",marginTop:"3px",lineHeight:1.3}}>At current plan*</div>
          </div>
        </div>
        {hasGoal && <div style={{fontSize:".8rem",color:"var(--muted)"}}>Goal: {weightLbs} → {goalWeight} lbs ({toLose.toFixed(1)} lbs to go)</div>}
        {hasGoal && <div style={{fontSize:".55rem",color:"var(--muted)",marginTop:"3px",fontStyle:"italic"}}>*Projections assume consistent adherence to your calorie target — actual results vary</div>}

        {expandedSnap && (
          <div style={{marginTop:"14px",borderTop:"1px solid var(--border)",paddingTop:"14px",textAlign:"left",animation:"fadeUp .15s ease both"}} onClick={e=>e.stopPropagation()}>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"8px",marginBottom:"12px"}}>
              <div style={{padding:"10px",background:"var(--s2)",borderRadius:"8px",textAlign:"center"}}>
                <div style={{fontFamily:"'Sora',sans-serif",fontSize:"1.3rem",color:"var(--accent)"}}>{tdee.toLocaleString()}</div>
                <div style={{fontSize:".62rem",color:"var(--muted)",textTransform:"uppercase",letterSpacing:".5px"}}>TDEE</div>
                <div style={{fontSize:".55rem",color:"var(--muted)",marginTop:"2px"}}>Calories to maintain weight*</div>
              </div>
              <div style={{padding:"10px",background:"var(--s2)",borderRadius:"8px",textAlign:"center"}}>
                <div style={{fontFamily:"'Sora',sans-serif",fontSize:"1.3rem",color:"var(--yellow)"}}>{target.toLocaleString()}</div>
                <div style={{fontSize:".62rem",color:"var(--muted)",textTransform:"uppercase",letterSpacing:".5px"}}>Target Cal</div>
                <div style={{fontSize:".55rem",color:"var(--muted)",marginTop:"2px"}}>Eat this to lose weight*</div>
              </div>
              <div style={{padding:"10px",background:"var(--s2)",borderRadius:"8px",textAlign:"center"}}>
                <div style={{fontFamily:"'Sora',sans-serif",fontSize:"1.3rem",color:"var(--orange)"}}>{(todayCardio.burned+todayStrength.burned).toLocaleString()}</div>
                <div style={{fontSize:".62rem",color:"var(--muted)",textTransform:"uppercase",letterSpacing:".5px"}}>Today's Burn</div>
                <div style={{fontSize:".55rem",color:"var(--muted)",marginTop:"2px"}}>Est. calories from workouts*</div>
              </div>
              <div style={{padding:"10px",background:"var(--s2)",borderRadius:"8px",textAlign:"center"}}>
                <div style={{fontFamily:"'Sora',sans-serif",fontSize:"1.3rem",color:"#4fc3f7"}}>{Math.round(Number(weightLbs)*0.5)} oz</div>
                <div style={{fontSize:".62rem",color:"var(--muted)",textTransform:"uppercase",letterSpacing:".5px"}}>Water Goal</div>
                <div style={{fontSize:".55rem",color:"var(--muted)",marginTop:"2px"}}>0.5 oz per lb bodyweight*</div>
              </div>
            </div>
            {(data.checkIns||[]).length > 1 && (() => {
              const sorted = [...data.checkIns].filter(c=>c.weight).sort((a,b)=>a.timestamp-b.timestamp);
              const first = sorted[0]?.weight;
              const last = sorted[sorted.length-1]?.weight;
              const diff = first - last;
              const adherence = data.checkIns.length > 0 ? Math.round((data.checkIns.filter(c=>c.hitTarget).length / data.checkIns.length)*100) : 0;
              return (
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:"8px",marginBottom:"10px"}}>
                  <div style={{padding:"10px",background:"var(--s2)",borderRadius:"8px",textAlign:"center"}}>
                    <div style={{fontFamily:"'Sora',sans-serif",fontSize:"1.2rem",color:diff>0?"var(--green)":"var(--orange)"}}>{diff>0?`−${diff.toFixed(1)}`:diff<0?`+${Math.abs(diff).toFixed(1)}`:"0"}</div>
                    <div style={{fontSize:".62rem",color:"var(--muted)",textTransform:"uppercase",letterSpacing:".5px"}}>lbs Change</div>
                  </div>
                  <div style={{padding:"10px",background:"var(--s2)",borderRadius:"8px",textAlign:"center"}}>
                    <div style={{fontFamily:"'Sora',sans-serif",fontSize:"1.2rem",color:adherence>=80?"var(--green)":adherence>=50?"var(--yellow)":"var(--red)"}}>{adherence}%</div>
                    <div style={{fontSize:".62rem",color:"var(--muted)",textTransform:"uppercase",letterSpacing:".5px"}}>Adherence</div>
                  </div>
                  <div style={{padding:"10px",background:"var(--s2)",borderRadius:"8px",textAlign:"center"}}>
                    <div style={{fontFamily:"'Sora',sans-serif",fontSize:"1.2rem",color:"var(--text)"}}>{data.checkIns.length}</div>
                    <div style={{fontSize:".62rem",color:"var(--muted)",textTransform:"uppercase",letterSpacing:".5px"}}>Check-ins</div>
                  </div>
                </div>
              );
            })()}
            <div style={{fontSize:".72rem",color:"var(--muted)",textAlign:"center"}}>📸 Screenshot this card to share your progress</div>
          </div>
        )}

        <div className="share-brand">GLIDE — Powered by Science</div>
      </div>

      {/* Navigation */}
      <div className="dash-nav">
        <button className="dash-nav-btn" onClick={onOpenResults} style={{display:"flex",alignItems:"center",justifyContent:"center",gap:"6px"}}><Icon name="chart" size={15} color="var(--accent)" />Full Plan</button>
        <button className="dash-nav-btn" onClick={onOpenPlan} style={{display:"flex",alignItems:"center",justifyContent:"center",gap:"6px"}}><Icon name="edit" size={15} color="var(--accent)" />Edit Info</button>
        <button className="dash-nav-btn" onClick={onEditWorkouts} style={{display:"flex",alignItems:"center",justifyContent:"center",gap:"6px"}}><Icon name="dumbbell" size={15} color="var(--accent)" />Edit Workouts</button>
      </div>
      <div style={{fontSize:".58rem",color:"var(--muted)",textAlign:"center",marginTop:"10px",fontStyle:"italic",lineHeight:1.5}}>⚠️ All values are estimates for educational purposes. Not medical advice. Consult a healthcare provider before making changes to diet or exercise.</div>
    </div>
  );
}

// ─── Daily Check-In ───────────────────────────────────────────────────────────

// Month calendar for the check-in date picker. Dates that already have a
// check-in are highlighted (green) with a dot; the selected date is filled and
// today is outlined. Tapping a day selects it (which pre-fills the form).
function CheckInCalendar({ checkIns, selected, onSelect }) {
  const recorded = new Set((checkIns || []).filter(c => c.date).map(c => c.date));
  const todayStr = ymdLocal();
  const sel = selected || todayStr;
  const selDate = new Date(sel + "T12:00:00");
  const [view, setView] = useState({ y: selDate.getFullYear(), m: selDate.getMonth() });

  const first = new Date(view.y, view.m, 1);
  const startDow = first.getDay();
  const daysInMonth = new Date(view.y, view.m + 1, 0).getDate();
  const monthLabel = first.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const prevM = () => setView(v => v.m === 0 ? { y: v.y - 1, m: 11 } : { y: v.y, m: v.m - 1 });
  const nextM = () => setView(v => v.m === 11 ? { y: v.y + 1, m: 0 } : { y: v.y, m: v.m + 1 });
  const fmt = (d) => `${view.y}-${String(view.m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

  const cells = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const navBtn = { background: "transparent", border: "1px solid var(--border)", color: "var(--text)",
    borderRadius: 8, width: 30, height: 30, cursor: "pointer", fontSize: "1rem", lineHeight: 1 };

  return (
    <div style={{ background: "var(--s2)", border: "1px solid var(--border)", borderRadius: 10, padding: 10 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <button type="button" style={navBtn} onClick={prevM}>‹</button>
        <div style={{ fontWeight: 700, fontSize: ".9rem" }}>{monthLabel}</div>
        <button type="button" style={navBtn} onClick={nextM}>›</button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 3, marginBottom: 4 }}>
        {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
          <div key={i} style={{ textAlign: "center", fontSize: ".62rem", color: "var(--muted)", fontWeight: 600 }}>{d}</div>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 3 }}>
        {cells.map((d, i) => {
          if (d == null) return <div key={i} />;
          const ds = fmt(d);
          const isSel = ds === sel;
          const isToday = ds === todayStr;
          const has = recorded.has(ds);
          return (
            <button key={i} type="button" onClick={() => onSelect(ds)}
              style={{ position: "relative", height: 34, borderRadius: 7, cursor: "pointer",
                fontSize: ".78rem", fontWeight: isSel ? 800 : 500,
                border: isToday && !isSel ? "1px solid var(--accent)" : "1px solid transparent",
                background: isSel ? "var(--accent)" : has ? "rgba(79,255,176,.16)" : "transparent",
                color: isSel ? "#0b0b12" : "var(--text)" }}>
              {d}
              {has && !isSel && (
                <span style={{ position: "absolute", bottom: 3, left: "50%", transform: "translateX(-50%)",
                  width: 4, height: 4, borderRadius: "50%", background: "var(--green)" }} />
              )}
            </button>
          );
        })}
      </div>
      <div style={{ display: "flex", gap: 14, marginTop: 8, fontSize: ".66rem", color: "var(--muted)" }}>
        <span><span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: "var(--green)", marginRight: 4, verticalAlign: "middle" }} />logged</span>
        <span><span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 2, border: "1px solid var(--accent)", marginRight: 4, verticalAlign: "middle" }} />today</span>
      </div>
    </div>
  );
}

function DailyCheckIn({ data, onSaveCheckIn }) {
  const [checkDate, setCheckDate] = useState(ymdLocal());
  const [weight, setWeight] = useState(data.weightLbs || "");
  const [calories, setCalories] = useState("");
  const [hitTarget, setHitTarget] = useState(null);
  const [workedOut, setWorkedOut] = useState(null);
  const [mood, setMood] = useState(null);
  const [notes, setNotes] = useState("");
  const [bodyFatLog, setBodyFatLog] = useState("");
  const [saved, setSaved] = useState(false);

  const today = ymdLocal();
  const isFuture = checkDate > today;
  const isPast = checkDate < today;
  const canSave = weight && hitTarget !== null && checkDate;

  // When the date changes, pre-fill the form from any existing entry for that
  // date (so saving edits it), or reset to a blank entry for a new date.
  useEffect(() => {
    const ex = (data.checkIns || []).find(c => c.date === checkDate);
    if (ex) {
      setWeight(ex.weight != null ? String(ex.weight) : "");
      setCalories(ex.calories != null ? String(ex.calories) : "");
      setHitTarget(ex.hitTarget ?? null);
      setWorkedOut(ex.workedOut ?? null);
      setMood(ex.mood ?? null);
      setNotes(ex.notes || "");
      setBodyFatLog(ex.bodyFat != null ? String(ex.bodyFat) : "");
    } else {
      setWeight(data.weightLbs || "");
      setCalories(""); setHitTarget(null); setWorkedOut(null); setMood(null);
      setNotes(""); setBodyFatLog("");
    }
  }, [checkDate]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSave = () => {
    const checkin = {
      date: checkDate,
      timestamp: new Date(checkDate + "T12:00:00").getTime(),
      weight: Number(weight),
      calories: calories ? Number(calories) : null,
      hitTarget,
      workedOut,
      mood,
      notes,
      bodyFat: bodyFatLog ? Number(bodyFatLog) : null,
      loggedBy: "trainer",
      isFuturePlan: isFuture,
    };
    onSaveCheckIn(checkin);
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };

  // Check if this date already has a check-in
  const existingForDate = (data.checkIns || []).find(c => c.date === checkDate);

  return (
    <div className="checkin-card">
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:"4px"}}>
        <div>
          <div className="checkin-title">{isFuture ? "📅 Plan Ahead" : isPast ? "🕐 Log Past Day" : "📝 Daily Check-In"}</div>
          <div className="checkin-sub">
            {data.firstName ? `Logging for ${data.firstName}` : "Quick daily log"} — {isFuture ? "plan future targets to preview your trajectory" : isPast ? "fill in a missed day to keep your history complete" : "builds your progress history and keeps your streak alive"}.
          </div>
        </div>
      </div>

      {/* Date picker — calendar with logged dates highlighted */}
      <div className="checkin-field" style={{marginBottom:"12px"}}>
        <label>Date {isPast && "📌 past entry"} {isFuture && "📌 future plan"}</label>
        <CheckInCalendar checkIns={data.checkIns} selected={checkDate} onSelect={setCheckDate} />
      </div>
      {existingForDate && (
        <div style={{fontSize:".78rem",color:"var(--green)",marginBottom:"10px",padding:"8px 10px",background:"rgba(79,255,176,.06)",borderRadius:"8px",border:"1px solid rgba(79,255,176,.15)"}}>
          ✏️ Editing your existing entry for {checkDate}. Saving updates it (one entry per date).
        </div>
      )}

      <div className="checkin-grid">
        <div className="checkin-field">
          <label>{isFuture ? "Target Weight (lbs)" : "Weight (lbs)"}</label>
          <input type="text" inputMode="decimal" placeholder="e.g. 182" value={weight}
            onChange={e => setWeight(e.target.value.replace(/[^0-9.]/g, ""))} />
        </div>
        <div className="checkin-field">
          <label>{isFuture ? "Planned Calories" : "Calories Eaten"} (optional)</label>
          <input type="text" inputMode="numeric" placeholder="e.g. 1850" value={calories}
            onChange={e => setCalories(e.target.value.replace(/[^0-9]/g, ""))} />
        </div>
      </div>

      <div className="checkin-field" style={{marginBottom:"12px"}}>
        <label>Did you hit your calorie target?</label>
        <div style={{display:"flex",gap:"8px"}}>
          <button className={`mood-btn${hitTarget===true?" active":""}`} onClick={()=>setHitTarget(true)} style={{flex:1,fontSize:".84rem"}}>✅ Yes</button>
          <button className={`mood-btn${hitTarget===false?" active":""}`} onClick={()=>setHitTarget(false)} style={{flex:1,fontSize:".84rem"}}>❌ No</button>
        </div>
      </div>

      <div className="checkin-field" style={{marginBottom:"12px"}}>
        <label>Did you work out today?</label>
        <div style={{display:"flex",gap:"8px"}}>
          <button className={`mood-btn${workedOut===true?" active":""}`} onClick={()=>setWorkedOut(true)} style={{flex:1,fontSize:".84rem"}}>💪 Yes</button>
          <button className={`mood-btn${workedOut===false?" active":""}`} onClick={()=>setWorkedOut(false)} style={{flex:1,fontSize:".84rem"}}>😴 Rest Day</button>
        </div>
      </div>

      <div className="checkin-field" style={{marginBottom:"12px"}}>
        <label>Energy / Mood</label>
        <div className="checkin-mood">
          {["😫","😐","🙂","😊","🔥"].map((m,i) => (
            <button key={i} className={`mood-btn${mood===i?" active":""}`} onClick={()=>setMood(i)}>{m}</button>
          ))}
        </div>
      </div>

      <div className="checkin-grid">
        <div className="checkin-field">
          <label>Body Fat % (optional)</label>
          <input type="text" inputMode="decimal" placeholder="e.g. 20.5" value={bodyFatLog}
            onChange={e => setBodyFatLog(e.target.value.replace(/[^0-9.]/g, ""))} />
        </div>
        <div className="checkin-field">
          <label>Notes (optional)</label>
          <input type="text" placeholder="How did today go?" value={notes} onChange={e=>setNotes(e.target.value)} />
        </div>
      </div>

      <button className="checkin-submit" disabled={!canSave || saved} onClick={handleSave}
        style={isFuture ? {background:"#b57bff"} : isPast ? {background:"var(--yellow)",color:"#0b0b12"} : {}}>
        {saved ? "✓ Saved!" : isFuture ? "Save Future Plan" : isPast ? "Log Past Day" : "Save Today's Check-In"}
      </button>
    </div>
  );
}

// ─── Streak & Badge Tracker ──────────────────────────────────────────────────

function StreakBadges({ checkIns }) {
  // Calculate streak from check-ins
  const sorted = [...(checkIns || [])].sort((a, b) => b.timestamp - a.timestamp);
  let streak = 0;
  const today = ymdLocal();
  const yesterday = ymdLocal(new Date(Date.now() - 86400000));
  const dates = new Set(sorted.map(c => c.date));

  if (dates.has(today) || dates.has(yesterday)) {
    let checkDate = dates.has(today) ? new Date() : new Date(Date.now() - 86400000);
    while (dates.has(ymdLocal(checkDate))) {
      streak++;
      checkDate = new Date(checkDate.getTime() - 86400000);
    }
  }

  const totalCheckIns = checkIns?.length || 0;
  const hitDays = (checkIns || []).filter(c => c.hitTarget).length;
  const adherencePct = totalCheckIns > 0 ? Math.round((hitDays / totalCheckIns) * 100) : 0;

  const BADGES = [
    { id: "first", label: "First Check-In", emoji: "⭐", earned: totalCheckIns >= 1 },
    { id: "week", label: "7-Day Streak", emoji: "🔥", earned: streak >= 7 },
    { id: "month", label: "30-Day Streak", emoji: "💎", earned: streak >= 30 },
    { id: "ten", label: "10 Check-Ins", emoji: "📊", earned: totalCheckIns >= 10 },
    { id: "fifty", label: "50 Check-Ins", emoji: "🏆", earned: totalCheckIns >= 50 },
    { id: "adherence", label: "80%+ Adherence", emoji: "🎯", earned: totalCheckIns >= 7 && adherencePct >= 80 },
    { id: "perfect", label: "Perfect Week", emoji: "💯", earned: streak >= 7 && adherencePct === 100 },
  ];

  return (
    <>
      {(streak > 0 || totalCheckIns > 0) && (
        <div className="streak-bar">
          <span className="streak-fire">🔥</span>
          <div>
            <div className="streak-num">{streak}</div>
            <div className="streak-lbl">day streak</div>
          </div>
          <div style={{marginLeft:"auto",textAlign:"right"}}>
            <div style={{fontSize:".85rem",fontWeight:700,color:"var(--text)"}}>{totalCheckIns} {totalCheckIns === 1 ? "check-in" : "check-ins"}</div>
            <div style={{fontSize:".72rem",color: adherencePct >= 80 ? "var(--green)" : adherencePct >= 50 ? "var(--yellow)" : "var(--red)"}}>{adherencePct}% adherence</div>
          </div>
        </div>
      )}
      {BADGES.some(b => b.earned) && (
        <div className="badge-row">
          {BADGES.filter(b => b.earned).map(b => (
            <div key={b.id} className="badge earned">{b.emoji} {b.label}</div>
          ))}
        </div>
      )}
    </>
  );
}

// ─── Shareable Plan Card ─────────────────────────────────────────────────────

function SharePlanCard({ data, tdee, totalBurn, totalStrBurn }) {
  const { firstName, lastName, weightLbs, goalWeight, age, gender } = data;
  const hasGoal = goalWeight && Number(goalWeight) < Number(weightLbs);
  const toLose = hasGoal ? Number(weightLbs) - Number(goalWeight) : null;
  const targetCals = Math.max(1200, tdee - 500 + Math.round(totalBurn / 7));

  const handleShare = async () => {
    const text = `🏋️ ${fullName(data) || "My"} Glide Plan\n\n` +
      `📊 Maintenance: ${tdee.toLocaleString()} cal/day\n` +
      `🎯 Target (1lb/wk): ${targetCals.toLocaleString()} cal/day\n` +
      `🔥 Weekly burn: ${(totalBurn + totalStrBurn).toLocaleString()} cal\n` +
      (hasGoal ? `⚖️ Goal: ${weightLbs} → ${goalWeight} lbs\n` : "") +
      `\nBuilt with Glide`;
    try {
      if (navigator.share) {
        await navigator.share({ title: `${fullName(data) || "My"} Glide Plan`, text });
      } else {
        await navigator.clipboard.writeText(text);
      }
    } catch (e) {}
  };

  return (
    <div className="share-card">
      <div className="share-card-brand">GLIDE</div>
      <div className="share-card-name">{fullName(data) || "Your"} Plan</div>
      <div className="share-card-stats">
        <div className="scs-item">
          <div className="scs-val c-acc">{tdee.toLocaleString()}</div>
          <div className="scs-lbl">Maintenance</div>
        </div>
        <div className="scs-item">
          <div className="scs-val c-yel">{targetCals.toLocaleString()}</div>
          <div className="scs-lbl">Target Cal</div>
        </div>
        <div className="scs-item">
          <div className="scs-val c-org">{(totalBurn + totalStrBurn).toLocaleString()}</div>
          <div className="scs-lbl">Weekly Burn</div>
        </div>
      </div>
      {hasGoal && (
        <div style={{fontSize:".85rem",color:"var(--muted)",marginBottom:"8px"}}>
          ⚖️ {weightLbs} → {goalWeight} lbs · {toLose} lbs to go
        </div>
      )}
      <div className="share-card-footer">Screenshot this card or tap share below</div>
      <button className="share-btn" onClick={handleShare}>
        📤 Share This Plan
      </button>
    </div>
  );
}

// ─── Progress Chart (from check-in history) ──────────────────────────────────

function ProgressChart({ checkIns, goalWeight, currentWeight, showValues, pxPerPoint, rangeLow, rangeHigh, surfaceless }) {
  // surfaceless: drop the card background/border so the chart blends into a
  // parent surface (used inside the brand-themed WeightChartModal, where the
  // old purple .card background would clash with the near-black modal surface).
  const cardStyle = surfaceless
    ? { background: "transparent", border: "none", padding: 0, marginBottom: 0 }
    : undefined;
  const sorted = [...(checkIns || [])].filter(c => c.weight).sort((a, b) => a.timestamp - b.timestamp);
  if (sorted.length < 2) return (
    <div className="card" style={{padding:"16px",textAlign:"center",color:"var(--muted)",fontSize:".84rem",lineHeight:1.6,...cardStyle}}>
      📈 Progress chart appears after 2+ check-ins with weight logged. Keep checking in daily!
    </div>
  );

  const H = 220;
  const PAD = { top: 20, right: 50, bottom: 40, left: 60 };
  // With pxPerPoint set, the chart width grows with the number of points (fixed
  // spacing per weigh-in) so labels don't overlap and it scrolls sideways. Without
  // it, the chart stays a fixed responsive 500-wide (the full-plan view).
  const W = pxPerPoint
    ? PAD.left + PAD.right + Math.max(1, sorted.length - 1) * pxPerPoint
    : 500;
  const chartW = W - PAD.left - PAD.right;
  const chartH = H - PAD.top - PAD.bottom;

  const weights = sorted.map(c => c.weight);
  const goal = Number(goalWeight) || null;
  // Optional goal-range band (low–high). Both must be present and ordered.
  const rLo = Number(rangeLow) || null;
  const rHi = Number(rangeHigh) || null;
  const hasBand = rLo && rHi && rLo < rHi;
  const allVals = [...weights, ...(goal ? [goal] : []), ...(hasBand ? [rLo, rHi] : [])];
  const yMin = Math.min(...allVals) - 3;
  const yMax = Math.max(...allVals) + 3;
  const yRange = yMax - yMin;

  const xScale = (i) => (i / (sorted.length - 1)) * chartW;
  const yScale = (w) => chartH - ((w - yMin) / yRange) * chartH;

  const linePts = sorted.map((c, i) => `${i === 0 ? "M" : "L"}${(PAD.left + xScale(i)).toFixed(1)},${(PAD.top + yScale(c.weight)).toFixed(1)}`).join(" ");

  const startW = sorted[0].weight;
  const endW = sorted[sorted.length - 1].weight;
  const diff = startW - endW;
  const trend = diff > 0.5 ? "losing" : diff < -0.5 ? "gaining" : "maintaining";
  const trendColor = trend === "losing" ? "var(--green)" : trend === "gaining" ? "var(--orange)" : "var(--accent)";

  // Adherence from check-ins
  const hitDays = (checkIns || []).filter(c => c.hitTarget).length;
  const adherence = checkIns.length > 0 ? Math.round((hitDays / checkIns.length) * 100) : 0;

  return (
    <div className="card" style={{padding:"16px",marginBottom:"16px",...cardStyle}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"12px"}}>
        <div>
          <div style={{fontFamily:"'Sora',sans-serif",fontSize:"1.1rem",letterSpacing:"2px",color:"var(--accent)"}}>📈 Progress</div>
          <div style={{fontSize:".74rem",color:"var(--muted)"}}>{sorted.length} {sorted.length === 1 ? "weigh-in" : "weigh-ins"} · {checkIns.length} {checkIns.length === 1 ? "check-in" : "check-ins"}</div>
        </div>
        <div style={{textAlign:"right"}}>
          <div style={{fontFamily:"'Sora',sans-serif",fontSize:"1.3rem",color:trendColor}}>
            {diff > 0 ? `−${diff.toFixed(1)}` : diff < 0 ? `+${Math.abs(diff).toFixed(1)}` : "0"} lbs
          </div>
          <div style={{fontSize:".68rem",color:trendColor,textTransform:"uppercase",letterSpacing:"1px"}}>{trend}</div>
        </div>
      </div>

      <div style={{ overflowX: pxPerPoint ? "auto" : "visible" }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={pxPerPoint
          ? {width: `${W}px`, height: "auto", display: "block"}
          : {width: "100%", height: "auto", display: "block"}}>
        {/* Grid */}
        {Array.from({length: 5}, (_, i) => {
          const y = PAD.top + (chartH * i / 4);
          const wt = Math.round(yMax - (yRange * i / 4));
          return (
            <g key={i}>
              <line x1={PAD.left} y1={y} x2={PAD.left + chartW} y2={y} stroke="rgba(255,255,255,.06)" strokeWidth="1" />
              <text x={PAD.left - 10} y={y + 4} textAnchor="end" fill="#a8a8cc" fontSize="11" fontFamily="DM Sans,sans-serif">{wt}</text>
            </g>
          );
        })}

        {/* Goal-range band (low–high) shaded behind the line */}
        {hasBand && (
          <rect x={PAD.left} y={PAD.top + yScale(rHi)} width={chartW}
            height={Math.max(0, yScale(rLo) - yScale(rHi))}
            fill="rgba(79,255,176,.10)" stroke="rgba(79,255,176,.25)" strokeWidth="1" />
        )}

        {/* Goal line (label is drawn last, below, so nothing covers it) */}
        {goal && (
          <line x1={PAD.left} y1={PAD.top + yScale(goal)} x2={PAD.left + chartW} y2={PAD.top + yScale(goal)}
            stroke="rgba(8,220,224,.4)" strokeWidth="1.5" strokeDasharray="6 4" />
        )}

        {/* Weight line */}
        <path d={linePts} fill="none" stroke="#4fffb0" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />

        {/* Dots */}
        {sorted.map((c, i) => (
          <circle key={i} cx={PAD.left + xScale(i)} cy={PAD.top + yScale(c.weight)} r={showValues ? 5 : 4} fill="#4fffb0" stroke="#0d0d18" strokeWidth="2" />
        ))}

        {/* Weight value labels at each dot (opt-in). Placed on the OUTSIDE of each
            vertex — above peaks, below valleys — so they sit away from the line,
            with a dark halo (paint-order stroke) so they stay readable over it. */}
        {showValues && sorted.map((c, i) => {
          const dotY = PAD.top + yScale(c.weight);
          const prevW = i > 0 ? sorted[i - 1].weight : null;
          const nextW = i < sorted.length - 1 ? sorted[i + 1].weight : null;
          const neighborAvg = (prevW != null && nextW != null) ? (prevW + nextW) / 2
            : (prevW != null ? prevW : nextW);
          // Peak (>= neighbors) → label above; valley → below.
          let above = neighborAvg == null ? true : c.weight >= neighborAvg;
          // If this dot is near the goal line, push its label to the side AWAY
          // from the line so the number never sits on the dashed goal line.
          if (goal) {
            const goalY = PAD.top + yScale(goal);
            if (Math.abs(dotY - goalY) < 30) above = dotY <= goalY;
          }
          if (dotY < PAD.top + 16) above = false;            // too near top → push below
          if (dotY > PAD.top + chartH - 16) above = true;    // too near bottom → push above
          return (
            <text key={`v${i}`} x={PAD.left + xScale(i)} y={dotY + (above ? -13 : 19)}
              textAnchor="middle" fill="#e8e8ff" fontSize="11" fontWeight="700" fontFamily="DM Sans,sans-serif"
              stroke="#0d0d18" strokeWidth="3.5" paintOrder="stroke" strokeLinejoin="round">
              {c.weight}
            </text>
          );
        })}

        {/* X axis labels */}
        {sorted.filter((_, i) => i === 0 || i === sorted.length - 1 || i === Math.floor(sorted.length / 2)).map((c, idx) => {
          const i = idx === 0 ? 0 : idx === 1 ? Math.floor(sorted.length / 2) : sorted.length - 1;
          const d = new Date(sorted[i].timestamp);
          return (
            <text key={i} x={PAD.left + xScale(i)} y={H - 8} textAnchor="middle" fill="#a8a8cc" fontSize="10" fontFamily="DM Sans,sans-serif">
              {d.toLocaleDateString(undefined, {month:"short",day:"numeric"})}
            </text>
          );
        })}

        {/* Goal label — drawn last with a dark halo so the value labels never
            cover it; sits just left of the line's right end. */}
        {goal && (
          <text x={PAD.left + chartW + 8} y={PAD.top + yScale(goal) + 4}
            fill="#08dce0" fontSize="11" fontWeight="700" fontFamily="DM Sans,sans-serif"
            stroke="#0d0d18" strokeWidth="3.5" paintOrder="stroke" strokeLinejoin="round">
            {goal}
          </text>
        )}
      </svg>
      </div>

      <div style={{display:"flex",gap:"16px",marginTop:"10px",justifyContent:"center",flexWrap:"wrap"}}>
        <div style={{textAlign:"center"}}>
          <div style={{fontFamily:"'Sora',sans-serif",fontSize:"1.2rem",color:"var(--text)"}}>{startW} → {endW}</div>
          <div style={{fontSize:".65rem",color:"var(--muted)",textTransform:"uppercase",letterSpacing:".5px"}}>Weight Trend</div>
        </div>
        <div style={{textAlign:"center"}}>
          <div style={{fontFamily:"'Sora',sans-serif",fontSize:"1.2rem",color: adherence >= 80 ? "var(--green)" : adherence >= 50 ? "var(--yellow)" : "var(--red)"}}>{adherence}%</div>
          <div style={{fontSize:".65rem",color:"var(--muted)",textTransform:"uppercase",letterSpacing:".5px"}}>Adherence</div>
        </div>
        {goal && (
          <div style={{textAlign:"center"}}>
            <div style={{fontFamily:"'Sora',sans-serif",fontSize:"1.2rem",color:"var(--accent)"}}>{Math.max(0, (endW - goal)).toFixed(1)}</div>
            <div style={{fontSize:".65rem",color:"var(--muted)",textTransform:"uppercase",letterSpacing:".5px"}}>lbs to goal</div>
          </div>
        )}
      </div>
    </div>
  );
}

// Full-screen weight-progress popup: the scrollable, value-labeled chart plus a
// list of weigh-ins each with a ✕ to delete. Used by both the Client Dashboard
// and the Pro Tracking section. `onDelete(timestamp)` is optional (omit to make
// it read-only). `startWeight` lets the chart draw a "start → now" segment when
// there's only one real weigh-in yet.
function WeightChartModal({ checkIns, goalWeight, currentWeight, rangeLow, rangeHigh, startWeight, onDelete, onClose }) {
  // Self-contained brand theme (data-theme="pro") so it looks identical whether
  // it's opened from the pro-themed Client Dashboard or the old-styled Results.
  const w = Number(currentWeight) || 0;
  const start = Number(startWeight) || 0;
  const weighIns = [...(checkIns || [])].filter(c => c.weight).sort((a, b) => a.timestamp - b.timestamp);
  let chartCheckIns = checkIns || [];
  if (weighIns.length === 1 && start && start !== w) {
    const firstTs = weighIns[0].timestamp || Date.now();
    chartCheckIns = [{ date: new Date(firstTs - 86400000).toISOString().slice(0, 10),
      timestamp: firstTs - 86400000, weight: start, hitTarget: null }, ...(checkIns || [])];
  }
  // Rendered through a portal to document.body so it anchors to the viewport,
  // not to a transformed ancestor (the .page-transition wrapper keeps a CSS
  // transform, which would otherwise become the containing block for fixed).
  return createPortal(
    <div data-theme="pro" onClick={onClose} style={{ fontFamily: "var(--font-sans)" }}
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/60 p-4">
      <div onClick={e => e.stopPropagation()}
        className="w-full max-w-[640px] max-h-[88vh] overflow-auto rounded-card border border-border bg-surface p-4 text-fg">
        <div className="mb-3 flex items-center justify-between">
          <div className="text-[1.05rem] font-extrabold">📈 Weight progress</div>
          <button onClick={onClose}
            className="rounded-md border border-border bg-transparent px-2.5 py-1.5 text-xs font-semibold text-fg cursor-pointer whitespace-nowrap">✕ Close</button>
        </div>
        <ProgressChart checkIns={chartCheckIns} goalWeight={goalWeight} currentWeight={w} showValues pxPerPoint={64}
          rangeLow={rangeLow} rangeHigh={rangeHigh} surfaceless />
        {onDelete && weighIns.length > 0 && (
          <div className="mt-3.5">
            <div className="mb-1.5 text-sm text-muted">
              Weigh-ins ({weighIns.length}) — tap ✕ to remove a mistake
            </div>
            <div className="flex max-h-[180px] flex-col gap-1 overflow-y-auto">
              {[...weighIns].reverse().map((c) => (
                <div key={c.timestamp}
                  className="flex items-center justify-between rounded-lg bg-surface2 px-2.5 py-1.5">
                  <span className="text-[.88rem] font-semibold">
                    {c.weight} lbs
                    <span className="ml-2 text-[.76rem] font-normal text-muted">
                      {new Date(c.timestamp).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                    </span>
                  </span>
                  <button onClick={() => onDelete(c.timestamp)} title="Delete this weigh-in"
                    className="cursor-pointer border-none bg-transparent px-1.5 py-0.5 text-base leading-none text-danger">✕</button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}

// ─── AI Coaching Insights ────────────────────────────────────────────────────

function AICoach({ data, tdee, totalBurn, totalStrBurn, activeDays, activeStrDays }) {
  const [insights, setInsights] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const generateInsights = async () => {
    setLoading(true);
    setError(null);
    try {
      const checkIns = data.checkIns || [];
      const recent = checkIns.slice(-14);
      const adherence = checkIns.length > 0 ? Math.round((checkIns.filter(c => c.hitTarget).length / checkIns.length) * 100) : null;
      const weightTrend = recent.length >= 2
        ? `Started at ${recent[0].weight} lbs, most recent ${recent[recent.length-1].weight} lbs (${(recent[0].weight - recent[recent.length-1].weight).toFixed(1)} lbs change over ${recent.length} check-ins)`
        : "No check-in history yet";
      const avgMood = recent.filter(c=>c.mood!=null).length > 0
        ? (recent.filter(c=>c.mood!=null).reduce((s,c)=>s+c.mood,0) / recent.filter(c=>c.mood!=null).length).toFixed(1)
        : null;

      const prompt = `Analyze this client's fitness profile as their coach. Be specific, actionable, and encouraging, and use their actual numbers. Keep it under 220 words. Structure it as: a one-line summary, a short "Wins" list, a short "Focus areas" list, and a closing line of motivation. Use simple formatting (dashes for lists, **bold** for short labels) — no tables.

CLIENT PROFILE:
- Name: ${fullName(data) || "Client"}
- Age: ${data.age}, Gender: ${data.gender}, Weight: ${data.weightLbs} lbs, Height: ${data.heightFt}'${data.heightIn}"
- Goal weight: ${data.goalWeight || "not set"} lbs
- TDEE: ${tdee} cal/day
- Cardio: ${activeDays} days/week, ${totalBurn} cal/week burned
- Strength: ${activeStrDays} days/week, ${totalStrBurn} cal/week burned
- Weight trend: ${weightTrend}
- Adherence: ${adherence !== null ? adherence + "%" : "no data yet"}
- Average mood (0-4 scale): ${avgMood || "no data"}
- Total check-ins: ${checkIns.length}`;

      // Routed through the secure aiChat Cloud Function (role-based prompt +
      // daily token budget) — replaces the old keyless direct API call that
      // never worked from the browser.
      const res = await callAiChat({ messages: [{ role: "user", content: prompt }] });
      const text = (res.data && res.data.reply) || "";
      if (!text) throw new Error("empty");
      setInsights(text);
    } catch (e) {
      const code = (e && e.code) || "";
      if (code.includes("resource-exhausted")) setError("You've reached today's AI usage limit. It resets tomorrow.");
      else setError("Couldn't generate insights right now. Try again in a moment.");
    }
    setLoading(false);
  };

  return (
    <div className="card" style={{padding:"16px",marginBottom:"16px",borderColor: insights ? "rgba(181,123,255,.25)" : "var(--border)",background: insights ? "rgba(181,123,255,.03)" : "var(--surface)"}}>
      <div style={{display:"flex",alignItems:"center",gap:"10px",marginBottom: insights ? "14px" : "0"}}>
        <span style={{fontSize:"1.4rem"}}>🤖</span>
        <div style={{flex:1}}>
          <div style={{fontFamily:"'Sora',sans-serif",fontSize:"1.1rem",letterSpacing:"2px",color:"#b57bff"}}>AI Coaching Insights</div>
          <div style={{fontSize:".73rem",color:"var(--muted)"}}>Powered by Claude — analyzes {data.firstName || "your client"}'s complete profile</div>
        </div>
        {!insights && (
          <button className="save-bar-btn" style={{flex:"0 0 auto",minHeight:"38px",padding:"0 16px",fontSize:".78rem",borderColor:"#b57bff",color:"#b57bff",background:"rgba(181,123,255,.06)"}}
            disabled={loading} onClick={generateInsights}>
            {loading ? "Analyzing..." : <span style={{display:"inline-flex",alignItems:"center",gap:"6px"}}><Icon name="sparkle" variant="solid" size={14} color="#b57bff" />Generate</span>}
          </button>
        )}
      </div>

      {error && <div style={{fontSize:".82rem",color:"var(--red)",padding:"8px 0"}}>{error}</div>}

      {insights && (
        <div style={{animation:"fadeUp .3s ease both"}}>
          <div style={{fontSize:".86rem",color:"var(--text)",lineHeight:1.6,whiteSpace:"normal"}}>
            <RichText text={insights} />
          </div>

          <button style={{background:"none",border:"none",color:"var(--muted)",cursor:"pointer",fontFamily:"inherit",fontSize:".73rem",textDecoration:"underline",padding:"8px 0",marginTop:"10px"}}
            onClick={()=>{setInsights(null);generateInsights();}}>
            🔄 Regenerate insights
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Role system (MVP scaffolding — Session 3) ──────────────────────────────
// Self-contained panel shown on the client-list screen. Reads the signed-in
// user's role from their profile and shows either:
//   • client  → "Join your trainer" (paste invite code) / current trainer
//   • trainer → their invite code (copyable) + their list of clients
// Full dashboards are a later session; this just makes the role system usable
// and proves the trainer-sees-clients security rule works end to end.
// Read the invite code from the page URL (?invite=CODE), if present.
function getInviteFromUrl() {
  try { return (new URLSearchParams(window.location.search).get("invite") || "").trim(); }
  catch { return ""; }
}
// Remove ?invite= from the URL without reloading, so it can't re-fire.
function clearInviteFromUrl() {
  try {
    const url = new URL(window.location.href);
    url.searchParams.delete("invite");
    window.history.replaceState({}, "", url.toString());
  } catch { /* ignore */ }
}

function RolePanel({ onOpenClientPlan, onLinked, onCopyToLocal } = {}) {
  const [profile, setProfile] = useState(undefined); // undefined = loading
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [copied, setCopied] = useState(false);
  const [inviteCode, setInviteCode] = useState("");
  const [trainerName, setTrainerName] = useState("");
  const [firstInput, setFirstInput] = useState("");
  const [lastInput, setLastInput] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);

  const load = async () => {
    let p = await getProfile();

    // Auto-link from an invite link: if a client opened ?invite=CODE and isn't
    // already linked, link them to that trainer, then clean the code out of the
    // URL so it can't re-fire on refresh.
    const invite = getInviteFromUrl();
    if (p && p.role === ROLES.CLIENT && !p.assignedTrainerId && invite) {
      try {
        const tUid = await joinTrainer(invite);
        const t = await getProfile(tUid);
        setMsg(`You've been linked to ${(t && (t.displayName || t.email)) || "your trainer"}.`);
        p = await getProfile(); // refresh with the new link
      } catch (e) {
        setMsg((e && e.message) || "Couldn't use that invite link.");
      }
      clearInviteFromUrl();
    }

    setProfile(p || null);
    if (p) { const [f, l] = splitName(p); setFirstInput(f); setLastInput(l); }
    if (p && (p.role === ROLES.HEAD_TRAINER || p.role === ROLES.SUB_TRAINER)) {
      // Connected-client management moved to the dashboard's "Your Connected
      // Clients" card; the role panel now only needs the trainer's invite code.
      try { setInviteCode(await ensureInviteCode()); } catch { /* ignore */ }
    } else if (p && p.assignedTrainerId) {
      // Client view: look up the trainer's friendly name to display instead of
      // their raw uid.
      try {
        const t = await getProfile(p.assignedTrainerId);
        if (t) setTrainerName(t.displayName || t.email || "");
      } catch { /* ignore */ }
    }
  };
  useEffect(() => { load(); }, []);

  if (!profile) return null; // loading, or no profile (AuthGate guarantees one)

  const isTrainer = profile.role === ROLES.HEAD_TRAINER || profile.role === ROLES.SUB_TRAINER;

  const join = async () => {
    const c = code.trim();
    if (!c) { setMsg("Paste your trainer's invite code first."); return; }
    setBusy(true); setMsg("");
    try {
      await joinTrainer(c);
      setMsg("Linked to your trainer.");
      setCode("");
      await load();
    } catch (e) {
      setMsg((e && e.message) || "Could not link to that trainer.");
    } finally { setBusy(false); }
  };

  const copyCode = async () => {
    if (!inviteCode) return;
    try {
      await navigator.clipboard.writeText(formatInviteCode(inviteCode));
      setCopied(true); setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard unavailable */ }
  };

  // Full shareable link a trainer can send to a new client.
  const shareLink = inviteCode
    ? `${window.location.origin}/?invite=${inviteCode}`
    : "";

  const copyLink = async () => {
    if (!shareLink) return;
    try {
      await navigator.clipboard.writeText(shareLink);
      setCopied(true); setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard unavailable */ }
  };

  const saveName = async () => {
    const f = firstInput.trim();
    const l = lastInput.trim();
    if (isTrainer && (!f || !l)) { setMsg("Trainers need a first and last name."); return; }
    setSavingName(true); setMsg("");
    try {
      await setName(f, l);
      setMsg("Name saved.");
      await load();
    } catch (e) {
      setMsg((e && e.message) || "Couldn't save your name.");
    } finally { setSavingName(false); }
  };

  const leave = async () => {
    setBusy(true); setMsg("");
    try {
      await leaveTrainer();
      setTrainerName("");
      setConfirmLeave(false);
      setMsg("You've left your trainer. You can join another with a code below.");
      await load();
    } catch (e) {
      setMsg((e && e.message) || "Couldn't leave your trainer.");
    } finally { setBusy(false); }
  };

  // Tailwind classes (matches the Session-26 ClientHome brand theme it renders in).
  const fieldCls = "flex-1 min-w-0 rounded-lg border border-border bg-surface2 px-3 py-2.5 text-[.9rem] text-fg outline-none placeholder:text-muted";
  const btnCls = "rounded-lg border-none bg-primaryfill px-3.5 py-2.5 text-[.85rem] font-bold text-primaryfg cursor-pointer whitespace-nowrap disabled:opacity-55";
  const subCls = "text-[.85rem] text-muted leading-relaxed";

  return (
    <div className="bg-surface border border-border rounded-card p-5 text-fg">
      <div className="mb-3 text-[.95rem] font-extrabold">
        {isTrainer ? "🧑‍🏫 Trainer" : "🙋 Client"}
        <span className="ml-2 text-[.8rem] font-normal text-muted">
          {profile.email}
        </span>
      </div>

      {/* Name editor shows only until a name is set — keeps the home clean.
          (Editing an existing name will move into the profile side menu later.) */}
      {!profile.displayName && (
        <>
          <div className={`${subCls} mb-1.5`}>
            Your name{isTrainer ? "" : " (optional)"}
          </div>
          <div className="mb-4 flex items-center gap-2">
            <input
              className={fieldCls} value={firstInput} placeholder="First name"
              onChange={(e) => setFirstInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && saveName()}
            />
            <input
              className={fieldCls} value={lastInput} placeholder="Last name"
              onChange={(e) => setLastInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && saveName()}
            />
            <button className={btnCls} onClick={saveName} disabled={savingName}>
              {savingName ? "…" : "Save"}
            </button>
          </div>
        </>
      )}

      {isTrainer ? (
        <div className={subCls}>
          📨 Invite codes &amp; links now live in the <strong className="text-fg">≡ menu → Invite clients</strong>.
          Your connected clients (link / open / manage) are on the Dashboard.
        </div>
      ) : (
        <>
          {profile.assignedTrainerId ? (
            <>
              <div className={subCls}>
                You're linked to trainer:{" "}
                <strong className="text-fg">
                  {trainerName || profile.assignedTrainerId}
                </strong>
              </div>
              {confirmLeave ? (
                <div className="mt-2.5">
                  <div className="mb-2 text-[.85rem] text-fg">
                    Leave this trainer? You can re-join later with their code.
                  </div>
                  <div className="flex gap-2">
                    <button
                      className="rounded-lg border-none bg-danger px-3.5 py-2.5 text-[.85rem] font-bold text-white cursor-pointer disabled:opacity-55"
                      onClick={leave} disabled={busy}
                    >
                      {busy ? "…" : "Yes, leave"}
                    </button>
                    <button
                      className="rounded-lg border border-border bg-transparent px-3.5 py-2.5 text-[.85rem] font-bold text-muted cursor-pointer disabled:opacity-55"
                      onClick={() => setConfirmLeave(false)} disabled={busy}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  className="mt-2.5 rounded-lg border border-border bg-transparent px-3.5 py-2.5 text-[.85rem] font-bold text-muted cursor-pointer disabled:opacity-55"
                  onClick={() => setConfirmLeave(true)} disabled={busy}
                >
                  Leave trainer
                </button>
              )}
            </>
          ) : (
            <>
              <div className={subCls}>
                Have a trainer? Paste their invite code to link your account.
              </div>
              <div className="my-1 flex items-center gap-2">
                <input
                  className={fieldCls} value={code} placeholder="Trainer invite code"
                  onChange={(e) => setCode(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && join()}
                />
                <button className={btnCls} onClick={join} disabled={busy}>
                  {busy ? "…" : "Join"}
                </button>
              </div>
            </>
          )}
        </>
      )}
      {msg && <div className="mt-2 text-[.82rem] text-muted">{msg}</div>}
    </div>
  );
}

// ─── Trainer → client requests (Session 19) ─────────────────────────────────
// A trainer sends a linked client a small actionable to-do that surfaces on the
// client's home screen. Stored as an append-only array in the CLIENT's account
// under "caliq-requests" — the trainer already has write access there via
// firestore.rules (trainer ↔ client kv), so no rules change. Each item:
//   { id, fromUid, fromName, type, prompt, status:"open"|"done", createdAt, doneAt }
// The reverse direction (client → trainer) needs server-side writes (Blaze).
const REQUEST_TEMPLATES = [
  { type: "log_food",    icon: "🍽️", label: "Log today's food",  prompt: "Please log what you ate today." },
  { type: "weigh_in",    icon: "⚖️", label: "Do a weigh-in",     prompt: "Please record today's weight." },
  { type: "log_workout", icon: "🏋️", label: "Record a workout",  prompt: "Please record your workout for today." },
  { type: "enter_info",  icon: "📝", label: "Enter your info",   prompt: "Please fill in your details and goals so we can build your plan." },
];
const REQUEST_KEY = "caliq-requests";

// Read / write a user's request list (trainer reads a client's via getForUser;
// the client reads their own via window.storage). Always newest-first, capped.
async function readRequestsFor(uid, getForUser) {
  try { const r = await getForUser(uid, REQUEST_KEY); return r && r.value ? (JSON.parse(r.value) || []) : []; }
  catch { return []; }
}

// ─── Multiple plans per client (Session 21) ──────────────────────────────────
// A client account can hold several plans, with one marked active. Each plan's
// data + logs + history are keyed by its plan id (the original single plan is id
// "self"), so the existing storage layout already supports it — we just add a
// manifest that lists the plans and which is active.
//   caliq-plans = { active: "self", plans: [{ id, name, createdAt }] }
// The get/set functions are passed in so the SAME helpers work for the client
// (window.storage on their own account) and the trainer (getForUser/setForUser
// on the client's account).
const PLANS_KEY = "caliq-plans";
const planDataKey    = (id) => `caliq-${id}`;            // caliq-self, caliq-p1700…
const planLogPrefix  = (id) => `caliq-log-${id}-`;       // + YYYY-MM-DD
const planHistoryKey = (id) => `caliq-history-${id}`;

// Live-refresh a trainer's client summary cards. Watches each connected client's
// active-plan history doc — it changes on nearly every client action (meals,
// weigh-ins, calorie/workout logs, and AI-logged entries) — and re-pulls the
// summaries (debounced). Each subscription's initial snapshot is skipped so it
// only fires on real changes, and the latest `reload` is always called via a ref
// so a stale closure can't be captured. `clients` rows must carry `uid` +
// `activePlanId`. Used by TrainerDashboard + TrainerAnalytics.
function useClientLiveRefresh(clients, reload) {
  const reloadRef = useRef(reload);
  reloadRef.current = reload;
  const sig = (clients || []).map((c) => `${c.uid}:${c.activePlanId || ""}`).join("|");
  useEffect(() => {
    if (!clients || !clients.length) return;
    let t = null;
    const ping = () => { if (t) clearTimeout(t); t = setTimeout(() => reloadRef.current(), 1500); };
    const unsubs = clients.map((c) => {
      if (!c.activePlanId) return () => {};
      let primed = false;
      return subscribeForUser(c.uid, planHistoryKey(c.activePlanId), () => {
        if (!primed) { primed = true; return; } // ignore the initial snapshot
        ping();
      });
    });
    return () => { if (t) clearTimeout(t); unsubs.forEach((u) => { try { u(); } catch { /* ignore */ } }); };
  }, [sig]); // eslint-disable-line react-hooks/exhaustive-deps
}

// Normalize a manifest, always returning at least the default "self" plan and a
// valid active id. Back-compat: clients with no manifest get one synthesized.
function normalizePlans(m) {
  if (!m || !Array.isArray(m.plans) || m.plans.length === 0) {
    m = { active: "self", plans: [{ id: "self", name: "Main plan", createdAt: 0 }] };
  }
  if (!m.plans.some((p) => p.id === m.active)) m.active = m.plans[0].id;
  return m;
}
async function readPlansManifest(getFn) {
  let m = null;
  try { const r = await getFn(PLANS_KEY); m = r && r.value ? JSON.parse(r.value) : null; } catch { /* ignore */ }
  return normalizePlans(m);
}
async function writePlansManifest(setFn, m) {
  try { await setFn(PLANS_KEY, JSON.stringify(normalizePlans(m))); } catch { /* ignore */ }
}

// Quick-action popup the client gets when they tap "Do it now" on a trainer
// request. For loggable types (weigh-in / food / workout) it captures the value
// inline, auto-marks the request done, and closes with a ✓ — so the client never
// leaves the home screen. For types that need the full editor (enter info / a
// custom ask) it offers an "Open my plan" jump instead. (Session 19)
function QuickActionModal({ request, onWeighIn, onLogFood, onLogWorkout, onOpenPlan, onMarkDone, onClose }) {
  const [val, setVal] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const type = request.type;
  const isLoggable = type === "weigh_in" || type === "log_food" || type === "log_workout";

  const finish = async (ok) => {
    if (!ok) { setBusy(false); return; }
    await onMarkDone();
    setBusy(false); setDone(true);
    setTimeout(onClose, 1000);
  };
  const run = async (fn) => { setBusy(true); const ok = await fn(); await finish(ok); };

  const inputCls = "w-full box-border rounded-lg border border-border bg-surface2 px-3.5 py-3 text-center text-[1.1rem] text-fg outline-none placeholder:text-muted";
  const primaryCls = "flex-1 rounded-[9px] border-none bg-primaryfill px-3.5 py-3 text-[.92rem] font-bold text-primaryfg cursor-pointer disabled:opacity-55 disabled:cursor-default";
  const ghostCls = "rounded-[9px] border border-border bg-transparent px-3.5 py-3 text-[.88rem] font-semibold text-fg cursor-pointer";

  const meta = {
    weigh_in:    { icon: "⚖️", title: "Log today's weight", label: "Today's weight (lbs)", ph: "e.g. 182", cta: "Log weight",  numeric: true,  fn: () => onWeighIn(val) },
    log_food:    { icon: "🍽️", title: "Log today's food",   label: "Calories eaten today",  ph: "e.g. 650", cta: "Add calories", numeric: true,  fn: () => onLogFood(val) },
    log_workout: { icon: "🏋️", title: "Record your workout", label: "Add a note (optional)", ph: "e.g. Push day — felt strong", cta: "Mark workout done", numeric: false, fn: () => onLogWorkout(val) },
  }[type];

  return createPortal(
    <div data-theme="pro" onClick={onClose} style={{ fontFamily: "var(--font-sans)" }}
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/60 p-4">
      <div onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[440px] rounded-card border border-border bg-surface p-[18px] text-fg">
        {done ? (
          <div className="py-[18px] text-center">
            <div className="text-[2.2rem]">✅</div>
            <div className="mt-1.5 text-[1.05rem] font-extrabold">Done!</div>
          </div>
        ) : isLoggable ? (
          <>
            <div className="mb-1 text-[1.05rem] font-extrabold">{meta.icon} {meta.title}</div>
            <div className="mb-3.5 text-[.82rem] text-muted">{request.prompt}</div>
            <label className="text-[.72rem] uppercase tracking-[.5px] text-muted">{meta.label}</label>
            <input autoFocus type={meta.numeric ? "number" : "text"} inputMode={meta.numeric ? "decimal" : "text"}
              value={val} placeholder={meta.ph} className={`${inputCls} my-1.5 mb-4`}
              onChange={(e) => setVal(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !busy) run(meta.fn); }} />
            <div className="flex gap-2.5">
              <button className={primaryCls}
                disabled={busy || (meta.numeric && !(Number(val) > 0))}
                onClick={() => run(meta.fn)}>{busy ? "Saving…" : meta.cta}</button>
              <button className={ghostCls} disabled={busy} onClick={onClose}>Cancel</button>
            </div>
          </>
        ) : (
          // enter_info / custom — needs the full editor, so offer a jump there.
          <>
            <div className="mb-1 text-[1.05rem] font-extrabold">📝 {request.prompt}</div>
            <div className="mb-4 text-[.82rem] text-muted">
              Open your plan to take care of this, then come back.
            </div>
            <div className="flex gap-2.5">
              <button className={primaryCls} onClick={() => { onMarkDone(); onOpenPlan(); }}>Open my plan →</button>
              <button className={ghostCls} onClick={onClose}>Close</button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body
  );
}

// ─── Trainer overview dashboard (Session 7) ─────────────────────────────────
// A role-aware home view for trainers: every client profile at a glance —
// weight vs goal, daily calorie target, last activity, and plan status. Reads
// existing per-profile data + daily logs only; no new data model, no Blaze.

// Daily calorie target for a client, using the SAME formula as the Results
// "Target calories" row (1 lb/wk deficit, avg exercise burn added, floored at
// 1,200). Returns null if the profile is too incomplete to compute.
function computeClientCalories(d) {
  if (!d) return null;
  const w = Number(d.weightLbs);
  if (!w || !d.gender) return null;
  const actObj = ACTIVITY_LEVELS.find((a) => a.id === d.activityLevel) || ACTIVITY_LEVELS[0];
  const bmr = calcBMR(d.gender, w, Number(d.heightFt), Number(d.heightIn), Number(d.age));
  if (!bmr || !isFinite(bmr)) return null;
  const tdee = Math.round(bmr * actObj.multiplier);
  const allStrEx = [REST_ST, ...STRENGTH_EXERCISES, ...customOf(d.customExercises, "strength")];
  let cardio = 0, strength = 0;
  DAYS.forEach((day) => {
    (Array.isArray((d.cardio || {})[day]) ? d.cardio[day] : []).forEach((s) => {
      const co = findCardioEx(s.type, d.customExercises);
      cardio += exBurn(co, w, s.duration);
    });
    (Array.isArray((d.strength || {})[day]) ? d.strength[day] : []).forEach((s) => {
      const ex = allStrEx.find((e) => e.id === s.type) || REST_ST;
      strength += exBurn(ex, w, s.duration);
    });
  });
  const target = Math.max(1200, Math.round(tdee - 500 + cardio / 7 + strength / 7));
  return { tdee, target };
}

function TrainerDashboard({ profiles, loading, onSelect, onManageClients, onOpenClientPlan, onLinked, onCopyToLocal, onRename, onNewPlan, onNewSimulation, onConvertSimulation, onDeletePlan, meUid, meName, meRole, notifPrefs, onSetNotifPrefs }) {
  const [details, setDetails] = useState({}); // id -> { tdee, target }
  const [lastLog, setLastLog] = useState({}); // id -> "YYYY-MM-DD"
  const [sort, setSort] = useState("attention");
  const [clientSort, setClientSort] = useState("attention"); // sort for connected clients
  const [planFilter, setPlanFilter] = useState("all");       // all | plans | sims (merged local list)
  const [confirmDelFor, setConfirmDelFor] = useState(null);  // local-plan id awaiting delete confirm
  const [clients, setClients] = useState([]); // connected client accounts (live data)
  const [renamingId, setRenamingId] = useState(null);
  const [renameDraft, setRenameDraft] = useState("");
  // Connected-client management (moved here from the role panel).
  const [linkingFor, setLinkingFor] = useState(null);   // clientUid choosing a profile to link
  const [pendingLink, setPendingLink] = useState(null);  // { clientUid, localId, label } awaiting confirm
  const [confirmUnlink, setConfirmUnlink] = useState(null); // clientUid awaiting unlink confirm
  const [linkBusy, setLinkBusy] = useState(false);
  const [cMsg, setCMsg] = useState("");
  // Request composer (Session 19): clientUid currently composing, the free-text
  // custom draft, and a busy flag while a request write is in flight.
  const [composingFor, setComposingFor] = useState(null);
  const [reqDraft, setReqDraft] = useState("");
  const [reqBusy, setReqBusy] = useState(false);
  const [showDoneFor, setShowDoneFor] = useState(null); // clientUid whose done-list is expanded
  // Whether the sent to-do reminders show on the client cards — driven by the
  // shared notification prefs (master + per-type), lifted to App so the menu's
  // Notification Center and this inline toggle stay in sync (Session 76).
  const np = notifPrefs || { master: true, sentReminders: true };
  const reqsOn = np.master && np.sentReminders;
  const [convertSimFor, setConvertSimFor] = useState(null); // sim id awaiting convert confirm
  const [plansForClient, setPlansForClient] = useState(null);     // clientUid whose plans panel is open
  const [cpRenaming, setCpRenaming] = useState(null);             // {uid, planId} being renamed
  const [cpDraft, setCpDraft] = useState("");                     // client-plan rename draft
  const [cpDelFor, setCpDelFor] = useState(null);                 // {uid, planId} awaiting delete confirm

  // Load connected clients (real accounts) and read each one's SHARED plan
  // (caliq-self in their account) so the overview shows live data, not a copy.
  const loadClients = async () => {
    let cs = [];
    try { cs = await getMyClients(); } catch (e) { /* ignore */ }
    const rows = await Promise.all((cs || []).map(async (c) => {
      let data = null, lastLogDate = null;
      // A client may have several plans — show the ACTIVE one in the overview.
      const manifest = await readPlansManifest((k) => getForUser(c.uid, k));
      const activeId = manifest.active;
      try {
        const r = await getForUser(c.uid, planDataKey(activeId));
        if (r && r.value) data = (JSON.parse(r.value) || {}).data || {};
      } catch (e) { /* not linked / no plan yet */ }
      try {
        const res = await listForUser(c.uid, planLogPrefix(activeId));
        (res.keys || []).forEach((k) => {
          const d = k.slice(-10);
          if (!lastLogDate || d > lastLogDate) lastLogDate = d;
        });
      } catch (e) { /* ignore */ }
      const requests = await readRequestsFor(c.uid, getForUser);
      const cal = data ? computeClientCalories(data) : null;
      const nm = data && (data.firstName || data.lastName)
        ? `${data.firstName || ""} ${data.lastName || ""}`.trim()
        : (c.displayName || c.email || "Client");
      return { uid: c.uid, name: nm, hasPlan: !!data,
        weight: data ? data.weightLbs : "", goal: data ? data.goalWeight : "",
        target: cal ? cal.target : null, lastLogDate, requests,
        plans: manifest.plans, activePlanId: activeId };
    }));
    setClients(rows);
  };
  useEffect(() => { loadClients(); }, []);
  // Live-refresh the cards when a client (or the AI) logs/edits (see the hook).
  useClientLiveRefresh(clients, loadClients);

  // Link one of the trainer's local plans into a client's account (the local
  // copy is then removed by onLinked).
  const linkPlan = async (clientUid, localId) => {
    setLinkBusy(true); setCMsg("");
    try {
      let payload = JSON.stringify({ data: {}, step: 0 });
      try { const r = await window.storage.get(profileKey(localId)); if (r && r.value) payload = r.value; } catch {}
      const m = await readPlansManifest(clientGet(clientUid));
      await setForUser(clientUid, planDataKey(m.active), payload);
      if (onLinked) await onLinked(localId);
      setCMsg("Plan linked — it now lives in the client's account (local copy removed).");
      setLinkingFor(null); setPendingLink(null);
      await loadClients();
    } catch (e) { setCMsg((e && e.message) || "Couldn't link that plan."); }
    finally { setLinkBusy(false); }
  };
  const copyLocal = async (clientUid) => {
    setLinkBusy(true); setCMsg("");
    try { if (onCopyToLocal) await onCopyToLocal(clientUid); setCMsg("Saved a local copy to your files."); }
    catch (e) { setCMsg("Couldn't copy to a local file."); }
    finally { setLinkBusy(false); }
  };
  const unlinkPlan = async (clientUid) => {
    setLinkBusy(true); setCMsg("");
    try {
      if (onCopyToLocal) await onCopyToLocal(clientUid); // keep a local backup
      const m = await readPlansManifest(clientGet(clientUid));
      await deleteForUser(clientUid, planDataKey(m.active));
      setCMsg("Unlinked. A local copy was saved to your files.");
      setConfirmUnlink(null);
      await loadClients();
    } catch (e) { setCMsg((e && e.message) || "Couldn't unlink that plan."); }
    finally { setLinkBusy(false); }
  };

  // Send a request to a client: append to their caliq-requests and drop a note
  // into their activity history so the feed reflects it. (Session 19)
  const sendRequest = async (clientUid, item) => {
    setReqBusy(true); setCMsg("");
    try {
      const cur = await readRequestsFor(clientUid, getForUser);
      const now = Date.now();
      const req = { id: `r${now}${Math.floor(Math.random() * 1000)}`,
        fromUid: meUid, fromName: meName || "Your trainer",
        type: item.type || "custom", prompt: item.prompt,
        status: "open", createdAt: now, doneAt: null };
      await setForUser(clientUid, REQUEST_KEY, JSON.stringify([req, ...cur].slice(0, 100)));
      try {
        const hr = await getForUser(clientUid, "caliq-history-self");
        const hist = hr && hr.value ? (JSON.parse(hr.value) || []) : [];
        const ev = { id: `e${now}${Math.floor(Math.random() * 1000)}`, uid: meUid,
          role: meRole || "head_trainer", name: meName || "Your trainer",
          action: `sent a request: "${item.prompt}"`, ts: now };
        await setForUser(clientUid, "caliq-history-self", JSON.stringify([ev, ...hist].slice(0, 250)));
      } catch { /* history is best-effort */ }
      setComposingFor(null); setReqDraft("");
      setCMsg("Request sent.");
      await loadClients();
    } catch (e) { setCMsg((e && e.message) || "Couldn't send that request."); }
    finally { setReqBusy(false); }
  };
  // Remove a request the trainer sent (e.g. by mistake, or to clear a done one).
  const cancelRequest = async (clientUid, reqId) => {
    setReqBusy(true);
    try {
      const cur = await readRequestsFor(clientUid, getForUser);
      await setForUser(clientUid, REQUEST_KEY, JSON.stringify(cur.filter((r) => r.id !== reqId)));
      await loadClients();
    } catch { /* ignore */ }
    finally { setReqBusy(false); }
  };

  // Multiple plans per client (Session 21) — the trainer manages a client's plan
  // list (in the client's account) via the shared manifest helpers.
  const clientGet = (uid) => (k) => getForUser(uid, k);
  const clientSet = (uid) => (k, v) => setForUser(uid, k, v);
  const setActiveClientPlan = async (clientUid, planId) => {
    const m = await readPlansManifest(clientGet(clientUid));
    await writePlansManifest(clientSet(clientUid), { ...m, active: planId });
    await loadClients();
  };
  const newClientPlan = async (clientUid) => {
    const m = await readPlansManifest(clientGet(clientUid));
    const id = `p${Date.now()}`;
    const next = { active: id, plans: [...m.plans, { id, name: `Plan ${m.plans.length + 1}`, createdAt: Date.now() }] };
    await writePlansManifest(clientSet(clientUid), next);
    await setForUser(clientUid, planDataKey(id), JSON.stringify({ data: {}, step: 0 }));
    await loadClients();
    if (onOpenClientPlan) onOpenClientPlan(clientUid, id); // jump straight into the new plan
  };
  const renameClientPlan = async (clientUid, planId, name) => {
    const m = await readPlansManifest(clientGet(clientUid));
    await writePlansManifest(clientSet(clientUid),
      { ...m, plans: m.plans.map((p) => p.id === planId ? { ...p, name: name || p.name } : p) });
    await loadClients();
  };
  const deleteClientPlan = async (clientUid, planId) => {
    const m = await readPlansManifest(clientGet(clientUid));
    if (m.plans.length <= 1 || planId === "self") return;
    const remaining = m.plans.filter((p) => p.id !== planId);
    const nextActive = m.active === planId ? remaining[0].id : m.active;
    await writePlansManifest(clientSet(clientUid), { active: nextActive, plans: remaining });
    try { await deleteForUser(clientUid, planDataKey(planId)); } catch { /* ignore */ }
    try { await deleteForUser(clientUid, planHistoryKey(planId)); } catch { /* ignore */ }
    await loadClients();
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Per-client calorie target (needs each client's full profile data).
      const dmap = {};
      await Promise.all(profiles.map(async (p) => {
        try {
          const r = await window.storage.get(`caliq-${p.id}`);
          if (r && r.value) {
            const d = (JSON.parse(r.value) || {}).data || {};
            const c = computeClientCalories(d) || {};
            // Progress baseline: earliest check-in that recorded a weight. The
            // bar only fills once there's real tracking to measure against.
            const weighIns = (d.checkIns || []).filter((x) => x.weight)
              .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
            const start = weighIns.length ? Number(weighIns[0].weight) : null;
            const cur = Number(d.weightLbs), goal = Number(d.goalWeight);
            let pct = null;
            if (start && goal && cur && start > goal) {
              pct = Math.max(0, Math.min(100, Math.round(((start - cur) / (start - goal)) * 100)));
            }
            dmap[p.id] = { target: c.target != null ? c.target : null, pct };
          }
        } catch (e) { /* ignore */ }
      }));
      if (!cancelled) setDetails(dmap);
      // Most recent daily log per client — a single read of the kv index.
      try {
        const res = await window.storage.list("caliq-log-");
        const latest = {};
        (res.keys || []).forEach((k) => {
          const rest = k.slice("caliq-log-".length); // "{id}-YYYY-MM-DD"
          const date = rest.slice(-10);
          const id = rest.slice(0, -11);
          if (id && (!latest[id] || date > latest[id])) latest[id] = date;
        });
        if (!cancelled) setLastLog(latest);
      } catch (e) { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [profiles]);

  const statusOf = (p) => {
    if (p.stepLabel === "Results") return { label: "Plan complete", color: "#39d98a" };
    if (p.name || p.weight) return { label: "In progress", color: "#f0a020" };
    return { label: "Needs setup", color: "var(--muted)" };
  };
  const logTs = (p) => (lastLog[p.id] ? new Date(lastLog[p.id] + "T00:00:00").getTime() : 0);
  const lastActiveTs = (p) => Math.max(logTs(p), p.lastSaved || 0);
  const daysSinceLog = (p) => {
    if (!lastLog[p.id]) return null;
    return Math.floor((Date.now() - logTs(p)) / 86400000);
  };

  // Connected-client sort (real clients to keep track of).
  const clientActiveTs = (c) => (c.lastLogDate ? new Date(c.lastLogDate + "T00:00:00").getTime() : 0);
  const sortedClients = [...clients].sort((a, b) => {
    if (clientSort === "name") return (a.name || "").localeCompare(b.name || "");
    if (clientSort === "recent") return clientActiveTs(b) - clientActiveTs(a);
    return clientActiveTs(a) - clientActiveTs(b); // "attention": quietest first
  });

  // Merged local plans: regular plans + simulations in one sortable, filterable
  // list (a simulation is just a local plan with isSimulation:true).
  const realPlans = profiles.filter((p) => !p.isSimulation);
  const sims = profiles.filter((p) => p.isSimulation);
  const sorted = [...profiles].sort((a, b) => {
    if (sort === "name") return (a.name || "").localeCompare(b.name || "");
    if (sort === "recent") return lastActiveTs(b) - lastActiveTs(a);
    return lastActiveTs(a) - lastActiveTs(b); // "attention": quietest first
  });
  const filteredLocal = sorted.filter((p) =>
    planFilter === "plans" ? !p.isSimulation : planFilter === "sims" ? p.isSimulation : true);
  const complete = realPlans.filter((p) => p.stepLabel === "Results").length;
  const activeWeek = realPlans.filter((p) => Date.now() - lastActiveTs(p) < 7 * 86400000).length;

  // Tailwind class strings (Session 28 redesign — brand theme via data-theme="pro").
  const cardCls = "bg-surface border border-border rounded-card p-5 mb-4";
  const sectionTitleCls = "font-display text-lg tracking-wider text-primary";
  const subCls = "text-sm text-muted";
  const mBtnCls = "px-2.5 py-2 rounded-md text-xs font-semibold border border-border bg-transparent text-fg cursor-pointer text-left whitespace-nowrap disabled:opacity-55";
  const mPrimaryCls = "px-2.5 py-2 rounded-md text-xs font-bold border-none bg-primaryfill text-primaryfg cursor-pointer whitespace-nowrap disabled:opacity-55";
  const dangerBtnCls = "px-2.5 py-2 rounded-md text-xs font-bold border-none bg-danger text-white cursor-pointer whitespace-nowrap disabled:opacity-55";
  const dangerGhostCls = "px-2.5 py-2 rounded-md text-xs font-semibold border border-[rgba(248,113,113,.4)] bg-transparent text-danger cursor-pointer whitespace-nowrap disabled:opacity-55";
  const inputCls = "flex-1 min-w-0 box-border rounded-md border border-border bg-surface2 text-fg px-2.5 py-1.5 text-sm outline-none placeholder:text-muted";
  // Filter/sort chips: highlighted via border when active. `purple` variant for sim filter.
  const chip = (active) => `px-2.5 py-1.5 text-xs rounded-md cursor-pointer border ${active ? "border-primary bg-surface2 text-fg" : "border-border bg-transparent text-fg"}`;
  const purpleChip = (active) => `px-2.5 py-1.5 text-xs rounded-md cursor-pointer border ${active ? "border-[#b57bff] bg-[rgba(181,123,255,.12)] text-fg" : "border-border bg-transparent text-fg"}`;

  return (
    <div data-theme="pro" className="prof-screen page-transition min-h-screen bg-bg text-fg" style={{ fontFamily: "var(--font-sans)" }}>
      <style>{css}</style>
      {/* Slim brand header — min-height clears the fixed hamburger (App chrome). */}
      <div className="flex items-center justify-center min-h-[54px] px-14 border-b border-border">
        <BrandLogo />
      </div>
      <div className="max-w-[640px] mx-auto px-4 pt-6 pb-28">
        {clients.length > 0 && (
          <div className={cardCls}>
            <div className={`${sectionTitleCls} flex items-center gap-2`}><Icon name="link" size={19} color="var(--accent)" />Your Connected Clients</div>
            <div className={`${subCls} mt-1 mb-2`}>
              Live data from each client's shared plan. Tap a card to open it.
            </div>
            {/* Toggle the sent to-do reminders on the cards (shared notification
                prefs; also in ≡ menu → Notifications). Re-enabling clears master. */}
            <button onClick={() => onSetNotifPrefs(reqsOn ? { sentReminders: false } : { master: true, sentReminders: true })}
              title={reqsOn ? "Hide the to-do reminders on each client card" : "Show the to-do reminders on each client card"}
              className="mb-3 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-bold cursor-pointer border border-border bg-transparent text-muted hover:text-fg">
              <Icon name="bell" size={14} />{reqsOn ? "To-do reminders: On" : "To-do reminders: Off"}
            </button>
            {clients.length > 1 && (
              <div className="flex gap-1.5 mb-3">
                {[["attention", "Needs attention"], ["recent", "Last active"], ["name", "Name"]].map(([k, lbl]) => (
                  <button key={k} onClick={() => setClientSort(k)} className={chip(clientSort === k)}>
                    {lbl}
                  </button>
                ))}
              </div>
            )}
            <div className="flex flex-col gap-2.5">
              {sortedClients.map((c) => {
                const w = Number(c.weight), g = Number(c.goal);
                const toGo = (w && g) ? Math.round((w - g) * 10) / 10 : null;
                const ds = c.lastLogDate
                  ? Math.floor((Date.now() - new Date(c.lastLogDate + "T00:00:00").getTime()) / 86400000)
                  : null;
                const reqs = c.requests || [];
                const openReqs = reqs.filter((r) => r.status !== "done");
                const doneReqs = reqs.filter((r) => r.status === "done");
                return (
                  <div key={c.uid} className="p-3.5 rounded-[10px] bg-surface2 border border-primary">
                    {/* Tapping the card body opens the client's active plan (buttons below stay separate). */}
                    <div onClick={() => { if (c.hasPlan && onOpenClientPlan) onOpenClientPlan(c.uid); }}
                      className={c.hasPlan ? "cursor-pointer" : "cursor-default"}>
                      <div className="flex justify-between items-center mb-2">
                        <span className="font-bold text-[.95rem]">{c.name}</span>
                        <span className="flex gap-2 items-center">
                          {reqsOn && openReqs.length > 0 && (
                            <span className="text-[.68rem] font-bold text-primaryfg bg-primaryfill rounded-[10px] px-2 py-0.5 inline-flex items-center gap-1">
                              <Icon name="inbox" size={11} />{openReqs.length} open
                            </span>
                          )}
                          <span className="text-[.7rem] text-primary font-bold inline-flex items-center gap-1"><Icon name="link" size={12} />Shared</span>
                        </span>
                      </div>
                      {c.hasPlan ? (
                        <>
                          <div className="text-[.95rem] text-fg font-semibold flex items-center gap-1.5">
                            <Icon name="scale" size={17} color="var(--muted)" />
                            <span>{c.weight ? `${c.weight} lbs` : "—"}{c.goal ? ` → ${c.goal} lbs` : ""}
                            {toGo !== null && toGo > 0
                              ? ` · ${toGo} lbs to go`
                              : (toGo !== null && toGo <= 0 ? " · at goal" : "")}</span>
                          </div>
                          <div className="flex flex-wrap gap-3.5 text-sm text-muted mt-2">
                            <span className="inline-flex items-center gap-1.5"><Icon name="flame" size={15} />{c.target != null ? `${c.target.toLocaleString()} cal/day` : "—"}</span>
                            <span className="inline-flex items-center gap-1.5"><Icon name="clock" size={15} />{ds === null ? "no logs yet" : ds === 0 ? "active today" : ds === 1 ? "1 day ago" : `${ds} days ago`}</span>
                          </div>
                          <div className="text-[.72rem] text-primary mt-2">Tap to open plan →</div>
                        </>
                      ) : (
                        <div className="text-[.82rem] text-muted">
                          No plan linked yet — use "Link a profile" below.
                        </div>
                      )}
                    </div>

                    {/* Management: link / open / copy / unlink */}
                    {confirmUnlink === c.uid ? (
                      <div className="mt-2.5">
                        <div className="text-[.78rem] text-fg mb-2">
                          Unlink <strong>{c.name}</strong>'s plan? We'll save a local copy to your files
                          first, then remove it from their account.
                        </div>
                        <div className="flex gap-2">
                          <button className={dangerBtnCls} disabled={linkBusy}
                            onClick={() => unlinkPlan(c.uid)}>{linkBusy ? "…" : "Yes, unlink"}</button>
                          <button className={mBtnCls} disabled={linkBusy} onClick={() => setConfirmUnlink(null)}>Cancel</button>
                        </div>
                      </div>
                    ) : pendingLink && pendingLink.clientUid === c.uid ? (
                      <div className="mt-2.5">
                        <div className="text-[.78rem] text-fg mb-2">
                          Link <strong>{pendingLink.label}</strong> to <strong>{c.name}</strong>?
                          {c.hasPlan ? " This replaces their current linked plan." : ""} The local copy will be removed.
                        </div>
                        <div className="flex gap-2">
                          <button className={mPrimaryCls} disabled={linkBusy}
                            onClick={() => linkPlan(c.uid, pendingLink.localId)}>{linkBusy ? "…" : "Confirm"}</button>
                          <button className={mBtnCls} disabled={linkBusy} onClick={() => setPendingLink(null)}>Cancel</button>
                        </div>
                      </div>
                    ) : linkingFor === c.uid ? (
                      <div className="mt-2.5">
                        <div className={`${subCls} mb-1`}>
                          Pick a local plan to link to this client:
                        </div>
                        <div className="flex flex-col gap-1 max-h-[170px] overflow-auto">
                          {profiles.length === 0 ? (
                            <div className="text-[.78rem] text-muted">
                              No local plans yet — create one under "All clients" first.
                            </div>
                          ) : profiles.map((lp) => (
                            <button key={lp.id} className={mBtnCls} disabled={linkBusy}
                              onClick={() => setPendingLink({ clientUid: c.uid, localId: lp.id, label: lp.customName || lp.name || "Unnamed plan" })}>
                              {lp.customName || lp.name || "Unnamed plan"}{lp.weight ? ` · ${lp.weight} lbs` : ""}
                            </button>
                          ))}
                        </div>
                        <button className={`${mBtnCls} mt-1.5`} disabled={linkBusy} onClick={() => setLinkingFor(null)}>Cancel</button>
                      </div>
                    ) : (
                      <div className="flex gap-2 mt-2.5 flex-wrap">
                        <button className={`${mPrimaryCls} inline-flex items-center gap-1.5`} onClick={() => { setComposingFor(composingFor === c.uid ? null : c.uid); setReqDraft(""); }}>
                          <Icon name="mail" size={16} />Send request
                        </button>
                        {c.hasPlan && (
                          <button className={mBtnCls} onClick={() => onOpenClientPlan && onOpenClientPlan(c.uid)}>Open plan</button>
                        )}
                        <button className={`${mBtnCls} inline-flex items-center gap-1.5`} onClick={() => setPlansForClient(plansForClient === c.uid ? null : c.uid)}>
                          <Icon name="folder" size={16} color="var(--accent)" />Plans{(c.plans && c.plans.length > 1) ? ` (${c.plans.length})` : ""}
                        </button>
                        <button className={mBtnCls} onClick={() => setLinkingFor(c.uid)}>
                          {c.hasPlan ? "Re-link a different plan" : "Link a profile"}
                        </button>
                        {c.hasPlan && (
                          <button className={mBtnCls} disabled={linkBusy} onClick={() => copyLocal(c.uid)}>Copy to local file</button>
                        )}
                        {c.hasPlan && (
                          <button className={dangerGhostCls} onClick={() => setConfirmUnlink(c.uid)}>Unlink</button>
                        )}
                      </div>
                    )}

                    {/* Request composer (Session 19) */}
                    {composingFor === c.uid && (
                      <div className="mt-2.5 p-3 rounded-lg bg-bg border border-border">
                        <div className={`${subCls} mb-1.5`}>
                          Quick requests — tap to send:
                        </div>
                        <div className="flex flex-wrap gap-1.5 mb-2.5">
                          {REQUEST_TEMPLATES.map((t) => (
                            <button key={t.type} className={mBtnCls} disabled={reqBusy}
                              onClick={() => sendRequest(c.uid, t)}>
                              {t.icon} {t.label}
                            </button>
                          ))}
                        </div>
                        <div className={`${subCls} mb-1`}>
                          Or write a custom message:
                        </div>
                        <textarea value={reqDraft} onChange={(e) => setReqDraft(e.target.value)}
                          placeholder="e.g. Send me a progress photo this week"
                          rows={2}
                          className="w-full box-border rounded-md resize-y border border-border bg-surface text-fg px-2.5 py-2 text-[.82rem] outline-none placeholder:text-muted"
                          style={{ fontFamily: "inherit" }} />
                        <div className="flex gap-2 mt-2">
                          <button className={mPrimaryCls}
                            disabled={!reqDraft.trim() || reqBusy}
                            onClick={() => sendRequest(c.uid, { type: "custom", prompt: reqDraft.trim() })}>
                            {reqBusy ? "Sending…" : "Send custom"}
                          </button>
                          <button className={mBtnCls} disabled={reqBusy} onClick={() => { setComposingFor(null); setReqDraft(""); }}>Cancel</button>
                        </div>
                      </div>
                    )}

                    {/* Plans manager (Session 21) — switch active, open, rename, delete, add. */}
                    {plansForClient === c.uid && (
                      <div className="mt-2.5 p-3 rounded-lg bg-bg border border-border">
                        <div className={`${subCls} mb-2`}>
                          {c.name}'s plans — ● is active (what the client sees on their home).
                        </div>
                        <div className="flex flex-col gap-1.5">
                          {(c.plans || []).map((p) => {
                            const isActive = p.id === c.activePlanId;
                            const renaming = cpRenaming && cpRenaming.uid === c.uid && cpRenaming.planId === p.id;
                            const delConfirm = cpDelFor && cpDelFor.uid === c.uid && cpDelFor.planId === p.id;
                            return (
                              <div key={p.id} className={`flex items-center gap-1.5 px-2 py-1.5 rounded-[7px] ${isActive ? "bg-[rgba(8,220,224,.08)]" : "bg-surface2"}`}>
                                {renaming ? (
                                  <>
                                    <input autoFocus value={cpDraft} onChange={(e) => setCpDraft(e.target.value)}
                                      onKeyDown={(e) => { if (e.key === "Enter") { renameClientPlan(c.uid, p.id, cpDraft.trim()); setCpRenaming(null); } }}
                                      className={inputCls} />
                                    <button className={mPrimaryCls} onClick={() => { renameClientPlan(c.uid, p.id, cpDraft.trim()); setCpRenaming(null); }}>Save</button>
                                  </>
                                ) : delConfirm ? (
                                  <>
                                    <span className="flex-1 text-[.82rem] text-fg">Delete “{p.name}”?</span>
                                    <button className={dangerBtnCls} onClick={() => { deleteClientPlan(c.uid, p.id); setCpDelFor(null); }}>Delete</button>
                                    <button className={mBtnCls} onClick={() => setCpDelFor(null)}>Cancel</button>
                                  </>
                                ) : (
                                  <>
                                    <span className={`flex-1 text-[.85rem] text-fg ${isActive ? "font-bold" : "font-normal"}`}>
                                      {isActive ? "● " : "○ "}{p.name}
                                    </span>
                                    {!isActive && (
                                      <button className={mBtnCls} onClick={() => setActiveClientPlan(c.uid, p.id)}>Make active</button>
                                    )}
                                    <button className={mBtnCls} onClick={() => onOpenClientPlan && onOpenClientPlan(c.uid, p.id)}>Open</button>
                                    <button onClick={() => { setCpDraft(p.name); setCpRenaming({ uid: c.uid, planId: p.id }); }} title="Rename"
                                      className="border-none bg-transparent text-muted cursor-pointer text-[.85rem]">✎</button>
                                    {p.id !== "self" && (c.plans || []).length > 1 && (
                                      <button onClick={() => setCpDelFor({ uid: c.uid, planId: p.id })} title="Delete"
                                        className="border-none bg-transparent text-danger cursor-pointer text-[.85rem]">✕</button>
                                    )}
                                  </>
                                )}
                              </div>
                            );
                          })}
                        </div>
                        <button className={`${mBtnCls} mt-2 border-dashed text-primary`}
                          onClick={() => newClientPlan(c.uid)}>+ New plan for {c.name}</button>
                      </div>
                    )}

                    {/* Sent requests — open (with cancel) + collapsible done list.
                        Hidden entirely when the trainer turns to-do reminders off. */}
                    {reqsOn && (openReqs.length > 0 || doneReqs.length > 0) && (
                      <div className="mt-2.5 flex flex-col gap-1">
                        {openReqs.map((r) => (
                          <div key={r.id} className="flex justify-between items-start gap-2 text-sm px-2.5 py-1.5 rounded-md bg-[rgba(8,220,224,.06)] border border-[rgba(8,220,224,.18)]">
                            <span className="text-fg">📬 {r.prompt}
                              {r.createdAt ? <span className="block text-[.66rem] opacity-70 mt-0.5">Sent {fmtStamp(r.createdAt)}</span> : null}
                            </span>
                            <button onClick={() => cancelRequest(c.uid, r.id)} disabled={reqBusy} title="Cancel this request"
                              className="bg-transparent border-none text-muted cursor-pointer text-[.9rem]">✕</button>
                          </div>
                        ))}
                        {doneReqs.length > 0 && (
                          <>
                            <button onClick={() => setShowDoneFor(showDoneFor === c.uid ? null : c.uid)}
                              className="bg-transparent border-none text-muted cursor-pointer text-[.74rem] text-left py-0.5">
                              {showDoneFor === c.uid ? "▾" : "▸"} {doneReqs.length} completed
                            </button>
                            {showDoneFor === c.uid && doneReqs.map((r) => (
                              <div key={r.id} className="flex justify-between items-start gap-2 text-[.78rem] px-2.5 py-1 rounded-md bg-surface2">
                                <span className="text-muted">✓ {r.prompt}
                                  {r.doneAt ? <span className="block text-[.66rem] opacity-70 mt-0.5">Completed {fmtStamp(r.doneAt)}</span> : null}
                                </span>
                                <button onClick={() => cancelRequest(c.uid, r.id)} disabled={reqBusy} title="Remove"
                                  className="bg-transparent border-none text-muted cursor-pointer text-[.9rem]">✕</button>
                              </div>
                            ))}
                          </>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
              {cMsg && <div className="text-sm text-muted mt-1">{cMsg}</div>}
            </div>
          </div>
        )}

        <div className={cardCls}>
          <div className={`${sectionTitleCls} whitespace-nowrap flex items-center gap-2`}><Icon name="clipboard" size={18} color="var(--accent)" />Local Plans</div>
          <div className="flex gap-1.5 mt-2">
            <button onClick={onNewPlan} className={mPrimaryCls}>+ Plan</button>
            <button onClick={onNewSimulation}
              className="px-2.5 py-2 rounded-md text-xs font-bold border border-[#b57bff] bg-transparent text-[#b57bff] cursor-pointer whitespace-nowrap">
              + 🧪 Simulation
            </button>
          </div>
          <div className={`${subCls} mt-1.5 mb-1.5`}>
            📄 Plans not connected to a client login — templates, backups, and 🧪 simulations (sandbox
            what-if projections). Connected clients are under “Your clients” above.
          </div>
          <div className={subCls}>
            {loading ? "Loading…"
              : `${realPlans.length} plan${realPlans.length !== 1 ? "s" : ""} · ${sims.length} simulation${sims.length !== 1 ? "s" : ""} · ${complete} complete`}
          </div>

          {!loading && profiles.length > 0 && (
            <>
              {/* Filter: all / plans / simulations */}
              <div className="flex gap-1.5 mt-3 mb-1.5">
                {[["all", `All (${profiles.length})`], ["plans", `Plans (${realPlans.length})`], ["sims", `🧪 Sims (${sims.length})`]].map(([k, lbl]) => (
                  <button key={k} onClick={() => setPlanFilter(k)} className={purpleChip(planFilter === k)}>
                    {lbl}
                  </button>
                ))}
              </div>
              {/* Sort */}
              <div className="flex gap-1.5 mb-1">
                {[["attention", "Needs attention"], ["recent", "Last active"], ["name", "Name"]].map(([k, lbl]) => (
                  <button key={k} onClick={() => setSort(k)} className={chip(sort === k)}>
                    {lbl}
                  </button>
                ))}
              </div>
            </>
          )}

          {loading ? null : profiles.length === 0 ? (
            <div className="text-muted text-[.85rem] py-2">
              No local plans yet — tap “+ Plan” to make one, or “+ 🧪 Simulation” for a what-if projection.
            </div>
          ) : filteredLocal.length === 0 ? (
            <div className="text-muted text-[.85rem] py-2">Nothing in this filter.</div>
          ) : (
            <div className="flex flex-col gap-2.5 mt-1.5">
              {filteredLocal.map((p) => {
                const sim = !!p.isSimulation;
                const st = statusOf(p);
                const det = details[p.id];
                const ds = daysSinceLog(p);
                const w = Number(p.weight), g = Number(p.goal);
                const toGo = (w && g) ? Math.round((w - g) * 10) / 10 : null;
                const pct = det && det.pct != null ? det.pct : null;
                return (
                  <div key={p.id} onClick={() => onSelect(p.id)}
                    className={`cursor-pointer p-3.5 rounded-[10px] ${sim ? "bg-[rgba(181,123,255,.06)] border border-[rgba(181,123,255,.35)]" : "bg-surface2 border border-border"}`}>
                    {renamingId === p.id ? (
                      <div onClick={(e) => e.stopPropagation()} className="flex gap-1.5 mb-2">
                        <input autoFocus value={renameDraft} onChange={(e) => setRenameDraft(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter") { onRename && onRename(p.id, renameDraft); setRenamingId(null); } }}
                          className={inputCls} />
                        <button onClick={() => { onRename && onRename(p.id, renameDraft); setRenamingId(null); }}
                          className={mPrimaryCls}>Save</button>
                        <button onClick={() => setRenamingId(null)} className={mBtnCls}>✕</button>
                      </div>
                    ) : (
                      <div className="flex justify-between items-center mb-2">
                        <span className="font-bold text-[.95rem]">
                          {p.customName || p.name || (sim ? "Untitled simulation" : "Unnamed client")}
                          {onRename && (
                            <button onClick={(e) => { e.stopPropagation(); setRenameDraft(p.customName || p.name || ""); setRenamingId(p.id); }}
                              title="Rename" className="border-none bg-transparent text-muted cursor-pointer text-[.85rem] ml-1.5">✎</button>
                          )}
                        </span>
                        {sim
                          ? <span className="text-[.66rem] font-bold text-[#b57bff]">🧪 SANDBOX</span>
                          : <span className="text-[.72rem] font-semibold" style={{ color: st.color }}>{st.label}</span>}
                      </div>
                    )}
                    {/* Weight → goal: larger and brighter so it's easy to read */}
                    <div className="text-[.95rem] text-fg font-semibold flex items-center gap-1.5">
                      <Icon name="scale" size={17} color="var(--muted)" />
                      <span>{p.weight ? `${p.weight} lbs` : "—"}{p.goal ? ` → ${p.goal} lbs` : ""}
                      {toGo !== null && toGo > 0
                        ? ` · ${toGo} lbs to go`
                        : (toGo !== null && toGo <= 0 ? " · at goal" : "")}</span>
                    </div>
                    {/* Progress + activity meta — only for real plans (sims aren't tracked) */}
                    {!sim && pct !== null && (
                      <div className="mt-2 mb-0.5">
                        <div className="h-[7px] rounded overflow-hidden bg-surface">
                          <div className="h-full rounded bg-primaryfill" style={{ width: `${pct}%` }} />
                        </div>
                        <div className="text-[.68rem] text-muted mt-1">{pct}% to goal</div>
                      </div>
                    )}
                    {!sim && (
                      <div className="flex flex-wrap gap-3.5 text-sm text-muted mt-2">
                        <span className="inline-flex items-center gap-1.5"><Icon name="flame" size={15} />{det && det.target != null ? `${det.target.toLocaleString()} cal/day` : "—"}</span>
                        <span className="inline-flex items-center gap-1.5"><Icon name="clock" size={15} />{ds === null ? "no logs yet" : ds === 0 ? "active today" : ds === 1 ? "1 day ago" : `${ds} days ago`}</span>
                      </div>
                    )}
                    {/* Actions: convert (sims) + delete (all) */}
                    <div className="flex flex-wrap gap-2 mt-2.5" onClick={(e) => e.stopPropagation()}>
                      {sim && (convertSimFor === p.id ? (
                        <span className="inline-flex gap-1.5 items-center">
                          <button onClick={() => { onConvertSimulation(p.id); setConvertSimFor(null); }}
                            className={mPrimaryCls}>Confirm — make it a client plan</button>
                          <button onClick={() => setConvertSimFor(null)} className={mBtnCls}>Cancel</button>
                        </span>
                      ) : (
                        <button onClick={() => setConvertSimFor(p.id)} className={mBtnCls}>
                          Convert to client plan →
                        </button>
                      ))}
                      {confirmDelFor === p.id ? (
                        <span className="inline-flex gap-1.5 items-center">
                          <button onClick={() => { onDeletePlan && onDeletePlan(p.id); setConfirmDelFor(null); }}
                            className={dangerBtnCls}>Confirm delete</button>
                          <button onClick={() => setConfirmDelFor(null)} className={mBtnCls}>Cancel</button>
                        </span>
                      ) : (
                        <button onClick={() => setConfirmDelFor(p.id)} className={dangerGhostCls}>Delete</button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Trainer analytics dashboard (Session 34) ───────────────────────────────
// A coaching command center, distinct from the home (connected clients + local
// plans) and the All-clients manager. Reads each connected client's ACTIVE plan
// + logs + requests and surfaces what a coach needs at a glance: who's active
// this week, who needs attention (no logs in N days), all open requests across
// clients, and aggregate progress (lbs lost, who's on track). Tap any client to
// open their plan. Built entirely on existing per-client data; no Blaze.
const ATTENTION_DAYS = 3; // no logs in this many days → "needs attention"

function TrainerAnalytics({ onOpenClientPlan, onGoClients, meUid, meName, meRole }) {
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [nudged, setNudged] = useState({}); // clientUid -> true once a nudge is sent (transient ✓)
  const [nudgeBusy, setNudgeBusy] = useState(null); // clientUid currently sending
  const [attnDays, setAttnDays] = useState(ATTENTION_DAYS); // coach-configurable "needs attention" threshold (persisted)

  // Persist the attention threshold to the trainer's own account so it sticks
  // between visits (their own window.storage — no cross-account access needed).
  const saveAttn = async (d) => {
    setAttnDays(d);
    try {
      let p = {};
      try { const pr = await window.storage.get("caliq-coach-prefs"); p = JSON.parse(pr.value || "{}"); } catch { /* none yet */ }
      await window.storage.set("caliq-coach-prefs", JSON.stringify({ ...p, attnDays: d }));
    } catch { /* best-effort */ }
  };

  // One-tap "nudge": send a "log today's food" request straight to a client from
  // the needs-attention list (same write path as TrainerDashboard.sendRequest).
  const sendNudge = async (clientUid) => {
    setNudgeBusy(clientUid);
    try {
      const cur = await readRequestsFor(clientUid, getForUser);
      const now = Date.now();
      const prompt = "Please log today's food — checking in on your progress.";
      const req = { id: `r${now}${Math.floor(Math.random() * 1000)}`, fromUid: meUid,
        fromName: meName || "Your trainer", type: "log_food", prompt, status: "open", createdAt: now, doneAt: null };
      await setForUser(clientUid, REQUEST_KEY, JSON.stringify([req, ...cur].slice(0, 100)));
      try {
        const hr = await getForUser(clientUid, "caliq-history-self");
        const hist = hr && hr.value ? (JSON.parse(hr.value) || []) : [];
        const ev = { id: `e${now}${Math.floor(Math.random() * 1000)}`, uid: meUid,
          role: meRole || "head_trainer", name: meName || "Your trainer", action: `sent a request: "${prompt}"`, ts: now };
        await setForUser(clientUid, "caliq-history-self", JSON.stringify([ev, ...hist].slice(0, 250)));
      } catch { /* history best-effort */ }
      setNudged((n) => ({ ...n, [clientUid]: true }));
      await load();
    } catch { /* ignore */ }
    finally { setNudgeBusy(null); }
  };

  const load = async () => {
    setLoading(true);
    try { const pr = await window.storage.get("caliq-coach-prefs"); const p = JSON.parse(pr.value || "{}"); if (p.attnDays) setAttnDays(p.attnDays); } catch { /* no prefs saved yet */ }
    let cs = [];
    try { cs = await getMyClients(); } catch { /* ignore */ }
    const rows = await Promise.all((cs || []).map(async (c) => {
      let data = null, dates = [];
      const m = await readPlansManifest((k) => getForUser(c.uid, k));
      const activeId = m.active;
      try { const r = await getForUser(c.uid, planDataKey(activeId)); if (r && r.value) data = (JSON.parse(r.value) || {}).data || {}; } catch { /* not linked / no plan */ }
      try { const res = await listForUser(c.uid, planLogPrefix(activeId)); dates = (res.keys || []).map((k) => k.slice(-10)); } catch { /* ignore */ }
      let requests = [];
      try { requests = await readRequestsFor(c.uid, getForUser); } catch { /* ignore */ }
      const openReqs = (requests || []).filter((r) => r.status !== "done");
      const checkIns = (data && data.checkIns) || [];
      const weighIns = checkIns.filter((x) => x.weight).sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
      const cur = data && data.weightLbs ? Number(data.weightLbs) : null;
      const goal = data && data.goalWeight ? Number(data.goalWeight) : null;
      const start = weighIns.length ? Number(weighIns[0].weight)
        : (data && data.startWeightLbs ? Number(data.startWeightLbs) : null);
      const lbsLost = (start && cur) ? Math.round((start - cur) * 10) / 10 : null;
      // Week-over-week weight change: latest weigh-in vs the most recent weigh-in
      // at least 7 days older (the trailing-7-day delta). Negative = lost weight.
      let wowDelta = null;
      if (weighIns.length >= 2) {
        const latest = weighIns[weighIns.length - 1];
        const cutoff = (latest.timestamp || 0) - 7 * 86400000;
        const prior = [...weighIns].reverse().find((w) => (w.timestamp || 0) <= cutoff);
        if (prior) wowDelta = Math.round((Number(latest.weight) - Number(prior.weight)) * 10) / 10;
      }
      const trend = weightTrend(checkIns);
      const onTrack = (trend && cur && goal && goal !== cur) ? (etaWeeks(cur, goal, trend.ratePerWeek) != null) : null;
      const lastLogDate = dates.length ? [...dates].sort().slice(-1)[0] : null;
      const daysSince = lastLogDate
        ? Math.floor((Date.now() - new Date(lastLogDate + "T00:00:00").getTime()) / 86400000) : null;
      const activeThisWeek = dates.some((d) => (Date.now() - new Date(d + "T00:00:00").getTime()) / 86400000 <= 7);
      // 7-day logging-consistency strip: index 0 = 6 days ago … index 6 = today.
      // Keys are matched in the same (local) scheme the logs are stored under.
      const last7 = Array.from({ length: 7 }, (_, i) => {
        const d = new Date(); d.setDate(d.getDate() - (6 - i));
        return dates.includes(ymdLocal(d));
      });
      const nm = data && (data.firstName || data.lastName)
        ? `${data.firstName || ""} ${data.lastName || ""}`.trim()
        : (c.displayName || c.email || "Client");
      return { uid: c.uid, name: nm, hasPlan: !!data, cur, goal, start, lbsLost, onTrack,
        ratePerWeek: trend ? trend.ratePerWeek : null, wowDelta,
        lastLogDate, daysSince, activeThisWeek, openReqs, last7, activePlanId: activeId };
    }));
    setClients(rows);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);
  // Live-refresh the coaching dashboard when a client (or the AI) logs/edits.
  useClientLiveRefresh(clients, load);

  // Aggregates
  const total = clients.length;
  const activeWeek = clients.filter((c) => c.activeThisWeek).length;
  const needsAttention = clients.filter((c) => c.hasPlan && (c.daysSince === null || c.daysSince >= attnDays))
    .sort((a, b) => (b.daysSince === null ? 1e9 : b.daysSince) - (a.daysSince === null ? 1e9 : a.daysSince));
  const openReqRows = clients.flatMap((c) => c.openReqs.map((r) => ({ ...r, clientUid: c.uid, clientName: c.name })));
  const totalLbsLost = Math.round(clients.reduce((s, c) => s + (c.lbsLost && c.lbsLost > 0 ? c.lbsLost : 0), 0) * 10) / 10;
  const onTrackCount = clients.filter((c) => c.onTrack === true).length;
  const withProgress = clients.filter((c) => c.lbsLost != null).sort((a, b) => (b.lbsLost || 0) - (a.lbsLost || 0));
  // Roster for the "This week" card: every client with a plan, least-active first.
  const roster = clients.filter((c) => c.hasPlan)
    .map((c) => ({ ...c, logged7: c.last7.filter(Boolean).length }))
    .sort((a, b) => a.logged7 - b.logged7);

  // Brand class strings (match TrainerDashboard)
  const cardCls = "bg-surface border border-border rounded-card p-5 mb-4";
  const titleCls = "font-display text-lg tracking-wider text-primary mb-1";
  const subCls = "text-sm text-muted";
  const rowCls = "flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg bg-surface2 cursor-pointer";

  const lastActiveLabel = (c) => c.daysSince === null ? "no logs yet"
    : c.daysSince === 0 ? "active today" : c.daysSince === 1 ? "1 day ago" : `${c.daysSince} days ago`;

  const Tile = ({ value, label, color }) => (
    <div className="bg-surface2 border border-border rounded-lg py-3 px-2 text-center">
      <div className={`font-display text-2xl ${color}`}>{value}</div>
      <div className="text-[.62rem] uppercase tracking-wide text-muted mt-0.5 leading-tight">{label}</div>
    </div>
  );

  // 7-day logging-consistency strip — one dot per day (6 days ago → today),
  // filled green when the client logged that day. The last dot (today) is ringed.
  const Last7 = ({ days }) => (
    <span className="inline-flex gap-[3px] items-center" title={`Logged ${days.filter(Boolean).length} of the last 7 days`}>
      {days.map((on, i) => (
        <span key={i}
          className={`w-2 h-2 rounded-full ${on ? "bg-success" : "bg-border"} ${i === 6 ? "ring-1 ring-muted" : ""}`} />
      ))}
    </span>
  );

  return (
    <div data-theme="pro" className="prof-screen page-transition min-h-screen bg-bg text-fg" style={{ fontFamily: "var(--font-sans)" }}>
      <style>{css}</style>
      <div className="flex items-center justify-center min-h-[54px] px-14 border-b border-border">
        <BrandLogo />
      </div>
      <div className="max-w-[640px] mx-auto px-4 pt-6 pb-28">
        <div className="text-2xl font-extrabold tracking-tight mb-1 flex items-center gap-2"><Icon name="dashboard" size={22} color="var(--accent)" />Coaching Dashboard</div>
        <div className={`${subCls} mb-4`}>Your clients at a glance — who's active, who needs a nudge, and how they're progressing.</div>

        {loading ? (
          <div className={cardCls}><div className="text-muted text-sm">Loading your clients…</div></div>
        ) : total === 0 ? (
          <div className={cardCls}>
            <div className={titleCls}>No connected clients yet</div>
            <div className={subCls}>Share your invite code (≡ menu → Invite clients) so clients can link to you. Once they do, their progress shows up here.</div>
          </div>
        ) : (
          <>
            {/* Summary tiles */}
            <div className="grid grid-cols-4 gap-2 mb-4">
              <Tile value={total} label="Clients" color="text-primary" />
              <Tile value={activeWeek} label="Active this wk" color="text-success" />
              <Tile value={needsAttention.length} label="Need attention" color={needsAttention.length ? "text-warn" : "text-muted"} />
              <Tile value={openReqRows.length} label="Open requests" color={openReqRows.length ? "text-primary" : "text-muted"} />
            </div>

            {/* Needs attention */}
            <div className={cardCls}>
              <div className={`${titleCls} flex items-center gap-2`}><Icon name="alert" size={19} color="var(--yellow,#fbbf24)" />Needs attention</div>
              <div className={`${subCls} mb-2`}>No logs in {attnDays}+ days — tap a name to open their plan, or 📤 Nudge to send a "log your food" reminder.</div>
              <div className="flex items-center gap-1.5 mb-3">
                <span className="text-[.7rem] uppercase tracking-wide text-muted mr-0.5">Flag after</span>
                {[2, 3, 5, 7].map((d) => (
                  <button key={d} onClick={() => saveAttn(d)}
                    className={`px-2 py-1 rounded-md text-xs font-bold cursor-pointer border ${attnDays === d ? "border-primary text-primaryfg bg-primaryfill" : "border-border text-muted bg-transparent"}`}>
                    {d}d
                  </button>
                ))}
              </div>
              {needsAttention.length === 0 ? (
                <div className="text-sm text-success py-1">🎉 Everyone's logged recently. Nice coaching.</div>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {needsAttention.map((c) => (
                    <div key={c.uid} className="flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg bg-surface2">
                      <span className="flex-1 min-w-0 cursor-pointer" onClick={() => onOpenClientPlan && onOpenClientPlan(c.uid)}>
                        <span className="font-semibold text-[.9rem] truncate block">{c.name}</span>
                        <span className="flex items-center gap-2 mt-0.5">
                          <span className="text-[.74rem] text-warn whitespace-nowrap">🕑 {lastActiveLabel(c)}</span>
                          <Last7 days={c.last7} />
                        </span>
                      </span>
                      <button
                        onClick={(e) => { e.stopPropagation(); if (!nudged[c.uid] && nudgeBusy !== c.uid) sendNudge(c.uid); }}
                        disabled={nudgeBusy === c.uid || nudged[c.uid]}
                        className={`shrink-0 px-2.5 py-1.5 rounded-md text-xs font-bold cursor-pointer whitespace-nowrap border ${nudged[c.uid] ? "border-success text-success bg-transparent" : "border-primary text-primary bg-[rgba(8,220,224,.08)]"} disabled:cursor-default`}>
                        {nudged[c.uid] ? "✓ Nudged" : nudgeBusy === c.uid ? "…" : "📤 Nudge"}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* This week — roster-wide logging consistency + weight pulse */}
            <div className={cardCls}>
              <div className={`${titleCls} flex items-center gap-2`}><Icon name="calendar" size={19} color="var(--accent)" />This week</div>
              <div className={`${subCls} mb-2`}>Last 7 days at a glance — who's logging, and which way the scale moved.</div>
              <div className="flex flex-col gap-1.5">
                {roster.map((c) => (
                  <div key={c.uid} className={rowCls} onClick={() => onOpenClientPlan && onOpenClientPlan(c.uid)}>
                    <span className="font-semibold text-[.9rem] truncate flex-1 min-w-0">{c.name}</span>
                    <span className="flex items-center gap-2.5 whitespace-nowrap">
                      <Last7 days={c.last7} />
                      <span className="text-[.74rem] text-muted w-7 text-right">{c.logged7}/7</span>
                      {c.wowDelta != null && Math.abs(c.wowDelta) >= 0.1 ? (
                        <span className={`text-[.74rem] ${c.wowDelta < 0 ? "text-success" : "text-warn"}`}>{c.wowDelta < 0 ? "▼" : "▲"} {Math.abs(c.wowDelta)} lb</span>
                      ) : (
                        <span className="text-[.74rem] text-muted">—</span>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Open requests across clients */}
            <div className={cardCls}>
              <div className={`${titleCls} flex items-center gap-2`}><Icon name="inbox" size={19} color="var(--accent)" />Open requests</div>
              <div className={`${subCls} mb-2`}>To-dos you've sent that clients haven't completed yet.</div>
              {openReqRows.length === 0 ? (
                <div className="text-sm text-muted py-1">No open requests — all caught up.</div>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {openReqRows.map((r) => (
                    <div key={r.id} className={rowCls} onClick={() => onOpenClientPlan && onOpenClientPlan(r.clientUid)}>
                      <span className="text-[.84rem] truncate"><span className="text-primary font-semibold">{r.clientName}</span> · {r.prompt}</span>
                      <span className="text-[.78rem] text-muted whitespace-nowrap">→</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Aggregate progress */}
            <div className={cardCls}>
              <div className={`${titleCls} flex items-center gap-2`}><Icon name="chart" size={19} color="var(--accent)" />Progress</div>
              <div className="flex gap-2 mb-3">
                <div className="flex-1 bg-surface2 border border-border rounded-lg py-3 text-center">
                  <div className="font-display text-2xl text-success">{totalLbsLost}</div>
                  <div className="text-[.62rem] uppercase tracking-wide text-muted mt-0.5">Total lbs lost</div>
                </div>
                <div className="flex-1 bg-surface2 border border-border rounded-lg py-3 text-center">
                  <div className="font-display text-2xl text-primary">{onTrackCount}<span className="text-muted text-base">/{total}</span></div>
                  <div className="text-[.62rem] uppercase tracking-wide text-muted mt-0.5">On track to goal</div>
                </div>
              </div>
              {withProgress.length === 0 ? (
                <div className="text-sm text-muted py-1">No weigh-ins logged yet — progress shows once clients start tracking weight.</div>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {withProgress.map((c) => (
                    <div key={c.uid} className={rowCls} onClick={() => onOpenClientPlan && onOpenClientPlan(c.uid)}>
                      <span className="font-semibold text-[.9rem] truncate">{c.name}</span>
                      <span className="flex items-center gap-2 whitespace-nowrap text-[.8rem]">
                        <span className={c.lbsLost > 0 ? "text-success" : c.lbsLost < 0 ? "text-warn" : "text-muted"}>
                          {c.lbsLost > 0 ? `▼ ${c.lbsLost}` : c.lbsLost < 0 ? `▲ ${Math.abs(c.lbsLost)}` : "0"} lbs
                        </span>
                        {c.ratePerWeek != null && Math.abs(c.ratePerWeek) >= 0.05 && (
                          <span className="text-muted text-[.74rem]">{c.ratePerWeek < 0 ? "▼" : "▲"} {Math.abs(c.ratePerWeek).toFixed(1)}/wk</span>
                        )}
                        {c.onTrack === true && <span className="text-success">✓ on track</span>}
                        {c.onTrack === false && <span className="text-warn">off track</span>}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <button onClick={onGoClients} className="w-full py-3 rounded-lg border border-border bg-transparent text-fg text-sm font-semibold cursor-pointer">
              👥 Manage all clients & plans
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ─── AI chat panel (Session 61) ─────────────────────────────────────────────
// Stage-1 conversational assistant: a collapsible chat dismissed to a floating
// button (per the spec's UI notes). It calls the server-side `aiChat` callable
// (functions/aichat.js) — the system prompt, role scope, and daily token budget
// are all enforced there; the browser only sends the message thread and renders
// the reply. SSE streaming + meal-write + tools are later stages, so this just
// awaits the full reply. Rendered via createPortal so its fixed positioning
// escapes the .page-transition transform trap (same fix as the other modals).
const callAiChat = httpsCallable(functions, "aiChat");
const callLogMeal = httpsCallable(functions, "logMeal"); // meal Accept-card direct write (Session 68)
const callSetWorkout = httpsCallable(functions, "setWorkoutSchedule"); // workout Accept-card direct write (Session 75)
const callTranscribe = httpsCallable(functions, "transcribeAudio"); // voice → text (Whisper, Session 79)
// Streaming endpoint (Session 66) — replies arrive word-by-word via SSE. We POST
// with the Firebase ID token (EventSource can't set headers, so we fetch+stream).
const AI_STREAM_URL = `https://us-central1-${import.meta.env.VITE_FIREBASE_PROJECT_ID}.cloudfunctions.net/aiChatStream`;

// Stream the AI reply. Calls onDelta(text) as chunks arrive and onDone({wrote,
// usage}) at the end. Throws { code, message } on failure so send() can fall
// back to the non-streaming callable.
async function streamAiChat(apiMsgs, { onDelta, onDone, onProposal, onWorkoutProposal }) {
  const user = auth.currentUser;
  if (!user) throw { code: "unauthenticated" };
  const token = await user.getIdToken();
  const resp = await fetch(AI_STREAM_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messages: apiMsgs }),
  });
  if (!resp.ok || !resp.body) throw { code: "http", status: resp.status };
  const reader = resp.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf("\n\n")) >= 0) {
      const raw = buf.slice(0, idx); buf = buf.slice(idx + 2);
      let event = "message", data = "";
      for (const line of raw.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) data += line.slice(5).trim();
      }
      if (!data) continue;
      let payload; try { payload = JSON.parse(data); } catch { continue; }
      if (event === "delta") onDelta(payload.text || "");
      else if (event === "proposal") { if (onProposal) onProposal(payload); }
      else if (event === "workoutProposal") { if (onWorkoutProposal) onWorkoutProposal(payload); }
      else if (event === "done") onDone(payload || {});
      else if (event === "error") throw { code: payload.code || "internal", message: payload.message };
    }
  }
}

// Lightweight markdown renderer for AI replies — handles **bold** and line
// breaks so responses read cleanly in the narrow chat (full markdown/tables are
// intentionally not parsed; the system prompt asks the model to keep formatting
// simple). Used by the chat bubbles and the AI Coaching Insights card.
function RichText({ text }) {
  const lines = String(text == null ? "" : text).split("\n");
  return (
    <>
      {lines.map((line, i) => {
        const parts = line.split(/(\*\*[^*]+\*\*)/g).map((seg, j) =>
          /^\*\*[^*]+\*\*$/.test(seg)
            ? <strong key={j}>{seg.slice(2, -2)}</strong>
            : <span key={j}>{seg}</span>
        );
        return <div key={i} className={line.trim() ? "" : "h-2"}>{parts}</div>;
      })}
    </>
  );
}

// Downscale a chosen photo to a JPEG data URL (max ~1024px long edge) to keep
// upload size + vision token cost down for photo meal logging (Session 65).
function downscaleImage(file, maxDim = 1024, quality = 0.8) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("read failed"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("decode failed"));
      img.onload = () => {
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = w; canvas.height = h;
        canvas.getContext("2d").drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}
// Parse a base64 image data URL into an Anthropic image content block.
function imageBlockFromDataUrl(dataUrl) {
  const m = /^data:(image\/(?:jpeg|png|webp|gif));base64,(.+)$/.exec(dataUrl || "");
  return m ? { type: "image", source: { type: "base64", media_type: m[1], data: m[2] } } : null;
}
// Read a Blob (recorded audio) as a base64 string (no data: prefix) for the
// transcribeAudio callable (Session 79 — voice input).
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onloadend = () => { const s = String(r.result || ""); resolve(s.slice(s.indexOf(",") + 1)); };
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

function AIChatPanel({ role, onDataChanged }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]); // {role:'user'|'assistant', content, image?}
  const [draft, setDraft] = useState("");
  const [pendingImage, setPendingImage] = useState(null); // dataURL of a photo to send
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [warn, setWarn] = useState(false); // ≥80% of daily budget used
  const [proposal, setProposal] = useState(null); // pending meal card {…, status}
  const [editDraft, setEditDraft] = useState(null); // edit-mode fields
  const [workout, setWorkout] = useState(null); // pending workout-program card {…, status}
  const [recording, setRecording] = useState(false);     // mic actively recording
  const [transcribing, setTranscribing] = useState(false); // sending audio → text
  const [liveText, setLiveText] = useState("");          // interim words (browser speech) while recording
  const [size, setSize] = useState("compact");           // "compact" corner card | "full" near-fullscreen
  const scrollRef = useRef(null);
  const fileRef = useRef(null);
  const taRef = useRef(null);     // composer textarea (auto-grows with content)
  const recRef = useRef(null);    // MediaRecorder instance
  const chunksRef = useRef([]);   // recorded audio chunks
  const streamRef = useRef(null); // mic MediaStream (to stop tracks after)
  const waveRef = useRef(null);   // <canvas> for the live level meter
  const recognitionRef = useRef(null); // browser SpeechRecognition (live interim words)
  const loadedRef = useRef(false); // guards persistence until the saved thread loads

  // Conversation persistence (Session 77): the chat thread is saved to the user's
  // own account so it's still there when they reopen the panel. Stored TEXT-ONLY
  // (photos' base64 is stripped — kept small) and capped to the last 20 messages.
  // No effect on AI cost: the API payload is capped the same either way.
  const CHAT_KEY = "caliq-ai-chat";
  useEffect(() => {
    (async () => {
      try {
        const r = await window.storage.get(CHAT_KEY);
        const saved = r && r.value ? JSON.parse(r.value) : [];
        if (Array.isArray(saved) && saved.length) setMessages(saved);
      } catch { /* none saved yet */ }
      loadedRef.current = true;
    })();
  }, []);
  // Save when an exchange settles (busy=false) — not mid-stream. Skip until loaded
  // so we never clobber the saved thread with the initial empty state.
  useEffect(() => {
    if (!loadedRef.current || busy) return;
    try {
      const slim = messages.slice(-20).map((m) => ({ role: m.role, content: m.content || "", hadImage: !!m.image }));
      window.storage.set(CHAT_KEY, JSON.stringify(slim));
    } catch { /* best-effort */ }
  }, [busy, messages]);

  // Accept a proposed meal → save it directly (no extra AI call) via logMeal.
  const acceptMeal = async (meal) => {
    const p = meal || proposal;
    if (!p) return;
    setProposal((prev) => ({ ...prev, ...p, status: "saving" }));
    try {
      const input = { name: p.name, mealType: p.mealType, calories: Number(p.calories) || 0,
        protein: Number(p.protein) || 0, carbs: Number(p.carbs) || 0, fat: Number(p.fat) || 0, date: p.date };
      if (p.time) input.time = p.time;
      if (p.clientId) input.clientId = p.clientId;
      await callLogMeal(input);
      setEditDraft(null);
      setProposal((prev) => ({ ...prev, ...p, status: "logged" }));
      if (typeof onDataChanged === "function") onDataChanged();
    } catch (e) {
      setProposal((prev) => ({ ...prev, status: "pending" }));
      setError("Couldn't save the meal. Try again.");
    }
  };

  // Accept a proposed workout program → save it directly (no extra AI call) via
  // the setWorkoutSchedule callable, using the validated raw program from propose_workout.
  const acceptWorkout = async () => {
    if (!workout || !workout.raw) return;
    setWorkout((prev) => ({ ...prev, status: "saving" }));
    try {
      await callSetWorkout(workout.raw);
      setWorkout((prev) => ({ ...prev, status: "saved" }));
      if (typeof onDataChanged === "function") onDataChanged();
    } catch (e) {
      setWorkout((prev) => ({ ...prev, status: "pending" }));
      setError("Couldn't save the program. Try again.");
    }
  };

  const pickImage = () => { if (fileRef.current) fileRef.current.click(); };
  const onFile = async (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = ""; // allow re-picking the same file
    if (!f) return;
    if (!f.type.startsWith("image/")) { setError("Please choose an image."); return; }
    setError("");
    try { setPendingImage(await downscaleImage(f)); }
    catch { setError("Couldn't read that photo. Try another."); }
  };

  // Voice input (Session 79): record from the mic, transcribe via Whisper
  // (transcribeAudio callable), and drop the text into the composer for the user
  // to review and send. Stops the mic tracks after to release the device.
  // Browser-native live interim words (best-effort) — instant feedback as you
  // speak, shown as a caption. Whisper still produces the accurate final text on
  // stop. Wrapped so a failure here NEVER breaks the core MediaRecorder→Whisper
  // path (absent/limited on iOS Safari — there the waveform covers real-time).
  const startLiveCaption = () => {
    try {
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SR) return;
      const sr = new SR();
      sr.continuous = true; sr.interimResults = true; sr.lang = "en-US";
      let finalT = "";
      sr.onresult = (ev) => {
        let interim = "";
        for (let i = ev.resultIndex; i < ev.results.length; i++) {
          const r = ev.results[i];
          if (r.isFinal) finalT += r[0].transcript; else interim += r[0].transcript;
        }
        setLiveText((finalT + " " + interim).trim());
      };
      sr.onerror = () => { /* best-effort */ };
      recognitionRef.current = sr;
      sr.start();
    } catch (e) { /* best-effort */ }
  };
  const stopLiveCaption = () => {
    try { if (recognitionRef.current) { recognitionRef.current.stop(); recognitionRef.current = null; } } catch (e) { /* ignore */ }
  };

  const startRecording = async () => {
    setError(""); setLiveText("");
    if (typeof navigator === "undefined" || !navigator.mediaDevices || typeof MediaRecorder === "undefined") {
      setError("Voice input isn't supported on this browser."); return;
    }
    let mime = "";
    for (const m of ["audio/webm", "audio/mp4", "audio/ogg"]) {
      if (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(m)) { mime = m; break; }
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];
      const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      recRef.current = rec;
      rec.ondataavailable = (e) => { if (e.data && e.data.size) chunksRef.current.push(e.data); };
      rec.onstop = async () => {
        if (streamRef.current) { streamRef.current.getTracks().forEach((t) => t.stop()); streamRef.current = null; }
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || mime || "audio/webm" });
        chunksRef.current = [];
        if (!blob.size) { setLiveText(""); return; }
        setTranscribing(true);
        try {
          const b64 = await blobToBase64(blob);
          const res = await callTranscribe({ audio: b64, mimeType: blob.type });
          const text = (res.data && res.data.text) || "";
          if (text) setDraft((d) => (d ? d.trim() + " " : "") + text);
          else setError("Didn't catch that — try again.");
        } catch (err) {
          const code = (err && err.code) || "";
          if (code.includes("unauthenticated")) setError("Please sign in again to use voice.");
          else if (code.includes("invalid-argument")) setError("That recording couldn't be used — try a shorter clip.");
          else setError("Couldn't transcribe — please try again.");
        } finally { setTranscribing(false); setLiveText(""); }
      };
      rec.start();
      startLiveCaption();
      setRecording(true);
    } catch (err) {
      setError("Microphone access was blocked. Enable it in your browser settings.");
    }
  };
  const stopRecording = () => {
    stopLiveCaption();
    try { if (recRef.current && recRef.current.state !== "inactive") recRef.current.stop(); } catch (e) { /* ignore */ }
    setRecording(false);
  };
  const toggleMic = () => { if (recording) stopRecording(); else startRecording(); };

  // Live level meter (waveform) — draws the mic's audio level on a canvas while
  // recording, so you can see it's capturing your voice in real time. Set up when
  // recording starts (the canvas is mounted by then) and torn down on stop.
  useEffect(() => {
    if (!recording || !streamRef.current) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    let ctx, raf;
    try {
      ctx = new AC();
      const src = ctx.createMediaStreamSource(streamRef.current);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 64;
      src.connect(analyser);
      const bins = analyser.frequencyBinCount;
      const data = new Uint8Array(bins);
      const draw = () => {
        raf = requestAnimationFrame(draw);
        const cv = waveRef.current; if (!cv) return;
        analyser.getByteFrequencyData(data);
        const c = cv.getContext("2d"); const W = cv.width, H = cv.height;
        c.clearRect(0, 0, W, H);
        const bw = W / bins;
        c.fillStyle = "#08DCE0";
        for (let i = 0; i < bins; i++) {
          const h = Math.max(2, (data[i] / 255) * H);
          c.fillRect(i * bw, (H - h) / 2, Math.max(1, bw * 0.6), h);
        }
      };
      draw();
    } catch (e) { /* waveform is best-effort */ }
    return () => { if (raf) cancelAnimationFrame(raf); if (ctx) { try { ctx.close(); } catch (e) { /* ignore */ } } };
  }, [recording]);

  // Auto-scroll to the newest message whenever the thread or busy state changes.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, busy, open]);

  // Auto-grow the composer like Claude's: the textarea height follows its content
  // (from one line up to a max, then it scrolls). Runs on every draft change and
  // when the panel opens, and resets after send (draft cleared).
  const MAX_TA = 200; // px before the textarea starts scrolling instead of growing
  const autoGrowTextarea = () => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto"; // collapse so scrollHeight reflects content, not the old height
    // An EMPTY textarea reports a too-tall scrollHeight in some browsers (≈2 rows),
    // which made the box shrink on the first keystroke. For empty content, leave it
    // at the one-row "auto"/rows=1 height; only size to content when there's text.
    if (el.value) {
      el.style.height = Math.min(el.scrollHeight, MAX_TA) + "px";
      el.style.overflowY = el.scrollHeight > MAX_TA ? "auto" : "hidden";
    } else {
      el.style.overflowY = "hidden";
    }
  };
  useEffect(() => { autoGrowTextarea(); }, [draft, open]);

  const send = async () => {
    const text = draft.trim();
    if ((!text && !pendingImage) || busy) return;
    setError("");
    const next = [...messages, { role: "user", content: text, image: pendingImage || undefined }];
    setMessages(next);
    setDraft("");
    setPendingImage(null);
    setProposal(null); // a new message supersedes any pending meal card
    setEditDraft(null);
    setWorkout(null); // …and any pending workout card
    setBusy(true);
    // Build the API payload. Send the image block only on the most recent
    // message (older turns go as text) to bound vision token cost.
    const apiMsgs = next.map((m, i) => {
      if (m.image && i === next.length - 1) {
        const blk = imageBlockFromDataUrl(m.image);
        const content = [{ type: "text", text: m.content || "Here's a photo of my meal — estimate the calories and macros, then we can log it." }];
        if (blk) content.push(blk);
        return { role: m.role, content };
      }
      return { role: m.role, content: m.content || (m.image ? "(I sent a photo of my meal.)" : "") };
    });
    try {
      // Stream the reply (word-by-word). Fall back to the callable on failure.
      let streamed = "";
      let done = null;
      await streamAiChat(apiMsgs, {
        onDelta: (t) => { streamed += t; setMessages([...next, { role: "assistant", content: streamed }]); },
        onProposal: (meal) => setProposal({ ...meal, status: "pending" }),
        onWorkoutProposal: (w) => setWorkout({ ...w, status: "pending" }),
        onDone: (p) => { done = p; },
      });
      setMessages([...next, { role: "assistant", content: streamed || "(no response)" }]);
      if (done && done.usage && done.usage.warn) setWarn(true);
      if (done && done.wrote && typeof onDataChanged === "function") onDataChanged();
    } catch (streamErr) {
      const sc = (streamErr && streamErr.code) || "";
      if (sc.includes("resource-exhausted")) {
        setError("You've reached today's AI usage limit. It resets tomorrow.");
      } else {
        // Streaming unavailable (network/CORS/server) → non-streaming callable.
        try {
          const res = await callAiChat({ messages: apiMsgs });
          const reply = (res.data && res.data.reply) || "";
          setMessages([...next, { role: "assistant", content: reply || "(no response)" }]);
          if (res.data && res.data.usage && res.data.usage.warn) setWarn(true);
          if (res.data && res.data.proposal) setProposal({ ...res.data.proposal, status: "pending" });
          if (res.data && res.data.workoutProposal) setWorkout({ ...res.data.workoutProposal, status: "pending" });
          if (res.data && res.data.wrote && typeof onDataChanged === "function") onDataChanged();
        } catch (e) {
          const code = (e && e.code) || "";
          if (code.includes("resource-exhausted")) setError("You've reached today's AI usage limit. It resets tomorrow.");
          else if (code.includes("unauthenticated")) setError("Please sign in again to use the assistant.");
          else setError("The assistant is temporarily unavailable. Please try again.");
        }
      }
    }
    setBusy(false);
  };

  const isTrainer = role === "head_trainer" || role === "sub_trainer" || role === "admin";
  const suggestions = isTrainer
    ? ["Which clients need attention?", "Tips to improve client adherence"]
    : ["I had 2 eggs and toast for breakfast", "How much protein should I eat?"];

  const bubbleUser = "self-end max-w-[85%] rounded-2xl rounded-br-sm bg-primaryfill px-3.5 py-2.5 text-[.95rem] leading-relaxed text-primaryfg whitespace-pre-wrap break-words";
  const bubbleAI = "self-start max-w-[90%] rounded-2xl rounded-bl-sm bg-surface2 px-3.5 py-2.5 text-[.95rem] leading-relaxed text-fg whitespace-pre-wrap break-words";

  return createPortal(
    <div data-theme="pro" style={{ fontFamily: "var(--font-sans)" }}>
      {/* Floating launcher button */}
      {!open && (
        <button onClick={() => setOpen(true)} aria-label="Open AI assistant"
          className="fixed z-[1000] flex items-center gap-1.5 rounded-full border-none bg-primaryfill px-3 py-2.5 font-bold text-primaryfg shadow-lg cursor-pointer"
          style={{ right: "calc(16px + env(safe-area-inset-right,0px))", bottom: "calc(18px + env(safe-area-inset-bottom,0px))" }}>
          <Icon name="sparkle" variant="solid" size={16} />
          <span className="text-[.82rem]">Ask Glide</span>
        </button>
      )}

      {/* Chat panel — "compact" is a bigger bottom-right card; "full" nearly
          fills the screen. Toggle with the expand control in the header. */}
      {open && (
        <div className="fixed z-[1000] flex flex-col overflow-hidden rounded-card border border-border bg-surface text-fg shadow-2xl"
          style={size === "full" ? {
            top: "calc(10px + env(safe-area-inset-top,0px))",
            bottom: "calc(10px + env(safe-area-inset-bottom,0px))",
            left: "10px", right: "10px",
            maxWidth: 900, margin: "0 auto",
          } : {
            right: "calc(16px + env(safe-area-inset-right,0px))",
            bottom: "calc(18px + env(safe-area-inset-bottom,0px))",
            width: "min(460px, calc(100vw - 24px))",
            height: "min(720px, calc(100vh - 32px))",
          }}>
          {/* Header */}
          <div className="flex items-center gap-2 border-b border-border bg-surface2 px-4 py-3">
            <Icon name="sparkle" variant="solid" size={18} color="var(--accent)" />
            <div className="flex flex-col leading-tight">
              <span className="font-display text-sm uppercase tracking-wide text-primary">Glide AI</span>
              <span className="text-[.68rem] text-muted">Nutrition &amp; fitness assistant</span>
            </div>
            <button onClick={() => setSize(size === "full" ? "compact" : "full")}
              aria-label={size === "full" ? "Shrink to corner" : "Expand to full screen"}
              title={size === "full" ? "Shrink" : "Expand"}
              className="ml-auto rounded-md border-none bg-transparent px-2 py-1 text-muted cursor-pointer hover:text-primary">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-[18px] h-[18px]">
                {size === "full"
                  ? <><path d="M9 3H5a2 2 0 0 0-2 2v4" /><path d="M15 3h4a2 2 0 0 1 2 2v4" /><path d="M9 21H5a2 2 0 0 1-2-2v-4" /><path d="M15 21h4a2 2 0 0 0 2-2v-4" /></>
                  : <><path d="M3 9V5a2 2 0 0 1 2-2h4" /><path d="M21 9V5a2 2 0 0 0-2-2h-4" /><path d="M3 15v4a2 2 0 0 0 2 2h4" /><path d="M21 15v4a2 2 0 0 1-2 2h-4" /></>}
              </svg>
            </button>
            <button onClick={() => setOpen(false)} aria-label="Close"
              className="rounded-md border-none bg-transparent px-2 py-1 text-lg text-muted cursor-pointer hover:text-fg">✕</button>
          </div>

          {/* Message thread */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-2.5">
            {messages.length === 0 ? (
              <div className="flex flex-col gap-3 py-2">
                <div className="text-[.85rem] text-muted">
                  {isTrainer
                    ? "Ask about your clients' nutrition data, progress, or fitness science."
                    : "Tell me what you ate, or ask me anything about nutrition, macros, or training."}
                </div>
                <div className="flex flex-col gap-2">
                  {suggestions.map((s, i) => (
                    <button key={i} onClick={() => setDraft(s)}
                      className="text-left rounded-lg border border-border bg-surface2 px-3 py-2 text-[.82rem] text-fg cursor-pointer hover:border-primary">
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((m, i) => (
                <div key={i} className={m.role === "user" ? bubbleUser : bubbleAI}>
                  {m.image && (
                    <img src={m.image} alt="meal photo" className="mb-1.5 max-h-44 w-auto rounded-lg" />
                  )}
                  {m.role === "user" ? m.content : <RichText text={m.content} />}
                </div>
              ))
            )}
            {busy && !(messages.length && messages[messages.length - 1].role === "assistant") &&
              <div className={bubbleAI + " text-muted"}>Thinking…</div>}
            {error && <div className="self-stretch rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-[.82rem] text-danger">{error}</div>}
            {warn && !error && (
              <div className="self-stretch rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-[.78rem] text-warn">
                You're nearing today's AI usage limit.
              </div>
            )}
          </div>

          {/* Meal confirmation card (Session 68) — tap to log, no typing "yes". */}
          {proposal && (
            <div className="border-t border-border bg-surface2 px-3 py-3">
              {proposal.status === "logged" ? (
                <div className="flex items-center gap-2 text-[.88rem]">
                  <span className="font-bold text-success">✓ Logged</span>
                  <span className="text-muted truncate">{proposal.name} · {proposal.calories} cal</span>
                  <button onClick={() => setProposal(null)} aria-label="Dismiss" className="ml-auto px-2 text-muted hover:text-fg">✕</button>
                </div>
              ) : editDraft ? (
                <div className="flex flex-col gap-2">
                  <div className="text-[.7rem] uppercase tracking-[.5px] text-primary">Edit meal</div>
                  <input value={editDraft.name} onChange={e => setEditDraft({ ...editDraft, name: e.target.value })}
                    placeholder="Food name"
                    className="w-full box-border rounded-lg border border-border bg-surface px-3 py-2 text-[.85rem] text-fg outline-none" />
                  <div className="flex flex-wrap gap-1.5">
                    {["breakfast", "lunch", "dinner", "snack"].map(t => (
                      <button key={t} onClick={() => setEditDraft({ ...editDraft, mealType: t })}
                        className={`rounded-full border px-2.5 py-1 text-[.74rem] ${editDraft.mealType === t ? "border-primary bg-primaryfill text-primaryfg" : "border-border text-muted"}`}>
                        {t.replace(/^./, c => c.toUpperCase())}</button>
                    ))}
                  </div>
                  <div className="grid grid-cols-4 gap-1.5">
                    {[["calories", "cal"], ["protein", "P g"], ["carbs", "C g"], ["fat", "F g"]].map(([k, lbl]) => (
                      <label key={k} className="flex flex-col text-[.6rem] uppercase tracking-[.3px] text-muted">{lbl}
                        <input type="number" inputMode="numeric" value={editDraft[k]}
                          onChange={e => setEditDraft({ ...editDraft, [k]: e.target.value })}
                          className="mt-0.5 w-full box-border rounded-md border border-border bg-surface px-2 py-1.5 text-[.85rem] text-fg outline-none" />
                      </label>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => acceptMeal(editDraft)} className="flex-1 rounded-lg bg-primaryfill px-3 py-2 text-[.85rem] font-bold text-primaryfg">Save &amp; log</button>
                    <button onClick={() => setEditDraft(null)} className="rounded-lg border border-border px-3 py-2 text-[.85rem] text-fg">Cancel</button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  <div className="flex items-baseline gap-2">
                    <span className="rounded-full bg-[rgba(8,220,224,.14)] px-2 py-0.5 text-[.68rem] uppercase tracking-[.5px] text-primary">
                      {(proposal.mealType || "snack").replace(/^./, c => c.toUpperCase())}</span>
                    <span className="truncate text-[.9rem] font-semibold text-fg">{proposal.name}</span>
                  </div>
                  <div className="flex items-baseline gap-2 text-fg">
                    <span className="font-display text-xl leading-none">{proposal.calories}</span>
                    <span className="text-[.8rem] text-muted">cal</span>
                    <span className="ml-2 text-[.8rem] text-muted">{proposal.protein}g P · {proposal.carbs}g C · {proposal.fat}g F</span>
                  </div>
                  <div className="flex gap-2">
                    <button disabled={proposal.status === "saving"} onClick={() => acceptMeal()}
                      className="flex-1 rounded-lg bg-primaryfill px-3 py-2 text-[.88rem] font-bold text-primaryfg disabled:opacity-60">
                      {proposal.status === "saving" ? "Saving…" : "✓ Log it"}</button>
                    <button disabled={proposal.status === "saving"} onClick={() => setEditDraft({ ...proposal })}
                      className="rounded-lg border border-primary bg-[rgba(8,220,224,.12)] px-3 py-2 text-[.88rem] font-semibold text-primary disabled:opacity-60">Edit</button>
                    <button disabled={proposal.status === "saving"} onClick={() => setProposal(null)} aria-label="Dismiss"
                      className="rounded-lg border border-border px-2.5 py-2 text-[.88rem] text-muted disabled:opacity-60">✕</button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Workout-program confirmation card (Session 75) — tap to save the
              weekly program the AI drafted. For changes, ask in chat. */}
          {workout && (() => {
            const dayList = (sched) => DAYS.filter((d) => (sched && sched[d] && sched[d].length))
              .map((d) => ({ day: d, items: sched[d] }));
            const strDays = dayList(workout.strength);
            const cardDays = dayList(workout.cardio);
            const totalDays = new Set([...strDays, ...cardDays].map((x) => x.day)).size;
            return (
              <div className="border-t border-border bg-surface2 px-3 py-3">
                {workout.status === "saved" ? (
                  <div className="flex items-center gap-2 text-[.88rem]">
                    <span className="font-bold text-success">✓ Program saved</span>
                    <span className="text-muted truncate">{totalDays} training {totalDays === 1 ? "day" : "days"}/week</span>
                    <button onClick={() => setWorkout(null)} aria-label="Dismiss" className="ml-auto px-2 text-muted hover:text-fg">✕</button>
                  </div>
                ) : (
                  <div className="flex flex-col gap-2">
                    <div className="flex items-baseline gap-2">
                      <span className="rounded-full bg-[rgba(8,220,224,.14)] px-2 py-0.5 text-[.68rem] uppercase tracking-[.5px] text-primary">Workout program</span>
                      <span className="text-[.8rem] text-muted">{totalDays} {totalDays === 1 ? "day" : "days"}/week</span>
                    </div>
                    <div className="max-h-44 overflow-y-auto flex flex-col gap-1.5">
                      {[...strDays.map((x) => ({ ...x, kind: "💪" })), ...cardDays.map((x) => ({ ...x, kind: "🏃" }))]
                        .sort((a, b) => DAYS.indexOf(a.day) - DAYS.indexOf(b.day))
                        .map((row, i) => (
                          <div key={i} className="text-[.8rem]">
                            <span className="font-semibold text-fg">{row.kind} {row.day}</span>
                            <span className="text-muted"> — {row.items.map((s) => s.label).join(", ")}</span>
                          </div>
                        ))}
                    </div>
                    {workout.droppedInvalidIds && workout.droppedInvalidIds.length > 0 && (
                      <div className="text-[.7rem] text-warn">Some exercises couldn't be matched and were skipped.</div>
                    )}
                    <div className="flex gap-2">
                      <button disabled={workout.status === "saving"} onClick={acceptWorkout}
                        className="flex-1 rounded-lg bg-primaryfill px-3 py-2 text-[.88rem] font-bold text-primaryfg disabled:opacity-60">
                        {workout.status === "saving" ? "Saving…" : "✓ Save program"}</button>
                      <button disabled={workout.status === "saving"} onClick={() => setWorkout(null)} aria-label="Dismiss"
                        className="rounded-lg border border-border px-2.5 py-2 text-[.88rem] text-muted disabled:opacity-60">✕</button>
                    </div>
                    <div className="text-[.68rem] text-muted">Want changes? Just tell me in the chat.</div>
                  </div>
                )}
              </div>
            );
          })()}

          {/* Composer */}
          <div className="border-t border-border bg-surface px-3 py-3">
            {pendingImage && (
              <div className="mb-2 flex items-center gap-2">
                <img src={pendingImage} alt="meal to send" className="h-14 w-14 rounded-lg object-cover" />
                <span className="text-[.78rem] text-muted">Photo attached — add a note or just send.</span>
                <button onClick={() => setPendingImage(null)} aria-label="Remove photo"
                  className="ml-auto rounded-md border-none bg-transparent px-2 py-1 text-muted cursor-pointer hover:text-fg">✕</button>
              </div>
            )}
            {/* Live recording feedback: a waveform (reacts to your voice) + live
                interim words where the browser supports it (Whisper finalizes on stop). */}
            {(recording || transcribing) && (
              <div className="mb-2 flex items-center gap-2.5 rounded-lg border border-border bg-surface2 px-2.5 py-2">
                <span className={`h-2 w-2 shrink-0 rounded-full ${recording ? "bg-danger animate-pulse" : "bg-muted"}`} />
                <canvas ref={waveRef} width={96} height={26} className="shrink-0 rounded" />
                <span className="min-w-0 flex-1 truncate text-[.8rem] text-fg">
                  {liveText || (transcribing ? "Transcribing…" : "Listening… tap ⏹ when done")}
                </span>
              </div>
            )}
            <div className="flex items-end gap-2">
              <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={onFile} />
              <button onClick={pickImage} disabled={busy || recording || transcribing} aria-label="Add a photo" title="Photo of your meal"
                className="flex items-center justify-center rounded-xl border border-border bg-surface2 px-3 py-2.5 text-fg cursor-pointer disabled:opacity-50 hover:text-primary">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-[22px] h-[22px]">
                  <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                  <circle cx="12" cy="13" r="4" />
                </svg></button>
              <button onClick={toggleMic} disabled={busy || transcribing}
                aria-label={recording ? "Stop recording" : "Record a voice message"}
                title={recording ? "Tap to stop" : "Speak to Glide"}
                className={`flex items-center justify-center rounded-xl border px-3 py-2.5 cursor-pointer disabled:opacity-50 ${recording ? "border-danger bg-danger text-white animate-pulse" : "border-border bg-surface2 text-fg hover:text-primary"}`}>
                {transcribing ? (
                  <span className="text-[1.05rem] leading-none">…</span>
                ) : recording ? (
                  <svg viewBox="0 0 24 24" fill="currentColor" className="w-[22px] h-[22px]"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>
                ) : (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-[22px] h-[22px]">
                    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                    <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                    <line x1="12" y1="19" x2="12" y2="23" />
                    <line x1="8" y1="23" x2="16" y2="23" />
                  </svg>
                )}</button>
              <textarea ref={taRef} value={draft} onChange={e => setDraft(e.target.value)} rows={1}
                placeholder={recording ? "Listening… tap ⏹ to stop" : transcribing ? "Transcribing…" : pendingImage ? "Add a note (optional)…" : "Message Glide AI…"}
                style={{ fontFamily: "var(--font-sans)" }}
                className="flex-1 resize-none box-border min-h-[48px] rounded-xl border border-border bg-surface2 px-3.5 py-3 text-[.95rem] leading-relaxed text-fg outline-none placeholder:text-muted"
                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} />
              <button onClick={send} disabled={busy || recording || transcribing || (!draft.trim() && !pendingImage)} aria-label="Send"
                className="rounded-xl border-none bg-primaryfill px-3.5 py-2.5 text-[.9rem] font-bold text-primaryfg cursor-pointer disabled:opacity-50 disabled:cursor-default">
                {busy ? "…" : "Send"}
              </button>
            </div>
            <div className="mt-1.5 text-[.66rem] text-muted">🎤 Speak or 📷 snap a meal. AI estimates can be off — confirm important numbers.</div>
          </div>
        </div>
      )}
    </div>,
    document.body
  );
}

// ─── Client home (Session 8) ────────────────────────────────────────────────
// A client manages just their own plan (stored in their own account as
// "caliq-self"). This is their landing screen: the role panel (their trainer
// link) plus a button to open/edit their plan in the normal editor. The plan a
// trainer "links" to them is the very same caliq-self, so both edit one copy.
// Rotating one-a-day coaching tips for the "AI coaching tips" nudge (Session 77).
// Plain, on-brand fitness wisdom — picked by day so it changes daily, not naggy.
const COACH_TIPS = [
  "Protein first — aim for about 1g per pound of bodyweight to protect muscle.",
  "Pair carbs with protein or fat to steady your energy and blunt blood-sugar spikes.",
  "Day-old rice or potatoes, reheated, hit your blood sugar less than freshly cooked.",
  "Consistency beats perfection — logging most days matters more than a perfect day.",
  "Hydrate before meals; thirst often masquerades as hunger.",
  "Basmati is a lower-GI rice choice if you're watching blood sugar.",
  "A short walk after meals helps manage blood sugar and digestion.",
  "Strength train to keep muscle while losing fat — it protects your metabolism.",
  "Ask your AI coach to estimate a meal — just describe it or snap a photo.",
];

function ClientHome({ onOpenPlan, meUid, meName, role, notifPrefs, onSetNotifPrefs }) {
  // The client's plan lives in their own account as "caliq-self"; today's log is
  // "caliq-log-self-{date}". The client is always on their own account (no remote
  // routing), so we read/write their own window.storage directly.
  const [planData, setPlanData] = useState(undefined); // undefined=loading, null=no plan
  const [log, setLog] = useState({});                  // today's daily log
  const [calDraft, setCalDraft] = useState("");
  const [wtDraft, setWtDraft] = useState("");
  const [showWt, setShowWt] = useState(false);     // inline weight-log input open
  const [showChart, setShowChart] = useState(false); // progress chart popup open
  const [msg, setMsg] = useState("");              // calorie-log message
  const [wtMsg, setWtMsg] = useState("");          // weight-log message
  const [requests, setRequests] = useState([]);    // trainer → client requests (Session 19)
  const [quickReq, setQuickReq] = useState(null);  // request being completed in the quick-action popup
  // Whether the trainer to-do reminders show — driven by the shared notification
  // prefs (master + per-type), lifted to App so the menu's Notification Center and
  // this inline toggle stay in sync.
  const np = notifPrefs || { master: true, trainerReminders: true };
  const remindersOn = np.master && np.trainerReminders;
  const [nudgeDismiss, setNudgeDismiss] = useState({}); // session-only dismiss per nudge key
  // Multiple plans (Session 21): the client can hold several plans with one
  // active. Each plan's data/log/history is keyed by its id (default "self").
  const [plans, setPlans] = useState([{ id: "self", name: "Main plan", createdAt: 0 }]);
  const [activePlanId, setActivePlanId] = useState("self");
  const [showPlans, setShowPlans] = useState(false); // plan switcher open
  const [renamingPlanId, setRenamingPlanId] = useState(null);
  const [planNameDraft, setPlanNameDraft] = useState("");
  // The full plan wrapper ({data, step, …}) kept in memory so weight logging
  // appends to the latest in-memory copy (no Firestore round-trip per log, which
  // would race and drop points when logging quickly).
  const planWrapRef = useRef(null);
  // The exact payloads we last wrote ourselves, so the live-sync listeners below
  // can ignore our own echoed writes (vs. a real change from the trainer / AI)
  // — and, for the plan wrapper, so an echo can't reset the race-sensitive
  // planWrapRef mid-log.
  const lastSelfDataWrite = useRef(null);
  const lastSelfLogWrite = useRef(null);
  const lastSelfReqWrite = useRef(null);

  const todayKey = ymdLocal();
  const logKey = planLogPrefix(activePlanId) + todayKey;
  const get = (k) => window.storage.get(k);
  const set = (k, v) => window.storage.set(k, v);

  // Load the manifest, resolve the active plan, then read that plan's data, log,
  // and the account-level request list. Pass a planId to switch plans.
  const load = async (planId) => {
    const m = await readPlansManifest(get);
    const active = planId || m.active;
    setPlans(m.plans);
    setActivePlanId(active);
    try {
      const r = await get(planDataKey(active));
      const obj = r && r.value ? (JSON.parse(r.value) || {}) : null;
      planWrapRef.current = obj;
      setPlanData(obj ? (obj.data || null) : null);
    } catch { planWrapRef.current = null; setPlanData(null); }
    try {
      const r = await get(planLogPrefix(active) + todayKey);
      setLog(r && r.value ? (JSON.parse(r.value) || {}) : {});
    } catch { setLog({}); }
    try {
      const r = await get(REQUEST_KEY);
      setRequests(r && r.value ? (JSON.parse(r.value) || []) : []);
    } catch { setRequests([]); }
  };
  useEffect(() => { load(); }, []);

  // ── Live sync: the client's own home updates in real time ──
  // When the trainer (or the AI on the client's behalf) edits the client's
  // active plan, today's log, or sends a request, the home reflects it without a
  // manual ↻ Refresh. Self-writes are echo-suppressed (the lastSelf* refs) so an
  // echo can't reset the race-sensitive planWrapRef mid-log.
  useEffect(() => {
    if (!meUid || !activePlanId) return;
    const pid = activePlanId;
    const unsubs = [];
    // Plan structure (weight, goal, targets, workout program, weigh-ins)
    unsubs.push(subscribeForUser(meUid, planDataKey(pid), (value) => {
      if (value == null) return;
      if (value === lastSelfDataWrite.current) return; // our own echoed write
      let obj; try { obj = JSON.parse(value) || {}; } catch { return; }
      planWrapRef.current = obj;
      setPlanData(obj.data || null);
    }));
    // Today's daily log
    unsubs.push(subscribeForUser(meUid, planLogPrefix(pid) + todayKey, (value) => {
      if (value === lastSelfLogWrite.current) return;
      let parsed = {}; if (value) { try { parsed = JSON.parse(value) || {}; } catch { parsed = {}; } }
      setLog(parsed);
    }));
    // Trainer → client requests (new to-dos appear instantly)
    unsubs.push(subscribeForUser(meUid, REQUEST_KEY, (value) => {
      if (value === lastSelfReqWrite.current) return;
      let parsed = []; if (value) { try { parsed = JSON.parse(value) || []; } catch { parsed = []; } }
      setRequests(parsed);
    }));
    return () => unsubs.forEach((u) => { try { u(); } catch { /* ignore */ } });
  }, [meUid, activePlanId, todayKey]);

  // Switch the active plan (persists the choice in the manifest) and reload.
  const switchPlan = async (id) => {
    const m = await readPlansManifest(get);
    await writePlansManifest(set, { ...m, active: id });
    setShowPlans(false);
    await load(id);
  };
  // Create a new (empty) plan and make it active.
  const createPlan = async (name) => {
    const m = await readPlansManifest(get);
    const id = `p${Date.now()}`;
    const next = { active: id, plans: [...m.plans, { id, name: name || `Plan ${m.plans.length + 1}`, createdAt: Date.now() }] };
    await writePlansManifest(set, next);
    await set(planDataKey(id), JSON.stringify({ data: {}, step: 0 }));
    await appendHistory(`created a new plan: "${name || `Plan ${m.plans.length + 1}`}"`);
    await load(id);
  };
  // Rename a plan in the manifest.
  const renamePlan = async (id, name) => {
    const m = await readPlansManifest(get);
    await writePlansManifest(set, { ...m, plans: m.plans.map((p) => p.id === id ? { ...p, name: name || p.name } : p) });
    setPlans((prev) => prev.map((p) => p.id === id ? { ...p, name: name || p.name } : p));
  };
  // Delete a plan (and its data/history). Can't delete the last one or "self".
  const deletePlan = async (id) => {
    const m = await readPlansManifest(get);
    if (m.plans.length <= 1 || id === "self") return;
    const remaining = m.plans.filter((p) => p.id !== id);
    const nextActive = m.active === id ? remaining[0].id : m.active;
    await writePlansManifest(set, { active: nextActive, plans: remaining });
    try { await window.storage.delete(planDataKey(id)); } catch { /* ignore */ }
    try { await window.storage.delete(planHistoryKey(id)); } catch { /* ignore */ }
    await load(nextActive);
  };

  // Mark a request done (the client completed it). Updates status in their own
  // caliq-requests and notes it in history so the trainer's feed reflects it.
  const markRequestDone = async (id) => {
    const next = requests.map((r) => r.id === id
      ? { ...r, status: "done", doneAt: Date.now() } : r);
    setRequests(next);
    try { const s = JSON.stringify(next); lastSelfReqWrite.current = s; await window.storage.set(REQUEST_KEY, s); } catch { /* ignore */ }
    const done = requests.find((r) => r.id === id);
    if (done) await appendHistory(`completed request: "${done.prompt}"`);
  };

  // Cooperative history (same shape App.appendHistory writes) so the trainer's
  // activity feed reflects quick-logs done from this dashboard.
  const appendHistory = async (action) => {
    try {
      const hk = planHistoryKey(activePlanId);
      const r = await window.storage.get(hk);
      const cur = r && r.value ? (JSON.parse(r.value) || []) : [];
      const now = Date.now();
      const ev = { id: `e${now}${Math.floor(Math.random() * 1000)}`,
        uid: meUid, role, name: meName || "Me", action, ts: now };
      await window.storage.set(hk, JSON.stringify([ev, ...cur].slice(0, 250)));
    } catch { /* ignore */ }
  };

  const writeLog = async (updated) => {
    setLog(updated);
    try { const s = JSON.stringify(updated); lastSelfLogWrite.current = s; await window.storage.set(logKey, s); } catch { /* ignore */ }
  };
  // Add (sign +1) or remove (sign -1) calories from today's running total,
  // clamped so it can't go below zero.
  const adjustCalories = async (sign, explicitVal) => {
    const v = Number(explicitVal != null ? explicitVal : calDraft);
    if (!v || v <= 0) { setCalDraft(""); return false; }
    const next = Math.max(0, (log.calories || 0) + sign * v);
    await writeLog({ ...log, calories: next });
    await appendHistory(sign > 0 ? `logged ${v} cal` : `removed ${v} cal`);
    setCalDraft(""); setMsg(sign > 0 ? `Added ${v} cal to today.` : `Removed ${v} cal from today.`);
    return true;
  };
  // Log today's weight: records it in the daily log AND updates the plan's
  // current weight (so the card, "lbs to go", and calorie target all reflect it).
  // The first weigh-in captures a starting baseline so we can show total change.
  const logWeight = async (explicitVal) => {
    const v = Number(explicitVal != null ? explicitVal : wtDraft);
    if (!v || v <= 0) { setWtDraft(""); return false; }
    await writeLog({ ...log, weight: v });
    try {
      // Work from the in-memory plan (updated synchronously before the async
      // write) so rapid logs stay consistent instead of racing the network.
      const obj = planWrapRef.current
        ? JSON.parse(JSON.stringify(planWrapRef.current)) : { data: {}, step: 0 };
      const d = obj.data || (obj.data = {});
      const prev = Number(d.weightLbs) || v;
      if (d.startWeightLbs == null || d.startWeightLbs === "") d.startWeightLbs = prev;
      d.weightLbs = v;
      // Record in check-in history — the app's weight-history source (feeds the
      // progress chart + trainer view). One entry per day: replace today's
      // weigh-in (and clear any same-day duplicates), matching the check-in editor.
      if (!Array.isArray(d.checkIns)) d.checkIns = [];
      d.checkIns = d.checkIns.filter(c => c.date !== todayKey);
      d.checkIns.push({ date: todayKey, timestamp: new Date(todayKey + "T12:00:00").getTime(),
        weight: v, calories: null, hitTarget: null, workedOut: null, mood: null, notes: "",
        bodyFat: null, loggedBy: "client", isFuturePlan: false });
      planWrapRef.current = obj;   // update memory FIRST so the next log is consistent
      setPlanData(d);
      { const _pw = JSON.stringify(obj); lastSelfDataWrite.current = _pw; await window.storage.set(planDataKey(activePlanId), _pw); }
    } catch { /* ignore */ }
    await appendHistory(`logged weight: ${v} lbs`);
    setWtDraft(""); setWtMsg(`Logged today's weight: ${v} lbs.`);
    return true;
  };

  // Mark today as a workout day (records workedOut=true on today's check-in,
  // creating one if needed). Used by the "Record a workout" quick action.
  const markWorkoutToday = async (note) => {
    try {
      const obj = planWrapRef.current
        ? JSON.parse(JSON.stringify(planWrapRef.current)) : { data: {}, step: 0 };
      const d = obj.data || (obj.data = {});
      if (!Array.isArray(d.checkIns)) d.checkIns = [];
      const existing = d.checkIns.find(c => c.date === todayKey);
      if (existing) {
        existing.workedOut = true;
        if (note) existing.notes = note;
      } else {
        d.checkIns.push({ date: todayKey, timestamp: new Date(todayKey + "T12:00:00").getTime(),
          weight: null, calories: null, hitTarget: null, workedOut: true, mood: null,
          notes: note || "", bodyFat: null, loggedBy: "client", isFuturePlan: false });
      }
      planWrapRef.current = obj;
      setPlanData(d);
      { const _pw = JSON.stringify(obj); lastSelfDataWrite.current = _pw; await window.storage.set(planDataKey(activePlanId), _pw); }
    } catch { return false; }
    await appendHistory(note ? `recorded a workout: "${note}"` : `recorded a workout`);
    return true;
  };

  // Delete a single weigh-in (by its timestamp). Re-points current weight to the
  // latest remaining weigh-in (or back to the starting weight if none remain).
  const deleteWeighIn = async (ts) => {
    try {
      const obj = planWrapRef.current ? JSON.parse(JSON.stringify(planWrapRef.current)) : null;
      if (!obj || !Array.isArray((obj.data || {}).checkIns)) return;
      const d = obj.data;
      const removed = d.checkIns.find(c => c.timestamp === ts);
      d.checkIns = d.checkIns.filter(c => c.timestamp !== ts);
      const remaining = d.checkIns.filter(c => c.weight).sort((a, b) => a.timestamp - b.timestamp);
      if (remaining.length) d.weightLbs = remaining[remaining.length - 1].weight;
      else if (d.startWeightLbs) d.weightLbs = d.startWeightLbs;
      planWrapRef.current = obj;
      setPlanData(d);
      { const _pw = JSON.stringify(obj); lastSelfDataWrite.current = _pw; await window.storage.set(planDataKey(activePlanId), _pw); }
      await appendHistory(`deleted a weigh-in${removed && removed.weight ? `: ${removed.weight} lbs` : ""}`);
    } catch { /* ignore */ }
  };

  const cal = planData ? computeClientCalories(planData) : null;
  const w = planData ? Number(planData.weightLbs) : 0;
  const g = planData ? Number(planData.goalWeight) : 0;
  const toGo = (w && g) ? Math.round((w - g) * 10) / 10 : null;
  // Optional goal-range band (low–high) and where the current weight sits in it.
  const rLo = planData ? Number(planData.goalRangeLow) : 0;
  const rHi = planData ? Number(planData.goalRangeHigh) : 0;
  const hasRange = rLo > 0 && rHi > 0 && rLo < rHi;
  const inRange = hasRange && w >= rLo && w <= rHi;
  const rangeGap = !hasRange ? null
    : w < rLo ? Math.round((rLo - w) * 10) / 10   // below the band
    : w > rHi ? Math.round((w - rHi) * 10) / 10   // above the band
    : 0;
  const start = planData ? Number(planData.startWeightLbs) : 0;
  const change = (start && w) ? Math.round((w - start) * 10) / 10 : null; // since start
  // Is the change moving toward the goal? (loss-goal: down good; gain-goal: up good)
  const towardGoal = (g && start && change) ? ((g < start) ? change < 0 : change > 0) : null;
  // Previous weigh-in (so the client can see the difference): the reading just
  // before the current one, falling back to the starting weight.
  const weighIns = [...((planData && planData.checkIns) || [])].filter(c => c.weight)
    .sort((a, b) => a.timestamp - b.timestamp);
  const prevWeight = weighIns.length >= 2 ? weighIns[weighIns.length - 2].weight
    : (start && start !== w ? start : null);
  // Realistic time-to-goal from the client's ACTUAL logged trend (not the
  // theoretical 1 lb/wk). Needs a few weigh-ins spread over time.
  const trend = planData ? weightTrend(planData.checkIns) : null;
  const rate = trend ? trend.ratePerWeek : null;           // lbs/wk, signed
  const goalEtaWks = (rate != null && g) ? etaWeeks(w, g, rate) : null;
  const rangeEdge = (hasRange && !inRange) ? (w > rHi ? rHi : rLo) : null;
  const rangeEtaWks = (rate != null && rangeEdge != null) ? etaWeeks(w, rangeEdge, rate) : null;
  const etaDate = (wks) => {
    if (wks == null || wks > 260) return null; // cap absurd projections (~5 yrs)
    const d = new Date(Date.now() + wks * 7 * 86400000);
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  };

  const consumed = log.calories || 0;
  const target = cal ? cal.target : null;
  const remaining = target != null ? target - consumed : null;
  const firstName = (planData && planData.firstName) || (meName ? meName.split(" ")[0] : "");

  // Tailwind class strings (Session 26 redesign — brand theme via data-theme="pro").
  const cardCls = "bg-surface border border-border rounded-card p-5";
  const inputCls = "flex-1 min-w-0 bg-surface2 border border-border rounded-lg px-3 py-2.5 text-fg text-[.95rem] outline-none placeholder:text-muted";
  const primaryBtnCls = "px-4 py-2.5 rounded-lg font-bold text-sm bg-primaryfill text-primaryfg cursor-pointer whitespace-nowrap";
  const ghostBtnCls = "px-4 py-2.5 rounded-lg font-semibold text-sm bg-transparent text-fg border border-border cursor-pointer whitespace-nowrap";
  const miniBtnCls = "px-2.5 py-1.5 rounded-md text-xs font-semibold bg-transparent text-fg border border-border cursor-pointer whitespace-nowrap";
  const miniBtnActiveCls = "px-2.5 py-1.5 rounded-md text-xs font-bold bg-primaryfill text-primaryfg border-0 cursor-pointer whitespace-nowrap";

  return (
    <div data-theme="pro" className="page-transition min-h-screen bg-bg text-fg" style={{ fontFamily: "var(--font-sans)" }}>
      <style>{css}</style>
      {/* Slim brand header — min-height clears the fixed hamburger (App chrome). */}
      <div className="flex items-center justify-center min-h-[54px] px-14 border-b border-border">
        <BrandLogo />
      </div>
      <div className="max-w-[640px] mx-auto px-4 pt-6 pb-28">
        <div className="flex items-center justify-between mb-5">
          <div className="text-2xl font-extrabold tracking-tight">
            {firstName ? `Hi, ${firstName} 👋` : "Your dashboard"}
          </div>
          <button onClick={() => load()} title="Reload the latest from your plan"
            className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-border bg-transparent text-muted cursor-pointer whitespace-nowrap">
            ↻ Refresh
          </button>
        </div>

        {/* Plan switcher (Session 21) — pick the active plan, or make a new one. */}
        {planData !== undefined && (planData || plans.length > 1) && (
          <div className="mb-4">
            <button onClick={() => setShowPlans((s) => !s)}
              className="w-full flex justify-between items-center px-3.5 py-2.5 rounded-card border border-border bg-surface text-fg cursor-pointer">
              <span className="font-semibold text-sm inline-flex items-center gap-1.5">
                <Icon name="folder" size={15} color="var(--accent)" />{(plans.find((p) => p.id === activePlanId) || {}).name || "Main plan"}
                {plans.length > 1 ? <span className="text-muted font-normal"> · {plans.length} plans</span> : ""}
              </span>
              <span className="text-muted">{showPlans ? "▴" : "▾"}</span>
            </button>
            {showPlans && (
              <div className="mt-1.5 p-2 rounded-card border border-border bg-surface2 flex flex-col gap-1">
                {plans.map((p) => (
                  <div key={p.id} className="flex items-center gap-1.5 px-2 py-1.5 rounded-md"
                    style={p.id === activePlanId ? { background: "color-mix(in srgb, var(--color-primary) 12%, transparent)" } : undefined}>
                    {renamingPlanId === p.id ? (
                      <>
                        <input autoFocus value={planNameDraft} onChange={(e) => setPlanNameDraft(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter") { renamePlan(p.id, planNameDraft.trim()); setRenamingPlanId(null); } }}
                          className="flex-1 px-2 py-1 rounded border border-border bg-bg text-fg text-sm outline-none" />
                        <button onClick={() => { renamePlan(p.id, planNameDraft.trim()); setRenamingPlanId(null); }}
                          className="border-0 bg-primaryfill text-primaryfg font-bold rounded px-2.5 py-1 text-xs cursor-pointer">Save</button>
                      </>
                    ) : (
                      <>
                        <button onClick={() => switchPlan(p.id)}
                          className={`flex-1 text-left border-0 bg-transparent cursor-pointer text-fg text-sm ${p.id === activePlanId ? "font-bold" : "font-normal"}`}>
                          {p.id === activePlanId ? "● " : "○ "}{p.name}
                        </button>
                        <button onClick={() => { setPlanNameDraft(p.name); setRenamingPlanId(p.id); }} title="Rename"
                          className="border-0 bg-transparent text-muted cursor-pointer text-sm">✎</button>
                        {p.id !== "self" && plans.length > 1 && (
                          <button onClick={() => deletePlan(p.id)} title="Delete plan"
                            className="border-0 bg-transparent text-danger cursor-pointer text-sm">✕</button>
                        )}
                      </>
                    )}
                  </div>
                ))}
                <button onClick={() => createPlan()}
                  className="mt-1 p-2 rounded-md cursor-pointer font-bold text-sm border border-dashed border-border bg-transparent text-primary">
                  + New plan
                </button>
              </div>
            )}
          </div>
        )}

        {/* Trainer requests — actionable to-dos at the very top (Session 19).
            The client can hide these (some users just want the chat / one feature
            and don't want to-do nudges) — data still arrives, just not shown. */}
        {(() => {
          const openReqs = requests.filter((r) => r.status !== "done");
          if (openReqs.length === 0) return null;
          if (!np.master) return null; // all notifications silenced (master off) → show nothing
          if (!np.trainerReminders) {
            return (
              <div className="mb-4 flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-surface2 border border-border">
                <span className="text-muted text-xs">
                  🔕 {openReqs.length} trainer reminder{openReqs.length !== 1 ? "s" : ""} hidden
                </span>
                <button onClick={() => onSetNotifPrefs({ trainerReminders: true })}
                  className="border-0 bg-transparent text-primary cursor-pointer text-xs font-bold whitespace-nowrap">Show</button>
              </div>
            );
          }
          return (
            <div className={`${cardCls} mb-4 border-primary`}
              style={{ background: "color-mix(in srgb, var(--color-primary) 6%, var(--color-surface))" }}>
              <div className="flex justify-between items-start gap-2 mb-0.5">
                <div className="font-display text-base tracking-wide text-primary uppercase flex items-center gap-2"><Icon name="inbox" size={18} color="var(--accent)" />From your trainer</div>
                <button onClick={() => onSetNotifPrefs({ trainerReminders: false })} title="Hide trainer reminders"
                  className="border-0 bg-transparent text-muted cursor-pointer text-xs font-bold whitespace-nowrap">🔕 Hide</button>
              </div>
              <div className="text-muted text-sm mb-3">
                {openReqs.length} thing{openReqs.length !== 1 ? "s" : ""} to do
              </div>
              <div className="flex flex-col gap-2">
                {openReqs.map((r) => {
                  const tmpl = REQUEST_TEMPLATES.find((t) => t.type === r.type);
                  return (
                    <div key={r.id} className="px-3 py-2.5 rounded-lg bg-surface2 border border-border">
                      <div className="text-[.9rem] text-fg mb-2">
                        {tmpl ? `${tmpl.icon} ` : "📝 "}{r.prompt}
                      </div>
                      <div className="flex gap-2 flex-wrap">
                        <button onClick={() => setQuickReq(r)} className={primaryBtnCls}>Do it now →</button>
                        <button onClick={() => markRequestDone(r.id)} className={ghostBtnCls}>✓ Mark done</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()}

        {planData === undefined ? (
          <div className={cardCls}><div className="text-muted text-sm">Loading your plan…</div></div>
        ) : planData === null || !w ? (
          // No plan set up yet — friendly get-started prompt instead of empty cards.
          <div className={cardCls}>
            <div className="font-display text-base tracking-wide text-primary uppercase mb-1">📋 Get started</div>
            <div className="text-muted text-sm mb-4">
              You don't have a plan set up yet. Open it to enter your details and
              goals — or if your trainer linked one, it'll be waiting for you.
            </div>
            <button onClick={onOpenPlan} className={`${primaryBtnCls} w-full py-3 text-base`}>Set up my plan</button>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {/* Notification nudges (Session 77) — gentle, gated by notifPrefs + a
                session dismiss, and only shown when actually relevant. */}
            {(() => {
              const nudges = [];
              const loggedToday = (Number(log.calories) || 0) > 0 || (Array.isArray(log.meals) && log.meals.length > 0);
              const hour = new Date().getHours();
              // Food-logging reminder — nothing logged yet and it's past midday.
              if (np.master && np.foodReminders !== false && !nudgeDismiss.food && !loggedToday && hour >= 12) {
                nudges.push({ key: "food", icon: "🍽️", text: "You haven't logged any food today.",
                  cta: { label: "Log now", onClick: onOpenPlan } });
              }
              // Weigh-in reminder — no weigh-in in the last 7 days.
              const weighIns = (planData.checkIns || []).filter((c) => c.weight && c.timestamp).sort((a, b) => b.timestamp - a.timestamp);
              const daysSinceWeigh = weighIns.length ? Math.floor((Date.now() - weighIns[0].timestamp) / 86400000) : null;
              if (np.master && np.weighInReminders !== false && !nudgeDismiss.weigh && (daysSinceWeigh === null || daysSinceWeigh >= 7)) {
                nudges.push({ key: "weigh", icon: "⚖️",
                  text: daysSinceWeigh === null ? "Log your first weigh-in to start tracking progress." : `It's been ${daysSinceWeigh} days since your last weigh-in.`,
                  cta: { label: "Weigh in", onClick: () => setShowWt(true) } });
              }
              // AI coaching tip — one a day, rotating.
              if (np.master && np.coachingNudges !== false && !nudgeDismiss.coach) {
                const tip = COACH_TIPS[new Date().getDate() % COACH_TIPS.length];
                nudges.push({ key: "coach", icon: "💡", text: tip });
              }
              if (!nudges.length) return null;
              return (
                <div className="flex flex-col gap-2">
                  {nudges.map((n) => (
                    <div key={n.key} className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg bg-surface2 border border-border">
                      <span className="text-base shrink-0">{n.icon}</span>
                      <span className="text-[.85rem] text-fg flex-1 min-w-0">{n.text}</span>
                      {n.cta && (
                        <button onClick={n.cta.onClick} className={`${miniBtnCls} shrink-0`}>{n.cta.label}</button>
                      )}
                      <button onClick={() => setNudgeDismiss((d) => ({ ...d, [n.key]: true }))} aria-label="Dismiss"
                        className="shrink-0 border-0 bg-transparent text-muted cursor-pointer text-sm px-1">✕</button>
                    </div>
                  ))}
                </div>
              );
            })()}
            {/* Weight → goal HERO (Option 2: big number + stat tiles + progress bar) */}
            <div className={cardCls}>
              <div className="flex justify-between items-center gap-2 mb-1">
                <div className="font-display text-base tracking-wide text-primary uppercase flex items-center gap-2"><Icon name="target" size={18} color="var(--accent)" />Weight &amp; goal</div>
                <div className="flex gap-1.5">
                  <button className={miniBtnCls} onClick={() => setShowChart(true)} title="See your progress chart">📈 Progress</button>
                  <button className={showWt ? miniBtnActiveCls : miniBtnCls}
                    onClick={() => setShowWt(s => !s)} title="Log today's weight">
                    {showWt ? "Close" : "✎ Log"}
                  </button>
                </div>
              </div>
              {/* Hero current weight + previous weigh-in line */}
              <div className="font-display text-6xl leading-none mt-1">{w}<span className="text-2xl text-muted ml-1">lbs</span></div>
              {prevWeight != null && (
                <div className="mt-1.5 text-sm text-muted">
                  Previous: {prevWeight} lbs{w ? ` (${w - prevWeight > 0 ? "+" : ""}${Math.round((w - prevWeight) * 10) / 10} lbs)` : ""}
                </div>
              )}
              {/* Glanceable stat tiles */}
              <div className="grid grid-cols-3 gap-2 mt-4">
                <div className="bg-surface2 rounded-lg py-3 text-center">
                  <div className="font-display text-2xl leading-none text-fg">{g || "—"}</div>
                  <div className="text-[10px] uppercase tracking-wide text-muted mt-1">Goal</div>
                </div>
                <div className="bg-surface2 rounded-lg py-3 text-center">
                  <div className={`font-display text-2xl leading-none ${toGo != null && toGo !== 0 ? "text-primary" : "text-fg"}`}>{toGo != null ? Math.abs(toGo) : "—"}</div>
                  <div className="text-[10px] uppercase tracking-wide text-muted mt-1">lbs to {toGo != null && toGo < 0 ? "gain" : "go"}</div>
                </div>
                <div className="bg-surface2 rounded-lg py-3 text-center">
                  <div className={`font-display text-2xl leading-none ${change == null ? "text-fg" : towardGoal ? "text-success" : "text-danger"}`}>{change != null ? `${change < 0 ? "−" : "+"}${Math.abs(change)}` : "—"}</div>
                  <div className="text-[10px] uppercase tracking-wide text-muted mt-1">Since start</div>
                </div>
              </div>
              {/* Progress bar from start → goal */}
              {g && start && start !== g && (
                <div className="mt-4">
                  <div className="h-2.5 rounded-full bg-surface2 overflow-hidden">
                    <div className="h-full bg-primaryfill rounded-full" style={{ width: `${Math.max(2, Math.min(100, Math.round(((start - w) / (start - g)) * 100)))}%` }} />
                  </div>
                  <div className="flex justify-between text-[11px] text-muted mt-1">
                    <span>Start {start}</span><span>Goal {g}</span>
                  </div>
                </div>
              )}
              {hasRange && (
                <div className="mt-3 text-sm">
                  <span className="text-muted">Healthy range: {rLo}–{rHi} lbs</span>
                  {" · "}
                  <span className={`font-semibold ${inRange ? "text-success" : "text-warn"}`}>
                    {inRange ? "✅ in range" : w < rLo ? `${rangeGap} below` : `${rangeGap} above`}
                  </span>
                </div>
              )}
              {showWt && (
                <div className="mt-4">
                  <div className="text-sm text-muted mb-1.5">Log today's weight</div>
                  <div className="flex gap-2">
                    <input className={inputCls} type="number" inputMode="decimal" placeholder="Today's weight (lbs)"
                      value={wtDraft} onChange={e => setWtDraft(e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter") logWeight(); }} autoFocus />
                    <button className={primaryBtnCls} onClick={logWeight}>Log</button>
                  </div>
                  {wtMsg ? <div className="mt-2 text-sm text-muted">{wtMsg}</div> : null}
                </div>
              )}
            </div>

            {/* Projected timeline from the actual logged trend */}
            <div className={cardCls}>
              <div className="font-display text-base tracking-wide text-primary uppercase mb-2 flex items-center gap-2"><Icon name="clock" size={18} color="var(--accent)" />Time to goal</div>
              {!g ? (
                <div className="text-muted text-sm">Set a goal weight to see your projected timeline.</div>
              ) : rate == null ? (
                <div className="text-muted text-sm">
                  Log a few weigh-ins over the next couple of weeks and we'll project your
                  timeline from your <em>actual</em> rate of progress.
                </div>
              ) : (
                <>
                  <div className="text-[.9rem] font-semibold">
                    {Math.abs(rate) < 0.05
                      ? "Your weight is holding steady right now."
                      : `${rate < 0 ? "Losing" : "Gaining"} about ${Math.abs(Math.round(rate * 10) / 10)} lbs/week`}
                    <span className="text-muted font-normal text-xs">{" "}· from {trend.n} weigh-ins</span>
                  </div>
                  {goalEtaWks == null ? (
                    <div className="mt-1.5 text-sm text-warn font-semibold">
                      Not trending toward your goal yet — adjust and keep logging.
                    </div>
                  ) : goalEtaWks === 0 ? (
                    <div className="mt-1.5 text-sm text-success font-bold">🎉 You're at your goal weight!</div>
                  ) : (
                    <div className="mt-1.5 text-[.88rem]">
                      Reach <strong>{g} lbs</strong> by{" "}
                      <strong className="text-primary">{etaDate(goalEtaWks) || "—"}</strong>
                      <span className="text-muted"> · ~{friendlyTime(goalEtaWks)}</span>
                    </div>
                  )}
                  {rangeEtaWks != null && rangeEtaWks > 0 && etaDate(rangeEtaWks) && (
                    <div className="mt-1 text-sm text-muted">
                      Into your range (~{rangeEdge} lbs) by {etaDate(rangeEtaWks)}
                    </div>
                  )}
                  <div className="mt-2 text-xs text-muted italic">
                    Estimate from your logged trend — it sharpens as you log more.
                  </div>
                </>
              )}
            </div>

            {/* Today's calories + quick-log */}
            <div className={cardCls}>
              <div className="font-display text-base tracking-wide text-primary uppercase mb-2 flex items-center gap-2"><Icon name="meal" size={18} color="var(--accent)" />Today</div>
              {target != null ? (
                <>
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <span className="font-display text-4xl leading-none">{consumed.toLocaleString()}</span>
                    <span className="text-muted">/ {target.toLocaleString()} cal</span>
                    <span className={`ml-auto font-bold ${remaining >= 0 ? "text-success" : "text-danger"}`}>
                      {remaining >= 0 ? `${remaining.toLocaleString()} left` : `${Math.abs(remaining).toLocaleString()} over`}
                    </span>
                  </div>
                  <div className="h-2.5 rounded-full bg-surface2 overflow-hidden mt-3">
                    <div className="h-full rounded-full" style={{ width: `${Math.max(0, Math.min(100, Math.round((consumed / target) * 100)))}%`,
                      background: remaining >= 0 ? "var(--color-primary)" : "var(--color-danger)" }} />
                  </div>
                </>
              ) : (
                <div className="text-muted text-sm">Finish your plan to see a daily calorie target.</div>
              )}

              <div className="mt-3 flex flex-col gap-2">
                <input className={`${inputCls} w-full`} type="number" inputMode="numeric" placeholder="Calories"
                  value={calDraft} onChange={e => setCalDraft(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") adjustCalories(1); }} />
                <div className="flex gap-2">
                  <button className={`${ghostBtnCls} flex-1`} title="Subtract from today" onClick={() => adjustCalories(-1)}>− Remove</button>
                  <button className={`${primaryBtnCls} flex-1`} title="Add to today" onClick={() => adjustCalories(1)}>+ Add</button>
                </div>
              </div>
              {msg ? <div className="mt-2 text-sm text-muted">{msg}</div> : null}
            </div>

            <button onClick={onOpenPlan} className={`${ghostBtnCls} w-full py-3 text-base`}>Open my full plan</button>
          </div>
        )}

        <div style={{ marginTop: 16 }}>
          <RolePanel />
        </div>
      </div>

      {/* Progress chart popup (shared component) */}
      {showChart && (
        <WeightChartModal checkIns={(planData && planData.checkIns) || []} goalWeight={g} currentWeight={w}
          rangeLow={rLo} rangeHigh={rHi} startWeight={start}
          onDelete={deleteWeighIn} onClose={() => setShowChart(false)} />
      )}

      {/* Quick-action popup for completing a trainer request (Session 19). */}
      {quickReq && (
        <QuickActionModal request={quickReq}
          onWeighIn={(v) => logWeight(v)}
          onLogFood={(v) => adjustCalories(1, v)}
          onLogWorkout={(note) => markWorkoutToday(note)}
          onOpenPlan={onOpenPlan}
          onMarkDone={() => markRequestDone(quickReq.id)}
          onClose={() => setQuickReq(null)} />
      )}

      {/* AI assistant — floating button + collapsible chat (Session 61).
          onDataChanged reloads the plan/log when the AI logs a meal (Session 63). */}
      <AIChatPanel role={role} onDataChanged={() => load(activePlanId)} />
    </div>
  );
}

function ProfileSelector({ profiles, folders, onSelect, onNew, onDelete, loading,
  onCreateFolder, onRenameFolder, onDeleteFolder, onMoveProfile,
  confirmDeleteId, confirmFolderDel, onRecover, onExport, onImport,
  onClipCopy, onClipPaste, showDashboardTab, onShowDashboard, onOpenClientPlan, onLinked, onCopyToLocal, onRename }) {

  const [openFolders, setOpenFolders] = useState({});
  const [renamingId, setRenamingId] = useState(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [dragId, setDragId] = useState(null);
  const [dragOverFolder, setDragOverFolder] = useState(null);
  const [newFolderName, setNewFolderName] = useState("");
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [editingFolder, setEditingFolder] = useState(null);
  const [editName, setEditName] = useState("");
  const [recoverMsg, setRecoverMsg] = useState(null);
  const [exportMsg, setExportMsg] = useState(null);
  const [showPasteBox, setShowPasteBox] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [clipMsg, setClipMsg] = useState(null);
  const folderInputRef = useRef(null);
  const importInputRef = useRef(null);
  const pasteRef = useRef(null);

  useEffect(()=>{ if(showNewFolder && folderInputRef.current) folderInputRef.current.focus(); },[showNewFolder]);

  const toggleFolder = (id) => setOpenFolders(p=>({...p,[id]:!p[id]}));
  // Simulations are sandbox plans — they live in their own section on the
  // dashboard, not in the All-clients folders.
  const sorted = [...profiles].filter(p=>!p.isSimulation).sort((a,b)=>(b.lastSaved||0)-(a.lastSaved||0));
  const unfiled = sorted.filter(p=>!p.folderId);
  const inFolder = (fid) => sorted.filter(p=>p.folderId===fid);

  // Drag handlers
  const onDragStart = (e, profileId) => { setDragId(profileId); e.dataTransfer.effectAllowed="move"; };
  const onDragEnd = () => { setDragId(null); setDragOverFolder(null); };
  const onFolderDragOver = (e, folderId) => { e.preventDefault(); e.dataTransfer.dropEffect="move"; setDragOverFolder(folderId); };
  const onFolderDragLeave = () => setDragOverFolder(null);
  const onFolderDrop = (e, folderId) => {
    e.preventDefault();
    if (dragId) { onMoveProfile(dragId, folderId); setDragId(null); setDragOverFolder(null); }
  };

  // Tailwind class strings (Session 29 redesign — brand theme via data-theme="pro").
  const cardCls = "bg-surface border border-border rounded-card p-5 mb-3";
  const sectionTitleCls = "font-display text-lg tracking-wider text-primary mb-1";
  const subCls = "text-sm text-muted leading-relaxed";
  const primaryBtnCls = "px-4 py-2.5 rounded-lg text-sm font-bold border-none bg-primaryfill text-primaryfg cursor-pointer whitespace-nowrap disabled:opacity-55";
  const ghostBtnCls = "px-3 py-2 rounded-lg text-xs font-semibold border border-border bg-transparent text-fg cursor-pointer whitespace-nowrap disabled:opacity-55";
  const inputCls = "flex-1 min-w-0 box-border rounded-lg border border-border bg-surface2 text-fg px-3 py-2 text-sm outline-none placeholder:text-muted";

  const ProfileCard = ({ p }) => {
    const displayName = p.customName || p.name || "Unnamed Client";
    if (renamingId === p.id) {
      return (
        <div className="flex items-center gap-1.5 p-3 rounded-[10px] bg-surface2 border border-border" onClick={e=>e.stopPropagation()}>
          <input autoFocus className={inputCls} value={renameDraft}
            placeholder="Plan name" onChange={e=>setRenameDraft(e.target.value)}
            onKeyDown={e=>{ if(e.key==="Enter"){ onRename && onRename(p.id, renameDraft); setRenamingId(null); } }} />
          <button className={primaryBtnCls + " !px-3 !py-2"}
            onClick={()=>{ onRename && onRename(p.id, renameDraft); setRenamingId(null); }}>Save</button>
          <button className={ghostBtnCls} onClick={()=>setRenamingId(null)}>Cancel</button>
        </div>
      );
    }
    return (
      <div className={`flex items-center gap-3 p-3 rounded-[10px] bg-surface2 border border-border cursor-pointer transition-opacity ${dragId===p.id?"opacity-40":""}`}
        draggable="true"
        onDragStart={e=>onDragStart(e,p.id)}
        onDragEnd={onDragEnd}
        onClick={()=>onSelect(p.id)}>
        <div className="flex-none w-10 h-10 rounded-full bg-primaryfill text-primaryfg font-bold text-sm flex items-center justify-center">
          {(displayName||"?").slice(0,2).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-[.92rem] text-fg truncate">{displayName}</div>
          <div className="text-xs text-muted truncate">
            {p.weight ? `${p.weight} lbs` : "—"}
            {p.goal ? ` → ${p.goal} lbs` : ""}
            {p.lastSaved ? ` · ${new Date(p.lastSaved).toLocaleDateString()}` : ""}
            {p.stepLabel ? ` · ${p.stepLabel}` : ""}
          </div>
        </div>
        <button className="flex-none border-none bg-transparent text-muted cursor-pointer text-[.95rem] px-1" title="Rename"
          onClick={e=>{e.stopPropagation(); setRenameDraft(displayName); setRenamingId(p.id);}}>✎</button>
        <button
          className={confirmDeleteId===p.id
            ? "flex-none cursor-pointer rounded-md border border-[rgba(248,113,113,.3)] bg-[rgba(248,113,113,.15)] text-danger text-[.68rem] font-bold px-2 py-0.5"
            : "flex-none border-none bg-transparent text-muted cursor-pointer text-[.95rem] px-1"}
          onClick={e=>{e.stopPropagation();onDelete(p.id,p.name)}}
          title="Delete">{confirmDeleteId===p.id?"Confirm?":"✕"}</button>
      </div>
    );
  };

  return (
    <div data-theme="pro" className="prof-screen page-transition min-h-screen bg-bg text-fg" style={{ fontFamily: "var(--font-sans)" }}>
      <style>{css}</style>
      {/* Slim brand header — min-height clears the fixed hamburger (App chrome). */}
      <div className="flex items-center justify-center min-h-[54px] px-14 border-b border-border">
        <BrandLogo />
      </div>
      <div className="max-w-[640px] mx-auto px-4 pt-6 pb-28">
        <div className={cardCls}>
          <div className={sectionTitleCls}>📂 Client Profiles</div>
          <div className={subCls}>
            {loading ? "Loading saved profiles..." : profiles.length > 0
              ? `${profiles.length} client${profiles.length!==1?"s":""} · ${folders.length} folder${folders.length!==1?"s":""}. Drag and drop clients between folders.`
              : "No saved profiles yet. Create a folder for your team, then add clients."
            }
          </div>

          {/* Dashboard Stats */}
          {!loading && profiles.length > 0 && (
            <div className="grid grid-cols-3 gap-2 my-4">
              <div className="bg-surface2 border border-border rounded-lg py-3 text-center">
                <div className="font-display text-2xl text-primary">{profiles.length}</div>
                <div className="text-[.66rem] uppercase tracking-wide text-muted mt-0.5">Total Clients</div>
              </div>
              <div className="bg-surface2 border border-border rounded-lg py-3 text-center">
                <div className="font-display text-2xl text-success">{profiles.filter(p => p.lastSaved && (Date.now() - p.lastSaved) < 7*86400000).length}</div>
                <div className="text-[.66rem] uppercase tracking-wide text-muted mt-0.5">Active This Week</div>
              </div>
              <div className="bg-surface2 border border-border rounded-lg py-3 text-center">
                <div className="font-display text-2xl text-warn">{folders.length}</div>
                <div className="text-[.66rem] uppercase tracking-wide text-muted mt-0.5">Folders</div>
              </div>
            </div>
          )}

          {/* Folder creation */}
          <div className="my-3">
            {showNewFolder ? (
              <div className="flex gap-2">
                <input type="text" className={inputCls} placeholder="Folder name (e.g. Kevin's Clients)"
                  ref={folderInputRef}
                  value={newFolderName} onChange={e=>setNewFolderName(e.target.value)}
                  onKeyDown={e=>{ if(e.key==="Enter"&&newFolderName.trim()){ onCreateFolder(newFolderName.trim()); setNewFolderName(""); setShowNewFolder(false); }}}
                  />
                <button className={primaryBtnCls}
                  onClick={()=>{ if(newFolderName.trim()){ onCreateFolder(newFolderName.trim()); setNewFolderName(""); setShowNewFolder(false); }}}>
                  Create
                </button>
                <button className={ghostBtnCls} onClick={()=>{setShowNewFolder(false);setNewFolderName("")}}>Cancel</button>
              </div>
            ) : (
              <button className="w-full py-2.5 rounded-lg border border-dashed border-border bg-transparent text-fg text-sm font-semibold cursor-pointer" onClick={()=>setShowNewFolder(true)}>📁 + New Folder</button>
            )}
          </div>

          {/* Folders */}
          {folders.map(folder => {
            const clients = inFolder(folder.id);
            const isOpen = openFolders[folder.id] !== false; // default open
            const isDragOver = dragOverFolder === folder.id;
            return (
              <div key={folder.id}
                className={`rounded-[10px] border mb-2.5 ${isDragOver?"border-primary bg-[rgba(8,220,224,.06)]":"border-border"}`}
                onDragOver={e=>onFolderDragOver(e,folder.id)}
                onDragLeave={onFolderDragLeave}
                onDrop={e=>onFolderDrop(e,folder.id)}>
                <div className="flex items-center gap-2 px-3 py-2.5 cursor-pointer" onClick={()=>toggleFolder(folder.id)}>
                  <span className="text-base">{isOpen?"📂":"📁"}</span>
                  {editingFolder===folder.id ? (
                    <input type="text" className={inputCls} value={editName}
                      onChange={e=>setEditName(e.target.value)}
                      onKeyDown={e=>{ if(e.key==="Enter"){ onRenameFolder(folder.id,editName); setEditingFolder(null); } if(e.key==="Escape") setEditingFolder(null); }}
                      onClick={e=>e.stopPropagation()} autoFocus />
                  ) : (
                    <span className="flex-1 font-semibold text-[.92rem] text-fg">{folder.name}</span>
                  )}
                  <span className="text-[.7rem] font-bold text-muted bg-surface2 rounded-full px-2 py-0.5">{clients.length}</span>
                  <span className={`text-muted text-xs transition-transform ${isOpen?"rotate-0":"-rotate-90"}`}>▼</span>
                </div>
                {isOpen && (
                  <>
                    <div className="flex flex-col gap-2 px-3 pb-2">
                      {clients.length === 0 && (
                        <div className="text-xs text-muted italic py-3 text-center border border-dashed border-border rounded-lg">
                          {dragId ? "Drop here to move client into this folder" : "No clients yet — drag one here or create new"}
                        </div>
                      )}
                      {clients.map(p=><ProfileCard key={p.id} p={p}/>)}
                    </div>
                    <div className="flex flex-wrap gap-2 px-3 pb-3">
                      <button className={ghostBtnCls} onClick={e=>{e.stopPropagation();onNew(folder.id)}}>+ Add Client</button>
                      <button className={ghostBtnCls} onClick={e=>{e.stopPropagation();setEditingFolder(folder.id);setEditName(folder.name)}}>Rename</button>
                      <button className={confirmFolderDel===folder.id
                          ? "px-3 py-2 rounded-lg text-xs font-bold border border-[rgba(248,113,113,.4)] bg-transparent text-danger cursor-pointer whitespace-nowrap"
                          : ghostBtnCls}
                        onClick={e=>{e.stopPropagation();onDeleteFolder(folder.id)}}>
                        {confirmFolderDel===folder.id?"Tap Again to Delete":"Delete Folder"}
                      </button>
                    </div>
                  </>
                )}
              </div>
            );
          })}

          {/* Unfiled clients */}
          {unfiled.length > 0 && (
            <div className={`rounded-[10px] border mb-2.5 ${dragOverFolder==="unfiled"?"border-primary bg-[rgba(8,220,224,.06)]":"border-border"}`}
              onDragOver={e=>onFolderDragOver(e,"unfiled")}
              onDragLeave={onFolderDragLeave}
              onDrop={e=>onFolderDrop(e,null)}>
              <div className="flex items-center gap-2 px-3 py-2.5 cursor-pointer" onClick={()=>toggleFolder("unfiled")}>
                <span className="text-base">📋</span>
                <span className="flex-1 font-semibold text-[.92rem] text-muted">Unfiled</span>
                <span className="text-[.7rem] font-bold text-muted bg-surface2 rounded-full px-2 py-0.5">{unfiled.length}</span>
                <span className={`text-muted text-xs transition-transform ${openFolders["unfiled"]!==false?"rotate-0":"-rotate-90"}`}>▼</span>
              </div>
              {openFolders["unfiled"]!==false && (
                <div className="flex flex-col gap-2 px-3 pb-3">
                  {unfiled.map(p=><ProfileCard key={p.id} p={p}/>)}
                </div>
              )}
            </div>
          )}

          {/* New client (unfiled) */}
          <button className={`${primaryBtnCls} w-full py-3 mt-3`} onClick={()=>onNew(null)}>+ New Client Profile</button>
        </div>

        {/* Export / Import / Recovery */}
        <div className={cardCls}>
          <div className="text-[.82rem] font-bold text-fg mb-1">📦 Data Management</div>
          <div className="text-[.73rem] text-muted mb-3 leading-relaxed">
            📱 <strong>Phone/iPad:</strong> Use Copy & Paste to move data between devices. <strong>Laptop:</strong> File export also works.
          </div>
          <div className="text-[.65rem] text-primary leading-snug mb-3 italic">
            ℹ️ This section is only needed in the current version. Once Glide becomes a web app, your data syncs automatically across all devices — no exporting or importing needed.
          </div>

          {/* Clipboard — primary method for mobile */}
          <div className="flex gap-2 mb-2 flex-wrap">
            <button className="flex-[1_1_140px] min-h-[44px] text-[.82rem] font-semibold rounded-lg border border-success text-success bg-[rgba(47,224,168,.08)] cursor-pointer"
              onClick={async ()=>{
                setClipMsg("Copying...");
                const result = await onClipCopy();
                if (result === true) {
                  setClipMsg("✅ Copied to clipboard! Paste on your other device.");
                } else {
                  setClipMsg("⚠️ Clipboard blocked — use File Export below instead.");
                }
                setTimeout(()=>setClipMsg(null), 6000);
              }}>
              📋 Copy All to Clipboard
            </button>
            <button className="flex-[1_1_140px] min-h-[44px] text-[.82rem] font-semibold rounded-lg border border-border bg-transparent text-fg cursor-pointer"
              onClick={()=>{setShowPasteBox(v=>!v); setPasteText("");}}>
              📋 Paste to Restore
            </button>
          </div>

          {clipMsg && <div className={`text-sm mb-2 text-center leading-snug ${clipMsg.startsWith("✅")?"text-success":clipMsg.startsWith("⚠️")?"text-warn":"text-muted"}`}>{clipMsg}</div>}

          {showPasteBox && (
            <div className="mb-2.5">
              <textarea
                ref={pasteRef}
                placeholder="Paste your Glide backup here..."
                value={pasteText}
                onChange={e=>setPasteText(e.target.value)}
                className="w-full min-h-[80px] p-3 rounded-lg border border-primary bg-surface2 text-fg font-mono text-[.75rem] resize-y outline-none"
              />
              <div className="flex gap-2 mt-1.5">
                <button className={`${primaryBtnCls} flex-1`}
                  disabled={!pasteText.trim()}
                  onClick={async ()=>{
                    setClipMsg("Importing...");
                    const result = await onClipPaste(pasteText);
                    setClipMsg(result.ok ? `✅ ${result.msg}` : `❌ ${result.msg}`);
                    if(result.ok){ setPasteText(""); setShowPasteBox(false); }
                    setTimeout(()=>setClipMsg(null), 5000);
                  }}>
                  Import Pasted Data
                </button>
                <button className={ghostBtnCls} onClick={()=>{setShowPasteBox(false);setPasteText("");}}>Cancel</button>
              </div>
            </div>
          )}

          {/* File export/import — secondary method */}
          <div className="text-[.72rem] text-muted tracking-wide uppercase font-bold mb-2 mt-1.5">Or use file export</div>
          <div className="flex gap-2 mb-2.5 flex-wrap">
            <button className="flex-[1_1_140px] min-h-[42px] text-[.8rem] font-bold rounded-lg border-none bg-primaryfill text-primaryfg cursor-pointer"
              onClick={async ()=>{
                setExportMsg("Packaging...");
                const ok = await onExport();
                setExportMsg(ok ? "✅ Download started!" : "❌ Export failed");
                setTimeout(()=>setExportMsg(null), 4000);
              }}>
              📤 Export All Clients
            </button>
            <button className="flex-[1_1_140px] min-h-[42px] text-[.8rem] font-semibold rounded-lg border border-border bg-transparent text-fg cursor-pointer"
              onClick={()=>importInputRef.current?.click()}>
              📥 Import From File
            </button>
            <input ref={importInputRef} type="file" accept=".json" style={{display:"none"}}
              onChange={async (e)=>{
                const file = e.target.files?.[0];
                if (!file) return;
                setExportMsg("Importing...");
                const result = await onImport(file);
                setExportMsg(result.ok ? `✅ ${result.msg}` : `❌ ${result.msg}`);
                e.target.value = "";
                setTimeout(()=>setExportMsg(null), 5000);
              }}/>
          </div>

          {exportMsg && <div className={`text-sm mb-2 text-center ${exportMsg.startsWith("✅")?"text-success":exportMsg.startsWith("❌")?"text-danger":"text-muted"}`}>{exportMsg}</div>}

          <div className="text-[.73rem] text-muted leading-relaxed mb-2.5">
            💡 <strong>Export</strong> downloads a JSON backup of all your clients, folders, and data. <strong>Import</strong> loads a backup file and merges it with your current profiles — no data is overwritten.
          </div>

          {recoverMsg && <div className="text-sm text-success mb-2 text-center">{recoverMsg}</div>}
          <button className="bg-transparent border-none text-muted cursor-pointer text-[.73rem] underline p-1 w-full text-center"
            onClick={async ()=>{
              setRecoverMsg("Scanning storage...");
              const count = await onRecover();
              setRecoverMsg(count > 0 ? `✅ Recovered ${count} profile${count!==1?"s":""}!` : "No lost profiles found in storage.");
              setTimeout(()=>setRecoverMsg(null), 5000);
            }}>
            🔍 Recover lost profiles from storage
          </button>
        </div>

        <div className="text-center text-xs text-muted py-3">🔒 All data is stored locally on your device — nothing is sent to a server.</div>
      </div>
    </div>
  );
}

// ─── App ─────────────────────────────────────────────────────────────────────

const defaultCardio = Object.fromEntries(DAYS.map(d=>[d,[]]));
const EMPTY_DATA = {
  firstName:"", lastName:"", gender:"", age:"", weightLbs:"", heightFt:"", heightIn:"",
  goalWeight:"", activityLevel:"", cardio:defaultCardio, strength:defaultStrength,
  checkIns:[], trainerNotes:"", bodyFat:"", goalBodyFat:"",
  customExercises:[],
};
const STORAGE_INDEX = "caliq-index";
const STORAGE_FOLDERS = "caliq-folders";
const profileKey = (id) => `caliq-${id}`;

// Normalize a stored plan's `data` object into the shape the editor expects
// (back-compat name migration + cardio/strength defaults). Used by the live-sync
// listener and the manual Refresh so they merge exactly like openClientPlan.
function buildMergedData(d) {
  d = d || {};
  if (d.name && !d.firstName) {
    const parts = d.name.trim().split(/\s+/);
    d.firstName = parts[0] || ""; d.lastName = parts.slice(1).join(" ") || ""; delete d.name;
  }
  return {...EMPTY_DATA, ...d, cardio:{...defaultCardio,...(d.cardio||{})}, strength:{...defaultStrength,...(d.strength||{})}};
}

// ─── Edit history helpers (Session 10) ──────────────────────────────────────
// Short "x ago" label for an event timestamp.
function timeAgo(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24); if (d < 7) return `${d}d ago`;
  return new Date(ts).toLocaleDateString();
}

// Absolute date + time stamp, e.g. "Jun 28, 3:45 PM" — used for completed
// request timestamps where an exact moment is clearer than a relative "2d ago".
function fmtStamp(ts) {
  if (!ts) return "";
  try { return new Date(ts).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); }
  catch { return ""; }
}

// Describe meaningful plan-structure changes between two data snapshots, as a
// list of plain-English phrases (e.g. "changed goal weight to 160"). Coarse on
// purpose (one phrase per area) so the history stays readable.
function describePlanChanges(prev, next) {
  const p = prev || {}, n = next || {};
  const out = [];
  const scalar = [
    ["goalWeight", "goal weight"], ["weightLbs", "weight"], ["age", "age"],
    ["heightFt", "height (ft)"], ["heightIn", "height (in)"], ["gender", "gender"],
    ["activityLevel", "activity level"], ["bodyFat", "body fat %"], ["goalBodyFat", "goal body fat %"],
    ["firstName", "first name"], ["lastName", "last name"],
  ];
  scalar.forEach(([k, label]) => {
    const a = p[k] == null ? "" : String(p[k]);
    const b = n[k] == null ? "" : String(n[k]);
    if (a !== b) out.push(b === "" ? `cleared ${label}` : `changed ${label} to ${b}`);
  });
  if (JSON.stringify(p.cardio || {}) !== JSON.stringify(n.cardio || {})) out.push("edited the cardio plan");
  if (JSON.stringify(p.strength || {}) !== JSON.stringify(n.strength || {})) out.push("edited the strength plan");
  if ((p.trainerNotes || "") !== (n.trainerNotes || "")) out.push("updated trainer notes");
  if (JSON.stringify(p.customExercises || []) !== JSON.stringify(n.customExercises || [])) out.push("edited custom exercises");
  if ((n.checkIns || []).length > (p.checkIns || []).length) out.push("added a check-in");
  return out;
}

// ─── Navigation side menu (Session 23) ───────────────────────────────────────
// A hamburger (≡) opens a slide-out drawer with app navigation, inline name
// editing, and sign-out. Rendered globally by App so it's on every screen.
const ROLE_LABEL = { client: "Client", head_trainer: "Trainer", sub_trainer: "Trainer", admin: "Admin" };
function SideMenu({ open, onClose, role, meName, meEmail, isTrainer, trial, notifPrefs, onSetNotifPrefs, onHome, onDashboard, onClients, onNameSaved }) {
  const [editing, setEditing] = useState(false);
  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");
  const [busy, setBusy] = useState(false);
  const [invite, setInvite] = useState("");      // trainer invite code
  const [showInvite, setShowInvite] = useState(false);
  const [showNotif, setShowNotif] = useState(false); // Notification Center section (Session 76)
  const [copied, setCopied] = useState("");       // "code" | "link" | ""
  useEffect(() => {
    if (open) {
      const parts = (meName || "").trim().split(/\s+/);
      setFirst(parts[0] || ""); setLast(parts.slice(1).join(" ") || ""); setEditing(false);
      if (isTrainer && !invite) { ensureInviteCode().then((c) => setInvite(c || "")).catch(() => {}); }
    }
  }, [open, meName]);

  const saveName = async () => {
    setBusy(true);
    try { await setName(first.trim(), last.trim()); if (onNameSaved) onNameSaved(`${first.trim()} ${last.trim()}`.trim()); setEditing(false); }
    catch (e) { /* ignore */ }
    finally { setBusy(false); }
  };
  const go = (fn) => { onClose(); if (fn) fn(); };
  const shareLink = invite ? `${window.location.origin}/?invite=${invite}` : "";
  const copy = async (which, text) => { try { await navigator.clipboard.writeText(text); setCopied(which); setTimeout(() => setCopied(""), 1500); } catch { /* ignore */ } };

  const item = { display: "flex", alignItems: "center", gap: 12, width: "100%", textAlign: "left",
    padding: "13px 16px", borderRadius: 10, border: "none", background: "transparent", color: "var(--text)",
    cursor: "pointer", fontFamily: "inherit", fontSize: ".95rem", fontWeight: 600 };

  return (
    <>
      {/* Backdrop */}
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.55)", zIndex: 1400,
        opacity: open ? 1 : 0, pointerEvents: open ? "auto" : "none", transition: "opacity .25s" }} />
      {/* Drawer */}
      <div style={{ position: "fixed", top: 0, left: 0, bottom: 0, width: "min(82vw, 320px)", zIndex: 1401,
        background: "var(--surface,#16162a)", borderRight: "1px solid var(--border)", boxShadow: "var(--shadow-md)",
        transform: open ? "translateX(0)" : "translateX(-100%)", transition: "transform .28s ease",
        display: "flex", flexDirection: "column", padding: "16px 12px",
        paddingTop: "calc(16px + env(safe-area-inset-top,0px))" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0 4px 12px" }}>
          <div className="logo" style={{ fontSize: "1.4rem" }}>GLI<span>DE</span></div>
          <button onClick={onClose} style={{ ...item, width: "auto", padding: "6px 10px" }} aria-label="Close menu"><Icon name="close" size={18} color="var(--muted)" /></button>
        </div>

        {/* Identity + name edit */}
        <div style={{ padding: "12px 14px", borderRadius: 12, background: "var(--s2)", marginBottom: 12 }}>
          {editing ? (
            <div>
              <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
                <input value={first} onChange={(e) => setFirst(e.target.value)} placeholder="First"
                  style={{ flex: 1, minWidth: 0, padding: "8px 10px", borderRadius: 7, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", fontSize: ".85rem" }} />
                <input value={last} onChange={(e) => setLast(e.target.value)} placeholder="Last"
                  style={{ flex: 1, minWidth: 0, padding: "8px 10px", borderRadius: 7, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", fontSize: ".85rem" }} />
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <button onClick={saveName} disabled={busy} style={{ padding: "7px 12px", borderRadius: 7, border: "none", background: "var(--accent-fill)", color: "#0b0b12", fontWeight: 700, fontSize: ".8rem", cursor: "pointer" }}>{busy ? "…" : "Save"}</button>
                <button onClick={() => setEditing(false)} style={{ padding: "7px 12px", borderRadius: 7, border: "1px solid var(--border)", background: "transparent", color: "var(--muted)", fontSize: ".8rem", cursor: "pointer" }}>Cancel</button>
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: ".95rem", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{meName || "Set your name"}</div>
                <div style={{ fontSize: ".72rem", color: "var(--muted)" }}>
                  <span style={{ color: "var(--accent)", fontWeight: 700 }}>{ROLE_LABEL[role] || "Member"}</span>
                  {meEmail ? ` · ${meEmail}` : ""}
                </div>
              </div>
              <button onClick={() => setEditing(true)} title="Edit name" style={{ border: "none", background: "transparent", color: "var(--muted)", cursor: "pointer", padding: 6, display: "flex" }}><Icon name="edit" size={16} /></button>
            </div>
          )}
        </div>

        {/* Trial status — soft/informational (no hard lock until billing exists) */}
        {trial && (
          <div style={{ padding: "10px 12px", borderRadius: 10, marginBottom: 12,
            background: trial.expired ? "rgba(248,113,113,.10)" : trial.daysLeft <= 5 ? "rgba(251,191,36,.10)" : "rgba(8,220,224,.08)",
            border: `1px solid ${trial.expired ? "var(--red)" : trial.daysLeft <= 5 ? "var(--yellow)" : "var(--accent)"}` }}>
            {trial.expired ? (
              <div style={{ fontSize: ".8rem", lineHeight: 1.4 }}>
                <span style={{ fontWeight: 700, color: "var(--red)" }}>⚠️ Your trial has ended.</span>
                <div style={{ color: "var(--muted)", marginTop: 2 }}>
                  {isTrainer ? "Reach out to keep your coaching workspace active." : "Contact your trainer to keep your plan going."}
                </div>
              </div>
            ) : (
              <div style={{ fontSize: ".8rem", lineHeight: 1.4 }}>
                <span style={{ fontWeight: 700, color: trial.daysLeft <= 5 ? "var(--yellow)" : "var(--accent)" }}>
                  ⏳ {trial.daysLeft} day{trial.daysLeft === 1 ? "" : "s"} left in your trial
                </span>
                <div style={{ color: "var(--muted)", marginTop: 2 }}>{trial.lengthDays}-day free trial</div>
              </div>
            )}
          </div>
        )}

        {/* Navigation */}
        <button style={item} onClick={() => go(onHome)}><Icon name="home" size={19} color="var(--accent)" /> <span>Home</span></button>
        {isTrainer && <button style={item} onClick={() => go(onDashboard)}><Icon name="dashboard" size={19} color="var(--accent)" /> <span>Dashboard</span></button>}
        {isTrainer && <button style={item} onClick={() => go(onClients)}><Icon name="clients" size={19} color="var(--accent)" /> <span>All clients</span></button>}

        {/* Notification Center (Session 76) — master on/off + per-type toggles.
            One notification type today (trainer to-dos); more slot in as features
            are added. Backed by the shared notifPrefs (synced with inline toggles). */}
        {(() => {
          const npf = notifPrefs || { master: true };
          // Per-type rows are role-aware. Clients get the home nudge types;
          // trainers get the sent-to-do display toggle.
          const types = isTrainer
            ? [{ key: "sentReminders", label: "Client to-do reminders", desc: "Sent to-dos shown on client cards" }]
            : [
                { key: "trainerReminders", label: "Trainer to-do reminders", desc: "To-dos your trainer sends you" },
                { key: "foodReminders", label: "Food-logging reminders", desc: "Nudge when you haven't logged food" },
                { key: "weighInReminders", label: "Weigh-in reminders", desc: "Nudge for a weekly weigh-in" },
                { key: "coachingNudges", label: "AI coaching tips", desc: "Occasional tips from your AI coach" },
              ];
          const Toggle = ({ on, disabled, onClick }) => (
            <button onClick={onClick} disabled={disabled} aria-pressed={on}
              style={{ width: 42, height: 24, borderRadius: 999, border: "none", flexShrink: 0,
                cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.45 : 1, transition: "background .2s",
                background: on ? "var(--accent)" : "var(--s3,#28383a)", position: "relative" }}>
              <span style={{ position: "absolute", top: 2, left: on ? 20 : 2, width: 20, height: 20, borderRadius: "50%",
                background: "#fff", boxShadow: "0 1px 2px rgba(0,0,0,.3)", transition: "left .2s" }} />
            </button>
          );
          const row = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 };
          return (
            <>
              <button style={item} onClick={() => setShowNotif((v) => !v)}>
                <Icon name="bell" size={19} color="var(--accent)" /> <span>Notifications</span>
                <span style={{ marginLeft: "auto", color: "var(--muted)" }}>{showNotif ? "▾" : "▸"}</span>
              </button>
              {showNotif && (
                <div style={{ padding: "4px 16px 12px", display: "flex", flexDirection: "column", gap: 12 }}>
                  <div style={{ fontSize: ".74rem", color: "var(--muted)" }}>Choose which nudges &amp; reminders you get — turn everything off, or pick by type.</div>
                  <div style={row}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: ".88rem" }}>All notifications</div>
                      <div style={{ fontSize: ".7rem", color: "var(--muted)" }}>Master switch for everything</div>
                    </div>
                    <Toggle on={npf.master} onClick={() => onSetNotifPrefs({ master: !npf.master })} />
                  </div>
                  {types.map((ty) => {
                    const val = npf[ty.key] !== false; // default on
                    return (
                      <div key={ty.key} style={row}>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontWeight: 600, fontSize: ".88rem" }}>{ty.label}</div>
                          <div style={{ fontSize: ".7rem", color: "var(--muted)" }}>{ty.desc}</div>
                        </div>
                        <Toggle on={npf.master && val} disabled={!npf.master} onClick={() => onSetNotifPrefs({ [ty.key]: !val })} />
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          );
        })()}

        {/* Invite clients (trainer) — moved here off the home screen */}
        {isTrainer && (
          <>
            <button style={item} onClick={() => setShowInvite((v) => !v)}>
              <Icon name="invite" size={19} color="var(--accent)" /> <span>Invite clients</span>
              <span style={{ marginLeft: "auto", color: "var(--muted)" }}>{showInvite ? "▾" : "▸"}</span>
            </button>
            {showInvite && (
              <div style={{ padding: "4px 16px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ fontSize: ".74rem", color: "var(--muted)" }}>Your invite code — clients enter it to link to you.</div>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <code style={{ flex: 1, padding: "8px 10px", borderRadius: 7, background: "var(--s2)", border: "1px solid var(--border)",
                    fontFamily: "monospace", letterSpacing: "1px", fontSize: ".95rem" }}>{invite ? formatInviteCode(invite) : "…"}</code>
                  <button onClick={() => copy("code", formatInviteCode(invite))} disabled={!invite}
                    style={{ padding: "8px 10px", borderRadius: 7, border: "none", background: "var(--accent-fill)", color: "#0b0b12", fontWeight: 700, fontSize: ".76rem", cursor: "pointer" }}>{copied === "code" ? "✓" : "Copy"}</button>
                </div>
                <div style={{ fontSize: ".74rem", color: "var(--muted)" }}>Or send a one-click link — new clients auto-link to you.</div>
                <button onClick={() => copy("link", shareLink)} disabled={!shareLink}
                  style={{ padding: "9px 12px", borderRadius: 7, border: "1px solid var(--border)", background: "transparent", color: "var(--text)", fontWeight: 600, fontSize: ".82rem", cursor: "pointer" }}>{copied === "link" ? "✓ Link copied" : "🔗 Copy invite link"}</button>
              </div>
            )}
          </>
        )}

        <div style={{ flex: 1 }} />
        <button style={{ ...item, color: "#e5484d" }} onClick={() => signOut(auth)}><Icon name="signout" size={19} /> <span>Sign out</span></button>
      </div>
    </>
  );
}

export default function App() {
  const [screen, setScreen] = useState("profiles");
  const [profiles, setProfiles] = useState([]);
  const [folders, setFolders] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [step, setStep] = useState(0);
  const [data, setData] = useState({...EMPTY_DATA});
  const [dailyLog, setDailyLog] = useState({calories:0, water:0, weight:0, protein:0, carbs:0, fat:0});
  const [showDash, setShowDash] = useState(true);
  const [streak, setStreak] = useState(0);
  const [navFrom, setNavFrom] = useState(null); // "dashboard" | "results" | null
  const [role, setRole] = useState(null); // this user's role (for the trainer home)
  const [homeTab, setHomeTab] = useState("dashboard"); // "dashboard" | "clients"
  // When a trainer opens a LINKED client's plan, this holds that client's uid so
  // edits save into the client's account ("caliq-self") instead of locally.
  const [activeRemoteUid, setActiveRemoteUid] = useState(null);
  // Edit history (who-changed-what) for the active plan.
  const [history, setHistory] = useState([]);
  const historyRef = useRef([]);              // mirror of history (avoids stale closures)
  const lastSnapshotRef = useRef(null);       // last data we diffed plan-edits against
  const [recentFoods, setRecentFoods] = useState([]); // named foods for one-tap re-add
  const recentFoodsRef = useRef([]);          // mirror (avoids stale closures in handlers)
  const [weekSummary, setWeekSummary] = useState(null); // last-7-day nutrition averages
  const [meName, setMeName] = useState("");   // current user's display name
  const [meUid, setMeUid] = useState("");     // current user's uid
  const [meEmail, setMeEmail] = useState(""); // current user's email (for the menu)
  const [meTrial, setMeTrial] = useState(null); // trial countdown state (or null)
  const [menuOpen, setMenuOpen] = useState(false); // side menu (Session 23)
  // Notification preferences (Session 76) — a master on/off + per-type toggles,
  // in one doc (caliq-notif-prefs), surfaced in the side-menu Notification Center
  // AND the inline toggles (client home / trainer dashboard), so they stay in sync.
  // Default everything ON. Types: trainerReminders = the client's trainer to-do
  // card; sentReminders = the trainer's sent-to-do display; foodReminders /
  // weighInReminders / coachingNudges = client home nudge cards (Session 77).
  const [notifPrefs, setNotifPrefs] = useState({ master: true, trainerReminders: true, sentReminders: true,
    foodReminders: true, weighInReminders: true, coachingNudges: true });
  // Merge a partial patch and persist. Components call with e.g. { master:false }.
  const onSetNotifPrefs = (patch) => {
    setNotifPrefs((prev) => {
      const np = { ...prev, ...patch };
      try { window.storage.set("caliq-notif-prefs", JSON.stringify(np)); } catch (e) { /* best-effort */ }
      return np;
    });
  };

  const goBack = () => {
    if (showDash && step === 5) {
      // On Dashboard → go back to Profile Selector
      setScreen("profiles");
    } else if (step <= 4) {
      // On a Step → go back to where we came from
      if (navFrom === "results") {
        setStep(5);        // go to results
        setShowDash(false);
      } else {
        setStep(5);        // go to dashboard
        setShowDash(true);
      }
      setNavFrom(null);
    } else {
      // On Results → go back to Dashboard
      setStep(5);
      setShowDash(true);
      setNavFrom(null);
    }
  };
  const saveTimer = useRef(null);
  // The exact plan-wrapper payload we last wrote to a remote client's account, so
  // the live-sync listener can ignore our own echoed write (vs. a real change
  // from the client / AI). Pairs with the onSnapshot effect below.
  const lastRemoteWriteRef = useRef(null);

  // Load profiles and folders on mount
  // Scroll to the top whenever the active view changes, so each screen starts
  // clean instead of mid-page (pairs with the .page-transition fade). Instant
  // jump avoids a long smooth-scroll competing with the fade-in.
  useEffect(() => {
    try { window.scrollTo({ top: 0, behavior: "instant" }); }
    catch { window.scrollTo(0, 0); }
  }, [screen, step, showDash, homeTab]);

  useEffect(()=>{
    (async()=>{
      try {
        const result = await window.storage.get(STORAGE_INDEX);
        if (result && result.value) setProfiles(JSON.parse(result.value));
      } catch(e) {}
      try {
        const fResult = await window.storage.get(STORAGE_FOLDERS);
        if (fResult && fResult.value) setFolders(JSON.parse(fResult.value));
      } catch(e) {}
      try {
        const prof = await getProfile();
        if (prof) {
          if (prof.role) setRole(prof.role);
          setMeName(prof.displayName || prof.email || "Someone");
          setMeUid(prof.uid || "");
          setMeEmail(prof.email || "");
          setMeTrial(trialInfo(prof));
        }
      } catch(e) {}
      try {
        const np = await window.storage.get("caliq-notif-prefs");
        if (np && np.value) setNotifPrefs((prev) => ({ ...prev, ...(JSON.parse(np.value) || {}) }));
      } catch(e) { /* none saved yet → defaults (all on) */ }
      setLoading(false);
    })();
  }, []);

  const saveIndex = async (list) => {
    try { await window.storage.set(STORAGE_INDEX, JSON.stringify(list)); } catch(e) {}
  };

  // Auto-save (debounced 600ms)
  const autoSave = (newData, newStep) => {
    if (!activeId) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    const remote = activeRemoteUid; // capture: are we editing a linked client's plan?
    saveTimer.current = setTimeout(async ()=>{
      try {
        const payload = JSON.stringify({ data: newData||data, step: newStep??step });
        if (remote) {
          // Editing a linked client's plan — save straight into THEIR account.
          // (No local index update; this profile doesn't live in our list.)
          lastRemoteWriteRef.current = payload; // mark our own write so live-sync ignores its echo
          await setForUser(remote, planDataKey(activeId), payload);
          recordPlanEdits(newData||data);
          setSaving(true);
          setTimeout(()=>setSaving(false), 1200);
          return;
        }
        const SL = ["Personal","Goal Weight","Activity","Cardio","Strength","Results"];
        await window.storage.set(profileKey(activeId), payload);
        const d = newData||data;
        const up = profiles.map(p => p.id===activeId ? {...p, name:fullName(d)||p.name, weight:d.weightLbs||"", goal:d.goalWeight||"", lastSaved:Date.now(), stepLabel:SL[newStep??step]||""} : p);
        setProfiles(up);
        await saveIndex(up);
        recordPlanEdits(newData||data);
        setSaving(true);
        setTimeout(()=>setSaving(false), 1200);
      } catch(e) {}
      finally { saveTimer.current = null; } // debounce done — clears the "edit in flight" guard
    }, 600);
  };

  // After a save settles, record any meaningful plan-structure changes (goal,
  // workouts, notes, …) in the history. Diffs against the last saved snapshot.
  const recordPlanEdits = (nextData) => {
    const prevSnap = lastSnapshotRef.current;
    lastSnapshotRef.current = nextData;
    if (prevSnap == null) return; // first load — nothing to compare yet
    const changes = describePlanChanges(prevSnap, nextData);
    if (changes.length) appendHistory(changes);
  };

  const setDataAndSave = (updater) => {
    setData(prev => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      autoSave(next, step);
      return next;
    });
  };
  const setStepAndSave = (s) => { setStep(s); autoSave(data, s); };

  const selectProfile = async (id) => {
    let merged = {...EMPTY_DATA};
    let stp = 0;
    try {
      const result = await window.storage.get(profileKey(id));
      if (result && result.value) {
        const parsed = JSON.parse(result.value);
        const d = parsed.data || {};
        // Backward compat: migrate old "name" field to firstName/lastName
        if (d.name && !d.firstName) {
          const parts = d.name.trim().split(/\s+/);
          d.firstName = parts[0] || "";
          d.lastName = parts.slice(1).join(" ") || "";
          delete d.name;
        }
        merged = {...EMPTY_DATA, ...d, cardio:{...defaultCardio,...(d.cardio||{})}, strength:{...defaultStrength,...(d.strength||{})}};
        stp = parsed.step || 0;
      }
    } catch(e) { merged = {...EMPTY_DATA}; stp = 0; }
    setData(merged);
    setStep(stp);
    setShowDash(stp >= 5);
    lastSnapshotRef.current = merged; // baseline for plan-edit history diffs
    setActiveRemoteUid(null); // a local (or own "self") profile, not a remote client's
    setActiveId(id);
    setScreen("app");
  };

  // Trainer opens a LINKED client's plan; edits route back to the client's
  // account via autoSave. A client may have several plans — open the given
  // planId, or the active one from their manifest (default "self"). (Session 21)
  const openClientPlan = async (clientUid, planId) => {
    let pid = planId;
    if (!pid) { const m = await readPlansManifest((k) => getForUser(clientUid, k)); pid = m.active; }
    try {
      const r = await getForUser(clientUid, planDataKey(pid));
      if (r && r.value) {
        const parsed = JSON.parse(r.value);
        const d = parsed.data || {};
        if (d.name && !d.firstName) {
          const parts = d.name.trim().split(/\s+/);
          d.firstName = parts[0] || ""; d.lastName = parts.slice(1).join(" ") || ""; delete d.name;
        }
        const merged = {...EMPTY_DATA, ...d, cardio:{...defaultCardio,...(d.cardio||{})}, strength:{...defaultStrength,...(d.strength||{})}};
        setData(merged);
        lastSnapshotRef.current = merged;
      } else {
        setData({...EMPTY_DATA}); lastSnapshotRef.current = {...EMPTY_DATA};
      }
    } catch(e) { setData({...EMPTY_DATA}); lastSnapshotRef.current = {...EMPTY_DATA}; }
    // Open a linked client straight to the Daily Dashboard (where logging + the
    // Recent Activity feed live) — the trainer is checking in, not re-running setup.
    setStep(5);
    setShowDash(true);
    setActiveRemoteUid(clientUid);
    setActiveId(pid);
    setScreen("app");
  };

  // When a local file is linked to a client, the plan now lives in the client's
  // account — remove the local duplicate so there's one source of truth.
  const removeLocalProfileById = async (localId) => {
    let up = profiles;
    setProfiles(prev => { up = prev.filter(p => p.id !== localId); return up; });
    await saveIndex(up);
    try { await window.storage.delete(profileKey(localId)); } catch(e) {}
  };

  // Snapshot a client's shared plan into a NEW local file (for a simulation,
  // template, or backup). Leaves the client's own plan untouched. Returns id.
  const copyClientToLocal = async (clientUid) => {
    let parsed = { data: {}, step: 0 };
    try {
      const m = await readPlansManifest((k) => getForUser(clientUid, k));
      const r = await getForUser(clientUid, planDataKey(m.active));
      if (r && r.value) parsed = JSON.parse(r.value);
    } catch(e) {}
    const d = parsed.data || {};
    const id = `c${Date.now()}`;
    const np = { id, name: (fullName(d) || "Copied plan") + " (local)", weight: d.weightLbs||"",
      goal: d.goalWeight||"", lastSaved: Date.now(), stepLabel: "Local copy", folderId: null };
    let up = profiles;
    setProfiles(prev => { up = [...prev, np]; return up; });
    await saveIndex(up);
    try { await window.storage.set(profileKey(id), JSON.stringify({ data: d, step: parsed.step||0 })); } catch(e) {}
    return id;
  };

  // Give a local plan a custom display name (kept separate from the plan's own
  // first/last name, so renaming a sim/template/backup sticks).
  const renameProfile = (id, customName) => {
    setProfiles(prev => {
      const up = prev.map(p => p.id === id ? { ...p, customName: (customName || "").trim() } : p);
      saveIndex(up);
      return up;
    });
  };

  const createProfile = (folderId, opts) => {
    const id = `c${Date.now()}`;
    const np = { id, name:"", weight:"", goal:"", lastSaved:Date.now(), stepLabel:"Personal", folderId: folderId||null,
      isSimulation: !!(opts && opts.isSimulation) };
    const up = [...profiles, np];
    setProfiles(up);
    saveIndex(up);
    setData({...EMPTY_DATA});
    lastSnapshotRef.current = {...EMPTY_DATA};
    setStep(0);
    setActiveRemoteUid(null);
    setActiveId(id);
    setScreen("app");
  };

  // Convert a simulation into a real local plan (clears the sandbox flag so it
  // moves out of "Simulations" and into "Local Plans", ready to link to a client).
  const convertSimulation = (id) => {
    setProfiles(prev => {
      const up = prev.map(p => p.id === id ? { ...p, isSimulation: false } : p);
      saveIndex(up);
      return up;
    });
  };
  // Is the currently-open plan a simulation? (drives the editor banner + summary)
  const activeIsSim = !!(profiles.find(p => p.id === activeId) || {}).isSimulation;

  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const deleteProfile = async (id, name) => {
    if (confirmDeleteId !== id) { setConfirmDeleteId(id); setTimeout(()=>setConfirmDeleteId(null), 4000); return; }
    try { await window.storage.delete(profileKey(id)); } catch(e) {}
    const up = profiles.filter(p=>p.id!==id);
    setProfiles(up);
    await saveIndex(up);
    setConfirmDeleteId(null);
  };

  // ── Folder management ──
  const saveFolders = async (list) => {
    try { await window.storage.set(STORAGE_FOLDERS, JSON.stringify(list)); } catch(e) {}
  };
  const createFolder = (name) => {
    const f = { id:`f${Date.now()}`, name: name||"New Folder", order: folders.length };
    const up = [...folders, f];
    setFolders(up);
    saveFolders(up);
  };
  const renameFolder = (id, name) => {
    const up = folders.map(f=>f.id===id?{...f, name}:f);
    setFolders(up);
    saveFolders(up);
  };
  const [confirmFolderDel, setConfirmFolderDel] = useState(null);
  const deleteFolder = (id) => {
    if (confirmFolderDel !== id) { setConfirmFolderDel(id); setTimeout(()=>setConfirmFolderDel(null), 4000); return; }
    const up = folders.filter(f=>f.id!==id);
    setFolders(up);
    saveFolders(up);
    const upP = profiles.map(p=>p.folderId===id?{...p, folderId:null}:p);
    setProfiles(upP);
    saveIndex(upP);
    setConfirmFolderDel(null);
  };
  const moveProfileToFolder = (profileId, folderId) => {
    const up = profiles.map(p=>p.id===profileId?{...p, folderId: folderId||null}:p);
    setProfiles(up);
    saveIndex(up);
  };

  const goToProfiles = () => { setScreen("profiles"); setActiveId(null); setActiveRemoteUid(null); };
  const reset = () => { setStep(0); setData({...EMPTY_DATA}); autoSave({...EMPTY_DATA}, 0); };
  const update = (k,v) => setDataAndSave(p=>({...p,[k]:v}));

  // Recovery: scan storage for profiles missing from the index
  const recoverProfiles = async () => {
    try {
      const keys = await window.storage.list("caliq-");
      if (!keys || !keys.keys) return 0;
      const profileKeys = keys.keys.filter(k => k.startsWith("caliq-c")); // profile data keys start with caliq-c
      const existingIds = new Set(profiles.map(p=>p.id));
      let recovered = 0;
      const newProfiles = [...profiles];
      for (const key of profileKeys) {
        const id = key.replace("caliq-","");
        if (existingIds.has(id)) continue;
        try {
          const result = await window.storage.get(key);
          if (result && result.value) {
            const parsed = JSON.parse(result.value);
            const d = parsed.data || {};
            newProfiles.push({
              id, name: d.name || "Recovered Client", weight: d.weightLbs || "",
              goal: d.goalWeight || "", lastSaved: Date.now(), stepLabel: "Recovered",
              folderId: null
            });
            recovered++;
          }
        } catch(e) {}
      }
      if (recovered > 0) {
        setProfiles(newProfiles);
        await saveIndex(newProfiles);
      }
      return recovered;
    } catch(e) { return 0; }
  };

  // ── Export: download all profiles + folders as JSON ──
  const exportAllData = async () => {
    try {
      const allData = {};
      for (const p of profiles) {
        try {
          const result = await window.storage.get(profileKey(p.id));
          if (result && result.value) allData[p.id] = JSON.parse(result.value);
        } catch(e) {}
      }
      const bundle = {
        version: 1,
        exportedAt: new Date().toISOString(),
        folders: folders,
        profiles: profiles,
        data: allData,
      };
      const json = JSON.stringify(bundle, null, 2);
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Glide-Backup-${new Date().toISOString().slice(0,10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      return true;
    } catch(e) { return false; }
  };

  // ── Import: load profiles + folders from JSON file ──
  const importData = async (file) => {
    try {
      const text = await file.text();
      const bundle = JSON.parse(text);
      if (!bundle.profiles || !bundle.data) return { ok: false, msg: "Invalid file format" };

      // Merge folders (skip duplicates by name)
      const existingFolderNames = new Set(folders.map(f=>f.name));
      const folderIdMap = {}; // old folder id → new folder id
      const newFolders = [...folders];
      for (const f of (bundle.folders || [])) {
        if (existingFolderNames.has(f.name)) {
          // Map to existing folder with same name
          const existing = folders.find(ef=>ef.name===f.name);
          folderIdMap[f.id] = existing.id;
        } else {
          const newId = `f${Date.now()}${Math.random().toString(36).slice(2,6)}`;
          folderIdMap[f.id] = newId;
          newFolders.push({ ...f, id: newId, order: newFolders.length });
          existingFolderNames.add(f.name);
        }
      }

      // Merge profiles (skip duplicates by name+weight combo, or import all)
      const existingIds = new Set(profiles.map(p=>p.id));
      const newProfiles = [...profiles];
      let imported = 0;
      for (const p of bundle.profiles) {
        // Generate new ID to avoid collisions
        const newId = `c${Date.now()}${Math.random().toString(36).slice(2,6)}`;
        const mappedFolderId = p.folderId ? (folderIdMap[p.folderId] || null) : null;
        newProfiles.push({ ...p, id: newId, folderId: mappedFolderId, lastSaved: Date.now(), stepLabel: p.stepLabel || "Imported" });
        // Save profile data
        if (bundle.data[p.id]) {
          try { await window.storage.set(profileKey(newId), JSON.stringify(bundle.data[p.id])); } catch(e) {}
        }
        imported++;
      }

      setProfiles(newProfiles);
      await saveIndex(newProfiles);
      if (newFolders.length > folders.length) {
        setFolders(newFolders);
        await saveFolders(newFolders);
      }
      return { ok: true, msg: `Imported ${imported} profile${imported!==1?"s":""}${newFolders.length > folders.length ? ` and ${newFolders.length - folders.length} folder(s)` : ""}` };
    } catch(e) { return { ok: false, msg: "Failed to read file — make sure it's a Glide backup JSON" }; }
  };

  // ── Clipboard backup: copy all data as text ──
  const clipboardExport = async () => {
    try {
      const allData = {};
      for (const p of profiles) {
        try {
          const result = await window.storage.get(profileKey(p.id));
          if (result && result.value) allData[p.id] = JSON.parse(result.value);
        } catch(e) {}
      }
      const bundle = { version:1, exportedAt:new Date().toISOString(), folders, profiles, data:allData };
      const json = JSON.stringify(bundle);
      await navigator.clipboard.writeText(json);
      return true;
    } catch(e) {
      // Fallback: select from a textarea
      return "fallback";
    }
  };

  const clipboardImport = async (text) => {
    try {
      const bundle = JSON.parse(text.trim());
      if (!bundle.profiles || !bundle.data) return { ok:false, msg:"Invalid backup data" };
      // Reuse the same merge logic as file import
      const file = new Blob([text], {type:"application/json"});
      // Can't reuse importData directly since it expects a File, so inline the logic
      const existingFolderNames = new Set(folders.map(f=>f.name));
      const folderIdMap = {};
      const newFolders = [...folders];
      for (const f of (bundle.folders||[])) {
        if (existingFolderNames.has(f.name)) {
          folderIdMap[f.id] = folders.find(ef=>ef.name===f.name).id;
        } else {
          const newId = `f${Date.now()}${Math.random().toString(36).slice(2,6)}`;
          folderIdMap[f.id] = newId;
          newFolders.push({...f, id:newId, order:newFolders.length});
          existingFolderNames.add(f.name);
        }
      }
      const newProfiles = [...profiles];
      let imported = 0;
      for (const p of bundle.profiles) {
        const newId = `c${Date.now()}${Math.random().toString(36).slice(2,6)}`;
        const mappedFolderId = p.folderId ? (folderIdMap[p.folderId]||null) : null;
        newProfiles.push({...p, id:newId, folderId:mappedFolderId, lastSaved:Date.now(), stepLabel:p.stepLabel||"Imported"});
        if (bundle.data[p.id]) {
          try { await window.storage.set(profileKey(newId), JSON.stringify(bundle.data[p.id])); } catch(e) {}
        }
        imported++;
      }
      setProfiles(newProfiles);
      await saveIndex(newProfiles);
      if (newFolders.length > folders.length) { setFolders(newFolders); await saveFolders(newFolders); }
      return { ok:true, msg:`Imported ${imported} profile${imported!==1?"s":""}` };
    } catch(e) { return { ok:false, msg:"Invalid data — make sure you pasted a Glide backup" }; }
  };

  // ── Daily log handler ──
  const todayKey = ymdLocal();
  // Daily logs live with the plan: when a trainer is editing a LINKED client's
  // plan (activeRemoteUid set), the log reads/writes go to the CLIENT's account;
  // otherwise they use the signed-in user's own storage.
  const logRead = async (key) => {
    try {
      if (activeRemoteUid) { const r = await getForUser(activeRemoteUid, key); return r && r.value ? r.value : null; }
      const r = await window.storage.get(key); return r && r.value ? r.value : null;
    } catch (e) { return null; }
  };
  const logWrite = (key, value) => {
    try {
      if (activeRemoteUid) setForUser(activeRemoteUid, key, value);
      else window.storage.set(key, value);
    } catch (e) {}
  };
  // Remote-aware key listing (for the calendar's per-day indicators). Returns the
  // kv keys matching a prefix in whichever account the active plan lives in.
  const logList = async (prefix) => {
    try {
      if (activeRemoteUid) { const r = await listForUser(activeRemoteUid, prefix); return r.keys || []; }
      const r = await window.storage.list(prefix); return r.keys || [];
    } catch (e) { return []; }
  };
  const persistLog = (logObj) => {
    if (!activeId) return;
    logWrite(`caliq-log-${activeId}-${todayKey}`, JSON.stringify(logObj));
  };
  // Calendar back-dated logging: read / write / list any date's log for the
  // active plan (today's log keeps its own state; these are for other dates).
  const onReadDay = async (date) => {
    const v = await logRead(`caliq-log-${activeId}-${date}`);
    return v ? (JSON.parse(v) || {}) : {};
  };
  const onWriteDay = (date, logObj) => {
    logWrite(`caliq-log-${activeId}-${date}`, JSON.stringify(logObj));
    if (date === todayKey) setDailyLog(logObj); // keep today's live state in sync
  };
  const onListLoggedDays = async () => {
    const keys = await logList(`caliq-log-${activeId}-`);
    return keys.map((k) => k.slice(-10)); // trailing YYYY-MM-DD
  };

  // Append one or more events to the active plan's edit history. Stored with the
  // plan (remote-aware), newest-first, capped so it can't grow without bound.
  const appendHistory = (actions) => {
    if (!activeId || !actions || actions.length === 0) return;
    const now = Date.now();
    const evs = actions.map((a, i) => ({
      id: `e${now}${i}${Math.floor(Math.random()*1000)}`,
      uid: meUid, role, name: meName || "Someone", action: a, ts: now,
    }));
    const next = [...evs, ...historyRef.current].slice(0, 250);
    historyRef.current = next;
    setHistory(next);
    logWrite(`caliq-history-${activeId}`, JSON.stringify(next));
  };

  const onLogUpdate = (field, value) => {
    const prev = dailyLog[field] || 0;
    const updated = {...dailyLog, [field]: value};
    setDailyLog(updated);
    persistLog(updated);
    // Record meaningful logging actions in the history.
    if (field === "weight" && value > 0 && value !== prev) appendHistory([`logged weight: ${value} lbs`]);
    else if (field === "calories" && value > prev) appendHistory([`logged ${value - prev} cal`]);
    else if (field === "water" && value > prev) appendHistory([`logged ${value - prev} oz water`]);
    // Update streak: if calories logged > 0, count as active day
    if (field === "calories" && value > 0) setStreak(s => Math.max(s, 1));
  };

  // Remember a named food for one-tap re-add later. Deduped by name (latest
  // cals/macros win), newest first, capped. Stored remote-aware with the plan.
  const upsertRecentFood = (m) => {
    const name = (m.name || "").trim();
    if (!name || !activeId) return;
    const key = name.toLowerCase();
    const entry = { name, calories: m.calories||0, protein: m.protein||0, carbs: m.carbs||0, fat: m.fat||0 };
    const next = [entry, ...recentFoodsRef.current.filter(f => (f.name||"").toLowerCase() !== key)].slice(0, 24);
    recentFoodsRef.current = next;
    setRecentFoods(next);
    logWrite(`caliq-foods-${activeId}`, JSON.stringify(next));
  };

  // Add a logged food/meal: appends to the day's meals and rolls its calories +
  // macros into the day's totals (Option A — meals add to the running total).
  const onAddMeal = (meal) => {
    const m = { id:`m${Date.now()}${Math.floor(Math.random()*1000)}`,
      name: meal.name||"", type: meal.type||"", calories: Number(meal.calories)||0,
      protein: Number(meal.protein)||0, carbs: Number(meal.carbs)||0, fat: Number(meal.fat)||0,
      time: meal.time || hhmmLocal() };
    upsertRecentFood(m);
    const updated = {
      ...dailyLog,
      meals: [...(dailyLog.meals||[]), m],
      calories: (dailyLog.calories||0) + m.calories,
      protein: (dailyLog.protein||0) + m.protein,
      carbs: (dailyLog.carbs||0) + m.carbs,
      fat: (dailyLog.fat||0) + m.fat,
    };
    setDailyLog(updated);
    persistLog(updated);
    appendHistory([`added ${m.type || "a food"}${m.name ? `: ${m.name}` : ""} (${m.calories} cal)`]);
    if (m.calories > 0) setStreak(s => Math.max(s, 1));
  };

  // Remove a logged food/meal and subtract its contribution from the totals.
  const onRemoveMeal = (id) => {
    const meals = dailyLog.meals || [];
    const m = meals.find(x => x.id === id);
    if (!m) return;
    const updated = {
      ...dailyLog,
      meals: meals.filter(x => x.id !== id),
      calories: Math.max(0, (dailyLog.calories||0) - (m.calories||0)),
      protein: Math.max(0, (dailyLog.protein||0) - (m.protein||0)),
      carbs: Math.max(0, (dailyLog.carbs||0) - (m.carbs||0)),
      fat: Math.max(0, (dailyLog.fat||0) - (m.fat||0)),
    };
    setDailyLog(updated);
    persistLog(updated);
    appendHistory([`removed ${m.name || "a food"}${m.type ? ` from ${m.type}` : ""}`]);
  };

  // Edit a logged food/meal in place; adjusts the day's totals by the difference.
  const onEditMeal = (id, fields) => {
    const meals = dailyLog.meals || [];
    const idx = meals.findIndex(x => x.id === id);
    if (idx < 0) return;
    const old = meals[idx];
    const upd = { ...old,
      name: fields.name || "", type: fields.type != null ? fields.type : old.type,
      calories: Number(fields.calories)||0, protein: Number(fields.protein)||0,
      carbs: Number(fields.carbs)||0, fat: Number(fields.fat)||0 };
    const newMeals = meals.slice(); newMeals[idx] = upd;
    upsertRecentFood(upd);
    const updated = {
      ...dailyLog,
      meals: newMeals,
      calories: Math.max(0, (dailyLog.calories||0) - (old.calories||0) + upd.calories),
      protein: Math.max(0, (dailyLog.protein||0) - (old.protein||0) + upd.protein),
      carbs: Math.max(0, (dailyLog.carbs||0) - (old.carbs||0) + upd.carbs),
      fat: Math.max(0, (dailyLog.fat||0) - (old.fat||0) + upd.fat),
    };
    setDailyLog(updated);
    persistLog(updated);
    appendHistory([`edited ${upd.name || "a food"}${upd.type ? ` in ${upd.type}` : ""} (${upd.calories} cal)`]);
  };

  // Pull the latest plan structure + daily log + history for the active plan on
  // demand. A trainer's view of a remote client is now live-synced (the effect
  // below), so this is mostly a manual fallback and the path the client's own
  // view uses (where the listener doesn't run).
  const reloadPlanLive = async () => {
    if (!activeId) return;
    // Plan structure (weigh-ins, targets, goal, workout schedule). Don't clobber
    // an in-flight local edit.
    if (!saveTimer.current) {
      const pv = await logRead(planDataKey(activeId));
      if (pv) { try { const wrap = JSON.parse(pv); const merged = buildMergedData(wrap.data); setData(merged); lastSnapshotRef.current = merged; } catch(e) {} }
    }
    const v = await logRead(`caliq-log-${activeId}-${todayKey}`);
    let parsed = {calories:0, water:0, weight:0, meals:[]};
    if (v) { try { parsed = JSON.parse(v); } catch(e) {} }
    setDailyLog(parsed);
    const hv = await logRead(`caliq-history-${activeId}`);
    let hist = [];
    if (hv) { try { hist = JSON.parse(hv); } catch(e) {} }
    historyRef.current = hist;
    setHistory(hist);
  };

  // ── Live sync: a trainer's view of a linked client's plan ──
  // When a client (or the AI on their behalf) edits concurrently, the open plan
  // updates without a manual Refresh. Only active when viewing a REMOTE client's
  // plan (activeRemoteUid set); the client's own view uses window.storage and is
  // refreshed via its own loaders / the AI's onDataChanged callback.
  useEffect(() => {
    if (!activeRemoteUid || !activeId) return;
    const uid = activeRemoteUid;
    const pid = activeId;
    const unsubs = [];

    // 1) Plan structure (weigh-ins → checkIns, macroTargets, goalWeight, workouts)
    unsubs.push(subscribeForUser(uid, planDataKey(pid), (value) => {
      if (value == null) return;
      if (saveTimer.current) return;                 // a local edit is mid-debounce — don't clobber it
      if (value === lastRemoteWriteRef.current) return; // our own echoed write
      let wrap; try { wrap = JSON.parse(value); } catch(e) { return; }
      const merged = buildMergedData(wrap.data);
      if (JSON.stringify(merged) === JSON.stringify(lastSnapshotRef.current)) return; // no real change
      setData(merged);
      lastSnapshotRef.current = merged;              // keep the diff baseline current (no phantom history)
    }));

    // 2) Today's daily log (meals / calories / water / weight)
    unsubs.push(subscribeForUser(uid, `caliq-log-${pid}-${todayKey}`, (value) => {
      let parsed = {calories:0, water:0, weight:0, meals:[]};
      if (value) { try { parsed = JSON.parse(value); } catch(e) {} }
      setDailyLog(parsed);
    }));

    // 3) Edit history / activity feed
    unsubs.push(subscribeForUser(uid, `caliq-history-${pid}`, (value) => {
      let hist = [];
      if (value) { try { hist = JSON.parse(value); } catch(e) {} }
      historyRef.current = hist;
      setHistory(hist);
    }));

    return () => unsubs.forEach((u) => { try { u(); } catch(e) {} });
  }, [activeRemoteUid, activeId, todayKey]);

  // Load daily log when the active plan changes (own profile or a linked client)
  useEffect(() => {
    if (!activeId) return;
    (async () => {
      const v = await logRead(`caliq-log-${activeId}-${todayKey}`);
      let parsed = {calories:0, water:0, weight:0, meals:[]};
      if (v) { try { parsed = JSON.parse(v); } catch(e) {} }
      setDailyLog(parsed);
      // Simple streak: count consecutive days with logged calories
      let s = 0;
      for (let i = 0; i < 365; i++) {
        const d = new Date(); d.setDate(d.getDate() - i);
        const dk = ymdLocal(d);
        const lv = await logRead(`caliq-log-${activeId}-${dk}`);
        if (lv) { try { const p = JSON.parse(lv); if (p.calories > 0) { s++; continue; } } catch(e) {} }
        if (i === 0) continue; // today might not have logs yet
        break;
      }
      setStreak(s);
      // Load this plan's edit history
      const hv = await logRead(`caliq-history-${activeId}`);
      let hist = [];
      if (hv) { try { hist = JSON.parse(hv); } catch(e) {} }
      historyRef.current = hist;
      setHistory(hist);
      // Load recently-logged foods (for one-tap re-add in the meal log)
      const fv = await logRead(`caliq-foods-${activeId}`);
      let foods = [];
      if (fv) { try { foods = JSON.parse(fv) || []; } catch(e) {} }
      recentFoodsRef.current = foods;
      setRecentFoods(foods);
      // Last-7-day nutrition summary (averaged over the days that were logged).
      let days = 0, cal = 0, p = 0, c = 0, f = 0;
      for (let i = 0; i < 7; i++) {
        const d = new Date(); d.setDate(d.getDate() - i);
        const dk = ymdLocal(d);
        const lv = await logRead(`caliq-log-${activeId}-${dk}`);
        if (!lv) continue;
        try {
          const pl = JSON.parse(lv);
          if ((pl.calories || 0) > 0) { days++; cal += pl.calories || 0; p += pl.protein || 0; c += pl.carbs || 0; f += pl.fat || 0; }
        } catch (e) { /* ignore */ }
      }
      setWeekSummary(days > 0
        ? { days, avgCal: Math.round(cal / days), avgP: Math.round(p / days), avgC: Math.round(c / days), avgF: Math.round(f / days) }
        : { days: 0, avgCal: 0, avgP: 0, avgC: 0, avgF: 0 });
    })();
  }, [activeId, activeRemoteUid]);

  // ── Compute values for dashboard (same formulas as Results) ──
  const actObj = ACTIVITY_LEVELS.find(a=>a.id===data.activityLevel) || ACTIVITY_LEVELS[0];
  const bmr = calcBMR(data.gender, Number(data.weightLbs), Number(data.heightFt), Number(data.heightIn), Number(data.age));
  const computedTdee = Math.round(bmr * actObj.multiplier);
  const allStrEx = [REST_ST, ...STRENGTH_EXERCISES, ...customOf(data.customExercises, "strength")];
  const computedDayData = DAYS.map(day => {
    const raw = data.cardio[day];
    const sessions = Array.isArray(raw) ? raw : [];
    const wkData = sessions.map(w => {
      const co = findCardioEx(w.type, data.customExercises);
      return { co, duration:w.duration, burned:exBurn(co, Number(data.weightLbs), w.duration), type:w.type };
    });
    return { day, workouts:wkData, burned:wkData.reduce((s,w)=>s+w.burned,0) };
  });
  const computedStrDayData = DAYS.map(day => {
    const raw = (data.strength||{})[day];
    const sessions = Array.isArray(raw) ? raw : [];
    const sData = sessions.map(w => {
      const ex = allStrEx.find(e=>e.id===w.type)||REST_ST;
      return { ex, duration:w.duration, burned:exBurn(ex, Number(data.weightLbs), w.duration), type:w.type };
    });
    return { day, sessions:sData, burned:sData.reduce((s,w)=>s+w.burned,0) };
  });
  const computedAvgBurn = Math.round(computedDayData.reduce((s,d)=>s+d.burned,0)/7);

  const LBLS = ["Personal","Goal Weight","Activity","Cardio","Strength","Results"];
  const STEP_ICONS = ["person", "target", "run", "flame", "dumbbell", "chart"];

  // Global navigation chrome (hamburger + slide-out menu), shown on every screen.
  const isTrainerHome = role === ROLES.HEAD_TRAINER || role === ROLES.SUB_TRAINER;
  const chrome = (
    <>
      <button onClick={() => setMenuOpen(true)} aria-label="Open menu"
        style={{ position: "fixed", top: "calc(10px + env(safe-area-inset-top,0px))", left: 10, zIndex: 1390,
          width: 40, height: 40, borderRadius: 10, border: "1px solid var(--border,#2e2e4a)",
          background: "var(--surface,#16162a)", color: "var(--text,#f2f2ff)", cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center" }}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <line x1="4" y1="7" x2="20" y2="7" /><line x1="4" y1="12" x2="20" y2="12" /><line x1="4" y1="17" x2="20" y2="17" />
        </svg>
      </button>
      <SideMenu open={menuOpen} onClose={() => setMenuOpen(false)} role={role} meName={meName} meEmail={meEmail}
        isTrainer={isTrainerHome} trial={meTrial}
        notifPrefs={notifPrefs} onSetNotifPrefs={onSetNotifPrefs}
        onHome={() => { if (isTrainerHome) setHomeTab("dashboard"); goToProfiles(); }}
        onDashboard={() => { setHomeTab("analytics"); goToProfiles(); }}
        onClients={() => { setHomeTab("clients"); goToProfiles(); }}
        onNameSaved={(n) => setMeName(n)} />
    </>
  );

  if (screen === "profiles") {
    // A client manages just their own plan (stored in their account as
    // "caliq-self"), not a list of other people's profiles.
    if (role === ROLES.CLIENT) {
      return <>{chrome}<ClientHome onOpenPlan={() => selectProfile("self")}
        meUid={meUid} meName={meName} role={role}
        notifPrefs={notifPrefs} onSetNotifPrefs={onSetNotifPrefs} /></>;
    }
    if (isTrainerHome && homeTab === "analytics") {
      return <>{chrome}<TrainerAnalytics
        onOpenClientPlan={openClientPlan}
        onGoClients={() => setHomeTab("clients")}
        meUid={meUid} meName={meName} meRole={role}
      /><AIChatPanel role={role} /></>;
    }
    if (isTrainerHome && homeTab === "dashboard") {
      return <>{chrome}<TrainerDashboard
        profiles={profiles} loading={loading}
        onSelect={selectProfile} onManageClients={()=>setHomeTab("clients")}
        onOpenClientPlan={openClientPlan}
        onLinked={removeLocalProfileById} onCopyToLocal={copyClientToLocal}
        onRename={renameProfile}
        onNewPlan={()=>createProfile(null)}
        onNewSimulation={()=>createProfile(null,{isSimulation:true})}
        onConvertSimulation={convertSimulation}
        onDeletePlan={removeLocalProfileById}
        meUid={meUid} meName={meName} meRole={role}
        notifPrefs={notifPrefs} onSetNotifPrefs={onSetNotifPrefs}
      /><AIChatPanel role={role} /></>;
    }
    return <>{chrome}<ProfileSelector
      profiles={profiles} folders={folders} loading={loading}
      onSelect={selectProfile} onNew={createProfile} onDelete={deleteProfile}
      onCreateFolder={createFolder} onRenameFolder={renameFolder}
      onDeleteFolder={deleteFolder} onMoveProfile={moveProfileToFolder}
      confirmDeleteId={confirmDeleteId} confirmFolderDel={confirmFolderDel}
      onRecover={recoverProfiles} onExport={exportAllData} onImport={importData}
      onClipCopy={clipboardExport} onClipPaste={clipboardImport}
      showDashboardTab={isTrainerHome} onShowDashboard={()=>setHomeTab("dashboard")}
      onOpenClientPlan={openClientPlan}
      onLinked={removeLocalProfileById} onCopyToLocal={copyClientToLocal}
      onRename={renameProfile}
    /><AIChatPanel role={role} /></>;
  }

  return (
    <>
      {chrome}
      <style>{css}</style>
      {saving && <div className="prof-save-badge">✓ Saved</div>}
      <div className="app" data-theme="pro">
        {/* Slim brand header — min-height clears the fixed hamburger (App chrome). */}
        <div className="flex items-center justify-center min-h-[54px] px-14 border-b border-border mb-3">
          <BrandLogo />
        </div>
        <div className="max-w-[640px] mx-auto px-4">
          <div className="flex gap-2 items-center mb-3">
            <button onClick={goBack} className="bg-primaryfill text-primaryfg font-bold rounded-lg px-3 py-1.5 text-sm cursor-pointer whitespace-nowrap">
              ← {(showDash && step===5) ? (role === ROLES.CLIENT ? "Home" : "Clients") : step <= 4 ? (navFrom === "results" ? "Results" : "Dashboard") : "Dashboard"}
            </button>
            <div className="text-muted text-sm truncate">📂 {fullName(data) || "New Client"}</div>
          </div>
        </div>
        <div className="container">
          {activeIsSim && (
            <div className="flex items-center gap-2 px-3.5 py-2.5 mb-3.5 rounded-[10px] bg-[rgba(181,123,255,.1)] border border-[rgba(181,123,255,.4)]">
              <span className="text-[1.1rem]">🧪</span>
              <span className="text-[.82rem] text-fg">
                <strong>Simulation</strong> — a sandbox projection, not a real client plan.
              </span>
            </div>
          )}
          <div className="mb-6">
            {step < LBLS.length - 1 && (
              <div className="flex justify-center gap-1 mb-2">
                {LBLS.slice(0,-1).map((lbl,i)=>(
                  <div key={lbl} className={`flex-1 flex justify-center max-w-[80px] ${i===step?"text-primary":i<step?"text-primary opacity-45":"text-muted"}`}><Icon name={STEP_ICONS[i]} size={20} /></div>
                ))}
              </div>
            )}
            <div className="text-[.72rem] text-muted tracking-wide uppercase text-center mb-2.5 font-medium flex items-center justify-center gap-1.5">
              {step < LBLS.length - 1
                ? `Step ${step+1} of ${LBLS.length-1} — ${LBLS[step]}`
                : showDash
                  ? <><Icon name="dashboard" size={13} />Daily Dashboard</>
                  : <><Icon name="check" size={14} color="var(--green)" />Your Personalized Plan</>
              }
            </div>
            {step < LBLS.length - 1 && (
              <div className="flex gap-1.5 justify-center">
                {LBLS.slice(0,-1).map((_,i)=>(
                  <div key={i} className={`flex-1 max-w-[56px] h-1 rounded-full ${i===step?"bg-primaryfill":i<step?"bg-primaryfill opacity-30":"bg-border"}`}/>
                ))}
              </div>
            )}
          </div>
          <div className="page-transition" key={step===5 ? (showDash ? "v-dash" : "v-results") : "v-step"+step}>
          {step===0 && <StepPersonal   data={data} onChange={update} onNext={()=>setStepAndSave(1)}/>}
          {step===1 && <StepGoalWeight data={data} onChange={update} onBack={()=>setStepAndSave(0)} onNext={()=>setStepAndSave(2)}/>}
          {step===2 && <StepActivity   data={data} onChange={update} onBack={()=>setStepAndSave(1)} onNext={()=>setStepAndSave(3)}/>}
          {step===3 && <StepCardio     data={data} onChange={update} onBack={()=>setStepAndSave(2)} onNext={()=>setStepAndSave(4)}/>}
          {step===4 && <StepStrength   data={data} onChange={update} onBack={()=>setStepAndSave(3)} onNext={()=>setStepAndSave(5)}/>}
          {step===5 && showDash && (
            <DailyDashboard
              data={data} step={step} tdee={computedTdee}
              dayData={computedDayData} strengthDayData={computedStrDayData}
              avgBurnPerDay={computedAvgBurn}
              onOpenPlan={()=>{setNavFrom("dashboard");setStepAndSave(0);}} onOpenResults={()=>{setNavFrom("dashboard");setShowDash(false);}}
              onEditWorkouts={()=>{setNavFrom("dashboard");setStepAndSave(3);}}
              onLogUpdate={onLogUpdate} dailyLog={dailyLog} streak={streak}
              onAddMeal={onAddMeal} onRemoveMeal={onRemoveMeal} onEditMeal={onEditMeal} recentFoods={recentFoods} weekSummary={weekSummary} history={history} onRefresh={reloadPlanLive} isRemote={!!activeRemoteUid}
              onSetMacroTargets={(t)=>setDataAndSave(p=>{ const n={...p}; if(t) n.macroTargets=t; else delete n.macroTargets; return n; })}
              onReadDay={onReadDay} onWriteDay={onWriteDay} onListLoggedDays={onListLoggedDays}
              onSaveCheckIn={(checkin)=>setDataAndSave(p=>{
                const others = (p.checkIns||[]).filter(c => c.date !== checkin.date);
                return {...p, checkIns:[...others, checkin]};
              })}
              onDeleteCheckIn={(ts)=>setDataAndSave(p=>{
                const checkIns = (p.checkIns||[]).filter(c => c.timestamp !== ts);
                const remaining = checkIns.filter(c => c.weight).sort((a,b)=>a.timestamp-b.timestamp);
                const next = {...p, checkIns};
                if (remaining.length) next.weightLbs = remaining[remaining.length-1].weight;
                return next;
              })}
              onUpdateCardio={(day,idx,field,val)=>setDataAndSave(p=>{
                if (field==="_replace") return {...p, cardio:{...p.cardio,[day]:val}};
                const sessions = Array.isArray(p.cardio[day]) ? [...p.cardio[day]] : [];
                if (idx >= sessions.length) sessions.push({type:"outdoor_jog",duration:30});
                sessions[idx] = {...sessions[idx],[field]:val};
                return {...p, cardio:{...p.cardio,[day]:sessions}};
              })}
              onUpdateStrength={(day,idx,field,val)=>setDataAndSave(p=>{
                if (field==="_replace") return {...p, strength:{...p.strength,[day]:val}};
                const sessions = Array.isArray(p.strength[day]) ? [...p.strength[day]] : [];
                if (idx >= sessions.length) sessions.push({type:"bb_squat",duration:60});
                sessions[idx] = {...sessions[idx],[field]:val};
                return {...p, strength:{...p.strength,[day]:sessions}};
              })}
              onAddCustomExercise={(ex)=>setDataAndSave(p=>({...p, customExercises:[...(p.customExercises||[]), ex]}))}
            />
          )}
          {step===5 && !showDash && <>
            <div style={{marginBottom:"12px"}}>
              <button className="dash-nav-btn" style={{width:"100%",display:"flex",alignItems:"center",justifyContent:"center",gap:"7px"}} onClick={()=>setShowDash(true)}><Icon name="dashboard" size={16} color="var(--accent)" />Back to Dashboard</button>
            </div>
            <Results data={data} isSimulation={activeIsSim} onReset={reset} onEdit={s=>{setNavFrom("results");setStepAndSave(s);setShowDash(false);}}
            onSaveCheckIn={(checkin)=>setDataAndSave(p=>{
              // One entry per date: replace any existing check-ins for this date.
              const others = (p.checkIns||[]).filter(c => c.date !== checkin.date);
              return {...p, checkIns:[...others, checkin]};
            })}
            onDeleteCheckIn={(ts)=>setDataAndSave(p=>{
              const checkIns = (p.checkIns||[]).filter(c => c.timestamp !== ts);
              // Re-point current weight to the latest remaining weigh-in, or back
              // to the starting weight if no weigh-ins remain (matches ClientHome).
              const remaining = checkIns.filter(c => c.weight).sort((a,b)=>a.timestamp-b.timestamp);
              const next = {...p, checkIns};
              if (remaining.length) next.weightLbs = remaining[remaining.length-1].weight;
              else if (p.startWeightLbs) next.weightLbs = p.startWeightLbs;
              return next;
            })}
            onUpdateNotes={(text)=>setDataAndSave(p=>({...p, trainerNotes:text}))}
            onUpdateCardio={(day,idx,field,val)=>setDataAndSave(p=>{
              if (field==="_replace") return {...p, cardio:{...p.cardio,[day]:val}};
              const sessions = Array.isArray(p.cardio[day]) ? [...p.cardio[day]] : [];
              if (idx >= sessions.length) sessions.push({type:"outdoor_jog",duration:30});
              sessions[idx] = {...sessions[idx],[field]:val};
              return {...p, cardio:{...p.cardio,[day]:sessions}};
            })}
            onUpdateStrength={(day,idx,field,val)=>setDataAndSave(p=>{
              if (field==="_replace") return {...p, strength:{...p.strength,[day]:val}};
              const sessions = Array.isArray(p.strength[day]) ? [...p.strength[day]] : [];
              if (idx >= sessions.length) sessions.push({type:"bb_squat",duration:60});
              sessions[idx] = {...sessions[idx],[field]:val};
              return {...p, strength:{...p.strength,[day]:sessions}};
            })}
          /></>}
          </div>
        </div>
      </div>
      {/* AI chat available IN the plan view (step 5 — DailyDashboard & Results;
          the wizard steps 0–4 have the fixed BottomNav, so it's gated to step 5).
          onDataChanged re-pulls the plan so an AI change appears live without
          leaving the screen. NOTE: for a CLIENT this targets their own plan; a
          trainer viewing a client should name the client (or the open plan
          live-syncs the change via the S70 listeners). */}
      {step === 5 && <AIChatPanel role={role} onDataChanged={reloadPlanLive} />}
    </>
  );
}
