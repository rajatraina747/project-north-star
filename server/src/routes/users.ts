import { Router } from 'express';
import bcrypt from 'bcrypt';
import db from '../db';
import { logger } from '../utils/logger';
import { authenticateToken, requireAdmin, AuthRequest } from '../middleware/auth';
import { User } from '../types';

const router = Router();

// All user-management routes require an authenticated admin.
router.use(authenticateToken);
router.use(requireAdmin);

// Columns safe to return to the client (never the password hash).
const PUBLIC_COLUMNS =
  'id, username, email, display_name, is_admin, is_active, disabled_at, created_at, updated_at';

const BCRYPT_ROUNDS = 10;
const MIN_PASSWORD_LENGTH = 6;

/**
 * Count accounts that can actually log in as admin (admin AND active). Used to
 * guard against locking everyone out by deleting / disabling / demoting the
 * last usable admin. An optional excludeId removes one user from the tally
 * (e.g. the one about to be modified).
 */
async function effectiveAdminCount(excludeId?: string): Promise<number> {
  const row = await db.one<{ count: string }>(
    `SELECT COUNT(*) AS count FROM users
     WHERE is_admin = true AND is_active = true
       AND ($1::uuid IS NULL OR id <> $1)`,
    [excludeId ?? null]
  );
  return parseInt(row.count, 10);
}

// List all users
router.get('/', async (_req: AuthRequest, res) => {
  try {
    const users = await db.manyOrNone(
      `SELECT ${PUBLIC_COLUMNS} FROM users ORDER BY created_at ASC`
    );
    res.json(users || []);
  } catch (error) {
    logger.error('List users error:', error);
    res.status(500).json({ error: 'Failed to list users' });
  }
});

// Create a user
router.post('/', async (req: AuthRequest, res) => {
  try {
    const { username, email, display_name, is_admin, password } = req.body || {};

    if (!username || !email || !password) {
      res.status(400).json({ error: 'username, email and password are required' });
      return;
    }
    if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
      res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` });
      return;
    }

    const existing = await db.oneOrNone(
      'SELECT id FROM users WHERE username = $1 OR email = $2',
      [username, email]
    );
    if (existing) {
      res.status(409).json({ error: 'A user with that username or email already exists' });
      return;
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

    const user = await db.one(
      `INSERT INTO users (username, email, password_hash, display_name, is_admin)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING ${PUBLIC_COLUMNS}`,
      [username, email, passwordHash, display_name || username, is_admin === true]
    );

    res.status(201).json(user);
  } catch (error) {
    logger.error('Create user error:', error);
    res.status(500).json({ error: 'Failed to create user' });
  }
});

// Update a user: display_name, is_admin and is_active are editable here.
router.patch('/:id', async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const { display_name, is_admin, is_active } = req.body || {};

    const target = await db.oneOrNone<User>('SELECT * FROM users WHERE id = $1', [id]);
    if (!target) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    // Guard: don't allow removing the last usable admin (by demotion or by
    // disabling). effectiveAdminCount excludes the target, so 0 means this
    // user is currently the only admin who can log in.
    const wouldRemoveAdmin =
      (is_admin === false && target.is_admin) || (is_active === false && target.is_active);
    if (wouldRemoveAdmin && target.is_admin && target.is_active) {
      if ((await effectiveAdminCount(id)) === 0) {
        res.status(409).json({ error: 'Cannot demote or disable the last active admin' });
        return;
      }
    }

    const fields: string[] = [];
    const values: any[] = [];
    let i = 1;

    if (display_name !== undefined) {
      fields.push(`display_name = $${i++}`);
      values.push(display_name);
    }
    if (is_admin !== undefined) {
      fields.push(`is_admin = $${i++}`);
      values.push(is_admin === true);
    }
    if (is_active !== undefined) {
      fields.push(`is_active = $${i++}`);
      values.push(is_active === true);
      fields.push(`disabled_at = $${i++}`);
      values.push(is_active === true ? null : new Date());
    }

    if (fields.length === 0) {
      res.status(400).json({ error: 'No fields to update' });
      return;
    }

    values.push(id);
    const updated = await db.one(
      `UPDATE users SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP
       WHERE id = $${i} RETURNING ${PUBLIC_COLUMNS}`,
      values
    );

    res.json(updated);
  } catch (error) {
    logger.error('Update user error:', error);
    res.status(500).json({ error: 'Failed to update user' });
  }
});

// Reset a user's password
router.post('/:id/reset-password', async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const { password } = req.body || {};

    if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
      res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` });
      return;
    }

    const target = await db.oneOrNone('SELECT id FROM users WHERE id = $1', [id]);
    if (!target) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    await db.none(
      'UPDATE users SET password_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      [passwordHash, id]
    );

    res.json({ message: 'Password reset' });
  } catch (error) {
    logger.error('Reset password error:', error);
    res.status(500).json({ error: 'Failed to reset password' });
  }
});

// Delete a user
router.delete('/:id', async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;

    const target = await db.oneOrNone<User>('SELECT * FROM users WHERE id = $1', [id]);
    if (!target) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    // Guard against deleting the last usable admin.
    if (target.is_admin && target.is_active && (await effectiveAdminCount(id)) === 0) {
      res.status(409).json({ error: 'Cannot delete the last active admin' });
      return;
    }

    await db.none('DELETE FROM users WHERE id = $1', [id]);
    res.json({ message: 'User deleted' });
  } catch (error) {
    logger.error('Delete user error:', error);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

export default router;
