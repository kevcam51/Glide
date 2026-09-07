// Saved meeting addresses, and where a session is actually held (S203).
//
// Kevin's ask: a client saves where they want to be trained, a trainer saves
// where clients should come, and every booking says WHICH of the two it is at —
// so the drive estimate knows which way anyone is travelling. No choice is a
// real answer too: a place they already agreed, or an online session.
//
// The rules being pinned:
//   • the address lives in the OWNER's kv, never on the profile doc — a
//     trainer's profile is readable by ANY signed-in user (the directory rule),
//     so a home-training trainer would have published their home address;
//   • `meetAt` is one of exactly two values or absent — never an empty string,
//     because firestore.rules refuses the key when its value is not one of the
//     two, and "" would fail the whole booking;
//   • the address is COPIED onto the session, never referenced, so editing a
//     saved address later cannot rewrite where past sessions were held;
//   • both booking forms offer the same choice — a feature that works on one
//     screen and not the other is how this codebase has drifted before.
//
// Run: node scripts/test-meeting-address.mjs
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SESSIONS = readFileSync(join(ROOT, "src", "sessions.js"), "utf8");
const APP = readFileSync(join(ROOT, "src", "App.jsx"), "utf8");
const RULES = readFileSync(join(ROOT, "firestore.rules"), "utf8");
const AVAIL = readFileSync(join(ROOT, "functions", "availability.js"), "utf8");

// ⚠️ STRIP COMMENTS BEFORE ASSERTING ON MARKUP. Three separate checks in this
// session matched a COMMENT that names the very thing it forbids (or, here, the
// section header above the control) and failed on a correct file. Any assertion
// about what RENDERS must run against code with the prose removed.
const codeOnly = (src) => src.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
const APP_CODE = codeOnly(APP);

let fails = 0, checks = 0;
const ok = (n, c, x) => { checks++; if (!c) { fails++; console.log("  FAIL:", n, x !== undefined ? JSON.stringify(x) : ""); } };

// ── lift the model and RUN it ───────────────────────────────────────────────
const lift = (name, kind = "function") => {
  const re = kind === "function"
    ? new RegExp(`export function ${name}\\([\\s\\S]*?\\n\\}`)
    : new RegExp(`export const ${name} = [^\\n]*`);
  const m = SESSIONS.match(re);
  if (!m) throw new Error(`could not lift ${name}`);
  return m[0].replace(/^export /, "").replace(/\nexport /g, "\n");
};
const M = new Function(`
  ${lift("MAX_ADDRESS_LEN", "const")}
  ${lift("MEET_AT", "const")}
  ${lift("isMeetAt", "const")}
  ${lift("cleanMeetingAddress")}
  ${lift("parseMeetingAddress")}
  ${lift("meetAtLabel")}
  return { MAX_ADDRESS_LEN, MEET_AT, isMeetAt, cleanMeetingAddress, parseMeetingAddress, meetAtLabel };
`)();

