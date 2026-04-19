# Install: api.portfilo.online on the SnapNest EC2

This runbook installs the Portfilo backend as a **second** service on the same
EC2 that already hosts SnapNest. Every step is explicit. Nothing here touches
SnapNest's nginx site, systemd unit, certs, or Redis keys — read each command
before running it.

- **Bind port:** `4100` (change only if occupied — see Phase 0).
- **App user:** `ubuntu`.
- **Install path:** `/home/ubuntu/portflio-builder-backend`.
- **Datastore:** Neon Postgres + shared Redis (prefix `portfilo:`).
- **TLS:** Let's Encrypt via `certbot --nginx` (same tool you already use).

---

## Phase 0 — Read-only inventory (no changes)

Run these on the EC2 and sanity-check the output before continuing.

```bash
# Existing nginx sites — confirm there isn't already an api.portfilo.online file.
ls /etc/nginx/sites-enabled/ /etc/nginx/sites-available/

# Ports currently listening — confirm 4100 is free.
sudo ss -ltnp | awk '{print $4, $6}' | sort -u

# Existing certbot certs — we don't want to overwrite any.
sudo certbot certificates

# Node version. Must be >= 22.
command -v node && node -v || echo "node not installed"

# Disk headroom.
df -h /
```

If `4100` is taken, pick another free port and:
- change `proxy_pass http://127.0.0.1:4100` in `deploy/nginx/api.portfilo.online.conf`,
- change `PORT=4100` in the `.env` created in Phase 3.

If Node is missing or < 22:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs build-essential
node -v
```

---

## Phase 1 — Clone the repo

```bash
cd /home/ubuntu
git clone https://github.com/Nouralddin/portflio-builder-backend.git
cd portflio-builder-backend
npm ci
npm run build
```

`npm ci` will build native modules (`sharp`, `argon2`). `build-essential` from
Phase 0 covers their compile deps.

---

## Phase 2 — Generate JWT keys

```bash
mkdir -p keys
openssl genpkey -algorithm RSA -out keys/jwt.key -pkeyopt rsa_keygen_bits:2048
openssl rsa -in keys/jwt.key -pubout -out keys/jwt.pub
chmod 600 keys/jwt.key
```

---

## Phase 3 — Create `.env`

```bash
cat > /home/ubuntu/portflio-builder-backend/.env <<'EOF'
NODE_ENV=production
PORT=4100
LOG_LEVEL=info

APP_ORIGIN=https://app.portfilo.online
API_ORIGIN=https://api.portfilo.online
RENDER_ORIGIN_SUFFIX=.portfilo.online

# --- Neon Postgres (paste your connection string here) ---
DATABASE_URL=PASTE_NEON_URL_HERE

# --- Shared Redis — the prefix keeps our keys isolated from other projects ---
REDIS_URL=PASTE_REDIS_URL_HERE
REDIS_KEY_PREFIX=portfilo:

JWT_PRIVATE_KEY_PATH=/home/ubuntu/portflio-builder-backend/keys/jwt.key
JWT_PUBLIC_KEY_PATH=/home/ubuntu/portflio-builder-backend/keys/jwt.pub
JWT_ACCESS_TTL_SEC=900
REFRESH_TTL_SEC=2592000

# Rotate later when you wire R2. Leaving blank disables uploads gracefully.
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET=portfoli-assets
R2_ENDPOINT=
R2_REGION=auto
R2_PUBLIC_BASE_URL=
R2_PRESIGN_TTL_SEC=300

RESEND_API_KEY=
MAIL_FROM="Portfoli <noreply@portfilo.online>"

GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=

HCAPTCHA_SECRET=
SENTRY_DSN=

# Generated below — do not copy this placeholder.
SESSION_SALT=REPLACE_ME
ANALYTICS_SALT_ROTATION_CRON=0 0 * * *
EOF

# Fill the two secrets you already have:
#   - DATABASE_URL  (Neon)
#   - REDIS_URL     (the shared one you use for other projects)
nano /home/ubuntu/portflio-builder-backend/.env

