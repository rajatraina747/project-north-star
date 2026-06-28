#!/usr/bin/env bash
#
# North Star backup: dumps the Postgres database and archives the generated
# data directory (covers, thumbnails, config). The book library itself (BOOKS_PATH)
# is your own source content and is intentionally NOT included — back it up
# separately.
#
# Usage:
#   DATABASE_URL=postgresql://user:pass@host:5432/northstar \
#   DATA_DIR=/data BACKUP_DIR=/backups ./scripts/backup.sh
#
# Defaults match docker-compose. Run from a host that can reach the DB, or
# `docker compose exec` it inside the server container.

set -euo pipefail

DATABASE_URL="${DATABASE_URL:-postgresql://northstar:northstar@localhost:5432/northstar}"
DATA_DIR="${DATA_DIR:-/data}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"

timestamp="$(date +%Y%m%d-%H%M%S)"
dest="${BACKUP_DIR}/northstar-${timestamp}"
mkdir -p "${dest}"

echo "==> Backing up database"
# Custom format (-Fc) restores cleanly with pg_restore and is compressed.
pg_dump --format=custom --no-owner --no-privileges "${DATABASE_URL}" \
  > "${dest}/database.dump"

echo "==> Archiving data directory (${DATA_DIR})"
if [ -d "${DATA_DIR}" ]; then
  tar -czf "${dest}/data.tar.gz" -C "$(dirname "${DATA_DIR}")" "$(basename "${DATA_DIR}")"
else
  echo "    WARNING: ${DATA_DIR} not found — skipping data archive" >&2
fi

# Record what produced this backup so restore can sanity-check it.
cat > "${dest}/MANIFEST.txt" <<EOF
North Star backup
created_at: ${timestamp}
database_url_host: $(echo "${DATABASE_URL}" | sed -E 's#.*@([^/]+)/.*#\1#')
data_dir: ${DATA_DIR}
files:
  - database.dump   (pg_dump custom format)
  - data.tar.gz     (covers, thumbnails, config)
EOF

echo "==> Done: ${dest}"
ls -lh "${dest}"
