// profile.js — user profile + role management for Glidna
import { auth, db, functions } from "./firebase.js";
import { httpsCallable } from "firebase/functions";
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
const inviteCodeRef = (code) => doc(db, "inviteCodes", code);

// Best-effort mirror of a trainer's invite code into the `inviteCodes` lookup
// collection (doc id = code, data = { trainerUid }). This lets join-by-code
// resolve with a single doc read instead of querying all users, which in turn
// lets us lock down profile-doc reads later. Non-fatal on failure (e.g. rules
// not yet published, or a rare code collision) — `profile.inviteCode` stays the
// source of truth.
async function writeInviteCodeMirror(code, trainerUid) {
  try {
    await setDoc(inviteCodeRef(code), { trainerUid, createdAt: serverTimestamp() }, { merge: true });
  } catch (e) { /* non-fatal */ }
}

// Create a profile at signup. role MUST be 'client' or 'head_trainer'.
export async function createProfile({ uid, email, role, displayName = "", firstName = "", lastName = "" }) {
  if (role !== ROLES.CLIENT && role !== ROLES.HEAD_TRAINER) {
    throw new Error("Signup role must be 'client' or 'head_trainer'");
  }
  const first = (firstName || "").trim();
  const last = (lastName || "").trim();
  // displayName is the combined name; kept as its own field so everything that
  // shows a name keeps working.
  const dn = (displayName || `${first} ${last}`).trim();
  // If a profile already exists, this is a re-run (e.g. the role chooser shown
  // after a transient read failure) — return the existing doc UNTOUCHED instead
  // of overwriting it, which would unlink the user's trainer and restart their
  // trial clock.
  try {
    const existing = await getDoc(profileRef(uid));
    if (existing.exists() && existing.data().role) return existing.data();
  } catch (e) { /* can't read — proceed; worst case is the merge write below */ }
  const data = {
    uid,
    email: email || "",
    firstName: first,
    lastName: last,
    displayName: dn,
    role,
    assignedTrainerId: null,
    // a head trainer is the head of their own tree; clients have no head
    headTrainerId: role === ROLES.HEAD_TRAINER ? uid : null,
    createdAt: serverTimestamp(),
    // Trial: both roles get a 30-day trial at signup. Soft/informational only
    // (no hard lock) until billing (Stripe) lands with Blaze. Status moves to
    // "active" once a paid subscription exists.
    trialStartedAt: serverTimestamp(),
    trialLengthDays: 30,
    subscriptionStatus: "trial",
  };
  await setDoc(profileRef(uid), data, { merge: true });
  return data;
}

// Normalize a Firestore Timestamp / Date / number / ISO string to epoch ms.
function toMillis(v) {
  if (!v) return null;
  if (typeof v === "number") return v;
  if (typeof v.toMillis === "function") return v.toMillis();
  if (typeof v.seconds === "number") return v.seconds * 1000;
  const t = new Date(v).getTime();
  return isNaN(t) ? null : t;
}

// Trial state for a profile, or null when there's no trial to show (paid/active,
// admin, or a legacy account created before trials existed — no trialStartedAt).
export function trialInfo(profile) {
  if (!profile || profile.subscriptionStatus === "active" || profile.role === ROLES.ADMIN) return null;
  const startMs = toMillis(profile.trialStartedAt);
  if (!startMs) return null;
  const lengthDays = profile.trialLengthDays || 30;
  const endMs = startMs + lengthDays * 86400000;
  const msLeft = endMs - Date.now();
  return { lengthDays, startMs, endMs, daysLeft: Math.ceil(msLeft / 86400000), expired: msLeft <= 0, active: msLeft > 0 };
}

export async function getProfile(uid = auth.currentUser && auth.currentUser.uid) {
  if (!uid) return null;
  const snap = await getDoc(profileRef(uid));
  return snap.exists() ? snap.data() : null;
}

// ─── Premium entitlements (pre-Stripe placeholder) ───────────────────────────
// A user is "Pro" (paid) if their subscription is active OR they've been granted
// a specific entitlement (e.g. by admin, or later a Stripe webhook). The AI
// "precise food data" feature (real database values instead of estimates) is
// gated on this. Keep this in sync with functions/aichat.js isProUser().
export function isProUser(profile) {
  if (!profile) return false;
  return profile.subscriptionStatus === "active"
    || (profile.entitlements && profile.entitlements.foodAccuracy === true);
}

