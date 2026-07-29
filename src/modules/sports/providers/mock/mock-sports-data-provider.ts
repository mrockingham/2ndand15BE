import { z } from 'zod';

import { normalizedTeamSchema, type NormalizedTeam } from '../../normalized-team.js';
import type { SportsDataProvider } from '../../sports-data-provider.js';
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

export class MockSportsDataProvider implements SportsDataProvider {
  getTeams(): Promise<readonly NormalizedTeam[]> {
    return Promise.resolve(mockTeamFixtureSchema.parse(mockNflTeamsFixture));
  }
}
