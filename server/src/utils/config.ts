import dotenv from 'dotenv';

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
  // 24 h default — short enough to limit the damage if a localStorage-stored
  // token is stolen via XSS, while still comfortable for normal use.
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '24h',
  // Refresh tokens: a long-lived, rotating, server-stored token (only its hash
  // is persisted) lets the short access token above renew instead of the
  // session hard-expiring. Revoked on logout and password reset.
  jwtRefreshExpiresInDays: parseInt(process.env.JWT_REFRESH_EXPIRES_IN_DAYS || '30', 10),

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

  // In-book full-text search: cap the extracted text stored per book. Keeps the
  // generated tsvector under Postgres's ~1 MB limit and bounds storage; the
  // start of a book is the most useful for search anyway.
  fulltextMaxChars: parseInt(process.env.FULLTEXT_MAX_CHARS || '600000', 10),

  // Security
  rateLimitWindowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10), // 15 min
  rateLimitMaxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100', 10),
  // bcrypt cost factor for password hashing. 10 is a sensible default; raise for
  // stronger hashing at the cost of slower logins.
  bcryptRounds: parseInt(process.env.BCRYPT_ROUNDS || '10', 10),
  // Account lockout: after this many consecutive failed logins, the account is
  // temporarily locked for the configured number of minutes.
  loginMaxAttempts: parseInt(process.env.LOGIN_MAX_ATTEMPTS || '5', 10),
  loginLockoutMinutes: parseInt(process.env.LOGIN_LOCKOUT_MINUTES || '15', 10),
  // Password reset: how long a reset token is valid for. There is no paid email
  // provider — the reset link is always logged (the pluggable delivery seam in
  // routes/auth.ts), and can optionally be returned in the API response for
  // headless/no-email self-hosting. appBaseUrl is used to build the link.
  passwordResetTtlMinutes: parseInt(process.env.PASSWORD_RESET_TTL_MINUTES || '60', 10),
  passwordResetReturnLink: process.env.PASSWORD_RESET_RETURN_LINK === 'true',
  appBaseUrl: process.env.APP_BASE_URL || '',
};

const DEFAULT_JWT_SECRET = 'change-me-in-production-please';

export function validateConfig(): void {
  const required = ['databaseUrl'];

  for (const key of required) {
    if (!config[key as keyof typeof config]) {
      throw new Error(`Missing required configuration: ${key}`);
    }
  }

  if (config.nodeEnv === 'production') {
    if (!process.env.JWT_SECRET) {
      throw new Error('JWT_SECRET must be set in production. Generate one with: openssl rand -base64 64');
    }
    if (config.jwtSecret === DEFAULT_JWT_SECRET) {
      throw new Error('JWT_SECRET is set to the insecure default in production. Set a strong random secret.');
    }
  }
}
