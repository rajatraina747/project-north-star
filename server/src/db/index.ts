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

export async function runMigrations(): Promise<void> {
  try {
    const fs = await import('fs');
    const path = await import('path');

    // Prefer the compiled copy next to this file; fall back to the source tree
    // (covers `tsx` dev runs and builds where assets weren't copied).
    const candidates = [
      path.join(__dirname, 'schema.sql'),
      path.join(__dirname, '..', '..', 'src', 'db', 'schema.sql'),
    ];
    const schemaPath = candidates.find((p) => fs.existsSync(p));
    if (!schemaPath) {
      throw new Error(`schema.sql not found (looked in: ${candidates.join(', ')})`);
    }
    const schema = fs.readFileSync(schemaPath, 'utf-8');

    await db.none(schema);
    logger.info('Database migrations completed successfully');
  } catch (error) {
    logger.error('Database migration failed:', error);
    throw error;
  }
}

export default db;
