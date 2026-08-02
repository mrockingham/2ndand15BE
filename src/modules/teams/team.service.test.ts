import { describe, expect, it } from 'vitest';

import type { AppError } from '../../common/errors/app-error.js';
import type { TeamRepository } from './team.repository.js';
import { TeamService } from './team.service.js';
import { createTeamRecord } from './team.test-fixtures.js';

function createRepository(overrides: Partial<TeamRepository> = {}): TeamRepository {
  return {
    findActiveTeams: () => Promise.resolve([]),
    findActiveTeamById: () => Promise.resolve(null),
    ...overrides,
  };
}

describe('TeamService', () => {
  it('returns normalized DTOs in stable conference, division, and name order', async () => {
    const repository = createRepository({
      findActiveTeams: () =>
        Promise.resolve([
          createTeamRecord({
            id: '00000000-0000-4000-8000-000000000003',
            fullName: 'Arizona Cardinals',
            abbreviation: 'ARI',
            conference: 'NFC',
            division: 'West',
          }),
          createTeamRecord({
            id: '00000000-0000-4000-8000-000000000002',
            fullName: 'Miami Dolphins',
            abbreviation: 'MIA',
          }),
          createTeamRecord(),
        ]),
    });

    const teams = await new TeamService(repository).listActiveTeams();

    expect(teams.map((team) => team.abbreviation)).toEqual(['BUF', 'MIA', 'ARI']);
    expect(teams[0]).toMatchObject({
      id: '00000000-0000-4000-8000-000000000001',
      createdAt: '2026-07-28T12:00:00.000Z',
      logoUrl: null,
    });
  });

  it('returns one normalized active team', async () => {
    const team = createTeamRecord();
    const repository = createRepository({
      findActiveTeamById: () => Promise.resolve(team),
    });

    await expect(new TeamService(repository).getActiveTeam(team.id)).resolves.toMatchObject({
      id: team.id,
      abbreviation: 'BUF',
    });
  });

  it('raises the standard team not-found error', async () => {
    const service = new TeamService(createRepository());

    await expect(service.getActiveTeam('00000000-0000-4000-8000-000000000099')).rejects.toEqual(
      expect.objectContaining<Partial<AppError>>({
        code: 'TEAM_NOT_FOUND',
        statusCode: 404,
      }),
    );
  });
});
