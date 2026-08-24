import type {
  GameSchedulingClass,
  GameStatus,
  PrismaClient,
} from '../../generated/prisma/client.js';

/** Bounds the FINAL-game discovery branch to recently-kicked-off games only, so completed
 * seasons are never rescanned every cycle. Comfortably covers the +60 minute reconciliation
 * window plus a long game/delay margin. */
const RECENT_FINAL_DISCOVERY_HOURS = 24;
const PREGAME_DISCOVERY_LEAD_MINUTES = 10;

export interface PollCandidateGame {
  readonly gameId: string;
  readonly status: GameStatus;
  readonly startTime: Date | null;
  readonly quarter: number | null;
  readonly homeScore: number | null;
  readonly awayScore: number | null;
  readonly manualFeatured: boolean | null;
  readonly broadcastNetwork: string | null;
  readonly homeAbbreviation: string;
  readonly awayAbbreviation: string;
  readonly providerMapping: { readonly providerGameId: string } | null;
}

export interface PollStateRow {
  readonly id: string;
  readonly gameId: string;
  readonly schedulingClass: GameSchedulingClass;
  readonly featuredReason: string | null;
  readonly lastAttemptAt: Date | null;
  readonly lastSuccessAt: Date | null;
  readonly nextPollAt: Date | null;
  readonly lastObservedStatus: GameStatus | null;
  readonly lastError: string | null;
  readonly finalObservedAt: Date | null;
  readonly finalImmediateCompletedAt: Date | null;
  readonly final10CompletedAt: Date | null;
  readonly final60CompletedAt: Date | null;
  readonly playsBlockedAt: Date | null;
  readonly playsBlockReason: string | null;
  readonly playsReviewRequired: boolean;
}

export interface ClaimedPoll {
  readonly pollState: PollStateRow;
  readonly game: PollCandidateGame;
}

export interface PlaysBlockUpdate {
  readonly playsBlockedAt: Date | null;
  readonly playsBlockReason: string | null;
  readonly playsReviewRequired: boolean;
}

export interface PollStateOutcomeUpdate {
  readonly schedulingClass: GameSchedulingClass;
  readonly featuredReason: string | null;
  readonly nextPollAt: Date | null;
  readonly lastObservedStatus: GameStatus;
  readonly finalObservedAt?: Date;
  readonly finalImmediateCompletedAt?: Date;
  readonly final10CompletedAt?: Date;
  readonly final60CompletedAt?: Date;
  readonly playsBlock: PlaysBlockUpdate;
}

export interface PlaysReviewQueueEntry {
  readonly gameId: string;
  readonly playsBlockedAt: Date | null;
  readonly playsBlockReason: string | null;
}

export interface CurrentGamePollStateRepository {
  discoverCandidates(now: Date): Promise<readonly PollCandidateGame[]>;
  ensurePollStates(gameIds: readonly string[], now: Date): Promise<void>;
  claimDue(
    now: Date,
    workerId: string,
    leaseMs: number,
    limit: number,
  ): Promise<readonly ClaimedPoll[]>;
  recordSuccess(id: string, now: Date, update: PollStateOutcomeUpdate): Promise<void>;
  recordFailure(
    id: string,
    now: Date,
    error: string,
    retryNextPollAt: Date,
    playsBlock: PlaysBlockUpdate,
  ): Promise<void>;
  listPlaysReviewRequired(limit: number): Promise<readonly PlaysReviewQueueEntry[]>;
  clearPlaysBlock(gameId: string, now: Date): Promise<void>;
}

const candidateInclude = {
  homeTeam: { select: { abbreviation: true } },
  awayTeam: { select: { abbreviation: true } },
  providerMaps: { where: { provider: 'highlightly' }, take: 1, select: { providerGameId: true } },
} as const;

