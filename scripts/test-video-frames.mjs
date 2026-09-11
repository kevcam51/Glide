// Turning a clip into the few photographs worth sending (S223).
//
// KEVIN's wearable-camera idea. Video to a model is the expensive way to answer
// "what did they eat" — a minute of footage is thousands of frames and runs to
// dollars a day per person. Three good stills cost about two cents and answer
// the same question, because the model needs a clear look at the plate, not the
// motion between looks.
//
// The clip never leaves the phone. The browser decodes it, the app picks frames,
// and only those are sent. Everything touching <video>/<canvas> is untestable in
// Node — so the two decisions that are actually algorithmic were written as pure
// functions, and this suite LIFTS AND RUNS them out of src/App.jsx rather than
// describing them (a suite that tests a transcribed copy stays green while the
// shipping file breaks — S199k).
//
// ⚠️ THE ASSERTION THAT MATTERS MOST: sharpest-three is the WRONG answer. The
// sharpest frames in a clip are nearly always ADJACENT — the same half-second of
// the same plate — so a naive top-3 sends one photograph three times and pays
// three times for it. If pickFrames ever degrades into a sort, the spacing tests
// below are what catch it.
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const APP = readFileSync(join(ROOT, "src/App.jsx"), "utf8");

let checks = 0, fails = 0;
const ok = (n, c, x) => { checks++; if (!c) { fails++; console.log("  FAIL:", n, x !== undefined ? JSON.stringify(x) : ""); } };

// ⚠️ THE BRACE SCAN MUST START AFTER THE PARAMETER LIST, and my first version
// did not. `pickFrames(cands, { want = 3, … } = {})` carries DESTRUCTURED
// params, so "the first { after the name" is the options object — the counter
// balanced on it and returned the signature with no body. The failure is loud
// here (a syntax error), but the same bug in a text-matching suite is silent:
// it lifts half a function and every assertion against it still "passes".
// Match the signature's parens first, then take the { that follows.
function lift(name) {
  const start = APP.indexOf(`function ${name}(`);
  if (start === -1) return null;
  let p = 0, sigEnd = -1;
  for (let j = APP.indexOf("(", start); j < APP.length; j++) {
    const ch = APP[j];
    if (ch === "(") p++;
    else if (ch === ")") { p--; if (!p) { sigEnd = j; break; } }
  }
  if (sigEnd === -1) return null;
  let depth = 0, end = -1;
  for (let j = APP.indexOf("{", sigEnd); j < APP.length; j++) {
    const ch = APP[j];
    if (ch === "{") depth++;
    else if (ch === "}") { depth--; if (!depth) { end = j + 1; break; } }
  }
  return end > start ? APP.slice(start, end) : null;
}

const src = ["scoreFrame", "pickFrames", "frameTimes"].map(lift);
ok("all three pure helpers lift cleanly", src.every(Boolean));
const { scoreFrame, pickFrames, frameTimes } =
  new Function(`${src.join("\n")}; return { scoreFrame, pickFrames, frameTimes };`)();

// ── frameTimes: where to look ───────────────────────────────────────────────
{
  const t = frameTimes(10, 12);
  ok("a 10s clip yields probes", t.length >= 2, t.length);
  // ⚠️ Clips start while the phone is still moving and end as it is lowered, so
  // the outer eighth at each end is reliably the worst footage in the file.
  ok("it skips the first eighth", t[0] >= 10 * 0.125 - 1e-9, t[0]);
  ok("it skips the last eighth", t[t.length - 1] <= 10 * 0.875 + 1e-9, t[t.length - 1]);
  ok("the probes march forward", t.every((x, i) => i === 0 || x > t[i - 1]));
  ok("…and none land outside the clip", t.every((x) => x >= 0 && x <= 10));
}
{
  ok("a sub-second clip is sampled once, in the middle", JSON.stringify(frameTimes(0.6)) === JSON.stringify([0.3]));
  ok("a zero-length clip yields nothing rather than NaN", frameTimes(0).length === 0);
  ok("a missing duration yields nothing", frameTimes(undefined).length === 0);
  ok("a corrupt duration yields nothing", frameTimes(NaN).length === 0);
  // A short clip should not be probed 12 times — the frames would be duplicates.
  ok("a 2s clip is probed sparingly", frameTimes(2, 12).length <= 4, frameTimes(2, 12).length);
}

