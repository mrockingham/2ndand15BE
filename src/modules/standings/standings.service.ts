import { AppError } from '../../common/errors/app-error.js';
import type { Division, SeasonType } from '../../generated/prisma/client.js';
import type { StandingsRepository, StoredStandingsSnapshot } from './standings.repository.js';
import type { StandingsQuery } from './standings.schemas.js';
import type { StandingTeamDto, StandingsView } from './standings.types.js';

interface StandingsGroup {
  readonly key: string;
  readonly label: string;
  readonly teams?: readonly StandingTeamDto[];
  readonly children?: readonly StandingsGroup[];
}

export interface StandingsResult {
  readonly data: {
    readonly season: number;
    readonly seasonType: SeasonType;
    readonly view: StandingsView;
    readonly groups: readonly StandingsGroup[];
  };
  readonly meta: {
    readonly availableViews: readonly StandingsView[];
    readonly availableSeasonTypes: readonly SeasonType[];
    readonly provider: string;
    readonly updatedAt: string;
  };
}

export interface StandingsReader {
  getStandings(query: StandingsQuery): Promise<StandingsResult>;
}

const conferenceLabels = {
  AFC: 'American Football Conference',
  NFC: 'National Football Conference',
} as const;
const divisionOrder: readonly Division[] = ['East', 'North', 'South', 'West'];

export class StandingsService implements StandingsReader {
  constructor(private readonly repository: StandingsRepository) {}

  async getStandings(query: StandingsQuery): Promise<StandingsResult> {
    const [snapshot, availableSeasonTypes] = await Promise.all([
      this.repository.findSnapshot(query.season, query.seasonType),
      this.repository.findAvailableSeasonTypes(query.season),
    ]);
    if (snapshot === null) {
      throw new AppError({
        code: 'STANDINGS_NOT_FOUND',
        message: 'Standings are not available for the requested season and season type.',
        statusCode: 404,
      });
    }
    const allRows = snapshot.rows.filter((row) => row.team.isActive);
    const filteredRows = allRows.filter(
      (row) =>
        (query.conference === undefined || row.team.conference === query.conference) &&
        (query.division === undefined || row.team.division === query.division) &&
        (query.teamId === undefined || row.teamId === query.teamId),
    );
    return {
      data: {
        season: query.season,
        seasonType: query.seasonType,
        view: query.view,
        groups: buildGroups(query.view, filteredRows, snapshot),
      },
      meta: {
        availableViews: ['division', 'conference', 'league'],
        availableSeasonTypes,
        provider: snapshot.provider,
        updatedAt: snapshot.updatedAt.toISOString(),
      },
    };
  }
}

type StoredRow = StoredStandingsSnapshot['rows'][number];

function buildGroups(
  view: StandingsView,
  rows: readonly StoredRow[],
  snapshot: StoredStandingsSnapshot,
): readonly StandingsGroup[] {
  if (view === 'league') {
    return [
      {
        key: 'NFL',
        label: 'National Football League',
        teams: [...rows].sort(compareLeagueRows).map((row) => toDto(row, snapshot)),
      },
    ];
  }
  const conferences = (['AFC', 'NFC'] as const).filter((conference) =>
    rows.some((row) => row.team.conference === conference),
  );
  if (view === 'conference') {
    return conferences.map((conference) => ({
      key: conference,
      label: conferenceLabels[conference],
      teams: rows
        .filter((row) => row.team.conference === conference)
        .map((row) => toDto(row, snapshot)),
    }));
  }
  return conferences.map((conference) => ({
    key: conference,
    label: conferenceLabels[conference],
    children: divisionOrder
      .filter((division) =>
        rows.some((row) => row.team.conference === conference && row.team.division === division),
      )
      .map((division) => ({
        key: `${conference}_${division.toUpperCase()}`,
        label: `${conference} ${division}`,
        teams: rows
          .filter((row) => row.team.conference === conference && row.team.division === division)
          .map((row) => toDto(row, snapshot)),
      })),
  }));
}

function toDto(row: StoredRow, snapshot: StoredStandingsSnapshot): StandingTeamDto {
  return {
    teamId: row.teamId,
    name: row.team.fullName,
    abbreviation: row.team.abbreviation,
    conference: row.team.conference,
    division: row.team.division,
    season: snapshot.season,
    seasonType: snapshot.seasonType,
    wins: row.wins,
    losses: row.losses,
    ties: row.ties,
    winPercentage: row.winPercentage,
    homeWins: row.homeWins,
    homeLosses: row.homeLosses,
    homeTies: row.homeTies,
    awayWins: row.awayWins,
    awayLosses: row.awayLosses,
    awayTies: row.awayTies,
    divisionWins: row.divisionWins,
    divisionLosses: row.divisionLosses,
    divisionTies: row.divisionTies,
    conferenceWins: row.conferenceWins,
    conferenceLosses: row.conferenceLosses,
    conferenceTies: row.conferenceTies,
    nonConferenceWins: null,
    nonConferenceLosses: null,
    nonConferenceTies: null,
    pointsFor: row.pointsFor,
    pointsAgainst: row.pointsAgainst,
    pointDifferential: row.pointDifferential,
    streakType: row.streakType,
    streakLength: row.streakLength,
    streakDisplay: row.streakDisplay,
    lastFiveWins: null,
    lastFiveLosses: null,
    lastFiveTies: null,
    lastFiveDisplay: null,
    conferenceRank: row.conferenceRank,
    playoffSeed: row.playoffSeed,
    divisionRank: null,
    leagueRank: null,
    clinchedCode: null,
    eliminated: null,
  };
}

function compareLeagueRows(left: StoredRow, right: StoredRow): number {
  return (
    compareNullableDescending(left.winPercentage, right.winPercentage) ||
    compareNullableDescending(left.wins, right.wins) ||
    compareNullableDescending(left.pointDifferential, right.pointDifferential) ||
    left.providerOrder - right.providerOrder
  );
}
function compareNullableDescending(left: number | null, right: number | null): number {
  if (left === null) return right === null ? 0 : 1;
  if (right === null) return -1;
  return right - left;
}
