// Finding a client on a long roster (S229).
//
// Kevin: "Add a search bar for the plans section so it is easier to find plans
// and connected clients."
//
// ⚠️ ONE BOX ACROSS BOTH LISTS. A trainer asking "where is Dana" does not know
// whether Dana is a connected account or a plan file — much of this roster is
// Trainerize imports with no account at all — so a search scoped to one list
// makes the answer depend on guessing the storage shape first.
//
// ⚠️ AND THE COLLAPSED SECTION IS THE TRAP. "Local Plans" is collapsed by
// default, so a hit inside it would report a count and then show nothing. A
// search that silently misses matches is worse than no search, and the assertion
// that guards it is the one at the bottom of this file.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { stripJsxComments } from "./lib/strip-comments.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const APP = readFileSync(join(here, "..", "src", "App.jsx"), "utf8");

let fails = 0, checks = 0;
const ok = (n, c, x) => { checks++; if (!c) { fails++; console.log("  FAIL:", n, x !== undefined ? JSON.stringify(x) : ""); } };

// Strip comments before asserting an ABSENCE — a regex looking for a thing the
// code must not do will happily match a comment saying it must not do it.
const code = (src) => stripJsxComments(src);

// Brace-balanced lifter (S215).
function liftDecl(src, name) {
  const re = new RegExp("\\n([ \\t]*)(?:function " + name + "\\(|const " + name + "\\s*=)");
  const m = src.match(re);
  if (!m) throw new Error("could not lift " + name);
  const start = m.index + 1 + m[1].length;
  const isFn = src.startsWith("function", start);
  let i = start, depth = 0, opened = false;
  const skipString = () => { const qq = src[i]; for (i++; i < src.length; i++) { if (src[i] === "\\") { i++; continue; } if (src[i] === qq) return; } };
  if (isFn) {
    while (i < src.length && src[i] !== "(") i++;
    let pd = 0;
    for (; i < src.length; i++) {
      const c = src[i];
      if (c === '"' || c === "'" || c === "`") { skipString(); continue; }
      if (c === "(") pd++;
      else if (c === ")") { pd--; if (pd === 0) { i++; break; } }
    }
  }
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === '"' || c === "'" || c === "`") { skipString(); continue; }
    if (c === "/" && src[i + 1] === "/") { while (i < src.length && src[i] !== "\n") i++; continue; }
    if (isFn) {
      if (c === "{") { depth++; opened = true; }
      else if (c === "}") { depth--; if (opened && depth === 0) return src.slice(start, i + 1); }
    } else {
      if ("([{".indexOf(c) >= 0) depth++;
      else if (")]}".indexOf(c) >= 0) depth--;
      else if (c === ";" && depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error("unterminated " + name);
}

const NAMES = ["SEARCH_MIN_ROWS", "searchNorm", "searchHaystack", "searchIds", "rowMatchesSearch", "filterRows", "nameTokens"];
const { SEARCH_MIN_ROWS, searchNorm, searchHaystack, searchIds, rowMatchesSearch, filterRows, nameTokens } =
  new Function(NAMES.map((n) => liftDecl(APP, n)).join("\n") + "\nreturn { " + NAMES.join(", ") + " };")();

console.log("\n  Finding a client on a long roster\n");

// A realistic mixed roster: connected accounts (uid) and plan files (id).
const CLIENTS = [
  { uid: "uidAAAA1111", name: "Dana Reyes", email: "dana@example.com" },
  { uid: "uidBBBB2222", name: "Danny Okafor", email: "d.okafor@example.com" },
  { uid: "uidCCCC3333", name: "Jose Marquez", email: "jose@example.com" },
];
const PLANS = [
  { id: "ctz9001", name: "Dana Reyes", isSimulation: false },
  { id: "ctz9002", name: "Marcus Hill", customName: "Marcus — contest prep", isSimulation: false },
  { id: "sim7", name: "Cut sandbox", isSimulation: true },
];
const NUMS = { uidAAAA1111: 3, uidBBBB2222: 4, uidCCCC3333: 5, ctz9001: 11, ctz9002: 12, sim7: 13 };
const names = (rows) => rows.map((r) => r.customName || r.name).join(", ");

// ── 1. The normaliser ─────────────────────────────────────────────────────
ok("case is folded", searchNorm("DaNa") === "dana");
ok("whitespace is trimmed", searchNorm("  dana  ") === "dana");
ok("null is empty", searchNorm(null) === "");
ok("undefined is empty", searchNorm(undefined) === "");
// ⚠️ A ROSTER OF REAL NAMES IS EXACTLY WHERE ACCENT-SENSITIVE SEARCH LOOKS
// BROKEN: typing "jose" and getting nothing for José reads as data loss.
ok("accents are folded", searchNorm("José") === "jose");
ok("a composed accent folds the same as a combining one",
  searchNorm("José") === searchNorm("José"));
ok("Renee folds", searchNorm("Renée") === "renee");

// ── 2. Matching one row ───────────────────────────────────────────────────
ok("an empty query matches everything", rowMatchesSearch(CLIENTS[0], "") === true);
ok("a whitespace query matches everything", rowMatchesSearch(CLIENTS[0], "   ") === true);
ok("a full name matches", rowMatchesSearch(CLIENTS[0], "Dana Reyes") === true);
ok("a partial name matches", rowMatchesSearch(CLIENTS[0], "dan") === true);
ok("a surname matches", rowMatchesSearch(CLIENTS[0], "reyes") === true);
ok("the wrong name does not match", rowMatchesSearch(CLIENTS[0], "marcus") === false);
ok("an email matches", rowMatchesSearch(CLIENTS[0], "dana@example") === true);
ok("an accented name is found by the plain spelling",
  rowMatchesSearch({ uid: "x", name: "José Marquez" }, "jose") === true);
// ⚠️ AND WITH BOTH IDENTIFIERS, because IdBadge shows a sequential "#3" AND a
// 4-char code, and a support question or an AI reply may quote either.
ok("the #number matches", rowMatchesSearch(CLIENTS[0], "#3", 3) === true);
ok("the bare number matches", rowMatchesSearch(CLIENTS[0], "3", 3) === true);
ok("a fragment of the raw id matches", rowMatchesSearch(CLIENTS[0], "a111", 3) === true);
ok("the 4-char code matches", rowMatchesSearch(CLIENTS[0], "1111", 3) === true);
ok("the 4-char code matches with its hash", rowMatchesSearch(CLIENTS[0], "#1111", 3) === true);
ok("someone else's number does not match", rowMatchesSearch(CLIENTS[0], "#9", 3) === false);
// ⚠️ EVERY TERM MUST MATCH. On a long roster an OR search returns nearly
// everyone, which is not better than no search.
ok("two terms narrow", rowMatchesSearch(CLIENTS[0], "dana reyes") === true);
ok("a wrong second term excludes", rowMatchesSearch(CLIENTS[0], "dana okafor") === false);
ok("terms may be given in any order", rowMatchesSearch(CLIENTS[0], "reyes dana") === true);
ok("a renamed plan matches its new name", rowMatchesSearch(PLANS[1], "contest") === true);
ok("...and still its original", rowMatchesSearch(PLANS[1], "marcus hill") === true);
ok("a junk row does not throw", (() => { try { return rowMatchesSearch(null, "x") === false; } catch { return false; } })());
ok("a row with no fields does not match a real query", rowMatchesSearch({}, "dana") === false);
ok("a row with no fields still matches an empty query", rowMatchesSearch({}, "") === true);
ok("the haystack tolerates a null row", typeof searchHaystack(null) === "string");
ok("the id list tolerates a null row", Array.isArray(searchIds(null, null)));
// ⚠️ THE BUG A REVIEWER CAUGHT BEFORE THIS SHIPPED. "#3" matched client #30
// because the hash anchored nothing, and a bare "3" returned the WHOLE roster
// because a 28-character Firebase uid almost always contains a 3. A number that
// matches everyone is not a search result.
{
  const thirty = { uid: "aaaa1111bbbb2222cccc3333dd30", name: "Dana Smith" };
  const three = { uid: "zzzzyyyyxxxxwwwwvvvvuuuuttt9", name: "Bob" };
  const fourteen = { uid: "qqqqppppoooonnnnmmmmllllkk3k", name: "Cara" };
  ok("#3 finds client 3", rowMatchesSearch(three, "#3", 3) === true);
  ok("#3 does NOT also find client 30", rowMatchesSearch(thirty, "#3", 30) === false);
  ok("a bare 3 finds client 3", rowMatchesSearch(three, "3", 3) === true);
  ok("a bare 3 does not match an unrelated uid containing 3",
    rowMatchesSearch(fourteen, "3", 14) === false);
  ok("...nor a client numbered 30", rowMatchesSearch(thirty, "3", 30) === false);
  ok("#30 still finds client 30", rowMatchesSearch(thirty, "#30", 30) === true);
  ok("the short code still works as text", rowMatchesSearch(thirty, "dd30", 30) === true);
  ok("the short code works with a hash", rowMatchesSearch(thirty, "#dd30", 30) === true);
}

// ── 3. Filtering the lists ───────────────────────────────────────────────
ok("an empty query returns the SAME array, untouched",
  filterRows(CLIENTS, "", NUMS) === CLIENTS);
ok("...and so does whitespace", filterRows(CLIENTS, "  ", NUMS) === CLIENTS);
ok("a name filters the client list", names(filterRows(CLIENTS, "dana", NUMS)) === "Dana Reyes");
ok("a prefix can match two people", filterRows(CLIENTS, "dan", NUMS).length === 2);
ok("a plan file is found by name", names(filterRows(PLANS, "marcus", NUMS)) === "Marcus — contest prep");
ok("a simulation is searchable too", names(filterRows(PLANS, "sandbox", NUMS)) === "Cut sandbox");
ok("a number finds the right plan", names(filterRows(PLANS, "#12", NUMS)) === "Marcus — contest prep");
ok("no match is an empty list, not everything", filterRows(CLIENTS, "zzzz", NUMS).length === 0);
ok("a missing id map does not throw", filterRows(CLIENTS, "dana", null).length === 1);
ok("a null list does not throw", filterRows(null, "dana", NUMS).length === 0);
{
  // THE POINT OF THE FEATURE: the same query reaches a person in EITHER list.
  const q = "dana";
  ok("one query finds the person in both lists",
    filterRows(CLIENTS, q, NUMS).length === 1 && filterRows(PLANS, q, NUMS).length === 1);
}

// ── 4. The shared normalisation did not break the other caller ───────────
// nameTokens now routes through searchNorm. It tokenises where search does
// substrings, so both behaviours have to survive.
ok("nameTokens still splits into words", nameTokens("Dana Reyes").join("|") === "dana|reyes");
ok("nameTokens still drops punctuation", nameTokens("Renee's plan").join("|") === "renee|s|plan");
ok("nameTokens still folds accents", nameTokens("José").join("|") === "jose");
ok("nameTokens tolerates junk", nameTokens(null).length === 0);

// ── 5. The wiring ───────────────────────────────────────────────────────
const C = code(APP);
// Count CALL SITES: a filter applied to one list is half a feature.
{
  // ⚠️ CALL SITES, NOT MENTIONS — the declaration matches the same pattern.
  const calls = (C.match(/(?<!function )filterRows\(/g) || []).length;
  ok("both lists are filtered, and only those two", calls === 2, calls);
}
ok("the connected-client list is filtered", /filterRows\(\[\.\.\.clients\]/.test(C));
ok("the plan-file list is filtered", /const filteredLocal = filterRows\(/.test(C));
ok("both are filtered by the same query", (C.match(/activeQ, idNums\)/g) || []).length === 2);
// ⚠️ THE COLLAPSED-SECTION TRAP. If this regresses, the count says "2 plan
// files" and the list below it stays shut.
// ⚠️ AND IT OPENS THE DRAWER RATHER THAN OVERRIDING IT. The first revision
// derived the shown state as `plansOpen || (searching && hits)`, which made the
// Hide button DEAD while a search was open — the tap flipped plansOpen and the
// derived value stayed true. One state, set by the search, owned by the button.
ok("a hit opens the collapsed plans section",
  /if \(searching && planHits > 0\) setPlansOpen\(true\);/.test(C));
ok("the shown state is the real state, not an override", /const plansShown = plansOpen;/.test(C));
ok("the body reads the effective open state", /\{plansShown && \(<>/.test(C));
ok("the Hide/Show label reads the same state", /\{plansShown \? "Hide" : "Show"\}/.test(C));
ok("the collapsed blurb reads the same state", /\{!plansShown && \(/.test(C));
// The override form must not come back anywhere.
ok("no derived override of the open state",
  (C.match(/plansOpen \|\| \(searching/g) || []).length === 0);
ok("the box only appears once there is enough to search", /\{searchable && \(/.test(C));
ok("the threshold counts BOTH lists", /clients\.length \+ profiles\.length\) >= SEARCH_MIN_ROWS/.test(C));
// ⚠️ A QUERY MUST NOT OUTLIVE ITS OWN INPUT. Dropping under the threshold (by
// deleting a plan, say) unmounts the box; without this the lists stay filtered
// with nothing on screen to clear them.
// ⚠️ STRUCTURALLY IMPOSSIBLE, NOT TIDIED UP AFTERWARDS. The lists filter on a
// value derived from the SAME condition that renders the box, so a roster that
// shrinks below the threshold cannot leave an invisible, unclearable filter.
ok("the filter cannot outlive its own box",
  /const activeQ = searchable \? rosterQ : "";/.test(C));
ok("and the lists read the derived value, never the raw one",
  !/filterRows\([^)]*rosterQ/.test(C));
// iOS Safari zooms the page on focus of any sub-16px input, and pinch-zoom is
// deliberately enabled — so this is the difference between a usable search and
// a zoom-and-reflow on every use.
ok("the input is 16px so iOS does not zoom", /py-2\.5 text-base text-fg/.test(C));
// Anchored the same way: the AI chat's thinking indicator carries these two
// attributes too.
ok("the result count is announced to screen readers",
  /\$\{subCls\} mt-2`\} role="status" aria-live="polite"/.test(C));
// The placeholder promises three things; the row must actually carry all three.
// ⚠️ ANCHORED TO THE ROW THAT OWNS IT. `email: c.email || ""` also appears in
// another roster builder further down the file, so a bare match stays green
// with this one deleted — the exact weakness check:weak exists to catch.
ok("the client row carries the email the placeholder promises",
  /email: c\.email \|\| "",[\s\S]{0,400}?hasCard:/.test(C));
ok("a sensible threshold", SEARCH_MIN_ROWS >= 5 && SEARCH_MIN_ROWS <= 20, SEARCH_MIN_ROWS);
ok("there is a way to clear it", /setRosterQ\(""\)/.test(C));
ok("the empty state says what to try", /Try part of a name, an email, or their #number/.test(APP));
// ⚠️ A SEARCH MISS MUST NOT BLAME THE CHIPS. The drawer's own empty line says
// "Nothing in this filter", which points at the all/plans/sims chips — wrong,
// and unfixable by the reader, when the query is what emptied it.
ok("a search miss does not blame the filter chips",
  /searching \? "No plan files match that\." : "Nothing in this filter\."/.test(C));
// The box is a compact row, not another padded card pushing the roster it
// exists to help you read further down the screen.
ok("the search box is a row, not a card", /\{searchable && \(\s*<div className="mb-3"/.test(C));
// iOS scrolls a focused input into view; without this it can land under the
// two fixed chrome buttons at the top of every screen.
ok("a focused box does not land under the fixed chrome", /scrollMarginTop: "calc\(74px/.test(C));
ok("the client card hides when nothing in it matches", /clients\.length > 0 && \(clientHits > 0 \|\| !searching\)/.test(C));
ok("the plan count describes the list you are looking at",
  /searching \? planHits : realPlans\.length \+ sims\.length/.test(C));
// A phone keyboard should offer Search, not Go, and the field should be a
// real search input so iOS renders its clear affordance.
ok("it is a real search field", /type="search"/.test(C));
ok("the phone keyboard says search", /enterKeyHint="search"/.test(C));
ok("it is labelled for screen readers", /aria-label="Search clients and plans"/.test(C));

console.log(`\n  ${checks - fails}/${checks} checks passed`);
console.log("  One box, both lists, and nothing hiding behind a collapsed card.\n");
process.exit(fails ? 1 : 0);
