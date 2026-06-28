#!/usr/bin/env bash
#
# North Star restore: restores a backup produced by backup.sh — the Postgres
# database and the generated data directory (covers, thumbnails, config).
#
# Usage:
#   DATABASE_URL=postgresql://user:pass@host:5432/northstar \
#   DATA_DIR=/data ./scripts/restore.sh /backups/northstar-20260628-120000
#
# WARNING: this overwrites the target database objects and the data directory.
# Stop the server/worker before restoring.

set -euo pipefail

if [ $# -lt 1 ]; then
  echo "Usage: $0 <backup-dir>" >&2
  exit 1
fi

SRC="$1"
DATABASE_URL="${DATABASE_URL:-postgresql://northstar:northstar@localhost:5432/northstar}"
DATA_DIR="${DATA_DIR:-/data}"

if [ ! -f "${SRC}/database.dump" ]; then
  echo "ERROR: ${SRC}/database.dump not found — is this a North Star backup?" >&2
  exit 1
fi

echo "==> About to restore into:"
echo "    DB:   $(echo "${DATABASE_URL}" | sed -E 's#://[^@]+@#://***@#')"
echo "    DATA: ${DATA_DIR}"
read -r -p "This OVERWRITES existing data. Continue? [y/N] " reply
[ "${reply}" = "y" ] || [ "${reply}" = "Y" ] || { echo "Aborted."; exit 1; }

echo "==> Restoring database"
# --clean drops existing objects first; --if-exists avoids errors on a fresh DB.
pg_restore --clean --if-exists --no-owner --no-privileges \
  --dbname="${DATABASE_URL}" "${SRC}/database.dump"

if [ -f "${SRC}/data.tar.gz" ]; then
  echo "==> Restoring data directory"
  mkdir -p "$(dirname "${DATA_DIR}")"
  tar -xzf "${SRC}/data.tar.gz" -C "$(dirname "${DATA_DIR}")"
else
  echo "    No data.tar.gz in backup — skipping data restore"
fi

echo "==> Done. Restart the server and worker."
