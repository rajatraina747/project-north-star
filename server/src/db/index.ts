import pgPromise from 'pg-promise';
import { logger } from '../utils/logger';

const pgp = pgPromise();

const connectionString = process.env.DATABASE_URL || 'postgresql://northstar:northstar@localhost:5432/northstar';

export const db = pgp(connectionString);

export async function testConnection(): Promise<boolean> {
  try {
    await db.one('SELECT 1 as test');
    logger.info('Database connection successful');
    return true;
  } catch (error) {
    logger.error('Database connection failed:', error);
    return false;
  }
}

/**
 * Apply any not-yet-applied SQL migrations from db/migrations in version order.
 *
 * Each file is named `NNN_description.sql` (e.g. `001_baseline.sql`). The
 * filename minus the extension is the version, recorded in `schema_migrations`
 * once applied so it never runs twice. The baseline (001) is the original
 * idempotent schema, so this is safe to run against an existing database that
 * predates the migration table — 001 no-ops and is simply recorded.
 *
 * Each migration runs inside a transaction together with its bookkeeping insert,
 * so a failed migration rolls back cleanly and isn't marked applied.
 */
export async function runMigrations(): Promise<void> {
  try {
    const fs = await import('fs');
    const path = await import('path');

    // Prefer the compiled copy next to this file; fall back to the source tree
    // (covers `tsx` dev runs and builds where assets weren't copied).
    const candidates = [
      path.join(__dirname, 'migrations'),
      path.join(__dirname, '..', '..', 'src', 'db', 'migrations'),
    ];
    const migrationsDir = candidates.find((p) => fs.existsSync(p));
    if (!migrationsDir) {
      throw new Error(`migrations directory not found (looked in: ${candidates.join(', ')})`);
    }

    await db.none(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         version TEXT PRIMARY KEY,
         applied_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
       )`
    );

    const appliedRows = await db.manyOrNone<{ version: string }>('SELECT version FROM schema_migrations');
    const applied = new Set((appliedRows || []).map((r) => r.version));

    const files = fs
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    let count = 0;
    for (const file of files) {
      const version = file.replace(/\.sql$/, '');
      if (applied.has(version)) continue;

      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
      await db.tx(async (t) => {
        await t.none(sql);
        await t.none('INSERT INTO schema_migrations (version) VALUES ($1)', [version]);
      });
      logger.info(`Applied migration ${version}`);
      count++;
    }

    logger.info(
      count > 0
        ? `Database migrations completed: ${count} applied`
        : 'Database migrations: already up to date'
    );
  } catch (error) {
    logger.error('Database migration failed:', error);
    throw error;
  }
}

export default db;
