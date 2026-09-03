#!/usr/bin/env bash
# Deploy frontend (nginx static) + API (PM2).
# Run from repo root on the VM: bash deploy.sh
#
# Requires an 'upstream' remote pointing at client-baseplate:
#   git remote add upstream git@github.com:blnk/client-baseplate.git
set -euo pipefail

echo "→ fetching upstream (client-baseplate)"
git fetch upstream

echo "→ merging client-baseplate updates"
git merge upstream/main --no-edit

echo "→ installing dependencies"
pnpm install --frozen-lockfile

echo "→ running migrations"
(cd apps/api && pnpm migrate)

echo "→ building"
pnpm build --filter=@blnk/shared
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
echo ""
echo "Note: if apps/app/.env has changed since the last deploy, bust Metro's"
echo "cache to bake the new values into the frontend bundle:"
echo "  cd apps/app && npx expo export -p web --clear"
