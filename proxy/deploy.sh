#!/usr/bin/env bash
# Glidna — one-shot FatSecret proxy VM deploy (S93).
#
# Run this in YOUR terminal (it needs cloud sign-in, which Claude can't do):
#     bash proxy/deploy.sh
#
# It installs the Google Cloud SDK if needed (no sudo), signs you in once in your
# browser, then creates a tiny always-free e2-micro VM with a fixed IP that runs
# the FatSecret relay. Credentials are pulled from Firebase Secret Manager (already
# set) — nothing sensitive is hardcoded here. At the end it prints the static IP:
# whitelist that IP in FatSecret, and paste it back to Claude to finish wiring.
#
# Re-runnable: it skips the IP/firewall if they already exist. If the VM already
# exists it tells you (delete it first to recreate: see proxy/README.md teardown).

set -euo pipefail
PROJECT=calorieiq-29762
REGION=us-central1
ZONE=us-central1-a
NAME=fatsecret-proxy
HERE="$(cd "$(dirname "$0")" && pwd)"

echo "==> 1/6  Google Cloud SDK"
if ! command -v gcloud >/dev/null 2>&1; then
  if [ -f "$HOME/google-cloud-sdk/bin/gcloud" ]; then
    export PATH="$HOME/google-cloud-sdk/bin:$PATH"
  else
    echo "    installing into your home dir (no sudo)…"
    curl -sSL https://sdk.cloud.google.com | bash -s -- --disable-prompts >/tmp/gcloud-install.log 2>&1
    export PATH="$HOME/google-cloud-sdk/bin:$PATH"
  fi
fi
gcloud --version | head -1

echo "==> 2/6  Sign in (approve in your browser if prompted)"
if ! gcloud auth list --filter=status:ACTIVE --format='value(account)' 2>/dev/null | grep -q .; then
  gcloud auth login
fi
gcloud config set project "$PROJECT" >/dev/null
echo "    signed in as: $(gcloud auth list --filter=status:ACTIVE --format='value(account)')"

echo "==> 3/6  Pull FatSecret credentials from Firebase (nothing hardcoded)"
CID=$(firebase functions:secrets:access FATSECRET_CLIENT_ID     --project "$PROJECT")
CSEC=$(firebase functions:secrets:access FATSECRET_CLIENT_SECRET --project "$PROJECT")
PSEC=$(firebase functions:secrets:access FATSECRET_PROXY_SECRET  --project "$PROJECT")
[ -n "$CID" ] && [ -n "$CSEC" ] && [ -n "$PSEC" ] || { echo "!! missing a secret — is the Firebase CLI signed in?"; exit 1; }

echo "==> 4/6  Reserve a static IP + open port 8080"
gcloud compute addresses create "$NAME-ip" --region="$REGION" 2>/dev/null \
  && echo "    reserved" || echo "    (already reserved — reusing)"
IP=$(gcloud compute addresses describe "$NAME-ip" --region="$REGION" --format='value(address)')
gcloud compute firewall-rules create "$NAME-8080" \
  --allow=tcp:8080 --target-tags="$NAME" --source-ranges=0.0.0.0/0 2>/dev/null \
  && echo "    firewall rule created" || echo "    (firewall rule already exists)"

echo "==> 5/6  Build the VM startup script"
# server.js is base64'd so its JS ($ / backticks) can't be mangled by the shell.
SERVER_B64=$(base64 < "$HERE/server.js" | tr -d '\n')
STARTUP=$(cat <<STARTUP_EOF
#!/bin/bash
set -e
apt-get update -y
apt-get install -y nodejs
mkdir -p /opt/proxy
echo "$SERVER_B64" | base64 -d > /opt/proxy/server.js
cat > /opt/proxy/.env <<ENVEOF
FATSECRET_CLIENT_ID=$CID
FATSECRET_CLIENT_SECRET=$CSEC
PROXY_SECRET=$PSEC
PORT=8080
ENVEOF
cat > /etc/systemd/system/fatsecret-proxy.service <<'SVCEOF'
[Unit]
Description=Glidna FatSecret proxy
After=network.target
[Service]
EnvironmentFile=/opt/proxy/.env
ExecStart=/usr/bin/node /opt/proxy/server.js
Restart=always
[Install]
WantedBy=multi-user.target
SVCEOF
systemctl daemon-reload
systemctl enable --now fatsecret-proxy
STARTUP_EOF
)

echo "==> 6/6  Create the VM (always-free e2-micro)"
if gcloud compute instances describe "$NAME" --zone="$ZONE" >/dev/null 2>&1; then
  echo "    VM '$NAME' already exists — leaving it. (To recreate: delete it first, see README.)"
else
  gcloud compute instances create "$NAME" \
    --zone="$ZONE" --machine-type=e2-micro \
    --image-family=debian-12 --image-project=debian-cloud \
    --address="$NAME-ip" --tags="$NAME" \
    --metadata=startup-script="$STARTUP" >/dev/null
  echo "    created (it boots + installs the proxy in ~1-2 min)"
fi

cat <<DONE

============================================================
  ✅  FatSecret proxy is up.  Static IP:  $IP

  NEXT:
   1) Whitelist  $IP  in FatSecret
        platform.fatsecret.com → your app → IP Restrictions
        (allow up to 24h to take effect)
   2) Paste this IP back to Claude — it will set the proxy
      URL secret + redeploy foodSearch to turn it on.
============================================================
DONE
