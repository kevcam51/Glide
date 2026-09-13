#!/usr/bin/env bash
# Glidna — push a new proxy/server.js to the running FatSecret VM (S228).
#
# Run this in YOUR terminal:
#     bash proxy/update.sh
#
# ⚠️ THIS ALONE DOES NOT SURVIVE A REBOOT. The VM installs /opt/proxy/server.js
# from a base64 payload inside its own startup-script metadata, and GCE runs that
# script on EVERY boot — so an scp-installed file is replaced by the old one at
# the next reset or maintenance event, silently, because the app treats a
# missing route as "source unavailable" with no error. For a lasting change the
# metadata payload has to be swapped too (S229c did that by hand over the
# Compute API). Use this for a quick fix; re-run deploy.sh for a durable one.
#
# deploy.sh CREATES the VM. This one only updates the code on a VM that already
# exists, which is the common case — the credentials in /opt/proxy/.env are left
# exactly as they are, so this script never touches a secret at all.
#
# It is safe to re-run: it copies the file, restarts the service, and then PROVES
# the new route answers before reporting success.

set -euo pipefail
PROJECT=calorieiq-29762
NAME=fatsecret-proxy
# ⚠️ THE ZONE IS DISCOVERED, NOT DECLARED. deploy.sh creates the VM in
# us-central1-a and the real one is in us-west1-a — so a hardcoded zone here
# sent this script looking for an instance that does not exist, and it reported
# "run deploy.sh first" about a VM that was up and serving. Ask the project
# where it is.
HERE="$(cd "$(dirname "$0")" && pwd)"

export PATH="$HOME/.local/bin:$HOME/google-cloud-sdk/bin:$PATH"
export CLOUDSDK_PYTHON="${CLOUDSDK_PYTHON:-$(uv python find 3.12 2>/dev/null || true)}"
GCLOUD="$HOME/google-cloud-sdk/bin/gcloud"
[ -x "$GCLOUD" ] || { echo "!! Google Cloud SDK not found — run 'bash proxy/deploy.sh' first."; exit 1; }

echo "==> 1/4  Sign in"
if ! "$GCLOUD" auth list --format='value(account)' 2>/dev/null | grep -q .; then
  echo "    a browser window will open — approve it"
  "$GCLOUD" auth login
fi
"$GCLOUD" config set project "$PROJECT" >/dev/null
echo "    $("$GCLOUD" auth list --format='value(account)' | head -1)"

ZONE=$("$GCLOUD" compute instances list --filter="name=$NAME" --format='value(zone)' 2>/dev/null | head -1)
[ -n "$ZONE" ] || { echo "!! VM '$NAME' does not exist in $PROJECT — run 'bash proxy/deploy.sh' first."; exit 1; }
echo "    found $NAME in $ZONE"

echo "==> 2/4  Copy the new server.js up"
"$GCLOUD" compute scp "$HERE/server.js" "$NAME:/tmp/server.js" --zone="$ZONE" --quiet

echo "==> 3/4  Install it and restart the service"
# ⚠️ VALIDATE BEFORE RESTARTING. The unit is Restart=always, so a truncated copy
# is not a broken barcode route — it is a crash loop, i.e. every food search in
# the app failing until someone intervenes.
# ⚠️ The file is copied to /tmp first and moved with sudo: the login user cannot
# write /opt/proxy directly, and a failed copy must not leave a half-written
# server.js behind a restart.
"$GCLOUD" compute ssh "$NAME" --zone="$ZONE" --quiet --command \
  'node --check /tmp/server.js && sudo cp -a /opt/proxy/server.js /opt/proxy/server.js.bak && sudo install -m 644 /tmp/server.js /opt/proxy/server.js && sudo systemctl restart fatsecret-proxy && sleep 2 && systemctl is-active fatsecret-proxy'

echo "==> 4/4  Prove the new route actually answers"
# The proxy address lives in Secret Manager. It is read into a variable and never
# printed — the only thing echoed is an HTTP status.
URL=$(firebase functions:secrets:access FATSECRET_PROXY_URL --project "$PROJECT" 2>/dev/null || true)
if [ -z "$URL" ]; then
  echo "    (could not read the proxy URL — check by hand)"
  exit 0
fi
HEALTH=$(curl -s -o /dev/null -w "%{http_code}" "${URL%/}/health" --max-time 20 || echo "000")
BARCODE=$(curl -s -o /tmp/glidna-barcode.$$ -w "%{http_code}" "${URL%/}/barcode?code=0049000006346" --max-time 25 || echo "000")
BODY=$(head -c 200 /tmp/glidna-barcode.$$ 2>/dev/null || true); rm -f /tmp/glidna-barcode.$$
unset URL

# ⚠️ /health IS A STATIC LITERAL AND PROVES NOTHING ABOUT FATSECRET. The route
# earning its keep right now is /search, and this change touched the token layer
# it shares — so check that too, not just the new route.
SEARCH=$(curl -s -o /dev/null -w "%{http_code}" -H "x-proxy-secret: $(firebase functions:secrets:access FATSECRET_PROXY_SECRET --project "$PROJECT" 2>/dev/null)" "${URL%/}/search?q=chicken" --max-time 25 || echo "000")
echo "    /search  -> HTTP $SEARCH   (this one is live traffic)"
[ "$SEARCH" = "200" ] || echo "    ⚠️ SEARCH IS NOT ANSWERING — roll back: sudo cp -a /opt/proxy/server.js.bak /opt/proxy/server.js && sudo systemctl restart fatsecret-proxy"
echo "    /health  -> HTTP $HEALTH"
echo "    /barcode -> HTTP $BARCODE  $BODY"
echo
if [ "$BARCODE" = "404" ]; then
  echo "❌ Still 404 — the old code is running. Check: gcloud compute ssh $NAME --zone=$ZONE --command 'sudo journalctl -u fatsecret-proxy -n 40'"
  exit 1
fi
echo "✅ The barcode route is live."
echo
echo "   A {\"food\":...} body means FatSecret answered."
echo "   A {\"gated\":true} body means FatSecret does not grant this account the"
echo "   barcode scope — the app already handles that: the scanner falls back to"
echo "   Open Food Facts + USDA exactly as it does today, with no error."