# Generate SESSION_SALT and wire it in:
SALT=$(openssl rand -hex 32)
sed -i "s|^SESSION_SALT=.*|SESSION_SALT=${SALT}|" /home/ubuntu/portflio-builder-backend/.env

chmod 600 /home/ubuntu/portflio-builder-backend/.env
```

---

## Phase 4 — Run migrations

Neon accepts the app pushing its schema. Run migrations once:

```bash
cd /home/ubuntu/portflio-builder-backend
npm run db:migrate
```

If this prints `No migrations pending` or lists the new migration cleanly,
you're good. If it errors on connection, the `DATABASE_URL` is wrong — edit
`.env` and retry.

---

## Phase 5 — Install the systemd unit

```bash
sudo cp /home/ubuntu/portflio-builder-backend/deploy/systemd/portfilo-backend.service \
        /etc/systemd/system/portfilo-backend.service

# If you use nvm instead of apt-installed Node, patch ExecStart first:
#   sudo sed -i "s|/usr/bin/node|$(which node)|" /etc/systemd/system/portfilo-backend.service

sudo systemctl daemon-reload
sudo systemctl enable --now portfilo-backend
sleep 2
sudo systemctl status portfilo-backend --no-pager
curl -fsS http://127.0.0.1:4100/api/health && echo " OK"
```

If `curl` returns JSON, the app is up. If not:

```bash
sudo journalctl -u portfilo-backend -n 80 --no-pager
```

---

## Phase 6 — Install the nginx site

```bash
sudo cp /home/ubuntu/portflio-builder-backend/deploy/nginx/api.portfilo.online.conf \
        /etc/nginx/sites-available/api.portfilo.online

# Certbot writes its challenge files here. Safe to create if missing.
sudo mkdir -p /var/www/certbot

# Enable the site. This does NOT touch any other site.
sudo ln -s /etc/nginx/sites-available/api.portfilo.online \
           /etc/nginx/sites-enabled/api.portfilo.online

sudo nginx -t && sudo systemctl reload nginx
```

---

## Phase 7 — TLS via certbot

**Cloudflare proxy gotcha:** `api.portfilo.online` is currently proxied (orange
cloud). HTTP-01 works through Cloudflare, but only if CF's "Always Use HTTPS"
isn't force-redirecting `/.well-known/acme-challenge/*` before it reaches
origin. Safest path: **temporarily turn the orange cloud grey** (DNS-only) on
the `api` record for ~5 minutes, run certbot, then turn it back to proxied.

```bash
# With the `api` record set to DNS-only in Cloudflare:
sudo certbot --nginx -d api.portfilo.online --non-interactive \
     --agree-tos -m you@portfilo.online --redirect

# Verify:
curl -I https://api.portfilo.online/healthz
```

Now flip `api` back to **Proxied** in Cloudflare. Cloudflare → SSL/TLS must be
**Full (strict)** so CF accepts the LE cert on origin.

Certbot's timer (`systemctl list-timers | grep certbot`) renews automatically —
same as your existing cert.

---

## Phase 8 — Smoke test from outside

```bash
curl -I  https://api.portfilo.online/api/health
curl -sS https://api.portfilo.online/api/health | head
```

Expected: `200 OK` and a JSON health body. You're live.

---

## Rollback (if anything breaks)

Every step above is reversible without touching SnapNest:

```bash
# Stop and disable the new service.
sudo systemctl disable --now portfilo-backend
sudo rm /etc/systemd/system/portfilo-backend.service
sudo systemctl daemon-reload

# Remove the nginx site.
sudo rm /etc/nginx/sites-enabled/api.portfilo.online
sudo nginx -t && sudo systemctl reload nginx

# Revoke the cert (optional).
sudo certbot delete --cert-name api.portfilo.online

# Remove the code and env.
rm -rf /home/ubuntu/portflio-builder-backend
```
