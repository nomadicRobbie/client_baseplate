#!/usr/bin/env bash
# provision-vm.sh — First-run provisioner for a blnk client VM.
#
# Run once as root (or sudo) on a fresh Ubuntu 22.04/24.04 VM:
#   sudo bash provision-vm.sh \
#     --slug        acme-co \
#     --domain      acme.blnk.nz \
#     --api-domain  acme-api.blnk.nz \
#     --repo        git@github.com:blnk/client-acme-co.git \
#     --port        4000
#
# What it does (idempotent — safe to re-run):
#   1. System packages (nginx, certbot, postgresql-client, git, curl)
#   2. Node.js 22 via NodeSource
#   3. pnpm (via corepack)
#   4. PM2 globally
#   5. App user 'blnk' + home dir
#   6. Repo clone to /home/blnk/<slug>
#   7. pnpm install
#   8. Checks for .env files — pauses if missing, prints template
#   9. DB migrations
#  10. Full build
#  11. nginx vhost (API reverse-proxy + SPA static)
#  12. Certbot SSL (skipped with --skip-ssl)
#  13. PM2 start + save + startup
#  14. Log dir + cron entries for daily backup (2am) and deploy (3am)
#
# Pre-flight checklist (must be done before running this script):
#   - DNS A records for --domain and --api-domain pointing at this VM's IP
#   - Deploy key added to the GitHub repo (ssh-keygen, add public key in repo Settings > Deploy keys)
#   - GitHub repo exists and has client code pushed
#   - .env files prepared locally (provision:client in blnk_api emits them)
#
# After the script pauses at step 8:
#   - Copy apps/api/.env and apps/app/.env from your local machine
#   - Press Enter to continue
set -euo pipefail

# ── Argument parsing ──────────────────────────────────────────────────────────
SLUG=""
DOMAIN=""
API_DOMAIN=""
REPO=""
PORT=4000
SKIP_SSL=false
APP_USER="blnk"

usage() {
  echo "Usage: sudo bash provision-vm.sh --slug <slug> --domain <domain> --api-domain <api-domain> --repo <git-ssh-url> [--port <port>] [--skip-ssl]"
  exit 1
}

while [[ $# -gt 0 ]]; do
  case $1 in
    --slug)       SLUG="$2";       shift 2 ;;
    --domain)     DOMAIN="$2";     shift 2 ;;
    --api-domain) API_DOMAIN="$2"; shift 2 ;;
    --repo)       REPO="$2";       shift 2 ;;
    --port)       PORT="$2";       shift 2 ;;
    --skip-ssl)   SKIP_SSL=true;   shift   ;;
    *)            usage ;;
  esac
done

[[ -z "$SLUG" || -z "$DOMAIN" || -z "$API_DOMAIN" || -z "$REPO" ]] && usage

REPO_DIR="/home/${APP_USER}/${SLUG}"
LOG_DIR="/home/${APP_USER}/logs"
BACKUP_DIR="/home/${APP_USER}/backups/${SLUG}"

log() { echo ""; echo "══ $* ══"; }

# ── 1. System packages ────────────────────────────────────────────────────────
log "1/13 system packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq \
  git curl nginx certbot python3-certbot-nginx \
  postgresql-client ufw fail2ban logrotate

