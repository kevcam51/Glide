// Firestore security-rules tests for CalorieIQ (Session 3 role system).
//
// Run via:  npm run test:rules
// which boots the Firestore emulator and runs this file against firestore.rules.
//
// ADMIN_UID below must match the admin uid hardcoded in firestore.rules so the
// admin-path cases are exercised. The .replace() also handles the case where
// the rules still carry the "REPLACE_WITH_ADMIN_UID" placeholder (it becomes a
// no-op once the real uid is in place). The emulator is ephemeral, so this only
// ever touches a throwaway test database, never the live project.

import { readFileSync } from "node:fs";
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, query, where, getDocs } from "firebase/firestore";

const ADMIN_UID = "G7QUZ8Kat1fgyoMjdGKz4DYoVHi1";

const rules = readFileSync("firestore.rules", "utf8").replace(
  "REPLACE_WITH_ADMIN_UID",
  ADMIN_UID,
);

const testEnv = await initializeTestEnvironment({
  projectId: "calorieiq-rules-test",
  firestore: { rules },
});

// ---- tiny test runner -------------------------------------------------------
let passed = 0;
let failed = 0;
const failures = [];
async function check(name, promise) {
  try {
    await promise;
    passed++;
    console.log("  ✓", name);
  } catch (e) {
    failed++;
    failures.push(name);
    console.log("  ✗", name, "—", e.message);
  }
}

// ---- fixtures (uids) --------------------------------------------------------
const H = "head_H"; // head trainer
const S = "sub_S"; // sub trainer under H
const T2 = "trainer_T2"; // unrelated head trainer
const C1 = "client_C1"; // client assigned directly to H
const C2 = "client_C2"; // client assigned to S (whose head is H)
const C3 = "client_C3"; // unrelated client, no trainer

// ---- seed (rules disabled, like a trusted backend) --------------------------
await testEnv.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  await setDoc(doc(db, "users", ADMIN_UID), { uid: ADMIN_UID, email: "admin@x.co", role: "admin", assignedTrainerId: null, headTrainerId: null });
  await setDoc(doc(db, "users", H), { uid: H, email: "h@x.co", role: "head_trainer", assignedTrainerId: null, headTrainerId: H });
  await setDoc(doc(db, "users", S), { uid: S, email: "s@x.co", role: "sub_trainer", assignedTrainerId: null, headTrainerId: H });
  await setDoc(doc(db, "users", T2), { uid: T2, email: "t2@x.co", role: "head_trainer", assignedTrainerId: null, headTrainerId: T2 });
  await setDoc(doc(db, "users", C1), { uid: C1, email: "c1@x.co", role: "client", assignedTrainerId: H, headTrainerId: null });
  await setDoc(doc(db, "users", C2), { uid: C2, email: "c2@x.co", role: "client", assignedTrainerId: S, headTrainerId: null });
  await setDoc(doc(db, "users", C3), { uid: C3, email: "c3@x.co", role: "client", assignedTrainerId: null, headTrainerId: null });
  for (const u of [C1, C2, C3, T2]) {
    await setDoc(doc(db, "users", u, "kv", "caliq-index"), { k: "caliq-index", value: "[]" });
  }
  // An invite code already claimed by head trainer H (for hijack/read tests).
  await setDoc(doc(db, "inviteCodes", "HEADCODE"), { trainerUid: H, createdAt: 1 });
});

// ---- auth contexts ----------------------------------------------------------
const ctx = (uid) => testEnv.authenticatedContext(uid).firestore();
const admin = ctx(ADMIN_UID);
const head = ctx(H);
const t2 = ctx(T2);
const c1 = ctx(C1);
const c3 = ctx(C3);
const anon = testEnv.unauthenticatedContext().firestore();

const kv = (db, owner) => doc(db, "users", owner, "kv", "caliq-index");
const prof = (db, owner) => doc(db, "users", owner);

