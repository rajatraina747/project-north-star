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
    const decoded = jwt.verify(res.body.token, MOCK_SECRET) as any;
    expect(decoded.is_admin).toBe(true);
  });
});
