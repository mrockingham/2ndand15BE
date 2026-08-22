import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { AppError } from '../../common/errors/app-error.js';
import { errorHandler } from '../../common/middleware/error-handler.js';
import { createGameStatsRouter } from './game-stats.routes.js';
import type { GameStatsReader } from './game-stats.service.js';

const gameId = '0768c441-16a6-457c-b50f-e7273d750d77';

function app(reader: GameStatsReader) {
  const instance = express();
  instance.use('/games', createGameStatsRouter(reader));
  instance.use(errorHandler);
  return instance;
}

const listCurrentGameStats = vi.fn().mockResolvedValue({
  data: { season: 2026, seasonType: 'PRE', week: 1, games: [] },
  meta: {
    availableSeasons: [2026],
    availableSeasonTypes: ['PRE'],
    availableWeeks: [1, 2],
    coverageNote: 'Coverage varies.',
  },
});

describe('game stats routes', () => {
  it('returns the public box score without provider or unresolved-player metadata', async () => {
    const getGameStats = vi.fn().mockResolvedValue({
      data: { gameId, teamStats: { home: { teamId: 'home' }, away: { teamId: 'away' } } },
      meta: { playerStatsAvailable: false, limitations: ['Identity mapping required.'] },
    });
    const response = await request(app({ getGameStats, listCurrentGameStats }))
      .get(`/games/${gameId}/stats`)
      .expect(200);
    expect(getGameStats).toHaveBeenCalledWith(gameId);
    expect(response.body).toMatchObject({ data: { gameId } });
    expect(JSON.stringify(response.body)).not.toMatch(
      /highlightly|providerGameId|providerPlayerId|externalId|rawPayload|sourceProvider/,
    );
  });

  it('validates the game UUID and preserves not-found errors', async () => {
    await request(app({ getGameStats: vi.fn(), listCurrentGameStats }))
      .get('/games/nope/stats')
      .expect(400);
    const reader: GameStatsReader = {
      listCurrentGameStats,
      getGameStats: () =>
        Promise.reject(
          new AppError({ code: 'GAME_STATS_NOT_FOUND', message: 'Not found.', statusCode: 404 }),
        ),
    };
    await request(app(reader)).get(`/games/${gameId}/stats`).expect(404);
  });

  it('returns the bounded current-season collection and validates filters', async () => {
    const getGameStats = vi.fn();
    const response = await request(app({ getGameStats, listCurrentGameStats }))
      .get('/games/current-stats?season=2026&seasonType=PRE&week=1')
      .expect(200);
    expect(response.headers['cache-control']).toBe(
      'public, max-age=300, stale-while-revalidate=900',
    );
    expect((response.body as { data: unknown }).data).toMatchObject({
      season: 2026,
      seasonType: 'PRE',
      week: 1,
    });
    expect(listCurrentGameStats).toHaveBeenCalledWith({ season: 2026, seasonType: 'PRE', week: 1 });
    await request(app({ getGameStats, listCurrentGameStats }))
      .get('/games/current-stats?week=nope')
      .expect(400);
  });
});
