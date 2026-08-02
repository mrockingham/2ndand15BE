import { readFile } from 'node:fs/promises';

import { describe, expect, it, vi } from 'vitest';

import { mockNflTeamsFixture } from '../../providers/mock/nfl-teams.fixture.js';
import {
  HighlightlyEvaluator,
  serializeHighlightlyEvaluationReport,
} from './highlightly-evaluator.js';
import {
  HighlightlyEvaluationHttpClient,
  type HighlightlyFetch,
} from './highlightly-http-client.js';
import { highlightlyMatchDetailResponseSchema } from './highlightly-schemas.js';

describe('HighlightlyEvaluator', () => {
  it('stops after league/team and season discovery when 2026 has no schedule', async () => {
    const fetchImplementation = vi.fn<HighlightlyFetch>().mockImplementation((input) => {
      const url = new URL(String(input));
      if (url.pathname === '/teams') return Promise.resolve(Response.json(providerTeams()));
      return Promise.resolve(Response.json(matchPage([], 0, 0, 100)));
    });
    const evaluator = createEvaluator(fetchImplementation);

    const report = await evaluator.evaluateDetailed();

    expect(report.requestCount).toBe(2);
    expect(report.currentSeasonSuitability).toBe('failed');
    expect(report.schedule).toMatchObject({ season: 2026, retrieved: 0 });
    expect(report.summary.currentSeasonAvailability).toMatchObject({
      state: 'verified',
      value: false,
    });
    expect(report.summary.findings).toContainEqual(
      expect.objectContaining({ level: 'failure', code: 'CURRENT_SEASON_SUITABILITY' }),
    );
    expect(fetchImplementation).toHaveBeenCalledTimes(2);
  });

  it('paginates the complete schedule and analyzes teams, fields, statuses, plays, and animation', async () => {
    const matches = currentSeasonMatches();
    const fetchImplementation = vi.fn<HighlightlyFetch>().mockImplementation((input) => {
      const url = new URL(String(input));
      if (url.pathname === '/teams') return Promise.resolve(Response.json(providerTeams()));
      if (url.pathname === '/matches') {
        const offset = Number(url.searchParams.get('offset'));
        const page = offset === 0 ? matches.slice(0, 8) : matches.slice(8);
        return Promise.resolve(Response.json(matchPage(page, matches.length, offset, 8)));
      }
      if (url.pathname.startsWith('/matches/')) {
        return Promise.resolve(Response.json([detailedMatch(requireValue(matches.at(-1)))]));
      }
      if (url.pathname === '/standings') return Promise.resolve(Response.json(standings()));
      return Promise.resolve(Response.json({ message: 'unexpected' }, { status: 400 }));
    });
    const evaluator = createEvaluator(fetchImplementation);

    const report = await evaluator.evaluateDetailed();

    expect(report.requestCount).toBe(5);
    expect(report.teams).toMatchObject({
      returned: 32,
      uniqueIds: 32,
      deterministicallyMapped: 32,
      allCurrentTeamsMapped: true,
      logoUrlPresent: 32,
    });
    expect(report.schedule).toMatchObject({
      retrieved: 16,
      paginationRequired: true,
      paginationComplete: true,
      allKickoffsValidUtc: true,
      uniqueTeamsObserved: 32,
      countsBySeasonType: { PRE: 8, REG: 8, POST: 0, OTHER: 0 },
      statusesObserved: ['Finished', 'Scheduled'],
    });
    expect(report.gameFieldCoverage.startTime?.state).toBe('present_populated');
    expect(report.gameFieldCoverage.gameClock?.state).toBe('present_nullable');
    expect(report.playByPlay).toMatchObject({
      completedGameInspected: true,
      eventCount: 1,
      playCount: 1,
      appearsToBeDetailedPlayByPlay: true,
    });
    expect(report.playByPlay.fields.down?.state).toBe('present_populated');
    expect(report.animationSuitability.level1BasicField.state).toBe('supported');
    expect(report.animationSuitability.level2DetailedReconstruction.state).toBe('supported');
    expect(report.animationSuitability.level3ExactReplay.state).toBe('unsupported');
    expect(report.capabilities.standings?.state).toBe('accessible_validated');
    expect(fetchImplementation).toHaveBeenCalledTimes(5);
  });

  it('validates play-by-play envelopes and rejects malformed play records', () => {
    const match = requireValue(currentSeasonMatches()[0]);
    expect(highlightlyMatchDetailResponseSchema.safeParse([detailedMatch(match)]).success).toBe(
      true,
    );
    expect(
      highlightlyMatchDetailResponseSchema.safeParse([
        { ...detailedMatch(match), events: [{ plays: [42] }] },
      ]).success,
    ).toBe(false);
  });

  it('sanitizes reports and rejects configured credentials or credential headers', async () => {
    const fetchImplementation = vi.fn<HighlightlyFetch>().mockImplementation((input) => {
      const url = new URL(String(input));
      return Promise.resolve(
        Response.json(url.pathname === '/teams' ? providerTeams() : matchPage([], 0, 0, 100)),
      );
    });
    const report = await createEvaluator(fetchImplementation).evaluateDetailed();
    const secret = 'credential-that-must-not-be-saved';

    const serialized = serializeHighlightlyEvaluationReport(report, [secret]);
    expect(serialized).toContain('directly_verified');
    expect(serialized).toContain('officially_documented');
    expect(serialized).toContain('unverified');
    expect(serialized).not.toContain(secret);
    expect(() =>
      serializeHighlightlyEvaluationReport(
        {
          ...report,
          finalRecommendation: `Never save ${secret}`,
        },
        [secret],
      ),
    ).toThrow('configured credential');
    expect(() =>
      serializeHighlightlyEvaluationReport({
        ...report,
        finalRecommendation: 'x-rapidapi-key must stay private',
      }),
    ).toThrow('credential header');
  });

  it('keeps the evaluation implementation and command free of database access', async () => {
    const sources = await Promise.all([
      readFile('src/modules/sports/evaluation/highlightly/highlightly-evaluator.ts', 'utf8'),
      readFile('src/modules/sports/evaluation/highlightly/highlightly-http-client.ts', 'utf8'),
      readFile('src/commands/evaluate-highlightly.ts', 'utf8'),
    ]);
    for (const source of sources) {
      expect(source).not.toMatch(/Prisma|DATABASE_URL|common\/database/i);
    }
  });
});

