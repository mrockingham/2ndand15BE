import type { Prisma, PrismaClient, SeasonType } from '../../generated/prisma/client.js';
import type { AuditActor } from '../admin/admin.repository.js';
import type {
  BaselineOutput,
  CompletedGame,
  PredictionGame,
  TeamSeasonFeatures,
} from './prediction-model.js';
import type { PredictionExplanation } from './prediction-explainer.js';
import type { EvaluatedPrediction, WeeklyInsightPrediction } from './weekly-insights.js';

const teamSelect = { id: true, fullName: true, abbreviation: true } as const;

export interface PredictionRecord {
  readonly id: string;
  readonly gameId: string;
  readonly modelVersion: string;
  readonly revision: number;
  readonly status: 'DRAFT' | 'PUBLISHED' | 'LOCKED' | 'EVALUATED';
  readonly homeWinProbability: number;
  readonly awayWinProbability: number;
  readonly projectedHomeScore: number | null;
  readonly projectedAwayScore: number | null;
  readonly confidence: 'LOW' | 'MEDIUM' | 'HIGH';
  readonly factors: unknown;
  readonly dataAvailability: unknown;
  readonly generatedAt: Date;
  readonly publishedAt: Date | null;
  readonly lockedAt: Date | null;
  readonly evaluatedAt: Date | null;
  readonly actualHomeScore: number | null;
  readonly actualAwayScore: number | null;
  readonly wasCorrect: boolean | null;
  readonly brierScore: number | null;
  readonly isTie: boolean | null;
  readonly isRetrospective: boolean;
  readonly aiSummary: string | null;
  readonly aiKeyReasons: unknown;
  readonly aiWatchFor: unknown;
  readonly predictedWinnerTeam: {
    readonly id: string;
    readonly fullName: string;
    readonly abbreviation: string;
  } | null;
  readonly actualWinnerTeam: {
    readonly id: string;
    readonly fullName: string;
    readonly abbreviation: string;
  } | null;
  readonly game: PredictionGame & {
    readonly status: string;
    readonly homeScore: number | null;
    readonly awayScore: number | null;
  };
}

export interface PredictionListFilters {
  readonly season?: number | undefined;
  readonly seasonType?: SeasonType | undefined;
  readonly week?: number | undefined;
  readonly teamId?: string | undefined;
  readonly status?: 'UPCOMING' | 'COMPLETED' | undefined;
  readonly limit: number;
}

const predictionInclude = {
  predictedWinnerTeam: { select: teamSelect },
  actualWinnerTeam: { select: teamSelect },
  game: { include: { homeTeam: { select: teamSelect }, awayTeam: { select: teamSelect } } },
} as const;

