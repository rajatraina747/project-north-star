import { Router } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import db from '../db';
import { config } from '../utils/config';
import { logger } from '../utils/logger';
import { User, LoginRequest, LoginResponse } from '../types';
import { authenticateToken, AuthRequest } from '../middleware/auth';

const router = Router();

type TokenUser = Pick<User, 'id' | 'username' | 'is_admin'>;

/** Sign a short-lived access JWT (the bearer token used on every API request). */
function signAccessToken(user: TokenUser): string {
  return jwt.sign(
    { id: user.id, username: user.username, is_admin: user.is_admin },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn } as jwt.SignOptions
  );
}

// Opaque secrets (refresh + reset tokens) are stored only as SHA-256 hashes, so
// a database leak doesn't expose usable tokens. The high-entropy random value
// makes a plain hash sufficient here (no need for bcrypt's slow KDF).
const hashToken = (raw: string): string =>
  crypto.createHash('sha256').update(raw).digest('hex');

/**
 * Mint a rotating refresh token for a user: a random opaque string whose hash is
 * stored server-side (so it can be revoked on logout/reset), returning the raw
 * value to the caller. Best-effort if the refresh_tokens table isn't present yet
 * (migration 003 not run) — auth still works, just without renewal.
 */
async function issueRefreshToken(userId: string): Promise<string | null> {
  const raw = crypto.randomBytes(40).toString('hex');
  const expiresAt = new Date(Date.now() + config.jwtRefreshExpiresInDays * 86_400_000);
  try {
    await db.none(
      'INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
      [userId, hashToken(raw), expiresAt]
    );
    return raw;
  } catch (error) {
    if ((error as { code?: string })?.code === '42P01') {
      logger.warn('refresh_tokens table is missing — run database migrations (npm run migrate).');
      return null;
    }
    throw error;
  }
}

const publicUser = (user: User): LoginResponse['user'] => ({
  id: user.id,
  username: user.username,
  display_name: user.display_name,
  is_admin: user.is_admin,
});

/**
 * Pluggable delivery seam for the password-reset link. No paid email provider is
 * assumed: by default the link is logged so a self-hosted admin can retrieve it
 * from the server logs (and it can optionally be returned in the API response —
 * see config.passwordResetReturnLink). Swap this for an email/SMS integration.
 */
async function deliverPasswordReset(user: User, link: string): Promise<void> {
  logger.info(
    `Password reset requested for "${user.username}" <${user.email}>. Reset link: ${link}`
  );
}

/**
 * Record a failed login. Increments the consecutive-failure counter and, once it
 * reaches the configured threshold, sets a temporary lock window. Best-effort:
 * if the lockout columns aren't present yet (migration not run), it no-ops
 * rather than blocking login.
 */
async function recordFailedLogin(userId: string, currentAttempts: number): Promise<void> {
  const attempts = currentAttempts + 1;
  const lock = attempts >= config.loginMaxAttempts;
  try {
    await db.none(
      `UPDATE users
       SET failed_login_attempts = $1,
           locked_until = CASE WHEN $2 THEN NOW() + ($3 || ' minutes')::interval ELSE locked_until END
       WHERE id = $4`,
      [lock ? 0 : attempts, lock, String(config.loginLockoutMinutes), userId]
    );
  } catch (error) {
    if ((error as { code?: string })?.code !== '42703') throw error;
  }
}

/** Clear failure state after a successful login. Best-effort (see above). */
async function clearFailedLogins(userId: string): Promise<void> {
  try {
    await db.none(
      'UPDATE users SET failed_login_attempts = 0, locked_until = NULL WHERE id = $1',
      [userId]
    );
  } catch (error) {
    if ((error as { code?: string })?.code !== '42703') throw error;
  }
}