console.log("\nKV ACCESS — ALLOWED:");
await check("owner reads own kv", assertSucceeds(getDoc(kv(c1, C1))));
await check("owner writes own kv", assertSucceeds(setDoc(kv(c1, C1), { k: "caliq-index", value: "[1]" })));
await check("direct trainer (head) reads own client's kv", assertSucceeds(getDoc(kv(head, C1))));
await check("direct trainer (head) writes own client's kv", assertSucceeds(setDoc(kv(head, C1), { k: "caliq-index", value: "[2]" })));
await check("head reads kv of client assigned to his sub", assertSucceeds(getDoc(kv(head, C2))));
await check("head writes kv of client assigned to his sub", assertSucceeds(setDoc(kv(head, C2), { k: "caliq-index", value: "[3]" })));
await check("admin reads anyone's kv", assertSucceeds(getDoc(kv(admin, C2))));
await check("admin writes anyone's kv", assertSucceeds(setDoc(kv(admin, C1), { k: "caliq-index", value: "[4]" })));

console.log("\nKV ACCESS — DENIED:");
await check("unrelated trainer reads another trainer's client kv", assertFails(getDoc(kv(t2, C1))));
await check("client X reads client Y's kv", assertFails(getDoc(kv(c1, C2))));
await check("signed-out reads kv", assertFails(getDoc(kv(anon, C1))));
await check("head reads kv of a DIFFERENT head's sub's client", assertFails(getDoc(kv(t2, C2))));
await check("head reads unrelated trainer's own kv", assertFails(getDoc(kv(head, T2))));
await check("signed-out writes kv", assertFails(setDoc(kv(anon, C1), { k: "caliq-index", value: "x" })));

console.log("\nPROFILE — self-promotion DENIED:");
await check("client updates own role -> head_trainer", assertFails(updateDoc(prof(c1, C1), { role: "head_trainer" })));
await check("client updates own role -> admin", assertFails(updateDoc(prof(c1, C1), { role: "admin" })));
await check("client updates own role -> sub_trainer", assertFails(updateDoc(prof(c1, C1), { role: "sub_trainer" })));

console.log("\nPROFILE — create rules:");
await check("create own profile as client", assertSucceeds(setDoc(prof(ctx("new_c"), "new_c"), { uid: "new_c", email: "n@x.co", role: "client", assignedTrainerId: null, headTrainerId: null })));
await check("create own profile as head_trainer", assertSucceeds(setDoc(prof(ctx("new_h"), "new_h"), { uid: "new_h", email: "nh@x.co", role: "head_trainer", assignedTrainerId: null, headTrainerId: "new_h" })));
await check("create profile with role=admin DENIED", assertFails(setDoc(prof(ctx("evil1"), "evil1"), { uid: "evil1", email: "e@x.co", role: "admin", assignedTrainerId: null, headTrainerId: null })));
await check("create profile with role=sub_trainer DENIED", assertFails(setDoc(prof(ctx("evil2"), "evil2"), { uid: "evil2", email: "e2@x.co", role: "sub_trainer", assignedTrainerId: null, headTrainerId: null })));
await check("create profile for a DIFFERENT uid DENIED", assertFails(setDoc(prof(ctx("evil3"), "someone_else"), { uid: "someone_else", email: "e3@x.co", role: "client", assignedTrainerId: null, headTrainerId: null })));
await check("create profile where uid field != docId DENIED", assertFails(setDoc(prof(ctx("evil4"), "evil4"), { uid: "not_evil4", email: "e4@x.co", role: "client", assignedTrainerId: null, headTrainerId: null })));

console.log("\nPROFILE — read access (scoped):");
await check("owner reads own profile", assertSucceeds(getDoc(prof(c1, C1))));
await check("brand-new user reads own (not-yet-created) profile — signup path", assertSucceeds(getDoc(prof(ctx("fresh_signup_uid"), "fresh_signup_uid"))));
await check("signed-in user CANNOT read a stranger's non-existent profile", assertFails(getDoc(prof(c1, "nonexistent_other_uid"))));
await check("trainer reads own client's profile", assertSucceeds(getDoc(prof(head, C1))));
await check("client reads their trainer's profile (directory)", assertSucceeds(getDoc(prof(c1, H))));
await check("any signed-in user reads a trainer's profile (join directory)", assertSucceeds(getDoc(prof(c3, T2))));
await check("head reads their sub-trainer's profile", assertSucceeds(getDoc(prof(head, S))));
await check("client CANNOT read another client's profile", assertFails(getDoc(prof(c1, C2))));
await check("unrelated trainer CANNOT read a client they don't train", assertFails(getDoc(prof(t2, C1))));
await check("signed-out cannot read any profile", assertFails(getDoc(prof(anon, C1))));
await check("signed-out cannot read a trainer profile", assertFails(getDoc(prof(anon, H))));

