import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import { config, validateConfig } from './utils/config';
import { logger } from './utils/logger';
import { testConnection } from './db';
import authRoutes from './routes/auth';
import booksRoutes from './routes/books';
import libraryRoutes from './routes/library';
import progressRoutes from './routes/progress';
import searchRoutes from './routes/search';
import adminRoutes from './routes/admin';

async function startServer() {
  try {
    // Validate configuration
    validateConfig();

    // Test database connection
    const dbConnected = await testConnection();
    if (!dbConnected) {
      throw new Error('Failed to connect to database');
    }

    const app = express();

    // Security middleware
    app.use(helmet({
      contentSecurityPolicy: false, // Allow inline scripts for reader
    }));

    // CORS
    app.use(cors({
      origin: process.env.CORS_ORIGIN || '*',
      credentials: true,
    }));

    // Body parsing
    app.use(express.json({ limit: '10mb' }));
    app.use(express.urlencoded({ extended: true, limit: '10mb' }));

    // Compression
    app.use(compression());

    // Request logging
    app.use((req, res, next) => {
      logger.info(`${req.method} ${req.path}`);
      next();
    });

    // Health check
    app.get('/health', (req, res) => {
      res.json({ status: 'ok', timestamp: new Date().toISOString() });
    });

    // API Routes
    app.use('/api/auth', authRoutes);
    app.use('/api/books', booksRoutes);
    app.use('/api/library', libraryRoutes);
    app.use('/api/progress', progressRoutes);
    app.use('/api/search', searchRoutes);
    app.use('/api/admin', adminRoutes);

    // Error handler
    app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
      logger.error('Error:', err);
      res.status(err.status || 500).json({
        error: err.message || 'Internal server error',
      });
    });

    // 404 handler
    app.use((req, res) => {
      res.status(404).json({ error: 'Not found' });
    });

    app.listen(config.port, () => {
      logger.info(`North Star API server running on port ${config.port}`);
      logger.info(`Environment: ${config.nodeEnv}`);
      logger.info(`Books path: ${config.booksPath}`);
    });
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully...');
  process.exit(0);
});

startServer();
