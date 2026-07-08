# In-app messaging (trainer ↔ client DMs) — build plan (S90; build next session)

_Kevin greenlit starting messaging (Jul 8). This is the locked design so the build session starts
at "write code", not "decide things". Rules-critical → follow the standing discipline: emulator
tests for every rule change (61 passing today), attack cases, PUBLISH after deploy._

## Scope (v1)
Direct messages between a trainer and THEIR linked client. Not group chat, not client↔client,
not media attachments (text only, v1). Both sides get: a thread view, live updates, unread
badges, and a notification-center type. Push delivery arrives with the FCM build (separate).

## Data model (new top-level collection — kv is per-user, a shared thread can't live there)
- `threads/{threadId}` — threadId = `${trainerUid}_${clientUid}` (deterministic → no lookup
  index needed; participants sorted trainer-first).
  Fields: `participants: [trainerUid, clientUid]`, `trainerUid`, `clientUid`,
  `lastMsg` (first ~80 chars), `lastFrom`, `updatedAt`, `unread: {uid: count}`.
- `threads/{threadId}/msgs/{msgId}` — `{ from, text (≤2000 chars), ts }`. Msg docs are
  IMMUTABLE (no edit/delete in v1 — append-only keeps rules tight).

## Security rules (the critical part)
- `match /threads/{tid}`: read/update allowed iff `request.auth.uid in resource.data.participants`.
  **Create** allowed iff the caller is in `request.resource.data.participants` AND the pair is a
  REAL trainer↔client link — verify with a `get()` on the client's profile:
  `get(/users/$(clientUid)).data.assignedTrainerId == trainerUid` (or headTrainerId for the head).
  Field allowlist on update: only `lastMsg/lastFrom/updatedAt/unread` (hasOnly), and a writer may
  only ZERO their own unread count / INCREMENT the other's (prevents unread spoofing).
- `match /threads/{tid}/msgs/{mid}`: create iff caller in parent thread participants AND
  `request.resource.data.from == request.auth.uid` (no impersonation) AND text size cap.
  Read iff participant. No update/delete (append-only).
- **Attack tests to write:** non-participant read/write denied; forged `from` denied; create with
  a non-linked pair denied; participant list tampering denied; oversized text denied; signed-out
  denied. Target: existing 61 + ~10 new, all passing before publish.

## Client plumbing
- `src/messaging.js`: `threadIdFor(trainerUid, clientUid)`, `ensureThread`, `sendMessage`
  (batched write: add msg + update thread lastMsg/updatedAt/unread increment),
  `subscribeThread(tid, cb)` (onSnapshot on last ~50 msgs, ordered by ts),
  `subscribeMyThreads(uid, cb)` (query `participants array-contains uid` order by updatedAt).
- Composite index likely needed for `array-contains + orderBy(updatedAt)` — the console link in
  the first error names it; create + note it.

## UI
- **Client (ClientHome):** a "💬 Message your trainer" card/button (only when linked) → thread
  view (reuse the AI chat's bubble styling — user right, other left; NOT the AI panel itself).
  Unread badge on the button.
- **Trainer (TrainerDashboard):** "Message" action on each connected-client card + unread badge;
  same thread view with the client's name in the header.
- Thread view: portal full-screen (page-transition transform trap → createPortal, S27), input +
  send, live via onSnapshot, marks own unread zero on open. House icons, no emoji (Kevin's rule).
- **Notification center:** new type `messages` in notifPrefs (default on) gating the badges/cards.

## Build order (one session)
1. rules + emulator tests (the gate) → 2. messaging.js helpers → 3. thread view component →
4. client entry point → 5. trainer entry point → 6. notif-prefs type → 7. E2E with the two test
accounts (send both directions, live update, unread, non-participant denial) → 8. PUBLISH rules.

## Explicitly deferred
Media/photos in DMs, message deletion, group threads, client↔client, typing indicators,
read receipts beyond unread counts, push delivery (FCM build), AI summarizing threads (later,
fits the tool pattern).
