#!/usr/bin/env bash
set -euo pipefail

# OpenHR Database Backup Script
# Usage: ./backup.sh [destination_directory]

DEST_DIR="${1:-./backups}"
mkdir -p "$DEST_DIR"

TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="${DEST_DIR}/openhr_backup_${TIMESTAMP}.sql.gz"

echo "[OpenHR Backup] Starting PostgreSQL dump to ${BACKUP_FILE}..."

if [ -z "${DATABASE_URL:-}" ]; then
  echo "Error: DATABASE_URL environment variable is required." >&2
  exit 1
fi

pg_dump "$DATABASE_URL" \
  --format=plain \
  --no-owner \
  --no-privileges \
  | gzip > "$BACKUP_FILE"

echo "[OpenHR Backup] Completed successfully: ${BACKUP_FILE}"
echo "[OpenHR Backup] Size: $(du -h "$BACKUP_FILE" | cut -f1)"
