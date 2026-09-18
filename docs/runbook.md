# blnk client runbook

Single source of truth for provisioning, deploying, and maintaining blnk client instances.

> **Who this is for:** blnk operators provisioning a new client or managing an existing one.
> For database queries and psql commands see [`db-operations.md`](./db-operations.md).
> For pricing model context see [`pricing-model-handover.md`](./pricing-model-handover.md).

---

## Architecture

```
[Client browser / native app]
         │
         ├──► apps/app  (Expo web — static files served by nginx on the client VM)
         │
         ├──► apps/api  (Fastify — PM2 process, port 4000 default)
         │         │
         │         ├──► blnk_auth  (auth proxy + JWKS — shared blnk platform service)
         │         ├──► blnk_api   (email / portal / billing — shared blnk platform service)
         │         │         └──► blnk_postgres  (shared DB host — one DB per client)
         │         └──► blnk_minio (shared object storage — one bucket per client)
         │
         └──► blnk_minio  (presigned PUT — client uploads direct, bypasses API)
```

**Per-VM model:** each client runs on its own VM. blnk_auth, blnk_api, blnk_postgres, and blnk_minio are shared services on the blnk platform server — everything else is self-contained on the client VM.

**Object storage:** MinIO runs on the blnk platform server alongside blnk_postgres. Each client gets their own bucket (named after their slug) and their own MinIO access key pair. The API generates presigned PUT URLs — clients upload files directly to MinIO, the API never buffers file bodies. A single `storage.blnk.nz` subdomain points at the platform server via nginx reverse proxy.

**Repos:** each client is a separate GitHub repo, cloned from `client-baseplate`. The `upstream` remote points back at `client-baseplate` so platform updates flow in automatically via the daily deploy cron.

**Databases:** PostgreSQL runs on the shared `blnk_postgres` container (on the blnk platform server). Each client has its own database and user, scoped to their tenant slug. The client VM connects to it over the network via `DATABASE_URL`.

---

## Pre-flight checklist

Before provisioning a new client VM, complete every item in this list. The provision script will fail or produce a broken deployment if these are skipped.

| # | Task | Where |
|---|---|---|
| 1 | Decide the client slug (lowercase, hyphenated — e.g. `acme-co`). Used everywhere. | You |
| 2 | Decide the domains: app (`acme.blnk.nz`) and API (`acme-api.blnk.nz`) | You |
| 3 | Decide which modules to enable: `commerce`, `compliance`, `asset`, `schedule`, `roster`, `analytics`, `locations` | Client brief |
| 4 | Create the VM (Ubuntu 22.04 or 24.04 LTS). Note its public IP. | Hosting provider |
| 5 | Add a DNS A record for `acme.blnk.nz` → VM IP | DNS provider (Cloudflare) |
| 6 | Add a DNS A record for `acme-api.blnk.nz` → VM IP | DNS provider (Cloudflare) |
| 7 | Create the client GitHub repo (`blnk/client-acme-co`) and push client-baseplate to it | GitHub |
| 8 | Generate a deploy key (`ssh-keygen -t ed25519 -C "acme-co-deploy"`) — add the **public** key to the GitHub repo (Settings → Deploy keys, read-only) | GitHub |
| 9 | Copy the **private** deploy key onto the VM at `/root/.ssh/id_ed25519` (or `/home/blnk/.ssh/id_ed25519` after user creation) | VM |
| 10 | Run `provision:client` in blnk_api to register the tenant and emit `.env` files (see step 1 below) | Local machine |
| 11 | Create the client database in blnk_postgres (see step 2 below) | blnk platform server |
| 12 | Create the client bucket + credentials in blnk_minio (see step 2b below) | blnk platform server |

---

## Step 1 — Register the tenant (run locally)

Run once on your local machine from the `blnk_api` directory. This creates the tenant row in blnk_auth, sets up the Stripe billing product, and emits both `.env` files.

```bash
cd ~/git/blnk/blnk_api

npm run provision:client -- \
  --name "Acme Co" \
  --slug acme-co \
  --admin admin@acme.co \
  --domain acme.blnk.nz \
  --app-scheme acmeco \
  --bundle-id nz.acmeco.app \
  --plan starter \
  --billing-amount 4900 \
  --billing-interval month \
  --currency nzd \
  --features commerce,compliance,asset
```

