import { runMigrations, testConnection } from './index';
import { logger } from '../utils/logger';

async function migrate() {
  try {
    logger.info('Starting database migration...');

    const connected = await testConnection();
    if (!connected) {
      throw new Error('Cannot connect to database');
    }

    await runMigrations();
    logger.info('Migration completed successfully');
    process.exit(0);
  } catch (error) {
    logger.error('Migration failed:', error);
    process.exit(1);
  }
}

migrate();
