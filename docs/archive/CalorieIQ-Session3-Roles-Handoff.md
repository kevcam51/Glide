# CalorieIQ — Session 3: Role System + Trainer-Sees-Clients Security Rules (Claude Code Handoff)

You are working in the **CalorieIQ** project. This document is a complete, self-contained
spec. Read it fully, then execute. The owner (Kevin) is not deeply comfortable with terminal
work — do the file/terminal work yourself and explain in plain language. **This session is
security-critical**: a mistake in the Firestore rules could let one trainer read another's
clients, or let a user promote themselves. So the rules must be implemented AND tested
against the Firebase emulator before anything is committed.

---

## Project context (state after Session 2)

- Vite + React app. Main UI in `src/App.jsx` (~7,561 lines).
- Firebase is wired up: Auth (Email/Password, Google, Anonymous) + Firestore.
- `src/firebase.js` exports `auth`, `db`, `googleProvider`.
- `src/storage.js` backs `window.storage` with Firestore at `users/{uid}/kv/{key}` — the
  app's per-user data. **Do not change the storage interface.**
- `src/AuthGate.jsx` gates the app behind login (email/password + Google buttons).
- `firestore.rules` currently says: a user can read/write only their own `users/{uid}/**`.
- Repo: github.com/kevcam51/calorieiq. Deploys to Vercel on push to main.
- Project ID: `calorieiq-29762`.

## Goal of this session

1. **Role-aware signup.** At signup, ask "Are you a trainer or a client?" Create a profile
   document recording the role.
2. **Profile data model.** Each user gets a `users/{uid}` document holding role + linkage.
3. **Client → trainer linking** via the trainer's invite code (the trainer's uid, for MVP).
4. **Security rules** enforcing the access matrix below, including blocking self-promotion.
5. **Emulator tests** for the rules covering normal AND attack cases.
6. A documented **Blaze migration path** (section J) — do NOT implement it, just keep the
   data model compatible and write the note.

## The four roles

- **client** — an end user. Chooses "client" at signup. May be linked to one trainer.
- **head_trainer** — an independent trainer. Chooses "trainer" at signup (a self-signup
  trainer is the head of their own tree). Owns an invite code; has clients and (later) subs.
- **sub_trainer** — a trainer working under a head. **Not a signup option.** For THIS MVP,
  sub_trainer status is assigned by **admin only** (see "Why admin-only" below).
- **admin** — the platform owner (Kevin). **Not a signup option.** Hardcoded by uid in the
  rules. Can read/write everything.

**Why admin-only sub-trainers for now:** letting a head_trainer write another user's profile
to make them a sub_trainer opens an escalation hole (a head could convert any user into their
sub and then read that user's data). Enforcing genuine two-sided consent safely needs
server-side logic (a Cloud Function), which belongs in the Blaze phase. Until then, Kevin
(admin) sets sub_trainer relationships manually. Document this; don't build head-invites-sub.

---

## Data model — `users/{uid}` document fields

```
uid:               string   (same as the doc id; stored for rule checks)
email:             string
displayName:       string   (optional, "" default)
role:              'client' | 'head_trainer' | 'sub_trainer' | 'admin'
assignedTrainerId: string | null   (clients: the uid of their direct trainer)
headTrainerId:     string | null   (head_trainer: their own uid; sub_trainer: their head's uid; client: null)
createdAt:         server timestamp
```

Reserved for a FUTURE session (do not implement, just leave room — do not add yet unless
trivial): `trialStartedAt`, `trialLengthDays`, `subscriptionStatus`.

Notes:
- Clients store ONLY `assignedTrainerId` (their direct trainer). They do NOT store a
  `headTrainerId` — the rules resolve the head dynamically (see access matrix). This avoids
  trusting the client to stamp the correct head.
- The per-user app data continues to live in the `users/{uid}/kv` subcollection (unchanged).
- Invite code = the trainer's `uid` for MVP (uids are not secret). A friendlier short-code
  lookup can come later; note it as a future improvement, don't build it now.

---

## Access control matrix (THIS is the spec the rules must satisfy)

**Profile docs `users/{uid}` (role + linkage; mildly sensitive):**
- READ: any signed-in user. (MVP simplification so join + client-list queries work. Flag in
  the Blaze note that this should later be tightened to owner + their trainer chain + admin +
  a limited public trainer directory.)
- CREATE: only your own uid; role must be `client` or `head_trainer` ONLY (never admin/
  sub_trainer); `uid` field must equal the doc id.
- UPDATE: 
  - admin: anything.
  - owner: may update own profile (e.g. set `assignedTrainerId`, `displayName`) but MUST NOT
    change `role` (new role must equal existing role).
  - nobody else.
- DELETE: admin only.

**Sensitive per-user data `users/{uid}/kv/{doc}`:**
- READ + WRITE allowed if the requester is ANY of:
  - the owner (`request.auth.uid == uid`), OR
  - an admin, OR
  - the owner's direct trainer (`request.auth.uid == ` the owner profile's `assignedTrainerId`), OR
  - the head above the owner's direct trainer (the owner's trainer's `headTrainerId == request.auth.uid`).
  (Trainers can write client data because the coaching model includes trainers entering data
  for clients.)

