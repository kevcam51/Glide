# Notes (client + trainer + AI) — locked design (Kevin, Jul 9 2026; BUILD NEXT SESSION)

_Kevin's spec: a notes tab with notes as clickable buttons; auto-generated titles (or custom,
like the Notes app); per-note visibility — PRIVATE to the client or SHARED with the trainer;
trainers get per-client notes (open a client → their notes section) plus general notes for
themselves; and the AI can create/update/read notes on request. Use cases: to-do tracking,
trainer guidance the client can always look back at, clients jotting questions before sessions._

## Storage model (the part that must be right)
- **Shared notes** (client ↔ trainer both see/edit): the CLIENT's kv `caliq-notes` — an array of
  `{ id, title, body, authorUid, authorName, visibility: "shared", createdAt, updatedAt }`.
  Rules already give both sides read/write (trainer↔client kv access). Writes transactional
  (kvTxnJSON pattern) — both sides can edit without clobbering.
- **Client-PRIVATE notes:** ⚠️ a flag is NOT enough — the trainer can read all client kv by
  design. TRUE privacy = new owner-only subcollection **`users/{uid}/privkv/{docId}`** with
  `allow read, write: if request.auth.uid == uid` (not even trainer-chain; admin only via
  Admin SDK). Rules addition + emulator attack tests (trainer reads client privkv → DENIED;
  head → DENIED; stranger/signed-out → DENIED; owner → allowed) + PUBLISH. New tiny module
  `src/privateStore.js` (get/set/list on my own privkv — do NOT touch window.storage).
  Private notes doc: `privkv/caliq-notes` (same array shape, visibility "private").
- **Trainer notes:** trainer's OWN kv `caliq-notes` (clients can't read trainer kv → already
  private). Per-client notes = same array with optional `aboutUid` field; the client-card
  Notes view filters `aboutUid === client.uid`; general notes = `aboutUid: null`.
  A trainer note the CLIENT should see = written to the CLIENT's `caliq-notes` as shared
  (author = trainer) via setForUser — the "client can always look back at it" case.

## Auto-title (Notes-app behavior)
Title empty on save → derive from the body: first line, trimmed to ~40 chars. Editing keeps a
custom title once set. AI-created notes: the AI passes a title or lets the same derivation run.

## UI
- **Client:** "Notes" button in the home header row (wraps fine post-S90b) → full-screen
  NotesPanel (portal + scroll-lock + back-close): notes as tappable rows (title, updated
  timeAgo, badge: lock = private / people = shared w/ trainer, author name when trainer-written)
  → editor (title input, body textarea, visibility toggle, save / delete). "+ New note".
- **Trainer per-client:** "Notes" button on each connected-client card → NotesPanel scoped to
  that client: my private notes about them (own kv, aboutUid) + the client's SHARED notes,
  badged "Private to you" / "Shared with {name}". New-note chooser: private-to-me vs shared.
- **Trainer general:** ≡ menu "My notes" → NotesPanel (own kv, aboutUid null).

## AI tools (same access pattern as everything else)
- `list_notes` / `create_note` / `update_note` (append or replace body; append default).
- Caller acting on THEMSELVES: sees/writes their own private + shared notes.
- Trainer + clientId: the client's SHARED notes and the trainer's own about-notes ONLY —
  **the AI must never surface a client's PRIVATE notes to a trainer** (enforced server-side:
  privkv only read when target uid === callerUid).
- Add to the wrote-refresh list. Prompt line: "asked to remember/write something down → offer
  a note; notes with 'remind me to ask my trainer' stay private unless told otherwise."

## Build order (one session, messaging playbook)
1. rules (privkv) + emulator attack tests → 2. src/privateStore.js + notes helpers (txn) →
3. NotesPanel component → 4. client entry → 5. trainer entries (card + menu) → 6. AI tools ×3
(+ all-four deploy) → 7. E2E both roles + privacy denial verified live → 8. PUBLISH rules.

## Deferred (v2)
Note sharing to OTHER parties, rich text/checklists, note-to-request conversion ("turn this
question into a message"), pinned notes, search (list is capped ~100/store; search when needed).
