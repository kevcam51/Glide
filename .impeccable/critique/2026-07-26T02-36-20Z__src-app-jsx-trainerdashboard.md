---
timestamp: 2026-07-26T02-36-20Z
slug: src-app-jsx-trainerdashboard
---
# Design Critique — Trainer Home (TrainerDashboard, src/App.jsx 13782–14808)

Provenance: two isolated sub-agents (A design review, B detector+evidence), synthesized 2026-07-26. Source-based (no login); ratios computed from post-74434aa tokens. Detector: 0 findings in range (5 transition:width elsewhere).

Verdict: "Designed, but accreted" — a real trainer register, but the client card absorbed 6 sessions of features into one flat surface. Heuristics: status 3 · match 3 · control 2 · consistency 2 · error-prevention 3 · recognition 3 · flexibility 3 · MINIMALISM 1 · recovery 2 · help 3.

## Strengths
1. Resilience as design (keep-last-roster on fetch fail, live listeners, pull-to-refresh).
2. Inline-confirm pattern with consequence copy — right for the dense register.
3. The Trainerize picker (pre-checked new-only, triage, "in Glidna" tags, honest idempotency).

## Priorities (converged)
- P1 THEME-BREAKING HARDCODES (complete list, all tuned for dark): #39d98a/#f0a020 statusOf (1.59/1.87:1 light); #b57bff sim purple x5 (2.58–2.90 light; needs --color-sim pair, light ≈ #6d3bd6); dangerBtnCls text-white on #f87171 = 2.77 DARK (same bug as ClientHome pay button — use --color-dangerfg); dangerGhostCls rgba(248,113,113,.4) border 1.43–1.91; cyan rgba tints x6 (borders 1.09–2.31, active-row tint dead at 1.02 light); checkbox accent-[#08dce0] 1.48 light; bg-primary badges 3.07 light (use bg-primaryfill like the "N open" pill); progress fill 1.70 light; opacity-70 muted timestamps 2.77–3.14.
- P2 NINE-ACTION CARD: collapse to Message/Send request/Open plan + "Manage ▾" expander (composingFor pattern; new manageFor state). Three competing open affordances → one.
- P3 TOUCH+KEYBOARD: nothing reaches 44px (mBtnCls ~32–34; icon ✕/✎ 14–15px; p-0 text buttons ~16px; chips ~30). role/tabIndex/keys on 2 clickable divs (14339, 14727); focus-visible for outline-none inputs; aria-labels on 6 icon/title=-only buttons; labels for 3 inputs (14473, 14504, 14731).
- P4 FEEDBACK: cMsg is shared, below the whole roster, text-muted for success AND failure, never clears → per-client {uid,ok,text}, in-card, valenced, autoclear; tzMsg needs a non-hue ok/fail marker.
- P5 STALLED SALIENCE: ds>=attnDays → warn "quiet" word+hue on the clock line; drop uniform border-primary to border-border; consider surfacing Nudge here (lives only on Analytics).

## Red flags
Quick templates send on FIRST tap (mis-tap pings a client); new-trainer empty state hides the clients card entirely — no "Invite your first client" CTA; roster is a very long scroll (no name search); "Client Requests" vs "Send request" same noun+icon opposite directions; first-paint reflow (clients card mounts after async load).

## Product questions
1. Local Plans → collapsed power drawer, home given back to clients?
2. Merge "Send request" into DMs as a to-do message type?
3. Rename link/unlink/copy vocabulary to coaching acts ("Assign plan / Take plan back") for white-label?
