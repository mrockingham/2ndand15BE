import type { Prisma } from '../../generated/prisma/client.js';
import { formatGameClock } from './game-clock.js';

export const publicGameInclude = {
  homeTeam: true,
  awayTeam: true,
  editorialOverride: true,
} satisfies Prisma.GameInclude;

export type GameWithTeams = Prisma.GameGetPayload<{ include: typeof publicGameInclude }>;

export interface GameTeamSummaryDto {
  readonly id: string;
  readonly fullName: string;
  readonly abbreviation: string;
  readonly logoUrl: string | null;
  readonly primaryColor: string;
  readonly secondaryColor: string;
}

export interface GameDto {
  readonly id: string;
  readonly league: 'NFL';
  readonly season: number;
  readonly seasonType: 'PRE' | 'REG' | 'POST';
  readonly week: number | null;
  readonly startTime: string | null;
  readonly status:
    | 'SCHEDULED'
    | 'PREGAME'
    | 'IN_PROGRESS'
    | 'HALFTIME'
    | 'FINAL'
    | 'POSTPONED'
    | 'CANCELED'
    | 'SUSPENDED';
  readonly homeTeam: GameTeamSummaryDto;
  readonly awayTeam: GameTeamSummaryDto;
  readonly homeScore: number | null;
  readonly awayScore: number | null;
  readonly quarter: number | null;
  readonly clock: string | null;
  readonly venue: { readonly name: string | null; readonly city: string | null };
  readonly broadcastNetwork: string | null;
  readonly isNeutralSite: boolean;
}

export function toGameDto(game: GameWithTeams): GameDto {
  const override = game.editorialOverride;
  return {
    id: game.id,
    league: game.league,
    season: game.season,
    seasonType: game.seasonType,
    week: override?.week ?? game.week,
    startTime: (override?.startTime ?? game.startTime)?.toISOString() ?? null,
    status: override?.status ?? game.status,
    homeTeam: toTeamSummary(game.homeTeam),
    awayTeam: toTeamSummary(game.awayTeam),
    homeScore: override?.homeScore ?? game.homeScore,
    awayScore: override?.awayScore ?? game.awayScore,
    quarter: game.quarter,
    clock: formatGameClock(game.clock),
    venue: {
      name: override?.venueName ?? game.venueName,
      city: override?.venueCity ?? game.venueCity,
    },
    broadcastNetwork: override?.broadcastNetwork ?? game.broadcastNetwork,
    isNeutralSite: override?.isNeutralSite ?? game.isNeutralSite,
  };
}

export function toTeamSummary(team: GameWithTeams['homeTeam']): GameTeamSummaryDto {
  return {
    id: team.id,
    fullName: team.fullName,
    abbreviation: team.abbreviation,
    logoUrl: team.logoUrl,
    primaryColor: team.primaryColor,
    secondaryColor: team.secondaryColor,
  };
}
