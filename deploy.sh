#!/usr/bin/env bash
# Deploy frontend (nginx static) + API (PM2).
# Run from repo root on the VM: bash deploy.sh
#
# For CLIENT instances (forks of client-baseplate), also add an upstream remote
# to pull in baseplate updates:
#   git remote add upstream git@github.com:blnk/client-baseplate.git
#   git fetch upstream && git merge upstream/main --no-edit
set -euo pipefail

if [ ! -f apps/app/.env ]; then
  echo "✗ apps/app/.env not found — copy .env.example and fill in values before deploying"
  exit 1
fi

echo ""
echo "Note: if you have changed apps/app/.env since the last deploy, run a cache-busted build instead:"
echo "  cd apps/app && npx expo export -p web --clear"
echo ""

echo "→ pulling latest code"
git pull origin main

echo "→ installing dependencies"
pnpm install --frozen-lockfile

echo "→ running migrations"
(cd apps/api && pnpm migrate)

echo "→ building"
pnpm build --filter=@blnk/shared
set -a && source apps/app/.env && set +a
(cd apps/app && npx expo export -p web)
pnpm build --filter=@blnk/client-api

echo "→ starting / reloading API via PM2"
if pm2 describe client-api > /dev/null 2>&1; then
  pm2 reload apps/api/ecosystem.config.js --env production
else
  pm2 start apps/api/ecosystem.config.js --env production
fi

pm2 save
echo "✓ done"
