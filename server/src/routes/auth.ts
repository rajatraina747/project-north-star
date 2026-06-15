import { Router } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import db from '../db';
import { config } from '../utils/config';
import { logger } from '../utils/logger';
import { User, LoginRequest, LoginResponse } from '../types';
import { authenticateToken, AuthRequest } from '../middleware/auth';

const router = Router();

// Login
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body as LoginRequest;

    if (!username || !password) {
      res.status(400).json({ error: 'Username and password required' });
      return;
    }

    const user = await db.oneOrNone<User>(
      'SELECT * FROM users WHERE username = $1',
      [username]
    );

    if (!user) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    if (user.is_active === false) {
      res.status(403).json({ error: 'Account disabled. Contact an administrator.' });
      return;
    }

    const token = jwt.sign(
      {
        id: user.id,
        username: user.username,
        is_admin: user.is_admin,
      },
      config.jwtSecret,
      { expiresIn: config.jwtExpiresIn } as jwt.SignOptions
    );

    const response: LoginResponse = {
      token,
      user: {
        id: user.id,
        username: user.username,
        display_name: user.display_name,
        is_admin: user.is_admin,
      },
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

    const passwordHash = await bcrypt.hash(password, 10);

    const user = await db.one<User>(
      `INSERT INTO users (username, email, password_hash, display_name, is_admin)
       VALUES ($1, $2, $3, $4, true)
       RETURNING id, username, email, display_name, is_admin`,
      [username, email, passwordHash, display_name || username]
    );

    const token = jwt.sign(
      {
        id: user.id,
        username: user.username,
        is_admin: user.is_admin,
      },
      config.jwtSecret,
      { expiresIn: config.jwtExpiresIn } as jwt.SignOptions
    );

    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        display_name: user.display_name,
        is_admin: user.is_admin,
      },
    });
  } catch (error) {
    logger.error('Registration error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

export default router;
