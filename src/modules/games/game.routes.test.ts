import pino from 'pino';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import {
  createTestAccessTokenService,
  createTestAuthService,
  createTestConfig,
  createTestTeamReader,
  createTestUserService,
} from '../../../tests/helpers/test-config.js';
import { createApp } from '../../app.js';
import type { GameReader } from './game.service.js';
import { createGameRecord } from './game.test-fixtures.js';
import { toGameDto } from './game.dto.js';

function createReader(overrides: Partial<GameReader> = {}): GameReader {
  return {
    listGames: () => Promise.resolve({ games: [], nextCursor: null }),
    listTeamGames: () => Promise.resolve({ games: [], nextCursor: null }),
    getGame: () => Promise.resolve(toGameDto(createGameRecord())),
    ...overrides,
  };
}
function createGameApp(gameReader: GameReader) {
  return createApp({
    config: createTestConfig(),
    logger: pino({ level: 'silent' }),
    teamReader: createTestTeamReader(),
    gameReader,
    authService: createTestAuthService(),
    userService: createTestUserService(),
    accessTokens: createTestAccessTokenService(),
  });
}
describe('game routes', () => {
  it('lists games with pagination metadata and gets one game publicly', async () => {
    const game = toGameDto(createGameRecord());
    const app = createGameApp(
      createReader({
        listGames: () => Promise.resolve({ games: [game], nextCursor: game.id }),
        getGame: () => Promise.resolve(game),
      }),
    );
    const list = await request(app)
      .get('/api/v1/games?season=2026&seasonType=REG&week=1&limit=1')
      .expect(200);
    expect(list.body).toEqual({ data: [game], meta: { nextCursor: game.id } });
    const single = await request(app).get(`/api/v1/games/${game.id}`).expect(200);
    expect(single.body).toEqual({ data: game });
    expect(JSON.stringify(single.body)).not.toContain('providerMaps');
  });
  it('delegates the team games endpoint', async () => {
    const game = toGameDto(createGameRecord());
    const app = createGameApp(
      createReader({ listTeamGames: () => Promise.resolve({ games: [game], nextCursor: null }) }),
    );
    const response = await request(app)
      .get(`/api/v1/teams/${game.homeTeam.id}/games?status=SCHEDULED`)
      .expect(200);
    expect(response.body).toMatchObject({ data: [game] });
  });
  it.each([
    '/api/v1/games?season=1900',
    '/api/v1/games?week=0',
    '/api/v1/games?status=UNKNOWN',
    '/api/v1/games?limit=0',
    '/api/v1/games?cursor=nope',
    '/api/v1/games?startDate=2026-09-02',
    '/api/v1/games?startDate=2026-09-02&endDate=2026-09-01',
    '/api/v1/games?startDate=2026-01-01&endDate=2026-03-01',
    '/api/v1/games?startDate=2026-99-99&endDate=2026-12-31',
  ])('rejects invalid query parameters: %s', async (path) => {
    const response = await request(createGameApp(createReader())).get(path).expect(400);
    expect(response.body).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
  });
  it('rejects invalid game and team UUIDs', async () => {
    const app = createGameApp(createReader());
    await request(app).get('/api/v1/games/nope').expect(400);
    await request(app).get('/api/v1/teams/nope/games').expect(400);
  });
});
