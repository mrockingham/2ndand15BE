import type { GamePlayType } from '../../generated/prisma/client.js';
import type { GameTeamSummaryDto } from '../games/game.dto.js';

export interface GamePlayDto {
  readonly id: string;
  readonly sequence: number;
  readonly period: number;
  readonly clock: string;
  readonly possessionTeam: GameTeamSummaryDto | null;
  readonly type: GamePlayType;
  readonly description: string;
  readonly start: {
    readonly down: number | null;
    readonly distance: number | null;
    readonly yardLine: number | null;
  };
  readonly end: {
    readonly down: number | null;
    readonly distance: number | null;
    readonly yardLine: number | null;
  };
  readonly flags: {
    readonly scoring: boolean;
    readonly penalty: boolean;
    readonly turnover: boolean;
  };
}

export interface GamePlaysResponse {
  readonly data: {
    readonly gameId: string;
    readonly playCount: number;
    readonly plays: readonly GamePlayDto[];
  };
  readonly meta: {
    readonly limitations: readonly string[];
  };
}
