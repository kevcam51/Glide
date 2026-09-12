// The calendar feed's token, and getting it off the profile document (S224).
//
// ⚠️ WHAT WAS WRONG, because the fix only makes sense against it.
// firestore.rules makes TRAINER profiles a readable directory — any signed-in
// user may read any head_trainer/sub_trainer document, so a client can resolve
// a trainer at join time (S59). Firestore read rules are per-DOCUMENT: a field
// inside a readable document cannot be hidden. `calendarFeedToken` lived in
// exactly that document, and only Coach-and-above trainers ever hold one, so
// every token that existed sat in the class of document anyone could read.
//
// The chain was one step long. A client reads `assignedTrainerId` off their own
// profile → reads that trainer's profile → takes the token → subscribes to the
// feed, which carries EVERY session that trainer has, with the other person's
// NAME in the summary and the training LOCATION beside it. It also quietly
// undid S203, which kept meeting addresses OUT of the profile precisely so a
// trainer working from home would not publish their home address — the address
// still reached the feed by way of the session.
//
// The fix moves the token to a collection with no rules block, which Firestore
// denies by default. The migration is what this suite mostly tests, because a
// migration that loses a token silently kills a calendar subscription someone
// set up months ago and will not notice until they miss a session.
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FN = readFileSync(join(ROOT, "functions/calendarFeed.js"), "utf8");
const RULES = readFileSync(join(ROOT, "firestore.rules"), "utf8");

let checks = 0, fails = 0;
const ok = (n, c, x) => { checks++; if (!c) { fails++; console.log("  FAIL:", n, x !== undefined ? JSON.stringify(x) : ""); } };

// ── 1. The shape of the fix ─────────────────────────────────────────────────
const coll = (FN.match(/const TOKENS = "([^"]+)"/) || [])[1];
ok("the token has its own collection", !!coll, { coll });
ok("…with NO client rules, so it is Admin-SDK only", !!coll && !RULES.includes(coll), { coll });
// Pinned so that whoever changes the directory rule sees why this exists.
ok("the trainer-directory read rule is what makes that necessary",
   /resource\.data\.role in \['head_trainer', 'sub_trainer'\]/.test(RULES));
