import { AppError } from '../../common/errors/app-error.js';
import type { PublicArticleReader } from '../articles/article.service.js';
import type { GameDto } from '../games/game.dto.js';
import type { GameReader } from '../games/game.service.js';
import { NFLVERSE_PUBLIC_ATTRIBUTION } from '../players/player.dto.js';
import type { SeasonLeadersQuery } from '../stats-hub/stats.schemas.js';
import type { StatsHubReader } from '../stats-hub/stats.service.js';
import type { TeamReader } from '../teams/team.service.js';
import {
  decodeTeamRosterCursor,
  encodeTeamRosterCursor,
  type TeamRosterCursor,
} from './team-hub.cursor.js';
import {
  ROSTER_POSITION_GROUPS,
  ROSTER_POSITIONS,
  rosterPositionGroup,
  toTeamHubSummary,
  type TeamHubOverviewResponse,
  type TeamRosterCandidate,
  type TeamRosterResponse,
  type TeamRosterRow,
} from './team-hub.dto.js';
import type { TeamHubRepository } from './team-hub.repository.js';
import type { TeamRosterQuery, TeamStatLeadersQuery } from './team-hub.schemas.js';

const OVERVIEW_GAME_LIMIT = 3;
const OVERVIEW_ARTICLE_LIMIT = 3;
const TEAM_GAME_CANDIDATE_LIMIT = 100;
const ROSTER_POSITION_SET: ReadonlySet<string> = new Set(ROSTER_POSITIONS);
const ROSTER_POSITION_GROUP_SET: ReadonlySet<string> = new Set(ROSTER_POSITION_GROUPS);

export interface TeamHubReader {
  getOverview(teamId: string): Promise<TeamHubOverviewResponse>;
  getRoster(teamId: string, query: TeamRosterQuery): Promise<TeamRosterResponse>;
  getStatLeaders(teamId: string, query: TeamStatLeadersQuery): Promise<unknown>;
}

export interface TeamHubServiceOptions {
  readonly repository: TeamHubRepository;
  readonly teams: TeamReader;
  readonly games: GameReader;
  readonly articles: PublicArticleReader;
  readonly stats: Pick<StatsHubReader, 'getSeasonLeaders'>;
  readonly currentNflSeason: number;
}

export class TeamHubService implements TeamHubReader {
  constructor(private readonly options: TeamHubServiceOptions) {}

  async getOverview(teamId: string): Promise<TeamHubOverviewResponse> {
    const [teamResult, gameResult, articleResult, coverageResult] = await Promise.allSettled([
      this.options.teams.getActiveTeam(teamId),
      this.options.games.listTeamGames(teamId, {
        season: this.options.currentNflSeason,
        limit: TEAM_GAME_CANDIDATE_LIMIT,
      }),
      this.options.articles.listForTeam(teamId, { limit: OVERVIEW_ARTICLE_LIMIT }),
      this.options.repository.findCoverage(teamId),
    ]);
    if (teamResult.status === 'rejected') throw teamResult.reason;
    if (gameResult.status === 'rejected') throw gameResult.reason;
    if (articleResult.status === 'rejected') throw articleResult.reason;
    if (coverageResult.status === 'rejected') throw coverageResult.reason;
    const team = teamResult.value;
    const gamePage = gameResult.value;
    const articlePage = articleResult.value;
    const coverage = coverageResult.value;
    const positionGroups = uniqueSorted(coverage.positions.map(rosterPositionGroup));
    return {
      data: {
        team,
        schedule: {
          season: this.options.currentNflSeason,
          upcoming: selectUpcoming(gamePage.games),
          recent: selectRecent(gamePage.games),
        },
        news: { articles: articlePage.articles },
        historicalData: {
          defaultSeason: defaultHistoricalSeason(coverage.rosterSeasons, coverage.statSeasons),
          rosterSeasons: coverage.rosterSeasons,
          statSeasons: coverage.statSeasons,
          positions: coverage.positions,
          positionGroups,
          coverageNotes: [
            'Historical roster and player-stat coverage reflects imported nflverse data only.',
            'No current 2026 roster membership or live 2026 player statistics are inferred.',
          ],
        },
      },
      meta: { attribution: NFLVERSE_PUBLIC_ATTRIBUTION },
    };
  }

  async getRoster(teamId: string, query: TeamRosterQuery): Promise<TeamRosterResponse> {
    validateRosterFilters(query);
    const team = await this.options.teams.getActiveTeam(teamId);
    if (!(await this.options.repository.rosterSeasonExists(teamId, query.season))) {
      throw new AppError({
        code: 'TEAM_ROSTER_SEASON_NOT_AVAILABLE',
        message: `Historical roster data is not available for season ${String(query.season)}.`,
        statusCode: 400,
      });
    }
    const cursor =
      query.cursor === undefined ? undefined : decodeTeamRosterCursor(query.cursor, teamId, query);
    const candidates = await this.options.repository.findRosterCandidates(teamId, query.season);
    const filtered = candidates
      .filter((candidate) => matchesRosterFilters(candidate, query))
      .sort(compareRosterCandidates);
    const remaining =
      cursor === undefined
        ? filtered
        : filtered.filter((candidate) => compareCandidateToCursor(candidate, cursor) > 0);
    const selected = remaining.slice(0, query.limit);
    const hasMore = remaining.length > query.limit;
    const lastSelected = selected.at(-1);
    const historicalTeam = toTeamHubSummary(team);
    return {
      data: {
        team,
        season: query.season,
        roster: selected.map((candidate): TeamRosterRow => ({
          player: {
            id: candidate.playerId,
            displayName: candidate.displayName,
            headshotUrl: candidate.headshotUrl,
          },
          season: query.season,
          historicalTeam,
          latestKnownTeam: candidate.latestKnownTeam,
          position: candidate.position,
          positionGroup: rosterPositionGroup(candidate.position),
          jerseyNumber: candidate.jerseyNumber,
          status: candidate.status,
          firstWeek: candidate.firstWeek,
          lastWeek: candidate.lastWeek,
          rosterWeekCount: candidate.rosterWeekCount,
        })),
      },
      meta: {
        nextCursor:
          hasMore && lastSelected !== undefined
            ? encodeTeamRosterCursor(toCursor(teamId, query, lastSelected))
            : null,
        semantics: {
          membership:
            'A player appears when at least one stored weekly roster record links the player to this team and season.',
          firstWeek: 'Earliest stored roster week for the selected team and season.',
          lastWeek: 'Latest stored roster week for the selected team and season.',
          latestKnownTeam:
            'Latest team in the imported player profile; it is not current-season roster proof.',
        },
        attribution: NFLVERSE_PUBLIC_ATTRIBUTION,
      },
    };
  }