console.log("\nPROFILE — list queries:");
const usersCol = (db) => collection(db, "users");
await check("trainer lists own clients (assignedTrainerId==me)", assertSucceeds(getDocs(query(usersCol(head), where("assignedTrainerId", "==", H)))));
await check("head lists own sub-trainers (headTrainerId==me)", assertSucceeds(getDocs(query(usersCol(head), where("headTrainerId", "==", H)))));
await check("trainer CANNOT list another trainer's clients", assertFails(getDocs(query(usersCol(t2), where("assignedTrainerId", "==", H)))));
await check("client CANNOT list all users (unconstrained)", assertFails(getDocs(usersCol(c1))));

console.log("\nPROFILE — update / delete:");
await check("client sets own assignedTrainerId (joins a trainer)", assertSucceeds(updateDoc(prof(c3, C3), { assignedTrainerId: H })));
await check("non-admin cannot delete a profile", assertFails(deleteDoc(prof(c1, C1))));
await check("admin can change anyone's role", assertSucceeds(updateDoc(prof(admin, S), { role: "head_trainer" })));
await check("admin can delete a profile", assertSucceeds(deleteDoc(prof(admin, C3))));

const code = (db, c) => doc(db, "inviteCodes", c);
console.log("\nINVITE CODES — lookup collection:");
await check("trainer claims a new code pointing to self", assertSucceeds(setDoc(code(head, "NEWHEAD"), { trainerUid: H, createdAt: 2 })));
await check("any signed-in user reads a code", assertSucceeds(getDoc(code(c1, "HEADCODE"))));
await check("owner refreshes own existing code", assertSucceeds(setDoc(code(head, "HEADCODE"), { trainerUid: H, createdAt: 3 })));
await check("cannot claim a code pointing to someone else", assertFails(setDoc(code(t2, "T2FAKE"), { trainerUid: H, createdAt: 4 })));
await check("cannot hijack another trainer's existing code", assertFails(setDoc(code(t2, "HEADCODE"), { trainerUid: T2, createdAt: 5 })));
await check("signed-out cannot read a code", assertFails(getDoc(code(anon, "HEADCODE"))));
await check("signed-out cannot claim a code", assertFails(setDoc(code(anon, "ANONCODE"), { trainerUid: "x", createdAt: 6 })));

console.log("\nPROFILE — billing/trial lockdown (S85: these fields drive the AI budget tier + Pro gate):");
await check("owner CANNOT self-upgrade subscriptionStatus", assertFails(updateDoc(prof(c1, C1), { subscriptionStatus: "active" })));
await check("owner CANNOT self-grant entitlements", assertFails(updateDoc(prof(c1, C1), { entitlements: { foodAccuracy: true } })));
await check("owner CANNOT restart their trial clock", assertFails(updateDoc(prof(c1, C1), { trialStartedAt: 12345 })));
await check("owner CANNOT extend trialLengthDays", assertFails(updateDoc(prof(c1, C1), { trialLengthDays: 9999 })));
await check("owner still updates normal fields (displayName)", assertSucceeds(updateDoc(prof(c1, C1), { displayName: "New Name" })));
await check("admin can set subscriptionStatus", assertSucceeds(updateDoc(prof(admin, C1), { subscriptionStatus: "active" })));
await check("signup create WITH normal trial fields allowed", assertSucceeds(setDoc(prof(ctx("new_c2"), "new_c2"), { uid: "new_c2", email: "n2@x.co", role: "client", assignedTrainerId: null, headTrainerId: null, subscriptionStatus: "trial", trialStartedAt: 1, trialLengthDays: 30 })));
await check("signup create with subscriptionStatus=active DENIED", assertFails(setDoc(prof(ctx("evil5"), "evil5"), { uid: "evil5", email: "e5@x.co", role: "client", subscriptionStatus: "active" })));
await check("signup create with entitlements DENIED", assertFails(setDoc(prof(ctx("evil6"), "evil6"), { uid: "evil6", email: "e6@x.co", role: "client", entitlements: { foodAccuracy: true } })));

console.log("\nINVITE CODES — enumeration (S85: codes are capability tokens, no harvesting):");
await check("non-admin CANNOT list all invite codes", assertFails(getDocs(collection(c1, "inviteCodes"))));
await check("admin can list invite codes", assertSucceeds(getDocs(collection(admin, "inviteCodes"))));
await check("create code with unexpected extra fields DENIED", assertFails(setDoc(code(head, "EXTRAF"), { trainerUid: H, createdAt: 9, evil: true })));

