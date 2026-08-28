import { describe, expect, it } from 'vitest';
import type { StandingsSnapshot, Team, TeamStanding } from '../../generated/prisma/client.js';
import type { StandingsRepository, StoredStandingsSnapshot } from './standings.repository.js';
import { StandingsService } from './standings.service.js';

describe('StandingsService', () => {
  it('builds division, conference, and league views while keeping unavailable fields null', async () => {
    const snapshot = createSnapshot();
    const service = new StandingsService(repository(snapshot));
    const division = await service.getStandings({
      season: 2026,
      seasonType: 'PRE',
      view: 'division',
    });
    expect(division.data.groups.map((group) => group.key)).toEqual(['AFC', 'NFC']);
    expect(division.data.groups[0]?.children?.map((group) => group.key)).toEqual([
      'AFC_EAST',
      'AFC_NORTH',
    ]);
    expect(division.data.groups[0]?.children?.[0]?.teams?.[0]).toMatchObject({
      abbreviation: 'BUF',
      nonConferenceWins: null,
      lastFiveDisplay: null,
      divisionRank: null,
      leagueRank: null,
      clinchedCode: null,
      eliminated: null,
    });

    const conference = await service.getStandings({
      season: 2026,
      seasonType: 'PRE',
      view: 'conference',
      conference: 'AFC',
    });
    expect(conference.data.groups).toHaveLength(1);
    expect(conference.data.groups[0]?.teams?.map((team) => team.abbreviation)).toEqual([
      'BUF',
      'BAL',
    ]);

    const league = await service.getStandings({ season: 2026, seasonType: 'PRE', view: 'league' });
    expect(league.data.groups[0]?.teams?.map((team) => team.abbreviation)).toEqual([
      'BUF',
      'PHI',
      'BAL',
    ]);
  });

  it('filters by internal team ID without exposing provider identity', async () => {
    const snapshot = createSnapshot();
    const service = new StandingsService(repository(snapshot));
    const selectedRow = snapshot.rows.at(1);
    if (selectedRow === undefined) throw new Error('Expected a standings test row.');
    const result = await service.getStandings({
      season: 2026,
      seasonType: 'PRE',
      view: 'league',
      teamId: selectedRow.teamId,
    });
    expect(result.data.groups[0]?.teams).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain('providerTeamId');
  });
});

function repository(snapshot: StoredStandingsSnapshot): StandingsRepository {
  return {
    findSnapshot: () => Promise.resolve(snapshot),
    findAvailableSeasonTypes: () => Promise.resolve(['PRE', 'REG']),
  };
}

function createSnapshot(): StoredStandingsSnapshot {
  const base: StandingsSnapshot = {
    id: '00000000-0000-4000-8000-000000000100',
    provider: 'highlightly',
    season: 2026,
    seasonType: 'PRE',
    updatedAt: new Date('2026-08-28T12:00:00Z'),
    createdAt: new Date('2026-08-28T12:00:00Z'),
  };
  return {
    ...base,
    rows: [
      row('BUF', 'AFC', 'East', 0, 3, 0, 1),
      row('BAL', 'AFC', 'North', 1, 1, 1, 2),
      row('PHI', 'NFC', 'East', 100, 2, 0, 1),
    ],
  };
}

function row(
  abbreviation: string,
  conference: 'AFC' | 'NFC',
  division: 'East' | 'North',
  providerOrder: number,
  wins: number,
  losses: number,
  conferenceRank: number,
): TeamStanding & { team: Team } {
  const teamId = `00000000-0000-4000-8000-${String(providerOrder + 1).padStart(12, '0')}`;
  return {
    id: teamId,
    snapshotId: '00000000-0000-4000-8000-000000000100',
    teamId,
    providerOrder,
    conferenceRank,
    playoffSeed: conferenceRank,
    wins,
    losses,
    ties: 0,
    winPercentage: wins / Math.max(1, wins + losses),
    homeWins: wins,
    homeLosses: losses,
    homeTies: 0,
    awayWins: 0,
    awayLosses: 0,
    awayTies: 0,
    divisionWins: 0,
    divisionLosses: 0,
    divisionTies: 0,
    conferenceWins: wins,
    conferenceLosses: losses,
    conferenceTies: 0,
    pointsFor: wins * 20,
    pointsAgainst: losses * 20,
    pointDifferential: wins * 20 - losses * 20,
    streakType: 'W',
    streakLength: wins,
    streakDisplay: `W${String(wins)}`,
    team: {
      id: teamId,
      league: 'NFL',
      city: abbreviation,
      name: abbreviation,
      fullName: `${abbreviation} Team`,
      abbreviation,
      conference,
      division,
      primaryColor: '#000000',
      secondaryColor: '#FFFFFF',
      logoUrl: null,
      logoSource: null,
      isActive: true,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    },
  };
}
