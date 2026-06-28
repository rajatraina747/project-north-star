import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';

// ---------------------------------------------------------------------------
// Lightweight mocks — no database or bcrypt required
// ---------------------------------------------------------------------------

const MOCK_SECRET = 'test-secret-for-vitest';

vi.mock('../utils/config', () => ({
  config: {
    jwtSecret: MOCK_SECRET,
    jwtExpiresIn: '1h',
    jwtRefreshExpiresInDays: 30,
    passwordResetTtlMinutes: 60,
    passwordResetReturnLink: false,
    appBaseUrl: 'http://localhost:5173',
    nodeEnv: 'test',
    rateLimitWindowMs: 900000,
    rateLimitMaxRequests: 100,
    bcryptRounds: 10,
    loginMaxAttempts: 5,
    loginLockoutMinutes: 15,
    databaseUrl: 'postgresql://mock',
    booksPath: '/books',
    coversPath: '/data/covers',
    thumbnailsPath: '/data/thumbnails',
    configPath: '/data/config',
    googleBooksApiKey: '',
    autoScanEnabled: false,
    scanSchedule: '0 2 * * *',
    coverQuality: 90,
    thumbnailSize: 300,
    maxConcurrentScans: 5,
    seriesProvider: 'google',
    seriesCacheTtlDays: 30,
    port: 3000,
  },
  validateConfig: vi.fn(),
}));

vi.mock('../utils/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

// Mock bcrypt so tests don't pay the actual hashing cost
vi.mock('bcrypt', () => ({
  default: {
    compare: vi.fn(async (plain: string, hash: string) => plain === hash),
    hash: vi.fn(async (plain: string) => plain),
  },
}));

// Minimal DB mock — overridden per-test where needed
vi.mock('../db', () => {
  const mock = {
    oneOrNone: vi.fn(),
    one: vi.fn(),
    none: vi.fn().mockResolvedValue(undefined),
  };
  return { default: mock };
});

// ---------------------------------------------------------------------------
// Build a minimal Express app with just the auth routes
// ---------------------------------------------------------------------------

let app: express.Express;

beforeAll(async () => {
  const { default: authRoutes } = await import('../routes/auth');
  app = express();
  app.use(express.json());
  app.use('/api/auth', authRoutes);
});

afterAll(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/auth/login', () => {
  it('returns 400 when username or password is missing', async () => {
    const res = await request(app).post('/api/auth/login').send({ username: 'admin' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/required/i);
  });

  it('returns 401 when user is not found', async () => {
    const db = (await import('../db')).default as any;
    db.oneOrNone.mockResolvedValueOnce(null);

    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'nobody', password: 'wrong' });

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/invalid credentials/i);
  });

  it('returns 401 when password is wrong', async () => {
    const db = (await import('../db')).default as any;
    db.oneOrNone.mockResolvedValueOnce({
      id: 'uid-1',
      username: 'admin',
      password_hash: 'correct-password',
      is_admin: true,
      display_name: 'Admin',
    });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'admin', password: 'wrong-password' });

    expect(res.status).toBe(401);
  });

  it('returns a JWT on successful login and clears failure state', async () => {
    const db = (await import('../db')).default as any;
    db.none.mockClear();
    db.oneOrNone.mockResolvedValueOnce({
      id: 'uid-1',
      username: 'admin',
      password_hash: 'secret',
      is_admin: true,
      display_name: 'Admin',
    });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'admin', password: 'secret' });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('token');
    expect(res.body.refresh_token).toBeTruthy();
    const decoded = jwt.verify(res.body.token, MOCK_SECRET) as any;
    expect(decoded.username).toBe('admin');
    expect(decoded.is_admin).toBe(true);
    // clearFailedLogins ran
    expect(db.none).toHaveBeenCalledWith(
      expect.stringContaining('failed_login_attempts = 0'),
      ['uid-1']
    );
  });

  it('rejects with 429 when the account is currently locked', async () => {
    const db = (await import('../db')).default as any;
    db.oneOrNone.mockResolvedValueOnce({
      id: 'uid-1',
      username: 'admin',
      password_hash: 'secret',
      is_admin: true,
      locked_until: new Date(Date.now() + 60_000).toISOString(),
    });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'admin', password: 'whatever' });

    expect(res.status).toBe(429);
  });

  it('records a failed attempt on a wrong password', async () => {
    const db = (await import('../db')).default as any;
    db.none.mockClear();
    db.oneOrNone.mockResolvedValueOnce({
      id: 'uid-1',
      username: 'admin',
      password_hash: 'correct-password',
      is_admin: true,
      failed_login_attempts: 2,
    });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'admin', password: 'wrong' });

    expect(res.status).toBe(401);
    // recordFailedLogin updated the counter (3rd attempt, below the threshold).
    expect(db.none).toHaveBeenCalledWith(
      expect.stringContaining('failed_login_attempts'),
      [3, false, '15', 'uid-1']
    );
  });
});