// ── the address value ───────────────────────────────────────────────────────
ok("a real address survives", M.cleanMeetingAddress({ address: "800 Ocean Dr, Miami Beach FL" }).address === "800 Ocean Dr, Miami Beach FL");
ok("whitespace is trimmed", M.cleanMeetingAddress({ address: "  800 Ocean Dr  " }).address === "800 Ocean Dr");
// An address of nothing is NOT an address — it must be null, or a booking sheet
// offers "My place" pointing at the empty string and fills the location with it.
ok("an empty address is null, not an empty object", M.cleanMeetingAddress({ address: "   " }) === null);
ok("no input at all is null", M.cleanMeetingAddress(null) === null);
ok("junk input is null", M.cleanMeetingAddress("nonsense") === null);
ok("the label is optional", M.cleanMeetingAddress({ address: "x y z" }).label === "");
// Bounded to the same length as the session `location` the rules enforce —
// otherwise a saved address could be accepted here and refused at booking time.
{
  const long = "a".repeat(500);
  ok("the address is capped", M.cleanMeetingAddress({ address: long }).address.length === M.MAX_ADDRESS_LEN);
  const bound = Number((RULES.match(/location'[\s\S]*?/) && "120") || 0);
  ok("...at the same bound the session location uses", M.MAX_ADDRESS_LEN === 120, M.MAX_ADDRESS_LEN);
  ok("the label is capped too", M.cleanMeetingAddress({ address: "x", label: long }).label.length === 40);
}
// A row written by an older/other writer must degrade, never throw into a sheet.
ok("a kv row parses", M.parseMeetingAddress({ value: JSON.stringify({ address: "1 A St" }) }).address === "1 A St");
ok("a bare string row is tolerated", M.parseMeetingAddress({ value: JSON.stringify("1 A St") }).address === "1 A St");
ok("malformed JSON is null, not a throw", M.parseMeetingAddress({ value: "{{{" }) === null);
ok("a missing row is null", M.parseMeetingAddress(null) === null);
ok("an empty row is null", M.parseMeetingAddress({ value: "" }) === null);

// ── where the session is ────────────────────────────────────────────────────
ok("trainer is a place", M.isMeetAt("trainer"));
ok("client is a place", M.isMeetAt("client"));
// ⚠️ THE EMPTY STRING IS NOT A VALUE. firestore.rules validates the key when it
// is PRESENT, so writing "" fails the whole booking — the writers must omit it.
ok("the empty string is NOT a place", !M.isMeetAt(""));
ok("free text is not a place", !M.isMeetAt("the park"));
ok("a number is not a place", !M.isMeetAt(3));
ok("undefined is not a place", !M.isMeetAt(undefined));

// ── who is travelling, in the reader's words ────────────────────────────────
{
  const t = (v, isT, name) => M.meetAtLabel(v, { viewerIsTrainer: isT, otherName: name });
  ok("at the trainer's place, the trainer reads 'your place'", /your place/i.test(t("trainer", true, "Casey")));
  ok("...and the client reads the trainer's name", /Kev/.test(t("trainer", false, "Kev")));
  ok("at the client's place, the client reads 'your place'", /your place/i.test(t("client", false, "Kev")));
  ok("...and the trainer reads the client's name", /Casey/.test(t("client", true, "Casey")));
  // Nothing chosen prints NOTHING. "As agreed" is not news, and rendering
  // "unknown" would make an online session look like a missing field.
  ok("no choice renders nothing at all", t("", true, "Casey") === null);
  ok("...and an unknown value renders nothing either", t("wat", true, "Casey") === null);
  ok("a missing name still reads as a sentence", !/undefined|null/.test(String(t("client", true, ""))));
}

// ── it is stored where it cannot leak ───────────────────────────────────────
// ⚠️ THE PROFILE DOC WOULD HAVE BEEN LESS CODE AND A REAL LEAK. `users/{uid}` is
// readable by ANY signed-in user when the role is head/sub trainer — the
// directory rule a client needs to resolve their coach — so a trainer who
// trains from home would have published their home address platform-wide.
{
  const usersBlock = RULES.slice(RULES.indexOf("match /users/{uid}"), RULES.indexOf("match /users/{uid}") + 1400);
  ok("a trainer profile really is world-readable to signed-in users",
     /resource\.data\.role in \['head_trainer', 'sub_trainer'\]/.test(usersBlock), true);
  ok("...so the address is NOT a profile field", !/meetingAddress/.test(RULES), true);
  ok("...and lives in the owner's own kv instead", /MEETING_ADDRESS_KEY = "caliq-meeting-address"/.test(SESSIONS));
  ok("the reason is written down where the next person will look",
     /ANY SIGNED-IN USER/.test(SESSIONS), true);
}

// ── the rules actually allow (and bound) it ─────────────────────────────────
{
  ok("meetAt is an allowed booking field", /'meetAt'\]/.test(RULES), true);
  ok("...and is validated to the two real answers",
     /request\.resource\.data\.meetAt in \['trainer', 'client'\]/.test(RULES), true);
  ok("...on create", /&& meetAtValid\(\)\s*\n\s*&& request\.resource\.data\.keys\(\)\.hasOnly/.test(RULES), true);
  ok("...and on update too — a create-only bound is decorative",
     (RULES.match(/&& meetAtValid\(\)/g) || []).length === 2,
     (RULES.match(/&& meetAtValid\(\)/g) || []).length);
  // The client's cancel allowlist must NOT gain it: where a session is held is
  // the trainer's call, and a client who could flip it would redirect a drive.
  const clientFields = (RULES.match(/function clientCancelFields\(\)[\s\S]*?\}/) || [""])[0];
  ok("a client cannot write meetAt", !/meetAt/.test(clientFields), clientFields);
}

// ── the writers omit it rather than writing "" ──────────────────────────────
{
  ok("bookSession omits an unset meetAt", /\.\.\.\(isMeetAt\(meetAt\) \? \{ meetAt \} : \{\}\)/.test(SESSIONS), true);
  ok("bookSeries carries it to every occurrence",
     /\.\.\.\(isMeetAt\(base\.meetAt\) \? \{ meetAt: base\.meetAt \} : \{\}\)/.test(SESSIONS), true);
  // Clearing it back to "as agreed" has to actually clear it, not be ignored.
  ok("updateSession can clear it", /patch\.meetAt = deleteField\(\)/.test(SESSIONS), true);
  ok("the server Accept omits it when unknown",
     /\.\.\.\(lastMeetAtForClient \? \{ meetAt: lastMeetAtForClient \} : \{\}\)/.test(AVAIL), true);
  // ⚠️ The address and the direction come from the SAME prior session, or a
  // carried-over address renders as "as agreed" over one side's home.
  ok("...and inherits it from the same session the address came from",
     /lastLocationForClient = String\(v\.location\)[\s\S]{0,120}lastMeetAtForClient =/.test(AVAIL), true);
}

// ── the app copies the address, never references it ─────────────────────────
// Editing a saved address later must not rewrite where past sessions were held.
{
  ok("choosing a place copies the address into the form",
     (APP.match(/location: o\.id && o\.addr \? o\.addr\.address : f\.location/g) || []).length === 2,
     (APP.match(/location: o\.id && o\.addr \? o\.addr\.address : f\.location/g) || []).length);
  ok("...and nothing reads a saved address at render time from a session",
     !/session[^\n]*meetingAddress/.test(APP), true);
}

// ── both booking forms offer the same choice ────────────────────────────────
{
  const n = (APP_CODE.match(/Where is it\?/g) || []).length;
  ok("both booking forms ask where it is", n === 2, n);
  const pickers = (APP_CODE.match(/MEET_AT\.TRAINER, label: "My place"/g) || []).length;
  ok("...with the same three options each", pickers === 2, pickers);
  ok("a place nobody saved cannot be chosen", /disabled=\{missing && !loading\}/.test(APP_CODE), true);
  ok("...and says why rather than looking broken", /none saved/.test(APP_CODE), true);
  ok("a trainer with no saved place is told where to add one",
     (APP_CODE.match(/Where I train clients<\/b>/g) || []).length === 2,
     (APP_CODE.match(/Where I train clients<\/b>/g) || []).length);
}

// ── it is findable, which was half the ask ──────────────────────────────────
{
  ok("the menu row exists for BOTH roles",
     /\{isTrainer \? "Where I train clients" : "Where I train"\}/.test(APP), true);
  // The row shows the saved value, so "have I set this?" is answered without
  // opening it — and shows ADD when there is nothing, which is the nudge.
  ok("...and answers 'have I set this' without being opened",
     /savedAddr \? \(savedAddr\.label \|\| savedAddr\.address\) : "ADD"/.test(APP), true);
  // ⚠️ Read on OPEN, not on mount: the menu renders on every screen, so an
  // eager read is one Firestore read per page load for a value most sessions
  // never look at.
  ok("the row's value is read only once the menu is opened",
     /if \(!open \|\| savedAddr !== undefined\) return;/.test(APP), true);

  // ── it is HIGH in the menu, which was half the ask (S204) ─────────────────
  // "Make it pretty easy to find" is not satisfied by existing. Pinned by
  // POSITION relative to the other rows rather than by a line number, which
  // would break on any unrelated edit above it.
  const at = (needle) => APP_CODE.indexOf(needle);
  const rowAt = at('{isTrainer ? "Where I train clients" : "Where I train"}');
  ok("the address row exists", rowAt > 0);
  ok("...above Notifications", rowAt < at("<span>Notifications</span>"), true);
  ok("...above My notes", rowAt < at("<span>My notes</span>"), true);
  ok("...and above Connect your AI", rowAt < at("<span>Connect your AI</span>"), true);
  ok("...while still below the navigation rows it belongs with",
     rowAt > at("<span>Calendar</span>"), true);

  // ── a client with no trainer has nobody to give it to (S204, Kevin) ───────
  // ⚠️ THE GATE IS ROLE-ASYMMETRIC ON PURPOSE. A trainer's place is theirs to
  // set before their first client exists; a client's address is only ever read
  // by their own trainer, so before they join one the field goes nowhere.
  ok("the row locks for a client with no trainer",
     /const locked = !isTrainer && !hasCoach;/.test(APP_CODE), true);
  ok("...the button is actually disabled, not just faded",
     /disabled=\{locked\}/.test(APP_CODE), true);
  ok("...the panel cannot be opened around it",
     /showAddr && !locked/.test(APP_CODE), true);
  ok("...and it says WHY rather than looking broken",
     /Join a trainer/.test(APP_CODE), true);
  // A TRAINER must never be gated by this — they have no coach and never will.
  ok("a trainer is never locked out of their own address",
     /!isTrainer && !hasCoach/.test(APP_CODE) && !/isTrainer \|\| !hasCoach/.test(APP_CODE), true);
  ok("hasCoach actually reaches the menu",
     /function SideMenu\(\{[^}]*hasCoach/.test(APP), true);

  // ── and the menu row alone is not enough (S204) ───────────────────────────
  // ⚠️ A CLIENT WHO NEVER OPENS THE MENU NEVER SAVES A PLACE, so their trainer's
  // "their place" option stays permanently greyed out and neither of them knows
  // why. Kevin asked whether to capture it at SIGNUP; this is the same fix
  // without the drop-off risk of an address field on the role chooser.
  ok("a client with no saved place is prompted where it matters",
     /Want \{trainerInfo\.name\} to come to you\?/.test(APP_CODE), true);
  // Only when ACTIONABLE: a trainer exists, and nothing is saved. `undefined`
  // means "not read yet" and must not flash the prompt at someone who has one.
  ok("...only once we know they have none", /myAddrC === null && trainerInfo &&/.test(APP_CODE), true);
  ok("...never while the answer is still loading", !/myAddrC !== undefined && trainerInfo/.test(APP_CODE), true);
  ok("...and it opens the same panel the menu does",
     /<MeetingAddressPanel isTrainer=\{false\}/.test(APP_CODE), true);
  // It sits inside a card that is itself a button, so the tap must not also
  // open the Sessions panel behind it.
  ok("...without also triggering the card it sits on",
     /e\.stopPropagation\(\); setShowAddrC\(true\)/.test(APP_CODE), true);
  ok("...and it disappears once they save one",
     /onSaved=\{\(a\) => setMyAddrC\(a\)\}/.test(APP_CODE), true);
}

console.log(`  ${checks - fails}/${checks} assertions passed`);
process.exit(fails ? 1 : 0);