| Arg | Example | Notes |
|---|---|---|
| `--name` | `"Acme Co"` | Display name |
| `--slug` | `acme-co` | Lowercase, hyphenated. Must be unique. |
| `--admin` | `admin@acme.co` | Comma-separate for multiple admins |
| `--domain` | `acme.blnk.nz` | App domain (no protocol) |
| `--app-scheme` | `acmeco` | URL scheme for deep links (no spaces/hyphens) |
| `--bundle-id` | `nz.acmeco.app` | iOS bundle ID / Android package |
| `--plan` | `starter` | Informational label |
| `--billing-amount` | `4900` | Cents per interval. Omit to skip Stripe product. |
| `--billing-interval` | `month` | `day` / `week` / `month` / `year` |
| `--currency` | `nzd` | Lowercase ISO code |
| `--features` | `commerce,compliance,asset` | Any of: `commerce`, `compliance`, `asset`, `schedule`, `roster`, `analytics`, `locations`, `subscriptions`, `one_off` |

The script prints two ready-to-paste blocks when it finishes:
- `client_api .env` → save as `api.env` on your local machine
- `apps/app .env` → save as `app.env` on your local machine

> **The `BLNK_API_KEY` is shown once.** It is included in the `.env` output — copy both blocks before closing the terminal.

---

## Step 2 — Create the client database (run on blnk platform server)

```bash
ssh robbie@blnk

docker exec -it blnk_postgres psql -U blnk -d postgres -c "
  CREATE USER \"acme-co\" WITH PASSWORD 'strong-random-password-here';
  CREATE DATABASE \"acme-co\" OWNER \"acme-co\";
"
```

Update `DATABASE_URL` in `api.env` to use the password you set here:
```
DATABASE_URL=postgres://acme-co:strong-random-password-here@<blnk-platform-ip>:5432/acme-co
```

---

## Step 2b — Create the client bucket in blnk_minio (run on blnk platform server)

MinIO runs on the blnk platform server as `blnk_minio`. Each client needs their own bucket and a dedicated access key pair (not the root key).

```bash
ssh robbie@blnk

docker exec -it blnk_minio sh

/tmp/mc alias set local http://localhost:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD"
/tmp/mc mb local/acme-co

# Generate and store the secret — this is shown once, copy it before you exit
ACME_SECRET=$(openssl rand -hex 20)
echo "SECRET: $ACME_SECRET"
/tmp/mc admin user add local acme-co $ACME_SECRET
/tmp/mc admin policy attach local readwrite --user acme-co

exit
```

> The access key is the client slug (`acme-co`) and the secret is the hex string printed above.
> Copy both before exiting the container — the secret is not recoverable from MinIO afterwards.

The `provision:client` script already emits the correct `STORAGE_*` block with pre-generated credentials — use those values when creating the bucket user above. The `.env` output looks like:

```
STORAGE_ENDPOINT=https://storage.blnk.nz
STORAGE_ACCESS_KEY=acme-co
STORAGE_SECRET_KEY=<generated by provision:client>
STORAGE_BUCKET=acme-co
STORAGE_PUBLIC_URL=https://storage.blnk.nz/acme-co
```

> **First client only:** if `blnk_minio` isn't running yet, see [Platform server setup — MinIO](#platform-server-setup--minio) in the appendix.

---

## Step 3 — Create the client repo (run locally)

```bash
# Clone client-baseplate as the starting point
git clone git@github.com:blnk/client-baseplate.git client-acme-co
cd client-acme-co

# Point origin at the new client repo
git remote set-url origin git@github.com:blnk/client-acme-co.git

# Keep client-baseplate as upstream for future platform updates
git remote add upstream git@github.com:blnk/client-baseplate.git

git push -u origin main
```

---

## Step 4 — Run the provision script (run on the VM as root)

SSH into the fresh VM, copy the `.env` files over, then run the script.

```bash
# From your local machine — copy the .env files the VM will need
scp api.env root@<vm-ip>:/tmp/api.env
scp app.env root@<vm-ip>:/tmp/app.env

# SSH into the VM
ssh root@<vm-ip>

# The script will clone the repo, install deps, build, configure nginx, get SSL, and start PM2.
# It will pause at step 8 and wait for .env files — pre-copy them from /tmp first.
curl -fsSL https://raw.githubusercontent.com/blnk/client-acme-co/main/scripts/provision-vm.sh | bash -s -- \
  --slug        acme-co \
  --domain      acme.blnk.nz \
  --api-domain  acme-api.blnk.nz \
  --repo        git@github.com:blnk/client-acme-co.git \
  --port        4001
```