describe('POST /api/auth/register', () => {
  it('returns 400 when required fields are missing', async () => {
    const db = (await import('../db')).default as any;
    // No users in DB
    db.one.mockResolvedValueOnce({ count: 0 });

    const res = await request(app)
      .post('/api/auth/register')
      .send({ username: 'admin' }); // missing email + password

    expect(res.status).toBe(400);
  });

  it('returns 403 when a user already exists', async () => {
    const db = (await import('../db')).default as any;
    db.one.mockResolvedValueOnce({ count: 1 });

    const res = await request(app)
      .post('/api/auth/register')
      .send({ username: 'newuser', email: 'new@example.com', password: 'pass' });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/disabled/i);
  });

  it('creates the first admin and returns a JWT', async () => {
    const db = (await import('../db')).default as any;
    // Count check — no users
    db.one.mockResolvedValueOnce({ count: 0 });
    // INSERT RETURNING
    db.one.mockResolvedValueOnce({
      id: 'uid-new',
      username: 'myadmin',
      email: 'me@example.com',
      display_name: 'myadmin',
      is_admin: true,
    });

    const res = await request(app)
      .post('/api/auth/register')
      .send({ username: 'myadmin', email: 'me@example.com', password: 'strongpassword' });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('token');
    expect(res.body.refresh_token).toBeTruthy();
    const decoded = jwt.verify(res.body.token, MOCK_SECRET) as any;
    expect(decoded.is_admin).toBe(true);
  });
});

describe('POST /api/auth/refresh', () => {
  it('returns 400 when no refresh token is supplied', async () => {
    const res = await request(app).post('/api/auth/refresh').send({});
    expect(res.status).toBe(400);
  });

  it('returns 401 for an unknown refresh token', async () => {
    const db = (await import('../db')).default as any;
    db.oneOrNone.mockResolvedValueOnce(null); // token lookup
    const res = await request(app).post('/api/auth/refresh').send({ refresh_token: 'nope' });
    expect(res.status).toBe(401);
  });

  it('returns 401 for a revoked or expired refresh token', async () => {
    const db = (await import('../db')).default as any;
    db.oneOrNone.mockResolvedValueOnce({
      id: 'rt-1',
      user_id: 'uid-1',
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      revoked_at: new Date().toISOString(),
    });
    const res = await request(app).post('/api/auth/refresh').send({ refresh_token: 'revoked' });
    expect(res.status).toBe(401);
  });

  it('rotates the token and returns a fresh access token', async () => {
    const db = (await import('../db')).default as any;
    db.none.mockClear();
    // token lookup (valid)
    db.oneOrNone.mockResolvedValueOnce({
      id: 'rt-1',
      user_id: 'uid-1',
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      revoked_at: null,
    });
    // user lookup
    db.oneOrNone.mockResolvedValueOnce({
      id: 'uid-1',
      username: 'admin',
      is_admin: true,
      display_name: 'Admin',
    });

    const res = await request(app).post('/api/auth/refresh').send({ refresh_token: 'valid' });

    expect(res.status).toBe(200);
    expect(res.body.refresh_token).toBeTruthy();
    const decoded = jwt.verify(res.body.token, MOCK_SECRET) as any;
    expect(decoded.username).toBe('admin');
    // The presented token was revoked (rotation).
    expect(db.none).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE refresh_tokens SET revoked_at = NOW() WHERE id = $1'),
      ['rt-1']
    );
  });

  it('returns 403 when the account is disabled', async () => {
    const db = (await import('../db')).default as any;
    db.oneOrNone.mockResolvedValueOnce({
      id: 'rt-1',
      user_id: 'uid-1',
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      revoked_at: null,
    });
    db.oneOrNone.mockResolvedValueOnce({
      id: 'uid-1',
      username: 'admin',
      is_admin: false,
      is_active: false,
    });
    const res = await request(app).post('/api/auth/refresh').send({ refresh_token: 'valid' });
    expect(res.status).toBe(403);
  });
});

