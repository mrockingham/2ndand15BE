import { describe, expect, it, vi } from 'vitest';
import type { AppError } from '../../common/errors/app-error.js';
import type { GameRepository } from './game.repository.js';
import { GameService } from './game.service.js';
import { createGameRecord } from './game.test-fixtures.js';

function createRepository(overrides: Partial<GameRepository> = {}): GameRepository {
  return {
    findGames: () => Promise.resolve({ games: [], nextCursor: null }),
    findGameById: () => Promise.resolve(null),
    activeTeamExists: () => Promise.resolve(true),
    ...overrides,
  };
}
describe('GameService', () => {
  it('uses the current season with a seven-day recent and fourteen-day upcoming window by default', async () => {
    const findGames = vi
      .fn<GameRepository['findGames']>()
      .mockResolvedValue({ games: [], nextCursor: null });
    const now = new Date('2026-07-31T12:00:00.000Z');
    const result = await new GameService(createRepository({ findGames }), () => now, {
      currentNflSeason: 2026,
      allowHistoricalDefaultGameResults: false,
    }).listGames({ limit: 20 });
    expect(result).toEqual({ games: [], nextCursor: null });
    expect(findGames).toHaveBeenCalledWith(
      expect.objectContaining({
        season: 2026,
        startTime: new Date('2026-07-24T12:00:00.000Z'),
        endTime: new Date('2026-08-14T12:00:00.000Z'),
        limit: 20,
      }),
    );
  });
  it('keeps a recent final with a null special-event week eligible for the default list', async () => {
    const hallOfFameGame = createGameRecord({
      seasonType: 'PRE',
      week: null,
      startTime: new Date('2026-08-07T00:00:00.000Z'),
      status: 'FINAL',
      homeScore: 30,
      awayScore: 33,
    });
    const findGames = vi
      .fn<GameRepository['findGames']>()
      .mockResolvedValue({ games: [hallOfFameGame], nextCursor: null });

    const result = await new GameService(
      createRepository({ findGames }),
      () => new Date('2026-08-09T12:00:00.000Z'),
      {
        currentNflSeason: 2026,
        allowHistoricalDefaultGameResults: false,
      },
    ).listGames({ limit: 20 });

    expect(findGames).toHaveBeenCalledWith(
      expect.objectContaining({
        season: 2026,
        startTime: new Date('2026-08-02T12:00:00.000Z'),
        endTime: new Date('2026-08-23T12:00:00.000Z'),
      }),
    );
    expect(result.games[0]).toMatchObject({
      seasonType: 'PRE',
      week: null,
      status: 'FINAL',
      homeScore: 30,
      awayScore: 33,
    });
  });
  it('preserves an explicitly requested historical season', async () => {
    const findGames = vi
      .fn<GameRepository['findGames']>()
      .mockResolvedValue({ games: [createGameRecord({ season: 2024 })], nextCursor: null });
    const result = await new GameService(createRepository({ findGames }), () => new Date(), {
      currentNflSeason: 2026,
      allowHistoricalDefaultGameResults: false,
    }).listGames({ season: 2024, limit: 20 });
    expect(findGames).toHaveBeenCalledWith(expect.objectContaining({ season: 2024 }));
    expect(result.games[0]?.season).toBe(2024);
  });
  it('allows the legacy unbound default only when explicitly enabled', async () => {
    const findGames = vi
      .fn<GameRepository['findGames']>()
      .mockResolvedValue({ games: [], nextCursor: null });
    await new GameService(createRepository({ findGames }), () => new Date(), {
      currentNflSeason: 2026,
      allowHistoricalDefaultGameResults: true,
    }).listGames({ limit: 20 });
    expect(findGames).toHaveBeenCalledWith(expect.not.objectContaining({ season: 2026 }));
  });
  it('passes explicit season, type, week, team, status, and pagination filters', async () => {
    const findGames = vi
      .fn<GameRepository['findGames']>()
      .mockResolvedValue({ games: [], nextCursor: null });
    await new GameService(createRepository({ findGames })).listGames({
      season: 2026,
      seasonType: 'REG',
      week: 1,
      teamId: '00000000-0000-4000-8000-000000000001',
      status: 'FINAL',
      limit: 5,
      cursor: '00000000-0000-4000-8000-000000000101',
    });
    expect(findGames).toHaveBeenCalledWith(
      expect.objectContaining({
        season: 2026,
        seasonType: 'REG',
        week: 1,
        teamId: '00000000-0000-4000-8000-000000000001',
        status: 'FINAL',
        limit: 5,
      }),
    );
  });
  it('returns completed scores and explicit scheduled nulls without provider metadata', async () => {
    const final = createGameRecord({
      status: 'FINAL',
      homeScore: 27,
      awayScore: 20,
      quarter: 4,
      clock: '00:00',
    });
    const service = new GameService(
      createRepository({ findGameById: () => Promise.resolve(final) }),
    );
    const dto = await service.getGame(final.id);
    expect(dto).toMatchObject({ homeScore: 27, awayScore: 20, homeTeam: { abbreviation: 'BUF' } });
    expect(dto).not.toHaveProperty('providerMaps');
    expect(dto.homeTeam).not.toHaveProperty('providerMaps');
    const scheduled = createGameRecord();
    const scheduledDto = await new GameService(
      createRepository({ findGameById: () => Promise.resolve(scheduled) }),
    ).getGame(scheduled.id);
    expect(scheduledDto.homeScore).toBeNull();
    expect(scheduledDto.awayScore).toBeNull();
  });
  it('rejects unknown games and teams', async () => {
    const service = new GameService(
      createRepository({ activeTeamExists: () => Promise.resolve(false) }),
    );
    await expect(service.getGame('00000000-0000-4000-8000-000000000999')).rejects.toEqual(
      expect.objectContaining<Partial<AppError>>({ code: 'GAME_NOT_FOUND', statusCode: 404 }),
    );
    await expect(
      service.listTeamGames('00000000-0000-4000-8000-000000000999', { limit: 20 }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<AppError>>({ code: 'TEAM_NOT_FOUND', statusCode: 404 }),
    );
    await expect(
      service.listGames({
        teamId: '00000000-0000-4000-8000-000000000999',
        limit: 20,
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<AppError>>({ code: 'TEAM_NOT_FOUND', statusCode: 404 }),
    );
  });
});
