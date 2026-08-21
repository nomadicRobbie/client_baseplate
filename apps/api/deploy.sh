#!/usr/bin/env bash
# Deploy client-api with PM2.
# Run from apps/api on the VM: bash deploy.sh
set -euo pipefail

echo "→ installing dependencies"
pnpm install --frozen-lockfile

echo "→ building"
pnpm build

echo "→ starting / reloading via PM2"
if pm2 describe client-api > /dev/null 2>&1; then
  pm2 reload ecosystem.config.js --env production
else
  pm2 start ecosystem.config.js --env production
fi

pm2 save
echo "✓ done"
