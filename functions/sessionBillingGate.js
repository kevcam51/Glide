// Glidna — who may take money from a client for sessions (S178).
//
// THE LIABILITY THIS CLOSES. The session payment path has no Stripe Connect:
// every charge is created on OUR platform account, so an outside trainer's
// client money would land in Kevin's Stripe balance, Kevin would pay the
// processing fees, and there would be no mechanism to pay that trainer out.
// Invisible today only because Kevin is the sole real trainer — and it becomes
// a real problem the first time another trainer books a paid session.
//
// So session BILLING is allowlisted until Connect exists. Note this is NOT the
// Coach-tier gate from the pricing review (docs/PRICING.md S176f): that is a
// PRODUCT decision for when the feature opens to the public. This is a safety
// interlock, and it is deliberately stricter — an allowlist, not a plan check.
// When Connect ships, this list is what widens (or gives way to a tier check),
// and nothing else about the money path has to move.
//
// WHAT IS NOT GATED, ON PURPOSE:
//  • BOOKING and the cancellation policy — free for every trainer (S176f).
//    Scheduling is workspace, not money.
//  • REMOVING a saved card — never trap someone with a stored credential.
//  • PAYING AN OUTSTANDING BALANCE — a client who already owes must always be
//    able to clear it, even if their trainer is later de-listed. Blocking that
//    would strand them in a billing hold with no exit.
// Those three stay reachable no matter what this file says.

// Mirrors functions/index.js ADMIN_UIDS + firestore.rules isAdmin(). Copied
// rather than imported for the same reason the other five copies are: these
// modules load independently and a require cycle here would be worse than a
// duplicated constant. Keep in lock-step if the admin UID ever changes.
const SESSION_BILLING_UIDS = ["G7QUZ8Kat1fgyoMjdGKz4DYoVHi1"];

// May this trainer take money for sessions?
function canBillSessions(trainerUid) {
  return SESSION_BILLING_UIDS.includes(String(trainerUid || ""));
}

// Shown to a CLIENT who tries to save a card for a non-allowlisted trainer.
// Blames nobody, names no price, and points at the path that still works.
const BILLING_UNAVAILABLE_MSG =
  "Card payments aren't switched on for this trainer yet. You can still book, "
  + "reschedule and cancel sessions as usual — just settle up with them directly.";

module.exports = { SESSION_BILLING_UIDS, canBillSessions, BILLING_UNAVAILABLE_MSG };
