import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import type { User } from '../../generated/prisma/client.js';
import { InMemoryAuthRepository } from '../../../tests/helpers/in-memory-auth-repository.js';
import { createTeamRecord } from '../teams/team.test-fixtures.js';
import { UserService } from './user.service.js';

describe('UserService', () => {
  it('sets, replaces, clears, and repeatedly clears a favorite team', async () => {
    const { repository, service, user } = createHarness();
    const bills = createTeamRecord();
    const ravens = createTeamRecord({
      id: randomUUID(),
      city: 'Baltimore',
      name: 'Ravens',
      fullName: 'Baltimore Ravens',
      abbreviation: 'BAL',
      division: 'North',
      primaryColor: '#241773',
      secondaryColor: '#000000',
    });
    repository.teams.push(bills, ravens);

    await expect(service.updateFavoriteTeam(user.id, bills.id)).resolves.toMatchObject({
      favoriteTeam: { id: bills.id, abbreviation: 'BUF' },
    });
    await expect(service.updateFavoriteTeam(user.id, ravens.id)).resolves.toMatchObject({
      favoriteTeam: { id: ravens.id, abbreviation: 'BAL' },
    });
    await expect(service.updateFavoriteTeam(user.id, null)).resolves.toMatchObject({
      favoriteTeam: null,
    });
    await expect(service.updateFavoriteTeam(user.id, null)).resolves.toMatchObject({
      favoriteTeam: null,
    });
  });

  it('rejects unknown and inactive teams with stable errors', async () => {
    const { repository, service, user } = createHarness();
    const inactiveTeam = createTeamRecord({ isActive: false });
    repository.teams.push(inactiveTeam);

    await expect(service.updateFavoriteTeam(user.id, randomUUID())).rejects.toMatchObject({
      code: 'TEAM_NOT_FOUND',
      statusCode: 404,
    });
    await expect(service.updateFavoriteTeam(user.id, inactiveTeam.id)).rejects.toMatchObject({
      code: 'TEAM_INACTIVE',
      statusCode: 409,
    });
  });

  it('rejects updates for an inactive user', async () => {
    const { service, user } = createHarness({ isActive: false });

    await expect(service.updateFavoriteTeam(user.id, null)).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
      statusCode: 401,
    });
  });
});

function createHarness(overrides: Partial<User> = {}) {
  const repository = new InMemoryAuthRepository();
  const now = new Date('2026-07-29T12:00:00.000Z');
  const user: User = {
    id: randomUUID(),
    email: 'user@example.com',
    normalizedEmail: 'user@example.com',
    passwordHash: 'not-public',
    displayName: null,
    isActive: true,
    role: 'USER',
    favoriteTeamId: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
  repository.users.push(user);
  return { repository, service: new UserService(repository), user };
}
