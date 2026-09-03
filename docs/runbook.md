# blnk client runbook

Single source of truth for creating, deploying, and maintaining blnk client apps.

> **Who this is for:** blnk operators provisioning a new client or managing an existing one.
> For database queries and psql commands, see [`db-operations.md`](./db-operations.md).

---

## Architecture

```
[Client browser / app]
        │
        ▼
  apps/app (Expo web — static files served by nginx)
        │
        ▼
  apps/api (Fastify — PM2 process on blnk server, port varies per client)
        │
        ├──► blnk_auth  :3100  (auth, passkeys, JWKS)
        └──► blnk_api   :8000  (email, portal, billing)
```

**Server:** one blnk server hosts all client apps. `ssh robbie@blnk` to access it.

**Databases:** one `blnk_postgres` Docker container hosts all databases — one per client plus the blnk platform databases. See [`db-operations.md`](./db-operations.md).

**Repos:** each client is a separate git repo cloned from client-baseplate, with `upstream` pointing back at client-baseplate for updates.

---

## Prerequisites

Before provisioning a new client, you need:

- [ ] A client slug (lowercase, hyphenated — e.g. `acme-co`). Used everywhere.
- [ ] A domain for the client app (e.g. `acme.blnk.nz`)
- [ ] A list of which modules to enable (commerce, compliance, asset, roster)
- [ ] SSH access to the blnk server
- [ ] A GitHub repo created for the client (e.g. `blnk/client-acme-co`)
- [ ] An EAS project created for the client in the Expo dashboard (if native app is needed)

---

## 1 — Run provision:client

Run this once on your local machine from the `blnk_api` directory. It creates the tenant in blnk_api, sets up the Stripe billing product, configures blnk_auth, and emits both `.env` files ready to paste.

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

**Args:**

| Arg | Example | Notes |
|---|---|---|
| `--name` | `"Acme Co"` | Display name |
| `--slug` | `acme-co` | Lowercase, hyphenated. Used everywhere. |
| `--admin` | `admin@acme.co` | Comma-separate for multiple admins |
| `--domain` | `acme.blnk.nz` | App domain (no protocol) |
| `--app-scheme` | `acmeco` | URL scheme for deep links (no spaces/hyphens) |
| `--bundle-id` | `nz.acmeco.app` | iOS bundle ID / Android package |
| `--plan` | `starter` | Plan label (informational) |
| `--billing-amount` | `4900` | Cents per interval. Omit to skip Stripe product. |
| `--billing-interval` | `month` | `day`, `week`, `month`, or `year` |
| `--currency` | `nzd` | Lowercase ISO code |
| `--features` | `commerce,compliance,asset` | Any of: `commerce`, `compliance`, `asset`, `schedule`, `roster`, `analytics`, `locations`, `subscriptions`, `one_off` |

The script prints two ready-to-paste blocks when it finishes:
- `client_api .env` → paste into `apps/api/.env`
- `apps/app .env` → paste into `apps/app/.env`

> **The `BLNK_API_KEY` is shown once.** It's already in the `.env` output — copy both blocks before closing the terminal.

---

## 3 — Create the client repo

On your local machine:

```bash
# Clone client-baseplate as the new client repo
git clone git@github.com:blnk/client-baseplate.git client-acme-co
cd client-acme-co

# Point origin at the new client repo (create it on GitHub first)
git remote set-url origin git@github.com:blnk/client-acme-co.git

# Keep client-baseplate as upstream for future updates
git remote add upstream git@github.com:blnk/client-baseplate.git

# Push to the new client repo
git push -u origin main
```

---

## 4 — Provision the database

On the blnk server, create the client database inside the existing `blnk_postgres` container:

```bash
ssh robbie@blnk

docker exec -it blnk_postgres psql -U blnk -d postgres -c "
  CREATE USER \"acme-co\" WITH PASSWORD 'change-me-in-prod';
  CREATE DATABASE \"acme-co\" OWNER \"acme-co\";
"
```

