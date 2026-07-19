#!/usr/bin/env node
// Photo-logging accuracy harness (S97, Kevin's pick) — evaluates Glidna's REAL
// production photo path (the deployed aiChat callable: same system prompt,
// tools, and model as the app) against Nutrition5k ground truth (Google
// Research: ~5k real cafeteria plates with lab-measured mass/calories/macros).
//
// Usage:  node scripts/photo-eval.mjs [dishCount]
//   env:  EVAL_EMAIL / EVAL_PASS override the test account (default client.uitest)
//
// Calls are metered against the test account's normal daily AI budget (the
// prompt-cache prefix bills once, then each dish is ~1.5k tokens), so a run of
// 8-10 dishes fits comfortably. Results: docs/AI-PHOTO-EVAL.md + a JSON dump.
//
// Dataset: https://github.com/google-research-datasets/Nutrition5k (CC BY 4.0).
// Overhead RGB images + dish metadata are on public GCS — no auth needed.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";

const N = Math.min(Number(process.argv[2]) || 8, 20);
const PROJECT = "calorieiq-29762";
const REGION = "us-central1";
const GCS = "https://storage.googleapis.com/nutrition5k_dataset/nutrition5k_dataset";
const EMAIL = process.env.EVAL_EMAIL || "client.uitest@calorieiq-test.com";
const PASS = process.env.EVAL_PASS || "TestPass123";

// ── Firebase web API key from .env.local (public-by-design key) ──────────────
const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const API_KEY = (env.match(/^VITE_FIREBASE_API_KEY=(.+)$/m) || [])[1]?.trim();
if (!API_KEY) { console.error("VITE_FIREBASE_API_KEY not found in .env.local"); process.exit(1); }

const signIn = async () => {
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASS, returnSecureToken: true }),
  });
  const j = await r.json();
  if (!j.idToken) throw new Error("Sign-in failed: " + JSON.stringify(j.error || j));
  return j.idToken;
};

// ── Pick dishes: parse metadata, keep plausible single-plate meals, sample for
//    variety, and verify each has an overhead image before including it. ──────
const pickDishes = async () => {
  const csv = await (await fetch(`${GCS}/metadata/dish_metadata_cafe1.csv`)).text();
  const rows = csv.trim().split("\n").map((l) => {
    const c = l.split(",");
    return { id: c[0], cal: +c[1], mass: +c[2], fat: +c[3], carb: +c[4], protein: +c[5] };
  }).filter((d) => d.id?.startsWith("dish_") && d.cal >= 120 && d.cal <= 1100 && d.mass >= 60);
  const picked = [];
  for (let i = 0; i < rows.length && picked.length < N; i += 17) { // stride → variety
    const d = rows[i];
    const head = await fetch(`${GCS}/imagery/realsense_overhead/${d.id}/rgb.png`, { method: "HEAD" });
    if (head.ok) picked.push(d);
  }
  return picked;
};

const b64Image = async (id) => {
  const buf = await (await fetch(`${GCS}/imagery/realsense_overhead/${id}/rgb.png`)).arrayBuffer();
  return Buffer.from(buf).toString("base64");
};