// ── scoreFrame: is this frame any good ──────────────────────────────────────
// Synthetic frames, built as RGBA the way getImageData hands them over.
const frame = (w, h, fn) => {
  const d = new Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = fn(x, y), i = (y * w + x) * 4;
      d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255;
    }
  }
  return d;
};
const W = 32, H = 32;
const flat = scoreFrame(frame(W, H, () => 128), W, H);
const checker = scoreFrame(frame(W, H, (x, y) => ((x + y) % 2 ? 255 : 0)), W, H);
const dark = scoreFrame(frame(W, H, () => 4), W, H);
const blown = scoreFrame(frame(W, H, () => 252), W, H);
const darkNoise = scoreFrame(frame(W, H, (x, y) => ((x * 7 + y * 13) % 11 < 5 ? 0 : 14)), W, H);

ok("a flat frame has almost no detail", flat.sharp < 1, flat);
ok("a detailed frame scores far higher", checker.sharp > flat.sharp * 20, { checker: checker.sharp, flat: flat.sharp });
ok("brightness is reported too", Math.round(flat.lum) === 128, flat.lum);
ok("a dark frame reads dark", dark.lum < 18, dark.lum);
ok("a blown-out frame reads bright", blown.lum > 245, blown.lum);
// ⚠️ THE TRAP scoreFrame ALONE CANNOT SOLVE: sensor noise in a near-black frame
// is all edges. It scores as "sharp" and shows nothing. That is why pickFrames
// filters on brightness BEFORE ranking, not after.
ok("noise in a dark frame still scores sharp — which is why brightness is a separate gate",
   darkNoise.sharp > flat.sharp && darkNoise.lum < 18, darkNoise);
ok("a degenerate frame returns zeros rather than NaN",
   scoreFrame([], 0, 0).sharp === 0 && scoreFrame(null, 5, 5).sharp === 0);

// ── pickFrames: which ones to actually send ─────────────────────────────────
const c = (t, sharp, lum = 128) => ({ t, sharp, lum });

{
  // ⚠️ THE CENTRAL CASE. The four sharpest frames are all inside one second —
  // the same moment of the same plate. A sort would return three of them and
  // send one photograph three times.
  const cands = [
    c(1.0, 100), c(1.1, 99), c(1.2, 98), c(1.3, 97),   // one clustered moment
    c(5.0, 60), c(9.0, 55),                            // genuinely different looks
  ];
  const got = pickFrames(cands, { want: 3, minGapSec: 0.8 });
  ok("three frames come back", got.length === 3, got.length);
  const ts = got.map((g) => g.t);
  ok("…and they are spread across the clip, not one cluster",
     ts.every((a, i) => i === 0 || a - ts[i - 1] >= 0.8), ts);
  ok("…keeping the best of the cluster", ts.includes(1.0), ts);
  ok("…plus the other viewpoints", ts.includes(5) && ts.includes(9), ts);
  ok("…in chronological order, which reads better in chat",
     ts.slice().sort((a, b) => a - b).join() === ts.join(), ts);
}
{
  // Dark and blown-out frames are refused even when they score sharp.
  const got = pickFrames([c(1, 900, 3), c(2, 900, 252), c(3, 40, 128)], { want: 3 });
  ok("a near-black frame is refused however sharp it scores", !got.some((g) => g.t === 1), got);
  ok("a blown-out frame is refused too", !got.some((g) => g.t === 2), got);
  ok("…leaving the usable one", got.length === 1 && got[0].t === 3, got);
}
{
  ok("nothing usable returns nothing", pickFrames([c(1, 900, 2), c(2, 900, 254)], { want: 3 }).length === 0);
  ok("an empty list is handled", pickFrames([], { want: 3 }).length === 0);
  ok("a missing list is handled", pickFrames(null, { want: 3 }).length === 0);
  ok("candidates with broken numbers are dropped",
     pickFrames([{ t: NaN, sharp: 9, lum: 128 }, { t: 1, sharp: NaN, lum: 128 }], { want: 3 }).length === 0);
}
{
  // ⚠️ A CLIP SHORTER THAN THE GAP MUST STILL YIELD ONE FRAME. Returning nothing
  // would mean someone picks a two-second video, waits, and is silently ignored.
  const got = pickFrames([c(0.1, 50), c(0.2, 90), c(0.3, 40)], { want: 3, minGapSec: 5 });
  ok("a very short clip still yields a frame", got.length === 1, got);
  ok("…and it is the best one", got[0].t === 0.2, got);
}
{
  ok("want is respected", pickFrames([c(1, 9), c(3, 8), c(5, 7), c(7, 6)], { want: 2 }).length === 2);
  ok("asking for more than exists is fine",
     pickFrames([c(1, 9), c(3, 8)], { want: 9 }).length === 2);
}