export class PrismaCurrentGamePollStateRepository implements CurrentGamePollStateRepository {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly discoveryLimit = 200,
  ) {}

  async discoverCandidates(now: Date): Promise<readonly PollCandidateGame[]> {
    const pregameWindowEnd = new Date(now.getTime() + PREGAME_DISCOVERY_LEAD_MINUTES * 60_000);
    const recentFinalSince = new Date(now.getTime() - RECENT_FINAL_DISCOVERY_HOURS * 60 * 60_000);
    const games = await this.prisma.game.findMany({
      where: {
        league: 'NFL',
        OR: [
          { status: { in: ['IN_PROGRESS', 'HALFTIME'] } },
          {
            status: { in: ['SCHEDULED', 'PREGAME'] },
            startTime: { gte: now, lte: pregameWindowEnd },
          },
          {
            status: 'FINAL',
            startTime: { gte: recentFinalSince },
            OR: [{ pollState: null }, { pollState: { final60CompletedAt: null } }],
          },
        ],
      },
      include: candidateInclude,
      take: this.discoveryLimit,
    });
    return games.map(toCandidateGame);
  }

  async ensurePollStates(gameIds: readonly string[], now: Date): Promise<void> {
    if (gameIds.length === 0) return;
    const existing = await this.prisma.currentGamePollState.findMany({
      where: { gameId: { in: [...gameIds] } },
      select: { gameId: true },
    });
    const existingIds = new Set(existing.map((row) => row.gameId));
    const missing = gameIds.filter((id) => !existingIds.has(id));
    if (missing.length === 0) return;
    await this.prisma.currentGamePollState.createMany({
      data: missing.map((gameId) => ({
        gameId,
        schedulingClass: 'NOT_DUE' as const,
        nextPollAt: now,
      })),
      skipDuplicates: true,
    });
  }

  async claimDue(
    now: Date,
    workerId: string,
    leaseMs: number,
    limit: number,
  ): Promise<readonly ClaimedPoll[]> {
    const staleLockBefore = new Date(now.getTime() - leaseMs);
    const candidates = await this.prisma.currentGamePollState.findMany({
      where: {
        nextPollAt: { lte: now },
        OR: [{ lockedAt: null }, { lockedAt: { lt: staleLockBefore } }],
      },
      orderBy: { nextPollAt: 'asc' },
      take: limit,
      select: { id: true },
    });

    const claimed: ClaimedPoll[] = [];
    for (const candidate of candidates) {
      // Conditional claim: only succeeds if still due and unlocked, so two poller
      // instances racing on the same row never both win it (no SELECT FOR UPDATE needed).
      const result = await this.prisma.currentGamePollState.updateMany({
        where: {
          id: candidate.id,
          nextPollAt: { lte: now },
          OR: [{ lockedAt: null }, { lockedAt: { lt: staleLockBefore } }],
        },
        data: { lockedAt: now, lockedBy: workerId, lastAttemptAt: now },
      });
      if (result.count !== 1) continue;
      const row = await this.prisma.currentGamePollState.findUnique({
        where: { id: candidate.id },
        include: { game: { include: candidateInclude } },
      });
      if (row === null) continue;
      claimed.push({ pollState: toPollStateRow(row), game: toCandidateGame(row.game) });
    }
    return claimed;
  }

  async recordSuccess(id: string, now: Date, update: PollStateOutcomeUpdate): Promise<void> {
    await this.prisma.currentGamePollState.update({
      where: { id },
      data: {
        schedulingClass: update.schedulingClass,
        featuredReason: update.featuredReason,
        nextPollAt: update.nextPollAt,
        lastObservedStatus: update.lastObservedStatus,
        lastSuccessAt: now,
        lastError: null,
        ...(update.finalObservedAt === undefined
          ? {}
          : { finalObservedAt: update.finalObservedAt }),
        ...(update.finalImmediateCompletedAt === undefined
          ? {}
          : { finalImmediateCompletedAt: update.finalImmediateCompletedAt }),
        ...(update.final10CompletedAt === undefined
          ? {}
          : { final10CompletedAt: update.final10CompletedAt }),
        ...(update.final60CompletedAt === undefined
          ? {}
          : { final60CompletedAt: update.final60CompletedAt }),
        playsBlockedAt: update.playsBlock.playsBlockedAt,
        playsBlockReason: update.playsBlock.playsBlockReason,
        playsReviewRequired: update.playsBlock.playsReviewRequired,
        lockedAt: null,
        lockedBy: null,
      },
    });
  }

  async recordFailure(
    id: string,
    now: Date,
    error: string,
    retryNextPollAt: Date,
    playsBlock: PlaysBlockUpdate,
  ): Promise<void> {
    await this.prisma.currentGamePollState.update({
      where: { id },
      data: {
        lastError: error.slice(0, 500),
        nextPollAt: retryNextPollAt,
        playsBlockedAt: playsBlock.playsBlockedAt,
        playsBlockReason: playsBlock.playsBlockReason,
        playsReviewRequired: playsBlock.playsReviewRequired,
        lockedAt: null,
        lockedBy: null,
        lastAttemptAt: now,
      },
    });
  }

  async listPlaysReviewRequired(limit: number): Promise<readonly PlaysReviewQueueEntry[]> {
    const rows = await this.prisma.currentGamePollState.findMany({
      where: { playsReviewRequired: true },
      orderBy: { playsBlockedAt: 'asc' },
      take: limit,
      select: { gameId: true, playsBlockedAt: true, playsBlockReason: true },
    });
    return rows;
  }

  async clearPlaysBlock(gameId: string, now: Date): Promise<void> {
    void now;
    await this.prisma.currentGamePollState.updateMany({
      where: { gameId },
      data: { playsBlockedAt: null, playsBlockReason: null, playsReviewRequired: false },
    });
  }
}