// Login
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body as LoginRequest;

    if (!username || !password) {
      res.status(400).json({ error: 'Username and password required' });
      return;
    }

    const user = await db.oneOrNone<User & { failed_login_attempts?: number; locked_until?: string | null }>(
      'SELECT * FROM users WHERE username = $1',
      [username]
    );

    if (!user) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    // Reject early if the account is currently locked from prior failures.
    if (user.locked_until && new Date(user.locked_until).getTime() > Date.now()) {
      res.status(429).json({ error: 'Too many failed attempts. Try again later.' });
      return;
    }

    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      await recordFailedLogin(user.id, user.failed_login_attempts ?? 0);
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    if (user.is_active === false) {
      res.status(403).json({ error: 'Account disabled. Contact an administrator.' });
      return;
    }

    // Successful login — clear any accumulated failure state.
    await clearFailedLogins(user.id);

    const token = signAccessToken(user);
    const refreshToken = await issueRefreshToken(user.id);

    const response: LoginResponse = {
      token,
      refresh_token: refreshToken,
      user: publicUser(user),
    };

    res.json(response);
  } catch (error) {
    logger.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Get current user
router.get('/me', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const user = await db.one<User>(
      'SELECT id, username, email, display_name, is_admin, created_at FROM users WHERE id = $1',
      [req.user!.id]
    );

    res.json(user);
  } catch (error) {
    logger.error('Get user error:', error);
    res.status(500).json({ error: 'Failed to get user' });
  }
});

// Registration status — open only when no users exist yet (first-run bootstrap).
// Lets the login screen show the "create first admin" form instead of a sign-in.
router.get('/registration-status', async (_req, res) => {
  try {
    const userCount = await db.one<{ count: string }>('SELECT COUNT(*) as count FROM users');
    res.json({ open: parseInt(userCount.count, 10) === 0 });
  } catch (error) {
    logger.error('Registration status error:', error);
    res.status(500).json({ error: 'Failed to get registration status' });
  }
});

