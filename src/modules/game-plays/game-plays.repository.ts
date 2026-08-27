import type { GamePlayType, PrismaClient } from '../../generated/prisma/client.js';

export interface PublicGamePlayRow {
  readonly id: string;
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
}

export interface GamePlayRepository {
  findPlays(gameId: string): Promise<readonly PublicGamePlayRow[]>;
}

export class PrismaGamePlayRepository implements GamePlayRepository {
  constructor(private readonly prisma: PrismaClient) {}

  findPlays(gameId: string): Promise<readonly PublicGamePlayRow[]> {
    return this.prisma.gamePlay.findMany({
      where: { gameId, supersededAt: null },
      select: {
        id: true,
        sequence: true,
        period: true,
        clock: true,
        possessionTeamId: true,
        playType: true,
        description: true,
        startDown: true,
        startDistance: true,
        startYardLine: true,
        endDown: true,
        endDistance: true,
        endYardLine: true,
        isScoringPlay: true,
        isPenalty: true,
        isTurnover: true,
      },
      orderBy: { sequence: 'asc' },
    });
  }
}
