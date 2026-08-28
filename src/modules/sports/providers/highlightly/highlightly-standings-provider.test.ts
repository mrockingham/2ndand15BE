import { describe, expect, it, vi } from 'vitest';
import type { HighlightlyEvaluationHttpClient } from '../../evaluation/highlightly/highlightly-http-client.js';
import { HighlightlyStandingsProvider } from './highlightly-standings-provider.js';

describe('HighlightlyStandingsProvider', () => {
  it('selects the most complete duplicate provider snapshot and normalizes allowlisted fields', async () => {
    const groups = [
      group('AFC', 0),
      group('AFC', 2),
      group('NFC', 0),
      group('NFC', 1),
      { ...group('AFC', 0), seasonType: 'Regular Season' },
    ];
    const client = {
      get: vi.fn().mockResolvedValue({
        data: groups,
        pagination: { totalCount: groups.length, offset: 0, limit: 10 },
      }),
    } as unknown as HighlightlyEvaluationHttpClient;
    const records = await new HighlightlyStandingsProvider(client).getStandings({
      season: 2026,
      seasonType: 'PRE',
    });

    expect(records).toHaveLength(32);
    expect(records[0]).toMatchObject({
      provider: 'highlightly',
      conference: 'AFC',
      wins: 2,
      losses: 1,
      ties: 0,
      winPercentage: 0.667,
      homeWins: 1,
      homeLosses: 0,
      awayWins: 1,
      awayLosses: 1,
      conferenceWins: 2,
      conferenceLosses: 1,
      divisionWins: 1,
      divisionLosses: 0,
      pointsFor: 70,
      pointsAgainst: 50,
      pointDifferential: 20,
      streakType: 'W',
      streakLength: 2,
      streakDisplay: 'W2',
    });
  });

  it('rejects postseason and incomplete NFL snapshots', async () => {
    const client = {
      get: vi.fn().mockResolvedValue({
        data: [group('AFC', 1)],
        pagination: { totalCount: 1, offset: 0, limit: 10 },
      }),
    } as unknown as HighlightlyEvaluationHttpClient;
    const provider = new HighlightlyStandingsProvider(client);
    await expect(provider.getStandings({ season: 2026, seasonType: 'POST' })).rejects.toThrow(
      'postseason',
    );
    await expect(provider.getStandings({ season: 2026, seasonType: 'PRE' })).rejects.toThrow('NFC');
  });

  it('normalizes the documented Washington provider alias to the canonical team key', async () => {
    const afc = group('AFC', 1);
    const nfc = group('NFC', 1);
    const washington = nfc.data.at(0);
    if (washington === undefined) throw new Error('Expected an NFC test row.');
    washington.team.abbreviation = 'WSH';
    const client = {
      get: vi.fn().mockResolvedValue({
        data: [afc, nfc],
        pagination: { totalCount: 2, offset: 0, limit: 10 },
      }),
    } as unknown as HighlightlyEvaluationHttpClient;
    const records = await new HighlightlyStandingsProvider(client).getStandings({
      season: 2026,
      seasonType: 'PRE',
    });
    expect(records.find((record) => record.providerTeamId === '90016')?.teamAbbreviation).toBe(
      'WAS',
    );
  });
});

function group(conference: 'AFC' | 'NFC', wins: number) {
  const offset = conference === 'AFC' ? 0 : 16;
  return {
    leagueName:
      conference === 'AFC' ? 'American Football Conference' : 'National Football Conference',
    abbreviation: conference,
    year: 2026,
    seasonType: 'Preseason',
    leagueType: 'NFL',
    data: Array.from({ length: 16 }, (_, index) => ({
      team: {
        id: 90_000 + offset + index,
        name: `Team ${String(offset + index)}`,
        displayName: `NFL Team ${String(offset + index)}`,
        abbreviation: `T${String(offset + index).padStart(2, '0')}`,
      },
      statistics: [
        { displayName: 'Wins', value: String(wins) },
        { displayName: 'Losses', value: '1' },
        { displayName: 'Ties', value: '0' },
        { displayName: 'Win Percentage', value: '.667' },
        { displayName: 'Home Record', value: '1-0' },
        { displayName: 'Road Record', value: '1-1' },
        { displayName: 'Versus Division', value: '1-0' },
        { displayName: 'Versus Conference', value: '2-1' },
        { displayName: 'Points For', value: '70' },
        { displayName: 'Points Against', value: '50' },
        { displayName: 'Point Differential', value: '20' },
        { displayName: 'Streak', value: 'W2' },
        { displayName: 'Playoff Seed', value: '2' },
      ],
    })),
  };
}
