# Native app / App Store plan (decided S90, Jul 8 2026 — build LATER)

_Kevin's decision: keep building the web app (it carries over ~90%); do the native build as a
future 3–6 week project. **BILLING DECISION (locked): subscriptions are sold OUTSIDE Apple —
web/Stripe only, the Netflix/Spotify model — never Apple IAP by default.**_

## Why the current build is the blueprint
- Backend (Firebase, all Cloud Functions, AI layer, Stripe, rules, messaging, push infra) is
  app-agnostic — a native app talks to the same servers. Zero rework.
- Frontend gets WRAPPED, not rewritten: **Capacitor** puts the existing React app in a native
  shell; native plugins add the rest. The app is already mobile-first (safe areas, S90 iOS
  polish: body scroll-lock, no input zoom, tap-highlight).

## Billing strategy (the money part)
- **Primary: web checkout on glidna.com (Stripe) → users sign into the app. Apple fee: $0.**
  Fully allowed (multiplatform-services rule; Netflix/Spotify do exactly this).
- **US bonus:** since the 2025 Epic v. Apple injunction, US apps may LINK OUT to external
  purchase pages without commission — the in-app Upgrade button can open glidna.com checkout.
- If conversion data ever justifies it: optional Apple IAP later at the same prices — Small
  Business Program = **15%** (not 30%) under $1M/yr, and margins hold even at 30%
  (Premium $14.99 −30% ≈ $10.50 vs $2–3.50 realistic AI COGS).

## Build checklist for the future session (the actual work)
1. Capacitor wrap (iOS + Android), app icons/splash from the existing brand assets.
2. **Apple requirements:** Sign in with Apple (required because Google sign-in exists),
   in-app account deletion, finished Privacy Policy (ToS is live at /terms.html; privacy
   policy still to write), App Privacy "nutrition labels", reviewer demo account.
3. Native push: APNs (the web-push/VAPID path doesn't run in the iOS shell) — keep the same
   send pipeline (functions/push.js) and add an APNs/FCM branch keyed by subscription type.
4. **HealthKit / Health Connect** — the headline native feature (direct watch data, no
   Trainerize middleman); writes into the existing day-log `wearable:{}` shape so every
   screen lights up unchanged.
5. Passkeys/Face ID inside the shell: verify WebAuthn in the Capacitor webview against
   glidna.com (associated domains), else swap to the native biometric plugin.
6. Accounts: $99/yr Apple Developer, $25 one-time Google Play. Review lead time: days–2 weeks.

Realistic total: 3–6 focused weeks. Prerequisites already DONE (S90): custom domain, final
name, live billing, ToS.