  getStatLeaders(teamId: string, query: TeamStatLeadersQuery): Promise<unknown> {
    const statsQuery: SeasonLeadersQuery = { ...query, teamId };
    return this.options.stats.getSeasonLeaders(statsQuery);
  }
}

function selectUpcoming(games: readonly GameDto[]): readonly GameDto[] {
  return games
    .filter(({ status }) => status === 'SCHEDULED' || status === 'PREGAME')
    .sort(compareUpcoming)
    .slice(0, OVERVIEW_GAME_LIMIT);
}

function selectRecent(games: readonly GameDto[]): readonly GameDto[] {
  return games
    .filter(({ status }) => status === 'FINAL')
    .sort((left, right) => compareUpcoming(right, left))
    .slice(0, OVERVIEW_GAME_LIMIT);
}

function compareUpcoming(left: GameDto, right: GameDto): number {
  if (left.startTime === null && right.startTime !== null) return 1;
  if (left.startTime !== null && right.startTime === null) return -1;
  return (
    (left.startTime ?? '').localeCompare(right.startTime ?? '') || left.id.localeCompare(right.id)
  );
}

function defaultHistoricalSeason(
  rosterSeasons: readonly number[],
  statSeasons: readonly number[],
): number | null {
  const statSet = new Set(statSeasons);
  return (
    rosterSeasons.find((season) => statSet.has(season)) ??
    rosterSeasons[0] ??
    statSeasons[0] ??
    null
  );
}

function validateRosterFilters(query: TeamRosterQuery): void {
  if (query.position !== undefined && !ROSTER_POSITION_SET.has(query.position)) {
    unsupportedRosterFilter('position', query.position);
  }
  if (query.positionGroup !== undefined && !ROSTER_POSITION_GROUP_SET.has(query.positionGroup)) {
    unsupportedRosterFilter('positionGroup', query.positionGroup);
  }
}

function unsupportedRosterFilter(field: string, value: string): never {
  throw new AppError({
    code: 'TEAM_ROSTER_POSITION_NOT_SUPPORTED',
    message: `The requested ${field} value ${value} is not supported.`,
    statusCode: 400,
  });
}

function matchesRosterFilters(candidate: TeamRosterCandidate, query: TeamRosterQuery): boolean {
  return (
    (query.position === undefined || candidate.position === query.position) &&
    (query.positionGroup === undefined ||
      rosterPositionGroup(candidate.position) === query.positionGroup) &&
    (query.search === undefined || candidate.normalizedName.includes(normalizeSearch(query.search)))
  );
}

function normalizeSearch(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function compareRosterCandidates(left: TeamRosterCandidate, right: TeamRosterCandidate): number {
  return (
    sortPositionGroup(left).localeCompare(sortPositionGroup(right)) ||
    sortPosition(left).localeCompare(sortPosition(right)) ||
    left.normalizedName.localeCompare(right.normalizedName) ||
    left.playerId.localeCompare(right.playerId)
  );
}

function compareCandidateToCursor(
  candidate: TeamRosterCandidate,
  cursor: TeamRosterCursor,
): number {
  return (
    sortPositionGroup(candidate).localeCompare(cursor.sortPositionGroup) ||
    sortPosition(candidate).localeCompare(cursor.sortPosition) ||
    candidate.normalizedName.localeCompare(cursor.normalizedName) ||
    candidate.playerId.localeCompare(cursor.playerId)
  );
}

function sortPositionGroup(candidate: TeamRosterCandidate): string {
  return rosterPositionGroup(candidate.position) ?? 'ZZZ';
}

function sortPosition(candidate: TeamRosterCandidate): string {
  return candidate.position ?? 'ZZZ';
}

function toCursor(
  teamId: string,
  query: TeamRosterQuery,
  candidate: TeamRosterCandidate,
): TeamRosterCursor {
  return {
    version: 1,
    teamId,
    season: query.season,
    position: query.position ?? null,
    positionGroup: query.positionGroup ?? null,
    search: query.search ?? null,
    sortPositionGroup: sortPositionGroup(candidate),
    sortPosition: sortPosition(candidate),
    normalizedName: candidate.normalizedName,
    playerId: candidate.playerId,
  };
}

function uniqueSorted(values: readonly (string | null)[]): readonly string[] {
  return [...new Set(values.filter((value): value is string => value !== null))].sort();
}
