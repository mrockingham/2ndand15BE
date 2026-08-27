import { describe, expect, it, vi } from 'vitest';

import type { AppError } from '../../common/errors/app-error.js';
import type { DataHealthProbeResult } from './data-health-probe.service.js';
import { DataHealthService } from './data-health.service.js';
import type { DataHealthRepository } from './data-health.repository.js';

function repository(overrides: Partial<DataHealthRepository> = {}): DataHealthRepository {
  return {
    listGames: vi
      .fn()
      .mockResolvedValue({ games: [], activePlayCounts: new Map(), nextCursor: null }),
    getGame: vi.fn().mockResolvedValue(null),
    listProbes: vi.fn().mockResolvedValue([]),
    saveProbe: vi.fn().mockResolvedValue(undefined),
    countActivePlays: vi.fn().mockResolvedValue(0),
    getProbeGameContext: vi.fn().mockResolvedValue(null),
    ...overrides,
  };
}

describe('DataHealthService', () => {
  it('rejects runProbe with a clean 500 when no probe service is configured', async () => {
    const service = new DataHealthService(repository());
    await expect(service.runProbe('game-1')).rejects.toMatchObject({
      code: 'GAME_DATA_HEALTH_PROBE_UNCONFIGURED',
      statusCode: 500,
    } satisfies Partial<AppError>);
  });

  it('delegates runProbe to the configured probe service', async () => {
    const probeResult = { gameId: 'game-1' } as unknown as DataHealthProbeResult;
    const probeService = { probe: vi.fn().mockResolvedValue(probeResult) };
    const service = new DataHealthService(
      repository(),
      probeService as unknown as ConstructorParameters<typeof DataHealthService>[1],
    );
    await expect(service.runProbe('game-1')).resolves.toBe(probeResult);
    expect(probeService.probe).toHaveBeenCalledWith('game-1');
  });

  it('throws a 404 AppError from getGame when the repository finds nothing', async () => {
    const service = new DataHealthService(repository({ getGame: vi.fn().mockResolvedValue(null) }));
    await expect(service.getGame('missing')).rejects.toMatchObject({
      code: 'GAME_NOT_FOUND',
      statusCode: 404,
    });
  });

  it('filters listGames results to issues only when requested, but keeps the full summary', async () => {
    const repo = repository({
      listGames: vi.fn().mockResolvedValue({
        games: [
          {
            id: 'complete-game',
            season: 2026,
            seasonType: 'REG',
            week: 1,
            status: 'FINAL',
            startTime: new Date(),
            homeTeamId: 'home',
            awayTeamId: 'away',
            homeScore: 24,
            awayScore: 17,
            homeTeam: { abbreviation: 'AAA', fullName: 'Team A' },
            awayTeam: { abbreviation: 'BBB', fullName: 'Team B' },
            editorialOverride: null,
            providerMaps: [{ id: 'map-1' }],
            currentTeamStats: [],
            currentPlayerCoverage: null,
            pollState: null,
            dataHealthProbes: [],
            _count: { currentPlayerStats: 0 },
          },
        ],
        activePlayCounts: new Map(),
        nextCursor: null,
      }),
    });
    const service = new DataHealthService(repo);
    const result = await service.listGames({ limit: 50, issuesOnly: true });
    expect(result.summary.games).toBe(1);
    expect(result.games).toHaveLength(1);
    expect(result.games[0]?.needsInvestigation).toBe(true);
  });
});
