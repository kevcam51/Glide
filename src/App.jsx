import { useState, useEffect, useRef } from "react";
import { ROLES, getProfile, joinTrainer, getMyClients, ensureInviteCode, formatInviteCode, setName, splitName, leaveTrainer } from "./profile.js";
import { getForUser, setForUser, deleteForUser } from "./clientData.js";

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
function projectedLoss(weeks, weeklyDeficitCal) {
  return (weeklyDeficitCal / 3500) * weeks;
}

// ─── CSS ──────────────────────────────────────────────────────────────────────

const css = `
@import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:ital,wght@0,400;0,500;0,600;0,700;1,400&display=swap');

/* ── Reset ── */
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}

/* ── Design tokens ── */
:root{
  /* Core palette */
  --bg:#0d0d18;
  --surface:#16162a;
  --s2:#1e1e34;
  --s3:#252540;
  --border:#2e2e4a;
  --border-light:#383858;

  /* Brand colors */
  --accent:#e8ff4f;
  --accent-dim:rgba(232,255,79,.12);
  --orange:#ff6b35;
  --green:#4fffb0;
  --yellow:#ffcc44;
  --red:#ff4f6b;
  --purple:#b57bff;
  --blue:#4fc3f7;

  /* Text */
  --text:#f2f2ff;
  --text-secondary:#c4c4e0;
  --muted:#7070a0;
  --muted-light:#9090c0;

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
  padding-bottom:calc(96px + env(safe-area-inset-bottom,0px));
}

/* ── Header — cleaner, more premium ── */
.header{
  padding:22px 16px 18px;
  text-align:center;
  background:linear-gradient(180deg,rgba(232,255,79,.04) 0%,transparent 100%);
  border-bottom:1px solid var(--border);
  margin-bottom:24px;
}
.logo{
  font-family:'Bebas Neue',sans-serif;
  font-size:2.2rem;letter-spacing:5px;
  color:var(--accent);line-height:1;
}
.logo span{color:var(--text)}
.tagline{
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
  background:var(--accent);
  box-shadow:0 0 10px rgba(232,255,79,.5);
}
.step-dot.done{background:var(--accent);opacity:.3}

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
  font-family:'Bebas Neue',sans-serif;
  font-size:1.5rem;letter-spacing:2.5px;
  color:var(--accent);margin-bottom:4px;
}
.card-sub{
  color:var(--muted-light);font-size:.85rem;
  margin-bottom:22px;line-height:1.55;
}

/* ── Welcome banner ── */
.welcome-banner{
  background:linear-gradient(135deg,rgba(232,255,79,.07),rgba(79,255,176,.04));
  border:1px solid rgba(232,255,79,.22);
  border-radius:var(--radius-lg);
  padding:18px;margin-bottom:16px;
  display:flex;align-items:flex-start;gap:14px;
  box-shadow:0 0 0 1px rgba(232,255,79,.05);
}
.wb-emoji{font-size:2.2rem;flex-shrink:0;line-height:1;margin-top:2px}
.wb-title{
  font-family:'Bebas Neue',sans-serif;font-size:1.4rem;
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
  box-shadow:0 0 0 3px rgba(232,255,79,.1);
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
  background:rgba(232,255,79,.08);
  box-shadow:0 0 0 1px rgba(232,255,79,.2);
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
  background:rgba(232,255,79,.06);
  box-shadow:0 0 0 1px rgba(232,255,79,.15);
}
.abtn.active .al{color:var(--accent)}
.abtn-check{
  margin-left:auto;color:var(--accent);
  font-size:1.2rem;flex-shrink:0;
  background:rgba(232,255,79,.15);
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
  font-family:'Bebas Neue',sans-serif;
  font-size:1.15rem;letter-spacing:2px;
  transition:all .15s;
  display:flex;align-items:center;justify-content:center;
  -webkit-tap-highlight-color:transparent;
}
.btn-p{
  background:var(--accent);color:#0b0b12;font-weight:700;
  box-shadow:0 4px 18px rgba(232,255,79,.3);
}
.btn-p:active{transform:scale(.97);box-shadow:none}
.btn-p:disabled{opacity:.3;cursor:not-allowed;box-shadow:none}
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
  min-height:42px;min-width:0;
  padding:8px 12px;border-radius:10px;border:none;
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
  background:radial-gradient(circle,rgba(232,255,79,.06) 0%,transparent 70%);
  pointer-events:none;
}
.hero-lbl{font-size:.66rem;letter-spacing:2px;text-transform:uppercase;color:var(--muted);margin-bottom:6px}
.hero-val{font-family:'Bebas Neue',sans-serif;font-size:3.6rem;color:var(--accent);line-height:1}
.hero-unit{font-size:.84rem;color:var(--muted-light);margin-top:3px}
.hero-detail{font-size:.74rem;color:var(--muted);margin-top:10px;line-height:1.5}

/* ── Section titles ── */
.sec-title{
  font-family:'Bebas Neue',sans-serif;font-size:1.1rem;
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
.dc-val{font-family:'Bebas Neue',sans-serif;font-size:1.9rem}
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
  box-shadow:0 0 0 1px rgba(232,255,79,.15);
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
.drc-burn{font-family:'Bebas Neue',sans-serif;font-size:.95rem;color:var(--orange);letter-spacing:.5px;flex-shrink:0}
.drc-chevron{color:var(--muted);font-size:.65rem;transition:transform .2s;flex-shrink:0;margin-left:2px}
.drc-chevron.open{transform:rotate(180deg);color:var(--accent)}
.drc-edit-body{
  padding:14px 16px;
  border-top:1px solid rgba(232,255,79,.12);
  background:rgba(232,255,79,.02);
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
  font-family:'Bebas Neue',sans-serif;font-size:1.25rem;
  color:var(--orange);letter-spacing:.5px;white-space:nowrap;
}
.drc-row{
  display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:6px;
  padding:10px 14px 12px;border-top:1px solid var(--border);
}
.drc-cell{text-align:center;padding:9px 4px;background:var(--s2);border-radius:8px}
.drc-cell-lbl{font-size:.58rem;text-transform:uppercase;letter-spacing:.5px;color:var(--muted);margin-bottom:3px}
.drc-cell-val{font-family:'Bebas Neue',sans-serif;font-size:1.1rem;letter-spacing:.5px}

/* ── Weekly totals bar ── */
.weekly-total-bar{
  background:var(--s2);border:1px solid var(--border);
  border-radius:var(--radius-sm);padding:14px;margin-bottom:14px;
}
.wtb-row{display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--border)}
.wtb-row:last-child{border-bottom:none;padding-bottom:0}
.wtb-label{font-size:.8rem;color:var(--muted)}
.wtb-val{font-family:'Bebas Neue',sans-serif;font-size:1.1rem;letter-spacing:.5px}

/* ── Cardio summary pill ── */
.csumm{
  background:rgba(232,255,79,.03);border:1px solid rgba(232,255,79,.12);
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
.tlc-time{font-family:'Bebas Neue',sans-serif;font-size:1.6rem;line-height:1;margin-bottom:2px}
.tlc-sub{font-size:.74rem;color:var(--muted)}
.tlc-right{text-align:right}
.tlc-rate{font-family:'Bebas Neue',sans-serif;font-size:1.35rem;color:var(--orange)}
.tlc-rate-lbl{font-size:.65rem;color:var(--muted);margin-top:1px}

/* Milestone cards */
.ms-card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-sm);padding:14px;margin-bottom:10px}
.ms-card-header{font-weight:700;font-size:.93rem;margin-bottom:12px;color:var(--accent)}
.ms-row-inline{display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-bottom:1px solid var(--border)}
.ms-row-inline:last-child{border-bottom:none;padding-bottom:0}
.ms-pace{font-size:.79rem;color:var(--muted)}
.ms-loss{font-family:'Bebas Neue',sans-serif;font-size:1.15rem;letter-spacing:.5px}
.ms-wt{font-size:.72rem;color:var(--muted);margin-top:1px}
.ms-card-goal{border-color:rgba(232,255,79,.3);background:rgba(232,255,79,.025)}
.ms-card-goal .ms-card-header{color:var(--accent)}
.prog-bar-bg{height:5px;border-radius:3px;background:var(--border);overflow:hidden;margin-top:3px}
.prog-bar-fill{height:100%;border-radius:3px;transition:width .5s}

/* ── Goal weight step ── */
.weight-compare{display:grid;grid-template-columns:1fr auto 1fr;gap:10px;align-items:center;margin-bottom:16px}
.wc-box{background:var(--s2);border:1.5px solid var(--border);border-radius:var(--radius-sm);padding:16px;text-align:center;transition:border-color .2s}
.wc-lbl{font-size:.65rem;letter-spacing:1px;text-transform:uppercase;color:var(--muted);margin-bottom:4px}
.wc-val{font-family:'Bebas Neue',sans-serif;font-size:2.1rem;color:var(--accent)}
.wc-unit{font-size:.72rem;color:var(--muted)}
.wc-arrow{color:var(--orange);font-size:1.3rem;text-align:center}
.lose-badge{
  background:rgba(255,107,53,.08);border:1px solid rgba(255,107,53,.22);
  border-radius:var(--radius-sm);padding:14px 16px;text-align:center;margin-bottom:16px;
}
.lb-lbl{font-size:.68rem;letter-spacing:1px;text-transform:uppercase;color:var(--orange);margin-bottom:4px}
.lb-val{font-family:'Bebas Neue',sans-serif;font-size:2.4rem;color:var(--orange)}
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
.ibw-toggle-title{font-family:'Bebas Neue',sans-serif;font-size:1.2rem;letter-spacing:2px;color:var(--accent);white-space:nowrap}
.ibw-toggle-summary{font-size:.76rem;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ibw-toggle-chevron{color:var(--muted);font-size:.8rem;transition:transform .2s;flex-shrink:0}
.ibw-toggle-chevron.open{transform:rotate(180deg);color:var(--accent)}
.ibw-body{padding:0 18px 20px;animation:fadeUp .18s ease both}
.ibw-title{font-family:'Bebas Neue',sans-serif;font-size:1.3rem;letter-spacing:2px;color:var(--accent);margin-bottom:3px}
.ibw-subtitle{font-size:.76rem;color:var(--muted);margin-bottom:16px;line-height:1.5}
.ibw-range-row{display:flex;justify-content:space-between;align-items:flex-start;gap:14px;margin-bottom:18px;flex-wrap:wrap}
.ibw-range-val{flex:1}
.ibw-range-num{font-family:'Bebas Neue',sans-serif;font-size:2.3rem;color:var(--green);line-height:1}
.ibw-range-lbl{font-size:.73rem;color:var(--muted);margin-top:4px}
.ibw-bmi-badge{text-align:center;padding:12px 16px;border-radius:10px;background:var(--s2);border:1px solid var(--border);min-width:90px}
.ibw-bmi-num{font-family:'Bebas Neue',sans-serif;font-size:1.9rem;line-height:1}
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
.ibw-formula-val{font-family:'Bebas Neue',sans-serif;font-size:1rem;color:var(--accent);text-align:right;white-space:nowrap}
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
.info-icon:hover,.info-icon.active{background:rgba(232,255,79,.16);border-color:var(--accent);color:var(--accent)}
.info-panel{
  padding:13px 14px;
  background:rgba(232,255,79,.04);border-top:1px solid rgba(232,255,79,.1);
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
.cst-label{font-family:'Bebas Neue',sans-serif;font-size:1.1rem;letter-spacing:1.5px;font-weight:700}
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
.chart-overlay-arrow:hover:not(:disabled){background:rgba(232,255,79,.14);border-color:var(--accent);color:var(--accent)}
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
  background:rgba(232,255,79,.025);border:1px solid rgba(232,255,79,.1);
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
.cpt-val{font-family:'Bebas Neue',sans-serif;font-size:1rem;letter-spacing:.5px;text-align:center}

/* ── Quick fill ── */
.quick-fill-toggle{
  width:100%;padding:13px 15px;border-radius:10px;
  border:1.5px dashed rgba(232,255,79,.25);background:rgba(232,255,79,.025);
  color:var(--accent);cursor:pointer;font-family:inherit;
  font-size:.84rem;font-weight:600;text-align:left;
  margin-bottom:14px;transition:all .2s;
  -webkit-tap-highlight-color:transparent;
}
.quick-fill-toggle:hover{border-color:var(--accent);background:rgba(232,255,79,.05)}
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
  font-family:'Bebas Neue',sans-serif;font-size:.85rem;
  letter-spacing:1px;color:var(--muted);width:36px;flex-shrink:0;
}
.day-cardio-name{flex:1;font-size:.9rem;font-weight:500;line-height:1.4}
.day-cardio-name.rest{color:var(--muted)}
.day-burn{font-family:'Bebas Neue',sans-serif;font-size:.9rem;color:var(--orange);letter-spacing:.5px;white-space:nowrap}
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
.nutr-cals-badge{font-family:'Bebas Neue',sans-serif;font-size:1rem;letter-spacing:1px;color:var(--accent)}
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
.mc-grams{font-family:'Bebas Neue',sans-serif;font-size:2.1rem;line-height:1;color:var(--text)}
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
.nutr-hydration-val{font-family:'Bebas Neue',sans-serif;font-size:1.15rem;letter-spacing:.5px;color:#4fc3f7;margin-bottom:3px}
.nutr-hydration-note{font-size:.75rem;color:var(--muted);line-height:1.5}
.micro-cat-label{font-size:.68rem;letter-spacing:1.5px;text-transform:uppercase;color:var(--muted);font-weight:700;margin:16px 0 7px}
.micro-row{
  background:var(--surface);border:1px solid var(--border);
  border-radius:var(--radius-sm);margin-bottom:9px;overflow:hidden;transition:border-color .15s;
}
.micro-row.micro-open{border-color:rgba(232,255,79,.28)}
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
.micro-detail{padding:13px 15px 15px;border-top:1px solid var(--border);background:rgba(232,255,79,.02)}
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
  padding:9px 11px;background:rgba(232,255,79,.04);
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
.surplus-hero-title{font-family:'Bebas Neue',sans-serif;font-size:1.4rem;letter-spacing:2px;color:var(--orange);margin-bottom:3px}
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
.st-surplus-num{font-family:'Bebas Neue',sans-serif;font-size:1.05rem;color:var(--orange);letter-spacing:.5px}
.st-surplus-unit{font-size:.6rem;color:var(--muted);text-transform:uppercase}
.st-net-surplus{font-size:.58rem;color:var(--accent);margin-top:2px}
.st-data-row{display:grid;grid-template-columns:90px repeat(7,1fr);border-bottom:1px solid var(--border)}
.st-data-row:last-child{border-bottom:none}
.st-data-row:nth-child(even){background:rgba(255,255,255,.012)}
.st-row-label{padding:10px 8px;border-right:1px solid var(--border);display:flex;flex-direction:column;justify-content:center}
.st-lbs{font-family:'Bebas Neue',sans-serif;font-size:1.1rem;letter-spacing:.5px;color:var(--text)}
.st-fat-label{font-size:.6rem;color:var(--muted);text-transform:uppercase;letter-spacing:.5px}
.st-cell{padding:10px 4px;text-align:center;font-family:'Bebas Neue',sans-serif;font-size:.9rem;letter-spacing:.5px;border-right:1px solid var(--border);display:flex;align-items:center;justify-content:center}
.st-cell:last-child{border-right:none}
.surplus-cards{display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin-bottom:18px}
.surplus-card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-sm);padding:14px 13px}
.surplus-card-offset{border-color:rgba(79,255,176,.22);background:rgba(79,255,176,.025)}
.sc-surplus{font-family:'Bebas Neue',sans-serif;font-size:1.4rem;letter-spacing:1px;color:var(--orange);margin-bottom:7px}
.sc-surplus-unit{font-size:.75rem;color:var(--muted);letter-spacing:0;font-family:'DM Sans',sans-serif}
.sc-row{display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-bottom:1px solid var(--border)}
.sc-row:last-of-type{border-bottom:none;padding-bottom:0}
.sc-label{font-size:.73rem;color:var(--muted)}.sc-val{font-family:'Bebas Neue',sans-serif;font-size:1rem;letter-spacing:.5px}
.sc-cardio-note{font-size:.65rem;color:var(--green);margin-top:5px;text-align:center}
.sc-offset{font-size:.79rem;color:var(--green);line-height:1.4;margin-top:4px}
.surplus-takeaway{
  background:rgba(232,255,79,.04);border:1px solid rgba(232,255,79,.12);
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
.muscle-hero-title{font-family:'Bebas Neue',sans-serif;font-size:1.4rem;letter-spacing:2px;color:var(--green);margin-bottom:3px}
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
.mch-cals{font-family:'Bebas Neue',sans-serif;font-size:2.9rem;color:var(--green);line-height:1}
.mch-unit{font-size:.79rem;color:var(--muted);margin-bottom:7px}
.mch-breakdown{font-size:.7rem;color:var(--muted);line-height:1.5;border-top:1px solid var(--border);padding-top:7px}
.mch-right{display:flex;gap:9px;flex-wrap:wrap}
.mch-box{background:var(--s2);border:1px solid var(--border);border-radius:10px;padding:11px 13px;min-width:100px;text-align:center}
.mch-box-lbl{font-size:.62rem;text-transform:uppercase;letter-spacing:.8px;color:var(--muted);margin-bottom:3px}
.mch-box-val{font-family:'Bebas Neue',sans-serif;font-size:1.3rem;letter-spacing:.5px;line-height:1}
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
.mt-surplus{font-family:'Bebas Neue',sans-serif;font-size:1.05rem;color:var(--orange)}
.mt-unit{font-size:.7rem;color:var(--muted)}
.mt-rec-badge{
  display:inline-block;margin-left:5px;
  background:rgba(79,255,176,.13);border:1px solid rgba(79,255,176,.28);
  color:var(--green);border-radius:4px;padding:1px 6px;
  font-size:.6rem;letter-spacing:.5px;text-transform:uppercase;
}
.muscle-timeline{display:grid;grid-template-columns:repeat(3,1fr);gap:11px;margin-bottom:15px}
.mtl-card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-sm);padding:14px 12px}
.mtl-period{font-family:'Bebas Neue',sans-serif;font-size:1.1rem;letter-spacing:1px;color:var(--accent);margin-bottom:11px}
.mtl-row{display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-bottom:1px solid var(--border);font-size:.75rem}
.mtl-row:last-of-type{border-bottom:none}
.mtl-lbl{color:var(--muted);font-size:.72rem}
.mtl-val{font-family:'Bebas Neue',sans-serif;font-size:.95rem;letter-spacing:.5px}
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
.str-hero-title{font-family:'Bebas Neue',sans-serif;font-size:1.4rem;letter-spacing:2px;color:#4fc3f7;margin-bottom:3px}
.str-hero-sub{font-size:.81rem;color:var(--muted);line-height:1.5}
.str-hero-sub strong{color:var(--text)}
.str-stat-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin-bottom:16px}
.str-stat{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-sm);padding:15px 13px;text-align:center}
.str-stat-val{font-family:'Bebas Neue',sans-serif;font-size:1.6rem;letter-spacing:.5px;line-height:1;margin-bottom:3px}
.str-stat-lbl{font-size:.68rem;text-transform:uppercase;letter-spacing:.8px;color:var(--muted)}
.str-compound-note{
  background:rgba(255,204,68,.05);border:1px solid rgba(255,204,68,.18);
  border-radius:var(--radius-sm);padding:12px 15px;font-size:.8rem;color:var(--muted);line-height:1.6;margin-bottom:15px;
}
.str-compound-note strong{color:var(--yellow)}.str-compound-note em{color:var(--text)}
.str-proj-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin-bottom:15px}
.str-proj-card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-sm);padding:14px 13px}
.str-proj-period{font-family:'Bebas Neue',sans-serif;font-size:1.05rem;letter-spacing:1px;color:var(--accent);margin-bottom:9px}
.str-proj-row{display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-bottom:1px solid var(--border);font-size:.77rem}
.str-proj-row:last-child{border-bottom:none;padding-bottom:0}
.str-proj-lbl{color:var(--muted)}.str-proj-val{font-family:'Bebas Neue',sans-serif;font-size:.95rem;letter-spacing:.5px}
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
  background:linear-gradient(135deg,rgba(232,255,79,.07),rgba(255,107,53,.04));
  border:1px solid rgba(232,255,79,.18);border-radius:var(--radius-lg);
  padding:18px;margin-bottom:20px;
  display:grid;grid-template-columns:1fr 1fr;gap:10px;
}
.rsb-stat{text-align:center;padding:8px}
.rsb-val{font-family:'Bebas Neue',sans-serif;font-size:1.85rem;line-height:1;margin-bottom:3px}
.rsb-lbl{font-size:.63rem;text-transform:uppercase;letter-spacing:1px;color:var(--muted)}
.rsb-divider{border:none;border-top:1px solid var(--border);margin:0;grid-column:1/-1}

/* ── Responsive desktop ── */
@media(min-width:480px){
  .bottom-nav{position:sticky;bottom:0;border-radius:0;border-top:1px solid var(--border)}
  .app{padding-bottom:0}
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
.dash-greeting{font-family:'Bebas Neue',sans-serif;font-size:2rem;letter-spacing:3px;color:var(--text);text-align:center;margin-bottom:18px}
.dash-streak{
  display:flex;align-items:center;justify-content:center;gap:8px;
  background:linear-gradient(135deg,rgba(232,255,79,.08),rgba(255,107,53,.04));
  border:1px solid rgba(232,255,79,.2);border-radius:var(--radius-lg);
  padding:14px;margin-bottom:18px;text-align:center;
}
.dash-streak-num{font-family:'Bebas Neue',sans-serif;font-size:2.4rem;color:var(--accent);line-height:1}
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
.dash-cta-val{font-family:'Bebas Neue',sans-serif;font-size:1.5rem;color:var(--accent);letter-spacing:.5px}
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
  font-family:'Bebas Neue',sans-serif;font-size:1.1rem;text-align:center;
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
  border:1.5px solid rgba(232,255,79,.2);border-radius:var(--radius-lg);
  padding:24px 20px;text-align:center;margin-top:16px;
}
.share-card-name{font-family:'Bebas Neue',sans-serif;font-size:1.8rem;letter-spacing:3px;color:var(--accent);margin-bottom:4px}
.share-card-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:14px 0}
.share-stat{padding:10px 6px;background:var(--s2);border-radius:8px}
.share-stat-val{font-family:'Bebas Neue',sans-serif;font-size:1.4rem;color:var(--accent)}
.share-stat-lbl{font-size:.62rem;color:var(--muted);text-transform:uppercase;letter-spacing:.5px}
.share-brand{font-size:.65rem;color:var(--muted);margin-top:10px;letter-spacing:1px}

@keyframes fadeUp{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
@keyframes pulse{0%,100%{opacity:.6}50%{opacity:1}}

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
  background:var(--accent);color:#0b0b12;
  font-size:.65rem;font-weight:700;padding:2px 7px;
  border-radius:10px;min-width:20px;text-align:center;
}
.profiles-panel{
  background:var(--surface);border:1px solid var(--border);
  border-radius:var(--radius-lg);padding:18px;margin-bottom:20px;
  animation:fadeUp .18s ease both;
}
.profiles-panel-title{
  font-family:'Bebas Neue',sans-serif;font-size:1.2rem;
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
.profile-card:hover{border-color:var(--accent);background:rgba(232,255,79,.03)}
.profile-card.pc-active{border-color:var(--accent);background:rgba(232,255,79,.06)}
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
.pc-load-btn:hover{background:rgba(232,255,79,.15)}
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
.save-bar-btn:hover{background:rgba(232,255,79,.15)}
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
.folder-section.drag-over{border-color:var(--accent);box-shadow:0 0 12px rgba(232,255,79,.15)}
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
  border:1.5px dashed rgba(232,255,79,.25);background:rgba(232,255,79,.025);
  color:var(--accent);cursor:pointer;font-family:inherit;
  font-size:.8rem;font-weight:600;transition:all .15s;
}
.folder-new-btn:hover{border-color:var(--accent);background:rgba(232,255,79,.06)}
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
.dash-stat-val{font-family:'Bebas Neue',sans-serif;font-size:1.8rem;line-height:1;margin-bottom:2px}
.dash-stat-lbl{font-size:.62rem;text-transform:uppercase;letter-spacing:.8px;color:var(--muted)}

/* ── Daily Check-In ── */
.checkin-card{
  background:linear-gradient(135deg,rgba(79,255,176,.05),rgba(232,255,79,.03));
  border:1.5px solid rgba(79,255,176,.2);border-radius:var(--radius-lg);
  padding:18px;margin-bottom:16px;
}
.checkin-title{font-family:'Bebas Neue',sans-serif;font-size:1.2rem;letter-spacing:2px;color:var(--green);margin-bottom:4px}
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
  background:var(--s2);cursor:pointer;font-size:1.2rem;text-align:center;
  transition:all .15s;-webkit-tap-highlight-color:transparent;
}
.mood-btn.active{border-color:var(--accent);background:var(--accent-dim)}
.checkin-submit{
  width:100%;min-height:44px;border-radius:10px;border:none;
  background:var(--green);color:#0b0b12;cursor:pointer;
  font-family:'Bebas Neue',sans-serif;font-size:1.1rem;letter-spacing:2px;
  transition:all .15s;
}
.checkin-submit:active{transform:scale(.97)}
.checkin-submit:disabled{opacity:.3;cursor:not-allowed}

/* ── Streak & Badges ── */
.streak-bar{
  display:flex;align-items:center;gap:10px;
  padding:12px 16px;border-radius:var(--radius-sm);
  background:rgba(232,255,79,.04);border:1px solid rgba(232,255,79,.12);
  margin-bottom:14px;
}
.streak-fire{font-size:1.4rem}
.streak-num{font-family:'Bebas Neue',sans-serif;font-size:1.6rem;color:var(--accent);line-height:1}
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
  border-radius:50%;background:radial-gradient(circle,rgba(232,255,79,.08) 0%,transparent 70%);
}
.share-card-brand{font-family:'Bebas Neue',sans-serif;font-size:1rem;letter-spacing:3px;color:var(--accent);opacity:.6;margin-bottom:8px}
.share-card-name{font-family:'Bebas Neue',sans-serif;font-size:1.8rem;color:var(--text);margin-bottom:4px}
.share-card-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:16px 0}
.scs-item{padding:10px 6px}
.scs-val{font-family:'Bebas Neue',sans-serif;font-size:1.5rem;line-height:1;margin-bottom:2px}
.scs-lbl{font-size:.6rem;text-transform:uppercase;letter-spacing:.5px;color:var(--muted)}
.share-card-footer{font-size:.7rem;color:var(--muted);margin-top:12px}
.share-btn{
  width:100%;min-height:46px;border-radius:10px;border:none;
  background:var(--accent);color:#0b0b12;cursor:pointer;
  font-family:'Bebas Neue',sans-serif;font-size:1.05rem;letter-spacing:2px;
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
.prof-card:hover{border-color:var(--accent);background:rgba(232,255,79,.03)}
.prof-avatar{
  width:44px;height:44px;border-radius:50%;
  background:var(--accent-dim);border:2px solid var(--accent);
  display:flex;align-items:center;justify-content:center;
  font-family:'Bebas Neue',sans-serif;font-size:1.1rem;color:var(--accent);
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
  border:2px dashed rgba(232,255,79,.3);background:rgba(232,255,79,.02);
  color:var(--accent);cursor:pointer;font-family:'Bebas Neue',sans-serif;
  font-size:1.1rem;letter-spacing:2px;transition:all .15s;
  display:flex;align-items:center;justify-content:center;gap:10px;
}
.prof-new-btn:hover{border-color:var(--accent);background:rgba(232,255,79,.06)}
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
    <div style={{position:"relative"}}>
      <input
        ref={inputRef}
        type="text"
        placeholder={placeholder || "Search exercises..."}
        value={search}
        onChange={e => { setSearch(e.target.value); setShowResults(true); }}
        onFocus={() => setShowResults(true)}
        onBlur={() => setTimeout(() => setShowResults(false), 200)}
        style={{
          width:"100%", padding:"12px 14px", borderRadius:"var(--radius-sm)",
          border:"1.5px solid var(--border)", background:"var(--s2)",
          color:"var(--text)", fontFamily:"inherit", fontSize:".88rem",
          outline:"none", marginBottom:"6px",
        }}
      />
      {showResults && filtered.length > 0 && (
        <div style={{
          position:"absolute", top:"100%", left:0, right:0, zIndex:20,
          background:"var(--surface)", border:"1.5px solid var(--accent)",
          borderRadius:"var(--radius-sm)", maxHeight:"240px", overflowY:"auto",
          boxShadow:"var(--shadow-md)",
        }}>
          {filtered.map(ex => (
            <div key={ex.id}
              onMouseDown={e => { e.preventDefault(); onChange(ex.id); setSearch(""); setShowResults(false); }}
              style={{
                padding:"10px 14px", cursor:"pointer", borderBottom:"1px solid var(--border)",
                display:"flex", gap:"8px", alignItems:"center",
                background: ex.id === value ? "rgba(232,255,79,.06)" : "transparent",
              }}
            >
              <span style={{fontSize:"1rem"}}>{ex.icon}</span>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontWeight:600,fontSize:".84rem"}}>{ex.label}</div>
                <div style={{fontSize:".7rem",color:"var(--muted)"}}>{ex.cat||""}{ex.note ? ` · ${ex.note}` : ""}</div>
              </div>
            </div>
          ))}
        </div>
      )}
      {query.length >= 2 && filtered.length === 0 && showResults && (
        <div style={{fontSize:".78rem",color:"var(--muted)",padding:"6px 0"}}>No matches — try a different term</div>
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
    <div style={{marginTop:"10px",marginBottom:"10px"}}>
      <button className="quick-fill-toggle" style={{borderColor:"rgba(181,123,255,.25)",color:"#b57bff",background:"rgba(181,123,255,.03)",marginBottom:show?"8px":"0"}}
        onClick={()=>setShow(v=>!v)}>
        ⭐ Create Custom {exerciseType === "cardio" ? "Cardio" : "Strength"} Exercise {show?"▲":"▼"}
      </button>
      {show && (
        <div className="quick-fill-panel" style={{borderColor:"rgba(181,123,255,.2)"}}>
          <div className="field">
            <label>Exercise Name</label>
            <input type="text" placeholder="e.g. Battle Ropes, TRX Row, Sled Push" value={name}
              onChange={e=>setName(e.target.value)} style={{width:"100%",padding:"10px 12px",borderRadius:"8px",border:"1.5px solid var(--border)",background:"var(--s2)",color:"var(--text)",fontFamily:"inherit",fontSize:".88rem"}} />
          </div>
          <div className="field">
            <label>Estimated Calories Burned Per Minute <span className="field-hint">your best estimate</span></label>
            <input type="text" inputMode="decimal" placeholder="e.g. 8" value={calPerMin}
              onChange={e=>setCalPerMin(e.target.value.replace(/[^0-9.]/g,""))}
              style={{width:"100%",padding:"10px 12px",borderRadius:"8px",border:"1.5px solid var(--border)",background:"var(--s2)",color:"var(--text)",fontFamily:"inherit",fontSize:".88rem"}} />
            <div style={{fontSize:".7rem",color:"var(--muted)",marginTop:"4px",lineHeight:1.4}}>
              💡 Reference: walking ≈ 4 cal/min, jogging ≈ 9 cal/min, intense HIIT ≈ 14 cal/min. If unsure, estimate conservatively.
            </div>
          </div>
          <button className="btn btn-p" style={{width:"100%",fontSize:".9rem",minHeight:"42px"}}
            disabled={!canSave||saved} onClick={handleSave}>
            {saved ? "✓ Added!" : `Save Custom Exercise`}
          </button>
          <div style={{fontSize:".6rem",color:"var(--muted)",marginTop:"6px",fontStyle:"italic",textAlign:"center"}}>
            ⭐ Custom exercises are marked with a star and labeled "User Estimate" to distinguish them from CalorieIQ's library. Calorie values are your estimates, not validated.
          </div>
        </div>
      )}
    </div>
  );
}

function BottomNav({ onBack, onNext, nextLabel = "Next →", nextDisabled = false, showBack = true }) {
  return (
    <div className="bottom-nav">
      {showBack && <button className="btn btn-g" onClick={onBack}>← Back</button>}
      <button className="btn btn-p" disabled={nextDisabled} onClick={onNext}>{nextLabel}</button>
    </div>
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
    <div className="fu">
      {/* Welcome banner */}
      <div className="welcome-banner">
        <div className="wb-emoji">👋</div>
        <div>
          <div className="wb-title">Welcome to CalorieIQ</div>
          <div className="wb-sub">Answer a few quick questions and we'll build your personalized plan. Takes about 2 minutes.</div>
        </div>
      </div>

      <div className="card">
        <div className="card-title">About You</div>
        <div className="card-sub">This lets us calculate your exact metabolism using a clinically validated formula.</div>

        <div className="field">
          <label>I am a</label>
          <div className="gender-toggle">
            <button className={`gbtn${data.gender==="male"?" active":""}`} onClick={()=>onChange("gender","male")}>
              <span style={{fontSize:"1.2rem"}}>♂</span> Male
            </button>
            <button className={`gbtn${data.gender==="female"?" active":""}`} onClick={()=>onChange("gender","female")}>
              <span style={{fontSize:"1.2rem"}}>♀</span> Female
            </button>
          </div>
        </div>

        <div className="field-row">
          <div className="field">
            <label>Age <span className="field-hint">years</span></label>
            <input inputMode="numeric" placeholder="28" value={data.age} onChange={numOnly("age")} maxLength={3} onKeyDown={advanceOnEnter}/>
          </div>
          <div className="field">
            <label>Current Weight <span className="field-hint">lbs</span></label>
            <input inputMode="decimal" placeholder="185" value={data.weightLbs} onChange={decOnly("weightLbs")} maxLength={6} onKeyDown={advanceOnEnter}/>
          </div>
        </div>

        <div className="field">
          <label>Height</label>
          <div className="field-row">
            <div className="field" style={{marginBottom:0}}>
              <input inputMode="numeric" placeholder="Feet — e.g. 5" value={data.heightFt} onChange={numOnly("heightFt")} maxLength={1} onKeyDown={advanceOnEnter}/>
            </div>
            <div className="field" style={{marginBottom:0}}>
              <input inputMode="numeric" placeholder="Inches — e.g. 10" value={data.heightIn} onChange={numOnly("heightIn")} maxLength={2} onKeyDown={advanceOnEnter}/>
            </div>
          </div>
        </div>

        <div className="field-row">
          <div className="field">
            <label>First Name</label>
            <input inputMode="text" placeholder="e.g. Alex" value={data.firstName} onChange={textOnly("firstName")} maxLength={25} onKeyDown={advanceOnEnter}/>
          </div>
          <div className="field">
            <label>Last Name</label>
            <input inputMode="text" placeholder="e.g. Smith" value={data.lastName} onChange={textOnly("lastName")} maxLength={25} onKeyDown={advanceOnEnter}/>
          </div>
        </div>

        <div className="field">
          <label>Body Fat % <span className="field-hint">optional — from calipers, scale, or DEXA</span></label>
          <input inputMode="decimal" placeholder="e.g. 22" value={data.bodyFat} onChange={decOnly("bodyFat")} maxLength={5} onKeyDown={advanceOnEnter}/>
          {data.bodyFat && Number(data.bodyFat) > 0 && (()=>{
            const bf = Number(data.bodyFat);
            const isMale = data.gender === "male";
            const cat = isMale
              ? bf < 6 ? {label:"Essential Fat",color:"var(--red)"} : bf < 14 ? {label:"Athletic",color:"var(--green)"} : bf < 18 ? {label:"Fitness",color:"var(--green)"} : bf < 25 ? {label:"Average",color:"var(--yellow)"} : {label:"Above Average",color:"var(--orange)"}
              : bf < 14 ? {label:"Essential Fat",color:"var(--red)"} : bf < 21 ? {label:"Athletic",color:"var(--green)"} : bf < 25 ? {label:"Fitness",color:"var(--green)"} : bf < 32 ? {label:"Average",color:"var(--yellow)"} : {label:"Above Average",color:"var(--orange)"};
            const lbmLbs = Math.round(Number(data.weightLbs) * (1 - bf/100));
            const fatLbs = Math.round(Number(data.weightLbs) * (bf/100));
            return (
              <div style={{display:"flex",gap:"10px",marginTop:"8px",fontSize:".78rem",color:"var(--muted)",flexWrap:"wrap"}}>
                <span style={{color:cat.color,fontWeight:600}}>{cat.label}</span>
                <span>·</span>
                <span>{fatLbs} lbs fat</span>
                <span>·</span>
                <span>{lbmLbs} lbs lean mass</span>
              </div>
            );
          })()}
          <div style={{fontSize:".6rem",color:"var(--muted)",marginTop:"4px",fontStyle:"italic"}}>*BF% from consumer scales can be off by 3-8%. DEXA and calipers by a trained professional are more accurate.</div>
        </div>

        {/* Privacy note */}
        <div className="privacy-note">🔒 Your information is used only to calculate your results — nothing is stored or shared.</div>
        <div style={{fontSize:".6rem",color:"var(--muted)",textAlign:"center",marginTop:"6px",fontStyle:"italic"}}>⚠️ All calculations are estimates based on published formulas — not medical advice.</div>
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
    <div className="fu">
      <div className="card">
        <div className="card-title">Your Goal Weight</div>
        <div className="card-sub">
          Where do you want to be? We'll show you exactly how long it takes and what to do each day to get there.
        </div>
        <div className="weight-compare">
          <div className="wc-box">
            <div className="wc-lbl">Starting at</div>
            <div className="wc-val">{current||"—"}</div>
            <div className="wc-unit">lbs today</div>
          </div>
          <div className="wc-arrow">→</div>
          <div className="wc-box" style={{borderColor: valid?"var(--accent)":"var(--border)"}}>
            <div className="wc-lbl">Goal</div>
            <div className="wc-val" style={{color:valid?"var(--accent)":"var(--muted)"}}>
              {goal||"?"}
            </div>
            <div className="wc-unit">lbs target</div>
          </div>
        </div>
        <div className="field">
          <label>Enter your goal weight <span className="field-hint">lbs</span></label>
          <input
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
            style={{fontSize:"1.1rem",textAlign:"center",fontWeight:600}}
          />
        </div>
        {toLose && (
          <div className="lose-badge">
            <div className="lb-lbl">Total to lose</div>
            <div className="lb-val">{toLose.toFixed(1)}</div>
            <div className="lb-unit">pounds — we'll map out exactly how to get there</div>
          </div>
        )}
        {goal > 0 && goal >= current && (
          <div className="error-box">⚠️ Goal must be less than your current weight ({current} lbs).</div>
        )}

        {/* Body Fat Goal */}
        {data.bodyFat && Number(data.bodyFat) > 0 && (
          <div className="field" style={{marginTop:"12px"}}>
            <label>Goal Body Fat % <span className="field-hint">optional</span></label>
            <input inputMode="decimal" placeholder={`e.g. ${Math.max(8, Math.round(Number(data.bodyFat) - 5))}`}
              value={data.goalBodyFat}
              onChange={e => { let v = e.target.value.replace(/[^0-9.]/g,""); onChange("goalBodyFat",v); }}
              maxLength={5} style={{textAlign:"center",fontWeight:600}} />
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
                    <div className="lose-badge" style={{marginTop:"10px",borderColor:"rgba(79,255,176,.22)",background:"rgba(79,255,176,.05)"}}>
                      <div className="lb-lbl" style={{color:"var(--green)"}}>Body Fat Goal</div>
                      <div className="lb-val" style={{color:"var(--green)"}}>{startBf}% → {goalBf}%</div>
                      <div className="lb-unit">≈ {fatLbsToLose} lbs of fat to lose · est. {monthsFast}–{monthsSlow} months*</div>
                    </div>
                  )}
                  {tooLow && (
                    <div className="error-box">⚠️ {goalBf}% is below the {isMale?"athletic (6%)":"athletic (14%)"} threshold for {isMale?"men":"women"}. Going below {minBf}% BF can be harmful — competition-level leanness is not sustainable long-term.</div>
                  )}
                  {bfToLose > 0 && (
                    <div style={{fontSize:".62rem",color:"var(--muted)",marginTop:"4px",fontStyle:"italic"}}>*BF% timeline estimates 0.5–1% loss per month with consistent deficit and resistance training. Actual results vary significantly.</div>
                  )}
                  {goalBf >= startBf && <div className="error-box">⚠️ Goal BF% should be lower than your current {startBf}%.</div>}
                </>
              );
            })()}
          </div>
        )}
        <div className="field-tip">
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
        <div style={{fontSize:".6rem",color:"var(--muted)",textAlign:"center",marginTop:"8px",fontStyle:"italic"}}>⚠️ Weight loss timelines are estimates. Consult a healthcare provider before starting any weight loss program.</div>
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
    <div className="fu" onClick={()=>activeInfo && setActiveInfo(null)}>
      <div className="card">
        <div className="card-title">Daily Activity Level</div>
        <div className="card-sub">
          This measures your <strong style={{color:"var(--text)"}}>non-exercise movement</strong> — your job, daily routine, and how much you're on your feet. <strong style={{color:"var(--text)"}}>Do NOT include planned workouts</strong> — those are tracked separately in the next steps.
        </div>
        <div className="field-tip" style={{marginTop:0,marginBottom:"16px"}}>
          📊 <strong>How this works:</strong> Your body burns a baseline number of calories just existing (BMR). This step estimates how much your daily lifestyle adds on top of that — sitting at a desk all day burns far fewer calories than being on your feet in a warehouse. Your planned cardio and strength training are calculated separately in the next steps and added to this baseline, so you get an accurate total without double-counting.
        </div>
        {ACTIVITY_LEVELS.map(a=>(
          <div key={a.id}>
            <div style={{display:"flex",alignItems:"center",gap:"4px"}}>
              <button className={`abtn${data.activityLevel===a.id?" active":""}`} style={{flex:1}} onClick={()=>{onChange("activityLevel",a.id);setActiveInfo(null);}}>
                <span className="abtn-emoji">{a.emoji}</span>
                <div><div className="al">{a.label}</div><div className="ad">{a.desc}</div></div>
                {data.activityLevel===a.id && <span className="abtn-check">✓</span>}
              </button>
              <button className={`info-icon${activeInfo===a.id?" active":""}`}
                onClick={(e)=>{e.stopPropagation();setActiveInfo(activeInfo===a.id?null:a.id);}}
                style={{marginLeft:"4px",flexShrink:0}}>i</button>
            </div>
            {activeInfo===a.id && (
              <div onClick={e=>e.stopPropagation()} style={{padding:"12px 14px",marginBottom:"8px",background:"rgba(232,255,79,.06)",border:"1.5px solid rgba(232,255,79,.2)",borderRadius:"8px",fontSize:".82rem",color:"var(--text-secondary)",lineHeight:1.7,animation:"fadeUp .15s ease both"}}>
                {ACTIVITY_DETAILS[a.id]}
              </div>
            )}
          </div>
        ))}
        <div className="field-tip">💡 When in doubt, choose one level lower — most people overestimate how active they are day-to-day.</div>
        <div style={{fontSize:".6rem",color:"var(--muted)",textAlign:"center",marginTop:"8px",fontStyle:"italic"}}>⚠️ Activity multipliers are general estimates — actual energy expenditure varies by individual.</div>
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

  const allExercises = [REST_ST, ...STRENGTH_EXERCISES];
  const getEx = id => allExercises.find(e=>e.id===id) || REST_ST;

  return (
    <div className="fu">
      <div className="card">
        <div className="card-title">💪 Strength Training Plan</div>
        <div className="card-sub">
          Assign strength workouts to each day. You can add multiple sessions per day.
          Calorie burn is estimated using MET values from the
          <em> 2011 Compendium of Physical Activities</em> (Ainsworth et al., MSSE).
        </div>

        {/* Quick Fill */}
        <button className="quick-fill-toggle" onClick={()=>setShowFill(v=>!v)}>
          ⚡ Quick Fill — Apply one exercise to multiple days {showFill?"▲":"▼"}
        </button>
        {showFill && (
          <div className="quick-fill-panel fu">
            <div className="field">
              <label>Exercise</label>
              <select value={fillType} onChange={e=>setFillType(e.target.value)}>
                {STRENGTH_GROUPS.map(cat=>(
                  <optgroup key={cat} label={cat}>
                    {STRENGTH_EXERCISES.filter(e=>e.cat===cat).map(e=>(
                      <option key={e.id} value={e.id}>{e.icon} {e.label}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Duration</label>
              <select value={fillDuration} onChange={e=>setFillDuration(Number(e.target.value))}>
                {ST_DURATIONS.map(m=><option key={m} value={m}>{m} minutes</option>)}
              </select>
            </div>
            <div className="field">
              <label>Apply to days</label>
              <div className="fill-day-grid">
                {DAYS.map((day,i)=>(
                  <button key={day}
                    className={`fill-day-btn${fillDays.includes(day)?" selected":""}`}
                    onClick={()=>toggleFillDay(day)}>
                    {DAY_SHORT[i]}
                  </button>
                ))}
              </div>
            </div>
            <div style={{display:"flex",gap:"8px",marginTop:"4px"}}>
              <button className="btn btn-p" style={{fontSize:".9rem",letterSpacing:"1px",minHeight:"44px",flex:1}}
                disabled={!fillDays.length} onClick={applyFill}>
                Apply to {fillDays.length||"0"} day{fillDays.length!==1?"s":""}
              </button>
            </div>
            <div style={{display:"flex",gap:"6px",marginTop:"8px",flexWrap:"wrap"}}>
              <span style={{fontSize:".72rem",color:"var(--muted)",alignSelf:"center"}}>Presets:</span>
              {[
                {label:"MWF", days:["Monday","Wednesday","Friday"]},
                {label:"M–F", days:["Monday","Tuesday","Wednesday","Thursday","Friday"]},
                {label:"All 7",days:DAYS},
              ].map(p=>(
                <button key={p.label} className="fill-preset-btn" onClick={()=>setFillDays(p.days)}>{p.label}</button>
              ))}
            </div>
          </div>
        )}

        {/* Movement Pattern Combos */}
        <button className="quick-fill-toggle" style={{borderColor:"rgba(79,255,176,.25)",background:"rgba(79,255,176,.025)",color:"var(--green)"}} onClick={()=>setShowCombos(v=>!v)}>
          🔀 Movement Combos — Pair patterns for a training day {showCombos?"▲":"▼"}
        </button>
        {showCombos && (
          <div className="quick-fill-panel fu">
            <p style={{fontSize:".78rem",color:"var(--muted)",marginBottom:"12px",lineHeight:1.5}}>
              Pick a combo and assign it to days. Each pattern adds one exercise to that day.
            </p>
            <div className="field">
              <label>Select a combo</label>
              <select value={comboChoice} onChange={e=>setComboChoice(e.target.value)}>
                {COMBOS.map(c=><option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            </div>
            <div style={{fontSize:".76rem",color:"var(--muted)",marginBottom:"8px",lineHeight:1.5}}>
              {COMBOS.find(c=>c.id===comboChoice)?.desc}
            </div>
            <div className="field">
              <label>Apply to days</label>
              <div className="fill-day-grid">
                {DAYS.map((day,i)=>(
                  <button key={day} className={`fill-day-btn${comboDays.includes(day)?" selected":""}`}
                    onClick={()=>setComboDays(prev=>prev.includes(day)?prev.filter(d=>d!==day):[...prev,day])}>
                    {DAY_SHORT[i]}
                  </button>
                ))}
              </div>
            </div>
            <button className="btn btn-p" style={{fontSize:".9rem",letterSpacing:"1px",minHeight:"44px",width:"100%"}}
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
            return s + calcStrengthBurn(ex.met, Number(data.weightLbs), sess.duration);
          }, 0);
          const isOpen = openDay === day;
          return (
            <div className="day-card" key={day}>
              <div className="day-card-header" onClick={()=>setOpenDay(isOpen?null:day)}>
                <div className="day-chip">{DAY_SHORT[i]}</div>
                <div className={`day-cardio-name${isRest?" rest":""}`}>
                  {isRest ? "😴 Rest Day" : sessions.length === 1
                    ? `${getEx(sessions[0].type).icon} ${getEx(sessions[0].type).label} · ${sessions[0].duration}m`
                    : `${sessions.length} sessions`
                  }
                </div>
                <div className={`day-burn${totalBurned===0?" zero":""}`}>{totalBurned>0?`~${totalBurned} cal`:""}</div>
                <div className={`day-chevron${isOpen?" open":""}`}>▼</div>
              </div>
              {isOpen && (
                <div className="day-card-body">
                  {sessions.map((sess, idx) => {
                    const ex = getEx(sess.type);
                    const burn = calcStrengthBurn(ex.met, Number(data.weightLbs), sess.duration);
                    return (
                      <div key={idx} style={{padding:"10px 0",borderBottom:idx<sessions.length-1?"1px solid var(--border)":"none"}}>
                        {sessions.length > 1 && (
                          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"8px"}}>
                            <span style={{fontSize:".72rem",color:"var(--muted)",fontWeight:700,letterSpacing:"1px",textTransform:"uppercase"}}>Session {idx+1}</span>
                            <button style={{background:"none",border:"none",color:"var(--red)",cursor:"pointer",fontSize:".78rem",fontFamily:"inherit",padding:"2px 6px"}} onClick={()=>removeSession(day,idx)}>✕ Remove</button>
                          </div>
                        )}
                        <div className="field">
                          <label>Exercise <span className="field-hint">type to search or browse below</span></label>
                          <SearchableSelect
                            exercises={STRENGTH_EXERCISES}
                            groups={STRENGTH_GROUPS}
                            value={sess.type}
                            onChange={val=>updSession(day,idx,"type",val)}
                            placeholder="Search exercises... (e.g. squat, curl, press)"
                          />
                          <select value={sess.type} onChange={e=>updSession(day,idx,"type",e.target.value)}>
                            {STRENGTH_GROUPS.map(cat=>(
                              <optgroup key={cat} label={cat}>
                                {STRENGTH_EXERCISES.filter(e=>e.cat===cat).map(e=>(
                                  <option key={e.id} value={e.id}>{e.icon} {e.label}</option>
                                ))}
                              </optgroup>
                            ))}
                          </select>
                        </div>
                        <div className="field">
                          <label>Duration</label>
                          <select value={sess.duration} onChange={e=>updSession(day,idx,"duration",Number(e.target.value))}>
                            {ST_DURATIONS.map(m=><option key={m} value={m}>{m} minutes</option>)}
                          </select>
                        </div>
                        {ex.note && <div style={{fontSize:".75rem",color:"var(--muted)",padding:"4px 0"}}>🎯 Muscles: {ex.note}</div>}
                        {burn > 0 && <div style={{fontSize:".78rem",color:"var(--orange)",fontWeight:600}}>~{burn} cal</div>}
                      </div>
                    );
                  })}
                  <button className="quick-fill-toggle" style={{marginTop:"10px",marginBottom:"6px",borderStyle:"solid",fontSize:".8rem",padding:"10px 14px"}}
                    onClick={()=>addSession(day)}>
                    + Add Another Session
                  </button>
                  {sessions.length > 0 && (
                    <button className="clear-day-btn" onClick={()=>{ setSessions(day,[]); setOpenDay(null); }}>
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
        <div className="warn-box">💡 All 7 days are set to rest — no worries! Your results will still work. Adding even 1–2 strength days will unlock muscle gain projections and EPOC afterburn data.</div>
      )}
      <div style={{fontSize:".6rem",color:"var(--muted)",textAlign:"center",margin:"8px 0",fontStyle:"italic"}}>⚠️ Calorie burn estimates use MET values — actual burn varies by intensity, form, and individual metabolism.</div>
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
    <div className="fu">
      <div className="card">
        <div className="card-title">Weekly Cardio Plan</div>
        <div className="card-sub">Tap a day to set your cardio. Calories estimated from your weight in real time.</div>

        {/* ── Quick Fill ── */}
        <button className="quick-fill-toggle" onClick={()=>setShowFill(v=>!v)}>
          ⚡ Quick Fill — Apply one exercise to multiple days {showFill?"▲":"▼"}
        </button>

        {showFill && (
          <div className="quick-fill-panel fu">
            <div className="field">
              <label>Exercise to apply</label>
              <select value={fillType} onChange={e=>setFillType(e.target.value)}>
                {CARDIO_GROUPS.filter(g=>g.group!=="😴 Rest").map(grp=>(
                  <optgroup key={grp.group} label={grp.group}>
                    {grp.options.map(c=><option key={c.id} value={c.id}>{c.icon} {c.label}</option>)}
                  </optgroup>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Duration</label>
              <select value={fillDuration} onChange={e=>setFillDuration(Number(e.target.value))}>
                {DURATIONS.map(m=><option key={m} value={m}>{m} minutes</option>)}
              </select>
            </div>
            <div className="field">
              <label>Apply to these days</label>
              <div className="fill-day-grid">
                {DAYS.map((day,i)=>{
                  const sel = fillDays.includes(day);
                  return (
                    <button
                      key={day}
                      className={`fill-day-btn${sel?" selected":""}`}
                      onClick={()=>toggleFillDay(day)}
                    >{DAY_SHORT[i]}</button>
                  );
                })}
              </div>
            </div>
            <div style={{display:"flex",gap:"8px",marginTop:"4px"}}>
              <button
                className="btn btn-p"
                style={{fontSize:".9rem",letterSpacing:"1px",minHeight:"44px",flex:1}}
                disabled={!fillDays.length}
                onClick={applyFill}
              >
                Apply to {fillDays.length||"0"} day{fillDays.length!==1?"s":""}
              </button>
              <button
                className="btn btn-g"
                style={{fontSize:".9rem",letterSpacing:"1px",minHeight:"44px",flex:"0 0 auto",padding:"0 14px"}}
                onClick={()=>{ setFillDays(DAYS.slice(0,5)); }}
              >MWF→Fri</button>
            </div>
            {/* Quick presets */}
            <div style={{display:"flex",gap:"6px",marginTop:"8px",flexWrap:"wrap"}}>
              <span style={{fontSize:".72rem",color:"var(--muted)",alignSelf:"center"}}>Presets:</span>
              {[
                {label:"MWF",  days:["Monday","Wednesday","Friday"]},
                {label:"M–F",  days:["Monday","Tuesday","Wednesday","Thursday","Friday"]},
                {label:"All 7",days:DAYS},
              ].map(p=>(
                <button key={p.label}
                  className="fill-preset-btn"
                  onClick={()=>setFillDays(p.days)}
                >{p.label}</button>
              ))}
            </div>
          </div>
        )}

        {/* ── Day cards ── */}
        {DAYS.map((day,i)=>{
          const sessions = Array.isArray(data.cardio[day]) ? data.cardio[day] : [];
          const isRest = sessions.length === 0;
          const totalBurned = sessions.reduce((s,sess)=>{
            const co = ALL_CARDIO.find(c=>c.id===sess.type)||ALL_CARDIO[ALL_CARDIO.length-1];
            return s + calcBurn(co.met, Number(data.weightLbs), sess.duration);
          }, 0);
          const isOpen = openDay===day;
          return (
            <div className="day-card" key={day}>
              <div className="day-card-header" onClick={()=>setOpenDay(isOpen?null:day)}>
                <div className="day-chip">{DAY_SHORT[i]}</div>
                <div className={`day-cardio-name${isRest?" rest":""}`}>
                  {isRest ? "😴 Rest Day" : sessions.length === 1
                    ? `${(ALL_CARDIO.find(c=>c.id===sessions[0].type)||{icon:"🏃"}).icon} ${(ALL_CARDIO.find(c=>c.id===sessions[0].type)||{label:"Cardio"}).label} · ${sessions[0].duration}m`
                    : `${sessions.length} sessions`
                  }
                </div>
                <div className={`day-burn${totalBurned===0?" zero":""}`}>{totalBurned>0?`~${totalBurned} cal`:""}</div>
                <div className={`day-chevron${isOpen?" open":""}`}>▼</div>
              </div>
              {isOpen && (
                <div className="day-card-body">
                  {sessions.map((sess, idx) => {
                    const co = ALL_CARDIO.find(c=>c.id===sess.type)||ALL_CARDIO[ALL_CARDIO.length-1];
                    const burn = calcBurn(co.met, Number(data.weightLbs), sess.duration);
                    return (
                      <div key={idx} style={{padding:"10px 0",borderBottom:idx<sessions.length-1?"1px solid var(--border)":"none"}}>
                        {sessions.length > 1 && (
                          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"8px"}}>
                            <span style={{fontSize:".72rem",color:"var(--muted)",fontWeight:700,letterSpacing:"1px",textTransform:"uppercase"}}>Session {idx+1}</span>
                            <button style={{background:"none",border:"none",color:"var(--red)",cursor:"pointer",fontSize:".78rem",fontFamily:"inherit",padding:"2px 6px"}} onClick={()=>removeWorkout(day,idx)}>✕ Remove</button>
                          </div>
                        )}
                        <div className="field">
                          <label>Exercise <span className="field-hint">type to search or browse below</span></label>
                          <SearchableSelect
                            exercises={ALL_CARDIO}
                            groups={CARDIO_GROUPS.map(g=>g.group)}
                            value={sess.type}
                            onChange={val=>updateWorkout(day,idx,"type",val)}
                            placeholder="Search cardio... (e.g. treadmill, bike, swim)"
                          />
                          <select value={sess.type} onChange={e=>updateWorkout(day,idx,"type",e.target.value)}>
                            {CARDIO_GROUPS.map(grp=>(
                              <optgroup key={grp.group} label={grp.group}>
                                {grp.options.map(c=><option key={c.id} value={c.id}>{c.icon} {c.label}</option>)}
                              </optgroup>
                            ))}
                          </select>
                        </div>
                        {sess.type!=="rest" && (
                          <div className="field">
                            <label>Duration</label>
                            <select value={sess.duration} onChange={e=>updateWorkout(day,idx,"duration",Number(e.target.value))}>
                              {DURATIONS.map(m=><option key={m} value={m}>{m} minutes</option>)}
                            </select>
                          </div>
                        )}
                        {burn > 0 && <div style={{fontSize:".78rem",color:"var(--orange)",fontWeight:600}}>~{burn} cal</div>}
                      </div>
                    );
                  })}
                  <button className="quick-fill-toggle" style={{marginTop:"10px",marginBottom:"6px",borderStyle:"solid",fontSize:".8rem",padding:"10px 14px"}}
                    onClick={()=>addWorkout(day)}>
                    + Add {sessions.length > 0 ? "Another" : "a"} Session
                  </button>
                  {sessions.length > 0 && (
                    <button className="clear-day-btn"
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
        <div className="warn-box">💡 All 7 days are set to rest — that's totally fine! Your results will still calculate based on diet alone. But if you'd like to add even one cardio session, it'll speed things up.</div>
      )}
      <div style={{fontSize:".6rem",color:"var(--muted)",textAlign:"center",margin:"8px 0",fontStyle:"italic"}}>⚠️ Cardio calorie estimates are approximations — actual burn depends on effort, body composition, and conditions.</div>
      <BottomNav onBack={onBack} onNext={onNext} nextLabel="Next — Strength →"/>
    </div>
  );
}

// ─── Results ─────────────────────────────────────────────────────────────────

function Results({ data, onReset, onEdit, onUpdateCardio, onUpdateStrength, onSaveCheckIn, onUpdateNotes }) {
  const [tab, setTab] = useState(0);
  const [viewMode, setViewMode] = useState("pro"); // "basic" or "pro"
  const [showEdit, setShowEdit] = useState(false);
  const [showNotes, setShowNotes] = useState(false);
  const [openResultDay, setOpenResultDay] = useState(null);
  const { gender, age, weightLbs, heightFt, heightIn, activityLevel, firstName, cardio } = data;
  const actObj = ACTIVITY_LEVELS.find(a=>a.id===activityLevel);
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
      const co = ALL_CARDIO.find(c=>c.id===s.type)||ALL_CARDIO[ALL_CARDIO.length-1];
      return { co, duration:s.duration, burned:calcBurn(co.met, Number(weightLbs), s.duration), type:s.type };
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
  const allStrEx = [REST_ST, ...STRENGTH_EXERCISES];
  const strengthDayData = DAYS.map(day=>{
    const sessions = Array.isArray((data.strength||{})[day]) ? data.strength[day] : [];
    const sessionData = sessions.map(s=>{
      const ex = allStrEx.find(e=>e.id===s.type) || REST_ST;
      return { ex, duration:s.duration, burned:calcStrengthBurn(ex.met, Number(weightLbs), s.duration), type:s.type };
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

      {/* ── Basic / Pro Toggle ── */}
      <div style={{display:"flex",gap:"4px",background:"var(--s2)",padding:"4px",borderRadius:"12px",border:"1px solid var(--border)",marginBottom:"16px"}}>
        <button style={{flex:1,padding:"10px",borderRadius:"9px",border:"none",cursor:"pointer",fontFamily:"inherit",fontSize:".82rem",fontWeight:600,transition:"all .2s",background:viewMode==="basic"?"var(--surface)":"transparent",color:viewMode==="basic"?"var(--text)":"var(--muted)",boxShadow:viewMode==="basic"?"0 2px 8px rgba(0,0,0,.3)":"none"}}
          onClick={()=>setViewMode("basic")}>
          📊 Basic Calculator
        </button>
        <button style={{flex:1,padding:"10px",borderRadius:"9px",border:"none",cursor:"pointer",fontFamily:"inherit",fontSize:".82rem",fontWeight:600,transition:"all .2s",background:viewMode==="pro"?"var(--surface)":"transparent",color:viewMode==="pro"?"var(--accent)":"var(--muted)",boxShadow:viewMode==="pro"?"0 2px 8px rgba(0,0,0,.3)":"none"}}
          onClick={()=>setViewMode("pro")}>
          ⚡ Pro Tracking
        </button>
      </div>

      {/* ── Pro Mode: Daily Check-In, Progress, AI ── */}
      {viewMode === "pro" && (
        <>
          <StreakBadges checkIns={data.checkIns || []} />
          <DailyCheckIn data={data} onSaveCheckIn={onSaveCheckIn} />
          {(data.checkIns || []).length >= 1 && (
            <ProgressChart checkIns={data.checkIns} goalWeight={data.goalWeight} currentWeight={data.weightLbs} />
          )}
          <AICoach data={data} tdee={tdee} totalBurn={totalBurn} totalStrBurn={totalStrBurn} activeDays={activeDays} activeStrDays={activeStrDays} />

          {/* ── Trainer Notes ── */}
          <div className="card" style={{padding:"16px",marginBottom:"16px"}}>
            <div style={{display:"flex",alignItems:"center",gap:"10px",marginBottom: showNotes?"12px":"0",cursor:"pointer"}} onClick={()=>setShowNotes(v=>!v)}>
              <span style={{fontSize:"1.2rem"}}>📝</span>
              <div style={{flex:1}}>
                <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:"1rem",letterSpacing:"2px",color:"var(--text-secondary)"}}>Trainer Notes</div>
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
            <span className="ibw-toggle-title">📏 Ideal Body Weight</span>
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
          <button key={i} className={`rtab${tab===i?" active":""}`} onClick={()=>setTab(i)}>{t}</button>
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
              const c = ALL_CARDIO.find(x=>x.id===sess.type)||ALL_CARDIO[ALL_CARDIO.length-1];
              return s + calcBurn(c.met, Number(weightLbs), sess.duration);
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
                        ? <span>{(ALL_CARDIO.find(c=>c.id===sessions[0].type)||{icon:"🏃"}).icon} {(ALL_CARDIO.find(c=>c.id===sessions[0].type)||{label:"Cardio"}).label.split("–")[0].trim()} · {sessions[0].duration}m</span>
                        : <span>{sessions.length} sessions</span>
                    }
                  </div>
                  {totalBurnDay>0 && <div className="drc-burn">+{totalBurnDay}</div>}
                  <div className={`drc-chevron${isOpen?" open":""}`}>▼</div>
                </div>
                {isOpen && (
                  <div className="drc-edit-body">
                    {sessions.map((sess, idx)=>{
                      const co = ALL_CARDIO.find(c=>c.id===sess.type)||ALL_CARDIO[ALL_CARDIO.length-1];
                      const burn = calcBurn(co.met, Number(weightLbs), sess.duration);
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
                <div className="drc-row">
                  {targets.map(t=>(
                    <div className="drc-cell" key={t.label}>
                      <div className="drc-cell-lbl">{t.goalLabel}</div>
                      <div className={`drc-cell-val ${t.cls}`}>{floor(tdee-t.cut).toLocaleString()}</div>
                    </div>
                  ))}
                </div>
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
                      const co = ALL_CARDIO.find(c=>c.id===sess.type)||ALL_CARDIO[ALL_CARDIO.length-1];
                      const burn = calcBurn(co.met, Number(weightLbs), sess.duration);
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
                  <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:"2.4rem",color:"var(--red)",lineHeight:1}}>{hrMax}</div>
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
                        <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:"1.15rem",color:z.color,letterSpacing:".5px"}}>{low}–{high} BPM</div>
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
                <div style={{fontSize:".76rem",color:"var(--muted)",lineHeight:1.5,marginTop:"8px",padding:"10px 12px",background:"rgba(232,255,79,.03)",borderRadius:"8px",borderLeft:"3px solid var(--accent)"}}>
                  💡 <strong style={{color:"var(--text)"}}>Fat Burn vs. Total Burn:</strong> Zone 2 burns the highest <em>percentage</em> of calories from fat (~60–70%). But higher zones burn more <em>total</em> calories per minute. For fat loss, Zone 2 for longer sessions (45–60 min) or Zone 4–5 intervals (HIIT) are both effective — pick what you'll stick with consistently.
                </div>
              </>
            );
          })()}

          {/* Disclaimer */}
          <div style={{marginTop:"16px",padding:"14px",background:"rgba(255,204,68,.04)",border:"1px solid rgba(255,204,68,.15)",borderRadius:"var(--radius-sm)",fontSize:".75rem",color:"var(--muted)",lineHeight:1.6}}>
            <strong style={{color:"var(--yellow)",display:"block",marginBottom:"4px"}}>⚠️ Important Disclaimer</strong>
            All calorie targets, heart rate zones, macro calculations, body weight projections, muscle gain estimates, and timelines shown in CalorieIQ are <strong style={{color:"var(--text)"}}>estimates based on established formulas and published research</strong> — they are not exact measurements. Individual results vary based on genetics, metabolism, sleep, stress, hydration, medication, and other factors. Heart rate zones are calculated from a formula and may differ from your actual physiological thresholds. These tools are intended for <strong style={{color:"var(--text)"}}>educational and coaching purposes only</strong> and should not replace advice from a physician, registered dietitian, or certified healthcare provider. Always consult a medical professional before starting any new diet or exercise program.
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
        <strong style={{color:"var(--yellow)"}}>⚠️ Disclaimer:</strong> All numbers in CalorieIQ are <strong style={{color:"var(--text)"}}>estimates</strong> based on published formulas (Mifflin-St Jeor, Tanaka, Ainsworth MET Compendium). Individual results vary. These tools are for educational and coaching purposes — not medical advice. Consult a healthcare provider before starting any diet or exercise program.
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
      <span style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:"1.05rem",letterSpacing:".5px",color:color||"var(--text)"}}>{value}</span>
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
              {combined > 0 && <span style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:".9rem",color:"var(--orange)",whiteSpace:"nowrap"}}>{combined} cal</span>}
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
  const allStrEx = [REST_ST, ...STRENGTH_EXERCISES];
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

  const rawColor = { "Horizontal Push":"#ff6b9d","Horizontal Pull":"#4fc3f7","Vertical Push":"#b57bff","Vertical Pull":"#4fffb0","Lower Push":"#ffcc44","Lower Pull":"#ff6b35","Carry":"#ff9444","Core":"#9090c0","Total Body":"#e8ff4f" };

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
                  const burn = calcStrengthBurn(ex.met, Number(weightLbs), sess.duration);
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
                  <span style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:"1rem",color:"var(--orange)",letterSpacing:".5px"}}>{burned} cal</span>
                  <span style={{color:"var(--muted)",fontSize:".72rem",marginLeft:"4px"}}>+ ~{Math.round(burned*0.15)} EPOC</span>
                </div>
              )}
            </div>
          </div>
        );
      })}

      {/* Combined total with cardio */}
      {totalCardio > 0 && activeStrDays > 0 && (
        <div className="csumm" style={{borderColor:"rgba(232,255,79,.2)",background:"rgba(232,255,79,.03)"}}>
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
        <div style={{padding:"14px 16px",background:"rgba(232,255,79,.04)",border:"1.5px solid rgba(232,255,79,.18)",borderRadius:"var(--radius-sm)",marginBottom:"14px",fontSize:".82rem",color:"var(--text-secondary)",lineHeight:1.7,animation:"fadeUp .15s ease both"}}
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
                <div className="mt-col" style={{color:"var(--accent)",fontFamily:"'Bebas Neue',sans-serif",fontSize:"1rem"}}>{(tdee + r.surplus + (showCardio&&hasCardio?avgBurnPerDay:0)).toLocaleString()}</div>
                <div className="mt-col" style={{color:"var(--green)",fontFamily:"'Bebas Neue',sans-serif",fontSize:".95rem"}}>{((gainLow+gainHigh)/2).toFixed(2)} lbs</div>
                <div className="mt-col" style={{color:mfColor,fontFamily:"'Bebas Neue',sans-serif",fontSize:".95rem"}}>{r.fatGainPerMonth.toFixed(2)} lbs</div>
                <div className="mt-col" style={{color:mfColor,fontFamily:"'Bebas Neue',sans-serif",fontSize:".95rem"}}>{mfRatio}:1</div>
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
          fontFamily:"'Bebas Neue',sans-serif",fontSize:"1.05rem",letterSpacing:"2px",
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
              CalorieIQ uses the <strong style={{color:"var(--text)"}}>Aragon/Helms model</strong> — the most respected evidence-based muscle gain rate model in sports science. We adjust it for:
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
              The muscle gain projections in CalorieIQ are <strong style={{color:"var(--text)"}}>population averages, not individual guarantees</strong>. Your actual results may be 30–50% higher or lower than projected depending on the factors listed above.
            </p>

            <p style={{marginBottom:"12px"}}>
              <strong style={{color:"var(--text)"}}>Use these numbers as a directional guide, not a promise.</strong> Track your actual progress through regular check-ins, body measurements, progress photos, and strength improvements. If your real results differ significantly from projections, adjust your training and nutrition plan accordingly.
            </p>

            <div style={{padding:"12px 14px",background:"rgba(255,204,68,.06)",borderRadius:"8px",border:"1px solid rgba(255,204,68,.2)",fontSize:".78rem",lineHeight:1.6}}>
              <strong style={{color:"var(--yellow)"}}>⚠️ Not Medical or Professional Advice:</strong> All muscle gain projections, macro recommendations, supplement information, and training suggestions in CalorieIQ are for <strong style={{color:"var(--text)"}}>educational and coaching purposes only</strong>. They are not a substitute for guidance from a certified personal trainer, registered dietitian, or physician. Always consult a qualified professional before making significant changes to your training or nutrition program.
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
                  <span style={{textAlign:"right",fontFamily:"'Bebas Neue',sans-serif",fontSize:".9rem",color:"var(--muted)",minWidth:"42px"}}>{f.cals}</span>
                  <span style={{textAlign:"right",fontFamily:"'Bebas Neue',sans-serif",fontSize:".9rem",color:"#ff6b9d",minWidth:"32px"}}>{f.p}g</span>
                  <span style={{textAlign:"right",fontFamily:"'Bebas Neue',sans-serif",fontSize:".9rem",color:cat.color,minWidth:"32px"}}>{cat.id==="protein"?f.f+"g":cat.id==="carbs"?f.c+"g":f.f+"g"}</span>
                </div>
              ))}
              <div style={{marginTop:"10px",fontSize:".75rem",color:"var(--muted)",lineHeight:1.5,padding:"8px 10px",background:"rgba(232,255,79,.04)",borderRadius:"8px",borderLeft:"3px solid "+cat.color}}>
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
                    <div style={{marginTop:"8px",padding:"9px 11px",background:"rgba(232,255,79,.06)",border:"1px solid rgba(232,255,79,.15)",borderRadius:"var(--radius-sm)",fontSize:".77rem",color:"var(--accent)",lineHeight:1.55}}>
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
            stroke={i===0?"rgba(232,255,79,.25)":"rgba(255,255,255,.07)"} strokeWidth="1"/>
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
      <rect x={PAD.left} y={PAD.top+goalY-2} width={chartW} height={3} fill="rgba(232,255,79,.55)" rx="1.5"/>
      <rect x={PAD.left} y={PAD.top+goalY} width={chartW} height={chartH-goalY} fill="rgba(232,255,79,.023)"/>
      <rect x={PAD.left+chartW+6} y={PAD.top+goalY-12} width={60} height={22} rx="6" fill="rgba(232,255,79,.2)"/>
      <text x={PAD.left+chartW+36} y={PAD.top+goalY+4} textAnchor="middle"
        fill="#e8ff4f" fontSize="11.5" fontWeight="700" fontFamily="DM Sans,sans-serif">{goal} lbs</text>

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
                  color: parseFloat(v) <= goal ? "#e8ff4f" : rc(paces[i]),
                  fontWeight: allAtGoal ? "700" : "600"
                }}>
                  {parseFloat(v) <= goal ? `${goal} ✓` : `${v} lbs`}
                </div>
              ))}
              {hasCardio && (
                <div className="cpt-col" style={{
                  color: parseFloat(cardioVal) <= goal ? "#e8ff4f" : "var(--orange)",
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
// The primary view after plan setup — transforms CalorieIQ from a calculator
// into a daily-use platform. This is what drives retention and daily engagement.

function DailyDashboard({ data, step, tdee, dayData, strengthDayData, avgBurnPerDay,
  onOpenPlan, onOpenResults, onEditWorkouts, onLogUpdate, dailyLog, streak,
  onUpdateCardio, onUpdateStrength }) {

  const [editingWorkout, setEditingWorkout] = useState(null);
  const [expandedStat, setExpandedStat] = useState(null);
  const [expandedSnap, setExpandedSnap] = useState(false);
  const [showMacros, setShowMacros] = useState(false);

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

  // Ring SVG
  const ringR = 58, ringC = 2 * Math.PI * ringR;
  const ringOffset = ringC - (pct / 100) * ringC;
  const ringColor = pct > 100 ? "var(--red)" : pct > 80 ? "var(--yellow)" : "var(--green)";

  const hasGoal = goalWeight && Number(goalWeight) < Number(weightLbs);
  const toLose = hasGoal ? Number(weightLbs) - Number(goalWeight) : null;
  const currentWeight = dailyLog.weight || Number(weightLbs);

  return (
    <div className="dash">
      <div className="dash-date">{today.toLocaleDateString("en-US",{weekday:"long",month:"long",day:"numeric"})}</div>
      <div className="dash-greeting">{firstName ? `Hey ${firstName}` : "Your Daily Plan"}</div>

      {/* Streak */}
      <div className="dash-streak">
        <div>
          <div className="dash-streak-num">🔥 {streak}</div>
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
            <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:"2.2rem",color:"var(--accent)",lineHeight:1}}>{remaining}</div>
            <div style={{fontSize:".65rem",color:"var(--muted)",letterSpacing:".5px"}}>CAL REMAINING</div>
          </div>
        </div>
      </div>

      {/* Quick stats — tappable */}
      <div className="dash-cta-grid">
        <div className="dash-cta" style={{cursor:"pointer",borderColor:expandedStat==="target"?"var(--accent)":"var(--border)"}} onClick={()=>setExpandedStat(expandedStat==="target"?null:"target")}>
          <div className="dash-cta-icon">🎯</div>
          <div className="dash-cta-val">{target.toLocaleString()}</div>
          <div className="dash-cta-lbl">Today's Target</div>
        </div>
        <div className="dash-cta" style={{cursor:"pointer",borderColor:expandedStat==="logged"?"var(--accent)":"var(--border)"}} onClick={()=>setExpandedStat(expandedStat==="logged"?null:"logged")}>
          <div className="dash-cta-icon">🍽️</div>
          <div className="dash-cta-val">{logged.toLocaleString()}</div>
          <div className="dash-cta-lbl">Logged So Far</div>
        </div>
        <div className="dash-cta" style={{cursor:"pointer",borderColor:expandedStat==="burn"?"var(--accent)":"var(--border)"}} onClick={()=>setExpandedStat(expandedStat==="burn"?null:"burn")}>
          <div className="dash-cta-icon">🔥</div>
          <div className="dash-cta-val">{todayTotalBurn}</div>
          <div className="dash-cta-lbl">Workout Burn</div>
        </div>
        <div className="dash-cta" style={{cursor:"pointer",borderColor:expandedStat==="water"?"var(--accent)":"var(--border)"}} onClick={()=>setExpandedStat(expandedStat==="water"?null:"water")}>
          <div className="dash-cta-icon">💧</div>
          <div className="dash-cta-val">{dailyLog.water || 0}</div>
          <div className="dash-cta-lbl">oz Water</div>
        </div>
      </div>

      {/* Expanded stat detail */}
      {expandedStat && (
        <div className="card" style={{padding:"14px 16px",marginBottom:"14px",borderColor:"rgba(232,255,79,.2)",animation:"fadeUp .15s ease both"}}>
          {expandedStat === "target" && (
            <>
              <div style={{fontWeight:700,fontSize:".88rem",marginBottom:"10px",color:"var(--accent)"}}>🎯 How Your Target Is Calculated</div>
              <div style={{display:"flex",justifyContent:"space-between",padding:"6px 0",borderBottom:"1px solid var(--border)",fontSize:".82rem"}}>
                <span style={{color:"var(--muted)"}}>Base TDEE</span>
                <span style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:"1rem"}}>{tdee.toLocaleString()} cal</span>
              </div>
              <div style={{display:"flex",justifyContent:"space-between",padding:"6px 0",borderBottom:"1px solid var(--border)",fontSize:".82rem"}}>
                <span style={{color:"var(--muted)"}}>Deficit (1 lb/wk)</span>
                <span style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:"1rem",color:"var(--red)"}}>−500 cal</span>
              </div>
              <div style={{display:"flex",justifyContent:"space-between",padding:"6px 0",borderBottom:"1px solid var(--border)",fontSize:".82rem"}}>
                <span style={{color:"var(--muted)"}}>Today's workout burn</span>
                <span style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:"1rem",color:"var(--green)"}}>+{todayTotalBurn} cal</span>
              </div>
              <div style={{display:"flex",justifyContent:"space-between",padding:"8px 0",fontSize:".88rem",fontWeight:700}}>
                <span>Today's Target</span>
                <span style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:"1.1rem",color:"var(--accent)"}}>{target.toLocaleString()} cal</span>
              </div>
              <div style={{fontSize:".72rem",color:"var(--muted)",marginTop:"6px"}}>💡 To change your target, tap "Edit Info" to adjust your weight, goal, or activity level, or "Edit Workouts" to change your exercise plan.</div>
            </>
          )}
          {expandedStat === "logged" && (
            <>
              <div style={{fontWeight:700,fontSize:".88rem",marginBottom:"10px",color:"var(--accent)"}}>🍽️ Calories Logged Today</div>
              <div style={{display:"flex",justifyContent:"space-between",padding:"6px 0",borderBottom:"1px solid var(--border)",fontSize:".82rem"}}>
                <span style={{color:"var(--muted)"}}>Logged</span>
                <span style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:"1rem"}}>{logged.toLocaleString()} cal</span>
              </div>
              <div style={{display:"flex",justifyContent:"space-between",padding:"6px 0",borderBottom:"1px solid var(--border)",fontSize:".82rem"}}>
                <span style={{color:"var(--muted)"}}>Target</span>
                <span style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:"1rem"}}>{target.toLocaleString()} cal</span>
              </div>
              <div style={{display:"flex",justifyContent:"space-between",padding:"8px 0",fontSize:".88rem",fontWeight:700,borderBottom:"1px solid var(--border)"}}>
                <span>Remaining</span>
                <span style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:"1.1rem",color:remaining>0?"var(--green)":"var(--red)"}}>{remaining} cal</span>
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
              <div style={{fontWeight:700,fontSize:".88rem",marginBottom:"6px",color:"var(--orange)"}}>🔥 Workout Burn Breakdown</div>
              <div style={{fontSize:".7rem",color:"var(--muted)",marginBottom:"8px"}}>Tap any exercise to edit or remove it</div>
              {(todayCardio.workouts||[]).map((w,i) => (
                <div key={`cb${i}`} style={{display:"flex",justifyContent:"space-between",padding:"8px 6px",borderBottom:"1px solid var(--border)",fontSize:".82rem",cursor:"pointer",borderRadius:"6px",background:editingWorkout===`c${i}`?"rgba(79,195,247,.06)":"transparent"}}
                  onClick={e=>{e.stopPropagation();setExpandedStat(null);setEditingWorkout(editingWorkout===`c${i}`?null:`c${i}`);}}>
                  <span><span style={{fontSize:".65rem",color:"#4fc3f7",fontWeight:700,marginRight:"6px"}}>CARDIO</span>{w.co?.icon} {w.co?.label}</span>
                  <span style={{display:"flex",alignItems:"center",gap:"8px"}}>
                    <span style={{fontFamily:"'Bebas Neue',sans-serif",color:"var(--orange)"}}>{w.burned} cal</span>
                    <span style={{fontSize:".6rem",color:"var(--muted)"}}>✏️</span>
                  </span>
                </div>
              ))}
              {(todayStrength.sessions||[]).map((s,i) => (
                <div key={`sb${i}`} style={{display:"flex",justifyContent:"space-between",padding:"8px 6px",borderBottom:"1px solid var(--border)",fontSize:".82rem",cursor:"pointer",borderRadius:"6px",background:editingWorkout===`s${i}`?"rgba(255,107,157,.06)":"transparent"}}
                  onClick={e=>{e.stopPropagation();setExpandedStat(null);setEditingWorkout(editingWorkout===`s${i}`?null:`s${i}`);}}>
                  <span><span style={{fontSize:".65rem",color:"#ff6b9d",fontWeight:700,marginRight:"6px"}}>STRENGTH</span>{s.ex?.icon} {s.ex?.label}</span>
                  <span style={{display:"flex",alignItems:"center",gap:"8px"}}>
                    <span style={{fontFamily:"'Bebas Neue',sans-serif",color:"var(--orange)"}}>{s.burned} cal</span>
                    <span style={{fontSize:".6rem",color:"var(--muted)"}}>✏️</span>
                  </span>
                </div>
              ))}
              {todayTotalBurn === 0 && <div style={{fontSize:".82rem",color:"var(--muted)",padding:"8px 0"}}>No workouts scheduled for today.</div>}
              <div style={{display:"flex",justifyContent:"space-between",padding:"8px 0",fontSize:".88rem",fontWeight:700,borderBottom:"1px solid var(--border)"}}>
                <span>Total</span>
                <span style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:"1.1rem",color:"var(--orange)"}}>{todayTotalBurn} cal</span>
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
              <div style={{fontWeight:700,fontSize:".88rem",marginBottom:"10px",color:"#4fc3f7"}}>💧 Hydration</div>
              <div style={{display:"flex",justifyContent:"space-between",padding:"6px 0",borderBottom:"1px solid var(--border)",fontSize:".82rem"}}>
                <span style={{color:"var(--muted)"}}>Logged</span>
                <span style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:"1rem"}}>{dailyLog.water || 0} oz</span>
              </div>
              <div style={{display:"flex",justifyContent:"space-between",padding:"6px 0",borderBottom:"1px solid var(--border)",fontSize:".82rem"}}>
                <span style={{color:"var(--muted)"}}>Daily target</span>
                <span style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:"1rem"}}>{Math.round(Number(weightLbs)*0.5)} oz</span>
              </div>
              <div style={{height:"8px",borderRadius:"4px",background:"var(--border)",overflow:"hidden",marginTop:"8px"}}>
                <div style={{height:"100%",borderRadius:"4px",background:"#4fc3f7",width:`${Math.min(100,((dailyLog.water||0)/(Number(weightLbs)*0.5))*100)}%`,transition:"width .3s"}}></div>
              </div>
              <div style={{fontSize:".72rem",color:"var(--muted)",marginTop:"4px",textAlign:"center"}}>{Math.round(((dailyLog.water||0)/(Number(weightLbs)*0.5))*100)}% of daily goal</div>
              <div style={{marginTop:"10px"}}>
                <div style={{fontSize:".72rem",color:"var(--muted)",fontWeight:600,textTransform:"uppercase",letterSpacing:".5px",marginBottom:"6px"}}>Quick Add</div>
                <div style={{display:"flex",gap:"8px",alignItems:"center",marginBottom:"8px"}}>
                  <input type="number" inputMode="numeric" placeholder="Set water oz" value={dailyLog.water||""} onClick={e=>e.stopPropagation()}
                    onChange={e=>{e.stopPropagation();onLogUpdate("water",parseInt(e.target.value)||0);}}
                    style={{flex:1,padding:"10px 12px",borderRadius:"8px",border:"1.5px solid #4fc3f7",background:"var(--s2)",color:"var(--text)",fontFamily:"inherit",fontSize:".88rem"}} />
                  <span style={{fontSize:".78rem",color:"var(--muted)"}}>oz</span>
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
        <span className="dash-log-icon">🍽️</span>
        <div className="dash-log-info">
          <div className="dash-log-title">Add Calories</div>
          <div className="dash-log-sub" style={{color:showMacros?"var(--accent)":"var(--muted)"}}>
            {showMacros ? "▲ Macros expanded — tap to collapse" : "▼ Tap here to add macros (Protein / Carbs / Fat)"}
          </div>
        </div>
        <input className="dash-log-input" type="number" inputMode="numeric" placeholder="0"
          onClick={e=>e.stopPropagation()}
          onBlur={e=>{ const v=parseInt(e.target.value); if(v>0){ onLogUpdate("calories",(dailyLog.calories||0)+v); e.target.value=""; }}}
          onKeyDown={e=>{ if(e.key==="Enter"){ e.target.blur(); }}}
        />
        <span className="dash-log-unit">cal</span>
      </div>

      {showMacros && (
        <div style={{animation:"fadeUp .15s ease both"}}>
          <div className="dash-log-row">
            <span className="dash-log-icon">🥩</span>
            <div className="dash-log-info">
              <div className="dash-log-title" style={{color:"#ff6b9d"}}>Protein</div>
              <div className="dash-log-sub">Target: ~{Math.round(Number(weightLbs)*1.0)}g*</div>
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
              <div className="dash-log-sub">Fills remaining after P & F*</div>
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
              <div className="dash-log-sub">~{Math.round(target*0.28/9)}g target*</div>
            </div>
            <input className="dash-log-input" type="number" inputMode="numeric" placeholder="0"
              onBlur={e=>{ const v=parseInt(e.target.value); if(v>0){ onLogUpdate("fat",(dailyLog.fat||0)+v); e.target.value=""; }}}
              onKeyDown={e=>{ if(e.key==="Enter"){ e.target.blur(); }}}
            />
            <span className="dash-log-unit">g</span>
          </div>
          <div style={{fontSize:".6rem",color:"var(--muted)",padding:"4px 8px",fontStyle:"italic"}}>*Macro targets are estimates based on bodyweight and calorie goals</div>
        </div>
      )}

      {/* Macro summary bar */}
      {(dailyLog.protein > 0 || dailyLog.carbs > 0 || dailyLog.fat > 0) && (
        <div style={{padding:"10px 14px",background:"var(--s2)",borderRadius:"8px",border:"1px solid var(--border)",marginBottom:"6px"}}>
          <div style={{display:"flex",gap:"14px",marginBottom:"6px",fontSize:".75rem"}}>
            <span style={{color:"#ff6b9d"}}>🥩 {dailyLog.protein||0}g / {Math.round(Number(weightLbs)*1.0)}g</span>
            <span style={{color:"#ffcc44"}}>🌾 {dailyLog.carbs||0}g</span>
            <span style={{color:"#4fc3f7"}}>🥑 {dailyLog.fat||0}g / {Math.round(target*0.28/9)}g</span>
          </div>
          <div style={{height:"8px",borderRadius:"4px",overflow:"hidden",display:"flex",background:"var(--border)"}}>
            {(()=>{
              const totalMacroCal = (dailyLog.protein||0)*4 + (dailyLog.carbs||0)*4 + (dailyLog.fat||0)*9;
              if(totalMacroCal===0) return null;
              const pPct = ((dailyLog.protein||0)*4/totalMacroCal)*100;
              const cPct = ((dailyLog.carbs||0)*4/totalMacroCal)*100;
              const fPct = ((dailyLog.fat||0)*9/totalMacroCal)*100;
              return <>
                <div style={{width:`${pPct}%`,background:"#ff6b9d",height:"100%"}}></div>
                <div style={{width:`${cPct}%`,background:"#ffcc44",height:"100%"}}></div>
                <div style={{width:`${fPct}%`,background:"#4fc3f7",height:"100%"}}></div>
              </>;
            })()}
          </div>
          <div style={{fontSize:".65rem",color:"var(--muted)",marginTop:"4px",textAlign:"center"}}>
            Macro calories: {((dailyLog.protein||0)*4 + (dailyLog.carbs||0)*4 + (dailyLog.fat||0)*9).toLocaleString()} cal from macros
          </div>
        </div>
      )}

      <div className="dash-log-row">
        <span className="dash-log-icon">💧</span>
        <div className="dash-log-info">
          <div className="dash-log-title">Water Intake</div>
          <div className="dash-log-sub">Target: ~{Math.round(Number(weightLbs)*0.5)} oz/day</div>
        </div>
        <input className="dash-log-input" type="number" inputMode="numeric"
          value={dailyLog.water||""} onChange={e=>onLogUpdate("water",parseInt(e.target.value)||0)}/>
        <span className="dash-log-unit">oz</span>
      </div>
      <div className="dash-log-row">
        <span className="dash-log-icon">⚖️</span>
        <div className="dash-log-info">
          <div className="dash-log-title">Today's Weight</div>
          <div className="dash-log-sub">{hasGoal?`Goal: ${goalWeight} lbs`:"Track your trend"}</div>
        </div>
        <input className="dash-log-input" type="number" inputMode="decimal" step="0.1"
          value={dailyLog.weight||""} onChange={e=>onLogUpdate("weight",parseFloat(e.target.value)||0)}/>
        <span className="dash-log-unit">lbs</span>
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
              <div style={{display:"flex",alignItems:"center",gap:"8px",padding:"12px 8px",marginBottom:"4px",borderRadius:"8px",border:editingWorkout===`c${i}`?"1.5px solid var(--accent)":"1.5px solid var(--border)",background:editingWorkout===`c${i}`?"rgba(232,255,79,.04)":"var(--s2)",cursor:"pointer",transition:"all .15s"}}
                onClick={()=>setEditingWorkout(editingWorkout===`c${i}`?null:`c${i}`)}>
                <span style={{fontSize:"1rem"}}>{w.co?.icon||"🏃"}</span>
                <div style={{flex:1}}>
                  <div style={{fontSize:".84rem",fontWeight:600}}>{w.co?.label||"Unknown Exercise"} <span style={{fontSize:".72rem",color:"var(--muted)"}}>· {(todayCardio.workouts[i]||{}).duration||30}m</span></div>
                  <div style={{fontSize:".65rem",color:"#4fc3f7",letterSpacing:".5px",textTransform:"uppercase",fontWeight:700}}>Cardio</div>
                </div>
                <span style={{color:"var(--orange)",fontFamily:"'Bebas Neue',sans-serif",fontSize:".95rem"}}>{w.burned} cal</span>
                <span style={{color:"var(--accent)",fontSize:".7rem",fontWeight:700}}>{editingWorkout===`c${i}`?"▲":"TAP"}</span>
              </div>
              {editingWorkout===`c${i}` && (
                <div style={{padding:"10px 0 12px",borderBottom:"1px solid var(--border)",animation:"fadeUp .15s ease both"}}>
                  <SearchableSelect
                    exercises={ALL_CARDIO}
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
                  </select>
                  <select value={(todayCardio.workouts[i]||{}).duration||30} onChange={e=>onUpdateCardio(dayName,i,"duration",Number(e.target.value))}
                    style={{width:"100%",padding:"10px",borderRadius:"8px",border:"1.5px solid var(--border)",background:"var(--s2)",color:"var(--text)",fontFamily:"inherit",fontSize:".84rem",marginTop:"6px"}}>
                    {DURATIONS.map(m=><option key={m} value={m}>{m} minutes</option>)}
                  </select>
                  <div style={{display:"flex",gap:"8px",marginTop:"8px"}}>
                    <button style={{flex:1,padding:"10px",borderRadius:"8px",border:"none",background:"var(--green)",color:"#0b0b12",fontFamily:"'Bebas Neue',sans-serif",fontSize:".95rem",letterSpacing:"2px",cursor:"pointer"}}
                      onClick={()=>setEditingWorkout(null)}>
                      ✓ Confirmed
                    </button>
                    <button style={{padding:"10px 16px",borderRadius:"8px",border:"1.5px solid var(--red)",background:"rgba(255,79,107,.06)",color:"var(--red)",fontFamily:"'Bebas Neue',sans-serif",fontSize:".95rem",letterSpacing:"1px",cursor:"pointer"}}
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
              <div style={{display:"flex",alignItems:"center",gap:"8px",padding:"12px 8px",marginBottom:"4px",borderRadius:"8px",border:editingWorkout===`s${i}`?"1.5px solid var(--accent)":"1.5px solid var(--border)",background:editingWorkout===`s${i}`?"rgba(232,255,79,.04)":"var(--s2)",cursor:"pointer",transition:"all .15s"}}
                onClick={()=>setEditingWorkout(editingWorkout===`s${i}`?null:`s${i}`)}>
                <span style={{fontSize:"1rem"}}>{s.ex?.icon||"🏋️"}</span>
                <div style={{flex:1}}>
                  <div style={{fontSize:".84rem",fontWeight:600}}>{s.ex?.label||"Unknown Exercise"} <span style={{fontSize:".72rem",color:"var(--muted)"}}>· {s.duration||60}m</span></div>
                  <div style={{fontSize:".65rem",color:"#ff6b9d",letterSpacing:".5px",textTransform:"uppercase",fontWeight:700}}>Strength · {s.ex?.cat||"Custom"}</div>
                </div>
                <span style={{color:"var(--orange)",fontFamily:"'Bebas Neue',sans-serif",fontSize:".95rem"}}>{s.burned} cal</span>
                <span style={{color:"var(--accent)",fontSize:".7rem",fontWeight:700}}>{editingWorkout===`s${i}`?"▲":"TAP"}</span>
              </div>
              {editingWorkout===`s${i}` && (
                <div style={{padding:"10px 0 12px",borderBottom:"1px solid var(--border)",animation:"fadeUp .15s ease both"}}>
                  <SearchableSelect
                    exercises={STRENGTH_EXERCISES}
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
                  </select>
                  <select value={s.duration||60} onChange={e=>onUpdateStrength(dayName,i,"duration",Number(e.target.value))}
                    style={{width:"100%",padding:"10px",borderRadius:"8px",border:"1.5px solid var(--border)",background:"var(--s2)",color:"var(--text)",fontFamily:"inherit",fontSize:".84rem",marginTop:"6px"}}>
                    {ST_DURATIONS.map(m=><option key={m} value={m}>{m} minutes</option>)}
                  </select>
                  <div style={{display:"flex",gap:"8px",marginTop:"8px"}}>
                    <button style={{flex:1,padding:"10px",borderRadius:"8px",border:"none",background:"var(--green)",color:"#0b0b12",fontFamily:"'Bebas Neue',sans-serif",fontSize:".95rem",letterSpacing:"2px",cursor:"pointer"}}
                      onClick={()=>setEditingWorkout(null)}>
                      ✓ Confirmed
                    </button>
                    <button style={{padding:"10px 16px",borderRadius:"8px",border:"1.5px solid var(--red)",background:"rgba(255,79,107,.06)",color:"var(--red)",fontFamily:"'Bebas Neue',sans-serif",fontSize:".95rem",letterSpacing:"1px",cursor:"pointer"}}
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
        <div className="dash-today-workout" style={{textAlign:"center",padding:"16px",color:"var(--muted)",fontSize:".84rem"}}>
          😴 Rest day — no workouts scheduled
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
            <div className="share-stat-val">🔥 {streak}</div>
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
                <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:"1.3rem",color:"var(--accent)"}}>{tdee.toLocaleString()}</div>
                <div style={{fontSize:".62rem",color:"var(--muted)",textTransform:"uppercase",letterSpacing:".5px"}}>TDEE</div>
                <div style={{fontSize:".55rem",color:"var(--muted)",marginTop:"2px"}}>Calories to maintain weight*</div>
              </div>
              <div style={{padding:"10px",background:"var(--s2)",borderRadius:"8px",textAlign:"center"}}>
                <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:"1.3rem",color:"var(--yellow)"}}>{target.toLocaleString()}</div>
                <div style={{fontSize:".62rem",color:"var(--muted)",textTransform:"uppercase",letterSpacing:".5px"}}>Target Cal</div>
                <div style={{fontSize:".55rem",color:"var(--muted)",marginTop:"2px"}}>Eat this to lose weight*</div>
              </div>
              <div style={{padding:"10px",background:"var(--s2)",borderRadius:"8px",textAlign:"center"}}>
                <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:"1.3rem",color:"var(--orange)"}}>{(todayCardio.burned+todayStrength.burned).toLocaleString()}</div>
                <div style={{fontSize:".62rem",color:"var(--muted)",textTransform:"uppercase",letterSpacing:".5px"}}>Today's Burn</div>
                <div style={{fontSize:".55rem",color:"var(--muted)",marginTop:"2px"}}>Est. calories from workouts*</div>
              </div>
              <div style={{padding:"10px",background:"var(--s2)",borderRadius:"8px",textAlign:"center"}}>
                <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:"1.3rem",color:"#4fc3f7"}}>{Math.round(Number(weightLbs)*0.5)} oz</div>
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
                    <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:"1.2rem",color:diff>0?"var(--green)":"var(--orange)"}}>{diff>0?`−${diff.toFixed(1)}`:diff<0?`+${Math.abs(diff).toFixed(1)}`:"0"}</div>
                    <div style={{fontSize:".62rem",color:"var(--muted)",textTransform:"uppercase",letterSpacing:".5px"}}>lbs Change</div>
                  </div>
                  <div style={{padding:"10px",background:"var(--s2)",borderRadius:"8px",textAlign:"center"}}>
                    <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:"1.2rem",color:adherence>=80?"var(--green)":adherence>=50?"var(--yellow)":"var(--red)"}}>{adherence}%</div>
                    <div style={{fontSize:".62rem",color:"var(--muted)",textTransform:"uppercase",letterSpacing:".5px"}}>Adherence</div>
                  </div>
                  <div style={{padding:"10px",background:"var(--s2)",borderRadius:"8px",textAlign:"center"}}>
                    <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:"1.2rem",color:"var(--text)"}}>{data.checkIns.length}</div>
                    <div style={{fontSize:".62rem",color:"var(--muted)",textTransform:"uppercase",letterSpacing:".5px"}}>Check-ins</div>
                  </div>
                </div>
              );
            })()}
            <div style={{fontSize:".72rem",color:"var(--muted)",textAlign:"center"}}>📸 Screenshot this card to share your progress</div>
          </div>
        )}

        <div className="share-brand">CALORIEIQ — Powered by Science</div>
      </div>

      {/* Navigation */}
      <div className="dash-nav">
        <button className="dash-nav-btn" onClick={onOpenResults}>📊 Full Plan</button>
        <button className="dash-nav-btn" onClick={onOpenPlan}>📝 Edit Info</button>
        <button className="dash-nav-btn" onClick={onEditWorkouts}>🏋️ Edit Workouts</button>
      </div>
      <div style={{fontSize:".58rem",color:"var(--muted)",textAlign:"center",marginTop:"10px",fontStyle:"italic",lineHeight:1.5}}>⚠️ All values are estimates for educational purposes. Not medical advice. Consult a healthcare provider before making changes to diet or exercise.</div>
    </div>
  );
}

// ─── Daily Check-In ───────────────────────────────────────────────────────────

function DailyCheckIn({ data, onSaveCheckIn }) {
  const [checkDate, setCheckDate] = useState(new Date().toISOString().slice(0, 10));
  const [weight, setWeight] = useState(data.weightLbs || "");
  const [calories, setCalories] = useState("");
  const [hitTarget, setHitTarget] = useState(null);
  const [workedOut, setWorkedOut] = useState(null);
  const [mood, setMood] = useState(null);
  const [notes, setNotes] = useState("");
  const [bodyFatLog, setBodyFatLog] = useState("");
  const [saved, setSaved] = useState(false);

  const today = new Date().toISOString().slice(0, 10);
  const isFuture = checkDate > today;
  const isPast = checkDate < today;
  const canSave = weight && hitTarget !== null && checkDate;

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

      {/* Date picker */}
      <div className="checkin-field" style={{marginBottom:"12px"}}>
        <label>Date {isPast && "📌 past entry"} {isFuture && "📌 future plan"}</label>
        <input type="date" value={checkDate} onChange={e => setCheckDate(e.target.value)}
          style={{width:"100%",padding:"10px 12px",borderRadius:"8px",border:`1.5px solid ${isFuture?"var(--purple)":isPast?"var(--yellow)":"var(--border)"}`,background:"var(--s2)",color:"var(--text)",fontFamily:"inherit",fontSize:".88rem",outline:"none"}} />
      </div>
      {existingForDate && (
        <div style={{fontSize:".78rem",color:"var(--yellow)",marginBottom:"10px",padding:"8px 10px",background:"rgba(255,204,68,.06)",borderRadius:"8px",border:"1px solid rgba(255,204,68,.15)"}}>
          ⚠️ A check-in already exists for {checkDate} ({existingForDate.weight} lbs). Saving will add another entry for this date.
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
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const dates = new Set(sorted.map(c => c.date));

  if (dates.has(today) || dates.has(yesterday)) {
    let checkDate = dates.has(today) ? new Date() : new Date(Date.now() - 86400000);
    while (dates.has(checkDate.toISOString().slice(0, 10))) {
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
            <div style={{fontSize:".85rem",fontWeight:700,color:"var(--text)"}}>{totalCheckIns} check-ins</div>
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
    const text = `🏋️ ${fullName(data) || "My"} CalorieIQ Plan\n\n` +
      `📊 Maintenance: ${tdee.toLocaleString()} cal/day\n` +
      `🎯 Target (1lb/wk): ${targetCals.toLocaleString()} cal/day\n` +
      `🔥 Weekly burn: ${(totalBurn + totalStrBurn).toLocaleString()} cal\n` +
      (hasGoal ? `⚖️ Goal: ${weightLbs} → ${goalWeight} lbs\n` : "") +
      `\nBuilt with CalorieIQ`;
    try {
      if (navigator.share) {
        await navigator.share({ title: `${fullName(data) || "My"} CalorieIQ Plan`, text });
      } else {
        await navigator.clipboard.writeText(text);
      }
    } catch (e) {}
  };

  return (
    <div className="share-card">
      <div className="share-card-brand">CALORIEIQ</div>
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

function ProgressChart({ checkIns, goalWeight, currentWeight }) {
  const sorted = [...(checkIns || [])].filter(c => c.weight).sort((a, b) => a.timestamp - b.timestamp);
  if (sorted.length < 2) return (
    <div className="card" style={{padding:"16px",textAlign:"center",color:"var(--muted)",fontSize:".84rem",lineHeight:1.6}}>
      📈 Progress chart appears after 2+ check-ins with weight logged. Keep checking in daily!
    </div>
  );

  const W = 500, H = 220;
  const PAD = { top: 20, right: 50, bottom: 40, left: 60 };
  const chartW = W - PAD.left - PAD.right;
  const chartH = H - PAD.top - PAD.bottom;

  const weights = sorted.map(c => c.weight);
  const goal = Number(goalWeight) || null;
  const allVals = [...weights, ...(goal ? [goal] : [])];
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
    <div className="card" style={{padding:"16px",marginBottom:"16px"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"12px"}}>
        <div>
          <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:"1.1rem",letterSpacing:"2px",color:"var(--accent)"}}>📈 Progress</div>
          <div style={{fontSize:".74rem",color:"var(--muted)"}}>{sorted.length} weigh-ins · {checkIns.length} check-ins</div>
        </div>
        <div style={{textAlign:"right"}}>
          <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:"1.3rem",color:trendColor}}>
            {diff > 0 ? `−${diff.toFixed(1)}` : diff < 0 ? `+${Math.abs(diff).toFixed(1)}` : "0"} lbs
          </div>
          <div style={{fontSize:".68rem",color:trendColor,textTransform:"uppercase",letterSpacing:"1px"}}>{trend}</div>
        </div>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} style={{width:"100%",height:"auto",display:"block"}}>
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

        {/* Goal line */}
        {goal && (
          <>
            <line x1={PAD.left} y1={PAD.top + yScale(goal)} x2={PAD.left + chartW} y2={PAD.top + yScale(goal)}
              stroke="rgba(232,255,79,.4)" strokeWidth="1.5" strokeDasharray="6 4" />
            <text x={PAD.left + chartW + 6} y={PAD.top + yScale(goal) + 4} fill="#e8ff4f" fontSize="10" fontFamily="DM Sans,sans-serif">{goal}</text>
          </>
        )}

        {/* Weight line */}
        <path d={linePts} fill="none" stroke="#4fffb0" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />

        {/* Dots */}
        {sorted.map((c, i) => (
          <circle key={i} cx={PAD.left + xScale(i)} cy={PAD.top + yScale(c.weight)} r="4" fill="#4fffb0" stroke="#0d0d18" strokeWidth="2" />
        ))}

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
      </svg>

      <div style={{display:"flex",gap:"16px",marginTop:"10px",justifyContent:"center",flexWrap:"wrap"}}>
        <div style={{textAlign:"center"}}>
          <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:"1.2rem",color:"var(--text)"}}>{startW} → {endW}</div>
          <div style={{fontSize:".65rem",color:"var(--muted)",textTransform:"uppercase",letterSpacing:".5px"}}>Weight Trend</div>
        </div>
        <div style={{textAlign:"center"}}>
          <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:"1.2rem",color: adherence >= 80 ? "var(--green)" : adherence >= 50 ? "var(--yellow)" : "var(--red)"}}>{adherence}%</div>
          <div style={{fontSize:".65rem",color:"var(--muted)",textTransform:"uppercase",letterSpacing:".5px"}}>Adherence</div>
        </div>
        {goal && (
          <div style={{textAlign:"center"}}>
            <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:"1.2rem",color:"var(--accent)"}}>{Math.max(0, (endW - goal)).toFixed(1)}</div>
            <div style={{fontSize:".65rem",color:"var(--muted)",textTransform:"uppercase",letterSpacing:".5px"}}>lbs to goal</div>
          </div>
        )}
      </div>
    </div>
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

      const prompt = `You are an expert fitness coach analyzing a client's data. Be specific, actionable, and encouraging. Use their actual numbers. Keep it under 250 words total.

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
- Total check-ins: ${checkIns.length}

