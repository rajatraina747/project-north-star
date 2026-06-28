import { describe, it, expect, vi, beforeAll } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../utils/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../db', () => {
  const mock = { oneOrNone: vi.fn().mockResolvedValue({ count: '7' }) };
  return { default: mock };
});

import { metricsMiddleware, metricsHandler } from '../utils/metrics';

let app: express.Express;

beforeAll(() => {
  app = express();
  app.use(metricsMiddleware);
  app.get('/ping', (_req, res) => res.json({ ok: true }));
  app.get('/metrics', metricsHandler);
});

describe('GET /metrics', () => {
  it('emits Prometheus text exposition with our metrics', async () => {
    // Generate one request so the HTTP counter has a sample.
    await request(app).get('/ping');

    const res = await request(app).get('/metrics');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/plain/);
    expect(res.text).toContain('northstar_http_requests_total');
    expect(res.text).toContain('northstar_books_total 7');
    expect(res.text).toContain('northstar_users_total 7');
    // Default process metrics are present too.
    expect(res.text).toMatch(/northstar_process_/);
  });

  it('still serves metrics when the gauge query fails', async () => {
    const db = (await import('../db')).default as unknown as { oneOrNone: ReturnType<typeof vi.fn> };
    db.oneOrNone.mockRejectedValueOnce(new Error('db down'));

    const res = await request(app).get('/metrics');

    expect(res.status).toBe(200);
    expect(res.text).toContain('northstar_http_requests_total');
  });
});