// ---- In-app messaging (S90, docs/MESSAGING-PLAN.md) -------------------------
// threads/{trainerUid}_{clientUid}: participants-only access, create requires a
// REAL trainer↔client link, msgs are append-only with no impersonation.
const threadDoc = (db, t, c) => doc(db, "threads", `${t}_${c}`);
const msgCol = (db, t, c) => collection(db, "threads", `${t}_${c}`, "msgs");
const threadFields = (t, c) => ({ participants: [t, c], trainerUid: t, clientUid: c,
  lastMsg: "", lastFrom: t, updatedAt: 1, unread: { [t]: 0, [c]: 0 } });
const c2 = ctx(C2);

console.log("\nMESSAGING — ALLOWED:");
await check("trainer creates thread with own client", assertSucceeds(setDoc(threadDoc(head, H, C1), threadFields(H, C1))));
await check("client creates thread with own trainer", assertSucceeds(setDoc(threadDoc(c2, S, C2), threadFields(S, C2))));
await check("head creates thread with his SUB's client", assertSucceeds(setDoc(threadDoc(head, H, C2), threadFields(H, C2))));
await check("participant (trainer) sends a message", assertSucceeds(setDoc(doc(msgCol(head, H, C1), "m1"), { from: H, text: "How was the workout?", ts: 1 })));
await check("participant (client) sends a message", assertSucceeds(setDoc(doc(msgCol(c1, H, C1), "m2"), { from: C1, text: "Great!", ts: 2 })));
await check("other participant reads the thread", assertSucceeds(getDoc(threadDoc(c1, H, C1))));
await check("other participant reads messages", assertSucceeds(getDoc(doc(msgCol(c1, H, C1), "m1"))));
await check("participant updates thread metadata (lastMsg/unread)", assertSucceeds(updateDoc(threadDoc(c1, H, C1), { lastMsg: "Great!", lastFrom: C1, updatedAt: 2, unread: { [H]: 1, [C1]: 0 } })));
await check("participant lists own threads (array-contains query)", assertSucceeds(getDocs(query(collection(c1, "threads"), where("participants", "array-contains", C1)))));

console.log("\nMESSAGING — DENIED (attack cases):");
await check("unlinked trainer creates thread with a stranger's client", assertFails(setDoc(threadDoc(t2, T2, C1), threadFields(T2, C1))));
await check("client creates thread with a trainer who is NOT theirs", assertFails(setDoc(threadDoc(c3, H, C3), threadFields(H, C3))));
await check("creator not in participants (spoofed pair)", assertFails(setDoc(threadDoc(t2, H, C1), threadFields(H, C1))));
await check("thread id not matching participants DENIED", assertFails(setDoc(doc(head, "threads", "whatever"), threadFields(H, C1))));
await check("non-participant reads a thread", assertFails(getDoc(threadDoc(t2, H, C1))));
await check("non-participant reads messages", assertFails(getDoc(doc(msgCol(t2, H, C1), "m1"))));
await check("non-participant sends a message", assertFails(setDoc(doc(msgCol(t2, H, C1), "evil"), { from: T2, text: "spam", ts: 3 })));
await check("forged from — participant sends as the OTHER person", assertFails(setDoc(doc(msgCol(head, H, C1), "forged"), { from: C1, text: "I quit", ts: 4 })));
await check("participant tampers with participants list", assertFails(updateDoc(threadDoc(c1, H, C1), { participants: [C1, C3] })));
await check("lastFrom outside participants DENIED", assertFails(updateDoc(threadDoc(c1, H, C1), { lastFrom: T2, updatedAt: 3 })));
await check("oversized message text (2001 chars) DENIED", assertFails(setDoc(doc(msgCol(c1, H, C1), "big"), { from: C1, text: "x".repeat(2001), ts: 5 })));
await check("message with extra fields DENIED", assertFails(setDoc(doc(msgCol(c1, H, C1), "extra"), { from: C1, text: "hi", ts: 6, evil: true })));
await check("message EDIT denied (append-only)", assertFails(updateDoc(doc(msgCol(c1, H, C1), "m2"), { text: "edited" })));
await check("message DELETE by participant denied", assertFails(deleteDoc(doc(msgCol(c1, H, C1), "m2"))));
await check("signed-out reads a thread", assertFails(getDoc(threadDoc(anon, H, C1))));
await check("signed-out sends a message", assertFails(setDoc(doc(msgCol(anon, H, C1), "anonm"), { from: H, text: "hi", ts: 7 })));
await check("unconstrained threads list DENIED", assertFails(getDocs(collection(t2, "threads"))));

