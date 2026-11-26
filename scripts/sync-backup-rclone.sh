#!/usr/bin/env bash
# ==============================================================================
# MATN Platform — Off-Server Backup Sync via rclone (Google Drive / S3 / B2)
# Usage:
#   ./scripts/sync-backup-rclone.sh [remote_name:remote_path]
# Default remote target: matn-gdrive:matn-backups
# ==============================================================================
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUPS_DIR="${BACKUPS_DIR:-${APP_DIR}/backups}"
REMOTE_TARGET="${1:-${RCLONE_REMOTE:-matn-gdrive:matn-backups}}"
LOG_DIR="${APP_DIR}/logs"
LOG_FILE="${LOG_DIR}/rclone-sync.log"

mkdir -p "${LOG_DIR}" "${BACKUPS_DIR}"

if ! command -v rclone >/dev/null 2>&1; then
  echo "ERROR: rclone is not installed. Install it via: sudo apt install -y rclone (or https://rclone.org/install.sh)" >&2
  exit 1
fi

REMOTE_NAME="${REMOTE_TARGET%%:*}"
if ! rclone listremotes | grep -qx "${REMOTE_NAME}:"; then
  echo "ERROR: rclone remote '${REMOTE_NAME}' is not configured yet. Run: rclone config" >&2
  exit 1
fi

echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] Starting database backup & sync to ${REMOTE_TARGET}..." | tee -a "${LOG_FILE}"

# Create a fresh SQLite consistent backup first before syncing
(cd "${APP_DIR}" && node scripts/backup-db.js backup) | tee -a "${LOG_FILE}"

# Sync backups directory (excluding .gitkeep) safely to cloud remote
rclone sync "${BACKUPS_DIR}" "${REMOTE_TARGET}" \
  --exclude ".gitkeep" \
  --transfers 4 \
  --checkers 4 \
  --retries 3 \
  --low-level-retries 5 \
  --stats-one-line \
  --log-level INFO \
  --log-file "${LOG_FILE}"

echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] Sync completed successfully to ${REMOTE_TARGET}." | tee -a "${LOG_FILE}"
