import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { AppError } from '../../common/errors/app-error.js';
import { errorHandler } from '../../common/middleware/error-handler.js';
import { createPlayerRouter } from './player.routes.js';
import type { PlayerReader } from './player.service.js';

function app(reader: PlayerReader) {
  const instance = express();
  instance.use('/players', createPlayerRouter(reader));
  instance.use(errorHandler);
  return instance;
}

describe('player routes', () => {
  it('returns a bounded public page without external identifiers or import metadata', async () => {
    const listPlayers = vi.fn().mockResolvedValue({
      data: [{ id: 'player-id', displayName: 'Test Player' }],
      meta: { nextCursor: null, attribution: { source: 'nflverse', license: 'CC BY 4.0' } },
    });
    const reader: PlayerReader = {
      listPlayers,
      getPlayer: vi.fn(),
      getPlayerStats: vi.fn(),
      getPlayerSeasons: vi.fn(),
    };
    const response = await request(app(reader)).get('/players?limit=10&search=Test').expect(200);
    expect(response.body).not.toHaveProperty('providerIds');
    expect(JSON.stringify(response.body)).not.toContain('checksum');
    expect(listPlayers).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 10, search: 'Test' }),
    );
  });
  it('rejects malformed UUID path parameters before calling the reader', async () => {
    const getPlayer = vi.fn();
    const reader: PlayerReader = {
      listPlayers: vi.fn(),
      getPlayer,
      getPlayerStats: vi.fn(),
      getPlayerSeasons: vi.fn(),
    };
    await request(app(reader)).get('/players/not-a-uuid').expect(400);
    expect(getPlayer).not.toHaveBeenCalled();
  });

  it('validates stat filters and returns a bounded attributed page', async () => {
    const playerId = '00000000-0000-4000-8000-000000000001';
    const getPlayerStats = vi.fn().mockResolvedValue({
      data: [{ id: 'stat-id', gameId: 'game-id' }],
      meta: { nextCursor: null, attribution: { source: 'nflverse', license: 'CC BY 4.0' } },
    });
    const reader: PlayerReader = {
      listPlayers: vi.fn(),
      getPlayer: vi.fn(),
      getPlayerStats,
      getPlayerSeasons: vi.fn(),
    };
    const response = await request(app(reader))
      .get(`/players/${playerId}/stats?season=2025&week=1&limit=5`)
      .expect(200);
    expect(response.body).toMatchObject({
      meta: { attribution: { license: 'CC BY 4.0' } },
    });
    expect(getPlayerStats).toHaveBeenCalledWith(
      playerId,
      expect.objectContaining({ season: 2025, week: 1, limit: 5 }),
    );
    await request(app(reader)).get(`/players/${playerId}/stats?week=0`).expect(400);
  });

  it('uses the stable player not-found error contract', async () => {
    const playerId = '00000000-0000-4000-8000-000000000001';
    const reader: PlayerReader = {
      listPlayers: vi.fn(),
      getPlayer: vi.fn().mockRejectedValue(
        new AppError({
          code: 'PLAYER_NOT_FOUND',
          message: 'The requested player was not found.',
          statusCode: 404,
        }),
      ),
      getPlayerStats: vi.fn(),
      getPlayerSeasons: vi.fn(),
    };
    const response = await request(app(reader)).get(`/players/${playerId}`).expect(404);
    expect(response.body).toMatchObject({ error: { code: 'PLAYER_NOT_FOUND' } });
  });
});