function toCandidateGame(game: {
  readonly id: string;
  readonly status: GameStatus;
  readonly startTime: Date | null;
  readonly quarter: number | null;
  readonly homeScore: number | null;
  readonly awayScore: number | null;
  readonly manualFeatured: boolean | null;
  readonly broadcastNetwork: string | null;
  readonly homeTeam: { readonly abbreviation: string };
  readonly awayTeam: { readonly abbreviation: string };
  readonly providerMaps: readonly { readonly providerGameId: string }[];
}): PollCandidateGame {
  return {
    gameId: game.id,
    status: game.status,
    startTime: game.startTime,
    quarter: game.quarter,
    homeScore: game.homeScore,
    awayScore: game.awayScore,
    manualFeatured: game.manualFeatured,
    broadcastNetwork: game.broadcastNetwork,
    homeAbbreviation: game.homeTeam.abbreviation,
    awayAbbreviation: game.awayTeam.abbreviation,
    providerMapping: game.providerMaps[0] ?? null,
  };
}

function toPollStateRow(row: {
  readonly id: string;
  readonly gameId: string;
  readonly schedulingClass: GameSchedulingClass;
  readonly featuredReason: string | null;
  readonly lastAttemptAt: Date | null;
  readonly lastSuccessAt: Date | null;
  readonly nextPollAt: Date | null;
  readonly lastObservedStatus: GameStatus | null;
  readonly lastError: string | null;
  readonly finalObservedAt: Date | null;
  readonly finalImmediateCompletedAt: Date | null;
  readonly final10CompletedAt: Date | null;
  readonly final60CompletedAt: Date | null;
  readonly playsBlockedAt: Date | null;
  readonly playsBlockReason: string | null;
  readonly playsReviewRequired: boolean;
}): PollStateRow {
  return {
    id: row.id,
    gameId: row.gameId,
    schedulingClass: row.schedulingClass,
    featuredReason: row.featuredReason,
    lastAttemptAt: row.lastAttemptAt,
    lastSuccessAt: row.lastSuccessAt,
    nextPollAt: row.nextPollAt,
    lastObservedStatus: row.lastObservedStatus,
    lastError: row.lastError,
    finalObservedAt: row.finalObservedAt,
    finalImmediateCompletedAt: row.finalImmediateCompletedAt,
    final10CompletedAt: row.final10CompletedAt,
    final60CompletedAt: row.final60CompletedAt,
    playsBlockedAt: row.playsBlockedAt,
    playsBlockReason: row.playsBlockReason,
    playsReviewRequired: row.playsReviewRequired,
  };
}