Or clone first and run locally from the VM:

```bash
git clone git@github.com:blnk/client-acme-co.git /tmp/client-acme-co
bash /tmp/client-acme-co/scripts/provision-vm.sh \
  --slug        acme-co \
  --domain      acme.blnk.nz \
  --api-domain  acme-api.blnk.nz \
  --repo        git@github.com:blnk/client-acme-co.git \
  --port        4001
```

When the script pauses at step 8 for `.env` files, place them at the paths it prints, then press Enter:

```bash
cp /tmp/api.env /home/blnk/acme-co/apps/api/.env
cp /tmp/app.env /home/blnk/acme-co/apps/app/.env
# then press Enter in the provision script
```

> **`--port` must be unique per VM.** On a dedicated VM the default `4000` is always free. Document it in the port registry (§ Port registry) anyway.

> **`--skip-ssl`** — use this flag if DNS hasn't propagated yet. Certbot will fail if the domain doesn't resolve to the VM. Run certbot manually once DNS is live: `certbot --nginx -d acme.blnk.nz -d acme-api.blnk.nz`

---

## Step 5 — Verify the deployment

Run these checks immediately after the provision script completes.

```bash
# API health check
curl https://acme-api.blnk.nz/health
# Expected: {"status":"ok","service":"client_api","tenant":"acme-co","uptime":...}

# PM2 is running
pm2 list
# Expected: client-api   online

# nginx is serving the frontend
curl -I https://acme.blnk.nz
# Expected: HTTP/2 200

# SSL cert is valid
curl -v https://acme-api.blnk.nz/health 2>&1 | grep "SSL certificate verify ok"

# Cron is installed
sudo -u blnk crontab -l
# Expected: two entries for backup.sh and deploy.sh
```

Open `https://acme.blnk.nz` in a browser and confirm:
- [ ] App loads without console errors
- [ ] Login / passkey registration flow works
- [ ] Enabled modules appear in the navigation

---

## Step 6 — Set up uptime monitoring

