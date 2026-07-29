import { describe, expect, it } from 'vitest';

import { MockSportsDataProvider } from './mock-sports-data-provider.js';

describe('MockSportsDataProvider', () => {
  it('returns all 32 active NFL teams with unique provider and application keys', async () => {
    const teams = await new MockSportsDataProvider().getTeams();

    expect(teams).toHaveLength(32);
    expect(new Set(teams.map((team) => team.league))).toEqual(new Set(['NFL']));
    expect(teams.every((team) => team.isActive)).toBe(true);
    expect(new Set(teams.map((team) => `${team.provider}:${team.providerTeamId}`)).size).toBe(32);
    expect(new Set(teams.map((team) => `${team.league}:${team.abbreviation}`)).size).toBe(32);
  });

  it('contains four teams in every conference and division', async () => {
    const teams = await new MockSportsDataProvider().getTeams();

    for (const conference of ['AFC', 'NFC'] as const) {
      for (const division of ['East', 'North', 'South', 'West'] as const) {
        expect(
          teams.filter((team) => team.conference === conference && team.division === division),
        ).toHaveLength(4);
      }
    }
  });

  it('uses nullable external asset metadata without bundled logos', async () => {
    const teams = await new MockSportsDataProvider().getTeams();

    expect(teams.every((team) => team.logoUrl === null && team.logoSource === null)).toBe(true);
  });
});
