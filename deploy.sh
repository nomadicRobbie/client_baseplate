#!/usr/bin/env bash
# Deploy frontend (nginx static) + API (PM2).
# Run from repo root on the VM: bash deploy.sh
set -euo pipefail

echo "→ pulling latest"
git pull

echo "→ installing dependencies"
pnpm install --frozen-lockfile

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
