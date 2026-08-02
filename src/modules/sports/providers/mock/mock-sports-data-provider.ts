import { z } from 'zod';

import {
  normalizedGameSchema,
  type GameQuery,
  type NormalizedGame,
} from '../../normalized-game.js';
import { normalizedTeamSchema, type NormalizedTeam } from '../../normalized-team.js';
import type { SportsDataBatch, SportsDataProvider } from '../../sports-data-provider.js';
import { mockNflGamesFixture } from './nfl-games.fixture.js';
import { mockNflTeamsFixture } from './nfl-teams.fixture.js';

const mockTeamFixtureSchema = z
  .array(normalizedTeamSchema)
  .length(32)
  .superRefine((teams, context) => {
    const providerIds = new Set<string>();
    const abbreviations = new Set<string>();

    teams.forEach((team, index) => {
      const providerIdentity = `${team.provider}:${team.providerTeamId}`;
      if (providerIds.has(providerIdentity)) {
        context.addIssue({
          code: 'custom',
          message: `Duplicate provider identity: ${providerIdentity}`,
          path: [index, 'providerTeamId'],
        });
      }
      providerIds.add(providerIdentity);

      const abbreviationIdentity = `${team.league}:${team.abbreviation}`;
      if (abbreviations.has(abbreviationIdentity)) {
        context.addIssue({
          code: 'custom',
          message: `Duplicate team abbreviation: ${abbreviationIdentity}`,
          path: [index, 'abbreviation'],
        });
      }
      abbreviations.add(abbreviationIdentity);
    });
  });

const mockGameFixtureSchema = z
  .array(normalizedGameSchema)
  .min(1)
  .superRefine((games, context) => {
    const providerIds = new Set<string>();
    games.forEach((game, index) => {
      const identity = `${game.provider}:${game.providerGameId}`;
      if (providerIds.has(identity)) {
        context.addIssue({
          code: 'custom',
          message: `Duplicate game identity: ${identity}`,
          path: [index, 'providerGameId'],
        });
      }
      providerIds.add(identity);
    });
  });

export class MockSportsDataProvider implements SportsDataProvider {
  getTeams(): Promise<SportsDataBatch<NormalizedTeam>> {
    const teams = mockTeamFixtureSchema.parse(mockNflTeamsFixture);
    return Promise.resolve({
      provider: 'mock',
      received: teams.length,
      records: teams,
      failures: [],
    });
  }

  getGames(query: GameQuery): Promise<SportsDataBatch<NormalizedGame>> {
    const games = mockGameFixtureSchema.parse(mockNflGamesFixture);
    const records = games.filter((game) => matchesGameQuery(game, query));
    return Promise.resolve({
      provider: 'mock',
      received: records.length,
      records,
      failures: [],
    });
  }

  async getGameByProviderId(providerGameId: string): Promise<NormalizedGame | null> {
    const batch = await this.getGames({});
    return batch.records.find((game) => game.providerGameId === providerGameId) ?? null;
  }
}

function matchesGameQuery(game: NormalizedGame, query: GameQuery): boolean {
  return (
    (query.season === undefined || game.season === query.season) &&
    (query.seasonType === undefined || game.seasonType === query.seasonType) &&
    (query.week === undefined || game.week === query.week) &&
    (query.startDate === undefined || game.startTime >= query.startDate) &&
    (query.endDate === undefined || game.startTime <= query.endDate) &&
    (query.teamId === undefined ||
      game.homeProviderTeamId === query.teamId ||
      game.awayProviderTeamId === query.teamId) &&
    (query.status === undefined || game.status === query.status)
  );
}