**Attack cases the tests MUST prove are DENIED:**
- A client updating their own `role` to `head_trainer`/`sub_trainer`/`admin`. → DENIED
- A user creating their profile with `role: 'admin'` or `'sub_trainer'`. → DENIED
- Trainer A reading Trainer B's client's `kv` data (no link). → DENIED
- Client X reading Client Y's `kv` data. → DENIED
- A signed-out request reading anything. → DENIED
- A head reading the kv of a client who belongs to a DIFFERENT head's sub. → DENIED

**Normal cases the tests MUST prove are ALLOWED:**
- Owner reads/writes own kv. → ALLOWED
- A client sets their own `assignedTrainerId` (joining a trainer). → ALLOWED
- A trainer reads/writes the kv of a client whose `assignedTrainerId` is that trainer. → ALLOWED
- A head reads/writes the kv of a client assigned to that head's sub_trainer. → ALLOWED
- Admin reads/writes anyone's kv. → ALLOWED

---

## Section R — Reference `firestore.rules` (STARTING POINT — must be hardened + tested)

This is a correct-by-design starting point, but you MUST add null/existence guards (so a
`get()` on a missing profile or a null `assignedTrainerId` can't throw and accidentally
allow/deny incorrectly) and verify every matrix row with emulator tests before shipping.
Replace `REPLACE_WITH_ADMIN_UID` with Kevin's real uid (manual step, section H).

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    function isSignedIn() { return request.auth != null; }

    function isAdmin() {
      return isSignedIn() && request.auth.uid in [
        "REPLACE_WITH_ADMIN_UID"
      ];
    }

    function profileExists(uid) {
      return exists(/databases/$(database)/documents/users/$(uid));
    }
    function profileData(uid) {
      return get(/databases/$(database)/documents/users/$(uid)).data;
    }

    // Is the requester the direct trainer of ownerUid?
    function isDirectTrainer(ownerUid) {
      return profileExists(ownerUid)
        && profileData(ownerUid).assignedTrainerId != null
        && request.auth.uid == profileData(ownerUid).assignedTrainerId;
    }

    // Is the requester the head above ownerUid's direct trainer?
    function isHeadOfTrainer(ownerUid) {
      return profileExists(ownerUid)
        && profileData(ownerUid).assignedTrainerId != null
        && profileExists(profileData(ownerUid).assignedTrainerId)
        && request.auth.uid == profileData(profileData(ownerUid).assignedTrainerId).headTrainerId;
    }

    function canAccessUserData(ownerUid) {
      return isSignedIn() && (
        request.auth.uid == ownerUid
        || isAdmin()
        || isDirectTrainer(ownerUid)
        || isHeadOfTrainer(ownerUid)
      );
    }

    match /users/{uid} {
      allow read: if isSignedIn();

      allow create: if isSignedIn()
        && request.auth.uid == uid
        && request.resource.data.uid == uid
        && request.resource.data.role in ['client', 'head_trainer'];

      allow update: if isAdmin()
        || (
          request.auth.uid == uid
          && request.resource.data.role == resource.data.role
        );

      allow delete: if isAdmin();

      match /kv/{docId} {
        allow read, write: if canAccessUserData(uid);
      }
    }
  }
}
```

Implementation reminders:
- Guard against the nested `get()` in `isHeadOfTrainer` throwing when the trainer profile is
  missing — the `profileExists(...)` checks above are there for that; verify with tests.
- `get()`/`exists()` count against Firestore rule limits (max ~10 lookups per evaluation).
  This design uses at most 2 on the head path — fine — but don't add more layers.
- Short-circuit order matters: owner and admin are checked first so the common path does no
  document lookups.

---

## Section T — Required rules tests (Firebase emulator)

Set up the Firebase emulator + the rules-unit-testing library and write tests that assert
every ALLOWED and DENIED case in the access matrix above.

1. Install dev deps: `@firebase/rules-unit-testing` and the Firebase CLI (local/dev dep is
   fine; you can also use `npx firebase`).
2. Create a `firebase.json` configuring the Firestore emulator pointing at `firestore.rules`
   (if one doesn't already exist).
3. Write a test file (e.g. `firestore.rules.test.js`) that seeds profile docs for: an admin,
   a head_trainer H, a sub_trainer S (headTrainerId = H), a client C1 (assignedTrainerId = H),
   a client C2 (assignedTrainerId = S), an unrelated trainer T2, and an unrelated client C3.
   Then assert each ALLOWED/DENIED row from the matrix, including the attack cases.
4. Run the tests against the emulator and ITERATE on the rules until ALL pass. Do not commit
   rules that haven't passed the full suite.
5. Report the passing test summary to the owner before committing.

Add an npm script like `"test:rules": "firebase emulators:exec --only firestore 'node firestore.rules.test.js'"` (or use vitest/jest if simpler) so the owner can re-run it later.

---

## Section P — `src/profile.js` (new file — user profile + role helper)

Create this file. The app and AuthGate use it for all role/profile operations.

```javascript
// profile.js — user profile + role management for CalorieIQ
import { auth, db } from "./firebase.js";
import {
  doc, getDoc, setDoc, updateDoc,
  collection, query, where, getDocs, serverTimestamp,
} from "firebase/firestore";