// ---- Private storage (S91, notes): users/{uid}/privkv — OWNER ONLY ---------
// The whole point: a client's private notes are invisible to the trainer chain
// that CAN read their kv. Every kv-style access path must DENY here.
const priv = (db, owner) => doc(db, "users", owner, "privkv", "caliq-notes");

console.log("\nPRIVATE STORAGE (privkv) — owner only:");
await check("owner writes own private notes", assertSucceeds(setDoc(priv(c1, C1), { k: "caliq-notes", value: "[]" })));
await check("owner reads own private notes", assertSucceeds(getDoc(priv(c1, C1))));
await check("DIRECT TRAINER cannot read client's private notes", assertFails(getDoc(priv(head, C1))));
await check("HEAD (of sub's client) cannot read private notes", assertFails(getDoc(priv(head, C2))));
await check("direct trainer cannot WRITE client's private notes", assertFails(setDoc(priv(head, C1), { k: "caliq-notes", value: "[]" })));
await check("another client cannot read private notes", assertFails(getDoc(priv(c3, C1))));
await check("ADMIN (client SDK) cannot read private notes", assertFails(getDoc(priv(admin, C1))));
await check("signed-out cannot read private notes", assertFails(getDoc(priv(anon, C1))));
await check("unconstrained privkv list denied", assertFails(getDocs(collection(head, "users", C1, "privkv"))));

// ---- Training sessions (S100) — sessions/{sid} -----------------------------
// The trainer books; either side cancels; BILLING FIELDS ARE SERVER-ONLY.
const sess = (db, sid) => doc(db, "sessions", sid);
const booking = (over = {}) => ({
  participants: [H, C1], trainerUid: H, clientUid: C1,
  startAt: 1800000000000, durationMin: 60, status: "scheduled",
  title: "Upper body", location: "Studio", priceCents: 7500,
  createdBy: H, createdAt: 1, updatedAt: 1, ...over,
});
const c2ctx = ctx(C2);

console.log("\nSESSIONS — booking ALLOWED:");
await check("trainer books a session with own client", assertSucceeds(setDoc(sess(head, "s1"), booking())));
await check("trainer reads that session", assertSucceeds(getDoc(sess(head, "s1"))));
await check("the client reads their own session", assertSucceeds(getDoc(sess(c1, "s1"))));
await check("trainer reschedules (startAt + duration)", assertSucceeds(updateDoc(sess(head, "s1"), { startAt: 1800003600000, durationMin: 45, updatedAt: 2 })));
await check("trainer re-prices the session", assertSucceeds(updateDoc(sess(head, "s1"), { priceCents: 9000, updatedAt: 3 })));
await check("head books for client of his sub", assertSucceeds(setDoc(sess(head, "s2"), booking({ participants: [H, C2], clientUid: C2 }))));
// cancelledAt must be ~server time (S100b anti-backdating rule), so these use
// a real clock rather than the placeholder integers the rest of the fixtures use.
await check("client cancels their own session", assertSucceeds(updateDoc(sess(c1, "s1"), { status: "cancelled", cancelledBy: C1, cancelledAt: Date.now(), updatedAt: Date.now() })));
await check("trainer cancels a session", assertSucceeds(updateDoc(sess(head, "s2"), { status: "cancelled", cancelledBy: H, cancelledAt: Date.now(), updatedAt: Date.now() })));

