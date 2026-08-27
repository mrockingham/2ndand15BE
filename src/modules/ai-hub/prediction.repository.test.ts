import type { PrismaClient } from '../../generated/prisma/client.js';
import { describe, expect, it, vi } from 'vitest';
import { PrismaPredictionRepository } from './prediction.repository.js';

describe('PrismaPredictionRepository weekly selection', () => {
  it('selects only reviewed schedule provenance and excludes development fixtures', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = { game: { findMany } } as unknown as PrismaClient;
    const repository = new PrismaPredictionRepository(prisma);

    await repository.findWeeklyGames(2026, 'PRE', 1);

    const firstCall: unknown = findMany.mock.calls[0]?.[0];
    expect(firstCall).toMatchObject({
      where: {
        season: 2026,
        seasonType: 'PRE',
        week: 1,
        provenance: {
          is: {
            sourceType: { in: ['OFFICIAL_WEB', 'MANUAL_IMPORT', 'MANUAL_ENTRY'] },
          },
        },
      },
    });
  });

  it('selects latest public weekly snapshots and excludes retrospective or fixture data', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = { gamePrediction: { findMany } } as unknown as PrismaClient;
    const repository = new PrismaPredictionRepository(prisma);

    await repository.findWeeklyInsightPredictions(2026, 'PRE', 1);

    expect(findMany.mock.calls[0]?.[0]).toMatchObject({
      where: {
        status: { in: ['PUBLISHED', 'LOCKED', 'EVALUATED'] },
        isRetrospective: false,
        game: {
          league: 'NFL',
          season: 2026,
          seasonType: 'PRE',
          week: 1,
          provenance: {
            is: { sourceType: { in: ['OFFICIAL_WEB', 'MANUAL_IMPORT', 'MANUAL_ENTRY'] } },
          },
        },
      },
      take: 80,
    });
  });

  it('keeps model performance on reviewed non-retrospective season data', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = { gamePrediction: { findMany } } as unknown as PrismaClient;
    const repository = new PrismaPredictionRepository(prisma);

    await repository.findWeeklyInsightPerformance(2026, 'PRE');

    expect(findMany.mock.calls[0]?.[0]).toMatchObject({
      where: {
        status: 'EVALUATED',
        isRetrospective: false,
        game: {
          league: 'NFL',
          season: 2026,
          seasonType: 'PRE',
          provenance: {
            is: { sourceType: { in: ['OFFICIAL_WEB', 'MANUAL_IMPORT', 'MANUAL_ENTRY'] } },
          },
        },
      },
      take: 400,
    });
  });
});

describe('PrismaPredictionRepository evaluation', () => {
  it('evaluates against the resolved reviewed fallback result', async () => {
    const update = vi.fn().mockResolvedValue({});
    const createAudit = vi.fn().mockResolvedValue({});
    const prisma = {
      gamePrediction: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'prediction-1',
            predictedWinnerTeamId: 'away',
            homeWinProbability: 0.4,
            game: {
              status: 'SCHEDULED',
              homeScore: null,
              awayScore: null,
              homeTeamId: 'home',
              awayTeamId: 'away',
              editorialOverride: { status: 'FINAL', homeScore: 7, awayScore: 27 },
            },
          },
        ]),
        update,
      },
      adminAuditEvent: { create: createAudit },
      $transaction: vi.fn((operations: readonly Promise<unknown>[]) => Promise.all(operations)),
    } as unknown as PrismaClient;
    const repository = new PrismaPredictionRepository(prisma);

    await expect(
      repository.evaluate(new Date('2026-08-21T12:00:00Z'), {
        userId: null,
        emailSnapshot: 'prediction-cli',
        requestId: null,
      }),
    ).resolves.toBe(1);
    const updateInput: unknown = update.mock.calls[0]?.[0];
    expect(updateInput).toMatchObject({
      data: {
        actualHomeScore: 7,
        actualAwayScore: 27,
        actualWinnerTeamId: 'away',
        wasCorrect: true,
      },
    });
    expect(createAudit).toHaveBeenCalledOnce();
  });
});
