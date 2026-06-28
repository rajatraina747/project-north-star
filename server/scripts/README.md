# Operational scripts

## Backup & restore

`backup.sh` dumps the Postgres database (pg_dump custom format) and archives the
generated data directory — covers, thumbnails, and config. Your book library
(`BOOKS_PATH`) is your own source content and is **not** included; back it up
separately.

```bash
# Create a backup (defaults match docker-compose)
DATABASE_URL=postgresql://northstar:northstar@localhost:5432/northstar \
DATA_DIR=/data BACKUP_DIR=/backups \
  ./scripts/backup.sh

# Inside Docker
docker compose exec server ./scripts/backup.sh
```

`restore.sh` restores a backup directory. **It overwrites** the target database
and data directory, so stop the server/worker first and confirm the prompt.

```bash
DATABASE_URL=postgresql://northstar:northstar@localhost:5432/northstar \
DATA_DIR=/data \
  ./scripts/restore.sh /backups/northstar-20260628-120000
```

Requires `pg_dump`/`pg_restore` (the `postgresql-client` package) on the machine
running the scripts.

### Scheduling

Run nightly via cron on the host:

```cron
0 3 * * * cd /opt/northstar/server && BACKUP_DIR=/backups ./scripts/backup.sh >> /var/log/northstar-backup.log 2>&1
```

## Metrics

The server exposes Prometheus metrics at `GET /metrics` (process/Node metrics,
HTTP request counts + latency histograms, and `northstar_books_total` /
`northstar_users_total` gauges). Point Prometheus at it and visualize in Grafana.