# ── 2. Node.js 22 ─────────────────────────────────────────────────────────────
log "2/13 Node.js 22"
if ! command -v node &>/dev/null || [[ "$(node -v)" != v22* ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y -qq nodejs
fi
echo "  node $(node -v)  npm $(npm -v)"

# ── 3. pnpm ───────────────────────────────────────────────────────────────────
log "3/13 pnpm"
npm install -g corepack --silent
corepack enable
corepack prepare pnpm@latest --activate
echo "  pnpm $(pnpm -v)"

# ── 4. PM2 ───────────────────────────────────────────────────────────────────
log "4/13 PM2"
npm install -g pm2 --silent
echo "  pm2 $(pm2 -v)"

# ── 5. App user ───────────────────────────────────────────────────────────────
log "5/13 app user '${APP_USER}'"
if ! id "$APP_USER" &>/dev/null; then
  useradd -m -s /bin/bash "$APP_USER"
  echo "  created user ${APP_USER}"
else
  echo "  user ${APP_USER} already exists — skipping"
fi
mkdir -p "$LOG_DIR" "$BACKUP_DIR"
chown -R "${APP_USER}:${APP_USER}" "/home/${APP_USER}"

# ── 6. Clone repo ─────────────────────────────────────────────────────────────
log "6/13 clone repo"
if [[ -d "$REPO_DIR/.git" ]]; then
  echo "  repo already cloned at ${REPO_DIR} — skipping"
else
  sudo -u "$APP_USER" git clone "$REPO" "$REPO_DIR"
  # keep client-baseplate as upstream for future updates
  sudo -u "$APP_USER" git -C "$REPO_DIR" remote add upstream git@github.com:blnk/client-baseplate.git 2>/dev/null || true
fi

# ── 7. Install deps ──────────────────────────────────────────────────────────
log "7/13 pnpm install"
sudo -u "$APP_USER" bash -c "cd ${REPO_DIR} && pnpm install --frozen-lockfile"

# ── 8. Environment files ──────────────────────────────────────────────────────
log "8/13 environment files"
API_ENV="${REPO_DIR}/apps/api/.env"
APP_ENV="${REPO_DIR}/apps/app/.env"

if [[ ! -f "$API_ENV" || ! -f "$APP_ENV" ]]; then
  echo ""
  echo "  ┌─────────────────────────────────────────────────────────────────────┐"
  echo "  │  MANUAL STEP REQUIRED — .env files not found.                      │"
  echo "  │                                                                     │"
  echo "  │  On your local machine, run provision:client in blnk_api to        │"
  echo "  │  generate both .env blocks, then copy them to this VM:             │"
  echo "  │                                                                     │"
  echo "  │    scp /path/to/api.env  root@<vm-ip>:${API_ENV}"
  echo "  │    scp /path/to/app.env  root@<vm-ip>:${APP_ENV}"
  echo "  │                                                                     │"
  echo "  │  Required vars not emitted by provision:client (fill manually):    │"
  echo "  │    PORT=${PORT}   (in apps/api/.env)                              │"
  echo "  │    DATABASE_URL   (update password to match the one you set)       │"
  echo "  │    STRIPE_API_KEY / STRIPE_WEBHOOK_SECRET  (if FEATURE_STRIPE=true)│"
  echo "  │    CLOUDINARY_*   (if FEATURE_COMMERCE=true)                       │"
  echo "  │    EXPO_PUBLIC_EAS_PROJECT_ID  (if native app needed)              │"
  echo "  └─────────────────────────────────────────────────────────────────────┘"
  echo ""
  read -rp "  Press Enter once both .env files are in place to continue..."
  echo ""
fi

# Verify required vars are present after the pause
for var in DATABASE_URL TENANT_SLUG PORT; do
  if ! grep -qE "^${var}=" "$API_ENV"; then
    echo "ERROR: ${var} is missing from ${API_ENV}" >&2
    exit 1
  fi
done
echo "  .env files verified"

# Fix ownership (scp as root doesn't set blnk ownership)
chown "${APP_USER}:${APP_USER}" "$API_ENV" "$APP_ENV"

# ── 9. Database migrations ────────────────────────────────────────────────────
log "9/13 database migrations"
sudo -u "$APP_USER" bash -c "cd ${REPO_DIR}/apps/api && pnpm migrate"

# ── 10. Build ─────────────────────────────────────────────────────────────────
log "10/13 build"
sudo -u "$APP_USER" bash -c "
  cd ${REPO_DIR}
  pnpm build --filter=@blnk/shared
  cd apps/app && set -a && source .env && set +a && npx expo export -p web
  cd ../..
  pnpm build --filter=@blnk/client-api
"

# ── 11. nginx vhost ───────────────────────────────────────────────────────────
log "11/13 nginx vhost"
NGINX_CONF="/etc/nginx/sites-available/${SLUG}"
cat > "$NGINX_CONF" <<NGINX
# ${SLUG} — generated by provision-vm.sh on $(date +%Y-%m-%d)
# API
server {
    listen 80;
    server_name ${API_DOMAIN};
    # HTTPS redirect added by certbot

    location / {
        proxy_pass         http://127.0.0.1:${PORT};
        proxy_http_version 1.1;
        proxy_set_header   Upgrade \$http_upgrade;
        proxy_set_header   Connection 'upgrade';
        proxy_set_header   Host \$host;
        proxy_set_header   X-Real-IP \$remote_addr;
        proxy_set_header   X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
    }
}

# Frontend (SPA static)
server {
    listen 80;
    server_name ${DOMAIN};
    # HTTPS redirect added by certbot

    root ${REPO_DIR}/apps/app/dist;
    index index.html;

    location / {
        try_files \$uri \$uri/ /index.html;
    }

    # Cache hashed assets forever; revalidate HTML
    location ~* \.(js|css|woff2?|png|jpg|svg|ico)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
}
NGINX

# Enable — remove the default site if this is a fresh VM
rm -f /etc/nginx/sites-enabled/default
ln -sf "$NGINX_CONF" "/etc/nginx/sites-enabled/${SLUG}"
nginx -t
systemctl reload nginx
echo "  nginx vhost active for ${DOMAIN} and ${API_DOMAIN}"

# ── 12. SSL ───────────────────────────────────────────────────────────────────
log "12/13 SSL (certbot)"
if [[ "$SKIP_SSL" == true ]]; then
  echo "  --skip-ssl set — skipping certbot (HTTP only for now)"
  echo "  Run when DNS is ready:  certbot --nginx -d ${DOMAIN} -d ${API_DOMAIN}"
else
  certbot --nginx \
    -d "$DOMAIN" -d "$API_DOMAIN" \
    --non-interactive --agree-tos \
    -m "ops@blnk.nz" \
    --redirect
  echo "  SSL active"
fi

# ── 13. PM2 ──────────────────────────────────────────────────────────────────
log "13/13 PM2 start + cron"
sudo -u "$APP_USER" bash -c "
  cd ${REPO_DIR}
  if pm2 describe client-api > /dev/null 2>&1; then
    pm2 reload apps/api/ecosystem.config.js --env production
  else
    pm2 start apps/api/ecosystem.config.js --env production
  fi
  pm2 save
"
# Persist across reboots
env PATH=$PATH:/usr/bin pm2 startup systemd -u "$APP_USER" --hp "/home/${APP_USER}" | tail -1 | bash

# Daily cron: backup at 2am, deploy at 3am
CRON_JOB_BACKUP="0 2 * * * cd ${REPO_DIR} && bash backup.sh >> ${LOG_DIR}/${SLUG}-backup.log 2>&1"
CRON_JOB_DEPLOY="0 3 * * * cd ${REPO_DIR} && bash deploy.sh >> ${LOG_DIR}/${SLUG}-deploy.log 2>&1"
(sudo -u "$APP_USER" crontab -l 2>/dev/null | grep -vF "$REPO_DIR"; echo "$CRON_JOB_BACKUP"; echo "$CRON_JOB_DEPLOY") \
  | sudo -u "$APP_USER" crontab -
echo "  PM2 running, startup enabled, cron installed"

# ── Firewall ──────────────────────────────────────────────────────────────────
ufw --force enable
ufw allow 22/tcp   # SSH
ufw allow 80/tcp   # HTTP (certbot + redirect)
ufw allow 443/tcp  # HTTPS
echo ""

# ── Done ──────────────────────────────────────────────────────────────────────
echo "══════════════════════════════════════════════════════════════════════════"
echo "  ✓  ${SLUG} provisioned"
echo ""
echo "  App:    https://${DOMAIN}"
echo "  API:    https://${API_DOMAIN}/health"
echo "  Logs:   ${LOG_DIR}/${SLUG}-deploy.log"
echo "  Backup: ${BACKUP_DIR}/"
echo ""
echo "  Next:"
echo "    1. curl https://${API_DOMAIN}/health   — should return {\"status\":\"ok\"}"
echo "    2. Open https://${DOMAIN}               — should load the app"
echo "    3. Add UptimeRobot monitor on ${API_DOMAIN}/health"
echo "    4. Update the port registry in docs/runbook.md (port ${PORT})"
echo "══════════════════════════════════════════════════════════════════════════"