// Register (only if no users exist - for initial setup)
router.post('/register', async (req, res) => {
  try {
    const userCount = await db.one<{ count: number }>(
      'SELECT COUNT(*) as count FROM users'
    );

    if (userCount.count > 0) {
      res.status(403).json({ error: 'Registration disabled' });
      return;
    }

    const { username, email, password, display_name } = req.body;

    if (!username || !email || !password) {
      res.status(400).json({ error: 'Username, email, and password required' });
      return;
    }

    const passwordHash = await bcrypt.hash(password, config.bcryptRounds);

    const user = await db.one<User>(
      `INSERT INTO users (username, email, password_hash, display_name, is_admin)
       VALUES ($1, $2, $3, $4, true)
       RETURNING id, username, email, display_name, is_admin`,
      [username, email, passwordHash, display_name || username]
    );

    const token = signAccessToken(user);
    const refreshToken = await issueRefreshToken(user.id);

    res.json({
      token,
      refresh_token: refreshToken,
      user: publicUser(user),
    });
  } catch (error) {
    logger.error('Registration error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// Exchange a valid refresh token for a fresh access token, rotating the refresh
// token (the presented one is revoked and a new one issued) so a leaked token
// has a limited window and reuse is detectable as an expired/revoked token.
router.post('/refresh', async (req, res) => {
  try {
    const { refresh_token: refreshToken } = req.body ?? {};
    if (!refreshToken) {
      res.status(400).json({ error: 'Refresh token required' });
      return;
    }

    const row = await db.oneOrNone<{ id: string; user_id: string; expires_at: string; revoked_at: string | null }>(
      'SELECT id, user_id, expires_at, revoked_at FROM refresh_tokens WHERE token_hash = $1',
      [hashToken(refreshToken)]
    );

    if (!row || row.revoked_at || new Date(row.expires_at).getTime() < Date.now()) {
      res.status(401).json({ error: 'Invalid or expired refresh token' });
      return;
    }

    const user = await db.oneOrNone<User>('SELECT * FROM users WHERE id = $1', [row.user_id]);
    if (!user) {
      res.status(401).json({ error: 'Invalid refresh token' });
      return;
    }
    if (user.is_active === false) {
      res.status(403).json({ error: 'Account disabled' });
      return;
    }

    // Rotate: revoke the presented token and mint a new one.
    await db.none('UPDATE refresh_tokens SET revoked_at = NOW() WHERE id = $1', [row.id]);
    const token = signAccessToken(user);
    const newRefresh = await issueRefreshToken(user.id);

    res.json({ token, refresh_token: newRefresh, user: publicUser(user) });
  } catch (error) {
    logger.error('Token refresh error:', error);
    res.status(500).json({ error: 'Token refresh failed' });
  }
});

// Revoke a refresh token (sign-out). Best-effort and idempotent — always 200 so
// the client can clear its session regardless.
router.post('/logout', async (req, res) => {
  try {
    const { refresh_token: refreshToken } = req.body ?? {};
    if (refreshToken) {
      await db.none(
        'UPDATE refresh_tokens SET revoked_at = NOW() WHERE token_hash = $1 AND revoked_at IS NULL',
        [hashToken(refreshToken)]
      );
    }
    res.json({ message: 'Logged out' });
  } catch (error) {
    logger.error('Logout error:', error);
    res.status(500).json({ error: 'Logout failed' });
  }
});

// Begin a self-service password reset. Accepts a username or email and always
// responds the same way so it can't be used to probe which accounts exist.
router.post('/forgot-password', async (req, res) => {
  try {
    const { identifier } = req.body ?? {};
    if (!identifier) {
      res.status(400).json({ error: 'Username or email required' });
      return;
    }

    // Generic response regardless of whether the account exists.
    const generic = {
      message: 'If an account matches, a password reset link has been generated.',
    };

    const user = await db.oneOrNone<User>(
      'SELECT * FROM users WHERE username = $1 OR email = $1',
      [identifier]
    );
    if (!user) {
      res.json(generic);
      return;
    }

    const raw = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + config.passwordResetTtlMinutes * 60_000);
    await db.none(
      'INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
      [user.id, hashToken(raw), expiresAt]
    );

    const link = `${config.appBaseUrl}/reset-password?token=${raw}`;
    await deliverPasswordReset(user, link);

    // Optionally surface the token/link for headless/no-email deployments.
    res.json(
      config.passwordResetReturnLink ? { ...generic, reset_token: raw, reset_link: link } : generic
    );
  } catch (error) {
    logger.error('Forgot-password error:', error);
    res.status(500).json({ error: 'Could not process request' });
  }
});

// Complete a password reset with a valid, unused, unexpired token. On success
// the token is consumed and all of the user's refresh tokens are revoked.
router.post('/reset-password', async (req, res) => {
  try {
    const { token, password } = req.body ?? {};
    if (!token || !password) {
      res.status(400).json({ error: 'Token and new password required' });
      return;
    }
    if (String(password).length < 8) {
      res.status(400).json({ error: 'Password must be at least 8 characters' });
      return;
    }

    const row = await db.oneOrNone<{ id: string; user_id: string; expires_at: string; used_at: string | null }>(
      'SELECT id, user_id, expires_at, used_at FROM password_reset_tokens WHERE token_hash = $1',
      [hashToken(token)]
    );
    if (!row || row.used_at || new Date(row.expires_at).getTime() < Date.now()) {
      res.status(400).json({ error: 'Invalid or expired reset token' });
      return;
    }

    const passwordHash = await bcrypt.hash(password, config.bcryptRounds);
    await db.none('UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2', [
      passwordHash,
      row.user_id,
    ]);
    await db.none('UPDATE password_reset_tokens SET used_at = NOW() WHERE id = $1', [row.id]);
    // Invalidate existing sessions after a credential change.
    await db.none(
      'UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL',
      [row.user_id]
    );

    res.json({ message: 'Password updated. You can now sign in.' });
  } catch (error) {
    logger.error('Reset-password error:', error);
    res.status(500).json({ error: 'Could not reset password' });
  }
});

export default router;