> Use a strong password in production — the `.env` `DATABASE_URL` holds it and is never committed.

---

## 5 — Configure environment variables

`provision:client` (step 1) emits both `.env` blocks ready to paste. On the blnk server, in the client repo:

```bash
nano apps/api/.env   # paste the client_api block from provision output
nano apps/app/.env   # paste the apps/app block from provision output
```

Then fill in the blanks:

- `PORT` — pick a free port (increment from last client — see §11 port registry)
- `DATABASE_URL` — update password to the one set in step 4
- `EXPO_PUBLIC_EAS_PROJECT_ID` — from Expo dashboard (if native app)
- `APPLE_APP_IDS` / `ANDROID_PACKAGE` — `TEAMID.nz.acmeco.app` / `nz.acmeco.app` (if native app)
- `STRIPE_API_KEY` / `STRIPE_WEBHOOK_SECRET` — client's own Stripe keys (only if `FEATURE_STRIPE=true`)

---

## 6 — First deploy

On the blnk server, in the client repo directory:

```bash
ssh robbie@blnk
cd ~/blnk/blnk_clients/client-acme-co

# Install dependencies and run migrations first
pnpm install --frozen-lockfile
cd apps/api && pnpm migrate
cd ../..

# Build and start
bash deploy.sh
```

> `deploy.sh` runs `git merge upstream/main --no-edit` before building. On first deploy
> `upstream/main` and `HEAD` are the same commit, so this is a no-op. It's safe.

Verify the API is up:

```bash
curl https://acme-api.blnk.nz/health
# → {"status":"ok","tenant":"acme-co",...}
```

---

## 7 — Configure nginx

Each client needs two nginx server blocks: one for the API (reverse proxy to PM2) and one for the frontend (static files).

Add to `/etc/nginx/sites-available/acme-co` on the blnk server:

```nginx
# API
server {
    listen 443 ssl;
    server_name acme-api.blnk.nz;
    # ssl_certificate / ssl_certificate_key — managed by certbot

    location / {
        proxy_pass http://localhost:PORT;   # replace PORT with the port in apps/api/.env
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

# Frontend (static)
server {
    listen 443 ssl;
    server_name acme.blnk.nz;
    # ssl_certificate / ssl_certificate_key — managed by certbot

    root /home/deploy/blnk/blnk_clients/client-acme-co/apps/app/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

Enable and reload:

```bash
ln -s /etc/nginx/sites-available/acme-co /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
```

Get SSL certificates (if not already wildcarded):

```bash
certbot --nginx -d acme.blnk.nz -d acme-api.blnk.nz
```

---

## 8 — Set up automated daily updates

On the blnk server, in the client's user crontab:

```bash
crontab -e
```

Add (adjust path to match where the repo lives):

```
0 3 * * * cd /home/deploy/blnk/blnk_clients/client-acme-co && bash deploy.sh >> /home/deploy/blnk/logs/acme-co-deploy.log 2>&1
```

This runs at 3am daily. Logs go to `~/blnk/logs/acme-co-deploy.log`.

Create the log directory if it doesn't exist:

```bash
mkdir -p ~/blnk/logs
```

---

## 9 — Set up daily DB backup

Add a second cron entry for the backup script (runs at 2am, one hour before the 3am deploy):

```
0 2 * * * cd /home/deploy/blnk/blnk_clients/client-acme-co && bash backup.sh >> /home/deploy/blnk/logs/acme-co-backup.log 2>&1
```

Backups land in `~/blnk/backups/<slug>/` as `pg_dump` custom-format files. The last 7 days are kept; older files are deleted automatically.

**To restore from a backup:**
```bash
# Stop the API first so nothing writes during restore
pm2 stop client-api

# Restore (replace DB_NAME and path as needed)
pg_restore --dbname="$DATABASE_URL" --clean --if-exists /path/to/backup.dump

