// Address autocomplete (S207, Kevin: "can it start to auto populate options").
//
// ⚠️ THE POINT IS NOT TYPING CONVENIENCE. "Coconut Grove" and "the gym" are what
// people actually type, and both geocoders answer them with the middle of
// somewhere — which the S199u/v precision guard then correctly refuses, so the
// drive estimate silently produces nothing and nobody can see why. Picking a
// real suggestion is what makes the address resolvable. So the rules pinned here
// are mostly about what happens when the suggestions AREN'T there.
//
// The invariants:
//   • it is a TEXT INPUT FIRST — every failure degrades to an empty list, never
//     an error, because the person is mid-sentence;
//   • the Maps key never reaches the browser (the whole reason this is a proxy);
//   • every request is BILLABLE, so short input, pasted URLs and re-querying our
//     own inserted text are all rejected before the network;
//   • a slow answer for an old prefix must never land on a newer one.
//
// Run: node scripts/test-address-autocomplete.mjs
import { readFileSync } from "fs";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const APP = readFileSync(join(ROOT, "src", "App.jsx"), "utf8");
const PLACES = readFileSync(join(ROOT, "functions", "places.js"), "utf8");
const INDEX = readFileSync(join(ROOT, "functions", "index.js"), "utf8");
const P = require(join(ROOT, "functions", "places.js"));

let fails = 0, checks = 0;
const ok = (n, c, x) => { checks++; if (!c) { fails++; console.log("  FAIL:", n, x !== undefined ? JSON.stringify(x) : ""); } };
// Assertions about rendered markup must not match the prose ABOVE it — the
// mistake this session made three times in one afternoon.
const codeOnly = (src) => src.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
const APP_CODE = codeOnly(APP);

// ── what we spend a request on ──────────────────────────────────────────────
ok("a real fragment is worth asking", P.worthAsking("1111 Lincoln") === "1111 Lincoln");
ok("...and is trimmed", P.worthAsking("  12 Main St  ") === "12 Main St");
// Every keystroke past this costs a billable event.
ok("one character is not", P.worthAsking("1") === "");
ok("two characters are not", P.worthAsking("12") === "");
ok(`the floor is ${P.MIN_CHARS}`, P.MIN_CHARS === 3, P.MIN_CHARS);
ok("nothing is not", P.worthAsking("") === "" && P.worthAsking(null) === "" && P.worthAsking(undefined) === "");
ok("whitespace is not", P.worthAsking("    ") === "");
// ⚠️ The Location field's own placeholder invites a Zoom link. Sending one to a
// PLACE index spends a request to learn nothing.
ok("a pasted URL is not", P.worthAsking("https://zoom.us/j/12345") === "");
ok("...http too", P.worthAsking("http://meet.example.com/abc") === "");
ok("an absurdly long paste is not", P.worthAsking("a".repeat(500)) === "");
// A street address containing the word "http" is still an address.
ok("an address is not rejected for containing a scheme-like word",
   P.worthAsking("12 Https Lane, Miami") === "12 Https Lane, Miami");

// ── what comes back, and what does NOT ──────────────────────────────────────
const resp = {
  suggestions: [
    { placePrediction: { text: { text: "1111 Lincoln Rd, Miami Beach, FL, USA" },
      placeId: "ChIJsecret", types: ["street_address"],
      structuredFormat: { mainText: { text: "1111 Lincoln Rd" }, secondaryText: { text: "Miami Beach, FL, USA" } } } },
    { queryPrediction: { text: { text: "gyms near me" } } },
    { placePrediction: { text: { text: "2100 Collins Ave, Miami Beach, FL, USA" } } },
  ],
};
const parsed = P.parseSuggestions(resp);
ok("a place prediction becomes a suggestion", parsed[0].value === "1111 Lincoln Rd, Miami Beach, FL, USA");
ok("...split for display", parsed[0].main === "1111 Lincoln Rd" && parsed[0].secondary === "Miami Beach, FL, USA");
// ⚠️ A queryPrediction is a SEARCH ("gyms near me"), not a place. Inserting one
// into the field would put un-geocodable text in exactly the box this feature
// exists to keep clean.
ok("a query prediction is dropped", parsed.length === 2, parsed.map((x) => x.value));
ok("a prediction with no structuredFormat still works", parsed[1].main === "2100 Collins Ave, Miami Beach, FL, USA");
// Google's own proxy guidance: filter out what the client doesn't need.
ok("no placeId leaves the server", !JSON.stringify(parsed).includes("ChIJsecret"), parsed);
ok("no types leave the server", !JSON.stringify(parsed).includes("street_address"), parsed);
ok("junk in is an empty list out",
   P.parseSuggestions(null).length === 0 && P.parseSuggestions({}).length === 0
   && P.parseSuggestions({ suggestions: "nope" }).length === 0);
ok("an entry with empty text is skipped",
   P.parseSuggestions({ suggestions: [{ placePrediction: { text: { text: "   " } } }] }).length === 0);
ok("the list is capped", P.parseSuggestions({ suggestions: Array.from({ length: 20 },
   () => ({ placePrediction: { text: { text: "x y z" } } })) }).length === 5);

