#!/usr/bin/env bash
set -euo pipefail

# LibreHR Database Restore Script
# Usage: ./restore.sh <backup_file.sql.gz>

if [ -z "${1:-}" ]; then
  echo "Usage: $0 <path_to_backup.sql.gz>" >&2
  exit 1
fi

BACKUP_FILE="$1"

if [ ! -f "$BACKUP_FILE" ]; then
  echo "Error: Backup file '${BACKUP_FILE}' not found." >&2
  exit 1
fi

if [ -z "${DATABASE_URL:-}" ]; then
  echo "Error: DATABASE_URL environment variable is required." >&2
  exit 1
fi

echo "[LibreHR Restore] Warning: This operation will restore database from ${BACKUP_FILE}."
echo "[LibreHR Restore] Starting decompression and restore into target database..."

gunzip -c "$BACKUP_FILE" | psql "$DATABASE_URL" --single-transaction

echo "[LibreHR Restore] Completed successfully."
