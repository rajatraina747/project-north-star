import express from 'express';
import client from 'prom-client';
import db from '../db';
import { logger } from './logger';

// Default registry with Node/process metrics (memory, CPU, event loop, GC).
const register = new client.Registry();
client.collectDefaultMetrics({ register, prefix: 'northstar_' });

// HTTP request counter + latency histogram, labelled by method/route/status.
const httpRequestsTotal = new client.Counter({
  name: 'northstar_http_requests_total',
  help: 'Total HTTP requests',
  labelNames: ['method', 'route', 'status'] as const,
  registers: [register],
});

const httpRequestDuration = new client.Histogram({
  name: 'northstar_http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route', 'status'] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [register],
});

// Library-size gauges, refreshed lazily on scrape (cheap COUNT(*) queries).
const booksTotal = new client.Gauge({
  name: 'northstar_books_total',
  help: 'Number of books in the library',
  registers: [register],
});
const usersTotal = new client.Gauge({
  name: 'northstar_users_total',
  help: 'Number of registered users',
  registers: [register],
});

/**
 * Express middleware that records a count + duration for every request. Uses the
 * matched route pattern (e.g. /api/books/:id) as the `route` label so the
 * cardinality stays bounded rather than exploding per book id.
 */
export function metricsMiddleware(req: express.Request, res: express.Response, next: express.NextFunction): void {
  const end = httpRequestDuration.startTimer();
  res.on('finish', () => {
    // req.route is only set once routing matches; fall back to the path prefix.
    const route = (req.baseUrl || '') + (req.route?.path || '') || req.path || 'unknown';
    const labels = { method: req.method, route, status: String(res.statusCode) };
    httpRequestsTotal.inc(labels);
    end(labels);
  });
  next();
}

/** GET /metrics handler in Prometheus text exposition format. */
export async function metricsHandler(_req: express.Request, res: express.Response): Promise<void> {
  try {
    const [books, users] = await Promise.all([
      db.oneOrNone<{ count: string }>('SELECT COUNT(*) AS count FROM books'),
      db.oneOrNone<{ count: string }>('SELECT COUNT(*) AS count FROM users'),
    ]);
    booksTotal.set(Number(books?.count ?? 0));
    usersTotal.set(Number(users?.count ?? 0));
  } catch (error) {
    // Don't fail the scrape if the DB is briefly unavailable — process/HTTP
    // metrics are still useful, and the gauges keep their last value.
    logger.warn('metrics: failed to refresh library gauges:', error);
  }

  res.setHeader('Content-Type', register.contentType);
  res.end(await register.metrics());
}