export const ROLES = {
  CLIENT: "client",
  HEAD_TRAINER: "head_trainer",
  SUB_TRAINER: "sub_trainer",
  ADMIN: "admin",
};

const profileRef = (uid) => doc(db, "users", uid);

// Create a profile at signup. role MUST be 'client' or 'head_trainer'.
export async function createProfile({ uid, email, role, displayName = "" }) {
  if (role !== ROLES.CLIENT && role !== ROLES.HEAD_TRAINER) {
    throw new Error("Signup role must be 'client' or 'head_trainer'");
  }
  const data = {
    uid,
    email: email || "",
    displayName,
    role,
    assignedTrainerId: null,
    // a head trainer is the head of their own tree; clients have no head
    headTrainerId: role === ROLES.HEAD_TRAINER ? uid : null,
    createdAt: serverTimestamp(),
  };
  await setDoc(profileRef(uid), data, { merge: true });
  return data;
}

export async function getProfile(uid = auth.currentUser && auth.currentUser.uid) {
  if (!uid) return null;
  const snap = await getDoc(profileRef(uid));
  return snap.exists() ? snap.data() : null;
}

// True if the signed-in user has finished signup (has a profile).
export async function hasProfile(uid = auth.currentUser && auth.currentUser.uid) {
  return (await getProfile(uid)) != null;
}