console.log("\nSESSIONS — booking DENIED:");
await check("CLIENT cannot create a session", assertFails(setDoc(sess(c1, "bad1"), booking({ createdBy: C1 }))));
await check("trainer books for a client who isn't theirs", assertFails(setDoc(sess(t2, "bad2"), booking({ participants: [T2, C1], trainerUid: T2, createdBy: T2 }))));
await check("trainer books for an UNLINKED client", assertFails(setDoc(sess(head, "bad3"), booking({ participants: [H, C3], clientUid: C3 }))));
await check("booking with mismatched participants array", assertFails(setDoc(sess(head, "bad4"), booking({ participants: [H, C3] }))));
await check("booking that starts already 'completed'", assertFails(setDoc(sess(head, "bad5"), booking({ status: "completed" }))));
await check("booking with an absurd duration", assertFails(setDoc(sess(head, "bad6"), booking({ durationMin: 5000 }))));
await check("booking with a negative price", assertFails(setDoc(sess(head, "bad7"), booking({ priceCents: -100 }))));
await check("signed-out books a session", assertFails(setDoc(sess(anon, "bad8"), booking())));
await check("unrelated trainer reads someone's session", assertFails(getDoc(sess(t2, "s1"))));
await check("unrelated client reads someone's session", assertFails(getDoc(sess(c3, "s1"))));
await check("signed-out reads a session", assertFails(getDoc(sess(anon, "s1"))));
await check("unconstrained sessions list DENIED", assertFails(getDocs(collection(t2, "sessions"))));

console.log("\nSESSIONS — BILLING FIELDS are server-only:");
await testEnv.withSecurityRulesDisabled(async (c) => {
  await setDoc(doc(c.firestore(), "sessions", "s3"), booking({ startAt: 1800007200000 }));
});
await check("trainer cannot write settled", assertFails(updateDoc(sess(head, "s3"), { settled: "package" })));
await check("trainer cannot write chargeId", assertFails(updateDoc(sess(head, "s3"), { chargeId: "pi_fake" })));
await check("trainer cannot write completedAt", assertFails(updateDoc(sess(head, "s3"), { completedAt: 9 })));
await check("CLIENT cannot write settled", assertFails(updateDoc(sess(c1, "s3"), { settled: "package" })));
await check("client cannot mark their session completed", assertFails(updateDoc(sess(c1, "s3"), { status: "completed" })));
await check("client cannot reschedule (move startAt)", assertFails(updateDoc(sess(c1, "s3"), { startAt: 1 })));
await check("client cannot change the price", assertFails(updateDoc(sess(c1, "s3"), { priceCents: 0 })));
await check("client cannot retitle the session", assertFails(updateDoc(sess(c1, "s3"), { title: "free lol" })));
await check("client cannot un-cancel by setting scheduled", assertFails(updateDoc(sess(c1, "s3"), { status: "scheduled", updatedAt: 9 })));
await check("trainer cannot reassign the session to another client", assertFails(updateDoc(sess(head, "s3"), { clientUid: C3, updatedAt: 9 })));
await check("trainer cannot rewrite participants", assertFails(updateDoc(sess(head, "s3"), { participants: [H, C3], updatedAt: 9 })));
await check("outsider cannot update a session", assertFails(updateDoc(sess(t2, "s3"), { title: "hijack" })));
await check("participant cannot DELETE a session", assertFails(deleteDoc(sess(head, "s3"))));
await check("client cannot delete a session", assertFails(deleteDoc(sess(c1, "s3"))));

// ---- S100b: cancellation policy + prepaid credits ------------------------
// Two new money-bearing surfaces, so two new attack classes.
console.log("\nSESSION CREDITS / HOLD — server-only (money in the bank):");
await check("client cannot grant self session credits", assertFails(updateDoc(prof(c1, C1), { sessionCredits: 100 })));
await check("trainer cannot grant self session credits", assertFails(updateDoc(prof(head, H), { sessionCredits: 50 })));
await check("client cannot clear own unpaid billing hold", assertFails(updateDoc(prof(c1, C1), { sessionBillingHold: false })));
await check("trainer cannot set a client's credits", assertFails(updateDoc(prof(head, C1), { sessionCredits: 10 })));
await check("signup cannot self-grant credits", assertFails(setDoc(prof(ctx("newbie_X"), "newbie_X"),
  { uid: "newbie_X", email: "n@x.co", role: "client", sessionCredits: 25 })));
await check("admin CAN set credits (the settle dispatcher's path)", assertSucceeds(updateDoc(prof(admin, C1), { sessionCredits: 5 })));

await check("client cannot forge a saved card", assertFails(updateDoc(prof(c1, C1),
  { sessionPaymentMethod: { id: "pm_fake", brand: "visa", last4: "4242" } })));
await check("client cannot repoint billing at another card", assertFails(updateDoc(prof(c1, C1),
  { sessionPaymentMethod: { id: "pm_someone_elses" } })));
