import { describe, expect, it } from 'vitest';

import {
  highlightlyBoxScoreResponseSchema,
  highlightlyDetailedMatchSchema,
  highlightlyPlayerProfileResponseSchema,
} from '../../evaluation/highlightly/highlightly-schemas.js';
import {
  normalizeHighlightlyCurrentGameDetails,
  normalizeHighlightlyPlayerProfile,
} from './highlightly-current-game-details-provider.js';

describe('normalizeHighlightlyCurrentGameDetails', () => {
  it('normalizes confirmed team totals, period scores, and every supported player category', () => {
    const result = normalizeHighlightlyCurrentGameDetails(detail(), boxScore());
    expect(result.homeTeamStats).toMatchObject({
      firstDowns: 23,
      totalPlays: 65,
      totalYards: 425,
      passingCompletions: 24,
      passingAttempts: 29,
      passingYards: 282,
      passingInterceptions: 0,
      rushingAttempts: 34,
      rushingYards: 143,
      turnovers: 0,
      sacks: 2,
      sackYardsLost: 12,
      possessionSeconds: 2061,
    });
    expect(result.homePeriodScores).toEqual({
      period1: 0,
      period2: 17,
      period3: 3,
      period4: 10,
      overtime1: null,
      overtime2: null,
    });
    expect(result.awayPeriodScores).toMatchObject({ period1: 0, period4: 16 });
    expect(result.playerStats[0]).toMatchObject({
      providerPlayerId: 'player-1',
      teamProviderId: 'ari-provider',
      passingCompletions: 0,
      passingAttempts: 0,
      passingYards: 0,
      rushingAttempts: 2,
      rushingYards: 3,
      targets: 1,
      receptions: 1,
      receivingYards: -1,
      tacklesTotal: 1,
      tacklesSolo: 0,
      fieldGoalsMade: 0,
      fieldGoalsAttempted: 0,
      punts: 1,
      puntAverage: 45.5,
      kickReturns: 1,
      puntReturns: 0,
    });
    expect(result.playerStats[0]?.longestPuntReturn).toBeNull();
    expect(result).toMatchObject({ scoringEventCount: 1, playCount: 2, structuredPlayCount: 1 });
  });

  it('rejects conflicting duplicate provider statistics', () => {
    const value = detail();
    value.matchStatistics?.homeTeam?.statistics.push({ name: 'Thrown Interceptions', value: 1 });
    expect(() => normalizeHighlightlyCurrentGameDetails(value, boxScore())).toThrow(
      'Conflicting Thrown Interceptions',
    );
  });

  it('rejects box-score team identities that do not match the detailed game', () => {
    const value = boxScore();
    const first = value[0];
    if (first === undefined) throw new Error('Expected first box-score team.');
    first.team.id = 'other-team';
    expect(() => normalizeHighlightlyCurrentGameDetails(detail(), value)).toThrow(
      'Box-score teams',
    );
  });
});

describe('normalizeHighlightlyPlayerProfile', () => {
  it('normalizes the verified runtime profile shape without exposing provider labels', () => {
    const record = highlightlyPlayerProfileResponseSchema.parse([
      {
        id: 123,
        fullName: 'Example Player',
        logo: null,
        profile: {
          fullName: 'Example Player',
          birthDate: '09.08.2000',
          birthPlace: 'Example, USA',
          height: `6' 2"`,
          weight: '215 lbs',
          jersey: '0',
          isActive: true,
          position: { main: 'Quarterback', abbreviation: 'QB' },
          draft: { year: 2023, round: 1, pick: 10 },
          team: {
            id: 99,
            name: 'Cardinals',
            displayName: 'Arizona Cardinals',
            abbreviation: 'ARI',
          },
        },
      },
    ])[0];
    if (record === undefined) throw new Error('Expected profile fixture.');
    expect(normalizeHighlightlyPlayerProfile(record)).toEqual({
      providerPlayerId: '123',
      displayName: 'Example Player',
      birthDate: '2000-08-09',
      position: 'QB',
      sourcePosition: 'Quarterback',
      jerseyNumber: 0,
      teamProviderId: '99',
      teamAbbreviation: 'ARI',
      heightInches: 74,
      weightPounds: 215,
      draftYear: 2023,
      draftRound: 1,
      draftPick: 10,
      isActive: true,
    });
  });

  it('preserves unavailable optional profile fields as null', () => {
    const record = highlightlyPlayerProfileResponseSchema.parse([
      {
        id: 124,
        fullName: 'Undrafted Player',
        profile: {
          fullName: 'Undrafted Player',
          birthDate: null,
          birthPlace: null,
          height: null,
          weight: null,
          jersey: null,
          isActive: null,
          position: null,
          draft: null,
          team: null,
        },
      },
    ])[0];
    if (record === undefined) throw new Error('Expected profile fixture.');
    expect(normalizeHighlightlyPlayerProfile(record)).toMatchObject({
      birthDate: null,
      position: null,
      jerseyNumber: null,
      teamProviderId: null,
      draftYear: null,
    });
  });
});

