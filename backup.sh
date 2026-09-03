#!/usr/bin/env bash
# Daily DB backup for a single client.
# Run from repo root on the VM: bash backup.sh
# Cron: 0 2 * * * cd /path/to/client-repo && bash backup.sh >> ~/blnk/logs/<slug>-backup.log 2>&1
set -euo pipefail

# Load env to get DATABASE_URL and tenant slug.
ENV_FILE="apps/api/.env"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: $ENV_FILE not found — run from repo root" >&2
  exit 1
fi

DATABASE_URL=$(grep -E '^DATABASE_URL=' "$ENV_FILE" | cut -d= -f2- | tr -d '"')
TENANT_SLUG=$(grep -E '^TENANT_SLUG=' "$ENV_FILE" | cut -d= -f2- | tr -d '"')

if [[ -z "$DATABASE_URL" || -z "$TENANT_SLUG" ]]; then
  echo "ERROR: DATABASE_URL or TENANT_SLUG missing from $ENV_FILE" >&2
  exit 1
fi

BACKUP_DIR="${HOME}/blnk/backups/${TENANT_SLUG}"
mkdir -p "$BACKUP_DIR"

TIMESTAMP=$(date +%Y%m%d-%H%M%S)
OUTFILE="${BACKUP_DIR}/${TENANT_SLUG}-${TIMESTAMP}.dump"

echo "→ dumping ${TENANT_SLUG} to ${OUTFILE}"
pg_dump "$DATABASE_URL" --format=custom --no-acl --no-owner -f "$OUTFILE"
echo "  size: $(du -sh "$OUTFILE" | cut -f1)"

# Keep last 7 days — delete older .dump files.
find "$BACKUP_DIR" -name "*.dump" -mtime +7 -delete
echo "✓ backup complete — kept last 7 days in ${BACKUP_DIR}"