// Client links to a trainer using the trainer's uid (their invite code).
export async function joinTrainer(trainerUid) {
  const uid = auth.currentUser && auth.currentUser.uid;
  if (!uid) throw new Error("Not signed in");
  await updateDoc(profileRef(uid), { assignedTrainerId: trainerUid });
}

// Trainer: get my direct clients (clients whose assignedTrainerId is me).
export async function getMyClients(trainerUid = auth.currentUser && auth.currentUser.uid) {
  if (!trainerUid) return [];
  const q = query(collection(db, "users"), where("assignedTrainerId", "==", trainerUid));
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data());
}

// Head: get my sub-trainers (users whose headTrainerId is me and role is sub_trainer).
export async function getMySubTrainers(headUid = auth.currentUser && auth.currentUser.uid) {
  if (!headUid) return [];
  const q = query(collection(db, "users"), where("headTrainerId", "==", headUid));
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data()).filter((p) => p.role === ROLES.SUB_TRAINER);
}

// This trainer's invite code (MVP = their uid).
export function myInviteCode(uid = auth.currentUser && auth.currentUser.uid) {
  return uid || "";
}
```

---

## Section A — Changes to `src/AuthGate.jsx`

Extend the existing AuthGate (don't rewrite the whole thing) to capture role at signup and
ensure every signed-in user has a profile before the app mounts:

1. Import the helpers: `import { createProfile, hasProfile, ROLES } from "./profile.js";`
2. Add a `signupRole` state (default `ROLES.CLIENT`). On the **signup** form only, show a
   simple two-option toggle: **"I'm a client"** / **"I'm a trainer"**. (Trainer maps to
   `head_trainer`.)
3. In the email/password **signup** success path, after `createUserWithEmailAndPassword`,
   call:
   `await createProfile({ uid: cred.user.uid, email: cred.user.email, role: signupRole });`
4. Profile-completion gate for Google/Anonymous and any user without a profile: after auth
   resolves to a signed-in user, check `hasProfile()`. If they have NO profile yet (e.g.
   first Google sign-in, or an account created in Session 2 before profiles existed), show a
   one-time **"Are you a trainer or a client?"** screen, then call `createProfile(...)` with
   their choice before mounting `<App/>`. Existing Session-2 accounts (like Kevin's test
   logins) will hit this screen once and get a profile — that's expected and fine.
5. Keep all existing login/signup/Google/reset behavior intact.

Implement the actual JSX/state by reading the current AuthGate.jsx and integrating cleanly
with its existing style objects. Keep it minimal and consistent with the current look.

---

## Section U — Minimal in-app UI (integrate into `src/App.jsx`)

Read App.jsx to find sensible spots; keep these MINIMAL — full dashboards are a later session.
The point here is just to make the role system usable and to prove the trainer-sees-clients
rule works end to end.

1. **Client: "Join your trainer."** Somewhere reachable (e.g. settings/profile area), if the
   signed-in user is a `client` with no `assignedTrainerId`, show a field to paste a trainer
   invite code and a "Join" button that calls `joinTrainer(code)`. Show current trainer if set.
2. **Trainer: invite code + clients list.** If the user is `head_trainer` or `sub_trainer`,
   show their invite code (from `myInviteCode()`) with a copy button, and a list of their
   clients from `getMyClients()` (show displayName/email). Clicking a client is enough to
   prove access — you don't need to build full client management here.
3. Use `getProfile()` once on load to know the current user's role, and branch the minimal UI
   on it. Don't refactor App.jsx's existing structure beyond what's needed to add these.

Keep it lightweight and clearly marked as MVP scaffolding.

---

## Section J — Blaze migration path note (WRITE this as a file; do NOT implement)

Create `docs/BLAZE_MIGRATION.md` (create the `docs/` folder) documenting how to upgrade the
role security model to Firebase custom claims later, when the project moves to the Blaze
(pay-as-you-go) plan for Stripe/AI/Cloud Storage. Contents:

- **Why migrate:** custom claims live in the signed auth token (set only by a trusted Cloud
  Function via the Admin SDK), so they can't be tampered with by the client, and reading them
  in rules is free + instant (no `get()` document reads on every protected operation). The
  current rules read role/linkage from Firestore docs via `get()`, which is fine at small
  scale but costs a billed read + latency per check as usage grows.
- **What stays the same:** the data model (role + linkage on `users/{uid}`), the app logic,
  `profile.js`, and the signup flow. No app rebuild.
- **What changes at migration (the actual steps):**
  1. Upgrade Firebase project to Blaze; set a Cloud Billing **budget + email alerts** first
     (Blaze has no default spending cap — this is the cost-safety guardrail).
  2. Write a Cloud Function (Admin SDK) that sets a custom claim `role` (and any needed
     linkage, e.g. `headTrainerId`) on a user — triggered when their profile is created or
     their role changes. Backfill existing users once.
  3. Modify `firestore.rules` to read from the token: replace doc-`get()` role checks with
     `request.auth.token.role` / `request.auth.token.headTrainerId` where possible. Keep the
     `kv` trainer-access checks (which depend on the *client's* linkage) as needed; some may
     still use a single `get()`.
  4. Move sub_trainer assignment (and head-invites-sub onboarding) into a Cloud Function so it
     can enforce two-sided consent securely (this is why head-invites-sub was deferred).
  5. Tighten profile-doc read access (currently any signed-in user) to owner + trainer chain
     + admin + a limited public trainer directory.
- **Cost-safety:** always keep budget alerts on; consider an automated kill-switch function
  that disables billing past a ceiling.

---

## Checklist

1. [ ] Create `src/profile.js` (section P).
2. [ ] Update `src/AuthGate.jsx` for role-at-signup + profile-completion gate (section A).
3. [ ] Add the minimal in-app UI to `src/App.jsx` (section U).
4. [ ] Write `firestore.rules` from the reference (section R), with null/existence guards.
       LEAVE the `REPLACE_WITH_ADMIN_UID` placeholder and tell Kevin to fill it (section H).
5. [ ] Set up the emulator + write and PASS all rules tests (section T). Iterate until green.
6. [ ] Create `docs/BLAZE_MIGRATION.md` (section J).
7. [ ] `npm run build` passes.
8. [ ] `npm run dev` runs; manually sanity-check signup role choice + trainer/client UI.
9. [ ] Report to Kevin: the passing test summary, and the two manual steps (section H).
10. [ ] PAUSE for Kevin to do section H, then (on his OK) commit and push.

---

## Section H — Manual steps for Kevin (cannot be automated)

1. **Provide the admin uid.** Kevin: get your user ID from Firebase console → Authentication →
   Users → (your account) → copy the "User UID". Paste it into `firestore.rules` where it says
   `REPLACE_WITH_ADMIN_UID`. (Claude Code can make this edit once you paste the value here.)
2. **Publish the updated rules.** After the admin uid is in and tests pass: Firebase console →
   Firestore Database → Rules → paste the new `firestore.rules` contents → Publish. (Or, if you
   later set up the Firebase CLI, `firebase deploy --only firestore:rules`.) The live site's
   access control does not change until you publish.
3. **No Vercel change needed** this session (no new env vars).

## Out of scope (future sessions)

- Full Trainer and Client dashboards (this session is minimal UI only).
- The two trial periods (client trial ~7-14 days; trainer migration trial ~30 days).
- Head-invites-sub onboarding with consent (needs Cloud Functions / Blaze).
- Stripe Connect revenue splits, AI coaching layer, meal photo storage (all Blaze-phase).
- Friendly short invite codes (MVP uses the trainer's uid).
- Custom claims (documented in section J; not implemented now).
