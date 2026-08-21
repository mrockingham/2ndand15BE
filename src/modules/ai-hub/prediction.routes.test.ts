import express, { type RequestHandler } from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { errorHandler } from '../../common/middleware/error-handler.js';
import type { AdministrativeIdentityReader } from '../admin/admin-authorization.js';
import { createPredictionRouters } from './prediction.routes.js';
import type { PredictionService } from './prediction.service.js';
import type { AiHubWeeklyInsightsService } from './weekly-insights.service.js';

function appFor(role: 'USER' | 'EDITOR' | 'ADMIN' = 'EDITOR') {
  const service = {
    list: vi.fn().mockResolvedValue([]),
    detail: vi.fn().mockRejectedValue(new Error('unused')),
    summary: vi.fn().mockResolvedValue({ count: 0, predictions: [] }),
    performance: vi.fn().mockResolvedValue({ evaluated: 0, accuracy: null }),
    generate: vi.fn().mockResolvedValue({ dryRun: true, count: 1, predictions: [] }),
    publish: vi.fn().mockResolvedValue({ id: 'prediction' }),
    evaluate: vi.fn().mockResolvedValue({ locked: 0, evaluated: 0 }),
  };
  const authenticate: RequestHandler = (req, _res, next) => {
    req.auth = { userId: '00000000-0000-4000-8000-000000000001', sessionId: 'session' };
    next();
  };
  const identities: AdministrativeIdentityReader = {
    findAdministrativeIdentity: vi.fn().mockResolvedValue({
      userId: '00000000-0000-4000-8000-000000000001',
      email: 'editor@example.com',
      role,
    }),
  };
  const routers = createPredictionRouters({
    authenticate,
    identities,
    service: service as unknown as PredictionService,
    weeklyInsightsService: {
      getWeeklyInsights: vi.fn().mockResolvedValue({ context: { predictionCount: 16 } }),
    } as unknown as AiHubWeeklyInsightsService,
  });
  const app = express();
  app.use(express.json());
  app.use('/api/v1/ai-hub', routers.publicRouter);
  app.use('/api/v1/admin/predictions', routers.adminRouter);
  app.use(errorHandler);
  return { app, service };
}

describe('prediction routes', () => {
  it('serves a cached public list without authentication', async () => {
    const { app, service } = appFor();
    const response = await request(app).get(
      '/api/v1/ai-hub/predictions?season=2026&seasonType=PRE',
    );
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toContain('max-age=60');
    expect(service.list).toHaveBeenCalledWith(
      expect.objectContaining({ season: 2026, seasonType: 'PRE' }),
    );
  });
  it('serves validated, cached weekly intelligence without authentication', async () => {
    const { app } = appFor();
    const response = await request(app).get(
      '/api/v1/ai-hub/weekly-insights?season=2026&seasonType=PRE&week=1&top=3&teamId=00000000-0000-4000-8000-000000000002',
    );
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toContain('max-age=300');
    expect(response.body).toEqual({ data: { context: { predictionCount: 16 } } });
  });
  it('requires a bounded weekly intelligence query', async () => {
    const { app } = appFor();
    const response = await request(app).get(
      '/api/v1/ai-hub/weekly-insights?season=2026&seasonType=PRE&week=1&top=6',
    );
    expect(response.status).toBe(400);
    expect(JSON.stringify(response.body)).toContain('VALIDATION_ERROR');
  });
  it('validates admin generation input', async () => {
    const { app, service } = appFor();
    const response = await request(app)
      .post('/api/v1/admin/predictions/generate')
      .send({ dryRun: true });
    expect(response.status).toBe(400);
    const body: unknown = response.body;
    expect(JSON.stringify(body)).toContain('"code":"VALIDATION_ERROR"');
    expect(service.generate).not.toHaveBeenCalled();
  });
  it('allows an editor to run an explicit dry-run', async () => {
    const { app, service } = appFor();
    const response = await request(app)
      .post('/api/v1/admin/predictions/generate')
      .send({ gameId: '00000000-0000-4000-8000-000000000003' });
    expect(response.status).toBe(200);
    expect(service.generate).toHaveBeenCalledWith(
      expect.objectContaining({ dryRun: true, includeAiExplanation: false }),
      expect.objectContaining({ emailSnapshot: 'editor@example.com' }),
    );
  });
  it('rejects an ordinary user from prediction administration', async () => {
    const { app } = appFor('USER');
    const response = await request(app).post('/api/v1/admin/predictions/evaluate');
    expect(response.status).toBe(403);
    const body: unknown = response.body;
    expect(JSON.stringify(body)).toContain('"code":"ADMIN_PERMISSION_REQUIRED"');
  });
});