await check("signup cannot self-grant a saved card", assertFails(setDoc(prof(ctx("newbie_Y"), "newbie_Y"),
  { uid: "newbie_Y", email: "y@x.co", role: "client", sessionPaymentMethod: { id: "pm_x" } })));
await check("admin CAN write the card pointer (recordSessionConsent's path)", assertSucceeds(
  updateDoc(prof(admin, C1), { sessionPaymentMethod: { id: "pm_real", brand: "visa", last4: "4242" } })));

console.log("\nCANCEL POLICY — trainer-set, client-readable:");
await check("trainer sets own cancellation window + packs", assertSucceeds(updateDoc(prof(head, H),
  { sessionPolicy: { cancelWindowHours: 48, lateCancelChargePct: 100 },
    sessionPacks: [{ id: "p10", name: "10 pack", sessions: 10, priceCents: 70000, active: true }] })));
await check("client can READ their trainer's policy (must be visible pre-purchase)", assertSucceeds(getDoc(prof(c1, H))));
await check("client cannot rewrite the trainer's policy", assertFails(updateDoc(prof(c1, H),
  { sessionPolicy: { cancelWindowHours: 0, lateCancelChargePct: 0 } })));

console.log("\nCANCEL TIMESTAMP — cannot be backdated to dodge a late fee:");
await testEnv.withSecurityRulesDisabled(async (c) => {
  await setDoc(doc(c.firestore(), "sessions", "s9"), booking({ startAt: Date.now() + 3600000 }));
});
const THREE_DAYS_AGO = Date.now() - 3 * 86400000;
await check("client BACKDATES cancelledAt 3 days to dodge the window", assertFails(updateDoc(sess(c1, "s9"),
  { status: "cancelled", cancelledBy: C1, cancelledAt: THREE_DAYS_AGO, updatedAt: Date.now() })));
await check("trainer backdates cancelledAt (symmetric — no rewriting history)", assertFails(updateDoc(sess(head, "s9"),
  { status: "cancelled", cancelledBy: H, cancelledAt: THREE_DAYS_AGO, updatedAt: Date.now() })));
await check("client post-dates cancelledAt into the future", assertFails(updateDoc(sess(c1, "s9"),
  { status: "cancelled", cancelledBy: C1, cancelledAt: Date.now() + 5 * 86400000, updatedAt: Date.now() })));
await check("honest client cancel at server time SUCCEEDS", assertSucceeds(updateDoc(sess(c1, "s9"),
  { status: "cancelled", cancelledBy: C1, cancelledAt: Date.now(), updatedAt: Date.now() })));

// ---- S101c: charge ledger + test-mode flag ---------------------------------
console.log("\nCHARGE LEDGER — participants read, nobody client-writes:");
await testEnv.withSecurityRulesDisabled(async (c) => {
  await setDoc(doc(c.firestore(), "sessionCharges", "ch1"),
    { trainerUid: H, clientUid: C1, amountCents: 7500, status: "succeeded", kind: "sessions" });
});
await check("trainer reads own charge record", assertSucceeds(getDoc(doc(head, "sessionCharges", "ch1"))));
await check("client reads own charge record", assertSucceeds(getDoc(doc(c1, "sessionCharges", "ch1"))));
await check("outsider cannot read a charge record", assertFails(getDoc(doc(t2, "sessionCharges", "ch1"))));
await check("client cannot rewrite a charge record", assertFails(updateDoc(doc(c1, "sessionCharges", "ch1"), { status: "refunded" })));
await check("trainer cannot forge a charge record", assertFails(setDoc(doc(head, "sessionCharges", "forged"), { trainerUid: H, clientUid: C1, amountCents: 99999, status: "succeeded" })));
await check("unconstrained charges list denied", assertFails(getDocs(collection(c1, "sessionCharges"))));

console.log("\nTEST-MODE FLAG — server-only (free-training hole otherwise):");
await check("client cannot set own sessionBillingTest", assertFails(updateDoc(prof(c1, C1), { sessionBillingTest: true })));
await check("trainer cannot set a client's sessionBillingTest", assertFails(updateDoc(prof(head, C1), { sessionBillingTest: true })));
await check("admin CAN set sessionBillingTest", assertSucceeds(updateDoc(prof(admin, C1), { sessionBillingTest: false })));

console.log(`\n==== ${passed} passed, ${failed} failed ====`);
if (failures.length) console.log("FAILED:", failures.join(" | "));
await testEnv.cleanup();
if (failed > 0) process.exit(1);