// ── One dish through the production callable ─────────────────────────────────
const PROMPT = "Here's a photo of my meal (overhead view of one plate/bowl — the whole visible portion is mine). Estimate what it is and its calories and macros for the entire visible portion.";
const evalDish = async (idToken, dish) => {
  const data = await b64Image(dish.id);
  const r = await fetch(`https://${REGION}-${PROJECT}.cloudfunctions.net/aiChat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
    body: JSON.stringify({ data: { messages: [{ role: "user", content: [
      { type: "image", source: { type: "base64", media_type: "image/png", data } },
      { type: "text", text: PROMPT },
    ] }] } }),
  });
  const j = await r.json();
  if (j.error) return { error: j.error.message || j.error.status || "callable error" };
  const res = j.result || {};
  const p = res.proposal;
  if (p && p.calories > 0) {
    return { est: { cal: +p.calories, protein: +p.protein || 0, carb: +p.carbs || 0, fat: +p.fat || 0 },
      name: p.name || "", via: "proposal" };
  }
  // Fallback: pull the first "N cal/calories" figure out of the reply text.
  const m = String(res.reply || "").replace(/,/g, "").match(/(\d{2,4})\s*(?:cal|kcal|calories)/i);
  if (m) return { est: { cal: +m[1], protein: null, carb: null, fat: null }, name: "", via: "text" };
  return { error: "no estimate in reply", reply: String(res.reply || "").slice(0, 160) };
};

// ── Run ──────────────────────────────────────────────────────────────────────
const pct = (a, b) => Math.abs(a - b) / b * 100;
const main = async () => {
  console.log(`Signing in as ${EMAIL}…`);
  const idToken = await signIn();
  console.log("Picking dishes with images…");
  const dishes = await pickDishes();
  console.log(`Evaluating ${dishes.length} dishes through the deployed aiChat…`);
  const out = [];
  for (const d of dishes) {
    process.stdout.write(`  ${d.id} (truth ${Math.round(d.cal)} cal)… `);
    try {
      const r = await evalDish(idToken, d);
      if (r.error) { console.log("ERROR:", r.error); out.push({ ...d, error: r.error }); }
      else {
        const ape = pct(r.est.cal, d.cal);
        console.log(`est ${r.est.cal} cal (${ape.toFixed(0)}% off, via ${r.via}) ${r.name}`);
        out.push({ ...d, ...r, ape });
      }
      if (String(r.error || "").includes("RESOURCE_EXHAUSTED")) break; // budget hit — stop
    } catch (e) { console.log("THREW:", e.message); out.push({ ...d, error: e.message }); }
    await new Promise((x) => setTimeout(x, 1500));
  }

  const ok = out.filter((o) => o.ape != null);
  const apes = ok.map((o) => o.ape).sort((a, b) => a - b);
  const mape = apes.reduce((s, a) => s + a, 0) / (apes.length || 1);
  const median = apes[Math.floor(apes.length / 2)] ?? null;
  const within = (t) => ok.filter((o) => o.ape <= t).length;
  const protOk = ok.filter((o) => o.est.protein != null && o.protein > 3);
  const protMae = protOk.reduce((s, o) => s + Math.abs(o.est.protein - o.protein), 0) / (protOk.length || 1);

  const stamp = new Date().toISOString().slice(0, 10);
  const md = `# AI photo-logging accuracy — Nutrition5k eval (${stamp})

Production path (deployed \`aiChat\`, model per backend) vs lab-measured ground truth.
${ok.length}/${out.length} dishes returned an estimate.

| Metric | Value |
|---|---|
| Mean abs % error (calories) | **${mape.toFixed(1)}%** |
| Median abs % error | **${median?.toFixed(1)}%** |
| Within 20% of truth | ${within(20)}/${ok.length} |
| Within 30% of truth | ${within(30)}/${ok.length} |
| Protein MAE | ${protMae.toFixed(1)} g (${protOk.length} dishes) |

| Dish | Truth cal | Est cal | % err | Est name |
|---|---|---|---|---|
${out.map((o) => o.ape != null
    ? `| ${o.id} | ${Math.round(o.cal)} | ${o.est.cal} | ${o.ape.toFixed(0)}% | ${(o.name || "").slice(0, 40)} |`
    : `| ${o.id} | ${Math.round(o.cal)} | — | error: ${o.error} | |`).join("\n")}

Notes: overhead cafeteria photos (no scale reference, mixed plates) — a hard,
honest test. Re-run: \`node scripts/photo-eval.mjs [count]\`. Tune the vision
guidance in \`functions/aichat.js\` / the S90 photo-tips, then re-run to compare.
`;
  if (!existsSync("docs")) mkdirSync("docs");
  writeFileSync("docs/AI-PHOTO-EVAL.md", md);
  writeFileSync("docs/AI-PHOTO-EVAL.last.json", JSON.stringify(out, null, 1));
  console.log(`\nMAPE ${mape.toFixed(1)}% · median ${median?.toFixed(1)}% · within-30% ${within(30)}/${ok.length}`);
  console.log("Wrote docs/AI-PHOTO-EVAL.md");
};
main().catch((e) => { console.error(e); process.exit(1); });
