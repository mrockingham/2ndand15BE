import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { errorHandler } from '../../common/middleware/error-handler.js';
import { createTeamHubRouter } from './team-hub.routes.js';
import type { TeamHubReader } from './team-hub.service.js';

const teamId = '00000000-0000-4000-8000-000000000001';

function app(reader: TeamHubReader) {
  const instance = express();
  instance.use('/teams/:teamId', createTeamHubRouter(reader));
  instance.use(errorHandler);
  return instance;
}

function reader(overrides: Partial<TeamHubReader> = {}): TeamHubReader {
  return {
    getOverview: vi.fn().mockResolvedValue({ data: {}, meta: {} }),
    getRoster: vi.fn().mockResolvedValue({ data: {}, meta: {} }),
    getStatLeaders: vi.fn().mockResolvedValue({ data: [], meta: {} }),
    ...overrides,
  };
}

describe('Team Hub routes', () => {
  it('returns the overview with a moderate public cache policy', async () => {
    const getOverview = vi.fn().mockResolvedValue({ data: {}, meta: {} });
    const response = await request(app(reader({ getOverview })))
      .get(`/teams/${teamId}/hub`)
      .expect(200);
    expect(getOverview).toHaveBeenCalledWith(teamId);
    expect(response.headers['cache-control']).toContain('max-age=300');
  });

  it('requires a historical roster season and applies bounded defaults', async () => {
    const getRoster = vi.fn().mockResolvedValue({ data: {}, meta: {} });
    const response = await request(app(reader({ getRoster })))
      .get(`/teams/${teamId}/roster?season=2025&position=wr&search=Brown`)
      .expect(200);
    expect(getRoster).toHaveBeenCalledWith(teamId, {
      season: 2025,
      position: 'WR',
      search: 'Brown',
      limit: 25,
    });
    expect(response.headers['cache-control']).toContain('max-age=86400');
    await request(app(reader())).get(`/teams/${teamId}/roster`).expect(400);
    await request(app(reader())).get(`/teams/${teamId}/roster?season=2025&search=x`).expect(400);
    await request(app(reader())).get(`/teams/${teamId}/roster?season=2025&limit=101`).expect(400);
  });

  it('uses the Stats Hub leader contract without accepting a query team override', async () => {
    const getStatLeaders = vi.fn().mockResolvedValue({ data: [], meta: {} });
    const response = await request(app(reader({ getStatLeaders })))
      .get(`/teams/${teamId}/stat-leaders?season=2025&metric=receiving_yards&seasonType=REG_POST`)
      .expect(200);
    expect(getStatLeaders).toHaveBeenCalledWith(teamId, {
      season: 2025,
      metric: 'receiving_yards',
      seasonType: 'REG_POST',
      limit: 25,
    });
    expect(response.headers['cache-control']).toContain('max-age=21600');
    await request(app(reader())).get(`/teams/${teamId}/stat-leaders?season=2025`).expect(400);
  });

  it('rejects malformed internal team identifiers before calling the service', async () => {
    const getOverview = vi.fn().mockResolvedValue({});
    await request(app(reader({ getOverview })))
      .get('/teams/not-a-uuid/hub')
      .expect(400);
    expect(getOverview).not.toHaveBeenCalled();
  });
});