// ⚠️ The regression that matters: a token written back to the profile.
ok("the token is never WRITTEN to the profile document",
   !/users\/\$\{uid\}`\)\.set\(\{[^}]*calendarFeedToken/.test(FN)
   && !/calendarFeedToken: token/.test(FN));
ok("the legacy field is actively DELETED, not just abandoned",
   /calendarFeedToken: admin\.firestore\.FieldValue\.delete\(\)/.test(FN));
// ⚠️ Both paths migrate. Mint-only would leave a trainer who never reopens the
// calendar screen exposed indefinitely.
// ⚠️ COUNT THE CALLS, NOT THE MENTIONS — and this bit me three separate times
// today. `/readToken\(db, uid\)/` also matches the function's own DECLARATION,
// so deleting one of the two call sites still left two hits and the assertion
// stayed green while the read path stopped migrating. `await` is what
// distinguishes a call from the definition here.
{
  const calls = (FN.match(/await readToken\(db, uid\)/g) || []).length;
  ok("both the feed READ path and the mint path migrate", calls === 2, { calls });
}

// ── 2. RUN the migration ────────────────────────────────────────────────────
function lift(name) {
  const start = FN.indexOf(`async function ${name}(`);
  if (start === -1) return null;
  let p = 0, sigEnd = -1;
  for (let j = FN.indexOf("(", start); j < FN.length; j++) {
    const ch = FN[j];
    if (ch === "(") p++; else if (ch === ")") { p--; if (!p) { sigEnd = j; break; } }
  }
  let d = 0, end = -1;
  for (let j = FN.indexOf("{", sigEnd); j < FN.length; j++) {
    const ch = FN[j];
    if (ch === "{") d++; else if (ch === "}") { d--; if (!d) { end = j + 1; break; } }
  }
  return end > start ? FN.slice(start, end) : null;
}
const src = lift("readToken");
ok("readToken lifts cleanly", !!src && src.includes("return legacy"), src ? src.length : 0);

const DELETE = Symbol("delete");
// ⚠️ THE DOUBLE HONOURS {merge:true} AND FIELD DELETES. A double that always
// replaces on set has hidden the same class of bug in this repo twice — it makes
// a merge-vs-replace mistake invisible, which is exactly the mistake a migration
// is most likely to make.
const makeDb = ({ failCopy = false, failDelete = false } = {}) => {
  const docs = new Map();
  const db = {
    doc(path) {
      return {
        async get() { return { data: () => (docs.has(path) ? { ...docs.get(path) } : undefined) }; },
        async set(obj, opts) {
          if (failCopy) throw new Error("copy failed");
          const prev = (opts && opts.merge && docs.get(path)) || {};
          docs.set(path, { ...prev, ...obj });
        },
        async update(obj) {
          if (failDelete) throw new Error("delete failed");
          const cur = { ...(docs.get(path) || {}) };
          for (const [k, v] of Object.entries(obj)) { if (v === DELETE) delete cur[k]; else cur[k] = v; }
          docs.set(path, cur);
        },
      };
    },
  };
  return { db, docs };
};
const fakeAdmin = { firestore: { FieldValue: { delete: () => DELETE } } };
const run = (db, uid) =>
  new Function("db", "uid", "admin", "TOKENS", "console",
    `${src}; return readToken(db, uid);`)(db, uid, fakeAdmin, coll, { error() {} });

{
  // Already migrated: read straight from the new collection, touch nothing else.
  const { db, docs } = makeDb();
  docs.set(`${coll}/u1`, { uid: "u1", token: "NEW" });
  docs.set("users/u1", { role: "head_trainer", displayName: "Kev" });
  const t = await run(db, "u1");
  ok("a migrated token is returned from the new collection", t === "NEW", t);
  ok("…and the profile is left alone", docs.get("users/u1").displayName === "Kev");
}
{
  // ⚠️ THE CENTRAL CASE: a legacy token on the profile.
  const { db, docs } = makeDb();
  docs.set("users/u2", { role: "head_trainer", displayName: "Kev", calendarFeedToken: "OLD", calendarFeedAt: 123 });
  const t = await run(db, "u2");
  ok("a legacy token still works", t === "OLD", t);
  ok("…is copied to the safe collection", docs.get(`${coll}/u2`).token === "OLD");
  // This line IS the fix.
  ok("…and is REMOVED from the readable profile",
     !("calendarFeedToken" in docs.get("users/u2")), docs.get("users/u2"));
  ok("…along with its timestamp", !("calendarFeedAt" in docs.get("users/u2")));
  // ⚠️ The rest of the profile must survive — an `update` that replaced instead
  // of merging would wipe the person's name, role and trainer links.
  ok("…while the rest of the profile survives intact",
     docs.get("users/u2").displayName === "Kev" && docs.get("users/u2").role === "head_trainer",
     docs.get("users/u2"));
  // The URL is uid+token, so an unchanged token means nobody re-subscribes.
  ok("the token VALUE is unchanged, so live subscriptions keep working", t === "OLD");
}
{
  // Nothing anywhere.
  const { db } = makeDb();
  ok("no token anywhere returns null", (await run(db, "u3")) === null);
}
{
  // ⚠️ COPY-THEN-DELETE, PROVEN BY BREAKING THE COPY. If the order were reversed,
  // a failed copy would have already destroyed a working subscription.
  const { db, docs } = makeDb({ failCopy: true });
  docs.set("users/u4", { role: "head_trainer", calendarFeedToken: "OLD" });
  const t = await run(db, "u4");
  ok("a failed copy still returns the token, so the feed keeps working", t === "OLD", t);
  ok("…and does NOT delete the only copy that exists",
     docs.get("users/u4").calendarFeedToken === "OLD", docs.get("users/u4"));
}
{
  // A failed delete leaves it exposed for one more request — acceptable, and
  // strictly better than breaking the feed.
  const { db, docs } = makeDb({ failDelete: true });
  docs.set("users/u5", { role: "head_trainer", calendarFeedToken: "OLD" });
  const t = await run(db, "u5");
  ok("a failed delete still returns the token", t === "OLD", t);
  ok("…and the copy is safely in place for the next attempt",
     docs.get(`${coll}/u5`).token === "OLD");
}
{
  // Migration is idempotent — a second poll must not undo the first.
  const { db, docs } = makeDb();
  docs.set("users/u6", { role: "head_trainer", calendarFeedToken: "OLD" });
  await run(db, "u6");
  const second = await run(db, "u6");
  ok("a second read is a plain read of the new location", second === "OLD", second);
  ok("…and the profile stays clean", !("calendarFeedToken" in docs.get("users/u6")));
}

// ── 3. The mint path ────────────────────────────────────────────────────────
ok("a new token is written to the safe collection",
   /db\.doc\(`\$\{TOKENS\}\/\$\{uid\}`\)\.set\(\{ uid, token, at: Date\.now\(\) \}/.test(FN));
// ⚠️ `existing`, not the profile field — which is now always absent, so the old
// expression would have told every trainer their link had just been rotated.
ok("the gate and the rotated flag both read the migrated token",
   /if \(!existing && !bookingAllowed/.test(FN) && /rotated: !!reset \|\| !existing/.test(FN));
ok("the compare is still timing-safe behind a length check",
   /expected\.length === token\.length/.test(FN) && /crypto\.timingSafeEqual/.test(FN));

console.log(`${checks - fails}/${checks} calendar-token assertions passed`);
if (fails) process.exit(1);
