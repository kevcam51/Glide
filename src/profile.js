// profile.js — user profile + role management for Glide
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
    const dupe = await getDocs(
      query(collection(db, "users"), where("inviteCode", "==", candidate))
    );
    if (dupe.empty) { code = candidate; break; }
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

  let trainerUid = null;

  // 1) Friendly-code lookup.
  const normalized = normalizeCode(raw);
  if (normalized.length === CODE_LEN) {
    const snap = await getDocs(
      query(collection(db, "users"), where("inviteCode", "==", normalized))
    );
    if (!snap.empty) trainerUid = snap.docs[0].id;
  }

  // 2) Fallback: treat the input as a raw trainer uid.
  if (!trainerUid) {
    const tSnap = await getDoc(profileRef(raw));
    if (tSnap.exists()) trainerUid = raw;
  }

  if (!trainerUid) {
    throw new Error("That code didn't match any trainer. Double-check it and try again.");
  }
  if (trainerUid === uid) {
    throw new Error("You can't link to your own account.");
  }

  // Confirm the target is a trainer before linking.
  const tProf = (await getDoc(profileRef(trainerUid))).data();
  if (!tProf || (tProf.role !== ROLES.HEAD_TRAINER && tProf.role !== ROLES.SUB_TRAINER)) {
    throw new Error("That code doesn't belong to a trainer account.");
  }

  await updateDoc(profileRef(uid), { assignedTrainerId: trainerUid });
  return trainerUid;
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
