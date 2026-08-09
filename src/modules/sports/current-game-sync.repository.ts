import type {
  GameStatus,
  Prisma,
  PrismaClient,
  SeasonType,
} from '../../generated/prisma/client.js';

export interface CurrentGameRecord {
  readonly id: string;
  readonly season: number;
  readonly seasonType: SeasonType;
  readonly week: number | null;
  readonly startTime: Date | null;
  readonly status: GameStatus;
  readonly homeScore: number | null;
  readonly awayScore: number | null;
  readonly quarter: number | null;
  readonly clock: string | null;
  readonly venueName: string | null;
  readonly venueCity: string | null;
  readonly broadcastNetwork: string | null;
  readonly homeTeam: {
    readonly abbreviation: string;
    readonly providerTeamId: string | null;
  };
  readonly awayTeam: {
    readonly abbreviation: string;
    readonly providerTeamId: string | null;
  };
  readonly providerMapping: { readonly providerGameId: string } | null;
}

export interface CurrentGameStateWrite {
  readonly status: GameStatus;
  readonly homeScore: number | null;
  readonly awayScore: number | null;
  readonly quarter: number | null;
  readonly clock: string | null;
  readonly venueName: string | null;
  readonly venueCity: string | null;
  readonly broadcastNetwork: string | null;
}

export interface ApplyCurrentGameInput {
  readonly game: CurrentGameRecord;
  readonly provider: string;
  readonly providerGameId: string;
  readonly state: CurrentGameStateWrite;
  readonly createMapping: boolean;
  readonly usageMode: 'evaluation' | 'approved';
  readonly updatedAt: Date;
}

export interface CurrentGameSyncRepository {
  findGame(gameId: string, provider: string): Promise<CurrentGameRecord | null>;
  findMappedGameId(provider: string, providerGameId: string): Promise<string | null>;
  applyCurrentGame(input: ApplyCurrentGameInput): Promise<void>;
}

export class PrismaCurrentGameSyncRepository implements CurrentGameSyncRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findGame(gameId: string, provider: string): Promise<CurrentGameRecord | null> {
    const game = await this.prisma.game.findUnique({
      where: { id: gameId },
      select: {
        id: true,
        season: true,
        seasonType: true,
        week: true,
        startTime: true,
        status: true,
        homeScore: true,
        awayScore: true,
        quarter: true,
        clock: true,
        venueName: true,
        venueCity: true,
        broadcastNetwork: true,
        homeTeam: {
          select: {
            abbreviation: true,
            providerMaps: {
              where: { provider },
              take: 1,
              select: { providerTeamId: true },
            },
          },
        },
        awayTeam: {
          select: {
            abbreviation: true,
            providerMaps: {
              where: { provider },
              take: 1,
              select: { providerTeamId: true },
            },
          },
        },
        providerMaps: {
          where: { provider },
          take: 1,
          select: { providerGameId: true },
        },
      },
    });
    if (game === null) return null;
    return {
      ...game,
      homeTeam: {
        abbreviation: game.homeTeam.abbreviation,
        providerTeamId: game.homeTeam.providerMaps[0]?.providerTeamId ?? null,
      },
      awayTeam: {
        abbreviation: game.awayTeam.abbreviation,
        providerTeamId: game.awayTeam.providerMaps[0]?.providerTeamId ?? null,
      },
      providerMapping: game.providerMaps[0] ?? null,
    };
  }

  async findMappedGameId(provider: string, providerGameId: string): Promise<string | null> {
    return (
      (
        await this.prisma.gameProviderMapping.findUnique({
          where: { provider_providerGameId: { provider, providerGameId } },
          select: { gameId: true },
        })
      )?.gameId ?? null
    );
  }

  applyCurrentGame(input: ApplyCurrentGameInput): Promise<void> {
    return this.prisma.$transaction(async (transaction) => {
      await transaction.game.update({
        where: { id: input.game.id },
        data: { ...input.state, providerLastUpdatedAt: input.updatedAt },
      });
      if (input.createMapping) {
        await transaction.gameProviderMapping.create({
          data: {
            gameId: input.game.id,
            provider: input.provider,
            providerGameId: input.providerGameId,
          },
        });
      }
      await transaction.adminAuditEvent.create({
        data: {
          actorEmailSnapshot: 'current-game-sync-cli',
          action: 'CURRENT_GAME_PROVIDER_SYNC',
          entityType: 'GAME',
          entityId: input.game.id,
          beforeSnapshot: stateSnapshot(input.game),
          afterSnapshot: {
            ...input.state,
            provider: input.provider,
            providerGameId: input.providerGameId,
            usageMode: input.usageMode,
            updatedAt: input.updatedAt.toISOString(),
          },
        },
      });
    });
  }
}

function stateSnapshot(game: CurrentGameRecord): Prisma.InputJsonObject {
  return {
    status: game.status,
    homeScore: game.homeScore,
    awayScore: game.awayScore,
    quarter: game.quarter,
    clock: game.clock,
    venueName: game.venueName,
    venueCity: game.venueCity,
    broadcastNetwork: game.broadcastNetwork,
  };
}
