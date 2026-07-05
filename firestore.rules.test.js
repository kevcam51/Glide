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

console.log(`\n==== ${passed} passed, ${failed} failed ====`);
if (failures.length) console.log("FAILED:", failures.join(" | "));
await testEnv.cleanup();
if (failed > 0) process.exit(1);
