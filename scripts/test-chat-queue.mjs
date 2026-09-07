// Typing while the assistant is thinking (S201, Kevin).
//
// "Whenever the AI is processing a task the text box and the send button is
// blanked out so a user can't type or send anything… I don't want a point where
// a client is just sitting there waiting for a response instead of the fact that
// they could also be typing and possibly send a message or two while the AI is
// thinking."
//
// ⚠️ THE HALF THAT WAS ALREADY TRUE MADE IT WORSE. The textarea was never
// disabled — only Send was — so someone could type a whole follow-up and then
// discover they could not send it. Typing that goes nowhere is a worse
// experience than a locked box, because it wastes the effort before refusing.
//
// Queued turns are BATCHED into one follow-up rather than replayed one at a
// time: the model sees the whole thing together, which reads better, and it
// costs one API call instead of N against the user's daily budget.
//
// Run: node scripts/test-chat-queue.mjs
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const APP = readFileSync(join(ROOT, "src", "App.jsx"), "utf8");

let fails = 0, checks = 0;
const ok = (n, c, x) => { checks++; if (!c) { fails++; console.log("  FAIL:", n, x !== undefined ? JSON.stringify(x) : ""); } };

// ── the composer no longer refuses ────────────────────────────────────────
ok("Send is not disabled while a turn is running",
   /<button onClick=\{send\} disabled=\{recording \|\| transcribing \|\| \(!draft\.trim\(\) && !pendingImages\.length\)\}/.test(APP));
ok("...and the old busy gate is gone from it",
   !/onClick=\{send\} disabled=\{busy \|\| recording/.test(APP));

// ── it queues rather than dropping ────────────────────────────────────────
ok("a mid-turn send is parked", /if \(busy && !fresh && \(text \|\| \(imgs && imgs\.length\)\)\) \{/.test(APP));
ok("...and shown in the thread, so it visibly landed", /content: text, images: imgs\.length \? imgs : undefined, queued: true/.test(APP));
ok("...with the composer cleared like any other send", /queuedRef\.current = \[\.\.\.queuedRef\.current[\s\S]{0,220}setDraft\(""\)/.test(APP));
// ⚠️ It must LOOK queued. Rendering it identically to a sent message is the
// honest-looking lie — the person wonders why there is no reply.
ok("a queued bubble says so", /Queued — will be read next/.test(APP));
ok("...and is visually distinct", /m\.queued \? " opacity-70" : ""/.test(APP));

// ── and drains when the turn finishes ─────────────────────────────────────
ok("the queue is drained after the turn", /if \(queuedRef\.current\.length\) \{/.test(APP));
ok("...as ONE follow-up, not N calls", /\.map\(\(x\) => x\.text\)\.filter\(Boolean\)\.join\(/.test(APP) && !/queuedRef\.current\.forEach/.test(APP));
ok("...after setBusy(false), or it would queue against itself",
   APP.indexOf("setBusy(false);\n    setSearching(false);\n    // Drain") > 0);
ok("the optimistic bubbles are removed before the real send re-adds them",
   /const kept = prev\.filter\(\(m\) => !m\.queued\);/.test(APP));
ok("...and the real send continues from that cleaned thread", /send\(joined, \{ base: kept, images: qImgs \}\)/.test(APP));

// ⚠️ Photos attached mid-turn were the easy thing to drop: the programmatic
// send path hardcoded an empty image list.
ok("images queued mid-turn survive the drain", /const imgs = isOverride \? \(\(opts && opts\.images\) \|\| \[\]\) : pendingImages;/.test(APP));

// ── the one case that must NOT queue ──────────────────────────────────────
// `fresh` starts a brand-new chat from empty; parking that into the CURRENT
// thread would file it under the wrong conversation.
ok("a fresh-chat send is never queued into the running thread", /if \(busy && !fresh &&/.test(APP));

console.log(fails === 0
  ? `  PASS  chat queue (${checks} assertions)`
  : `  ${fails}/${checks} FAILED`);
process.exit(fails === 0 ? 0 : 1);