// ── the wiring ──────────────────────────────────────────────────────────────
ok("the picker offers videos as well as photos", /accept="image\/\*,video\/\*"/.test(APP));
ok("videos are separated from photos on pick", /f\.type\.startsWith\("video\/"\)/.test(APP));
// ⚠️ ONE CLIP AT A TIME. Decoding runs on the main thread; several at once locks
// a phone up for the length of all of them with nothing on screen to explain it.
ok("only the first clip is decoded", /framesFromVideo\(videos\[0\]/.test(APP));
ok("…and the user is told the rest were skipped", /One video at a time/.test(APP));
ok("a clip that will not decode fails with an actionable message",
   /Couldn't read that video\. Try a photo of the plate instead\./.test(APP));
// ⚠️ Every wait inside framesFromVideo is bounded: an undecodable codec does not
// throw, it simply never fires the event — an unbounded await is a permanent
// spinner with no error and no way back.
{
  const fn = lift("framesFromVideo");
  ok("framesFromVideo lifts", !!fn);
  // ⚠️ BOUNDS, because this one is only TEXT-MATCHED, never executed. The three
  // helpers above are run, so a truncated lift there fails loudly. A truncated
  // lift here would just shrink the haystack and quietly weaken every assertion
  // below it — so assert the body actually arrived.
  ok("…with its whole body, not just the signature",
     !!fn && fn.includes("finish(resolve, urls)") && fn.length > 1200, fn ? fn.length : 0);
  // ⚠️ THIS ASSERTION USED TO READ `waits.length >= 3` AND WAS WORTHLESS.
  // There are four waits; deleting one timeout left three, the floor was still
  // met, and a mutation test proved it stayed green while the code grew a
  // permanent spinner. "At least N of them are right" is not the property —
  // "none of them are wrong" is. Count the UNTIMED ones and require zero.
  const allWaits = (fn.match(/once\(v,\s*"[a-z]+"[^)]*\)/g) || []);
  const untimed = allWaits.filter((s) => !/,\s*\d+\s*\)$/.test(s));
  ok("there are event waits to check", allWaits.length >= 3, allWaits.length);
  ok("and NOT ONE of them is unbounded", untimed.length === 0, untimed);
  ok("…and the object URL is released on every exit path", /revokeObjectURL/.test(fn));
}
ok("the composer says what it is doing while decoding", /Reading your video/.test(APP));
// The promise the copy makes has to be the true one: nothing is uploaded.
ok("…and the wording is 'reading', not 'uploading'",
   /Reading your video — picking the clearest few frames to send/.test(APP));

console.log(`${checks - fails}/${checks} video-frame assertions passed`);
if (fails) process.exit(1);
