---
timestamp: 2026-07-26T02-00-09Z
slug: src-app-jsx-clienthome
---
# Design Critique — Client Dashboard (ClientHome)

Provenance: two isolated sub-agents (Assessment A design review, Assessment B detector + evidence), synthesized 2026-07-25. Source-based review — no authenticated browser session; contrast ratios computed from source-extracted hex values (WCAG relative luminance), not screenshots. Detector ran clean inside the component (13 findings in file, 0 inside ClientHome L16766–17714).

Mode: Operate. Design-specificity verdict: **specific** (trend-honest ETA, trainer-request loop, estimate captioning, eat-back semantics) on genre-standard bones.

Heuristics (0–4): visibility 3 · real-world match 4 · control/freedom 2 · consistency 3 · error prevention 2 · recognition 4 · flexibility 4 · minimalism 2 · error recovery 3 · help 3.

## Strengths
1. Time-to-goal card = the credibility principle rendered as UI (real trend, honest fallbacks, refuses absurd ETAs).
2. Trainer-request → QuickActionModal closed loop; zero navigation.
3. Invisible state craft: echo-suppressed live sync, planWrapRef race protection, merge-not-replace check-ins.

## Priority issues (ranked, converged from both assessments)
- **P1 Plan delete is one tap, no confirm, no undo** (17390→16979): deletes plan + data + history. Fix: inline confirm reusing RolePanel leave-trainer pattern.
- **P2 Payment banner theme bug + AA failures**: `var(--danger,…)` — token defined NOWHERE (only --color-danger/--red exist) → banner locked to dark red both themes; measured: heading 2.38:1 light, Pay button white-on-#f87171 **2.77:1 in BOTH themes**, border 2.57:1 light. Fix: swap 4 inline styles (17311/12/20/25) to theme tokens + add --color-dangerfg pair.
- **P3 Light theme systemically fails AA** (S95 light theme never contrast-checked): --color-primary #0a8f93 = 3.92:1 on white (themes.css comment claims ~4.5 — wrong); success #0f9d6e = 3.46:1 normal text; muted on surface2 = 4.48:1; weight-bar fill #08dce0 on light track = **1.48:1**; unread badge 4.35:1 at 10px. Fix at TOKEN level in themes.css [data-theme="light"], not per-usage.
- **P4 Touch targets**: 15 offender groups vs committed 44px floor — worst: plan rename/delete icons ~14×20px, "Show" ~16px, header row ~30px, weigh-in "Log" ~30px. Fix: bump miniBtnCls/header consts + hit-area extension on icon buttons.
- **P5 Meaning/label failures**: (a) "Since start" tile good/bad by hue alone (+2 green vs +2 red identical text) — add toward/away sublabel; (b) "Healthy range" mislabels a user-set goal band as a health judgment — rename "Goal range"; (c) 3 inputs placeholder-as-label/no label; 3 inputs outline-none with no focus style.

## Emotional journey
Peak: goal-cross confetti (direction-aware, reduced-motion safe) — keep. Valleys: standing red "Since start" tile daily for off-trend clients; danger-red at +1 cal over (voice says never shame); "adjust and keep logging" dead-end (no route to trainer/AI); scroll ends on RolePanel with permanent "Leave trainer" (peak-end).

## Cognitive load
5-button ~30px header row (Refresh redundant vs live-sync); 3 co-equal mini buttons hide the daily "Log" action; up to 6 meta-blocks can push the hero below fold (3 simultaneous nudges — slice(0,1) fix); 3 unhierarchized food-logging paths (raw quick-add is a data-quality trap: totals with no foods; double-count risk with AI).

## Red flags
Typo weigh-ins believed instantly (can fire goal confetti on a data error — soft 20%-delta check ≈5 lines); "lbs to gain" flip unexplained on overshoot; title= tooltips inert on touch; success confirmations styled quieter than chrome (text-muted); next-session card hardcodes rgba(8,220,224,.06) while sibling card shows the correct color-mix pattern.

## Provocative questions
1. Does raw-calorie quick-add deserve to live now that AI + meal log + calendar exist?
2. Why does a daily screen lead with a weekly number (weight hero above Today card)?
3. Is danger-red the right register for +1 cal — amber until +10%?

## Detector (file-wide, outside this component)
8× side-tab left-border accents (820, 1502, 1627, 1685, 2207, 4394*, 4409, 6239 — *4394 is semantic HR-zone color), 5× transition:width (1095, 1446, 7027, 11160, 11509), 1× Inter font (dev-only Showcase).
