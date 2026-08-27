import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { errorHandler } from '../../common/middleware/error-handler.js';
import { createStatsHubRouter } from './stats.routes.js';
import type { StatsHubReader } from './stats.service.js';

const playerId = '00000000-0000-4000-8000-000000000001';

function app(reader: StatsHubReader) {
  const instance = express();
  instance.use('/stats', createStatsHubRouter(reader));
  instance.use(errorHandler);
  return instance;
}

function reader(overrides: Partial<StatsHubReader> = {}): StatsHubReader {
  return {
    getMetadata: vi.fn().mockResolvedValue({ data: {}, meta: {} }),
    getSeasonLeaders: vi.fn().mockResolvedValue({ data: [], meta: {} }),
    getWeeklyLeaders: vi.fn().mockResolvedValue({ data: [], meta: {} }),
    getRecentPerformance: vi.fn().mockResolvedValue({ data: {}, meta: {} }),
    ...overrides,
  };
}

describe('Stats Hub routes', () => {
  it('serves cacheable metadata', async () => {
    const response = await request(app(reader())).get('/stats/metadata').expect(200);
    expect(response.headers['cache-control']).toContain('max-age=86400');
  });

  it('applies season leaderboard defaults and validates bounds', async () => {
    const getSeasonLeaders = vi.fn().mockResolvedValue({ data: [], meta: {} });
    await request(app(reader({ getSeasonLeaders })))
      .get('/stats/leaders?season=2025&metric=passing_yards')
      .expect(200);
    expect(getSeasonLeaders).toHaveBeenCalledWith({
      season: 2025,
      metric: 'passing_yards',
      seasonType: 'REG',
      limit: 25,
    });
    await request(app(reader())).get('/stats/leaders?season=2025&metric=x&limit=101').expect(400);
  });

  it('requires weekly season, week, and metric and rejects combined season type', async () => {
    await request(app(reader()))
      .get('/stats/weekly-leaders?season=2025&week=10&metric=passing_yards')
      .expect(200);
    await request(app(reader()))
      .get('/stats/weekly-leaders?season=2025&metric=passing_yards')
      .expect(400);
    await request(app(reader()))
      .get('/stats/weekly-leaders?season=2025&week=10&metric=passing_yards&seasonType=REG_POST')
      .expect(400);
  });

  it('requires one player and bounds recent games without leaking query internals', async () => {
    const getRecentPerformance = vi.fn().mockResolvedValue({ data: {}, meta: {} });
    const response = await request(app(reader({ getRecentPerformance })))
      .get(`/stats/recent?playerId=${playerId}&metric=receiving_yards`)
      .expect(200);
    expect(getRecentPerformance).toHaveBeenCalledWith({
      playerId,
      metric: 'receiving_yards',
      games: 5,
    });
    expect(JSON.stringify(response.body)).not.toMatch(/checksum|externalId|sourceRowHash|filePath/);
    await request(app(reader())).get('/stats/recent?metric=receiving_yards').expect(400);
    await request(app(reader()))
      .get(`/stats/recent?playerId=${playerId}&metric=receiving_yards&games=21`)
      .expect(400);
  });
});
