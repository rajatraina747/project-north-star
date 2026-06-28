import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import { config } from '../utils/config';
import { logger } from '../utils/logger';
import db from '../db';
import { User } from '../types';

export interface AuthRequest extends Request {
  user?: {
    id: string;
    username: string;
    is_admin: boolean;
  };
}

// Cached knowledge of whether the users.is_active column exists yet. It's added
// by the Wave 3 migration; until that runs, the column-referencing auth queries
// would throw and lock everyone out. We detect the missing column once (Postgres
// error 42703 = undefined_column), warn, and thereafter treat accounts as active
// so a forgotten migration degrades gracefully instead of breaking all auth.
let usersHaveIsActiveColumn: boolean | null = null;

type AuthUser = { id: string; username: string; is_admin: boolean; is_active: boolean };

async function selectAuthUserById(id: string): Promise<AuthUser | null> {
  if (usersHaveIsActiveColumn !== false) {
    try {
      const u = await db.oneOrNone<AuthUser>(
        'SELECT id, username, is_admin, is_active FROM users WHERE id = $1',
        [id]
      );
      usersHaveIsActiveColumn = true;
      return u;
    } catch (err) {
      if ((err as { code?: string })?.code !== '42703') throw err;
      usersHaveIsActiveColumn = false;
      logger.warn(
        'users.is_active column is missing — run database migrations (npm run migrate). ' +
          'Treating all accounts as active until then.'
      );
    }
  }
  const u = await db.oneOrNone<Omit<AuthUser, 'is_active'>>(
    'SELECT id, username, is_admin FROM users WHERE id = $1',
    [id]
  );
  return u ? { ...u, is_active: true } : null;
}

export async function authenticateToken(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const decoded = jwt.verify(token, config.jwtSecret) as {
      id: string;
      username: string;
      is_admin: boolean;
    };

    // Verify user still exists and is still active (so disabling an account
    // immediately invalidates any tokens it already holds).
    const user = await selectAuthUserById(decoded.id);

    if (!user) {
      res.status(401).json({ error: 'Invalid token' });
      return;
    }

    if (user.is_active === false) {
      res.status(403).json({ error: 'Account disabled' });
      return;
    }

    req.user = {
      id: user.id,
      username: user.username,
      is_admin: user.is_admin,
    };

    next();
  } catch (error) {
    logger.error('Authentication error:', error);
    res.status(403).json({ error: 'Invalid or expired token' });
  }
}

/**
 * Authenticate OPDS clients. OPDS readers (KOReader, Marvin, Moon+ Reader, …)
 * send HTTP Basic credentials, so we bridge those to the existing user model by
 * verifying username/password with bcrypt — the same check as POST /auth/login.
 * A Bearer token is also accepted so the catalog can be opened in a browser.
 * On failure we send WWW-Authenticate so clients prompt for credentials.
 */
export async function authenticateOpds(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers['authorization'] || '';

  const fail = () => {
    res.setHeader('WWW-Authenticate', 'Basic realm="North Star OPDS", charset="UTF-8"');
    res.status(401).json({ error: 'Authentication required' });
  };

  try {
    if (authHeader.startsWith('Basic ')) {
      const decoded = Buffer.from(authHeader.slice(6), 'base64').toString('utf-8');
      const sep = decoded.indexOf(':');
      if (sep === -1) {
        fail();
        return;
      }
      const username = decoded.slice(0, sep);
      const password = decoded.slice(sep + 1);

      const user = await db.oneOrNone<User>('SELECT * FROM users WHERE username = $1', [username]);
      if (!user || user.is_active === false || !(await bcrypt.compare(password, user.password_hash))) {
        fail();
        return;
      }
      req.user = { id: user.id, username: user.username, is_admin: user.is_admin };
      next();
      return;
    }

    if (authHeader.startsWith('Bearer ')) {
      const token = authHeader.slice(7);
      const decoded = jwt.verify(token, config.jwtSecret) as { id: string; username: string; is_admin: boolean };
      const user = await selectAuthUserById(decoded.id);
      if (!user || user.is_active === false) {
        fail();
        return;
      }
      req.user = { id: user.id, username: user.username, is_admin: user.is_admin };
      next();
      return;
    }

    fail();
  } catch (error) {
    logger.error('OPDS auth error:', error);
    fail();
  }
}

export function requireAdmin(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): void {
  if (!req.user?.is_admin) {
    res.status(403).json({ error: 'Admin access required' });
    return;
  }
  next();
}
