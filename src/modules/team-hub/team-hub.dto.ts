import type { Team } from '../../generated/prisma/client.js';
import type { PublicArticleListDto } from '../articles/article.dto.js';
import type { GameDto } from '../games/game.dto.js';
import type { TeamDto } from '../teams/team.dto.js';
import type { PublicTeamHomepageDto } from '../team-homepage/team-homepage.dto.js';

export const ROSTER_POSITIONS = [
  'DB',
  'DL',
  'K',
  'LB',
  'LS',
  'OL',
  'P',
  'QB',
  'RB',
  'TE',
  'WR',
] as const;
export const ROSTER_POSITION_GROUPS = [
  'DB',
  'DL',
  'LB',
  'OL',
  'QB',
  'RB',
  'SPEC',
  'TE',
  'WR',
] as const;
const SPECIAL_POSITION_SET: ReadonlySet<string> = new Set(['K', 'LS', 'P']);

export interface TeamHubTeamSummary {
  readonly id: string;
  readonly abbreviation: string;
  readonly fullName: string;
}

export interface TeamRosterCandidate {
  readonly playerId: string;
  readonly displayName: string;
  readonly normalizedName: string;
  readonly headshotUrl: string | null;
  readonly position: string | null;
  readonly jerseyNumber: number | null;
  readonly status: string | null;
  readonly firstWeek: number;
  readonly lastWeek: number;
  readonly rosterWeekCount: number;
  readonly latestKnownTeam: TeamHubTeamSummary | null;
}

export interface TeamRosterRow {
  readonly player: {
    readonly id: string;
    readonly displayName: string;
    readonly headshotUrl: string | null;
  };
  readonly season: number;
  readonly historicalTeam: TeamHubTeamSummary;
  readonly latestKnownTeam: TeamHubTeamSummary | null;
  readonly position: string | null;
  readonly positionGroup: string | null;
  readonly jerseyNumber: number | null;
  readonly status: string | null;
  readonly firstWeek: number;
  readonly lastWeek: number;
  readonly rosterWeekCount: number;
}

export interface TeamHubOverviewResponse {
  readonly data: {
    readonly team: TeamDto;
    readonly schedule: {
      readonly season: number;
      readonly upcoming: readonly GameDto[];
      readonly recent: readonly GameDto[];
    };
    readonly news: { readonly articles: readonly PublicArticleListDto[] };
    readonly homepage: PublicTeamHomepageDto;
    readonly historicalData: {
      readonly defaultSeason: number | null;
      readonly rosterSeasons: readonly number[];
      readonly statSeasons: readonly number[];
      readonly positions: readonly string[];
      readonly positionGroups: readonly string[];
      readonly coverageNotes: readonly string[];
    };
  };
  readonly meta: {
    readonly attribution: {
      readonly source: 'nflverse';
      readonly license: 'CC BY 4.0';
      readonly url: 'https://github.com/nflverse/nflverse-data';
    };
  };
}

export interface TeamRosterResponse {
  readonly data: {
    readonly team: TeamDto;
    readonly season: number;
    readonly roster: readonly TeamRosterRow[];
  };
  readonly meta: {
    readonly nextCursor: string | null;
    readonly semantics: {
      readonly membership: string;
      readonly firstWeek: string;
      readonly lastWeek: string;
      readonly latestKnownTeam: string;
    };
    readonly attribution: TeamHubOverviewResponse['meta']['attribution'];
  };
}

export function rosterPositionGroup(position: string | null): string | null {
  if (position === null) return null;
  return SPECIAL_POSITION_SET.has(position) ? 'SPEC' : position;
}

export function toTeamHubSummary(team: TeamDto | Team): TeamHubTeamSummary {
  return { id: team.id, abbreviation: team.abbreviation, fullName: team.fullName };
}
