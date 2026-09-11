// Sending a meal photo from an iPhone Shortcut (S222).
//
// The Android half (S221) rides the share sheet. Apple does not implement that
// for web apps, so on iOS the photo comes the other way: a Shortcut POSTs it to
// a private URL and it waits in the account until the app is opened.
//
// ⚠️ THE POINT OF THIS SUITE IS THE SECURITY SHAPE, NOT THE PLUMBING.
// A Shortcut cannot sign in, so the URL carries the credential — the same
// compromise the calendar feed makes (S187). The difference is that the calendar
// token only READS and this one WRITES, and Shortcuts are shared between people
// far more casually than calendar subscriptions are.
//
// That is survivable for exactly one reason: THIS ENDPOINT CANNOT LOG A MEAL.
// It parks a photo and stops. The estimate and the write still happen in the
// app behind the confirm card. If a later change ever wires logging in here, a
// leaked link stops being "junk photos you decline" and becomes "wrong numbers
// in someone's history" — so that is asserted directly, not left to review.
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FN = readFileSync(join(ROOT, "functions/mealInbox.js"), "utf8");
const IDX = readFileSync(join(ROOT, "functions/index.js"), "utf8");
const APP = readFileSync(join(ROOT, "src/App.jsx"), "utf8");

let checks = 0, fails = 0;
const ok = (n, c, x) => { checks++; if (!c) { fails++; console.log("  FAIL:", n, x !== undefined ? JSON.stringify(x) : ""); } };

// ── 1. It cannot log a meal. This is the assertion that matters most ─────────
ok("the endpoint never reaches the meal-writing tools", !/log_meal|propose_meal|runTool/.test(FN));
ok("…and never touches a day's meals array directly", !/\bmeals\b/.test(FN));
ok("…and never calls Anthropic, so a leaked link cannot burn the AI budget",
   !/anthropic|messages\.create|estimateFood/i.test(FN));
