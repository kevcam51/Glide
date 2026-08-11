# Session auto-pay — pre-go-live review (S185)

**Status: RAW findings. The adversarial verify pass had NOT finished when this was written,**
so nothing here is confirmed yet. Treat every item as a lead to check, not a proven defect.
Duplicates across the five review lenses have been merged (several were found independently by
two or three lenses, which is itself a signal).

40 raw findings from 5 lenses -> 40 distinct.

Full transcripts + the verify verdicts (once complete):
`~/.claude/projects/-Users-ksmooth-Desktop-calorieiq/8bdcd0dd-4ff3-4ffe-a5d1-d9bb9709abe6/subagents/workflows/wf_3b27aad5-d20/journal.jsonl`

---

## The themes that matter (my read of the 40)

Several lenses independently found the same underlying bugs — where that happened I've noted it,
because two or three reviewers converging on one line is the strongest signal in the set.

**1. A successful charge can be recorded as a decline, and then charged again.** `sessionSettle.js`
~:256-271. `paymentIntents.create` succeeds and Stripe captures the money; the *next* line
(`ledgerRef.update`) fails on a transient Firestore error, or the instance is torn down, or the HTTP
response is lost. The catch block treats all of it as a card decline: the client is told "declined",
a hold is set, and their **Pay now** button charges the card a second time. **Found independently by
four lenses.** This is the single most dangerous defect in the file — it takes real money twice and
tells the customer the opposite of what happened.

**2. `paySessionBalance` has no in-flight lock.** ~:388. The call is slow (Stripe + 4 Firestore
writes + 2 push sends); nothing visibly happens, so the client taps again and is charged twice.

**3. `cancelledBy` is not pinned to the writer** (`firestore.rules` ~:328-330), and a *delivered*
session can still be cancelled. A client can write `{status:'cancelled', cancelledBy:<trainerUid>}`
from the browser console after training, and settle treats it as a trainer cancellation — free
sessions, indefinitely. Rules-level, so no UI change can stop it.

**4. Test-mode Stripe ids poison the live path.** `sessionBilling.js` ~:79. Rehearsing with
`sessionBillingTest: true` mints a TEST `cus_…` into the client's shared `stripeCustomerId`; once
that flag comes off, every live charge for that person fails. **This one is directly in the way of
the planned smoke test** — rehearse on a throwaway client, never on a real one.

**5. Disclosure mismatches — what the client agreed to is not what they're charged.**
`noShowChargePct` is shown to the client and frozen into their consent record, then never applied:
a no-show is billed at 100% regardless. And the cancellation confirm prices the fee from the
trainer's *current* policy while settle bills the *frozen consent snapshot*, so the dialog can say
$0 and the card be charged $150. These are ToS/consent problems, not just bugs.

**6. Silent revenue loss, three ways.** Unsettled sessions age out of the 30-day lookback and are
never billed (a declined client who keeps training simply stops being billable); the 200-doc query
cap is consumed by already-settled and never-settleable sessions, so billing quietly stops at scale;
and the money sweep still runs at the 60-second default timeout, stranding sessions in
`settled:"processing"` with the card possibly already charged.

**7. $0-priced sessions** (the price field opens blank) are claimed, marked settled forever, and
send both sides a bogus "covered by your package" notice.

**What I'd conclude:** the architecture is sound — the transactional claim, the idempotency key on
the sweep, the consent snapshot and the server-only billing fields are all the right instincts. The
gaps are concentrated in *failure* paths: what happens when Stripe answers slowly, when Firestore
blips, when the instance dies mid-run, when a client edits a doc directly. Those paths have never
run, because test mode with 4242-cards never fails.

---

## [CRITICAL] `cancelledBy` is not pinned to the writer: a client can cancel out of every charge, and a trainer can bill their own cancellation
**firestore.rules:330**

**Evidence**
```
`clientCancelFields()` (firestore.rules:262-264) includes `cancelledBy`, and the client update rule (:327-333) checks `hasOnly(clientCancelFields())`, `identityIntact()`, `cancelStampHonest()` and `status == 'cancelled'` — but never `request.resource.data.cancelledBy == request.auth.uid`. The trainer rule (:317-326) is the same via `bookingFields()` (:258). `cancelStampHonest()` (:280-285) pins `cancelledAt` to server time precisely because it decides money, but the field that decides WHO cancelled is unguarded. The settle engine trusts it twice: candidates require `v.cancelledBy === v.clientUid` (sessionSettle.js:126) and `lateFeeCents` returns 0 when `session.cancelledBy !== session.clientUid` (:78). firestore.rules.test.js:291-292 only tests the honest case; nothing tests spoofing.
```
**How it fails**
(a) Client-side, money lost: a client with a $120 session 2 hours away writes `{status:'cancelled', cancelledBy: <trainerUid>, cancelledAt: Date.now()}` — one `updateDoc` from the browser console, or `cancelSession(id, trainerUid)` which the app already exports. The rules accept it. The session is excluded from `doneSnap` (status cancelled) and rejected by `cancSnap` (`cancelledBy !== clientUid`), so it is never a billing candidate at all: the 100% late fee of $120 is never charged, and no ledger row is ever written, so nothing shows in Earnings to reveal it. The same write on an already-delivered, not-yet-settled session zeroes a session that actually happened. (b) Trainer-side, wrong charge: a trainer cancelling their own session 2 hours before stamps `cancelledBy: <clientUid>`; settle sees a client late-cancel and charges the client's card $120 for a session the trainer cancelled — which public/terms.html §6 promises is "never charged to you".

**Suggested fix**
In both session update rules require `request.resource.data.get('cancelledBy','') == request.auth.uid` whenever `cancelledBy` is in `changed()` (and require it to be present when status becomes 'cancelled'), exactly parallel to `cancelStampHonest()`. Add emulator cases for both spoof directions before publishing.

---

## [CRITICAL] A client can cancel their own session as if the TRAINER cancelled it — and can do it after the session was delivered — making the charge vanish
**firestore.rules:328**

**Evidence**
```
The client-update rule (firestore.rules:328-333) lets a client write `clientCancelFields()` = ['status','cancelledBy','cancelledAt','cancelReason','updatedAt'] with NO check that `cancelledBy == request.auth.uid`, and no guard on a session that already has `completedAt`. The settle engine then reads that field as truth: functions/sessionSettle.js:126 only treats a cancellation as billable when `v.cancelledBy === v.clientUid`, functions/sessionSettle.js:125 drops any session with `status === "cancelled"` from the completed-session branch, and functions/sessionSettle.js:78 `lateFeeCents` returns 0 whenever `session.cancelledBy !== session.clientUid`. I PROVED both writes against the emulator with the real rules file: `client writes cancelledBy = trainerUid on their own session` → ALLOWED, and `client cancels a completed session (completedAt set), blaming the trainer` → ALLOWED. (The existing 186-test suite passes but never tests cancelledBy attribution — firestore.rules.test.js:291 only ever writes cancelledBy: C1.)
```
**How it fails**
Weekly mode, $100 session delivered Wednesday; sessionsMarkCompleted stamps completedAt at 10:15am; it is due to charge Sunday 18:00 ET. On Thursday the client runs one updateDoc from the browser console with their own auth token: {status:'cancelled', cancelledBy:<trainerUid>, cancelledAt:Date.now()}. Sunday's sweep drops it from the completed branch (status is cancelled) and from the cancel branch (cancelledBy !== clientUid). $100 is never charged, no ledger row is written, no error is logged, and the trainer's Earnings view shows nothing missing. Repeatable for every session, and the pre-session variant erases every late-cancellation fee the same way (client cancels 1h out with cancelledBy=trainer → fee $0 instead of $100).

**Suggested fix**
In the client-update rule require `request.resource.data.get('cancelledBy','') == request.auth.uid` (and symmetrically bind the trainer rule to its own uid), and refuse a cancel once the session is delivered: `&& !('completedAt' in resource.data)`. Add both as emulator cases. Belt-and-braces server-side: in settleGroup, treat a session that has `completedAt` set as billable regardless of a later `status:'cancelled'`.

---

## [CRITICAL] Test-mode Stripe customer id is written into the shared `stripeCustomerId` field — every live charge for that client fails and is reported as a card decline
**functions/sessionBilling.js:79**

**Evidence**
```
`ensureCustomer` (sessionBilling.js:78-87) returns `profile.stripeCustomerId` if set, otherwise creates a customer with whatever key `stripeClient(profile)` picked (line 59-60: TEST key when `sessionBillingTest === true`) and writes it to `users/{uid}.stripeCustomerId` — the SAME field `billing.js` uses for live subscriptions (billing.js:226, 325). Nothing stamps or checks the mode. `billing.js` already learned this exact lesson and added `stripeLivemode` for referral credits (billing.js:331: "a later API call would use the live key against a test customer and 404 — looking like a missing customer rather than a mode mismatch"), but the session path never adopted it. `sessionSettle.js:253` picks the key off `client.sessionBillingTest` and `:259` passes `customer: client.stripeCustomerId` plus `payment_method: pm.id` — a test-mode `pm_…` saved by `recordSessionConsent` (sessionBilling.js:241-248). docs/SESSIONS-GO-LIVE.md:62 says to clear test customers in the Stripe Dashboard, which does nothing to the Firestore fields.
```
**How it fails**
Kevin rehearses billing with a real client flagged `sessionBillingTest: true`. That client had no prior subscription, so `ensureCustomer` mints a TEST customer `cus_T…` and persists it to their profile, alongside a test `pm_…`. Go-live: Kevin clears the flag. The next sweep runs `paymentIntents.create({ customer: cus_T…, payment_method: pm_… })` against the LIVE key → Stripe throws `resource_missing`. That throw lands in the catch at sessionSettle.js:271, so the ledger is written `status: "declined"`, every session in the batch is set `settled: "hold"`, `sessionBillingHold` is written to the client profile, and both sides are pushed "Your card was declined for $240.00 of training with Kevin" (`:283`). The client's card was never declined and never will be — $240 of delivered training is never collected, the client is locked out of further billing, and `paySessionBalance` repeats the identical failure forever. The same poisoned id also breaks that client's subscription checkout (billing.js:226 passes it to the live `checkout.sessions.create`).

**Suggested fix**
Before flipping live, for every profile that ever carried `sessionBillingTest`, delete `stripeCustomerId`, `sessionPaymentMethod` and `sessionBillingHold` and have the client re-save a card. Permanently: stamp `stripeLivemode` in `ensureCustomer` the way billing.js:331 does, and have `ensureCustomer` mint a fresh customer (rather than reuse) whenever the stored customer's mode does not match the key in use. Separately, treat `resource_missing`/`StripeInvalidRequestError` in sessionSettle.js:271 as a system error — release the claim and alert — not as a cardholder decline.