pm2 start client-api
```

---

## 10 — Set up uptime monitoring

Use [UptimeRobot](https://uptimerobot.com) (free tier is fine — 5-minute intervals).

1. Add a new monitor: **HTTP(s)**, type **Keyword**
2. URL: `https://acme-api.blnk.nz/health`
3. Keyword to find: `"status":"ok"`
4. Alert contact: your email or phone

The `/health` endpoint returns:
```json
{ "status": "ok", "service": "client_api", "tenant": "acme-co", "uptime": 123.4, "timestamp": "..." }
```

---

## 11 — Port registry

Track which port each client API uses to avoid conflicts. Update this table when adding a client.

| Client | Slug | Port |
|---|---|---|
| Ting Test | `ting-test` | `4000` |

> Always check `pm2 list` before assigning a new port.

---

## Ongoing operations

### Deploy a specific client manually

```bash
ssh robbie@blnk
cd ~/blnk/blnk_clients/client-acme-co
bash deploy.sh
```

### Migrations

`deploy.sh` runs `pnpm migrate` automatically on every deploy. Migrations are idempotent — already-applied files are skipped. No manual step needed.

If a migration fails mid-deploy, the deploy aborts (API keeps running on the old build). Check the log, fix the migration, then re-run `deploy.sh`.

### Enable or disable a module

Edit `apps/api/.env` on the server and flip the `FEATURE_*` flag, then reload the API:

```bash
nano ~/blnk/blnk_clients/client-acme-co/apps/api/.env
# change FEATURE_COMPLIANCE=false → true

pm2 reload client-api
```

> If enabling a module that has migrations, run `pnpm migrate` first.

### Rebuild the frontend only

Use this when `apps/app/.env` changes (e.g. new API URL, currency update):

```bash
cd ~/blnk/blnk_clients/client-acme-co/apps/app
npx expo export -p web --clear    # --clear busts Metro cache for new env vars
```

Nginx picks up the new `dist/` immediately — no reload needed.

### View API logs

```bash
pm2 logs client-api --lines 50
```

> If multiple clients are running, each uses the same PM2 process name `client-api`.
> Use `pm2 list` to find the process ID and target it: `pm2 logs <id> --lines 50`.

---

## How client-baseplate updates reach clients

When a change is merged to `client-baseplate/main`:

1. The daily 3am cron on each client VM runs `deploy.sh`
2. `deploy.sh` does `git fetch upstream && git merge upstream/main --no-edit`
3. If the merge is clean (it should always be — all client config is in `.env`), the build and reload proceed automatically
4. If the merge fails (conflict), the deploy aborts and the old version keeps running. Check the log, SSH in, resolve manually, re-run `deploy.sh`

To push an urgent update to all clients immediately (don't wait for cron):

```bash
ssh robbie@blnk
for client in client-acme-co client-another-co; do
  echo "→ deploying $client"
  cd ~/blnk/blnk_clients/$client && bash deploy.sh
done
```

---

## Troubleshooting

**API returns 502 / nginx bad gateway**
```bash
pm2 list          # is client-api running?
pm2 logs client-api --lines 20   # what's the error?
pm2 restart client-api
```

**`git merge upstream/main` fails with conflicts**
```bash
git status        # shows conflicting files
git diff          # inspect the conflict
# resolve manually, then:
git add .
git commit -m "resolve upstream merge conflict"
bash deploy.sh    # re-run from the top
```

**Frontend shows stale data / wrong env values after .env change**
```bash
cd apps/app && npx expo export -p web --clear
# nginx picks up dist/ immediately, no reload needed
```

**Passkey login fails / "not allowed by CORS"**
Check that `allowed_origins` in blnk_auth matches the exact origin the client is served from — see [`db-operations.md`](./db-operations.md) for the update query.

**Migrations fail on deploy**
```bash
cd apps/api && pnpm migrate
# read the error — usually a missing column or type mismatch from a partial previous run
```

**New client: `/health` returns 404 or connection refused**
- Check `pm2 list` — process may have crashed on startup
- Check `pm2 logs client-api --lines 50` for startup errors
- Most common cause: a required env var is missing. Look for `Missing required environment variable:` in the logs.
