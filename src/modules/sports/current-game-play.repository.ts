import type {
  GamePlay,
  GamePlayType,
  GameStatus,
  PrismaClient,
} from '../../generated/prisma/client.js';

export interface CurrentGamePlayTarget {
  readonly id: string;
  readonly status: GameStatus;
  readonly homeTeamId: string;
  readonly awayTeamId: string;
  readonly homeAbbreviation: string;
  readonly awayAbbreviation: string;
  readonly providerMapping: { readonly providerGameId: string } | null;
  readonly plays: readonly GamePlay[];
}

export interface CurrentGamePlayWrite {
  readonly id: string | null;
  readonly gameId: string;
  readonly playKey: string;
  readonly reconciliationKey: string;
  readonly sequence: number;
  readonly period: number;
  readonly clock: string;
  readonly possessionTeamId: string | null;
  readonly playType: GamePlayType;
  readonly description: string;
  readonly startDown: number | null;
  readonly startDistance: number | null;
  readonly startYardLine: number | null;
  readonly endDown: number | null;
  readonly endDistance: number | null;
  readonly endYardLine: number | null;
  readonly isScoringPlay: boolean;
  readonly isPenalty: boolean;
  readonly isTurnover: boolean;
  readonly sourceProvider: string;
  readonly sourcePlayType: string;
  readonly sourceUpdatedAt: Date;
}

export interface CurrentGamePlayApplyInput {
  readonly target: CurrentGamePlayTarget;
  readonly rows: readonly CurrentGamePlayWrite[];
  readonly provider: string;
  readonly usageMode: 'evaluation' | 'approved';
  readonly inserted: number;
  readonly updated: number;
}

export interface CurrentGamePlayRepository {
  findTarget(gameId: string, provider: string): Promise<CurrentGamePlayTarget | null>;
  applySnapshot(input: CurrentGamePlayApplyInput): Promise<void>;
}

export class PrismaCurrentGamePlayRepository implements CurrentGamePlayRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findTarget(gameId: string, provider: string): Promise<CurrentGamePlayTarget | null> {
    const game = await this.prisma.game.findUnique({
      where: { id: gameId },
      select: {
        id: true,
        status: true,
        homeTeamId: true,
        awayTeamId: true,
        homeTeam: { select: { abbreviation: true } },
        awayTeam: { select: { abbreviation: true } },
        providerMaps: {
          where: { provider },
          take: 1,
          select: { providerGameId: true },
        },
        plays: { orderBy: { sequence: 'asc' } },
      },
    });
    if (game === null) return null;
    return {
      id: game.id,
      status: game.status,
      homeTeamId: game.homeTeamId,
      awayTeamId: game.awayTeamId,
      homeAbbreviation: game.homeTeam.abbreviation,
      awayAbbreviation: game.awayTeam.abbreviation,
      providerMapping: game.providerMaps[0] ?? null,
      plays: game.plays,
    };
  }

  applySnapshot(input: CurrentGamePlayApplyInput): Promise<void> {
    return this.prisma.$transaction(
      async (transaction) => {
        if (input.target.plays.length > 0) {
          await transaction.gamePlay.updateMany({
            where: { gameId: input.target.id },
            data: { sequence: { increment: 1_000_000 } },
          });
        }
        const newRows = input.rows.filter((row) => row.id === null);
        if (newRows.length > 0) {
          await transaction.gamePlay.createMany({
            data: newRows.map((row) => {
              const { id, ...data } = row;
              void id;
              return data;
            }),
          });
        }
        for (const row of input.rows.filter((candidate) => candidate.id !== null)) {
          const { id, ...data } = row;
          if (id !== null) await transaction.gamePlay.update({ where: { id }, data });
        }
        await transaction.adminAuditEvent.create({
          data: {
            actorEmailSnapshot: 'current-game-plays-sync-cli',
            action: 'CURRENT_GAME_PLAYS_SYNC',
            entityType: 'GAME',
            entityId: input.target.id,
            beforeSnapshot: { playRows: input.target.plays.length },
            afterSnapshot: {
              provider: input.provider,
              usageMode: input.usageMode,
              playRows: input.rows.length,
              inserted: input.inserted,
              updated: input.updated,
            },
          },
        });
      },
      { timeout: 30_000 },
    );
  }
}
