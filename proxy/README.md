# FatSecret fixed-IP proxy — deployment guide

FatSecret's free tier only answers requests from **whitelisted IPs**, and Cloud
Functions have dynamic IPs. This tiny server runs on a VM with **one fixed IP**
that you whitelist in FatSecret. Our `foodSearch` Cloud Function calls it (behind
a shared secret); it relays to FatSecret and returns the raw JSON.

**Status:** code is ready; **not deployed yet** (to avoid the ~$4/mo until needed).
When you want FatSecret live, follow the steps below (~20–30 min, then up to 24h
for FatSecret to activate the whitelisted IP).

Cost: compute is Google's always-free `e2-micro` tier; the only charge is the
static external IPv4 (~$4/mo).

---

## 1. Create the VM + reserve a static IP (Google Cloud)

```bash
PROJECT=calorieiq-29762
REGION=us-central1
ZONE=us-central1-a

# Reserve a static external IP
gcloud compute addresses create fatsecret-proxy-ip --region=$REGION --project=$PROJECT
gcloud compute addresses describe fatsecret-proxy-ip --region=$REGION --project=$PROJECT --format='value(address)'
# ^ note this IP — you'll whitelist it in FatSecret (step 4)

# Create the always-free e2-micro VM with that IP
gcloud compute instances create fatsecret-proxy \
  --project=$PROJECT --zone=$ZONE --machine-type=e2-micro \
  --image-family=debian-12 --image-project=debian-cloud \
  --address=fatsecret-proxy-ip --tags=fatsecret-proxy

# Allow inbound HTTP on 8080 ONLY from Google (the Cloud Function calls it).
# Simplest: allow 8080 from anywhere but rely on the shared secret (the server
# rejects any request without the correct x-proxy-secret). Lock down further with
# a source range later if desired.
gcloud compute firewall-rules create fatsecret-proxy-8080 \
  --project=$PROJECT --allow=tcp:8080 --target-tags=fatsecret-proxy --source-ranges=0.0.0.0/0
```

## 2. Install Node + the proxy on the VM

```bash
gcloud compute ssh fatsecret-proxy --zone=$ZONE --project=$PROJECT

# on the VM:
sudo apt-get update && sudo apt-get install -y nodejs npm
mkdir -p ~/proxy && cd ~/proxy
# copy server.js + package.json here (scp, or paste). Then:
cat > .env <<'EOF'
FATSECRET_CLIENT_ID=019b3acd8291428abe63e0d34c2e3ee1
FATSECRET_CLIENT_SECRET=<the client secret>
PROXY_SECRET=<generate a long random string — also set it as FATSECRET_PROXY_SECRET below>
PORT=8080
EOF
```

Run it under systemd so it restarts on reboot/crash:

```bash
sudo tee /etc/systemd/system/fatsecret-proxy.service >/dev/null <<'EOF'
[Unit]
Description=Glidna FatSecret proxy
After=network.target
[Service]
EnvironmentFile=/home/<user>/proxy/.env
ExecStart=/usr/bin/node /home/<user>/proxy/server.js
Restart=always
User=<user>
[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload && sudo systemctl enable --now fatsecret-proxy
curl localhost:8080/health   # -> {"ok":true}
```

## 3. Point the Cloud Function at the proxy

```bash
PROJECT=calorieiq-29762
printf 'http://<STATIC_IP>:8080' | firebase functions:secrets:set FATSECRET_PROXY_URL    --project $PROJECT --data-file=-
printf '<same PROXY_SECRET>'      | firebase functions:secrets:set FATSECRET_PROXY_SECRET --project $PROJECT --data-file=-
firebase deploy --only functions:foodSearch --project $PROJECT
```

(For HTTPS instead of plain HTTP, put a reverse proxy / managed cert in front, or
use a domain — plain HTTP is acceptable here since the payload is non-sensitive
food data and access is gated by the shared secret.)

## 4. Whitelist the IP in FatSecret

platform.fatsecret.com → your app → **IP Restrictions** → add the static IP from
step 1. Allow up to 24h to take effect.

## 5. Verify

Search a food only found in FatSecret (e.g. a restaurant item). It should appear
with a **"FatSecret"** flag in the results. Check `firebase functions:log --only foodSearch`
for errors.

---

### Teardown (to stop the ~$4/mo)

```bash
gcloud compute instances delete fatsecret-proxy --zone=$ZONE --project=$PROJECT
gcloud compute addresses delete fatsecret-proxy-ip --region=$REGION --project=$PROJECT
```
Then unset/replace the two proxy secrets so `foodSearch` returns to its safe no-op.
