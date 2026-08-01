import { describe, expect, it } from 'vitest';

import { MockSportsDataProvider } from './mock-sports-data-provider.js';

describe('MockSportsDataProvider', () => {
  it('returns all 32 active NFL teams with unique provider and application keys', async () => {
    const { records: teams } = await new MockSportsDataProvider().getTeams();

    expect(teams).toHaveLength(32);
    expect(new Set(teams.map((team) => team.league))).toEqual(new Set(['NFL']));
    expect(teams.every((team) => team.isActive)).toBe(true);
    expect(new Set(teams.map((team) => `${team.provider}:${team.providerTeamId}`)).size).toBe(32);
    expect(new Set(teams.map((team) => `${team.league}:${team.abbreviation}`)).size).toBe(32);
  });

  it('contains four teams in every conference and division', async () => {
    const { records: teams } = await new MockSportsDataProvider().getTeams();

    for (const conference of ['AFC', 'NFC'] as const) {
      for (const division of ['East', 'North', 'South', 'West'] as const) {
        expect(
          teams.filter((team) => team.conference === conference && team.division === division),
        ).toHaveLength(4);
      }
    }
  });

  it('uses nullable external asset metadata without bundled logos', async () => {
    const { records: teams } = await new MockSportsDataProvider().getTeams();

    expect(teams.every((team) => team.logoUrl === null && team.logoSource === null)).toBe(true);
  });

  it('returns validated development games covering schedule states and filters', async () => {
    const provider = new MockSportsDataProvider();
    const { records: games } = await provider.getGames({});
    expect(games.length).toBeGreaterThanOrEqual(8);
    expect(new Set(games.map((game) => game.seasonType))).toEqual(new Set(['PRE', 'REG', 'POST']));
    expect([...new Set(games.map((game) => game.status))]).toEqual(
      expect.arrayContaining([
        'SCHEDULED',
        'PREGAME',
        'IN_PROGRESS',
        'FINAL',
        'POSTPONED',
        'CANCELED',
      ]),
    );
    expect(games.some((game) => game.status === 'FINAL' && game.homeScore !== null)).toBe(true);
    expect(games.some((game) => game.status === 'SCHEDULED' && game.homeScore === null)).toBe(true);
    const { records: buffalo } = await provider.getGames({ teamId: 'nfl-buf' });
    expect(buffalo).toHaveLength(2);
    expect(
      buffalo.every(
        (game) => game.homeProviderTeamId === 'nfl-buf' || game.awayProviderTeamId === 'nfl-buf',
      ),
    ).toBe(true);
  });

  it('retrieves a game by provider identity without exposing provider payloads', async () => {
    const provider = new MockSportsDataProvider();
    await expect(provider.getGameByProviderId('dev-2026-reg-2-kc-den')).resolves.toMatchObject({
      status: 'FINAL',
      homeScore: 27,
    });
    await expect(provider.getGameByProviderId('missing')).resolves.toBeNull();
  });
});