function detail() {
  const teamStatistics = [
    { name: 'Attempted Passes', value: 29 },
    { name: 'Completed Passes', value: 24 },
    { name: 'First Down Passing', value: 11 },
    { name: 'First Down Penalties', value: 1 },
    { name: 'First Down Rushing', value: 11 },
    { name: 'First Downs', value: 23 },
    { name: 'Forth Down Attempts', value: 1 },
    { name: 'Fourth Down Conversions', value: 0 },
    { name: 'Fumbles Lost', value: 0 },
    { name: 'Penalties Commited', value: 7 },
    { name: 'Penalty Yards', value: 78 },
    { name: 'Possession', value: '34:21' },
    { name: 'Red Zone Attempts', value: 6 },
    { name: 'Red Zone Conversions', value: 3 },
    { name: 'Rushing Attempts', value: 34 },
    { name: 'Rushing Yards', value: 143 },
    { name: 'Sacks-Yards Lost', value: '2-12' },
    { name: 'Team Passing Yards', value: 282 },
    { name: 'Third Down Attempts', value: 12 },
    { name: 'Third Down Conversions', value: 7 },
    { name: 'Thrown Interceptions', value: 0 },
    { name: 'Thrown Interceptions', value: 0 },
    { name: 'Total Drives', value: 9 },
    { name: 'Total Offensive Plays', value: 65 },
    { name: 'Total Yards', value: 425 },
    { name: 'Turnovers', value: 0 },
  ];
  return highlightlyDetailedMatchSchema.parse({
    id: 565788,
    round: 'Preseason',
    date: '2026-08-07T00:00:00.000Z',
    league: 'NFL',
    season: 2026,
    homeTeam: {
      id: 'ari-provider',
      name: 'Cardinals',
      displayName: 'Arizona Cardinals',
      abbreviation: 'ARI',
    },
    awayTeam: {
      id: 'car-provider',
      name: 'Panthers',
      displayName: 'Carolina Panthers',
      abbreviation: 'CAR',
    },
    state: {
      description: 'Finished',
      score: {
        current: '30 - 33',
        firstPeriod: '0 - 0',
        secondPeriod: '17 - 17',
        thirdPeriod: '3 - 0',
        fourthPeriod: '10 - 16',
        firstOvertimePeriod: null,
        secondOvertimePeriod: null,
      },
    },
    matchStatistics: {
      homeTeam: { statistics: teamStatistics },
      awayTeam: { statistics: teamStatistics },
    },
    events: [
      {
        isScoringPlay: true,
        plays: [
          'text play',
          { sequence: 1, quarter: 1, clock: '12:00', description: 'structured play' },
        ],
      },
    ],
  });
}

function boxScore() {
  const statistics = [
    ['Total Successful Passes', 0],
    ['Total Passes', 0],
    ['Total Passing Yards', 0],
    ['Total Passing Touchdowns', 0],
    ['Total Passing Interceptions', 0],
    ['Total Sacks', 0],
    ['Total Sack Yards Lost', 0],
    ['Total Rushing Attempts', 2],
    ['Total Rushing Yards', 3],
    ['Total Rushing Touchdowns', 0],
    ['Long Rushing', 4],
    ['Total Receiving Targets', 1],
    ['Total Receptions', 1],
    ['Total Receiving Yards', -1],
    ['Total Receiving Touchdowns', 0],
    ['Total Long Receptions', 5],
    ['Total Fumbles', 0],
    ['Total Recovered Fumbles', 0],
    ['Total Defensive Tackles', 1],
    ['Total Defensive Solo Tackles', 0],
    ['Total Defensive Sacks', 0],
    ['Total Defensive Tackles For Loss', 0],
    ['Total Defended Passes', 0],
    ['Total Defensive Touchdowns', 0],
    ['Successful Field Goals Kicks', 0],
    ['Attempted Field Goal Kicks', 0],
    ['Long Field Goals Kicks Made', 0],
    ['Total Extra Kicking Points Made', 0],
    ['Total Extra Kicking Point Attempts', 0],
    ['Total Punts', 1],
    ['Total Punting Yards', 45],
    ['Average Gross Punting Yards', 45.5],
    ['Punts Inside 20 Yards', 0],
    ['Punting Touchbacks', 0],
    ['Longest Punt Yardage', 45],
    ['Total Kick Returns', 1],
    ['Total Kick Return Yards', 20],
    ['Total Kick Return Touchdowns', 0],
    ['Longest Kick Return', 20],
    ['Total Punt Returns', 0],
    ['Total Punt Return Yards', 0],
    ['Total Punt Return Touchdowns', 0],
  ].map(([name, value]) => ({ name: String(name), value: Number(value) }));
  return highlightlyBoxScoreResponseSchema.parse([
    {
      team: {
        id: 'ari-provider',
        name: 'Cardinals',
        boxScores: [{ player: { id: 'player-1', name: 'Player One' }, statistics }],
      },
    },
    {
      team: {
        id: 'car-provider',
        name: 'Panthers',
        boxScores: [{ player: { id: 'player-2', name: 'Player Two' }, statistics: [] }],
      },
    },
  ]);
}
