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
