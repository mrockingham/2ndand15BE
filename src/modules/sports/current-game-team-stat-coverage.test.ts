import { describe, expect, it } from 'vitest';

import type { CurrentGameTeamStatWrite } from './current-game-details.repository.js';
import {
  classifyCurrentGameTeamStats,
  summarizeCurrentGameTeamStatCoverage,
} from './current-game-team-stat-coverage.js';

const base = {
  gameId: 'game',
  firstDowns: 0,
  firstDownsPassing: 0,
  firstDownsRushing: 0,
  firstDownsPenalty: 0,
  totalPlays: 0,
  totalYards: 0,
  passingCompletions: 0,
  passingAttempts: 0,
  passingYards: 0,
  passingInterceptions: 0,
  rushingAttempts: 0,
  rushingYards: 0,
  turnovers: 0,
  fumblesLost: 0,
  sacks: 0,
  sackYardsLost: 0,
  thirdDownConversions: 0,
  thirdDownAttempts: 0,
  fourthDownConversions: 0,
  fourthDownAttempts: 0,
  penalties: 0,
  penaltyYards: 0,
  possessionSeconds: 0,
  redZoneConversions: 0,
  redZoneAttempts: 0,
  totalDrives: 0,
  period1Score: 0,
  period2Score: 0,
  period3Score: 0,
  period4Score: 0,
  overtime1Score: null,
  overtime2Score: null,
  sourceProvider: 'highlightly',
  sourceUpdatedAt: new Date('2026-08-21T12:00:00.000Z'),
} satisfies Omit<CurrentGameTeamStatWrite, 'teamId' | 'isHome'>;

function rows(): readonly CurrentGameTeamStatWrite[] {
  return [
    { ...base, teamId: 'home', isHome: true },
    { ...base, teamId: 'away', isHome: false },
  ];
}

describe('classifyCurrentGameTeamStats', () => {
  it('classifies two correctly oriented core-complete rows as complete and counts zero', () => {
    expect(
      classifyCurrentGameTeamStats({ rows: rows(), homeTeamId: 'home', awayTeamId: 'away' }),
    ).toMatchObject({
      classification: 'COMPLETE',
      rowCount: 2,
      orientationValid: true,
      fields: { passingYards: { nonNull: 2, total: 2 }, overtime1Score: { nonNull: 0, total: 2 } },
    });
  });

  it('classifies missing core data or invalid orientation as partial', () => {
    const missing = rows().map((row, index) =>
      index === 0 ? { ...row, passingYards: null } : row,
    );
    expect(
      classifyCurrentGameTeamStats({ rows: missing, homeTeamId: 'home', awayTeamId: 'away' }),
    ).toMatchObject({ classification: 'PARTIAL', fields: { passingYards: { nonNull: 1 } } });
    expect(
      classifyCurrentGameTeamStats({ rows: rows(), homeTeamId: 'away', awayTeamId: 'home' }),
    ).toMatchObject({ classification: 'PARTIAL', orientationValid: false });
  });

  it('classifies no usable rows as unavailable', () => {
    expect(
      classifyCurrentGameTeamStats({ rows: [], homeTeamId: 'home', awayTeamId: 'away' }),
    ).toMatchObject({ classification: 'UNAVAILABLE', rowCount: 0 });
  });

  it('summarizes game classifications and field coverage without treating unavailable as rows', () => {
    const complete = classifyCurrentGameTeamStats({
      rows: rows(),
      homeTeamId: 'home',
      awayTeamId: 'away',
    });
    const unavailable = classifyCurrentGameTeamStats({
      rows: [],
      homeTeamId: 'home',
      awayTeamId: 'away',
    });

    expect(summarizeCurrentGameTeamStatCoverage([complete, unavailable])).toMatchObject({
      games: { COMPLETE: 1, PARTIAL: 0, UNAVAILABLE: 1 },
      fields: {
        passingYards: { nonNull: 2, total: 2 },
        overtime1Score: { nonNull: 0, total: 2 },
      },
    });
  });
});