Respond in this exact JSON format (no markdown, no backticks):
{"summary":"One sentence overview of where they are","wins":["specific win 1","specific win 2"],"focus":["specific action item 1","specific action item 2","specific action item 3"],"motivation":"A personalized, specific encouragement message based on their actual data"}`;

      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1000,
          messages: [{ role: "user", content: prompt }],
        }),
      });
      const result = await response.json();
      const text = result.content?.find(c => c.type === "text")?.text || "";
      const clean = text.replace(/```json|```/g, "").trim();
      const parsed = JSON.parse(clean);
      setInsights(parsed);
    } catch (e) {
      setError("Couldn't generate insights right now. Try again in a moment.");
    }
    setLoading(false);
  };

  return (
    <div className="card" style={{padding:"16px",marginBottom:"16px",borderColor: insights ? "rgba(181,123,255,.25)" : "var(--border)",background: insights ? "rgba(181,123,255,.03)" : "var(--surface)"}}>
      <div style={{display:"flex",alignItems:"center",gap:"10px",marginBottom: insights ? "14px" : "0"}}>
        <span style={{fontSize:"1.4rem"}}>🤖</span>
        <div style={{flex:1}}>
          <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:"1.1rem",letterSpacing:"2px",color:"#b57bff"}}>AI Coaching Insights</div>
          <div style={{fontSize:".73rem",color:"var(--muted)"}}>Powered by Claude — analyzes {data.firstName || "your client"}'s complete profile</div>
        </div>
        {!insights && (
          <button className="save-bar-btn" style={{flex:"0 0 auto",minHeight:"38px",padding:"0 16px",fontSize:".78rem",borderColor:"#b57bff",color:"#b57bff",background:"rgba(181,123,255,.06)"}}
            disabled={loading} onClick={generateInsights}>
            {loading ? "Analyzing..." : "✨ Generate"}
          </button>
        )}
      </div>

      {error && <div style={{fontSize:".82rem",color:"var(--red)",padding:"8px 0"}}>{error}</div>}

      {insights && (
        <div style={{animation:"fadeUp .3s ease both"}}>
          <div style={{fontSize:".88rem",color:"var(--text)",fontWeight:600,marginBottom:"10px",lineHeight:1.5}}>{insights.summary}</div>

          {insights.wins?.length > 0 && (
            <div style={{marginBottom:"12px"}}>
              <div style={{fontSize:".68rem",textTransform:"uppercase",letterSpacing:"1px",color:"var(--green)",fontWeight:700,marginBottom:"6px"}}>Wins</div>
              {insights.wins.map((w, i) => (
                <div key={i} style={{fontSize:".82rem",color:"var(--muted)",lineHeight:1.5,padding:"4px 0",paddingLeft:"16px",borderLeft:"2px solid var(--green)"}}>✅ {w}</div>
              ))}
            </div>
          )}

          {insights.focus?.length > 0 && (
            <div style={{marginBottom:"12px"}}>
              <div style={{fontSize:".68rem",textTransform:"uppercase",letterSpacing:"1px",color:"var(--accent)",fontWeight:700,marginBottom:"6px"}}>Focus Areas</div>
              {insights.focus.map((f, i) => (
                <div key={i} style={{fontSize:".82rem",color:"var(--muted)",lineHeight:1.5,padding:"4px 0",paddingLeft:"16px",borderLeft:"2px solid var(--accent)"}}>🎯 {f}</div>
              ))}
            </div>
          )}

          {insights.motivation && (
            <div style={{padding:"12px 14px",borderRadius:"8px",background:"rgba(181,123,255,.06)",border:"1px solid rgba(181,123,255,.15)",fontSize:".84rem",color:"var(--text)",lineHeight:1.6,fontStyle:"italic"}}>
              💬 {insights.motivation}
            </div>
          )}

          <button style={{background:"none",border:"none",color:"var(--muted)",cursor:"pointer",fontFamily:"inherit",fontSize:".73rem",textDecoration:"underline",padding:"8px 0",marginTop:"6px"}}
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

function RolePanel() {
  const [profile, setProfile] = useState(undefined); // undefined = loading
  const [code, setCode] = useState("");
  const [clients, setClients] = useState([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [copied, setCopied] = useState(false);
  const [inviteCode, setInviteCode] = useState("");
  const [trainerName, setTrainerName] = useState("");
  const [firstInput, setFirstInput] = useState("");
  const [lastInput, setLastInput] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [localProfiles, setLocalProfiles] = useState([]); // trainer's own profiles
  const [clientPlans, setClientPlans] = useState({}); // clientUid -> { name, weight } if they have a linked plan
  const [linkingFor, setLinkingFor] = useState(null); // clientUid we're choosing a profile for
  const [linkBusy, setLinkBusy] = useState(false);
  const [pendingLink, setPendingLink] = useState(null); // { clientUid, localId, label } awaiting confirm
  const [confirmUnlink, setConfirmUnlink] = useState(null); // clientUid awaiting unlink confirm

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
      let cs = [];
      try { cs = await getMyClients(); setClients(cs); } catch { /* ignore */ }
      try { setInviteCode(await ensureInviteCode()); } catch { /* ignore */ }
      // The trainer's own saved profiles, to offer when linking a plan.
      try {
        const r = await window.storage.get(STORAGE_INDEX);
        if (r && r.value) setLocalProfiles(JSON.parse(r.value));
      } catch { /* ignore */ }
      // For each linked client account, see if they already have a linked plan
      // (stored in THEIR account as caliq-self) — proves the connection exists.
      try {
        const plans = {};
        await Promise.all((cs || []).map(async (c) => {
          try {
            const r = await getForUser(c.uid, "caliq-self");
            if (r && r.value) {
              const d = (JSON.parse(r.value) || {}).data || {};
              plans[c.uid] = { name: `${d.firstName || ""} ${d.lastName || ""}`.trim(), weight: d.weightLbs || "" };
            }
          } catch { /* not linked / no access */ }
        }));
        setClientPlans(plans);
      } catch { /* ignore */ }
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

  // Copy one of the trainer's own profiles into a linked client's account, so it
  // becomes the shared, both-can-edit plan that lives in the client's account.
  const linkPlan = async (clientUid, localId) => {
    setLinkBusy(true); setMsg("");
    try {
      let payload = JSON.stringify({ data: {}, step: 0 });
      try {
        const r = await window.storage.get(profileKey(localId));
        if (r && r.value) payload = r.value;
      } catch { /* fall back to a blank plan */ }
      await setForUser(clientUid, "caliq-self", payload);
      setMsg("Plan linked to the client's account.");
      setLinkingFor(null);
      setPendingLink(null);
      await load();
    } catch (e) {
      setMsg((e && e.message) || "Couldn't link that plan — is the client still linked to you?");
    } finally { setLinkBusy(false); }
  };

  // Remove a linked client's shared plan from their account.
  const unlinkPlan = async (clientUid) => {
    setLinkBusy(true); setMsg("");
    try {
      await deleteForUser(clientUid, "caliq-self");
      setMsg("Plan unlinked from the client's account.");
      setConfirmUnlink(null);
      await load();
    } catch (e) {
      setMsg((e && e.message) || "Couldn't unlink that plan.");
    } finally { setLinkBusy(false); }
  };

  const field = { padding:"10px 12px", fontSize:".9rem", borderRadius:"8px",
    border:"1px solid rgba(255,255,255,.15)", background:"rgba(255,255,255,.05)",
    color:"var(--text)", flex:1, minWidth:0 };
  const btn = { padding:"10px 14px", fontSize:".85rem", fontWeight:700, borderRadius:"8px",
    border:"none", background:"var(--accent)", color:"#111", cursor:"pointer" };
  const btnGhost = { padding:"7px 10px", fontSize:".78rem", fontWeight:600, borderRadius:"8px",
    border:"1px solid rgba(255,255,255,.2)", background:"transparent", color:"var(--text)",
    cursor:"pointer", textAlign:"left" };

  return (
    <div className="card">
      <div className="card-title">
        {isTrainer ? "🧑‍🏫 Trainer" : "🙋 Client"}
        <span style={{ fontWeight:400, color:"var(--muted)", fontSize:".8rem", marginLeft:8 }}>
          {profile.email}
        </span>
      </div>

      {/* Name editor shows only until a name is set — keeps the home clean.
          (Editing an existing name will move into the profile side menu later.) */}
      {!profile.displayName && (
        <>
          <div className="card-sub" style={{ marginBottom:6 }}>
            Your name{isTrainer ? "" : " (optional)"}
          </div>
          <div style={{ display:"flex", gap:"8px", alignItems:"center", margin:"0 0 16px" }}>
            <input
              style={field} value={firstInput} placeholder="First name"
              onChange={(e) => setFirstInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && saveName()}
            />
            <input
              style={field} value={lastInput} placeholder="Last name"
              onChange={(e) => setLastInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && saveName()}
            />
            <button style={btn} onClick={saveName} disabled={savingName}>
              {savingName ? "…" : "Save"}
            </button>
          </div>
        </>
      )}

      {isTrainer ? (
        <>
          <div className="card-sub">
            Share your invite code with clients so they can link to you.
          </div>
          <div style={{ display:"flex", gap:"8px", alignItems:"center", margin:"4px 0 14px" }}>
            <code style={{ ...field, fontFamily:"monospace", display:"inline-block",
              letterSpacing:"1px", fontSize:"1rem" }}>
              {inviteCode ? formatInviteCode(inviteCode) : "…"}
            </code>
            <button style={btn} onClick={copyCode} disabled={!inviteCode}>
              {copied ? "Copied!" : "Copy code"}
            </button>
          </div>
          <div className="card-sub" style={{ marginBottom:6 }}>
            Or send a one-click invite link — new clients who open it are linked to
            you automatically.
          </div>
          <div style={{ display:"flex", gap:"8px", alignItems:"center", margin:"4px 0 14px" }}>
            <code style={{ ...field, fontFamily:"monospace", display:"inline-block",
              fontSize:".78rem", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>
              {shareLink || "…"}
            </code>
            <button style={btn} onClick={copyLink} disabled={!shareLink}>
              Copy link
            </button>
          </div>
          <div className="card-sub" style={{ marginBottom:6 }}>
            Your clients ({clients.length})
          </div>
          {clients.length === 0 ? (
            <div style={{ color:"var(--muted)", fontSize:".85rem" }}>
              No clients linked yet.
            </div>
          ) : (
            <div style={{ display:"flex", flexDirection:"column", gap:"6px" }}>
              {clients.map((c) => {
                const plan = clientPlans[c.uid];
                const cname = c.displayName || c.email || "this client";
                return (
                  <div key={c.uid} style={{ padding:"8px 10px", borderRadius:"8px",
                    background:"rgba(255,255,255,.04)" }}>
                    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                      <span>{c.displayName || c.email || c.uid}</span>
                      <span style={{ color: plan ? "#39d98a" : "var(--muted)", fontSize:".74rem", fontWeight:600 }}>
                        {plan ? "✓ Plan linked" : "No plan yet"}
                      </span>
                    </div>

                    {confirmUnlink === c.uid ? (
                      <div style={{ marginTop:8 }}>
                        <div style={{ fontSize:".78rem", color:"var(--text)", marginBottom:8 }}>
                          Unlink <strong>{cname}</strong>'s plan? This removes it from their account
                          and they'll lose access to it.
                        </div>
                        <div style={{ display:"flex", gap:"8px" }}>
                          <button style={{ ...btn, background:"#e5484d", color:"#fff" }} disabled={linkBusy}
                            onClick={() => unlinkPlan(c.uid)}>{linkBusy ? "…" : "Yes, unlink"}</button>
                          <button style={btnGhost} disabled={linkBusy}
                            onClick={() => setConfirmUnlink(null)}>Cancel</button>
                        </div>
                      </div>
                    ) : pendingLink && pendingLink.clientUid === c.uid ? (
                      <div style={{ marginTop:8 }}>
                        <div style={{ fontSize:".78rem", color:"var(--text)", marginBottom:8 }}>
                          Link <strong>{pendingLink.label}</strong> to <strong>{cname}</strong>?
                          {plan ? " This replaces their current linked plan." : ""}
                        </div>
                        <div style={{ display:"flex", gap:"8px" }}>
                          <button style={btn} disabled={linkBusy}
                            onClick={() => linkPlan(c.uid, pendingLink.localId)}>{linkBusy ? "…" : "Confirm"}</button>
                          <button style={btnGhost} disabled={linkBusy}
                            onClick={() => setPendingLink(null)}>Cancel</button>
                        </div>
                      </div>
                    ) : linkingFor === c.uid ? (
                      <div style={{ marginTop:8 }}>
                        <div style={{ fontSize:".74rem", color:"var(--muted)", marginBottom:4 }}>
                          Pick one of your profiles to link to this client:
                        </div>
                        <div style={{ display:"flex", flexDirection:"column", gap:"4px",
                          maxHeight:170, overflow:"auto" }}>
                          {localProfiles.length === 0 ? (
                            <div style={{ fontSize:".78rem", color:"var(--muted)" }}>
                              No saved profiles yet — create one under “All clients” first.
                            </div>
                          ) : localProfiles.map((lp) => (
                            <button key={lp.id} style={btnGhost} disabled={linkBusy}
                              onClick={() => { setPendingLink({ clientUid:c.uid, localId:lp.id, label: lp.name || "Unnamed profile" }); setLinkingFor(null); }}>
                              {lp.name || "Unnamed profile"}{lp.weight ? ` · ${lp.weight} lbs` : ""}
                            </button>
                          ))}
                        </div>
                        <button style={{ ...btnGhost, marginTop:6 }} disabled={linkBusy}
                          onClick={() => setLinkingFor(null)}>Cancel</button>
                      </div>
                    ) : (
                      <div style={{ display:"flex", gap:"8px", marginTop:6, flexWrap:"wrap" }}>
                        <button style={btnGhost} onClick={() => setLinkingFor(c.uid)}>
                          {plan ? "Re-link a different profile" : "Link a profile"}
                        </button>
                        {plan && (
                          <button style={{ ...btnGhost, color:"#e5484d", borderColor:"rgba(229,72,77,.4)" }}
                            onClick={() => setConfirmUnlink(c.uid)}>Unlink</button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      ) : (
        <>
          {profile.assignedTrainerId ? (
            <>
              <div className="card-sub">
                You're linked to trainer:{" "}
                <strong style={{ color:"var(--text)" }}>
                  {trainerName || profile.assignedTrainerId}
                </strong>
              </div>
              {confirmLeave ? (
                <div style={{ marginTop:10 }}>
                  <div style={{ fontSize:".85rem", color:"var(--text)", marginBottom:8 }}>
                    Leave this trainer? You can re-join later with their code.
                  </div>
                  <div style={{ display:"flex", gap:"8px" }}>
                    <button
                      style={{ ...btn, background:"#e5484d", color:"#fff" }}
                      onClick={leave} disabled={busy}
                    >
                      {busy ? "…" : "Yes, leave"}
                    </button>
                    <button
                      style={{ ...btn, background:"transparent", color:"var(--muted)",
                        border:"1px solid rgba(255,255,255,.2)" }}
                      onClick={() => setConfirmLeave(false)} disabled={busy}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  style={{ ...btn, background:"transparent", color:"var(--muted)",
                    border:"1px solid rgba(255,255,255,.2)", marginTop:10 }}
                  onClick={() => setConfirmLeave(true)} disabled={busy}
                >
                  Leave trainer
                </button>
              )}
            </>
          ) : (
            <>
              <div className="card-sub">
                Have a trainer? Paste their invite code to link your account.
              </div>
              <div style={{ display:"flex", gap:"8px", alignItems:"center", margin:"4px 0" }}>
                <input
                  style={field} value={code} placeholder="Trainer invite code"
                  onChange={(e) => setCode(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && join()}
                />
                <button style={btn} onClick={join} disabled={busy}>
                  {busy ? "…" : "Join"}
                </button>
              </div>
            </>
          )}
        </>
      )}
      {msg && <div style={{ marginTop:8, fontSize:".82rem", color:"var(--muted)" }}>{msg}</div>}
    </div>
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
  const allStrEx = [REST_ST, ...STRENGTH_EXERCISES];
  let cardio = 0, strength = 0;
  DAYS.forEach((day) => {
    (Array.isArray((d.cardio || {})[day]) ? d.cardio[day] : []).forEach((s) => {
      const co = ALL_CARDIO.find((c) => c.id === s.type) || ALL_CARDIO[ALL_CARDIO.length - 1];
      cardio += calcBurn(co.met, w, s.duration);
    });
    (Array.isArray((d.strength || {})[day]) ? d.strength[day] : []).forEach((s) => {
      const ex = allStrEx.find((e) => e.id === s.type) || REST_ST;
      strength += calcStrengthBurn(ex.met, w, s.duration);
    });
  });
  const target = Math.max(1200, Math.round(tdee - 500 + cardio / 7 + strength / 7));
  return { tdee, target };
}

function TrainerDashboard({ profiles, loading, onSelect, onManageClients }) {
  const [details, setDetails] = useState({}); // id -> { tdee, target }
  const [lastLog, setLastLog] = useState({}); // id -> "YYYY-MM-DD"
  const [sort, setSort] = useState("attention");

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

  const sorted = [...profiles].sort((a, b) => {
    if (sort === "name") return (a.name || "").localeCompare(b.name || "");
    if (sort === "recent") return lastActiveTs(b) - lastActiveTs(a);
    return lastActiveTs(a) - lastActiveTs(b); // "attention": quietest first
  });
  const complete = profiles.filter((p) => p.stepLabel === "Results").length;
  const activeWeek = profiles.filter((p) => Date.now() - lastActiveTs(p) < 7 * 86400000).length;

  const tabBtn = (active) => ({
    flex: 1, padding: "10px", fontSize: ".85rem", fontWeight: 700, borderRadius: "8px",
    border: "1px solid var(--border,rgba(255,255,255,.12))", cursor: active ? "default" : "pointer",
    background: active ? "var(--accent)" : "transparent", color: active ? "#0b0b12" : "var(--text)",
  });

  return (
    <div className="prof-screen">
      <style>{css}</style>
      <div className="header">
        <div className="logo">CALORIE<span>IQ</span></div>
        <div className="tagline">Maintenance · Deficit · Cardio · Strength · Timeline</div>
      </div>
      <div className="container">
        <RolePanel />
        <div style={{ display: "flex", gap: "8px", margin: "0 0 14px" }}>
          <button style={tabBtn(true)} disabled>Dashboard</button>
          <button style={tabBtn(false)} onClick={onManageClients}>All clients</button>
        </div>
        <div className="card">
          <div className="card-title">📊 Client Overview</div>
          <div className="card-sub">
            {loading ? "Loading…"
              : `${profiles.length} client${profiles.length !== 1 ? "s" : ""} · ${complete} with a complete plan · ${activeWeek} active this week`}
          </div>

          {!loading && profiles.length > 0 && (
            <div style={{ display: "flex", gap: "6px", margin: "12px 0 4px" }}>
              {[["attention", "Needs attention"], ["recent", "Last active"], ["name", "Name"]].map(([k, lbl]) => (
                <button key={k} onClick={() => setSort(k)}
                  style={{ padding: "6px 10px", fontSize: ".75rem", borderRadius: "6px", cursor: "pointer",
                    border: "1px solid var(--border,rgba(255,255,255,.12))",
                    background: sort === k ? "rgba(255,255,255,.1)" : "transparent", color: "var(--text)" }}>
                  {lbl}
                </button>
              ))}
            </div>
          )}

          {loading ? null : profiles.length === 0 ? (
            <div style={{ color: "var(--muted)", fontSize: ".85rem", padding: "8px 0" }}>
              No clients yet. Switch to “All clients” to add your first one.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginTop: "6px" }}>
              {sorted.map((p) => {
                const st = statusOf(p);
                const det = details[p.id];
                const ds = daysSinceLog(p);
                const w = Number(p.weight), g = Number(p.goal);
                const toGo = (w && g) ? Math.round((w - g) * 10) / 10 : null;
                const pct = det && det.pct != null ? det.pct : null;
                return (
                  <div key={p.id} onClick={() => onSelect(p.id)}
                    style={{ cursor: "pointer", padding: "12px 14px", borderRadius: "10px",
                      background: "rgba(255,255,255,.04)", border: "1px solid var(--border,rgba(255,255,255,.12))" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                      <span style={{ fontWeight: 700, fontSize: ".95rem" }}>{p.name || "Unnamed client"}</span>
                      <span style={{ fontSize: ".72rem", color: st.color, fontWeight: 600 }}>{st.label}</span>
                    </div>
                    {/* Weight → goal: larger and brighter so it's easy to read */}
                    <div style={{ fontSize: ".95rem", color: "var(--text)", fontWeight: 600 }}>
                      ⚖️ {p.weight ? `${p.weight} lbs` : "—"}{p.goal ? ` → ${p.goal} lbs` : ""}
                      {toGo !== null && toGo > 0
                        ? ` · ${toGo} lbs to go`
                        : (toGo !== null && toGo <= 0 ? " · 🎯 at goal" : "")}
                    </div>
                    {pct !== null && (
                      <div style={{ margin: "8px 0 2px" }}>
                        <div style={{ height: 7, borderRadius: 4, overflow: "hidden",
                          background: "rgba(255,255,255,.1)" }}>
                          <div style={{ height: "100%", width: `${pct}%`, borderRadius: 4,
                            background: "var(--accent)" }} />
                        </div>
                        <div style={{ fontSize: ".68rem", color: "var(--muted)", marginTop: 3 }}>
                          {pct}% to goal
                        </div>
                      </div>
                    )}
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "14px", fontSize: ".8rem",
                      color: "var(--muted)", marginTop: 8 }}>
                      <span>🔥 {det && det.target != null ? `${det.target.toLocaleString()} cal/day` : "—"}</span>
                      <span>🕑 {ds === null ? "no logs yet" : ds === 0 ? "active today" : ds === 1 ? "1 day ago" : `${ds} days ago`}</span>
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

// ─── Client home (Session 8) ────────────────────────────────────────────────
// A client manages just their own plan (stored in their own account as
// "caliq-self"). This is their landing screen: the role panel (their trainer
// link) plus a button to open/edit their plan in the normal editor. The plan a
// trainer "links" to them is the very same caliq-self, so both edit one copy.
function ClientHome({ onOpenPlan }) {
  return (
    <div className="prof-screen">
      <style>{css}</style>
      <div className="header">
        <div className="logo">CALORIE<span>IQ</span></div>
        <div className="tagline">Maintenance · Deficit · Cardio · Strength · Timeline</div>
      </div>
      <div className="container">
        <RolePanel />
        <div className="card">
          <div className="card-title">📋 My Plan</div>
          <div className="card-sub">
            Your nutrition &amp; training plan. Open it to view your targets, log
            your day, or make changes.
          </div>
          <button
            onClick={onOpenPlan}
            style={{ marginTop:12, width:"100%", padding:"12px 14px", fontSize:".95rem",
              fontWeight:700, borderRadius:"10px", border:"none", background:"var(--accent)",
              color:"#0b0b12", cursor:"pointer" }}
          >
            Open my plan
          </button>
        </div>
      </div>
    </div>
  );
}

function ProfileSelector({ profiles, folders, onSelect, onNew, onDelete, loading,
  onCreateFolder, onRenameFolder, onDeleteFolder, onMoveProfile,
  confirmDeleteId, confirmFolderDel, onRecover, onExport, onImport,
  onClipCopy, onClipPaste, showDashboardTab, onShowDashboard }) {

  const [openFolders, setOpenFolders] = useState({});
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
  const sorted = [...profiles].sort((a,b)=>(b.lastSaved||0)-(a.lastSaved||0));
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

  const ProfileCard = ({ p }) => (
    <div className={`prof-card${dragId===p.id?" drag-ghost":""}`}
      draggable="true"
      onDragStart={e=>onDragStart(e,p.id)}
      onDragEnd={onDragEnd}
      onClick={()=>onSelect(p.id)}>
      <div className="prof-avatar">{(p.name||"?").slice(0,2).toUpperCase()}</div>
      <div className="prof-info">
        <div className="prof-name">{p.name || "Unnamed Client"}</div>
        <div className="prof-meta">
          {p.weight ? `${p.weight} lbs` : "—"}
          {p.goal ? ` → ${p.goal} lbs` : ""}
          {p.lastSaved ? ` · ${new Date(p.lastSaved).toLocaleDateString()}` : ""}
          {p.stepLabel ? ` · ${p.stepLabel}` : ""}
        </div>
      </div>
      <button className="prof-del"
        style={confirmDeleteId===p.id?{background:"rgba(255,79,107,.15)",color:"var(--red)",borderRadius:"6px",padding:"2px 8px",fontSize:".68rem",border:"1px solid rgba(255,79,107,.3)"}:{}}
        onClick={e=>{e.stopPropagation();onDelete(p.id,p.name)}}
        title="Delete">{confirmDeleteId===p.id?"Confirm?":"✕"}</button>
    </div>
  );

  return (
    <div className="prof-screen">
      <style>{css}</style>
      <div className="header">
        <div className="logo">CALORIE<span>IQ</span></div>
        <div className="tagline">Maintenance · Deficit · Cardio · Strength · Timeline</div>
      </div>
      <div className="container">
        <RolePanel />
        {showDashboardTab && (
          <div style={{ display:"flex", gap:"8px", margin:"0 0 14px" }}>
            <button
              style={{ flex:1, padding:"10px", fontSize:".85rem", fontWeight:700, borderRadius:"8px",
                border:"1px solid var(--border,rgba(255,255,255,.12))", cursor:"pointer",
                background:"transparent", color:"var(--text)" }}
              onClick={onShowDashboard}
            >Dashboard</button>
            <button
              style={{ flex:1, padding:"10px", fontSize:".85rem", fontWeight:700, borderRadius:"8px",
                border:"1px solid var(--border,rgba(255,255,255,.12))", cursor:"default",
                background:"var(--accent)", color:"#0b0b12" }}
              disabled
            >All clients</button>
          </div>
        )}
        <div className="card">
          <div className="card-title">📂 Client Profiles</div>
          <div className="card-sub">
            {loading ? "Loading saved profiles..." : profiles.length > 0
              ? `${profiles.length} client${profiles.length!==1?"s":""} · ${folders.length} folder${folders.length!==1?"s":""}. Drag and drop clients between folders.`
              : "No saved profiles yet. Create a folder for your team, then add clients."
            }
          </div>

          {/* Dashboard Stats */}
          {!loading && profiles.length > 0 && (
            <div className="dash-stats">
              <div className="dash-stat">
                <div className="dash-stat-val c-acc">{profiles.length}</div>
                <div className="dash-stat-lbl">Total Clients</div>
              </div>
              <div className="dash-stat">
                <div className="dash-stat-val c-grn">{profiles.filter(p => p.lastSaved && (Date.now() - p.lastSaved) < 7*86400000).length}</div>
                <div className="dash-stat-lbl">Active This Week</div>
              </div>
              <div className="dash-stat">
                <div className="dash-stat-val c-org">{folders.length}</div>
                <div className="dash-stat-lbl">Folders</div>
              </div>
            </div>
          )}

          {/* Folder creation */}
          <div className="folder-bar">
            {showNewFolder ? (
              <div style={{flex:1,display:"flex",gap:"8px"}}>
                <input type="text" className="folder-input" placeholder="Folder name (e.g. Kevin's Clients)"
                  ref={folderInputRef}
                  value={newFolderName} onChange={e=>setNewFolderName(e.target.value)}
                  onKeyDown={e=>{ if(e.key==="Enter"&&newFolderName.trim()){ onCreateFolder(newFolderName.trim()); setNewFolderName(""); setShowNewFolder(false); }}}
                  />
                <button className="prof-new-btn" style={{flex:"0 0 auto",minHeight:0,padding:"8px 14px",fontSize:".8rem"}}
                  onClick={()=>{ if(newFolderName.trim()){ onCreateFolder(newFolderName.trim()); setNewFolderName(""); setShowNewFolder(false); }}}>
                  Create
                </button>
                <button className="folder-act-btn" onClick={()=>{setShowNewFolder(false);setNewFolderName("")}}>Cancel</button>
              </div>
            ) : (
              <button className="folder-new-btn" onClick={()=>setShowNewFolder(true)}>📁 + New Folder</button>
            )}
          </div>

          {/* Folders */}
          {folders.map(folder => {
            const clients = inFolder(folder.id);
            const isOpen = openFolders[folder.id] !== false; // default open
            const isDragOver = dragOverFolder === folder.id;
            return (
              <div key={folder.id}
                className={`folder-section${isDragOver?" drag-over":""}`}
                onDragOver={e=>onFolderDragOver(e,folder.id)}
                onDragLeave={onFolderDragLeave}
                onDrop={e=>onFolderDrop(e,folder.id)}>
                <div className="folder-header" onClick={()=>toggleFolder(folder.id)}>
                  <span className="folder-icon">{isOpen?"📂":"📁"}</span>
                  {editingFolder===folder.id ? (
                    <input type="text" className="folder-input" style={{flex:1}} value={editName}
                      onChange={e=>setEditName(e.target.value)}
                      onKeyDown={e=>{ if(e.key==="Enter"){ onRenameFolder(folder.id,editName); setEditingFolder(null); } if(e.key==="Escape") setEditingFolder(null); }}
                      onClick={e=>e.stopPropagation()} autoFocus />
                  ) : (
                    <span className="folder-name">{folder.name}</span>
                  )}
                  <span className="folder-count">{clients.length}</span>
                  <span className={`folder-chevron${isOpen?" open":""}`}>▼</span>
                </div>
                {isOpen && (
                  <>
                    <div className="folder-body">
                      {clients.length === 0 && (
                        <div className="drop-zone-hint">
                          {dragId ? "Drop here to move client into this folder" : "No clients yet — drag one here or create new"}
                        </div>
                      )}
                      {clients.map(p=><ProfileCard key={p.id} p={p}/>)}
                    </div>
                    <div className="folder-actions">
                      <button className="folder-act-btn" onClick={e=>{e.stopPropagation();onNew(folder.id)}}>+ Add Client</button>
                      <button className="folder-act-btn" onClick={e=>{e.stopPropagation();setEditingFolder(folder.id);setEditName(folder.name)}}>Rename</button>
                      <button className={`folder-act-btn${confirmFolderDel===folder.id?" del":""}`}
                        style={confirmFolderDel===folder.id?{borderColor:"var(--red)",color:"var(--red)",fontWeight:700}:{}}
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
            <div className={`folder-section${dragOverFolder==="unfiled"?" drag-over":""}`}
              onDragOver={e=>onFolderDragOver(e,"unfiled")}
              onDragLeave={onFolderDragLeave}
              onDrop={e=>onFolderDrop(e,null)}>
              <div className="folder-header" onClick={()=>toggleFolder("unfiled")}>
                <span className="folder-icon">{openFolders["unfiled"]!==false?"📋":"📋"}</span>
                <span className="folder-name" style={{color:"var(--muted)"}}>Unfiled</span>
                <span className="folder-count">{unfiled.length}</span>
                <span className={`folder-chevron${openFolders["unfiled"]!==false?" open":""}`}>▼</span>
              </div>
              {openFolders["unfiled"]!==false && (
                <div className="folder-body">
                  {unfiled.map(p=><ProfileCard key={p.id} p={p}/>)}
                </div>
              )}
            </div>
          )}

          {/* New client (unfiled) */}
          <button className="prof-new-btn" style={{marginTop:"12px"}} onClick={()=>onNew(null)}>+ New Client Profile</button>
        </div>

        {/* Export / Import / Recovery */}
        <div className="card" style={{padding:"16px",marginTop:"12px"}}>
          <div style={{fontSize:".82rem",fontWeight:700,color:"var(--text-secondary)",marginBottom:"4px"}}>📦 Data Management</div>
          <div style={{fontSize:".73rem",color:"var(--muted)",marginBottom:"12px",lineHeight:1.5}}>
            📱 <strong>Phone/iPad:</strong> Use Copy & Paste to move data between devices. <strong>Laptop:</strong> File export also works.
          </div>
          <div style={{fontSize:".65rem",color:"var(--accent)",lineHeight:1.4,marginBottom:"12px",fontStyle:"italic"}}>
            ℹ️ This section is only needed in the current version. Once CalorieIQ becomes a web app, your data syncs automatically across all devices — no exporting or importing needed.
          </div>

          {/* Clipboard — primary method for mobile */}
          <div style={{display:"flex",gap:"8px",marginBottom:"8px",flexWrap:"wrap"}}>
            <button className="save-bar-btn" style={{flex:"1 1 140px",minHeight:"44px",fontSize:".82rem",borderColor:"var(--green)",color:"var(--green)",background:"rgba(79,255,176,.06)"}}
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
            <button className="save-bar-new" style={{flex:"1 1 140px",minHeight:"44px",fontSize:".82rem"}}
              onClick={()=>{setShowPasteBox(v=>!v); setPasteText("");}}>
              📋 Paste to Restore
            </button>
          </div>

          {clipMsg && <div style={{fontSize:".8rem",color:clipMsg.startsWith("✅")?"var(--green)":clipMsg.startsWith("⚠️")?"var(--yellow)":"var(--muted)",marginBottom:"8px",textAlign:"center",lineHeight:1.4}}>{clipMsg}</div>}

          {showPasteBox && (
            <div style={{marginBottom:"10px"}}>
              <textarea
                ref={pasteRef}
                type="text"
                placeholder="Paste your CalorieIQ backup here..."
                value={pasteText}
                onChange={e=>setPasteText(e.target.value)}
                style={{
                  width:"100%", minHeight:"80px", padding:"12px", borderRadius:"8px",
                  border:"1.5px solid var(--accent)", background:"var(--s2)",
                  color:"var(--text)", fontFamily:"monospace", fontSize:".75rem",
                  resize:"vertical", outline:"none",
                }}
              />
              <div style={{display:"flex",gap:"8px",marginTop:"6px"}}>
                <button className="save-bar-btn" style={{flex:1,minHeight:"38px",fontSize:".8rem"}}
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
                <button className="folder-act-btn" onClick={()=>{setShowPasteBox(false);setPasteText("");}}>Cancel</button>
              </div>
            </div>
          )}

          {/* File export/import — secondary method */}
          <div style={{fontSize:".72rem",color:"var(--muted)",letterSpacing:".5px",textTransform:"uppercase",fontWeight:700,marginBottom:"8px",marginTop:"6px"}}>Or use file export</div>
          <div style={{display:"flex",gap:"8px",marginBottom:"10px",flexWrap:"wrap"}}>
            <button className="save-bar-btn" style={{flex:"1 1 140px",minHeight:"42px",fontSize:".8rem"}}
              onClick={async ()=>{
                setExportMsg("Packaging...");
                const ok = await onExport();
                setExportMsg(ok ? "✅ Download started!" : "❌ Export failed");
                setTimeout(()=>setExportMsg(null), 4000);
              }}>
              📤 Export All Clients
            </button>
            <button className="save-bar-new" style={{flex:"1 1 140px",minHeight:"42px",fontSize:".8rem"}}
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

          {exportMsg && <div style={{fontSize:".8rem",color: exportMsg.startsWith("✅")?"var(--green)":exportMsg.startsWith("❌")?"var(--red)":"var(--muted)",marginBottom:"8px",textAlign:"center"}}>{exportMsg}</div>}

          <div style={{fontSize:".73rem",color:"var(--muted)",lineHeight:1.5,marginBottom:"10px"}}>
            💡 <strong>Export</strong> downloads a JSON backup of all your clients, folders, and data. <strong>Import</strong> loads a backup file and merges it with your current profiles — no data is overwritten.
          </div>

          {recoverMsg && <div style={{fontSize:".8rem",color:"var(--green)",marginBottom:"8px",textAlign:"center"}}>{recoverMsg}</div>}
          <button style={{background:"none",border:"none",color:"var(--muted)",cursor:"pointer",fontFamily:"inherit",fontSize:".73rem",textDecoration:"underline",padding:"4px",width:"100%",textAlign:"center"}}
            onClick={async ()=>{
              setRecoverMsg("Scanning storage...");
              const count = await onRecover();
              setRecoverMsg(count > 0 ? `✅ Recovered ${count} profile${count!==1?"s":""}!` : "No lost profiles found in storage.");
              setTimeout(()=>setRecoverMsg(null), 5000);
            }}>
            🔍 Recover lost profiles from storage
          </button>
        </div>

        <div className="privacy-note">🔒 All data is stored locally on your device — nothing is sent to a server.</div>
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

  // Load profiles and folders on mount
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
        if (prof && prof.role) setRole(prof.role);
      } catch(e) {}
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
    saveTimer.current = setTimeout(async ()=>{
      try {
        const SL = ["Personal","Goal Weight","Activity","Cardio","Strength","Results"];
        await window.storage.set(profileKey(activeId), JSON.stringify({ data: newData||data, step: newStep??step }));
        const d = newData||data;
        const up = profiles.map(p => p.id===activeId ? {...p, name:fullName(d)||p.name, weight:d.weightLbs||"", goal:d.goalWeight||"", lastSaved:Date.now(), stepLabel:SL[newStep??step]||""} : p);
        setProfiles(up);
        await saveIndex(up);
        setSaving(true);
        setTimeout(()=>setSaving(false), 1200);
      } catch(e) {}
    }, 600);
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
        setData({...EMPTY_DATA, ...d, cardio:{...defaultCardio,...(d.cardio||{})}, strength:{...defaultStrength,...(d.strength||{})}});
        setStep(parsed.step || 0);
        setShowDash((parsed.step || 0) >= 5);
      }
    } catch(e) { setData({...EMPTY_DATA}); setStep(0); }
    setActiveId(id);
    setScreen("app");
  };

  const createProfile = (folderId) => {
    const id = `c${Date.now()}`;
    const np = { id, name:"", weight:"", goal:"", lastSaved:Date.now(), stepLabel:"Personal", folderId: folderId||null };
    const up = [...profiles, np];
    setProfiles(up);
    saveIndex(up);
    setData({...EMPTY_DATA});
    setStep(0);
    setActiveId(id);
    setScreen("app");
  };

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

  const goToProfiles = () => { setScreen("profiles"); setActiveId(null); };
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
      a.download = `CalorieIQ-Backup-${new Date().toISOString().slice(0,10)}.json`;
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
    } catch(e) { return { ok: false, msg: "Failed to read file — make sure it's a CalorieIQ backup JSON" }; }
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
    } catch(e) { return { ok:false, msg:"Invalid data — make sure you pasted a CalorieIQ backup" }; }
  };

  // ── Daily log handler ──
  const todayKey = new Date().toISOString().slice(0,10);
  const onLogUpdate = (field, value) => {
    const updated = {...dailyLog, [field]: value};
    setDailyLog(updated);
    if (activeId) {
      try { window.storage.set(`caliq-log-${activeId}-${todayKey}`, JSON.stringify(updated)); } catch(e) {}
    }
    // Update streak: if calories logged > 0, count as active day
    if (field === "calories" && value > 0) setStreak(s => Math.max(s, 1));
  };

  // Load daily log when profile changes
  useEffect(() => {
    if (!activeId) return;
    (async () => {
      try {
        const r = await window.storage.get(`caliq-log-${activeId}-${todayKey}`);
        if (r && r.value) setDailyLog(JSON.parse(r.value));
        else setDailyLog({calories:0, water:0, weight:0});
      } catch(e) { setDailyLog({calories:0, water:0, weight:0}); }
      // Simple streak: count consecutive days with logs
      let s = 0;
      for (let i = 0; i < 365; i++) {
        const d = new Date(); d.setDate(d.getDate() - i);
        const dk = d.toISOString().slice(0,10);
        try {
          const lr = await window.storage.get(`caliq-log-${activeId}-${dk}`);
          if (lr && lr.value) { const p = JSON.parse(lr.value); if (p.calories > 0) { s++; continue; } }
        } catch(e) {}
        if (i === 0) continue; // today might not have logs yet
        break;
      }
      setStreak(s);
    })();
  }, [activeId]);

  // ── Compute values for dashboard (same formulas as Results) ──
  const actObj = ACTIVITY_LEVELS.find(a=>a.id===data.activityLevel) || ACTIVITY_LEVELS[0];
  const bmr = calcBMR(data.gender, Number(data.weightLbs), Number(data.heightFt), Number(data.heightIn), Number(data.age));
  const computedTdee = Math.round(bmr * actObj.multiplier);
  const allStrEx = [REST_ST, ...STRENGTH_EXERCISES];
  const computedDayData = DAYS.map(day => {
    const raw = data.cardio[day];
    const sessions = Array.isArray(raw) ? raw : [];
    const wkData = sessions.map(w => {
      const co = ALL_CARDIO.find(c=>c.id===w.type)||ALL_CARDIO[ALL_CARDIO.length-1];
      return { co, duration:w.duration, burned:calcBurn(co.met, Number(data.weightLbs), w.duration), type:w.type };
    });
    return { day, workouts:wkData, burned:wkData.reduce((s,w)=>s+w.burned,0) };
  });
  const computedStrDayData = DAYS.map(day => {
    const raw = (data.strength||{})[day];
    const sessions = Array.isArray(raw) ? raw : [];
    const sData = sessions.map(w => {
      const ex = allStrEx.find(e=>e.id===w.type)||REST_ST;
      return { ex, duration:w.duration, burned:calcStrengthBurn(ex.met, Number(data.weightLbs), w.duration), type:w.type };
    });
    return { day, sessions:sData, burned:sData.reduce((s,w)=>s+w.burned,0) };
  });
  const computedAvgBurn = Math.round(computedDayData.reduce((s,d)=>s+d.burned,0)/7);

  const LBLS = ["Personal","Goal Weight","Activity","Cardio","Strength","Results"];
  const STEP_ICONS = ["👤","🎯","🏃","🔥","💪","📊"];

  if (screen === "profiles") {
    // A client manages just their own plan (stored in their account as
    // "caliq-self"), not a list of other people's profiles.
    if (role === ROLES.CLIENT) {
      return <ClientHome onOpenPlan={() => selectProfile("self")} />;
    }
    const isTrainerHome = role === ROLES.HEAD_TRAINER || role === ROLES.SUB_TRAINER;
    if (isTrainerHome && homeTab === "dashboard") {
      return <TrainerDashboard
        profiles={profiles} loading={loading}
        onSelect={selectProfile} onManageClients={()=>setHomeTab("clients")}
      />;
    }
    return <ProfileSelector
      profiles={profiles} folders={folders} loading={loading}
      onSelect={selectProfile} onNew={createProfile} onDelete={deleteProfile}
      onCreateFolder={createFolder} onRenameFolder={renameFolder}
      onDeleteFolder={deleteFolder} onMoveProfile={moveProfileToFolder}
      confirmDeleteId={confirmDeleteId} confirmFolderDel={confirmFolderDel}
      onRecover={recoverProfiles} onExport={exportAllData} onImport={importData}
      onClipCopy={clipboardExport} onClipPaste={clipboardImport}
      showDashboardTab={isTrainerHome} onShowDashboard={()=>setHomeTab("dashboard")}
    />;
  }

  return (
    <>
      <style>{css}</style>
      {saving && <div className="prof-save-badge">✓ Saved</div>}
      <div className="app">
        <div className="header">
          <div className="logo">CALORIE<span>IQ</span></div>
          <div className="tagline">Maintenance · Deficit · Cardio · Strength · Timeline</div>
        </div>
        <div className="prof-header-bar">
          <div style={{display:"flex",gap:"8px",alignItems:"center"}}>
            <button className="prof-switch-btn" onClick={goBack} style={{background:"var(--accent)",color:"#0b0b12",borderColor:"var(--accent)",fontWeight:700,minWidth:"36px",padding:"6px 12px"}}>
              ← {(showDash && step===5) ? (role === ROLES.CLIENT ? "Home" : "Clients") : step <= 4 ? (navFrom === "results" ? "Results" : "Dashboard") : "Dashboard"}
            </button>
            <div className="prof-header-name">📂 {fullName(data) || "New Client"}</div>
          </div>
          <button className="prof-switch-btn" onClick={goToProfiles}>{role === ROLES.CLIENT ? "My Home" : "All Clients"}</button>
        </div>
        <div className="container">
          <div className="steps-wrap">
            {step < LBLS.length - 1 && (
              <div className="step-name-row">
                {LBLS.slice(0,-1).map((lbl,i)=>(
                  <div key={lbl} className={`step-name-item${i===step?" active":i<step?" done":""}`}>{STEP_ICONS[i]}</div>
                ))}
              </div>
            )}
            <div className="step-lbl">
              {step < LBLS.length - 1
                ? `Step ${step+1} of ${LBLS.length-1} — ${LBLS[step]}`
                : showDash ? "📊 Daily Dashboard" : "✅ Your Personalized Plan"
              }
            </div>
            <div className="steps-bar">
              {LBLS.slice(0,-1).map((_,i)=>(
                <div key={i} className={`step-dot${i===step?" active":i<step?" done":""}`}/>
              ))}
            </div>
          </div>
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
            />
          )}
          {step===5 && !showDash && <>
            <div style={{marginBottom:"12px"}}>
              <button className="dash-nav-btn" style={{width:"100%"}} onClick={()=>setShowDash(true)}>📊 Back to Dashboard</button>
            </div>
            <Results data={data} onReset={reset} onEdit={s=>{setNavFrom("results");setStepAndSave(s);setShowDash(false);}}
            onSaveCheckIn={(checkin)=>setDataAndSave(p=>({...p, checkIns:[...(p.checkIns||[]), checkin]}))}
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
    </>
  );
}