function createEvaluator(fetchImplementation: HighlightlyFetch): HighlightlyEvaluator {
  return new HighlightlyEvaluator({
    client: new HighlightlyEvaluationHttpClient({
      baseUrl: 'https://example.test',
      apiKey: 'test-key',
      requestTimeoutMs: 1_000,
      maxRetries: 0,
      fetchImplementation,
    }),
    season: 2026,
    now: () => new Date('2026-08-01T18:00:00.000Z'),
  });
}

function providerTeams() {
  return mockNflTeamsFixture.map((team, index) => ({
    id: index + 1,
    logo: `https://images.example.test/${String(index + 1)}.png`,
    name: team.name,
    displayName: team.fullName,
    abbreviation: team.abbreviation,
    league: 'NFL',
  }));
}

function currentSeasonMatches() {
  const teams = providerTeams();
  return Array.from({ length: 16 }, (_unused, index) => {
    const finished = index === 15;
    const awayTeam = requireValue(teams[index * 2]);
    const homeTeam = requireValue(teams[index * 2 + 1]);
    return {
      id: 200 + index,
      round: `${index < 8 ? 'Preseason' : 'Regular Season'} - ${String((index % 8) + 1)}`,
      date: `2026-${index < 8 ? '08' : '09'}-${String((index % 8) + 1).padStart(2, '0')}T20:00:00.000Z`,
      league: 'NFL',
      season: 2026,
      awayTeam,
      homeTeam,
      state: {
        period: finished ? 4 : null,
        clock: finished ? '00:00' : null,
        description: finished ? 'Finished' : 'Scheduled',
        score: { current: finished ? '21 - 17' : null },
        report: finished ? 'Final' : null,
      },
    };
  });
}

function requireValue<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Expected test fixture value.');
  return value;
}

function matchPage(data: readonly unknown[], totalCount: number, offset: number, limit: number) {
  return {
    data,
    pagination: { totalCount, offset, limit },
    plan: { tier: 'BASIC', message: 'Limited plan response.' },
  };
}

function detailedMatch(match: ReturnType<typeof currentSeasonMatches>[number]) {
  return {
    ...match,
    venue: { city: 'Canton', name: 'Example Stadium', state: 'OH' },
    neutralSite: false,
    broadcast: ['Example Network'],
    updatedAt: '2026-08-01T17:59:00.000Z',
    matchStatistics: {
      homeTeam: { statistics: [{ name: 'Rushing Attempts', value: 30 }] },
      awayTeam: { statistics: [{ name: 'Rushing Attempts', value: 28 }] },
    },
    injuries: [],
    boxScores: [
      {
        id: match.homeTeam.id,
        name: match.homeTeam.displayName,
        boxScores: [
          {
            player: { id: 9001, name: 'Example Player', position: 'Running Back' },
            statistics: [{ name: 'Rushing Yards', value: 75 }],
          },
        ],
      },
    ],
    predictions: { prematch: [] },
    events: [
      {
        id: 3001,
        team: match.homeTeam,
        start: { clock: '12:00', period: '1st quarter', yardLine: 25, sideOfField: 'HOME' },
        end: { clock: '11:20', period: '1st quarter', yardLine: 32, sideOfField: 'HOME' },
        result: 'Rush',
        description: 'One play, seven yards',
        isScoringPlay: false,
        plays: [
          {
            id: 4001,
            sequence: 1,
            driveId: 3001,
            quarter: 1,
            clock: '12:00',
            down: 1,
            distance: 10,
            possession: match.homeTeam.displayName,
            yardLine: 25,
            sideOfField: 'HOME',
            startPosition: 'HOME 25',
            endPosition: 'HOME 32',
            type: 'Rush',
            description: 'Example Player rushes right for seven yards.',
            yardsGained: 7,
            firstDown: false,
            scoringPlay: false,
            touchdown: false,
            rushDirection: 'right',
            rusher: { id: 9001, name: 'Example Player' },
            tacklers: [{ id: 9002, name: 'Example Tackler' }],
            penalties: [{ description: null }],
            teamStatistics: [{ name: 'Drive Plays', value: 1 }],
            playerStatistics: [{ name: 'Rushing Yards', value: 7 }],
          },
        ],
      },
    ],
  };
}

function standings() {
  return {
    data: [
      {
        leagueName: 'American Football Conference',
        abbreviation: 'AFC',
        year: 2026,
        leagueType: 'NFL',
        seasonType: 'Preseason',
        startDate: '2026-08-01T00:00:00.000Z',
        endDate: '2026-09-01T00:00:00.000Z',
        data: [
          {
            team: providerTeams()[0],
            statistics: [{ displayName: 'Wins', value: '0' }],
          },
        ],
      },
    ],
    pagination: { totalCount: 1, offset: 0, limit: 10 },
    plan: { tier: 'test' },
  };
}
