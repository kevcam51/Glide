// A measuring day must be visible on the surfaces people browse (S199x).
//
// Kevin's own note in the handoff: "The month/week CALENDAR has no measurement
// indicator, so the body composition work is invisible from the surface people
// browse days on." The day view has shown tape/caliper/scan readings since S92;
// the month grid and the week list showed nothing, so a month of measuring
// looked identical to a month of nothing.
//
// ⚠️ THE PREDICATE IS THE WHOLE POINT, AND IT IS EXECUTED. mergeMeasurements
// creates an entry per date carrying date/timestamp/loggedBy whether or not a
// value came with it — so "an entry exists" is NOT "this person was measured",
// and a dot for an empty shell is a lie on the exact surface this exists to make
// honest. hasMeasurement is module-level so this test can run the shipping copy.
//
// Run: node scripts/test-measure-dots.mjs
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const APP = readFileSync(join(ROOT, "src", "App.jsx"), "utf8");

let fails = 0, checks = 0;
const ok = (n, c, x) => { checks++; if (!c) { fails++; console.log("  FAIL:", n, x !== undefined ? JSON.stringify(x) : ""); } };

const fields = /const MEASURED_ANY_FIELD = \[[\s\S]*?\];/.exec(APP);
const fn = /function hasMeasurement\(entry\) \{[\s\S]*?\n\}/.exec(APP);
ok("hasMeasurement is liftable", !!fields && !!fn);
const hasMeasurement = new Function(`${fields[0]}\n${fn[0]}\nreturn hasMeasurement;`)();

const book = { date: "2026-09-01", timestamp: 1, loggedBy: "client" };

// ── the lie this prevents ───────────────────────────────────────────────────
ok("bookkeeping alone is NOT a measurement", !hasMeasurement(book), book);
ok("nothing at all is not a measurement", !hasMeasurement(null) && !hasMeasurement(undefined));
ok("an empty object is not a measurement", !hasMeasurement({}));

// ── every way of actually being measured ────────────────────────────────────
ok("a tape reading counts", hasMeasurement({ ...book, waist: 34 }));
ok("...any site, not just waist", hasMeasurement({ ...book, calf: 15 }));
ok("a caliper reading counts", hasMeasurement({ ...book, calAbdomen: 18 }));
ok("...the female sites too", hasMeasurement({ ...book, calSuprailiac: 12 }));
ok("a scan body-fat reading counts", hasMeasurement({ ...book, scanBf: 21.4 }));

// ── things that are not readings ────────────────────────────────────────────
// Zero is what an emptied field leaves behind, and a negative is nonsense.
ok("a zeroed field is not a reading", !hasMeasurement({ ...book, waist: 0 }));
ok("an empty string is not a reading", !hasMeasurement({ ...book, waist: "" }));
ok("junk is not a reading", !hasMeasurement({ ...book, waist: "abc" }));
ok("a negative is not a reading", !hasMeasurement({ ...book, waist: -3 }));
// Numbers arrive from inputs as strings; those must still count.
ok("a numeric STRING still counts — inputs give strings", hasMeasurement({ ...book, waist: "34.5" }));

// ── wiring: the two surfaces that were blind ────────────────────────────────
ok("the month grid computes it", /measured: measuredDates\.has\(k\)/.test(APP));
ok("...and draws a dot for it", /\{d\.measured && <span style=\{\{ width: 5, height: 5/.test(APP));
ok("...which the legend explains", /> measured<\/span>/.test(APP));
ok("the week list shows it too", /measuredDates\.has\(k\) && \(\(\) => \{/.test(APP));
// ⚠️ A day with ONLY a measurement used to render as "—", i.e. "nothing here",
// which is worse than no indicator: it is a positive claim that the day is empty.
ok("a day with ONLY a measurement no longer renders as an empty dash",
   /scheduledFor\(k\) === 0 && !measuredDates\.has\(k\) && <span>—<\/span>/.test(APP));
// The set is derived through the predicate, not from "an entry exists".
ok("the set is built through hasMeasurement, not from entry existence",
   /if \(e && e\.date && hasMeasurement\(e\)\) set\.add\(e\.date\)/.test(APP));

console.log(`  ${checks - fails}/${checks} assertions passed`);
process.exit(fails ? 1 : 0);