// ── it never throws at the field ────────────────────────────────────────────
// ⚠️ THE API WAS NOT ENABLED ON THE PROJECT when this shipped, and an unenabled
// API answers 403 to every call. A suggestion service that is down, throttled or
// switched off must leave a working text input behind.
ok("an upstream failure returns a list, not an error", /return \{ suggestions: \[\], upstream: r\.status \}/.test(PLACES));
ok("a thrown fetch returns a list too", /catch \(e\) \{[\s\S]{0,120}return \{ suggestions: \[\] \}/.test(PLACES));
ok("a missing key returns a list too", /return \{ suggestions: \[\], configured: false \}/.test(PLACES));
ok("...and the only throw is the auth check",
   (PLACES.match(/throw new HttpsError/g) || []).length === 1,
   (PLACES.match(/throw new HttpsError/g) || []).length);
ok("signed-in only — an open endpoint is somebody else's free autocomplete",
   /if \(!uid\) throw new HttpsError\("unauthenticated"/.test(PLACES));
ok("a placeholder key behaves as no key", /startsWith\("AIza"\)/.test(PLACES));
ok("the upstream call is bounded by a timeout", /AbortController/.test(PLACES) && /TIMEOUT_MS/.test(PLACES));

// ── cost controls ───────────────────────────────────────────────────────────
// Places bills by the FIELDS requested; asking for everything moves the request
// to a dearer SKU.
ok("a field mask is sent", /X-Goog-FieldMask/.test(PLACES));
ok("...and it does not ask for everything", !/"X-Goog-FieldMask":\s*"\*"/.test(PLACES));
ok("...only text and structuredFormat", /suggestions\.placePrediction\.text,suggestions\.placePrediction\.structuredFormat/.test(PLACES));
// ⚠️ NO SESSION TOKENS, DELIBERATELY: they bundle typing with a terminating
// Place Details call, and we never make one — the address TEXT is what the
// existing geocode pipeline consumes, so Details would be a second billed SKU
// to fetch coordinates we then throw away.
ok("no session token, because no Place Details call is made",
   !/sessionToken/.test(PLACES) && !/places\/[^"]*\?fields/.test(PLACES));
ok("...and Place Details is genuinely never called", !/v1\/places\/\$\{/.test(PLACES));
ok("results are biased to addresses, not businesses", /includedPrimaryTypes/.test(PLACES));

// ── the key never reaches the browser ───────────────────────────────────────
// The whole reason this is a proxy: Google key restrictions are EXCLUSIVE, so a
// browser key would have to be a SECOND key, and referrer restrictions are
// unreliable by Google's own admission.
ok("the app calls the proxy, never Google", /httpsCallable\(functions, "placesAutocomplete"\)/.test(APP));
ok("...and no Places endpoint appears in the bundle at all",
   !/places\.googleapis\.com/.test(APP), true);
ok("...nor any Maps key literal", !/AIza/.test(APP), true);
ok("the function is registered", /exports\.placesAutocomplete = require\("\.\/places"\)\.placesAutocomplete;/.test(INDEX));

// ── the field behaves like a field ──────────────────────────────────────────
ok("the input is a typeahead in all three address fields",
   (APP_CODE.match(/<AddressInput/g) || []).length === 3,
   (APP_CODE.match(/<AddressInput/g) || []).length);
// ⚠️ WRITTEN PROPERLY THE SECOND TIME. The first version matched a plain
// `<input …/>` only at end-of-line, so it passed against a file where all three
// fields were still plain — it asserted almost nothing. The real rule is that
// each of the three address placeholders now sits on an AddressInput and not on
// a bare input, so check exactly that, per placeholder.
for (const ph of ["e.g. 1111 Lincoln Rd", "Studio, or an address to check drive time", "e.g. Studio, or a Zoom link"]) {
  const i = APP_CODE.indexOf(ph);
  ok(`"${ph.slice(0, 26)}…" is still a field`, i > 0, i);
  // Walk back to the tag that owns this placeholder.
  const tagStart = APP_CODE.lastIndexOf("<", i);
  const tag = APP_CODE.slice(tagStart, tagStart + 16);
  ok(`…and it is an AddressInput, not a bare input: ${tag.trim()}`, tag.startsWith("<AddressInput"), tag);
}
// ⚠️ Typing outruns the network: an earlier, slower reply must not land on top
// of a later one and suggest a prefix the person has moved past.
// ⚠️ COUNT BOTH ARMS. The guard exists on the resolve AND the reject path, and
// the first version of this check merely asked whether the pattern appeared
// somewhere — so it stayed green when the resolve arm was stripped, because the
// catch arm still matched. That is the third time in this session a guard in two
// places was asserted in one; count, do not match.
ok("a stale response cannot overwrite a newer one — on BOTH arms",
   (APP_CODE.match(/mine === seq\.current/g) || []).length === 2,
   (APP_CODE.match(/mine === seq\.current/g) || []).length);
ok("requests are debounced — every one is billable", /ADDR_DEBOUNCE_MS/.test(APP_CODE));
// Picking must not immediately re-query the text it just inserted.
ok("our own inserted text is not re-queried", /q === selfSet\.current/.test(APP_CODE), true);
ok("...and a manual edit clears that guard", /selfSet\.current = ""/.test(APP_CODE), true);
// The blur/click race: onClick alone loses to the input's blur.
ok("picking survives the input's blur", /onMouseDown=\{\(e\) => \{ e\.preventDefault\(\); pick\(s\)/.test(APP_CODE), true);
ok("...and the close is deferred past the tap", /setTimeout\(\(\) => setOpen\(false\), 160\)/.test(APP_CODE), true);
ok("keyboard navigation works", /ArrowDown/.test(APP_CODE) && /ArrowUp/.test(APP_CODE) && /Escape/.test(APP_CODE));
ok("browser autofill does not fight the list", /autoComplete="off"/.test(APP_CODE));
ok("the saved-address field still enforces its length bound",
   /<AddressInput value=\{addr\} maxLength=\{MAX_ADDRESS_LEN\}/.test(APP_CODE), true);

console.log(`  ${checks - fails}/${checks} assertions passed`);
process.exit(fails ? 1 : 0);