// What it DOES write: one parked photo, under its own prefix.
ok("it writes a parked photo and nothing else", /dataUrl: `data:\$\{type\};base64,/.test(FN));

// ── 2. The URL is treated as the credential it is ───────────────────────────
ok("the token is 160 bits from crypto.randomBytes", /crypto\.randomBytes\(20\)\.toString\("hex"\)/.test(FN));
ok("the compare is timing-safe", /crypto\.timingSafeEqual/.test(FN));
// ⚠️ timingSafeEqual THROWS on unequal lengths, so the length check is not
// belt-and-braces — without it a wrong-length token is a 500, not a 403.
{
  const lenAt = FN.indexOf("expected.length === token.length");
  const cmpAt = FN.indexOf("crypto.timingSafeEqual");
  ok("the length is checked BEFORE the compare", lenAt !== -1 && lenAt < cmpAt, { lenAt, cmpAt });
}
ok("a bad token is refused with 403, not a generic error", /status\(403\)/.test(FN));

// ⚠️ THE TOKEN MUST NOT LIVE ON THE PROFILE DOCUMENT. firestore.rules makes
// TRAINER profiles a readable directory — any signed-in user may read any
// head_trainer/sub_trainer doc so a client can resolve a trainer at join time
// (S59) — and Firestore read rules are per-DOCUMENT, with no way to hide one
// field. A token stored there would be readable by every signed-in account, and
// anyone could post photos into any trainer's food log. I wrote it that way
// first; these assertions exist so nobody writes it that way again.
{
  const RULES = readFileSync(join(ROOT, "firestore.rules"), "utf8");
  const coll = (FN.match(/const TOKENS = "([^"]+)"/) || [])[1];
  ok("the token has its own collection", !!coll, { coll });
  // ⚠️ THE PROFILE *DOCUMENT*, not the user's subtree. `users/${uid}/kv/...` and
  // `users/${uid}/mealInboxUsage/...` are fine and necessary — they are
  // subcollections with their own rules. The first version of this assertion
  // banned the whole path and failed against correct code.
  ok("the function never touches the profile document itself",
     !/db\.doc\(`users\/\$\{uid\}`\)/.test(FN));
  // No rules block at all = Firestore's default deny = Admin SDK only. The same
  // pattern trainerizeCreds and webauthnCreds already use for credentials.
  ok("…and that collection has NO client rules, so it is Admin-SDK only",
     !!coll && !RULES.includes(coll), { coll });
  // The directory rule this is defending against — pinned so that if it ever
  // changes, whoever changes it sees why this collection exists.
  ok("the trainer-directory read rule is still what makes that necessary",
     /resource\.data\.role in \['head_trainer', 'sub_trainer'\]/.test(RULES));
}
ok("the link is rotatable", /reset/.test(FN) && /\{ uid, token, at: Date\.now\(\) \}/.test(FN));
// ⚠️ Minting on every call would silently break the Shortcut the person already
// set up, every time they opened the panel to look at their link.
ok("a new token is minted ONLY when absent or explicitly reset",
   /if \(!token \|\| reset\)/.test(FN));
ok("the feed is not indexable", /X-Robots-Tag/.test(FN) && /no-store/.test(FN));

// ── 3. What it accepts ──────────────────────────────────────────────────────
ok("only POST", /req\.method !== "POST"/.test(FN));
ok("only images", /type\.startsWith\("image\/"\)/.test(FN));
const cap = (FN.match(/const MAX_BYTES = (\d+) \* 1024/) || [])[1];
ok("there is a size cap", !!cap);
// ⚠️ base64 inflates by 4/3 and a Firestore document tops out at 1MB. A cap
// that ignores that would produce a write failure at the worst moment — after
// the person already thinks they sent the photo.
ok("the cap leaves room for base64 inside a 1MB document",
   Number(cap) * 1024 * (4 / 3) < 1024 * 1024, { rawKB: Number(cap), storedKB: Math.round(Number(cap) * 4 / 3) });
ok("an oversized photo is told what to fix", /Resize Image/.test(FN) && /status\(413\)/.test(FN));
ok("there is a per-day rate limit", /MAX_PER_DAY/.test(FN) && /status\(429\)/.test(FN));
ok("the pending inbox is bounded", /MAX_PENDING/.test(FN) && /status\(409\)/.test(FN));
// A counter that fails must not block a real person's lunch.
ok("a rate-limit failure is logged, not fatal", /mealInbox usage error/.test(FN));

// ── 4. The kv write shape, which src/storage.js has to be able to read ──────
// ⚠️ storage.js stores `value` VERBATIM and every app caller hands it a JSON
// STRING. A native object written here reads back as the wrong shape and the
// app shows an empty inbox with nothing in the logs to explain it.
ok("the parked photo is written as {k, value} with value stringified",
   /\.set\(\{ k: key, value: JSON\.stringify\(obj\) \}\)/.test(FN));
ok("the key is encoded the way storage.js encodes it",
   /kv\/\$\{encodeURIComponent\(key\)\}/.test(FN));

// ⚠️ THE RANGE QUERY, WHICH I GOT WRONG TWICE WRITING IT.
{
  const q = (FN.match(/\.where\("k", "<=", `\$\{INBOX_PREFIX\}([^`]*)`\)/) || [])[1];
  ok("the range has an upper bound distinct from the prefix", q !== undefined && q.length > 0, { upper: q });
  // A raw pasted U+F8FF silently became an empty string once (S85) and made a
  // prefix query return nothing, with the build passing. Source must carry the
  // ESCAPE, so assert on the raw bytes of the file.
  ok("…written as the \\uf8ff ESCAPE, not a raw character",
     /\\uf8ff`\)/.test(FN) && !new RegExp(String.fromCharCode(0xf8ff)).test(FN.replace(/\\uf8ff/g, "")));
}

// ── 5. Cross-file agreement ─────────────────────────────────────────────────
const fnPrefix = (FN.match(/const INBOX_PREFIX = "([^"]+)"/) || [])[1];
const appPrefix = (APP.match(/const INBOX_PREFIX = "([^"]+)"/) || [])[1];
ok("the function names a prefix", !!fnPrefix);
ok("the app names a prefix", !!appPrefix);
// The same drift that would break the share target breaks this: the writer and
// the reader are in different files with nothing checking they agree.
ok("…and they are the SAME string", fnPrefix === appPrefix, { fnPrefix, appPrefix });
ok("both functions are exported from index.js",
   /exports\.mealInbox = require\("\.\/mealInbox"\)\.mealInbox;/.test(IDX)
   && /exports\.mealInboxLink = require\("\.\/mealInbox"\)\.mealInboxLink;/.test(IDX));

// ── 6. RUN the app-side reader ──────────────────────────────────────────────
// ⚠️ Lifted and executed, not described. Pattern-matching a guard leaves it
// green when the guard becomes `if (false)` (S199k).
function liftFn(src, name) {
  const start = src.indexOf(`async function ${name}`);
  if (start === -1) return null;
  let depth = 0, end = -1;
  for (let j = src.indexOf("{", start); j < src.length; j++) {
    const c = src[j];
    if (c === "{") depth++;
    else if (c === "}") { depth--; if (!depth) { end = j + 1; break; } }
  }
  return end > start ? src.slice(start, end) : null;
}
const takeSrc = liftFn(APP, "takeInboxPhotos");
ok("takeInboxPhotos lifts cleanly", !!takeSrc);

const runTake = async (rows, { listThrows = false } = {}) => {
  const deleted = [];
  const win = {
    storage: {
      async listEntries() {
        if (listThrows) throw new Error("offline");
        return { entries: rows.slice() };
      },
      async delete(k) { deleted.push(k); },
    },
  };
  const fn = new Function("window", "INBOX_PREFIX", `${takeSrc}; return takeInboxPhotos();`);
  const out = await fn(win, appPrefix);
  return { out, deleted };
};

const row = (id, dataUrl) => ({ k: `${appPrefix}${id}`, value: JSON.stringify({ id, dataUrl, at: 1, via: "shortcut" }) });

{
  const { out, deleted } = await runTake([
    row("a", "data:image/jpeg;base64,AAA"),
    row("b", "data:image/png;base64,BBB"),
  ]);
  ok("every parked photo comes back", out.length === 2, out);
  ok("…in the order they were parked", out[0].endsWith("AAA") && out[1].endsWith("BBB"));
  ok("…and each row is deleted after reading", deleted.length === 2, deleted);
}
{
  // ⚠️ A ROW WE CANNOT PARSE STILL HAS TO BE DELETED, or it is re-read on every
  // launch forever and the person has no way to clear it from inside the app.
  const { out, deleted } = await runTake([
    { k: `${appPrefix}bad`, value: "{not json" },
    row("c", "data:image/jpeg;base64,CCC"),
  ]);
  ok("a corrupt row is skipped, not fatal", out.length === 1 && out[0].endsWith("CCC"), out);
  ok("…and is STILL deleted, so it cannot wedge the inbox", deleted.length === 2, deleted);
}
{
  // Anything that isn't an image data URL is not something to attach.
  const { out, deleted } = await runTake([
    { k: `${appPrefix}x`, value: JSON.stringify({ dataUrl: "https://example.com/evil.png" }) },
    { k: `${appPrefix}y`, value: JSON.stringify({ dataUrl: "data:text/html;base64,PHNjcmlwdD4=" }) },
  ]);
  ok("a non-image payload is refused", out.length === 0, out);
  ok("…and cleared anyway", deleted.length === 2);
}
{
  const { out, deleted } = await runTake([]);
  ok("an empty inbox is no work and no throw", out.length === 0 && deleted.length === 0);
}
{
  const { out } = await runTake([row("z", "data:image/jpeg;base64,ZZZ")], { listThrows: true });
  ok("an unreadable store returns nothing rather than throwing", out.length === 0);
}

// ── 7. The app actually drains it ───────────────────────────────────────────
ok("the chat panel drains the inbox as well as the share cache",
   /Promise\.allSettled\(\[takeSharedPhotos\(\), takeInboxPhotos\(\)\]\)/.test(APP));
// ⚠️ allSettled, not all: the two sources fail independently, and a missing
// service worker must not swallow a photo an iPhone already delivered.
ok("…with allSettled, so one source failing cannot lose the other",
   !/Promise\.all\(\[takeSharedPhotos/.test(APP));
ok("the panel is reachable from the menu", /<span>Send meals from your phone<\/span>/.test(APP));
ok("the screen says the link is a credential",
   /Treat this like a password/.test(APP));
// ⚠️ The recipe is useless without the resize — the endpoint refuses anything
// over the cap, and a full-size iPhone photo is several times it.
ok("the recipe tells the user to resize, and says not to skip it",
   /Resize Image/.test(APP) && /too big to send/.test(APP));
ok("the screen promises nothing is logged automatically",
   /Nothing is logged\s*\n?\s*automatically/.test(APP.replace(/<[^>]+>/g, "")));

console.log(`${checks - fails}/${checks} meal-inbox assertions passed`);
if (fails) process.exit(1);
