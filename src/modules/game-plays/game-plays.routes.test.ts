import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { errorHandler } from '../../common/middleware/error-handler.js';
import { createGamePlayRouter } from './game-plays.routes.js';
import type { GamePlayReader } from './game-plays.service.js';

const gameId = '8eea0601-deb8-4a28-891b-0f1fd9b1e3cd';

function app(reader: GamePlayReader) {
  const instance = express();
  instance.use('/games', createGamePlayRouter(reader));
  instance.use(errorHandler);
  return instance;
}

describe('game play routes', () => {
  it('returns ordered normalized plays with cache policy and no provider metadata', async () => {
    const getGamePlays = vi.fn().mockResolvedValue({
      data: { gameId, playCount: 0, plays: [] },
      meta: { limitations: [] },
    });
    const response = await request(app({ getGamePlays })).get(`/games/${gameId}/plays`).expect(200);
    expect(response.headers['cache-control']).toBe(
      'public, max-age=300, stale-while-revalidate=3600',
    );
    expect((response.body as { data: unknown }).data).toEqual({ gameId, playCount: 0, plays: [] });
    expect(JSON.stringify(response.body)).not.toMatch(
      /provider|playKey|reconciliationKey|sourceUpdatedAt/,
    );
  });

  it('rejects an invalid game UUID', async () => {
    await request(app({ getGamePlays: vi.fn() }))
      .get('/games/nope/plays')
      .expect(400);
  });
});
