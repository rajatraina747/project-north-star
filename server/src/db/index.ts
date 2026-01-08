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

    const schemaPath = path.join(__dirname, 'schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf-8');

    await db.none(schema);
    logger.info('Database migrations completed successfully');
  } catch (error) {
    logger.error('Database migration failed:', error);
    throw error;
  }
}

export default db;