Use [UptimeRobot](https://uptimerobot.com) (free tier, 5-minute intervals):

1. New monitor → **HTTP(s)** → type **Keyword**
2. URL: `https://acme-api.blnk.nz/health`
3. Keyword: `"status":"ok"`
4. Alert contact: ops email or phone

---

## Step 7 — Update the port registry

Add the client to the port registry table at the bottom of this file so the next operator knows which ports are taken.

---

## Ongoing operations

### Deploy a client manually

```bash
ssh root@<vm-ip>
cd /home/blnk/acme-co
sudo -u blnk bash deploy.sh
```

Or as the `blnk` user directly:

```bash
ssh blnk@<vm-ip>
cd ~/acme-co
bash deploy.sh
```

### How platform updates reach clients

1. A change is merged to `client-baseplate/main`
2. The daily 3am cron on each client VM runs `deploy.sh`
3. `deploy.sh` does `git fetch upstream && git merge upstream/main --no-edit`
4. If the merge is clean (it always should be — all client config is in `.env`), the build and PM2 reload happen automatically
5. If the merge fails (conflict), the deploy aborts and the old build keeps running — the cron log captures the error

To push an urgent update immediately rather than waiting for 3am:

```bash
ssh blnk@<vm-ip>
cd ~/<slug>
bash deploy.sh
```

### Enable or disable a module

```bash
ssh blnk@<vm-ip>
nano ~/<slug>/apps/api/.env
# flip FEATURE_COMPLIANCE=false → true
pm2 reload client-api
```

> If enabling a module that has migrations (check `apps/api/src/db/migrations/`), run `pnpm migrate` before reloading PM2.

### Rebuild the frontend only

Use when `apps/app/.env` changes (e.g. new API URL, splash colour):

```bash
cd ~/<slug>/apps/app
set -a && source .env && set +a
npx expo export -p web --clear   # --clear busts Metro cache for env var changes
```

nginx picks up the new `dist/` immediately — no nginx reload needed.

### View API logs

```bash
pm2 logs client-api --lines 100

# Follow in real-time
pm2 logs client-api
```

### View deploy / backup logs

```bash
tail -f ~/logs/<slug>-deploy.log
tail -f ~/logs/<slug>-backup.log
```

### Run migrations manually

```bash
cd ~/<slug>/apps/api && pnpm migrate
```

Migrations are idempotent — already-applied files are skipped. Run this any time you're unsure whether a migration ran.

### Restore from a backup

```bash
# Stop the API so nothing writes during restore
pm2 stop client-api

# List available backups
ls ~/backups/<slug>/

# Restore (pg_restore needs the DATABASE_URL from .env)
source ~/<slug>/apps/api/.env
pg_restore --dbname="$DATABASE_URL" --clean --if-exists ~/backups/<slug>/<filename>.dump

pm2 start client-api
```

---

## Manual steps that cannot be scripted

These must always be done by hand. The provision script will not attempt them.

| What | Why | Where |
|---|---|---|
| SSH deploy key | Must be added to GitHub before `git clone` can run | GitHub repo → Settings → Deploy keys |
| DNS A records | Must be done at the registrar/Cloudflare before certbot can get SSL | Cloudflare dashboard |
| Root → app user handoff | You SSH as root initially; the script creates `blnk` user but you log into it separately | SSH |
| `STRIPE_API_KEY` / `STRIPE_WEBHOOK_SECRET` | Client's own Stripe keys — can't be emitted by blnk tooling | Client provides, paste into `apps/api/.env` |
| `STORAGE_*` | Generated in step 2b above (bucket + access key created in blnk_minio) | blnk platform server → paste into `apps/api/.env` |
| `EXPO_PUBLIC_EAS_PROJECT_ID` | Created via `eas init` per-client, requires Expo account | Expo dashboard |
| Registering the tenant in blnk_auth | Done by `provision:client` script in blnk_api — not the VM's concern | blnk_api on local machine |

---

## Troubleshooting

### API returns 502 / nginx bad gateway

The PM2 process crashed or is not running.

```bash
pm2 list
pm2 logs client-api --lines 50
pm2 restart client-api
```

Most common cause: a required env var is missing. Look for `Missing required environment variable:` in the logs.

### `/health` returns 404 or connection refused

```bash
pm2 list                          # is client-api listed at all?
pm2 logs client-api --lines 50   # startup error?
curl http://127.0.0.1:4000/health  # test without nginx — is the process up?
```

If the process isn't in `pm2 list`, it never started:
```bash
cd ~/<slug>
pm2 start apps/api/ecosystem.config.js --env production
pm2 logs client-api --lines 20   # look for startup error
```

### SSL cert expired or missing

```bash
certbot renew --dry-run          # test auto-renewal
certbot certificates              # show cert status
certbot --nginx -d acme.blnk.nz -d acme-api.blnk.nz  # re-issue if needed
```

Certbot installs a systemd timer for auto-renewal — check it:
```bash
systemctl status certbot.timer
```

### `git merge upstream/main` fails with conflicts

```bash
cd ~/<slug>
git status         # shows conflicting files
git diff           # inspect the conflicts
# resolve manually, then:
git add .
git commit -m "resolve upstream merge conflict"
bash deploy.sh
```

All client config lives in `.env` files which are never committed, so conflicts should be rare. If they happen regularly, it means baseplate changes are touching files that client customisations also touch — fix the baseplate to use env vars instead.

### Frontend shows stale data / wrong env values

The Expo build bakes env vars in at build time. After any `apps/app/.env` change you must rebuild:

```bash
cd ~/<slug>/apps/app
set -a && source .env && set +a
npx expo export -p web --clear
```

### Passkey login fails / "not allowed by CORS" / "RP ID mismatch"

The `allowed_origins` setting in blnk_auth must exactly match the origin the client is served from. Check and update via the blnk_auth DB — see [`db-operations.md`](./db-operations.md).

Also check: `EXPO_PUBLIC_APP_DOMAIN` in `apps/app/.env` must match the domain certbot issued the cert for.

### Migrations fail on deploy

```bash
cd ~/<slug>/apps/api
pnpm migrate
# read the error — usually a missing column, type mismatch, or partial previous run
```

Fix the migration file (or write a corrective migration), then re-run `pnpm migrate` and re-run `deploy.sh`.

### PM2 process not starting after VM reboot

The startup script should have been installed by `provision-vm.sh`. If it's missing:

```bash
# as root
pm2 startup systemd -u blnk --hp /home/blnk | tail -1 | bash
sudo -u blnk pm2 resurrect
```

### Deploy cron not running

Check the `blnk` user's crontab:
```bash
sudo -u blnk crontab -l
```

Check system cron logs:
```bash
grep CRON /var/log/syslog | tail -20
```

Re-install if missing:
```bash
REPO_DIR="/home/blnk/<slug>"
LOG_DIR="/home/blnk/logs"
(sudo -u blnk crontab -l 2>/dev/null; \
 echo "0 2 * * * cd ${REPO_DIR} && bash backup.sh >> ${LOG_DIR}/<slug>-backup.log 2>&1"; \
 echo "0 3 * * * cd ${REPO_DIR} && bash deploy.sh >> ${LOG_DIR}/<slug>-deploy.log 2>&1") \
| sudo -u blnk crontab -
```

---

## Port registry

Track which port each client API uses. Update this table when adding a client.

> Always check `pm2 list` on the VM before assuming a port is free.
> On a dedicated per-client VM the default `4000` is always safe — but document it anyway for ops visibility.

| Client | Slug | VM IP | Domain | Port | Added |
|---|---|---|---|---|---|
| Ting Test | `ting-test` | — | ting-test.blnk.nz | `4000` | 2025 |

---

## Platform server setup — MinIO

Run once on the blnk platform server to stand up `blnk_minio`. Skip if already running.

```bash
ssh robbie@blnk
```

**1. Start the container**

```bash
docker run -d \
  --name blnk_minio \
  --restart unless-stopped \
  -p 9000:9000 \
  -p 9001:9001 \
  -e MINIO_ROOT_USER=<strong-root-user> \
  -e MINIO_ROOT_PASSWORD=<strong-root-password> \
  -v minio_data:/data \
  quay.io/minio/minio:latest \
  server /data --console-address ":9001"
```

Save the root credentials in 1Password — you'll need them for every new client bucket.

**2. Install `mc` inside the container**

The platform server is an AMD64 Ubuntu VM (even when your local machine is Apple Silicon). The MinIO download domain changed — use the `aistor` path and write to `/tmp` since `/usr/local/bin` is not writable inside the container.

```bash
docker exec blnk_minio sh -c \
  "curl -fsSL https://dl.min.io/aistor/mc/release/linux-amd64/mc -o /tmp/mc && chmod +x /tmp/mc"
```

Verify: `docker exec blnk_minio /tmp/mc --version`

**3. Add the DNS A record**

In Cloudflare: `storage.blnk.nz` → platform server IP. Must resolve before certbot runs.

**4. nginx vhost**

Start with port 80 — certbot will upgrade it to SSL automatically:

```bash
cat > /etc/nginx/sites-available/storage.blnk.nz << 'EOF'
server {
    listen 80;
    server_name storage.blnk.nz;

    location / {
        proxy_pass http://localhost:9000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        client_max_body_size 100m;
    }
}
EOF

ln -s /etc/nginx/sites-available/storage.blnk.nz /etc/nginx/sites-enabled/storage.blnk.nz
nginx -t && systemctl reload nginx
```

**5. SSL cert**

```bash
certbot --nginx -d storage.blnk.nz
```

Certbot rewrites the vhost to add the `listen 443 ssl` block and sets up auto-renewal.

---

## Appendix — What provision-vm.sh does

Reference summary of the 13 steps the script runs. Use this to run steps manually if the script fails partway through.

| Step | What | Command / file |
|---|---|---|
| 1 | System packages | `apt-get install nginx certbot postgresql-client git curl ufw fail2ban` |
| 2 | Node.js 22 | NodeSource setup script + `apt-get install nodejs` |
| 3 | pnpm | `corepack enable && corepack prepare pnpm@latest --activate` |
| 4 | PM2 | `npm install -g pm2` |
| 5 | App user | `useradd -m -s /bin/bash blnk` |
| 6 | Clone repo | `git clone <repo> /home/blnk/<slug>` |
| 7 | Install deps | `pnpm install --frozen-lockfile` |
| 8 | .env files | Manual — copy from local machine, script waits |
| 9 | Migrations | `cd apps/api && pnpm migrate` |
| 10 | Build | `pnpm build --filter=@blnk/shared && expo export -p web && pnpm build --filter=@blnk/client-api` |
| 11 | nginx vhost | Written to `/etc/nginx/sites-available/<slug>`, linked, `nginx -t && systemctl reload nginx` |
| 12 | SSL | `certbot --nginx -d <domain> -d <api-domain> --non-interactive --agree-tos` |
| 13 | PM2 + cron | `pm2 start ecosystem.config.js`, `pm2 startup`, daily cron for backup + deploy |
