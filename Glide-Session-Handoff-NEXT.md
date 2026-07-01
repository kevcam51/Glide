# Glide — Next-Session Handoff (start here)

_Updated end of **Session 83** (Option C — Invite Hub: share / QR / email / referrals). Read this
first, then `CLAUDE.md` (standing context) and `docs/AI-INTEROP-VISION.md` (the "works with your AI"
plan). Everything below is pushed to `main` and live unless noted. Firebase project `calorieiq-29762`;
prod URL `calorieiq-jet.vercel.app`._

---

## ⏭️ DO FIRST

- **Turn ON email invites (Option C, S83) — the ONLY blocked piece.** The `sendInvite` Cloud Function
  is written + committed but NOT deployed (it binds secrets that don't exist yet). Kevin, one-time:
  (1) make a Resend account (resend.com) + API key; (2) `firebase functions:secrets:set RESEND_API_KEY`;
  (3) verify a sending domain in Resend, then `firebase functions:secrets:set RESEND_FROM` (e.g.
  `Glide <invites@yourdomain>`; for a quick test before domain verify, Resend's `onboarding@resend.dev`
  only delivers to your own account email); (4) `firebase deploy --only functions:sendInvite`. Until
  then the Invite Hub's email composer degrades gracefully ("share the link instead"); **share + QR +
  referral stats already work live.** Full steps are in `functions/invites.js`'s header comment.
- **Verify the S81 invite-card unfurl in prod (Vercel-function work — only confirmable live).** Copy a
  trainer's invite link (≡ menu → Invite clients → Copy) → now `…/i/CODE?n=First`; paste into
  https://www.opengraph.xyz (or Slack/iMessage): expect a "**[Name] invited you to Glide**" card.
  Crawlers cache — cache-bust with a fresh `?n=`. Falls back to static `/og.png` on any error.
- **Next feature (Kevin's chosen order):** ~~Paste-from-AI import~~ → ~~Option B invite card (S81)~~ →
  ~~Video/link ingest (S82)~~ → ~~Option C invites + referral (S83 — email deploy pending Kevin's key)~~
  → **calendar back-dating** (next).
- **Video/link ingest (S82, LIVE):** paste a URL in the AI chat → the AI reads its title/caption via
  the `fetch_link` tool and turns it into program changes. IG/TikTok fetches often fail → the AI asks
  for a pasted caption. Phase 2/3 optional in `docs/VIDEO-LINK-INGEST.md`.

## What shipped in Session 83 (Option C — invites + referral)

- **Invite Hub** (new `InviteHub` modal, ≡ menu → Invite clients): one place with (1) the personalized
  invite link + Copy, (2) **native Share** (Web Share API + copy fallback), (3) a **QR code** for
  in-person signups (new `qrcode` dep), (4) **email invitations**, and (5) **referral stats** (clients
  joined / invites sent / invites joined). Replaced the old inline invite expander in the side menu.
- **Referral tracking, no new infra:** email invites are recorded in the trainer's own `caliq-invites`
  kv; "joined" is matched **client-side** by comparing invited emails to connected clients' emails
  (`getMyClients` returns profiles incl. email) — no Cloud Function trigger needed.
- **Email invites:** new `sendInvite` callable (`functions/invites.js`, trainer-only) sends a branded
  email with the personalized `/i/CODE?n=` link via **Resend**. **Needs Kevin's RESEND_* secrets +
  deploy (see DO FIRST).** Verified live that the composer degrades gracefully until then; share/QR/
  stats all verified live as trainer.uitest.

## What shipped in Session 81 (Option B — personalized invite share card)

- **Trainer invite links are now `…/i/CODE?n=FirstName`** (was `…/?invite=CODE`), built in the side
  menu from `meName`. Old `?invite=` links still work (backward compatible).
- **`api/invite.js`** (NEW Vercel fn) — serves HTML whose OG/Twitter meta say "**{Name} invited you to
  Glide**", `og:image` → `/api/og?n={Name}`, then redirects real browsers to `/?invite=CODE&n=Name`.
  Crawlers (no JS) read the meta; humans bounce into the app. Name HTML-escaped, code sanitized (XSS-tested).
- **`api/og.js`** (NEW) — renders the personalized 1200×630 PNG (resvg + Sora, like `gen-og.mjs`). **On
  ANY failure it 302s to the static `/og.png`** — can only improve the unfurl, never break it.
- **`vercel.json`** (NEW, first in repo) — rewrite `/i/:code → /api/invite?c=:code` + `includeFiles`
  for `api/_fonts/` (Sora 700/400). Additive; doesn't touch the Vite build.
- **`@resvg/resvg-js` → `dependencies`** (needed at function runtime). `AuthGate` notice + `App.jsx`
  `?n=` reader greet the invitee by the inviter's name.
- **Verified locally:** build passes; both handlers tested in Node (valid PNG + correct meta + XSS
  sanitization); preview shows the personalized notice; no console errors. Vercel-runtime bits only
  confirmable post-deploy (see DO FIRST).

## What shipped in Session 80 (all live)

- **Custom icon system (huge).** New `src/icons.jsx` — one `<Icon name size variant color>` component
  + a full cyan line-icon family. Swept emoji → custom icons across side menu, Coaching Dashboard,
  ClientHome, Daily Dashboard, nav buttons, AI chat, section headers, request badges, hide-reminder
  controls. **A parallel agent also swept the Results screen + refined glyphs** (its commits are in the
  log alongside mine).
- **Exercise category icons (Option A).** `exerciseCategory(ex, kind)` in `src/App.jsx` buckets ~180
  exercises → run / bike / swim / dumbbell / yoga(warrior) / moon(rest) / bolt, by id+label keywords.
  Workout day-rows + burn breakdown render category `<Icon>`s. **Carve-out:** native `<select>`
  `<option>`s keep emoji (SVG can't live in an option), so exercise PICKERS + the ⭐ custom-exercise
  marker stay emoji. Playful emoji kept (👋 greeting, 🎉 goal, achievement badges ⭐🏆).
- **OG share card (Option A foundation).** `public/og.png` (1200×630, generated by `npm run gen:og`
  via `scripts/gen-og.mjs` + `@resvg/resvg-js` + `@fontsource/sora`, dev-deps) + og/twitter meta in
  `index.html`. Shared links unfurl with the GLIDE card. Domain hardcoded to `calorieiq-jet.vercel.app`
  (update when a custom domain lands — noted in `index.html`).
- **Two-tier cyan (calmer colors).** Bright `#08DCE0` kept for small accents; softer cyan for big
  fills (Kevin found full-bright fills too harsh). Ask Glide button slimmed + solid-sparkle icon.
- **Paste-from-AI import (works-with-your-AI phase 1).** `AIChatPanel` "Paste from another AI" box +
  persistent composer clipboard button → sends the paste framed so Glide's AI extracts every
  meal/workout/weigh-in, summarizes, and logs on confirm. Verified end-to-end (3-meal paste parsed +
  summarized + confirm-gated).
- **AI cost cut (no quality loss).** Trimmed meal-estimate verbosity + capped re-sent chat history
  20→10 (`HISTORY_MSGS` in `functions/aichat.js`). See memory `ai-chat-cost-levers`.

## Decisions locked (don't re-litigate)

- **AI stays on `claude-sonnet-4-6` for everyone** — monetize via bigger budget + premium features
  (photo/voice/proactive coaching), NOT a Haiku downgrade. Memory `ai-model-tier-decision`.
- **Icons: full custom (Option B / strip ~all emoji).** Kept only: dropdown-option emoji (`<select>`
  limitation), the ⭐ custom-exercise marker, and playful greeting/celebration/achievement emoji.
- **Positioning:** "skilled trainers + smart AI keep you aware, accountable, on track — powerful with a
  coach, capable on its own." Human trainers are central; AI augments. CTA = **"Start gliding."**
- **Interop:** `docs/AI-INTEROP-VISION.md` — paste-import (done) → Glide-format → Glide-as-MCP-connector.

## Gotchas

- **A parallel/background agent edits this repo too** (auto-commits). The working tree is usually clean
  between its edits; commit your changes promptly to avoid clobbering. Memory `concurrent-git-commits`.
- **Deploy ALL FOUR AI functions when `functions/aitools.js` changes** (aiChat, aiChatStream, logMeal,
  setWorkoutSchedule) — it's shared. Only `aichat.js` changed this session → aiChat + aiChatStream.
- **Firebase token expires** → `firebase login --reauth --no-localhost` (Kevin runs it).
- **`src/App.jsx` ≈ 12.6k lines**; the `css` block is a JS template literal (no backticks in CSS
  comments). `npm run build` before committing. Commit to `main` (auto-deploys Vercel).
- **Native `<select>` options can't hold SVG** — that's why exercise pickers + ⭐ stay emoji.
- **Test accounts:** trainer `trainer.uitest@calorieiq-test.com` / client `client.uitest@…` (Casey),
  both `TestPass123`. Drive the preview signed-in (AI callables need real Firebase Auth).

## Context-handoff protocol (Kevin's ask, S80)

As a session nears the context limit, proactively warn Kevin, refresh THIS file, and give the next-
session prompt — don't wait to be asked. (Memory `context-handoff-protocol`.)