describe('POST /api/auth/forgot-password', () => {
  it('returns 400 when no identifier is supplied', async () => {
    const res = await request(app).post('/api/auth/forgot-password').send({});
    expect(res.status).toBe(400);
  });

  it('responds generically when the account does not exist (no enumeration)', async () => {
    const db = (await import('../db')).default as any;
    db.none.mockClear();
    db.oneOrNone.mockResolvedValueOnce(null);
    const res = await request(app)
      .post('/api/auth/forgot-password')
      .send({ identifier: 'ghost' });
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/if an account matches/i);
    // No token row was inserted for a non-existent user.
    expect(db.none).not.toHaveBeenCalled();
  });

  it('creates a reset token for an existing account', async () => {
    const db = (await import('../db')).default as any;
    db.none.mockClear();
    db.oneOrNone.mockResolvedValueOnce({
      id: 'uid-1',
      username: 'admin',
      email: 'admin@example.com',
    });
    const res = await request(app)
      .post('/api/auth/forgot-password')
      .send({ identifier: 'admin' });
    expect(res.status).toBe(200);
    // Default config does not leak the token in the response.
    expect(res.body.reset_token).toBeUndefined();
    expect(db.none).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO password_reset_tokens'),
      expect.arrayContaining(['uid-1'])
    );
  });
});

describe('POST /api/auth/reset-password', () => {
  it('returns 400 when token or password is missing', async () => {
    const res = await request(app).post('/api/auth/reset-password').send({ token: 'x' });
    expect(res.status).toBe(400);
  });

  it('returns 400 for a short password', async () => {
    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({ token: 'x', password: 'short' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/at least 8/i);
  });

  it('returns 400 for an invalid/used/expired token', async () => {
    const db = (await import('../db')).default as any;
    db.oneOrNone.mockResolvedValueOnce(null);
    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({ token: 'bad', password: 'longenough' });
    expect(res.status).toBe(400);
  });

  it('updates the password and revokes sessions for a valid token', async () => {
    const db = (await import('../db')).default as any;
    db.none.mockClear();
    db.oneOrNone.mockResolvedValueOnce({
      id: 'prt-1',
      user_id: 'uid-1',
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      used_at: null,
    });
    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({ token: 'good', password: 'longenough' });

    expect(res.status).toBe(200);
    expect(db.none).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE users SET password_hash'),
      expect.arrayContaining(['uid-1'])
    );
    // Sessions invalidated after the credential change.
    expect(db.none).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = $1'),
      ['uid-1']
    );
  });
});

describe('POST /api/auth/logout', () => {
  it('revokes the supplied refresh token and returns 200', async () => {
    const db = (await import('../db')).default as any;
    db.none.mockClear();
    const res = await request(app).post('/api/auth/logout').send({ refresh_token: 'abc' });
    expect(res.status).toBe(200);
    expect(db.none).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE refresh_tokens SET revoked_at = NOW() WHERE token_hash = $1'),
      expect.any(Array)
    );
  });

  it('is a no-op (still 200) when no token is supplied', async () => {
    const db = (await import('../db')).default as any;
    db.none.mockClear();
    const res = await request(app).post('/api/auth/logout').send({});
    expect(res.status).toBe(200);
    expect(db.none).not.toHaveBeenCalled();
  });
});
