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

// ── 4. Turning the subscription off (S225) ──────────────────────────────────
// Reset only ever swapped one live link for another, so there was no way to end
// up with none — which someone who tried the feature and decided against it
// should be able to do, and which is also what a person wants when they think a
// link has leaked.
const APP = readFileSync(join(ROOT, "src/App.jsx"), "utf8");
ok("the callable accepts a remove request", /\(request\.data \|\| \{\}\)\.remove === true/.test(FN));
ok("…and deletes the stored token", /\$\{TOKENS\}\/\$\{uid\}`\)\.delete\(\)/.test(FN));
ok("…returning no link rather than a fresh one", /removed: true, url: null/.test(FN));
{
  // Order is the whole correctness of this. readToken must run FIRST so a legacy
  // token still on the profile is migrated before the delete — otherwise "turn
  // it off" would delete the safe copy and leave the EXPOSED one behind, which
  // is precisely backwards.
  const migrateAt = FN.indexOf("const existing = await readToken(db, uid);");
  const removeAt = FN.indexOf("remove === true");
  const gateAt = FN.indexOf("!existing && !bookingAllowed");
  ok("the legacy token is migrated BEFORE a remove can delete it",
     migrateAt !== -1 && migrateAt < removeAt, { migrateAt, removeAt });
  // And an off-plan trainer must still be able to turn theirs off — a gate that
  // ran first would trap them with a live credential they cannot revoke.
  ok("remove is reachable without an active plan", removeAt < gateAt, { removeAt, gateAt });
}
ok("the screen offers turning it off", /Don&rsquo;t want this\? Turn it off/.test(APP));
ok("…behind a confirm, since it breaks any calendar already subscribed",
   /Turn off calendar subscribing\?/.test(APP));
ok("…and says it can be switched back on", /switch it back on whenever you like/.test(APP));
ok("the app sends the remove flag", /callCalendarLink\(\{ remove: true \}\)/.test(APP));
ok("…and clears the link locally so the screen matches the server",
   /setLink\(null\); setConfirmOff\(false\)/.test(APP));

// ── 5. Findability (S226) ───────────────────────────────────────────────────
// A client's ONLY route to this is the ≡ menu, and it was rendering below the
// master switch and twenty per-type toggles — far enough down that the feature
// was effectively hidden from the people who most need it.
{
  const mounts = (APP.match(/<CalendarSubscribe \/>/g) || []).length;
  ok("it is still offered in both places (menu and the calendar page)", mounts === 2, mounts);
  // Positional, because this is precisely the kind of thing a later edit slides
  // back down the file without anyone noticing.
  const menuMount = APP.lastIndexOf("<CalendarSubscribe />");
  const toggleList = APP.indexOf("types.map((ty) => {");
  const master = APP.indexOf("All notifications");
  ok("in the menu it renders BEFORE the toggle list",
     menuMount !== -1 && toggleList !== -1 && menuMount < toggleList, { menuMount, toggleList });
  ok("…and before the master switch, so it is the first thing in the section",
     menuMount < master, { menuMount, master });
}

// ── 6. The prompt on the calendar page (S227) ───────────────────────────────
// Kevin ruled out a dedicated menu row — the side menu is already about nineteen
// items — so the discoverable place is the top of the calendar itself, where a
// trainer already is when the thought occurs to them.
{
  ok("the calendar page offers it up front",
     /See these sessions in your own calendar/.test(APP));
  ok("…naming the apps people actually use", /Apple, Google or Outlook/.test(APP));
  // Above the view chips, or it is not "at the top" in any useful sense.
  const hintAt = APP.indexOf("See these sessions in your own calendar");
  const chipsAt = APP.indexOf('{["month", "week", "day", "ledger"].map');
  ok("it renders ABOVE the month/week/day chips", hintAt !== -1 && hintAt < chipsAt, { hintAt, chipsAt });
  // ⚠️ A prompt that cannot be dismissed is an advert. Both answers — acting on
  // it and waving it away — must silence it for good on that device.
  // check:weak flagged a single /glidna-cal-subscribe-hint/ here: it matched the
  // read AND the write, so losing either one would have left it green. They are
  // two different promises — the write dismisses it, the read is what makes the
  // dismissal survive a reload — so they get an assertion each.
  ok("dismissing it is recorded",
     /localStorage\.setItem\("glidna-cal-subscribe-hint", "1"\)/.test(APP));
  ok("…and read back on mount, so it stays gone after a reload",
     /localStorage\.getItem\("glidna-cal-subscribe-hint"\) === "1"/.test(APP));
  ok("…and acting on it also dismisses it, so it never nags twice",
     /setShowSettings\(true\); setPolicyDraft\(policy\); dismissCalHint\(\);/.test(APP));
  ok("…and it hides while the settings panel it opens is showing",
     /showCalHint && !showSettings/.test(APP));
  // Landing on reminder lead-times after tapping "set up your calendar" would be
  // a small broken promise, so the panel opens onto the calendar card.
  const settingsBlock = APP.slice(APP.indexOf("Personal first: reminders"), APP.indexOf("Personal first: reminders") + 1400);
  ok("the settings panel opens onto the calendar card, not the reminders",
     settingsBlock.indexOf("<CalendarSubscribe />") < settingsBlock.indexOf("<SessionReminderPrefs"),
     { cal: settingsBlock.indexOf("<CalendarSubscribe />"), rem: settingsBlock.indexOf("<SessionReminderPrefs") });
}

console.log(`${checks - fails}/${checks} calendar-token assertions passed`);
if (fails) process.exit(1);
