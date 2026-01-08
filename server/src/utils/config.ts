import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

export const config = {
  // Server
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',

  // Database
  databaseUrl: process.env.DATABASE_URL || 'postgresql://northstar:northstar@localhost:5432/northstar',

  // Paths
  booksPath: process.env.BOOKS_PATH || '/books',
  coversPath: process.env.COVERS_PATH || '/data/covers',
  thumbnailsPath: process.env.THUMBNAILS_PATH || '/data/thumbnails',
  configPath: process.env.CONFIG_PATH || '/data/config',

  // JWT
  jwtSecret: process.env.JWT_SECRET || 'change-me-in-production-please',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',

  // API Keys
  googleBooksApiKey: process.env.GOOGLE_BOOKS_API_KEY || '',

  // Features
  autoScanEnabled: process.env.AUTO_SCAN_ENABLED === 'true',
  scanSchedule: process.env.SCAN_SCHEDULE || '0 2 * * *', // 2 AM daily

  // Performance
  coverQuality: parseInt(process.env.COVER_QUALITY || '90', 10),
  thumbnailSize: parseInt(process.env.THUMBNAIL_SIZE || '300', 10),
  maxConcurrentScans: parseInt(process.env.MAX_CONCURRENT_SCANS || '5', 10),

  // Series
  seriesProvider: process.env.SERIES_PROVIDER || 'google',
  seriesCacheTtlDays: parseInt(process.env.SERIES_CACHE_TTL_DAYS || '30', 10),

  // Security
  rateLimitWindowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10), // 15 min
  rateLimitMaxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100', 10),
};

export function validateConfig(): void {
  const required = ['databaseUrl', 'jwtSecret'];

  for (const key of required) {
    if (!config[key as keyof typeof config]) {
      throw new Error(`Missing required configuration: ${key}`);
    }
  }

  // Warn about default JWT secret
  if (config.jwtSecret === 'change-me-in-production-please' && config.nodeEnv === 'production') {
    console.warn('WARNING: Using default JWT secret in production! Please set JWT_SECRET environment variable.');
  }
}