---

## [CRITICAL] A network/timeout failure on the sweep's PaymentIntent is recorded as a decline, and the Pay Now retry then charges the same amount a second time
**functions/sessionSettle.js:271**

**Evidence**
```
The sweep wraps `stripe.paymentIntents.create(...)` in `catch (e) { const code = (e && (e.decline_code || e.code)) || "charge_failed"; ... await ledgerRef.update({ status: "declined", ... }); ... sessions → settled:"hold"; users/{clientUid}.sessionBillingHold = {...}` (271-284). There is no discrimination between a `StripeCardError` (a real decline) and a connection reset / timeout / 5xx, where the PaymentIntent may already have been created and confirmed at Stripe. `paySessionBalance` then only short-circuits on `if (ledger.status === "succeeded")` (352-356) — a ledger stamped `declined` falls straight through to a second charge, deliberately with a fresh key: `{ idempotencyKey: `${ledgerRef.id}-retry-${Date.now()}` }` (388), justified by the comment at 383-387 ("Double-charge is instead prevented by the checks above"). Those checks only cover the case where the *response* was received. There is no webhook reconciling `payment_intent.succeeded` for session charges — grep for `glidna_sessions` finds it only on the SetupIntent in sessionBilling.js:137-138 — so a lost response is never
```
**How it fails**
Sunday 20:00 ET weekly sweep, one client, four sessions batched to $240.00. Stripe creates and confirms the PaymentIntent; the response is lost (connection reset, or the Cloud Run instance is torn down mid-await) and the SDK throws after exhausting its network retries. The catch stamps the ledger `declined`, marks the four sessions `settled:"hold"`, sets `sessionBillingHold`, and pushes the client "Card declined — action needed". The client's card was in fact charged $240.00. They open the app and tap Pay Now; `paySessionBalance` sees `ledger.status === "declined"`, creates a second PaymentIntent for $240.00 with a brand-new idempotency key, and it succeeds. The client is out $480.00 for $240.00 of training, and the ledger shows one successful charge.

**Suggested fix**
Before creating any retry PaymentIntent, query Stripe for an existing PaymentIntent carrying `metadata.ledgerId === ledgerRef.id` (or store the intent id before confirming) and treat a found `succeeded` intent as paid — lift the hold instead of charging. In the sweep's catch, only classify `e.type === 'StripeCardError'` as `declined`; anything else should set the ledger to a distinct `unknown`/`needs_reconcile` status that blocks both the automatic sweep and Pay Now until reconciled, and should not tell the client their card was declined.

---

## [CRITICAL] paySessionBalance has no lock — a second tap charges the card again
**functions/sessionSettle.js:388**

**Evidence**
```
`paySessionBalance` (line 330) reads the hold and ledger, checks only `ledger.status === "succeeded"` (line 352), then creates a PaymentIntent with a *deliberately unique* key: `idempotencyKey: \`${ledgerRef.id}-retry-${Date.now()}\`` (line 388). Nothing is written to Firestore between the read and the charge — no transaction, no `status:"processing"` claim on the ledger. `maxInstances: 5` (line 331) allows concurrent execution. The only guard is `payNowBusy` in React component state (src/App.jsx:20204), which is destroyed on reload.
```
**How it fails**
Client's weekly charge for 6 sessions at $80 declines → hold set for $480. Client taps "Pay now"; the call is slow (Stripe + 4 Firestore writes + 2 web-push sends). Nothing visibly happens, so they pull-to-refresh / force-quit and reopen the app — `payNowBusy` resets to false — and tap again. Both invocations read `ledger.status === "declined"`, both pass the guard, both create a PaymentIntent for 48000 with different idempotency keys. The client is charged $960 for $480 of training. The same happens with phone + laptop open simultaneously. Neither Stripe nor Glidna detects it; the second ledger write just overwrites `chargeId`.

**Suggested fix**
Claim the ledger transactionally before charging: in a `runTransaction`, re-read `sessionCharges/{ledgerId}` and only proceed if `status === "declined"`, flipping it to `retry_processing` with an attempt counter inside the same transaction. Then use that attempt counter in the idempotency key (`${ledgerId}-retry-${attempt}`) instead of `Date.now()`, so a duplicate invocation either loses the transaction race or reuses the same key and gets Stripe's cached result.

---

## [CRITICAL] Stripe network/API errors are treated as card declines, so the retry double-charges
**functions/sessionSettle.js:271**

**Evidence**
```
The sweep's charge is wrapped in a blanket `catch (e)` (line 271) that derives `const code = (e && (e.decline_code || e.code)) || "charge_failed"` and unconditionally writes `status: "declined"` on the ledger (274), `settled: "hold"` on every session (275), a `sessionBillingHold` on the client profile (277), and pushes "Card declined — action needed" to both parties (281). There is no distinction between a `StripeCardError` (the card really was refused) and a `StripeConnectionError` / `StripeAPIError` / rate-limit / 5xx, where the request may well have reached Stripe and created the charge. Nothing ever re-queries Stripe by `metadata.ledgerId`, and `functions/billing.js`'s `stripeWebhook` handles only `checkout.session.completed` and `customer.subscription.*` (lines 316, 343) — there is no `payment_intent.*` handler, so no webhook corrects the record either.
```
**How it fails**
Sunday 18:00 ET sweep charges a client $480. Stripe accepts and captures the PaymentIntent, but the HTTP response is lost (connection reset / Stripe 500 after commit / SDK timeout). The sweep marks the ledger `declined`, holds the account, and tells the client their card was declined. The client — whose statement will show $480 — taps "Pay now" to clear the hold; `paySessionBalance` sees `status === "declined"`, not `succeeded`, and issues a *new* PaymentIntent with a fresh idempotency key (line 388). $960 taken for $480 of training, with Glidna's own records asserting the first attempt failed.

**Suggested fix**
Before writing `declined`, check the error type: only `e.type === "StripeCardError"` is a real decline. For any other error, first call `stripe.paymentIntents.search({ query: \`metadata['ledgerId']:'${ledgerRef.id}'\` })` (or retry `paymentIntents.create` with the same `ledgerRef.id` idempotency key, which returns the original result) and treat a found succeeded intent as success. Otherwise mark the ledger `unknown`/`retry_pending` and leave the sessions claimed — never set a billing hold or send a "declined" notification on a non-card error.

---

## [CRITICAL] A Firestore failure AFTER a successful charge is recorded as a decline, and Pay Now then charges the card a second time
**functions/sessionSettle.js:256**

**Evidence**
```
The `try` at sessionSettle.js:256 wraps the PaymentIntent creation AND the three follow-up writes: `ledgerRef.update({status:"succeeded"})` (:264), the per-session `settled:"charged"` updates (:265) and `notifyBoth` (:267). The catch at :271 does not distinguish a Stripe card error from a Firestore/network error — it unconditionally writes `status: "declined"` over the ledger, sets the sessions to `settled: "hold"`, and sets `sessionBillingHold`. `paySessionBalance` then only short-circuits on `ledger.status === "succeeded"` (:352) and deliberately uses a fresh per-attempt idempotency key (`${ledgerRef.id}-retry-${Date.now()}`, :388) with the comment that a stable key would block legitimate retries. Nothing checks Stripe for an existing successful PaymentIntent carrying `metadata.ledgerId`.
```
**How it fails**
Sunday sweep charges a client $320 for the week; Stripe succeeds and the money leaves their account. `ledgerRef.update` at :264 then fails on a transient Firestore error (the function has already run 5 Firestore round-trips and one network call). The catch fires: ledger flips to `declined`, sessions to `hold`, the client is put on billing hold and pushed "Your card was declined for $320.00". The client taps Pay Now on that banner; `paySessionBalance` sees `status !== "succeeded"`, creates a second PaymentIntent for $320 with a new idempotency key, and it succeeds. The client is charged $640 for one week of training, with no record in the ledger that the first $320 was ever taken.

**Suggested fix**
Move everything after `paymentIntents.create` out of the try, or set a `chargeSucceeded` marker immediately after the create and have the catch re-check it before declaring a decline. In `paySessionBalance`, before creating a new intent, list Stripe PaymentIntents for the customer and abort if one already exists with `metadata.ledgerId === hold.ledgerId` and status `succeeded`/`processing`.

---

## [CRITICAL] A charge that succeeded is recorded as a decline — and "Pay now" then charges the card a second time
**functions/sessionSettle.js:264**

**Evidence**
```
The post-charge bookkeeping lives INSIDE the same try that creates the PaymentIntent (sessionSettle.js:256-270): `paymentIntents.create(...)` at :257, then `ledgerRef.update({status:"succeeded"...})` at :264, the per-session `settled:"charged"` writes at :265, and `notifyBoth` at :267. Any throw after :263 lands in the catch at :271, which unconditionally treats it as a card decline: ledger → `status:"declined"` (:274), sessions → `settled:"hold"` (:275), client profile → `sessionBillingHold` (:277-279), and both sides are pushed "Your card was declined for $X" (:281-283). `paySessionBalance` then re-charges: it only short-circuits when the ledger says `succeeded` (:352) or the hold is gone (:338) — neither is true here — and it deliberately uses a fresh per-attempt idempotency key `${ledgerRef.id}-retry-${Date.now()}` (:388), so Stripe has no way to collapse it into the first charge. Nothing reconciles against Stripe afterwards: billing.js's webhook handles subscription events only, there is no `payment_intent` handler for `purpose: "glidna_sessions"`.
```
**How it fails**
Sunday sweep batches a client's week: 4 sessions × $120 = $480. `paymentIntents.create` succeeds and Stripe captures $480. The very next line, `ledgerRef.update(...)`, fails (a Firestore write blip, an instance eviction, or a NOT_FOUND on one of the session docs in the Promise.all at :265). Execution jumps to the catch: the ledger is stamped `declined`, the client is put on `sessionBillingHold`, and both Kevin and the client are told the card was declined. The client opens the banner and taps "Pay now" → `paySessionBalance` sees a non-succeeded ledger and a live hold, creates a second PaymentIntent with a brand-new idempotency key, and Stripe captures $480 again. The client has paid $960 for one week of training, the ledger says one of those charges never happened, and there is no code path that will ever notice.

**Suggested fix**
Move everything after `paymentIntents.create` out of the try (or wrap only the create call), so a bookkeeping failure can never be classified as a decline — record the intent id first, then update. In the catch, distinguish a real card decline (`e.type === 'StripeCardError'` / `e.decline_code`) from any other error; only card declines should set `sessionBillingHold` and send the "declined" notification — an API/validation/network error should leave the ledger `pending` for retry, not accuse the client. In `paySessionBalance`, before creating a new intent, list PaymentIntents by `metadata.ledgerId` (or store the intent id on the ledger at creation time and retrieve it) and treat an existing `succeeded` one as paid. Add a reconciliation pass or a `payment_intent.succeeded` webhook for `purpose: "glidna_sessions"`.

---

## [CRITICAL] The cancellation warning uses the trainer's CURRENT policy, but billing uses the frozen consent snapshot — a client told "no charge" is charged the full session price
**src/App.jsx:23426**

**Evidence**
```
SessionsPanel loads the policy from the trainer's live profile — `getProfile(trainerUid).then((p) => { const pol = policyOf(p); setPolicy(pol); ... })` (src/App.jsx:23278) — and every cancel warning is computed from it: `const fee = lateCancelFeeCents(s, policy, meUid, now);` (23426), the "In time — no cancellation charge." line (23428-23430), the button label (23441), and the always-on "Cancellation policy" card (`cancellationDisclosure(policy, …)`, 23484). The settle dispatcher never reads the trainer's current policy for fees: `const consent = await latestConsent(db, clientUid, trainerUid); const feePolicy = consent && consent.policy ? policyOf(consent.policy) : null;` (functions/sessionSettle.js:173-174), and `latestConsent` returns the newest `users/{uid}/sessionConsents` doc (103-109), which snapshots the policy as it stood when the card was saved (functions/sessionBilling.js:218-237). Nothing re-prompts a client for consent when `saveSessionPolicy` (src/sessions.js:505-507) rewrites the trainer's policy, so the two objects diverge permanently after the first policy edit. Terms
```
**How it fails**
January: client saves a card while the trainer's policy is `{cancelType:'window', cancelWindowHours:24, lateCancelChargePct:100}`; that is snapshotted into the consent doc. March: the trainer softens to `cancelType:'anytime'` ("Free cancellation any time", a first-class option in CANCEL_TYPES). No new consent is written. April: the client cancels a $100.00 session one hour before it starts. The panel evaluates `lateCancelFeeCents` against the current `anytime` policy, returns 0, and displays "In time — no cancellation charge"; the policy card says "Cancel any time at no charge." The client taps "Yes, cancel". The next sweep prices the cancel under the January consent (window/100%) and charges the card $100.00 for a cancellation the app promised was free — a dispute the client wins on the screenshot alone. The mirror case loses the trainer money instead: trainer tightens `anytime` → `window 48h / 100%`, client cancels 2h out, UI warns "$100.00", the sweep applies the old `anytime` consent, `lateFeeCents` returns 0, the session is marked `settled:"waived"` and the trainer is silently paid $0 of the $100 the client was told they owed.

**Suggested fix**
Make one policy object govern both. Load the client's latest consent snapshot into SessionsPanel and compute every fee warning, the button label and the disclosure card from `consent.policy` (falling back to the trainer's current policy only when no consent exists, i.e. no card yet), so the number shown is the number charged. Additionally, when a trainer saves a policy that differs from what a client consented to, flag that client as needing re-consent and prompt them before their next charge.

---

## [HIGH] A client can cancel an already-completed session, converting a delivered session into a free (or garbage-evidenced) cancellation
**firestore.rules:329**

**Evidence**
```
The client update rule requires only `changed().hasOnly(clientCancelFields())`, `identityIntact()`, `cancelStampHonest()`, and `request.resource.data.status == 'cancelled'`. Nothing checks that `startAt` is in the future or that `completedAt` is absent — `cancelStampHonest()` (line 281) pins `cancelledAt` to server time, which *guarantees* the stamp lands after the session ended, and `completedAt` is not in `changed()` so `hasOnly` does not block it. The settle dispatcher then routes the doc away from the session path: `doneSnap` drops it (`v.status !== "cancelled"`, line 125) and `cancSnap` picks it up as `kind: "cancel"` (line 126), priced by `lateFeeCents` (line 77) rather than `priceCents`. `isLateCancel` returns false for `cancelType === "anytime"` (line 73), and the trainer UI offers exactly that as a first-class option (src/App.jsx:23596, `CANCEL_TYPES.anytime`).
```
**How it fails**
Trainer runs `cancelType: "anytime"` ("Free cancellation any time") in weekly mode. Client attends five $100 sessions Mon–Fri. On Saturday, before the Sunday sweep, they issue five `updateDoc(doc(db,'sessions',id), {status:'cancelled', cancelledBy: myUid, cancelledAt: Date.now(), updatedAt: Date.now()})` calls from the Firebase SDK — all accepted by the rules. Sunday's sweep computes `lateFeeCents` = 0, marks each `settled: "waived"` (line 186), and charges $0. Five delivered sessions, $500, free. Under Kevin's current 100% default the dollar total happens to match, but the ledger records them as `kind: "late_fee"` and `evidenceSummary` (line 84) computes `hrs = (startAt - cancelledAt)/3600000` as a negative number, producing dispute evidence that reads "cancelled … — -96.5h notice, i.e. 120.5h inside the window" — self-contradictory text that would lose a chargeback.

**Suggested fix**
Add a rule guard to the client (and trainer) update blocks: a cancellation is only accepted while the session is still in the future — e.g. `&& resource.data.startAt > request.time.toMillis()` and `&& !('completedAt' in resource.data)`. Belt-and-braces server side: in `settleGroup`, treat a cancel whose `cancelledAt > startAt` as a delivered session (bill `priceCents`), never as a cancellation.

---

## [HIGH] A client can cancel a session that is in progress or already over, and the sweep bills it as a cancellation instead of a completed session
**functions/sessionSettle.js:126**

**Evidence**
```
Nothing rejects a cancellation of a past session. The client update rule requires only participant + `status == 'cancelled'` + `cancelStampHonest()` (firestore.rules:328-333); there is no comparison of `resource.data.startAt` to `request.time`. `cancelSession` just writes `status:'cancelled', cancelledAt: Date.now()` (src/sessions.js:63-71). The completion sweep then declines to stamp it — `if (s.completedAt || s.status === "cancelled") { skipped++; return; }` (functions/sessions.js:42) — and the settle dispatcher routes it to the cancel branch, which wins even over an already-stamped session: completed candidates are filtered by `if (!v.settled && v.status !== "cancelled")` (sessionSettle.js:125) while cancels are taken by `if (!v.settled && v.status === "cancelled" && v.cancelledBy === v.clientUid)` (126). Pricing is then `lateFeeCents` → `session.startAt - session.cancelledAt < policy.cancelWindowHours * 3600000` (71-81) — a negative notice period is simply "late", and under `cancelType:'anytime'` `isLateCancel` returns false (73) so the fee is 0. The UI window is real, not just a
```
**How it fails**
Trainer's policy is `{cancelType:'window', cancelWindowHours:24, lateCancelChargePct:50}`. Tuesday 9:00-10:00 AM session, `priceCents: 10000` ($100.00). The client shows up and trains. At 9:55 AM — still "upcoming" because `isPastSession` keys on the 10:00 end time — they open Sessions, tap Cancel session, see "Late cancellation — your trainer charges $50.00", and confirm. The 10:15 completion sweep skips the doc because `status === 'cancelled'`, so `completedAt` is never stamped; the settle dispatcher picks it up as `kind:"cancel"` and charges $50.00 for a session that was delivered in full. The trainer is short $50.00 with no record that the session happened. If the trainer instead offers "Free cancellation any time" (`cancelType:'anytime'`), the same tap yields `lateFeeCents` = 0, the session is written `settled:"waived"` (sessionSettle.js:186), and a delivered $100.00 session bills $0.00. The stored dispute evidence makes it worse: `evidenceSummary` renders `hrs` from `startAt - cancelledAt`, printing a negative notice period (e.g. "-0.9h notice") on the one record intended to defend the charge.

**Suggested fix**
Reject the cancel server-side once the session has started: add `request.resource.data.startAt > request.time.toMillis()` to the client cancel rule in firestore.rules (and to the trainer branch, or allow trainers a separate explicit waive path). Defensively, in `settleGroup` treat any candidate whose `cancelledAt >= startAt` as a completed session billed at `priceCents`, not as a cancellation.

---

## [HIGH] The governing consent is chosen by recency, not by the session's date — a later policy edit plus a routine card update re-prices an already-cancelled session
**functions/sessionSettle.js:103**

**Evidence**
```
`latestConsent` scans `users/{clientUid}/sessionConsents` for this trainer and returns whichever doc has the greatest `agreedAt` — `snap.forEach((d) => { const v = d.data(); if (!best || (v.agreedAt || 0) > (best.agreedAt || 0)) best = v; })` (103-109) — with no comparison against `session.startAt`, `session.cancelledAt` or `session.createdAt`. `settleGroup` then prices every unsettled item in the group under that one snapshot (173-185). Because settlement is deferred (weekly groups skip every run until `awaiting-sunday`, 169; no-card groups are released back to unsettled at 246-249; held groups are skipped at 170), a new consent can easily be written in between: `recordSessionConsent` appends a fresh snapshot of the trainer's CURRENT policy on every card save (functions/sessionBilling.js:218-237, `agreedAt: now`), and a card update is a routine event. The file header claims the opposite — "so a policy edit can never retroactively re-price a booking" (13-15) — and Terms §6 promises "A change your trainer later makes to their policy does not, by itself, change the terms you already ag
```
**How it fails**
Trainer's policy in January is `{cancelWindowHours:24, lateCancelChargePct:25}`; the client consents. Monday Jun 1: the client cancels a $200.00 session 3 hours out. The panel warns "$50.00" (25%); `billingMode` is `weekly`, so the sweep marks the group `awaiting-sunday` all week. Wednesday Jun 3: the trainer raises `lateCancelChargePct` to 100. Thursday Jun 4: the client's card expires and they re-save it — `recordSessionConsent` appends a new consent snapshotting the 100% policy. Sunday Jun 7: the sweep calls `latestConsent`, gets the Jun 4 doc, and charges $200.00 instead of the $50.00 the client was shown at the moment they cancelled — a $150.00 retroactive overcharge produced by the client doing exactly what the app asked (keeping a valid card on file).

**Suggested fix**
Select the consent that was in force for the item, not the newest one: choose the snapshot with the greatest `agreedAt` that is `<= (session.cancelledAt || session.startAt || session.createdAt)`, and fall back to no-fee when none exists. Better still, freeze the fee terms onto the session document at booking time and price from that copy, so settlement never depends on a later document at all.

---

## [HIGH] The sweep's 200-doc query cap counts already-settled sessions, so once ~200 sessions land in a 30-day window billing silently stops
**functions/sessionSettle.js:120**

**Evidence**
```
Both candidate queries are capped and unordered: `db.collection("sessions").where("completedAt", ">", now - LOOKBACK_MS).limit(MAX_PER_RUN).get()` and the same for `cancelledAt` (120-123), with `LOOKBACK_MS = 30 * 86400000` and `MAX_PER_RUN = 200` (55-56). Firestore orders an inequality query by that field ascending when no `orderBy` is supplied, so `limit(200)` returns the 200 OLDEST `completedAt` values in the window. The `settled` filter is applied in JS only AFTER the query — `doneSnap.forEach((d) => { const v = d.data(); if (!v.settled && v.status !== "cancelled") ... })` (125) — as the comment at 118-119 acknowledges ("`settled` can't be queried for 'missing', so it's filtered in code"). Settled sessions therefore consume the limit. The query is also not scoped to a trainer or client, so it is a platform-wide 200. When the oldest 200 are all settled, `candidates.size` is 0 and `runSettle` returns `{groups:0, ...}` (127) with no error and no log line beyond the summary at 148.
```
**How it fails**
Kevin reaches roughly 7 sessions/day (10 clients × ~5 sessions/week is ~215/month) — normal growth for a full-time trainer, and reachable sooner once a second allowlisted trainer exists, since the query spans all trainers. From that point every hourly run fetches the same 200 oldest `completedAt` documents in the trailing 30 days, all of which are already `settled:"charged"`, filters them all out, and returns "0 groups". Newly completed sessions are never in the result set, so they are never claimed and never charged. Nothing surfaces this: no error is thrown, the Earnings ledger simply stops gaining rows, and `earningsSummary` (src/sessions.js:534) has nothing to count because no `sessionCharges` doc is ever created. A week of training — say 35 sessions at $80 = $2,800.00 — silently never bills, and any of it that ages past the 30-day lookback can never be recovered by the sweep.

**Suggested fix**
Stop letting settled documents consume the limit. Write an explicit `settled: "unsettled"` sentinel on every session at creation and query `where('settled','==','unsettled')` (equality + `completedAt` range, one composite index), or page the query with a cursor until fewer than `MAX_PER_RUN` documents remain. Either way, log loudly when a run returns exactly `MAX_PER_RUN` documents, since that is the signal that work is being dropped.

---

## [HIGH] Unsettled sessions permanently fall out of billing after 30 days — a declined client or a removed card silently costs the trainer everything older than the window
**functions/sessionSettle.js:55**

**Evidence**
```
The only path that bills is `runSettle`, and its candidate window is fixed: `const LOOKBACK_MS = 30 * 86400000;` (55), applied as `where("completedAt", ">", now - LOOKBACK_MS)` (121). `completedAt` is stamped as the session's actual end time (`completedAt: endMs`, functions/sessions.js:46), so it does not move. Sessions routinely sit unsettled for long stretches by design: a declined card sets `users/{clientUid}.sessionBillingHold` (277-279) and every subsequent run then bails at `if (client.sessionBillingHold) return { outcome: "skipped", why: "existing-hold" };` (170) for the WHOLE group, including sessions delivered after the decline; and a client with no card has their claim released back to unsettled — `settled: null, settledAt: null, ledgerId: null` (247) — with the comment at 16-17 promising "It is picked up automatically once a card exists." That promise is only true inside the 30 days. Booking is never blocked while a hold is open, so sessions keep accruing. There is no aging/arrears report; `earningsSummary` (src/sessions.js:534-560) sums only `sessionCharges` documents, an
```
**How it fails**
A client's card declines on Sunday Jun 7 for a $160.00 batch. `sessionBillingHold` is set and every hourly run from then on skips the entire trainer↔client group. The client keeps training twice a week at $80.00 while ignoring the emails. On Jul 20 they finally tap Pay Now and clear the held ledger, and the hold lifts. The sweep resumes — but only for sessions whose `completedAt` is after Jun 20. The twelve sessions delivered Jun 8 through Jun 19, $960.00 of real training, are outside `completedAt > now - 30d`, remain `settled: null` forever, and are never charged. Nothing in the app tells Kevin: the Earnings screen shows no pending row for them because no ledger document was ever written. The same cliff hits any client who removes their card (removeSessionCard, functions/sessionBilling.js:264) and re-adds it more than 30 days later.

**Suggested fix**
Do not use a rolling time window as the definition of what is billable. Query on an explicit unsettled sentinel field with no date bound (paged), or raise the lookback well past any realistic hold and add a scheduled arrears report that surfaces every session older than N days still carrying `settled: null` to the trainer and to admin, so nothing can age out unnoticed.

---

## [HIGH] Sessions claimed as `settled:"processing"` have no recovery path; a 60s timeout strands them unbilled forever
**functions/sessionSettle.js:220**

**Evidence**
```
The claim transaction writes `settled: "processing"` (line 220) before any Stripe call. Every later candidate query filters on `!v.settled` (lines 125-126), so a `processing` session is excluded from every future sweep. There is no reaper, no age-based re-claim, and no query for `settled == "processing"` anywhere in `functions/`. `runSettle` iterates groups sequentially in a plain `for` loop (line 137) and `sessionsSettle` declares no `timeoutSeconds` (lines 302-305), so it runs on the Cloud Functions v2 default of 60 seconds. Each group does: 2 profile reads, a consent query, a multi-doc transaction, a Stripe API call, and two `sendPushTo` calls — comfortably 2-4s per client.
```
**How it fails**
Weekly mode, Sunday 18:00 ET. Kevin has 18 clients settling in one batch (this is the one moment everything happens at once). At ~3.5s per group, the instance is killed at 60s partway through client #17. That client's transaction already committed — their 5 sessions are `settled: "processing"` with `ledgerId` set — but the Stripe call never ran. The 19:00 run re-queries: `!v.settled` is false for all 5, so they are invisible. $400 of delivered training is never charged, ever, and the only trace is a ledger row stuck at `pending`. The same permanent strand occurs on any instance eviction or on a throw at lines 253-254 (`require("stripe")(stripeKey)` sits *outside* the try block, so a missing/misnamed live secret on the very first live run strands every group it reaches).

**Suggested fix**
Two changes: (a) set `timeoutSeconds: 540` on `sessionsSettle` and cap groups per run; (b) add a reclaim step at the top of `runSettle` that queries `sessions where settled == "processing" and settledAt < now - 15min`, looks up the named ledger, checks Stripe for a PaymentIntent with that `ledgerId` in metadata, and either finalizes it as charged or releases the sessions back to `settled: null` for the next sweep. Also move the `require("stripe")(stripeKey)` construction inside the try/catch.

---

## [HIGH] The 200-doc global candidate cap is consumed by sessions that can never settle, silently stopping all billing
**functions/sessionSettle.js:120**

**Evidence**
```
The candidate queries are global across the whole `sessions` collection with no trainer filter: `where("completedAt", ">", now - LOOKBACK_MS).limit(MAX_PER_RUN)` (line 121) and the matching `cancelledAt` query (line 122). A range filter with no explicit `orderBy` gets an implicit ascending sort on that field, so these return the 200 *oldest* candidates in the 30-day window. Groups that can never bill return before writing anything: `if (!canBillSessions(trainerUid)) return { outcome: "skipped" }` (line 165) and `if (trainerPolicy.billingMode === "manual") return ...` (line 168). Because they are never stamped `settled`, they stay unsettled and re-qualify as candidates on every run for a full 30 days. Booking is deliberately open to every trainer (functions/sessionBillingGate.js:18-24), and only Kevin's UID is allowlisted (line 30).
```
**How it fails**
Six other trainers sign up and book normally — ~35 completed sessions each per month = 210 permanently-unsettleable candidates, all older than Kevin's current week. The ascending 200-row window fills entirely with their sessions. `settleGroup` skips all of them as `billing-not-enabled`, and Kevin's sessions are never in `candidates` at all. Every completed session Kevin delivers from that day on — say $2,400/week — is silently never charged. The only signal is a log line reading `{groups: 6, charged: 0, skipped: 6}`; the Earnings screen simply shows nothing new, which looks identical to a quiet week.

**Suggested fix**
Filter the candidate queries to billable trainers (`where("trainerUid", "in", SESSION_BILLING_UIDS)`, adding the composite index), or stamp non-billable candidates with a terminal marker (`settled: "not_billable"` / `settled: "manual"`) so they drop out of the window permanently. Additionally, log and alert when a run returns exactly `MAX_PER_RUN` candidates — hitting the cap should never be silent.

---

## [HIGH] Completed sessions age out of the 30-day lookback and are never billed, despite the code promising otherwise
**functions/sessionSettle.js:55**

**Evidence**
```
`LOOKBACK_MS = 30 * 86400000` (line 55) bounds both candidate queries (`completedAt > now - LOOKBACK_MS`, line 121). Two skip paths leave sessions unsettled and aging: `if (client.sessionBillingHold) return { outcome: "skipped", why: "existing-hold" }` (line 170), which fires *before* any claim so newly completed sessions are simply left alone; and the no-card release, which writes `settled: null` back onto every claimed session (line 247). Nothing re-widens the window and nothing records the aged-out sessions as owed. `paySessionBalance` only settles `ledger.sessionIds` (line 397) — the sessions named in the one held ledger — so it does not sweep up anything that accumulated during the hold. The file's own header comment (lines 16-17) states "the session simply stays unsettled. It is picked up automatically once a card exists," which is only true for 30 days.
```
**How it fails**
Client's card declines on Aug 2 for the prior week → `sessionBillingHold` set. They keep training 2x/week at $85 while ignoring the emails. Every hourly run returns `skipped: existing-hold`, so none of the new sessions are ever claimed. They finally replace the card and pay the held balance on Sep 10 (39 days later). The hold lifts, but the eight sessions delivered Aug 3–11 now have `completedAt` older than 30 days and no longer match the candidate query. $680 of delivered training is never charged, never appears in Earnings, and there is no record anywhere that it is owed.

**Suggested fix**
Do not bound the candidate query by a fixed lookback for *unsettled* work — either widen `LOOKBACK_MS` substantially (e.g. 365 days) with pagination, or add an explicit `settled == null` index and query on that instead of a time range. At minimum, add a daily check that counts unsettled sessions older than the lookback and pushes/logs an alert to the trainer, so aged-out revenue is visible rather than vanishing.

---

## [HIGH] Unsettled sessions silently fall out of the 30-day sweep window and are never billed
**functions/sessionSettle.js:55**

**Evidence**
```
`LOOKBACK_MS = 30 * 86400000` (:55) bounds both candidate queries (`completedAt > now - LOOKBACK_MS`, :121-122), so a session older than 30 days can never re-enter the sweep. Two normal states park sessions outside settlement for weeks: `if (client.sessionBillingHold) return { outcome: "skipped", why: "existing-hold" }` (:170) blocks the whole client until the hold is cleared, and the no-card path (:246-250) releases the claim back to unsettled with no deadline. Nothing surfaces the backlog: `sessionCharges` only gets a ledger when a settle actually runs, and `earningsSummary` (src/sessions.js:534) reads only that ledger, so the trainer's Earnings view shows nothing owed. There is no alert on the skip counts (`:148` logs to Cloud Logging only).
```
**How it fails**
A client's card is declined for $150 on Aug 2, setting `sessionBillingHold`. They keep training 3×/week at $80 while ignoring the banner. Every hourly run returns `skipped: existing-hold`, so nothing from August or September is ever priced. On Sept 20 they finally pay the $150 through Pay Now and the hold lifts. The next sweep queries `completedAt > Aug 21` — every session from Aug 2 to Aug 20 (about 8 sessions, $640) is now outside the window and will never be a candidate again. Kevin loses $640 with no error, no ledger row, and nothing on screen. The same happens with zero drama if a client simply removes their card (Terms §6 tells them removing it stops future charges) and re-adds it 5 weeks later.

**Suggested fix**
Do not scope the sweep by `completedAt` recency. Query on the billing state instead (e.g. an indexed `settled` sentinel value written at booking, or a `settleDueAt` field) so an unsettled session stays a candidate until it reaches a terminal state, and surface an "unbilled backlog" figure to the trainer plus an alert when the hold or no-card state exceeds ~14 days.

---

## [HIGH] `noShowChargePct` is disclosed to the client and frozen into their consent, but the settle path never applies it — no-shows are always billed at 100%
**functions/sessionSettle.js:182**

**Evidence**
```
`cancellationDisclosure` renders "Not showing up for a booked session is charged {noShowChargePct}% of the session price" (src/sessions.js:389-390), that line goes into `policySnapshot.shownText` (src/sessions.js:429), and `recordSessionConsent` stores `noShowChargePct` in the consent record (functions/sessionBilling.js:98). Terms §6 repeats it: "a notice window and a fee (a percentage of the session price) for cancelling late or not showing up". But `settleGroup` prices every non-cancelled item as `cents: Math.max(0, Number(s.priceCents) || 0)` (sessionSettle.js:182) — full price. `noShowChargePct` is read into the policy object at :67 and then never referenced again anywhere in the repo (only definition, clamping and display sites exist).
```
**How it fails**
Kevin sets a 50% no-show fee to be reasonable. A client books a $120 session and doesn't turn up. `sessionsMarkCompleted` stamps `completedAt` when the end time passes (functions/sessions.js:45-48) exactly as if it had been delivered, and the Sunday sweep bills the full `priceCents`. The client is charged $120 after being shown, and consenting to, "charged 50% of the session price" — a $60 overcharge on terms they can produce from their own consent record.

**Suggested fix**
Either apply `noShowChargePct` (which requires a way to mark a completed session as a no-show, since nothing distinguishes them today), or remove the field and its disclosure line from src/sessions.js:389-390, the policy editor and Terms §6 so the client is never told about a fee percentage the system cannot honour.

---

## [HIGH] An off-session charge that needs 3DS is an unrecoverable dead end — the client can never clear the hold and the balance is never collected
**functions/sessionSettle.js:390**

**Evidence**
```
The sweep charges with `off_session: true, confirm: true` (:260). When the issuer demands authentication Stripe raises a card error with code `authentication_required`, which the catch at :271 treats as a decline: hold set, both sides told the card was declined. The client's only remedy is Pay Now, which confirms on-session with a `return_url` (:373-388) — but when the intent comes back `requires_action` the function just returns `{ ok: false, pending: true, status }` (:390-392) and discards `pi.next_action`. Nothing in the app can complete the authentication: sessionBilling.js:24-26 states "no publishable key ships in the bundle", so there is no Stripe.js to run the challenge and no redirect is ever performed. The UI maps `d.pending` to "Your bank needs to verify this — tap Update card to finish" (src/App.jsx:20215), which only re-runs card setup. There is also no webhook to catch a later resolution: billing.js:316-344 handles only `checkout.session.completed` and `customer.subscription.*` — no `payment_intent.*` event is consumed anywhere in functions/.
```
**How it fails**
A client's issuer (common for non-US cards, and increasingly for larger US amounts) requires authentication on the merchant-initiated charge. Sunday's $320 charge throws `authentication_required` → hold + "card declined" push. The client taps Pay Now: a new intent returns `requires_action`, the function returns `pending`, and the app tells them to update their card. They re-save the same card and try again — identical result, forever. The $320 is uncollectable through the product, the client stays locked in a billing hold, and Kevin sees only a `declined` row in Earnings.

**Suggested fix**
Return `pi.next_action.redirect_to_url.url` (or the client secret plus a publishable key and Stripe.js) from `paySessionBalance` and send the browser there, then reconcile on return and via a `payment_intent.succeeded`/`payment_intent.payment_failed` webhook. Until that exists, special-case `authentication_required` in the sweep so the client is told to complete a payment rather than that their card was declined.

---

## [HIGH] `noShowChargePct` is never applied — a no-show is billed at 100% of the session price no matter what the policy says
**functions/sessionSettle.js:182**

**Evidence**
```
A no-show is just a session nobody cancelled, so `sessionsMarkCompleted` stamps `completedAt` (sessions.js:45-49) and settle prices it as `Math.max(0, Number(s.priceCents) || 0)` — the full booked price (sessionSettle.js:182). `noShowChargePct` is parsed into the policy (sessionSettle.js:67, sessionBilling.js:98) and displayed (src/sessions.js:389-391: "Not showing up for a booked session is charged N% of the session price"), but is referenced by zero lines of billing arithmetic anywhere in functions/. public/terms.html §6 repeats the promise: "a notice window and a fee (a percentage of the session price) for cancelling late or not showing up." There is also no way to correct it: the trainer's Reschedule and Cancel buttons are rendered only for `!opts.past` sessions (src/App.jsx:23410-23443, past rows rendered with `{past:true}` at :23766), so a completed session's price cannot be edited or waived from the UI before the sweep bills it.
```
**How it fails**
Kevin sets `noShowChargePct: 50` in the policy editor. The client reads on their Sessions screen and agrees at card setup that "Not showing up for a booked session is charged 50% of the session price." The client no-shows a $100 session. The 15-minute sweep stamps `completedAt`; Sunday's settle charges the card $100, not the $50 that was disclosed and consented to — a 100% overcharge against the app's own written terms, with no trainer control to reduce or waive it. With `noShowChargePct: 0` the disclosure line is suppressed entirely (src/sessions.js:389) and the client is still charged the full $100 for a session they never attended.

**Suggested fix**
Either implement the field — give the trainer a "mark no-show" action on past sessions that stamps `noShow: true`, and price those at `round(priceCents * noShowChargePct / 100)` from the consent snapshot's policy — or remove `noShowChargePct` from the policy editor, `cancellationDisclosure`, and terms.html §6 so nothing promises a percentage the engine does not honour. Either way, add a trainer-side waive/re-price action for completed-but-unsettled sessions.

---

## [HIGH] A $0-priced session is claimed and left in `settled:"processing"` forever — pricing it afterwards can never bill it
**functions/sessionSettle.js:238**

**Evidence**
```
Zero-price sessions are not filtered out: line 182 pushes `{cents: 0}` into `billable`, and `billable.length` is non-zero so the group proceeds past the `nothing-billable` guard at :193. In the transaction the item goes to `toCharge` and each such session is written `settled: "processing"` (:220). Back outside, `claim.amountCents === 0` short-circuits at :238 and returns `packageOnly` — it never advances those sessions past `"processing"` and never charges. Because every later candidate scan filters on `!v.settled` (:125-126) and `"processing"` is truthy, the session is permanently invisible to billing. There is no reaper for `processing`. The booking form makes $0 the default: `defaultPriceCents` is never passed by any caller (its only references are src/App.jsx:23242, 23344, 23665, 23671), so the price field always opens blank and `Math.round((Number("") || 0) * 100)` = 0 (:23355). The same path also pushes a nonsense notification to both sides — "Your prepaid package covered 0. No card charge." (:240-241) — with `covered.length === 0`, and writes a ledger row labelled `covered_by_
```
**How it fails**
Kevin books an $80 session and leaves the price field blank (it opens empty on every booking). The session is delivered; within 15 minutes `completedAt` is stamped; within the hour the sweep claims it, marks it `settled: "processing"`, files a $0 "covered by package" ledger row, and pushes "Your prepaid package covered 0 sessions" to a client who has no package. Kevin notices the missing price and edits the session to $80 — the session is already claimed, so no future sweep will ever see it. $80 of delivered training is silently uncollectable, and the Earnings ledger shows a covered-by-package row instead of a missing charge.

**Suggested fix**
Skip zero-cents items when building `billable` (`if (cents <= 0) { mark settled:"free"; continue; }`) so a free session reaches a terminal state without consuming a claim or a credit, and never fabricates a package notification. Separately, only send the package notification when `covered.length > 0`, and default the booking form's price to the trainer's last-used session price (or require an explicit price/"free" choice) rather than silently 0.

---

## [HIGH] The settle queries return the 200 oldest docs in a 30-day window with no `settled` filter and no trainer scoping, so real sessions get crowded out
**functions/sessionSettle.js:121**

**Evidence**
```
`db.collection("sessions").where("completedAt", ">", now - LOOKBACK_MS).limit(MAX_PER_RUN)` (:121, and the identical cancelled query at :122) carry an implicit ascending orderBy on the inequality field, so each run fetches the 200 OLDEST matching docs — and `settled` is not part of the query (it is filtered in JS at :125-126, after the limit has already been applied). The query is also collection-wide across every trainer; booking is deliberately open to all trainers (sessionBillingGate.js: "BOOKING ... free for every trainer"), and a non-allowlisted trainer's sessions are only rejected later, inside `settleGroup` (:165), so they are never written to and stay unsettled for their full 30-day life while occupying query slots on every run. `LOOKBACK_MS` is a hard 30-day cliff (:55): once a session's `completedAt` falls outside it, no run will ever see it again.
```
**How it fails**
Kevin bills ~150 sessions a month; two other trainers use the free scheduling for another ~150 between them, none of which are ever settled or stamped. The `sessions` collection now holds ~500 docs with `completedAt` inside 30 days, of which the 200 oldest — mostly already-settled Kevin sessions and permanently-unsettled other-trainer sessions — are all the sweep ever sees. A session Kevin delivers today is not returned by the query until roughly 200 docs older than it have aged out, i.e. ~18 days later; in weekly mode that is the third Sunday after the session. If growth continues, or one weekend's runs are missed, the session crosses the 30-day cutoff and is never charged, with no ledger row and no log line to reveal it. Kevin's revenue quietly stops arriving with nothing on any screen saying so.

**Suggested fix**
Scope and filter the query: add `.where("trainerUid", "in", SESSION_BILLING_UIDS)` (or iterate allowlisted trainers) and index `settled` so unsettled docs can be selected directly (e.g. write `settled: "none"` at booking time and query `where("settled","==","none")`), with a composite index. Order descending or paginate rather than truncating at 200, and log/alert whenever a run hits `MAX_PER_RUN` or a session ages past ~21 days unsettled.

---

## [HIGH] An already-delivered session can still be cancelled, and settle treats `status:"cancelled"` as authoritative over `completedAt`
**functions/sessionSettle.js:125**

**Evidence**
```
The candidate builder drops any completed session whose status is cancelled — `if (!v.settled && v.status !== "cancelled")` (:125) — and re-prices it as a cancellation instead (:126, :183-185). The rules place no time bound on cancelling: the client update rule (firestore.rules:327-333) requires only `status == 'cancelled'`, honest `cancelledAt`, and intact identity; `completedAt` is not consulted, and the trainer rule (:317-326) is the same. So a session that has been delivered and stamped `completedAt` remains cancellable right up to the moment it settles — a whole week in weekly mode. `isLateCancel` (:71-76) computes `startAt - cancelledAt`, which is negative for a post-hoc cancel, so it lands in the late branch and the fee is `lateCancelChargePct` of the price rather than the price itself.
```
**How it fails**
Kevin's policy is `cancelType: 'anytime'` (or any `lateCancelChargePct` below 100). The client attends a $120 session on Monday. Weekly mode means it will not settle until Sunday. On Tuesday the client writes `{status:'cancelled', cancelledBy:<their own uid>, cancelledAt:Date.now()}` — a legitimate-looking write the rules accept. Settle sees a cancelled session, applies the anytime policy, computes a $0 fee, and marks it `settled:"waived"` (:186). Kevin is paid $0 for a session he delivered, and the record now says the client cancelled it. With a 50% policy the same write turns a $120 delivered session into a $60 fee.

**Suggested fix**
Reject cancellations of sessions that have already started or been stamped: add `&& (!('completedAt' in resource.data)) && request.time.toMillis() < resource.data.startAt` to both update rules. Server-side, make `completedAt` win — in `settleGroup`, treat an item with `completedAt` set as a delivered session regardless of a later `status:"cancelled"`, and only honour cancellations stamped before `startAt`.

---

## [HIGH] Any session left unsettled for 30 days becomes permanently unbillable, with no log and no ledger
**functions/sessionSettle.js:55**

**Evidence**
```
`LOOKBACK_MS = 30 * 86400000` (functions/sessionSettle.js:55) bounds both candidate queries — `where("completedAt", ">", now - LOOKBACK_MS)` and `where("cancelledAt", ">", now - LOOKBACK_MS)` (lines 121-122). Nothing else ever scans `sessions`: settleNow calls the same runSettle (line 315), and there is no reconciliation query for aged unsettled items. Meanwhile functions/sessionSettle.js:170 makes the sweep skip a client entirely for as long as `client.sessionBillingHold` is set, and lines 246-249 skip (and release) any group with no card — so the two most common ways to stall billing both push sessions toward that cliff.
```
**How it fails**
Client's card declines on Sunday Aug 2 → sessionBillingHold is set. The client keeps training 3x/week at $100 while every sweep returns 'existing-hold'. They fix their card and clear the balance on Sep 8. The next sweep only sees sessions with completedAt after Aug 9, so the twelve sessions delivered Aug 3-8 ($400+ at 4 sessions) are outside the window forever: never charged, never surfaced, no ledger, no notification to Kevin that the money is now uncollectable. Same outcome for any client who trains for more than a month before saving a card.

**Suggested fix**
Either raise LOOKBACK_MS well past the longest plausible stall (e.g. 180 days) or, better, drive the sweep from an explicit unsettled index (a `settled == null` flag/collection) so age can never hide an item. Whatever the cutoff, add an 'aged out / needs manual invoice' state that is written to the ledger and shown to the trainer instead of the item silently disappearing.

---

## [HIGH] A failure AFTER a successful charge is reported to the client as a decline, and their own "Pay now" button then charges the card a second time
**functions/sessionSettle.js:257**

**Evidence**
```
In settleGroup the whole post-charge sequence sits inside the same try as the charge: `stripe.paymentIntents.create(...)` (line 257), `ledgerRef.update({status:"succeeded"...})` (264), the per-session updates (265) and notifyBoth (267). Any throw from lines 264-265 lands in the catch at 271, which writes `status:"declined"` on the ledger (274), sets `sessionBillingHold` on the client (277-279) and pushes "Your card was declined for $X" (281-283) — for money Stripe already captured. paySessionBalance then only short-circuits on `ledger.status === "succeeded"` (line 352) — the value the catch just overwrote — and deliberately uses a per-attempt idempotency key `${ledgerRef.id}-retry-${Date.now()}` (line 388) with the comment that a stable key would block legitimate retries. The retry button is one tap from the client's home banner (src/App.jsx:20207, doPayNow).
```
**How it fails**
Sunday sweep charges a $450 weekly batch; Stripe captures it; the immediately following `ledgerRef.update` fails with a transient Firestore UNAVAILABLE. The client receives "Card declined — action needed. Your card was declined for $450.00" and is locked out of training. They tap Pay now; paySessionBalance sees status 'declined', creates a second PaymentIntent for $450 with a fresh idempotency key, and it succeeds. The client has paid $900 for $450 of training, on two separate Stripe charges, with nothing in the system aware of the duplicate — and the ledger now records only the second one.

**Suggested fix**
Split the try: only errors thrown by `paymentIntents.create` may be classified as declines. Capture the PaymentIntent first, then do the bookkeeping in a separate try whose failure marks the ledger 'charged_needs_reconcile' (never 'declined', never a hold). In paySessionBalance, before creating an intent, search Stripe for an existing succeeded intent with `metadata.ledgerId == hold.ledgerId` (or reuse the ledger id as the idempotency key and inspect the returned intent) and lift the hold instead of charging again.

---

## [HIGH] The money sweep is the only scheduled function left at the 60-second default timeout; a mid-run kill strands claimed sessions in `settled:"processing"` forever
**functions/sessionSettle.js:302**

**Evidence**
```
`exports.sessionsSettle = onSchedule({ schedule: "every 60 minutes", region, secrets, maxInstances: 1 }, ...)` (functions/sessionSettle.js:302-305) sets no `timeoutSeconds`, so it runs at the 60s default. Every other scheduled/long-running function in this repo sets 300-540s (functions/push.js:313, functions/trialreminder.js:74, functions/workflows.js:164, functions/referrals.js:456, functions/trainerize.js:801). runSettle processes groups strictly sequentially (`for (const [key, items] of groups) { await settleGroup(...) }`, lines 137-147) and each group does ~6 Firestore round-trips plus a synchronous Stripe PaymentIntent create plus two push sends. The claim transaction commits `settled:"processing"` on the sessions and `status:"pending"` on the ledger (lines 219-234) BEFORE the Stripe call; grep shows `"processing"` is only ever written (line 220) and never read or reset anywhere in functions/ or src/, and the candidate filter requires `!v.settled` (lines 125-126), so a stranded session can never be picked up again.
```
**How it fails**
Weekly mode means every client settles in the same Sunday 18:00 run. At ~20 active clients × ~3-4s per group the run exceeds 60s and the instance is killed. The group in flight has already committed its claim, so its sessions sit at settled:"processing" with a `pending` ledger: that client's week (e.g. 3 × $100 = $300) is never charged by any later run, while the trainer's Earnings view counts the orphaned ledger in `pendingCents` (src/sessions.js:555) as money still coming. Every subsequent timeout strands another client the same way.

**Suggested fix**
Set `timeoutSeconds: 540` on sessionsSettle (and on sessionsMarkCompleted) to match every other sweep in the repo, and process groups with bounded concurrency instead of one at a time. Add a reaper that finds sessions stuck at settled:"processing" for more than ~15 minutes, checks Stripe for an intent whose metadata.ledgerId matches, and either completes the bookkeeping or releases the claim back to unsettled.

---

## [HIGH] The cancellation warning prices the fee from the trainer's current policy while settle charges from the consent snapshot
**src/App.jsx:23426**

**Evidence**
```
The confirm step computes the fee with the trainer's LIVE profile policy: `policy` comes from `getProfile(trainerUid)` → `policyOf(p)` (src/App.jsx:23276-23284) and is fed to `lateCancelFeeCents(s, policy, meUid, now)` at :23426 and :23441. The settle engine uses a different input entirely: `feePolicy = consent && consent.policy ? policyOf(consent.policy) : null` (functions/sessionSettle.js:173-174), where `consent` is the latest `sessionConsents` snapshot frozen when the card was saved (sessionBilling.js:218-237). The comment at src/App.jsx:23421-23425 claims the warning and the charge "can't disagree" because they share `isLateCancel`/`lateCancelFee` — but they share the function, not the policy object. public/terms.html §6 sides with the server: "Your charges are governed by the cancellation policy you agreed to when you saved — or last updated — your payment card."
```
**How it fails**
A client saves their card in March under the default policy (24h window, 100%); that snapshot is frozen in `sessionConsents`. In June Kevin softens his policy to `cancelType: 'anytime'`. The client cancels a $120 session 1 hour out; the confirm panel reads the current policy and shows the green line "In time — no cancellation charge", and the button reads "Yes, cancel". Sunday's settle reads the March snapshot, finds a late cancel at 100%, and charges the card $120 — a charge the client was explicitly told on screen would not happen, which is exactly the fact pattern that produces a chargeback. The mirror case loses Kevin money: he tightens the window to 72h, the UI warns the client a fee applies, and settle charges $0 because the snapshot still says 24h.

**Suggested fix**
Have the client's cancel-confirm read the governing policy from their own latest `users/{uid}/sessionConsents` doc for that trainer (falling back to the trainer's current policy only when no consent exists), so the number shown is the number that will be charged. Also surface the governing snapshot in the always-on policy card, and re-prompt for consent when a trainer changes their policy so the two converge.

---

## [HIGH] The cancellation confirm shows the trainer's CURRENT policy while the sweep bills the CONSENT snapshot — a client can be told "no charge" and then charged the full fee
**src/App.jsx:23426**

**Evidence**
```
The confirm dialog computes the fee from `policy`, which is loaded from the trainer's live profile (`getProfile(trainerUid).then(p => setPolicy(policyOf(p)))`, src/App.jsx:23278) — src/App.jsx:23426 `lateCancelFeeCents(s, policy, meUid, now)` and the button label at 23441. The sweep instead judges fees from the client's stored consent: functions/sessionSettle.js:173-174 `const consent = await latestConsent(...); const feePolicy = consent && consent.policy ? policyOf(consent.policy) : null;` and lines 183-185 price the fee with `feePolicy`, not the trainer's current policy. public/terms.html:137-139 says the consent snapshot governs, so the server is right and the UI is wrong — yet src/sessions.js:334-337 and the comment at src/App.jsx:23421-23424 both assert the warning and the charge 'can never drift apart'.
```
**How it fails**
Client saves a card on Jul 1 while the policy is {window, 24h, 100%}; that snapshot is frozen into sessionConsents. On Aug 1 the trainer relaxes their policy to 'anytime' (free cancellation) — no re-consent is triggered. On Aug 5 the client cancels a $75 session 2 hours out; the confirm dialog reads 'In time — no cancellation charge' and the button says 'Yes, cancel'. Sunday's sweep evaluates the Jul 1 consent policy, finds a late cancel, and charges $75 to the card. The client is charged $75 immediately after the app told them, at the irreversible tap, that it would be $0.

**Suggested fix**
Make the client-side warning read the same source the sweep does: expose the client's latest consent policy (a field on their own profile, or a small callable) and pass THAT into isLateCancel/lateCancelFeeCents, falling back to the trainer policy only when no consent exists. Alternatively force re-consent (a new snapshot) whenever a trainer saves a policy change, so current and consented can't diverge.

---

## [MEDIUM] cancelledAt is accepted up to 5 minutes in the future, so a fast device clock turns an in-time cancellation into a full-price late fee
**firestore.rules:278**

**Evidence**
```
`cancelledAt` is written by the browser as `cancelledAt: Date.now()` (src/sessions.js:66) and the rule accepts any value within ±5 minutes of server time in BOTH directions: `request.resource.data.cancelledAt >= request.time.toMillis() - 300000 && request.resource.data.cancelledAt <= request.time.toMillis() + 300000` (firestore.rules:280-282). The stated intent is skew tolerance against backdating (271-277), and it does hold against the hours-scale fraud it was written for. But the fee turns on that exact number with no server correction: `session.startAt - session.cancelledAt < policy.cancelWindowHours * 3600000` (functions/sessionSettle.js:75), a strict `<` so a cancellation exactly at the window edge is correctly free. The forward half of the tolerance therefore moves the free/charged boundary by up to five minutes against the client, and the value is never re-derived from `request.time` after the write. `evidenceSummary` (84-93) then renders that same skewed timestamp as the record of when the client cancelled.
```
**How it fails**
Session Tuesday 9:00 AM, `cancelWindowHours: 24`, `priceCents: 15000` ($150.00), `lateCancelChargePct: 100`. The client's phone clock runs 4 minutes fast (ordinary for a device that has not synced). At 8:58 AM Monday — 24 hours and 2 minutes of genuine notice, comfortably in time — they cancel. The browser writes `cancelledAt` = Monday 9:02, which passes the rule, and the sweep computes 23h58m of notice: late. The card is charged $150.00 for a cancellation that was in fact within the window, and the dispute evidence Glidna stores asserts a cancellation time four minutes later than it really was. The client is not ambushed — the panel used the same skewed `Date.now()` and warned them — but the warning was itself wrong, and the money outcome is a full session price on the strength of a device clock.

**Suggested fix**
Never accept a future timestamp for a field that prices money: tighten the rule to `cancelledAt <= request.time.toMillis()` while keeping the -300000 lower bound, which leaves the tolerance only in the client-favourable direction. Better, have the settle dispatcher recompute lateness from a server-written value — stamp `cancelledAtServer` from a Firestore onUpdate trigger (or require `request.time` via `request.time == request.resource.data.cancelledAtServer`) and use that field, not the browser's, in `isLateCancel` and `evidenceSummary`.

---

## [MEDIUM] A client can cancel a session that has already been delivered, converting a full-price charge into a reduced or zero late-cancel fee
**firestore.rules:330**

**Evidence**
```
The client update rule requires only `changed().hasOnly(clientCancelFields())`, `identityIntact()`, `cancelStampHonest()` and `status == 'cancelled'` — there is no check that `startAt` is in the future or that `completedAt` is unset, even though the surrounding comment (rules ~line 273) shows backdating of `cancelledAt` was considered and blocked. The settle dispatcher then routes on status: `doneSnap.forEach(... if (!v.settled && v.status !== "cancelled")` (sessionSettle.js:125) drops it from the full-price branch, and `cancSnap` (:126) picks it up as `kind: "cancel"` priced by `lateFeeCents` (:184-185). `isLateCancel` (:71-76) returns true for a negative notice period, so the item is priced at `priceCents * lateCancelChargePct / 100`, and a fee of 0 is written `settled: "waived"` (:186). The UI hides Cancel on past sessions (src/App.jsx:23411), so this is reachable only through the Firebase SDK the client already has in their bundle.
```
**How it fails**
Kevin sets a 50% late-cancel fee. A client attends a $120 session on Tuesday. On Wednesday, from the browser console, they call `updateDoc(doc(db,'sessions',id), {status:'cancelled', cancelledBy:<their uid>, cancelledAt:Date.now(), updatedAt:Date.now()})` — the rules accept it because `cancelledAt` is honest server-current time. Sunday's sweep bills $60 instead of $120. With a policy of `cancelType:'window'` and `lateCancelChargePct: 0`, the fee is $0 and the session is marked `waived` — a delivered session becomes free. The ledger's `evidenceSummary` (:84-93) also renders nonsense for the dispute record ("-25h notice, i.e. 49h inside the window").

**Suggested fix**
In the client update rule, require `resource.data.startAt > request.time.toMillis()` and `!('completedAt' in resource.data)`. Defensively, have `settleGroup` treat a cancellation whose `cancelledAt` is after `startAt` as a delivered session (full `priceCents`) rather than a cancellation fee.

---

## [MEDIUM] A trainer can re-price a session after it is delivered, or after the client has accepted a stated cancellation fee, and the sweep bills the new price
**firestore.rules:317**

**Evidence**
```
The trainer update rule (firestore.rules:317-325) allows any of `bookingFields()` — which includes `priceCents` — while the resulting status is 'scheduled' or 'cancelled'. There is no guard on `completedAt` being set, and a cancelled session stays editable (cancelStampHonest passes when cancelledAt is unchanged). The sweep reads the price at settle time, not at delivery/cancellation time: functions/sessionSettle.js:182 `cents: Math.max(0, Number(s.priceCents) || 0)` for completed sessions, and functions/sessionSettle.js:80 `Math.round((Number(session.priceCents) || 0) * policy.lateCancelChargePct / 100)` for a late-cancel fee. With weekly mode there is a window of up to 7 days between the client's action and the charge.
```
**How it fails**
Client cancels a $75 session 3 hours out; the confirm dialog states 'Late cancellation — your trainer charges $75.00 for this' and they tap 'Cancel & accept charge'. Before Sunday the trainer opens the session in the reschedule form and saves 150 in the Price field (a typo, or a deliberate change). The sweep computes 100% of the CURRENT price and charges $150 — exactly double the amount the client was shown and agreed to, with no second disclosure and nothing in the consent record to contradict it.

**Suggested fix**
Freeze the billable amount at the moment the obligation is created: have sessionsMarkCompleted stamp a server-written `billableCents` alongside `completedAt`, and stamp the fee basis when a cancellation is recorded; bill from that field and never from live priceCents. Optionally block priceCents changes in the rules once `completedAt` exists or status is 'cancelled'.

---

## [MEDIUM] noShowChargePct is disclosed to clients and stored in the consent record but never applied — every no-show bills 100% of the session price
**functions/sessionSettle.js:181**

**Evidence**
```
A no-show is indistinguishable from an attended session: nobody cancels, so `markCompletedSessions` stamps `completedAt: endMs` (functions/sessions.js:45-49) and `settleGroup` bills it at face value — `if (s.kind === "session") { billable.push({ s, cents: Math.max(0, Number(s.priceCents) || 0), settledAs: "charged" }); }` (181-182). `noShowChargePct` is parsed by `policyOf` (67) and stored on the consent snapshot by `cleanPolicy` (functions/sessionBilling.js:98), but grep across `functions/` shows it is never read to compute an amount, and there is no no-show marking anywhere in the codebase. Meanwhile it is disclosed verbatim in the standard disclosure the client is shown and agrees to: `lines.push(\`Not showing up for a booked session is charged ${p.noShowChargePct}% of the session price.\`)` (src/sessions.js:389-390), which is rendered on the Sessions screen (src/App.jsx:23484) and captured into the consent record's `shownText` (functions/sessionBilling.js:222). Terms §6 repeats it: "a fee (a percentage of the session price) for cancelling late or not showing up" (public/terms.htm
```
**How it fails**
Trainer sets `noShowChargePct: 50` — a normal, client-friendly choice ("if you don't turn up I'll take half"). The client's Sessions screen and the consent text they ticked both read "Not showing up for a booked session is charged 50% of the session price." The client no-shows a $120.00 session. No cancellation is written, the 15-minute sweep stamps `completedAt`, and the settle dispatcher charges the full $120.00 instead of $60.00 — a $60.00 overcharge that directly contradicts the frozen consent document the system would produce as its defence in a chargeback.

**Suggested fix**
Either implement the no-show path — a trainer-writable attendance/no-show mark on the session, with `settleGroup` pricing a no-show at `priceCents * noShowChargePct / 100` — or, until it exists, drop `noShowChargePct` from the policy editor and remove the no-show sentence from `cancellationDisclosure` and Terms §6 so the app never promises a percentage it will not apply.

---

## [MEDIUM] The no-card path mints a new ledger doc every run, multiplying the trainer's "Pending" total
**functions/sessionSettle.js:203**

**Evidence**
```
`const ledgerRef = db.collection("sessionCharges").doc()` (line 203) creates a fresh doc on every pass through `settleGroup`. When the client has no card, the claim is released back to `settled: null` (line 247) and the ledger is left behind as `status: "no_card"` (line 248) — so the identical sessions are re-claimed and re-ledgered on the very next run. `earningsSummary` in src/sessions.js:555 sums `amountCents` into `pendingCents` for every doc with `status` `pending`/`no_card`/`processing`, and src/App.jsx:17288 renders that straight into the "Pending" tile.
```
**How it fails**
Client completes six $100 sessions and hasn't saved a card. Trainer is on `per_session` mode, so the sweep runs hourly: after one week that is 168 `no_card` ledger docs, each for $600. Kevin's Earnings screen shows "Pending: $100,800" against a real outstanding balance of $600. The client's own charge history (sessionCharges is readable by the client, firestore.rules:346) shows 168 entries for money never taken. After 30 days the docs remain but the sessions age out, so the number stops growing and simply stays wrong forever.

**Suggested fix**
Do not create the ledger doc until there is something to charge — move the `ledgerRef` allocation after the card check, or reuse a deterministic id per (trainer, client, billing period) so repeat runs overwrite instead of appending. Alternatively skip the claim entirely when `!pm?.id || !client.stripeCustomerId` (checked before the transaction) and emit no ledger row at all for a no-card group.

---

## [MEDIUM] Off-session PaymentIntent status is never checked — a `processing` intent is booked as collected revenue and a later failure is never reconciled
**functions/sessionSettle.js:264**

**Evidence**
```
After `paymentIntents.create` returns, the code writes `status: "succeeded"` and `settled: "charged"` (:264-265) without ever inspecting `pi.status`. `paySessionBalance` does check (`if (pi.status !== "succeeded")`, :390), so the omission in the sweep is an asymmetry, not a deliberate choice. No `payment_intent.*` webhook exists (billing.js:316-344), so nothing ever revises the record. `earningsSummary` counts any ledger with `status === "succeeded"` into `collectedCents` and `monthCents` (src/sessions.js:550-552).
```
**How it fails**
A client's $320 weekly charge comes back `processing` rather than `succeeded` (Stripe returns this without throwing for some card/network paths). The ledger is stamped `succeeded`, the sessions are marked `charged`, and both sides are pushed "$320.00 received for training". The payment subsequently fails at the network. Nothing in Glidna reacts: the sessions are terminal so no sweep revisits them, the client is never told, and Kevin's Earnings tile permanently shows $320 he never received — money he will only discover missing by reconciling his Stripe balance by hand.

**Suggested fix**
Gate the success writes on `pi.status === "succeeded"`; record `processing` as its own non-terminal ledger status and leave the sessions claimed. Add a `stripeWebhook` branch for `payment_intent.succeeded` / `payment_intent.payment_failed` keyed on `metadata.ledgerId` to finalise those ledgers.

---

## [MEDIUM] Sessions booked without a price are permanently marked settled and can never be billed, and both sides get a false "covered by your package" notification
**functions/sessionSettle.js:238**

**Evidence**
```
`SessionsPanel` is never given a `defaultPriceCents` (the only two call sites, src/App.jsx:16872 and :20810, omit it), so the booking form's price field defaults to blank and `bookSession` stores `priceCents: 0` (src/sessions.js:46). In `settleGroup` those items are claimed as `settled: "processing"` inside the transaction (:220), then `if (claim.amountCents === 0)` returns at :238-243 without ever moving them off `"processing"` — a truthy value, so `!v.settled` (:125) excludes them from every future sweep. The same branch sends `notifyBoth` with `claim.covered.length`, which is 0 when no credits were used.
```
**How it fails**
Kevin books a week of sessions and forgets to type the price (the default). The sweep claims all five, they total $0, and both he and the client are pushed "0 sessions covered by your package — Your prepaid package covered 0. No card charge." All five are now `settled: "processing"`. When Kevin notices and edits each session to $80 (which the rules allow), they are already terminal and no sweep will ever price them: $400 of delivered training is uncollectable through the product, with a ledger row that says `covered_by_package`.

**Suggested fix**
Skip zero-value items before the claim transaction (filter `cents > 0` at :182) so an unpriced session stays unsettled, or mark them with a distinct non-terminal state. Suppress the package notification when `claim.covered.length === 0`, and require a non-zero price at booking (or warn the trainer) if sessions are meant to bill.

---

## [MEDIUM] A run that times out mid-group leaves sessions permanently `processing` with the card possibly already charged
**functions/sessionSettle.js:302**

**Evidence**
```
`sessionsSettle` sets no `timeoutSeconds` (:302-305), so it runs on the 60-second v2 default, and `runSettle` processes groups strictly serially (`for (const [key, items] of groups) { await settleGroup(...) }`, :137-147). Each group does two profile gets, a consent query, a transaction, a Stripe PaymentIntent, two web-push fan-outs (:292-295) and several more Firestore writes. The transaction claims sessions as `settled:"processing"` (:220) BEFORE the Stripe call, and nothing anywhere clears that state: the candidate filter is `!v.settled` (:125-126), `settleNow` runs the same `runSettle`, `paySessionBalance` only acts on a `sessionBillingHold` (:337-338), and there is no reaper or webhook reconciliation for `purpose:"glidna_sessions"` intents.
```
**How it fails**
On a Sunday evening Kevin has 25 client groups to settle — the heaviest run of the week. Group 22's transaction commits (its 3 sessions become `processing`, ledger `pending`) and the PaymentIntent is created; Stripe captures $360; the 60-second wall clock expires before `ledgerRef.update({status:"succeeded"})` runs and the instance is killed. The next hourly run inside the Sunday window skips those sessions (`settled` is truthy) and skips the ledger (nothing scans `pending` ledgers). Result: the client is charged $360, the ledger says `pending` forever, `earningsSummary` counts it as pending rather than collected (src/sessions.js:555), the three sessions never show as charged to either side, and no code path will ever resolve it.

**Suggested fix**
Raise `timeoutSeconds` (e.g. 300) and settle groups with bounded concurrency instead of one-at-a-time; move the push notifications out of the critical path. Add a recovery sweep that finds ledgers stuck in `pending`/sessions stuck in `processing` older than ~15 minutes, looks up the PaymentIntent by `metadata.ledgerId`, and either completes the bookkeeping or releases the claim.

---

## [MEDIUM] Package credits are spent in scan order regardless of what each item is worth
**functions/sessionSettle.js:216**

**Evidence**
```
Inside the claim transaction, credits are allocated purely positionally: `for (const b of live) { if (creditsLeft > 0) { creditsLeft--; covered.push(b); } else toCharge.push(b); }` (:212-218). `b.cents` is never consulted, so a credit is consumed by a $0 session (line 182 admits zero-price items) or by a partial late-cancel fee just as readily as by a full-price session. Order comes from the candidates Map (:124-126), which is insertion order: completed sessions in ascending `completedAt`, then cancellations — i.e. whatever happened earliest that week, not whatever is worth most. (Latent today: no code grants `sessionCredits` — the only reference outside settle is the decrement at :221 — and the buy side is still open in docs/SESSIONS-GO-LIVE.md #3. It becomes live arithmetic the moment pack purchases ship.)
```
**How it fails**
A client holds 1 remaining credit from a 4-pack they paid $480 for ($120/session). That week Kevin books a free 15-minute consult (price left blank → $0, per the blank-by-default price field) on Monday and a full $120 session on Wednesday. Sunday's batch orders them Monday-first: the $0 consult consumes the credit, and the $120 session drops through to `toCharge`. The card is charged $120 and the client's last $120 credit is gone — $120 of value destroyed, with the ledger recording `creditsUsed: 1` against a $0 line item. Same shape with a 50% late-cancel fee: a $60 fee eats a $120 credit.

**Suggested fix**
Allocate credits highest-value-first (sort `live` by `cents` descending before the loop) and never spend a credit on an item worth 0 cents. Decide explicitly what a credit is worth against a partial fee — either bill partial fees to the card and reserve credits for whole sessions, or deduct a fractional credit — and state that rule in the disclosure text the client agrees to.

---

## [MEDIUM] With no card on file the sweep mints a brand-new "no_card" ledger every run for the same sessions, inflating the trainer's pending-earnings total without bound
**functions/sessionSettle.js:246**

**Evidence**
```
settleGroup allocates `const ledgerRef = db.collection("sessionCharges").doc()` (line 203) and writes it inside the claim transaction (lines 224-234) BEFORE checking for a card. Only at line 246 does it discover there is no payment method; it releases the session claims back to unsettled (line 247) but leaves the ledger behind as `status:"no_card"` (line 248) with the full amountCents. The released sessions are candidates again on the very next run, which mints another ledger. src/sessions.js:555 counts `no_card` into `pendingCents`, and subscribeMyEarnings (src/sessions.js:518) lists every row in the trainer's Earnings view.
```
**How it fails**
per_session mode, a client without a card completes one $75 session Monday 9am. The hourly sweep creates a fresh no_card ledger every hour. By Friday morning there are ~96 sessionCharges docs for that one session and the trainer's Earnings screen reads '$7,200 pending' across 96 'Awaiting card' rows — for $75 of actual work. Weekly mode produces 6 duplicates every Sunday, compounding each week until a card is saved.

**Suggested fix**
Check for a usable card (and stripeCustomerId) before opening the transaction, and skip the group entirely when there is none — or look up an existing open `no_card` ledger for the trainer/client pair and update it instead of creating a new one. Also exclude `no_card` from pendingCents, or de-duplicate by sessionIds, so the trainer's pending figure reflects distinct work.

---

## [LOW] Paying a declined balance marks package-covered sessions as card-charged, corrupting the record the dispute defence relies on
**functions/sessionSettle.js:397**

**Evidence**
```
The ledger's `sessionIds` is `live.map(b => b.s.id)` (functions/sessionSettle.js:228) — it includes BOTH the credit-covered items and the card-charged ones, while `amountCents` (line 223) counts only the ones to charge. On the pay-now path, functions/sessionSettle.js:397-398 writes `settled:"charged", chargeId: pi.id` over every id in that list, including sessions the settle transaction had already marked `settled:"package"` at line 219. (settleGroup itself is correct here — line 265 only touches claim.toCharge.)
```
**How it fails**
A group of 3 sessions settles with 1 prepaid credit and 2 uncovered $75 sessions; the $150 charge declines and a hold is set. The client taps Pay now and pays $150. The credit-covered session's doc now reads settled:'charged' with the same chargeId as the two paid ones, though no money was ever taken for it and the ledger still says creditsUsed:1 / amountCents:150. If that session is later disputed, the session record and the charge ledger contradict each other — in a system whose entire chargeback defence is 'our stored record shows exactly what happened'.

**Suggested fix**
Store the charged ids separately on the ledger (e.g. `chargedSessionIds` alongside `sessionIds`) and have paySessionBalance update only those, leaving package-covered sessions at settled:'package'.

---
