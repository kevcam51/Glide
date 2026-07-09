// Push-notification enable/disable for THIS device (S90). Pairs with
// functions/push.js (delivery) and the push handlers in public/sw.js.
// iOS note: web push requires iOS 16.4+ AND Glidna installed to the home
// screen; the permission prompt must come from a user tap (the Notification
// Center row) — both are surfaced in the UI copy.
import { functions } from "./firebase";
import { httpsCallable } from "firebase/functions";

const callSavePushSub = httpsCallable(functions, "savePushSub");
const callRemovePushSub = httpsCallable(functions, "removePushSub");

// Public half of the VAPID keypair (public by design; private half is a
// Secret Manager secret the send functions use).
const VAPID_PUBLIC_KEY = "BMJwuoE8hBDthTSE74g_FiqShOWhr68N05rmHdzLkz53nMUBQ_Mzt63U5Q7Pbz8_9Y3Z0vkGexBJ8BS1zIwFaDI";

function urlB64ToUint8Array(base64) {
  const pad = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

export function pushSupported() {
  return typeof window !== "undefined" && "serviceWorker" in navigator
    && "PushManager" in window && "Notification" in window;
}

// Current state for the toggle: "on" | "off" | "blocked" | "unsupported".
export async function pushStatus() {
  if (!pushSupported()) return "unsupported";
  if (Notification.permission === "denied") return "blocked";
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = reg && (await reg.pushManager.getSubscription());
    return sub && Notification.permission === "granted" ? "on" : "off";
  } catch { return "off"; }
}

// Must be called from a user gesture (the row's tap handler).
export async function enablePush() {
  if (!pushSupported()) throw new Error("unsupported");
  const perm = await Notification.requestPermission();
  if (perm !== "granted") throw new Error(perm === "denied" ? "blocked" : "dismissed");
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlB64ToUint8Array(VAPID_PUBLIC_KEY),
  });
  await callSavePushSub({ sub: sub.toJSON(), ua: navigator.userAgent.slice(0, 160) });
  return true;
}

export async function disablePush() {
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = reg && (await reg.pushManager.getSubscription());
    if (sub) {
      await callRemovePushSub({ endpoint: sub.endpoint }).catch(() => {});
      await sub.unsubscribe().catch(() => {});
    }
  } catch { /* best-effort */ }
  return true;
}