// Premium access (Stripe v1, S89): the AI layer (chat, photo/voice logging,
// coaching tools) is available while a subscription is active OR the trial is
// still running. trialInfo() returns null for active subs, admins, and
// pre-trial legacy accounts — all premium. Only an EXPIRED trial locks it;
// basics (manual logging, viewing data) stay free either way. Keep in sync
// with functions/aichat.js trialExpiredFor().
export function isPremium(profile) {
  if (!profile) return true; // profile still loading — never flash a lock
  if (profile.entitlements && profile.entitlements.premium === true) return true;
  const t = trialInfo(profile);
  return !t || !t.expired;
}

// A Pro user's toggle for whether the AI uses the food database (default on).
export function aiFoodDbEnabled(profile) {
  return !!profile && profile.aiFoodDbEnabled !== false;
}
export async function setAiFoodDbEnabled(enabled, uid = auth.currentUser && auth.currentUser.uid) {
  if (!uid) return;
  await updateDoc(profileRef(uid), { aiFoodDbEnabled: !!enabled });
}

// AI processing consent. Default ON — the privacy policy discloses AI features,
// and this is the switch that makes refusing them REAL rather than just stated.
// Turning it off blocks the in-app assistant AND any AI a trainer has connected
// to their own account from touching this person's data (enforced server-side in
// functions/aitools.js resolveTargetUid + the roster tools, not just hidden in
// the UI). Lives on the profile doc because the server reads it there.
// firestore.rules already restricts user-doc writes to the owner (or admin), so
// a trainer can never switch their own client's AI back on.
export function aiEnabledFor(profile) {
  return !profile || profile.aiOptOut !== true;
}
export async function setAiOptOut(optedOut, uid = auth.currentUser && auth.currentUser.uid) {
  if (!uid) return;
  // Any deliberate change also counts as having decided, so the one-time
  // prompt never reappears for someone who has already made a choice.
  await updateDoc(profileRef(uid), { aiOptOut: !!optedOut, aiChoiceAt: Date.now() });
}

// Has this person ACTIVELY chosen, rather than been defaulted? Absence means we
// have never asked. Kept separate from `aiOptOut` because "off" and "never asked"
// are different states: only the second one should raise the prompt.
export function aiChoiceMade(profile) {
  return !!(profile && profile.aiChoiceAt);
}

// True if the signed-in user has finished signup (has a profile).
export async function hasProfile(uid = auth.currentUser && auth.currentUser.uid) {
  return (await getProfile(uid)) != null;
}

// ─── Friendly invite codes ──────────────────────────────────────────────────
// A trainer's invite code is a short, readable string stored on their profile
// (the `inviteCode` field). Clients link by entering it; we resolve it back to
// the trainer's uid at join time. Replaces the old MVP scheme of sharing the
// raw 28-char uid (which still works as a fallback for already-shared codes).

// Ambiguous characters (I, O, 0, 1, L) are excluded so codes are easy to read
// and type.
const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LEN = 7;

function generateCode() {
  let s = "";
  for (let i = 0; i < CODE_LEN; i++) {
    s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  }
  return s;
}

// Display helper: "K7P9QF4" -> "K7P-9QF4". Purely cosmetic.
export function formatInviteCode(code) {
  if (!code || code.length !== CODE_LEN) return code || "";
  return `${code.slice(0, 3)}-${code.slice(3)}`;
}

