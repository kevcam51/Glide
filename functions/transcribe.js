// Glide AI — voice transcription (speech-to-text for the AI chat).
//
// PROVIDER-AGNOSTIC: both OpenAI and Groq expose an OpenAI-compatible
// /audio/transcriptions endpoint, so ONE code path serves both — only the URL,
// model, and key differ. Groq (whisper-large-v3) is PRIMARY since S84 —
// cheaper + faster; OpenAI Whisper is the automatic fallback. Flip via
// VOICE_PRIMARY/VOICE_FALLBACK below.
//
// Cost: Whisper-class transcription is ~$0.006/min — pennies. The transcribed
// text then flows through the normal (budgeted) AI chat, so this endpoint just
// needs auth + a size cap. Keys live in Secret Manager (never in the repo).

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");

const OPENAI_API_KEY = defineSecret("OPENAI_API_KEY");
const GROQ_API_KEY = defineSecret("GROQ_API_KEY");

// Hard premium gate (Stripe v1, S89) — voice is part of the AI layer, so it
// locks with the trial like aiChat. Same semantics as aichat.js
// trialExpiredFor() / src/profile.js isPremium(); no-trialStartedAt accounts
// are grandfathered. Kept as a small local copy so this function stays
// independently deployable (it doesn't share aitools.js).
function trialExpiredFor(profile) {
  if (!profile) return false;
  if (profile.subscriptionStatus === "active") return false;
  if (profile.role === "admin") return false;
  if (profile.entitlements && profile.entitlements.premium === true) return false;
  const t = profile.trialStartedAt;
  const startMs = t && typeof t.toMillis === "function" ? t.toMillis()
    : typeof t === "number" ? t : null;
  if (!startMs) return false;
  return Date.now() >= startMs + (profile.trialLengthDays || 30) * 86400000;
}

// PRIMARY is tried first; if it errors and FALLBACK is set, that's tried next.
// Groq is PRIMARY: it's much faster than OpenAI Whisper, and in practice the
// OpenAI key wasn't billing (calls were failing → every request wasted a slow
// failed OpenAI attempt before falling back to Groq). OpenAI stays as a
// best-effort fallback in case Groq rate-limits.
const VOICE_PRIMARY = "groq";
const VOICE_FALLBACK = "openai";

function providerConfig(name) {
  if (name === "groq") {
    // whisper-large-v3-turbo: ~4× faster than large-v3, near-identical accuracy.
    return { url: "https://api.groq.com/openai/v1/audio/transcriptions", model: "whisper-large-v3-turbo", key: () => GROQ_API_KEY.value() };
  }
  return { url: "https://api.openai.com/v1/audio/transcriptions", model: "whisper-1", key: () => OPENAI_API_KEY.value() };
}

// ~10MB of base64 ≈ 7.5MB of audio ≈ a few minutes of speech — plenty for a chat
// message, and a guard against abuse / runaway cost.
const MAX_AUDIO_B64 = 10 * 1024 * 1024;
// Browser MediaRecorder produces webm/ogg (Chrome/Android) or mp4/m4a (Safari).
const MIME_EXT = {
  "audio/webm": "webm", "audio/ogg": "ogg",
  "audio/mp4": "mp4", "audio/m4a": "m4a", "audio/x-m4a": "m4a",
  "audio/mpeg": "mp3", "audio/mp3": "mp3",
  "audio/wav": "wav", "audio/x-wav": "wav",
};

async function transcribeWith(provider, buffer, baseMime) {
  const cfg = providerConfig(provider);
  const ext = MIME_EXT[baseMime] || "webm";
  const form = new FormData();
  form.append("file", new Blob([buffer], { type: baseMime }), `audio.${ext}`);
  form.append("model", cfg.model);
  form.append("response_format", "json");
  // 30s hard timeout (a ≤3-min clip normally transcribes in seconds) so a hung
  // provider fails over to the fallback instead of stalling the whole call.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  const resp = await fetch(cfg.url, {
    method: "POST",
    headers: { Authorization: `Bearer ${cfg.key()}` },
    body: form,
    signal: controller.signal,
  }).finally(() => clearTimeout(timer));
  if (!resp.ok) {
    const t = await resp.text().catch(() => "");
    throw new Error(`${provider} ${resp.status}: ${t.slice(0, 200)}`);
  }
  const data = await resp.json();
  return (data && typeof data.text === "string") ? data.text : "";
}

exports.transcribeAudio = onCall(
  { secrets: [OPENAI_API_KEY, GROQ_API_KEY], region: "us-central1", maxInstances: 10 },
  async (request) => {
    const uid = request.auth && request.auth.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Please sign in to use voice.");
    const profile = (await admin.firestore().doc(`users/${uid}`).get()).data();
    if (trialExpiredFor(profile)) {
      throw new HttpsError("permission-denied",
        "Your free trial has ended — upgrade to keep using Glide AI voice.", { reason: "trial-expired" });
    }

    const b64 = request.data && request.data.audio;
    const mimeType = (request.data && request.data.mimeType) || "audio/webm";
    if (!b64 || typeof b64 !== "string") throw new HttpsError("invalid-argument", "No audio provided.");
    if (b64.length > MAX_AUDIO_B64) throw new HttpsError("invalid-argument", "That recording is too long — keep it under ~3 minutes.");
    const baseMime = mimeType.split(";")[0].trim();
    if (!MIME_EXT[baseMime]) throw new HttpsError("invalid-argument", "Unsupported audio format.");

    let buffer;
    try { buffer = Buffer.from(b64, "base64"); } catch (e) { throw new HttpsError("invalid-argument", "Bad audio encoding."); }
    if (!buffer.length) throw new HttpsError("invalid-argument", "Empty audio.");

    const providers = [VOICE_PRIMARY, VOICE_FALLBACK].filter(Boolean);
    let lastErr;
    for (const p of providers) {
      try {
        const text = await transcribeWith(p, buffer, baseMime);
        return { text: text.trim(), provider: p };
      } catch (e) {
        lastErr = e;
        console.error("transcribeAudio provider failed:", p, e && e.message);
      }
    }
    console.error("transcribeAudio all providers failed:", lastErr && lastErr.message);
    throw new HttpsError("internal", "Couldn't transcribe the audio. Please try again.");
  }
);