export class PrismaPredictionRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findGame(gameId: string): Promise<(PredictionGame & { readonly status: string }) | null> {
    return this.prisma.game.findUnique({
      where: { id: gameId },
      select: {
        id: true,
        season: true,
        seasonType: true,
        week: true,
        startTime: true,
        isNeutralSite: true,
        status: true,
        homeTeam: { select: teamSelect },
        awayTeam: { select: teamSelect },
      },
    });
  }

  findWeeklyGames(season: number, seasonType: SeasonType, week: number | null) {
    return this.prisma.game.findMany({
      where: {
        league: 'NFL',
        season,
        seasonType,
        week,
        status: { in: ['SCHEDULED', 'PREGAME'] },
        startTime: { not: null },
        provenance: {
          is: { sourceType: { in: ['OFFICIAL_WEB', 'MANUAL_IMPORT', 'MANUAL_ENTRY'] } },
        },
      },
      select: {
        id: true,
        season: true,
        seasonType: true,
        week: true,
        startTime: true,
        isNeutralSite: true,
        status: true,
        homeTeam: { select: teamSelect },
        awayTeam: { select: teamSelect },
      },
      orderBy: [{ startTime: 'asc' }, { id: 'asc' }],
      take: 20,
    });
  }

  findBacktestGames(season: number, seasonType: SeasonType) {
    return this.prisma.game.findMany({
      where: {
        league: 'NFL',
        season,
        seasonType,
        status: 'FINAL',
        homeScore: { not: null },
        awayScore: { not: null },
      },
      select: {
        id: true,
        season: true,
        seasonType: true,
        week: true,
        startTime: true,
        isNeutralSite: true,
        status: true,
        homeScore: true,
        awayScore: true,
        homeTeam: { select: teamSelect },
        awayTeam: { select: teamSelect },
      },
      orderBy: [{ startTime: 'asc' }, { id: 'asc' }],
    });
  }

  async loadModelInputs(target: PredictionGame): Promise<{
    completedGames: readonly CompletedGame[];
    teamFeatures: readonly TeamSeasonFeatures[];
  }> {
    const priorSeasonTypes: SeasonType[] =
      target.seasonType === 'POST' ? ['PRE', 'REG'] : target.seasonType === 'REG' ? ['PRE'] : [];
    const historicalCutoff: Prisma.GameWhereInput = {
      OR: [
        { season: { lt: target.season } },
        ...(priorSeasonTypes.length === 0
          ? []
          : [{ season: target.season, seasonType: { in: priorSeasonTypes } }]),
        {
          season: target.season,
          seasonType: target.seasonType,
          OR: [
            ...(target.startTime === null ? [] : [{ startTime: { lt: target.startTime } }]),
            ...(target.week === null ? [] : [{ startTime: null, week: { lt: target.week } }]),
          ],
        },
      ],
    };
    const completed = await this.prisma.game.findMany({
      where: {
        league: 'NFL',
        status: 'FINAL',
        homeScore: { not: null },
        awayScore: { not: null },
        season: { gte: target.season - 6 },
        AND: [historicalCutoff],
      },
      select: {
        season: true,
        seasonType: true,
        week: true,
        startTime: true,
        homeTeamId: true,
        awayTeamId: true,
        homeScore: true,
        awayScore: true,
        isNeutralSite: true,
      },
      orderBy: [{ startTime: 'asc' }, { id: 'asc' }],
    });
    const aggregates = await this.prisma.playerGameStat.groupBy({
      by: ['teamId', 'season'],
      where: {
        season: { gte: target.season - 3, lte: target.season },
        game: { status: 'FINAL', AND: [historicalCutoff] },
      },
      _sum: {
        passingYards: true,
        rushingYards: true,
        passingTouchdowns: true,
        rushingTouchdowns: true,
        passingInterceptions: true,
        fumblesLost: true,
        defensiveSacks: true,
        defensiveInterceptions: true,
        forcedFumbles: true,
      },
    });
    const gameCounts = new Map<string, number>();
    for (const game of completed)
      for (const teamId of [game.homeTeamId, game.awayTeamId]) {
        const key = `${teamId}:${String(game.season)}`;
        gameCounts.set(key, (gameCounts.get(key) ?? 0) + 1);
      }
    return {
      completedGames: completed.filter(
        (game): game is CompletedGame => game.homeScore !== null && game.awayScore !== null,
      ),
      teamFeatures: aggregates.map((row) => ({
        teamId: row.teamId,
        season: row.season,
        games: gameCounts.get(`${row.teamId}:${String(row.season)}`) ?? 0,
        passingYards: row._sum.passingYards ?? 0,
        rushingYards: row._sum.rushingYards ?? 0,
        passingTouchdowns: row._sum.passingTouchdowns ?? 0,
        rushingTouchdowns: row._sum.rushingTouchdowns ?? 0,
        turnovers: (row._sum.passingInterceptions ?? 0) + (row._sum.fumblesLost ?? 0),
        defensiveSacks: row._sum.defensiveSacks ?? 0,
        defensiveInterceptions: row._sum.defensiveInterceptions ?? 0,
        forcedFumbles: row._sum.forcedFumbles ?? 0,
      })),
    };
  }

  async createPrediction(
    game: PredictionGame,
    output: BaselineOutput,
    actor: AuditActor,
    now: Date,
    retrospective: boolean,
    explanation: PredictionExplanation | null,
  ): Promise<PredictionRecord> {
    return this.prisma.$transaction(async (transaction) => {
      const latest = await transaction.gamePrediction.findFirst({
        where: { gameId: game.id, modelVersion: output.modelVersion },
        orderBy: { revision: 'desc' },
        select: { revision: true },
      });
      const prediction = await transaction.gamePrediction.create({
        data: {
          gameId: game.id,
          modelVersion: output.modelVersion,
          revision: (latest?.revision ?? 0) + 1,
          homeTeamId: game.homeTeam.id,
          awayTeamId: game.awayTeam.id,
          predictedWinnerTeamId: output.predictedWinnerTeamId,
          homeWinProbability: output.homeWinProbability,
          awayWinProbability: output.awayWinProbability,
          projectedHomeScore: output.projectedHomeScore,
          projectedAwayScore: output.projectedAwayScore,
          confidence: output.confidence,
          factors: output.factors,
          featureSnapshot: output.featureSnapshot as Prisma.InputJsonValue,
          dataAvailability: output.dataAvailability,
          generatedAt: now,
          isRetrospective: retrospective,
          generatedById: actor.userId,
          generatedBySnapshot: actor.emailSnapshot,
          ...(explanation === null
            ? {}
            : {
                aiSummary: explanation.summary,
                aiKeyReasons: [...explanation.keyReasons],
                aiWatchFor: [...explanation.watchFor],
                aiProvider: explanation.provider,
                aiModel: explanation.model,
                aiPromptVersion: explanation.promptVersion,
                aiInputTokens: explanation.inputTokens,
                aiOutputTokens: explanation.outputTokens,
                aiDurationMs: explanation.durationMs,
              }),
        },
        include: predictionInclude,
      });
      await transaction.adminAuditEvent.create({
        data: {
          actorUserId: actor.userId,
          actorEmailSnapshot: actor.emailSnapshot,
          action: 'PREDICTION_GENERATED',
          entityType: 'GAME_PREDICTION',
          entityId: prediction.id,
          requestId: actor.requestId,
          afterSnapshot: {
            gameId: game.id,
            modelVersion: output.modelVersion,
            revision: prediction.revision,
            retrospective,
          },
        },
      });
      return prediction;
    });
  }

  async publish(id: string, actor: AuditActor, now: Date): Promise<PredictionRecord | null> {
    const existing = await this.prisma.gamePrediction.findUnique({
      where: { id },
      include: predictionInclude,
    });
    if (existing === null) return null;
    if (existing.isRetrospective || existing.status !== 'DRAFT') return existing;
    if (existing.game.startTime === null || existing.game.startTime <= now) return existing;
    return this.prisma.$transaction(async (transaction) => {
      const prediction = await transaction.gamePrediction.update({
        where: { id },
        data: { status: 'PUBLISHED', publishedAt: now },
        include: predictionInclude,
      });
      await transaction.adminAuditEvent.create({
        data: {
          actorUserId: actor.userId,
          actorEmailSnapshot: actor.emailSnapshot,
          action: 'PREDICTION_PUBLISHED',
          entityType: 'GAME_PREDICTION',
          entityId: id,
          requestId: actor.requestId,
          beforeSnapshot: { status: existing.status },
          afterSnapshot: { status: 'PUBLISHED' },
        },
      });
      return prediction;
    });
  }

  async lockStarted(now: Date, actor: AuditActor): Promise<number> {
    return this.prisma.$transaction(async (transaction) => {
      const result = await transaction.gamePrediction.updateMany({
        where: { status: 'PUBLISHED', game: { startTime: { lte: now } } },
        data: { status: 'LOCKED', lockedAt: now },
      });
      if (result.count > 0)
        await transaction.adminAuditEvent.create({
          data: {
            actorUserId: actor.userId,
            actorEmailSnapshot: actor.emailSnapshot,
            action: 'PREDICTIONS_LOCKED',
            entityType: 'GAME_PREDICTION_BATCH',
            entityId: null,
            requestId: actor.requestId,
            afterSnapshot: { count: result.count, lockedAt: now.toISOString() },
          },
        });
      return result.count;
    });
  }

  async evaluate(now: Date, actor: AuditActor): Promise<number> {
    const rows = await this.prisma.gamePrediction.findMany({
      where: {
        status: { in: ['PUBLISHED', 'LOCKED'] },
        game: { status: 'FINAL', homeScore: { not: null }, awayScore: { not: null } },
      },
      include: { game: true },
    });
    await this.prisma.$transaction([
      ...rows.map((row) => {
        if (row.game.homeScore === null || row.game.awayScore === null)
          throw new Error('Evaluation query returned a game without final scores.');
        const home = row.game.homeScore,
          away = row.game.awayScore,
          tie = home === away;
        const actualWinnerTeamId = tie
          ? null
          : home > away
            ? row.game.homeTeamId
            : row.game.awayTeamId;
        const homeOutcome = tie ? 0.5 : home > away ? 1 : 0;
        return this.prisma.gamePrediction.update({
          where: { id: row.id },
          data: {
            status: 'EVALUATED',
            evaluatedAt: now,
            actualHomeScore: home,
            actualAwayScore: away,
            actualWinnerTeamId,
            isTie: tie,
            wasCorrect: tie ? null : row.predictedWinnerTeamId === actualWinnerTeamId,
            brierScore: (row.homeWinProbability - homeOutcome) ** 2,
          },
        });
      }),
      ...(rows.length === 0
        ? []
        : [
            this.prisma.adminAuditEvent.create({
              data: {
                actorUserId: actor.userId,
                actorEmailSnapshot: actor.emailSnapshot,
                action: 'PREDICTIONS_EVALUATED',
                entityType: 'GAME_PREDICTION_BATCH',
                entityId: null,
                requestId: actor.requestId,
                afterSnapshot: { count: rows.length, evaluatedAt: now.toISOString() },
              },
            }),
          ]),
    ]);
    return rows.length;
  }

  async listPublic(filters: PredictionListFilters): Promise<readonly PredictionRecord[]> {
    const gameWhere: Prisma.GameWhereInput = {
      ...(filters.season === undefined ? {} : { season: filters.season }),
      ...(filters.seasonType === undefined ? {} : { seasonType: filters.seasonType }),
      ...(filters.week === undefined ? {} : { week: filters.week }),
      ...(filters.teamId === undefined
        ? {}
        : { OR: [{ homeTeamId: filters.teamId }, { awayTeamId: filters.teamId }] }),
      ...(filters.status === 'UPCOMING'
        ? { status: { in: ['SCHEDULED', 'PREGAME'] } }
        : filters.status === 'COMPLETED'
          ? { status: 'FINAL' }
          : {}),
    };
    const rows = await this.prisma.gamePrediction.findMany({
      where: {
        status: { in: ['PUBLISHED', 'LOCKED', 'EVALUATED'] },
        isRetrospective: false,
        game: gameWhere,
      },
      include: predictionInclude,
      orderBy: [{ game: { startTime: 'asc' } }, { revision: 'desc' }],
      take: Math.min(filters.limit * 4, 200),
    });
    const latest = new Map<string, PredictionRecord>();
    for (const row of rows) if (!latest.has(row.gameId)) latest.set(row.gameId, row);
    return [...latest.values()].slice(0, filters.limit);
  }

  async findPublicByGame(gameId: string): Promise<PredictionRecord | null> {
    return this.prisma.gamePrediction.findFirst({
      where: {
        gameId,
        status: { in: ['PUBLISHED', 'LOCKED', 'EVALUATED'] },
        isRetrospective: false,
      },
      include: predictionInclude,
      orderBy: { revision: 'desc' },
    });
  }

  async findWeeklyInsightPredictions(
    season: number,
    seasonType: SeasonType,
    week: number,
  ): Promise<readonly WeeklyInsightPrediction[]> {
    const rows = await this.prisma.gamePrediction.findMany({
      where: {
        status: { in: ['PUBLISHED', 'LOCKED', 'EVALUATED'] },
        isRetrospective: false,
        game: {
          league: 'NFL',
          season,
          seasonType,
          week,
          provenance: {
            is: { sourceType: { in: ['OFFICIAL_WEB', 'MANUAL_IMPORT', 'MANUAL_ENTRY'] } },
          },
        },
      },
      select: {
        id: true,
        gameId: true,
        modelVersion: true,
        revision: true,
        status: true,
        homeWinProbability: true,
        awayWinProbability: true,
        projectedHomeScore: true,
        projectedAwayScore: true,
        confidence: true,
        factors: true,
        featureSnapshot: true,
        dataAvailability: true,
        predictedWinnerTeamId: true,
        generatedAt: true,
        game: {
          select: {
            id: true,
            season: true,
            seasonType: true,
            week: true,
            startTime: true,
            homeTeam: { select: teamSelect },
            awayTeam: { select: teamSelect },
          },
        },
      },
      orderBy: [{ game: { startTime: 'asc' } }, { revision: 'desc' }, { id: 'asc' }],
      take: 80,
    });
    const latest = new Map<string, WeeklyInsightPrediction>();
    for (const row of rows) {
      if (latest.has(row.gameId)) continue;
      if (row.status !== 'PUBLISHED' && row.status !== 'LOCKED' && row.status !== 'EVALUATED')
        continue;
      latest.set(row.gameId, {
        ...row,
        status: row.status,
      });
    }
    return [...latest.values()];
  }

  findWeeklyInsightPerformance(
    season: number,
    seasonType: SeasonType,
  ): Promise<readonly EvaluatedPrediction[]> {
    return this.prisma.gamePrediction.findMany({
      where: {
        status: 'EVALUATED',
        isRetrospective: false,
        game: {
          league: 'NFL',
          season,
          seasonType,
          provenance: {
            is: { sourceType: { in: ['OFFICIAL_WEB', 'MANUAL_IMPORT', 'MANUAL_ENTRY'] } },
          },
        },
      },
      select: {
        modelVersion: true,
        wasCorrect: true,
        isTie: true,
        brierScore: true,
        game: { select: { week: true } },
      },
      orderBy: [{ game: { week: 'asc' } }, { id: 'asc' }],
      take: 400,
    });
  }

  performance() {
    return this.prisma.gamePrediction.findMany({
      where: { status: 'EVALUATED', isRetrospective: false },
      select: {
        modelVersion: true,
        wasCorrect: true,
        isTie: true,
        brierScore: true,
        game: { select: { season: true, seasonType: true } },
      },
    });
  }
}
