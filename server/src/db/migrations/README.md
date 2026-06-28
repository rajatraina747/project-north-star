# Database migrations

Migrations are plain SQL files applied in version order by `runMigrations()`
([../index.ts](../index.ts)), tracked in the `schema_migrations` table so each
runs exactly once.

## Adding a migration

1. Create a new file named `NNN_short_description.sql`, where `NNN` is the next
   zero-padded number (e.g. `002_add_reading_streaks.sql`). Files are applied in
   ascending filename order.
2. Write forward-only SQL. Prefer idempotent statements (`IF NOT EXISTS`,
   `ON CONFLICT DO NOTHING`) so a partially-applied deploy can be re-run safely.
3. Each migration runs inside a transaction with its bookkeeping insert, so a
   failure rolls back and the version is **not** recorded.

## Applying

- On startup the worker/server calls `runMigrations()` automatically.
- Manually: `npm run migrate` (built) or `npm run migrate:dev` (tsx).

## Notes

- `001_baseline.sql` is the original idempotent schema. Running it against a
  database that predates this system is a no-op; it's simply recorded as applied.
- Never edit an already-released migration — add a new one instead.