// Normalize user-typed input: strip spaces/dashes, uppercase.
function normalizeCode(input) {
  return (input || "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

// Return this trainer's invite code, generating + saving a unique one if they
// don't have one yet. Safe to call on every panel load (no-op if already set).
export async function ensureInviteCode(uid = auth.currentUser && auth.currentUser.uid) {
  if (!uid) throw new Error("Not signed in");
  const snap = await getDoc(profileRef(uid));
  const prof = snap.exists() ? snap.data() : null;
  if (prof && prof.inviteCode) {
    // Backfill the lookup mirror for trainers who got their code before it existed.
    await writeInviteCodeMirror(prof.inviteCode, uid);
    return prof.inviteCode;
  }

  let code = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = generateCode();
    // Uniqueness via the lookup collection (a single doc read). 7 chars from a
    // 31-char alphabet ≈ 27B combos, so collisions are effectively impossible.
    const taken = (await getDoc(inviteCodeRef(candidate))).exists();
    if (!taken) { code = candidate; break; }
  }
  if (!code) throw new Error("Could not generate a unique invite code — try again.");

  await updateDoc(profileRef(uid), { inviteCode: code });
  await writeInviteCodeMirror(code, uid);
  return code;
}

// Client links to a trainer by entering the trainer's friendly invite code.
// Falls back to treating the input as a raw trainer uid (the old scheme) so
// codes shared before this change keep working. Validates that the target is
// actually a trainer before linking.
export async function joinTrainer(input) {
  const uid = auth.currentUser && auth.currentUser.uid;
  if (!uid) throw new Error("Not signed in");
  const raw = (input || "").trim();
  if (!raw) throw new Error("Enter your trainer's invite code first.");

  // S179: joining is server-side now. A client cannot count a trainer's roster
  // (the scoped read rules stop them reading other profiles), so the free
  // 8-client cap can only be enforced with the Admin SDK — and firestore.rules
  // no longer lets a client write assignedTrainerId to a value, so this is the
  // only path that works. Code resolution moved with it, since the server has
  // to resolve the code anyway to count the right roster.
  // LEAVING is untouched: still a plain client self-write (see leaveTrainer).
  try {
    const call = httpsCallable(functions, "joinTrainerByCode");
    const res = await call({ code: raw });
    return (res && res.data && res.data.trainerUid) || null;
  } catch (e) {
    // Callable errors arrive as "functions/<code>" with the server's message,
    // which is already written for the person reading it — pass it through
    // rather than replacing it with something vaguer.
    const msg = (e && e.message) || "";
    if (msg && !/internal/i.test(msg)) throw new Error(msg.replace(/^functions\/[a-z-]+:?\s*/i, ""));
    throw new Error("Couldn't link to that trainer just now — please try again.");
  }
}

// Trainer: get my direct clients (clients whose assignedTrainerId is me).
// Firebase restores a session ASYNCHRONOUSLY, so on a cold open auth.currentUser
// is still null for the first moments. The roster loaders run on mount, and
// defaulting to `auth.currentUser?.uid` meant they saw no uid and returned [] —
// indistinguishable from "this trainer has no clients". The trainer home then
// latched onto that (it seeds the Local Plans drawer open ONCE when the roster
// resolves empty), so a cold start showed no Connected Clients and an expanded
// plans list until a manual refresh. Waiting for auth to settle first removes
// the race for every caller.
async function signedInUid() {
  if (auth.currentUser) return auth.currentUser.uid;
  try { await auth.authStateReady(); } catch { /* older SDK — fall through */ }
  return auth.currentUser ? auth.currentUser.uid : null;
}

export async function getMyClients(trainerUid) {
  const uid = trainerUid || (await signedInUid());
  if (!uid) return [];
  const q = query(collection(db, "users"), where("assignedTrainerId", "==", uid));
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data());
}

// Head: get my sub-trainers (users whose headTrainerId is me and role is sub_trainer).
export async function getMySubTrainers(headUid) {
  const uid = headUid || (await signedInUid());   // same cold-start race as getMyClients
  if (!uid) return [];
  const q = query(collection(db, "users"), where("headTrainerId", "==", uid));
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data()).filter((p) => p.role === ROLES.SUB_TRAINER);
}

// This trainer's invite code (MVP = their uid).
export function myInviteCode(uid = auth.currentUser && auth.currentUser.uid) {
  return uid || "";
}

// Update the signed-in user's display name. Owner-only self-write (allowed by
// the existing rules: owner may update their own profile as long as role is
// unchanged).
export async function setDisplayName(name) {
  const uid = auth.currentUser && auth.currentUser.uid;
  if (!uid) throw new Error("Not signed in");
  await updateDoc(profileRef(uid), { displayName: (name || "").trim() });
}

// Update the signed-in user's first/last name (and the combined displayName).
// Owner-only self-write. Returns the combined name.
export async function setName(firstName, lastName) {
  const uid = auth.currentUser && auth.currentUser.uid;
  if (!uid) throw new Error("Not signed in");
  const first = (firstName || "").trim();
  const last = (lastName || "").trim();
  const displayName = `${first} ${last}`.trim();
  await updateDoc(profileRef(uid), { firstName: first, lastName: last, displayName });
  return displayName;
}

// Split a profile into [first, last] for editing. Prefers the stored
// firstName/lastName; falls back to splitting an older single displayName.
export function splitName(profile) {
  if (!profile) return ["", ""];
  if (profile.firstName || profile.lastName) {
    return [profile.firstName || "", profile.lastName || ""];
  }
  const dn = (profile.displayName || "").trim();
  if (!dn) return ["", ""];
  const i = dn.indexOf(" ");
  return i === -1 ? [dn, ""] : [dn.slice(0, i), dn.slice(i + 1)];
}

// Client leaves their current trainer (clears the link). Owner-only self-write.
export async function leaveTrainer() {
  const uid = auth.currentUser && auth.currentUser.uid;
  if (!uid) throw new Error("Not signed in");
  await updateDoc(profileRef(uid), { assignedTrainerId: null });
}
