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

const NAMES = ["SEARCH_MIN_ROWS", "searchNorm", "searchHaystack", "searchIds", "rowMatchesSearch", "filterRows", "nameTokens", "searchResultRows"];
const { SEARCH_MIN_ROWS, searchNorm, searchHaystack, searchIds, rowMatchesSearch, filterRows, nameTokens, searchResultRows } =
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
// ⚠️ ONE STRING, SHOWN IN TWO PLACES. check:weak flagged this the moment the
// dropdown grew its own empty state: the pattern matched twice, so it would
// have stayed green with either half broken. The copy is a constant now, and
// both surfaces are asserted to USE it rather than to repeat it.
ok("the empty state says what to try", /Try part of a name, an email, or their #number/.test(APP));
ok("...from one place", (APP.match(/Try part of a name, an email, or their #number/g) || []).length === 1);
ok("...which the summary line shows", /clientHits \+ planHits === 0\s*\?\s*SEARCH_EMPTY_HINT/.test(C));
// ⚠️ A SEARCH MISS MUST NOT BLAME THE CHIPS. The drawer's own empty line says
// "Nothing in this filter", which points at the all/plans/sims chips — wrong,
// and unfixable by the reader, when the query is what emptied it.
ok("a search miss does not blame the filter chips",
  /searching \? "No plan files match that\." : "Nothing in this filter\."/.test(C));
// The box is a compact row, not another padded card pushing the roster it
// exists to help you read further down the screen.
// ⚠️ ASSERT THE PROPERTY, NOT THE CLASS STRING. This pinned the exact opening
// tag, so it went red when the dropdown's positioning wrapper was added to the
// same div — a change that could not possibly have turned the box into a card.
{
  const i = C.indexOf("{searchable && (");
  const end = C.indexOf("{clients.length > 0 && (clientHits", i);
  const block = i > 0 && end > i ? C.slice(i, end) : "";
  ok("the search box is a row, not a card",
    !!block && !/cardCls/.test(block) && /className="[^"]*\bmb-3\b/.test(block));
}
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

// ── 7. The dropdown (S231) ────────────────────────────────────────────────
// Kevin: "can the search create its own dropdown and search for the plan."
// Filtering the two lists in place still made you scroll past a card to reach
// the one you asked for. These run the real row builder, then pin the wiring
// that turns those rows into something you can tap or arrow onto.

// The same two lists the screen filters, in the order the screen shows them.
const ROWS = searchResultRows(
  [{ uid: "uidAAAA1111", name: "Dana Reyes", hasPlan: true },
   { uid: "uidBBBB2222", name: "Danny Okafor", hasPlan: false }],
  PLANS, NUMS);

ok("every match becomes a row", ROWS.length === 5, ROWS.length);
// ⚠️ CLIENTS FIRST. A real account outranks a file about someone, and the
// keyboard walks this order.
ok("connected clients lead", ROWS[0].kind === "client" && ROWS[1].kind === "client");
ok("plan files follow", ROWS.slice(2).every((r) => r.kind !== "client"));
ok("a sandbox is marked as one", ROWS.some((r) => r.kind === "sim" && r.note === "Sandbox file"));
ok("a plan file says so", ROWS.some((r) => r.kind === "plan" && r.note === "Plan file"));
ok("a renamed plan shows the name its owner gave it",
  ROWS.some((r) => r.label === "Marcus — contest prep"));
ok("the id number rides along for the badge", ROWS[0].n === 3);
ok("the row carries the id the badge copies", ROWS[0].uid === "uidAAAA1111");
// ⚠️ A CONNECTED CLIENT WITH NO PLAN IS STILL A SEARCH HIT — leaving them out
// would have the search deny that a real person exists.
{
  const noPlan = ROWS.find((r) => r.uid === "uidBBBB2222");
  ok("a client with no plan is still listed", !!noPlan);
  ok("...and says so", noPlan && /no plan yet/.test(noPlan.note));
  // ⚠️ AND IS NOT A DEAD ROW. There is nothing to open, so it reveals the card
  // that explains why and carries the controls that fix it.
  ok("...and reveals rather than opens", noPlan && noPlan.action === "reveal");
}
ok("a client with a plan opens it", ROWS[0].action === "open");
ok("every plan file opens", ROWS.slice(2).every((r) => r.action === "open"));
// Keys must be unique or React drops rows silently; a uid and a plan id could
// in principle collide, so the kind is part of the key.
ok("the keys are unique", new Set(ROWS.map((r) => r.key)).size === ROWS.length);
ok("a client key and a plan key cannot collide",
  searchResultRows([{ uid: "same" }], [{ id: "same" }], {}).map((r) => r.key).join() === "c:same,p:same");
// Nothing found is an empty list, not a crash or a placeholder row.
ok("no matches is no rows", searchResultRows([], [], {}).length === 0);
ok("a missing list is no rows", searchResultRows(null, undefined, null).length === 0);
ok("a row with no id is skipped", searchResultRows([{ name: "ghost" }], [{ name: "ghost" }], {}).length === 0);
ok("an unnamed plan still has something to read",
  searchResultRows([], [{ id: "p1" }], {})[0].label === "Unnamed client");
ok("an unnamed sandbox says it is one",
  searchResultRows([], [{ id: "s1", isSimulation: true }], {})[0].label === "Untitled simulation");

// ── The wiring ────────────────────────────────────────────────────────────
ok("the dropdown is built from the filtered lists",
  /searchResultRows\(sortedClients, filteredLocal, idNums\)/.test(C));
// ⚠️ THE SAME RULE AS activeQ: everything hanging off the input has to die with
// the input, or a roster that shrinks under the threshold strands an open
// dropdown with nothing on screen to close it.
ok("the dropdown cannot outlive the box",
  /const dropShown = searchable && searching && dropOpen;/.test(C));
ok("typing opens it", /setRosterQ\(e\.target\.value\); setDropOpen\(true\)/.test(C));
ok("clearing the box closes it", /setRosterQ\(""\); setDropOpen\(false\)/.test(C));
ok("returning to a box that still has a query reopens it",
  /onFocus=\{\(\) => \{ if \(searchNorm\(rosterQ\)\) setDropOpen\(true\); \}\}/.test(C));
// ⚠️ AND A CLICK REOPENS IT TOO, WHICH onFocus CANNOT COVER. Escape closes the
// list without blurring the box, so the box is already focused and a click on
// it fires no focus event — the dropdown stayed shut until you typed another
// character. Measured in a browser, not read off the source.
ok("...and so does clicking a box that never lost focus",
  /onClick=\{\(\) => \{ if \(searchNorm\(rosterQ\)\) setDropOpen\(true\); \}\}/.test(C));
// ArrowDown is the third way in, for a keyboard that never touches the mouse.
ok("...and ArrowDown opens a closed list",
  /if \(!dropOpen\) \{ setDropOpen\(true\); return; \}/.test(C));

// ⚠️ ABSOLUTE, NOT FIXED. ".page-transition" keeps a CSS transform, which makes
// it the containing block for anything positioned "fixed" — the trap every
// modal in this app goes through createPortal to escape. An absolute child of a
// relative wrapper is immune to it, so this must stay absolute AND stay wrapped.
{
  const i = C.indexOf('id="roster-search-list"');
  const tag = i > 0 ? C.slice(i, C.indexOf(">", i)) : "";
  ok("the dropdown is positioned absolutely", /\babsolute\b/.test(tag));
  ok("...never fixed", !/\bfixed\b/.test(tag));
  ok("...against a relative wrapper",
    /<div ref=\{searchWrapRef\} className="relative/.test(C));
  // A drag inside a scrolling list at the very top of the page is not a pull to
  // refresh (S228); PTR_IGNORE is how a subtree opts out.
  ok("...and pull-to-refresh does not arm inside it", /data-ptr-ignore/.test(tag));
  ok("...it scrolls rather than growing past the screen", /overflow-y-auto/.test(tag));
  ok("...without chaining that scroll to the page", /overscroll-contain/.test(tag));
  ok("...and paints over the cards below it", /z-\[30\]/.test(tag));
}
// ⚠️ NO SILENT CAP. The list is bounded by a scrolling height, not by dropping
// matches — a search that shows 8 of 30 and says nothing is lying.
ok("no match is hidden by a row cap",
  !/searchRows\.slice\(0,/.test(C) && !/searchRows\.slice\(-/.test(C));

// Keyboard: a laptop trainer should never have to reach for the mouse.
ok("arrow keys move the highlight", /e\.key === "ArrowDown" \|\| e\.key === "ArrowUp"/.test(C));
ok("...wrapping at both ends", /i < 0 \? \(d > 0 \? 0 : len - 1\) : \(i \+ d \+ len\) % len/.test(C));
ok("...and the highlighted row is scrolled into view", /block: "nearest"/.test(C));
// ⚠️ ANCHORED TO THIS HANDLER, NOT TO THE WORD. App.jsx closes a dozen sheets
// on Escape, so a bare /e.key === "Escape"/ stayed GREEN with THIS one deleted —
// it was matching somebody else's modal.
ok("Escape closes it",
  /if \(e\.key === "Escape"\) \{\s*if \(dropOpen\) \{[^}]*setDropOpen\(false\); \}/.test(C));
// ...and only closes the dropdown. Swallowing Escape when it is already shut
// would eat the key the screen behind it is listening for.
ok("...without eating Escape when it is already shut", /if \(dropOpen\) \{ e\.preventDefault\(\)/.test(C));
// ⚠️ ONE RESULT AND NOTHING HIGHLIGHTED IS STILL AN UNAMBIGUOUS ANSWER, and
// several results is not — Enter must not guess.
ok("Enter opens the only result", /searchRows\.length === 1 \? searchRows\[0\] : null/.test(C));
// A new query's results are a different list; an index into the old one points
// at the wrong person.
ok("a new query starts with nothing highlighted",
  /useEffect\(\(\) => \{ setActiveIdx\(-1\); \}, \[activeQ\]\);/.test(C));

// ⚠️ pointerdown IN CAPTURE, NOT blur. Closing on blur races the tap that is
// choosing a result: on iOS the input blurs first and the row unmounts out from
// under the finger.
ok("a tap outside closes it", /document\.addEventListener\("pointerdown", away, true\)/.test(C));
ok("...and the listener is removed again",
  /document\.removeEventListener\("pointerdown", away, true\)/.test(C));
ok("...but a tap inside is ours", /!w\.contains\(e\.target\)/.test(C));

// Choosing: exactly the two actions the cards already perform.
ok("a client row opens their plan",
  /if \(row\.kind === "client"\) \{ if \(onOpenClientPlan\) onOpenClientPlan\(row\.uid\); return; \}/.test(C));
ok("a plan row opens the file", /setDropOpen\(false\);[\s\S]{0,400}?onSelect\(row\.id\);/.test(C));
ok("a reveal scrolls to that client's card", /document\.getElementById\("roster-" \+ row\.uid\)/.test(C));
ok("...and the card has that id to be found by", /id=\{.roster-\$\{c\.uid\}.\}/.test(C));
// ⚠️ THE MARK IS TWO THINGS, SO IT IS COUNTED AS TWO. One assertion on
// "flashUid === c.uid" stayed GREEN with the ring deleted, because the same
// expression also drives the border — the repeat-occurrence trap this repo has
// paid for four times. Each half is pinned where it lives.
ok("...and is marked so the scroll reads as a result",
  /boxShadow: flashUid === c\.uid \? "0 0 0 2px rgba\(var\(--accent-rgb\)[^"]*" : undefined/.test(C));
ok("...on the border as well as the ring",
  /border \$\{flashUid === c\.uid \? "border-primary" : "border-border"\}/.test(C));
// A ring left behind reads as state the card does not have.
ok("the mark clears itself", /setFlashUid\(""\), 2200/.test(C));
// The card must not land under the two fixed chrome buttons.
ok("the revealed card clears the fixed chrome", /scrollMarginTop: "calc\(96px/.test(C));

// ⚠️ TWO ANSWERS TO THE SAME QUERY ON SCREEN AT ONCE IS ONE TOO MANY. The count
// line is what is left once the dropdown is dismissed.
ok("the summary yields to the dropdown", /\{searching && !dropShown && \(/.test(C));
{
  const i = C.indexOf('id="roster-search-list"');
  const block = i > 0 ? C.slice(i, i + 1400) : "";
  ok("an empty dropdown says what to try",
    /searchRows\.length === 0[\s\S]{0,200}?\{SEARCH_EMPTY_HINT\}/.test(block));
}

// It is a combobox, and says so.
ok("the input announces itself as a combobox", /role="combobox"/.test(C));
ok("...with the list it controls", /aria-controls="roster-search-list"/.test(C));
ok("...and whether it is open", /aria-expanded=\{dropShown\}/.test(C));
ok("...and which row is active", /aria-activedescendant=/.test(C));
ok("the list is a listbox", /role="listbox"/.test(C));
ok("its rows are options", /role="option"/.test(C));
ok("...with the selected one marked", /aria-selected=\{on\}/.test(C));
// A heading inside a listbox must not read as a choosable row.
ok("the group headings are not options", /role="presentation"/.test(C));

console.log(`\n  ${checks - fails}/${checks} checks passed`);
console.log("  One box, both lists, and nothing hiding behind a collapsed card.\n");
process.exit(fails ? 1 : 0);
