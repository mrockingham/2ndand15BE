import 'dotenv/config';

import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPrismaClient } from '../../src/common/database/prisma.js';
import { JwtAccessTokenService } from '../../src/common/security/access-token.js';
import { CryptoOpaqueTokenService } from '../../src/common/security/opaque-token.js';
import { Argon2idPasswordHasher } from '../../src/common/security/password-hasher.js';
import { resolveTestDatabaseUrl } from '../helpers/test-database.js';
import type { PrismaClient } from '../../src/generated/prisma/client.js';
import { PrismaAuthRepository } from '../../src/modules/auth/auth.repository.js';
import { AuthService } from '../../src/modules/auth/auth.service.js';
import { InMemoryEmailService } from '../../src/modules/email/in-memory-email.service.js';
import { PrismaUserRepository } from '../../src/modules/users/user.repository.js';
import { UserService } from '../../src/modules/users/user.service.js';

const databaseTestsEnabled = process.env.RUN_DATABASE_TESTS === 'true';

describe.skipIf(!databaseTestsEnabled)('favorite-team database integration', () => {
  let prisma: PrismaClient | undefined;
  const createdUserIds = new Set<string>();
  const createdTeamIds = new Set<string>();

  beforeAll(() => {
    prisma = createPrismaClient(resolveTestDatabaseUrl());
  });

  afterAll(async () => {
    const client = requirePrisma(prisma);
    if (createdUserIds.size > 0) {
      await client.user.deleteMany({ where: { id: { in: [...createdUserIds] } } });
    }
    if (createdTeamIds.size > 0) {
      await client.team.deleteMany({ where: { id: { in: [...createdTeamIds] } } });
    }
    await client.$disconnect();
  });

  it('persists, replaces, clears, and indexes the internal team relationship', async () => {
    const client = requirePrisma(prisma);
    const { authService, userService } = createHarness(client);
    const teams = await client.team.findMany({ where: { isActive: true }, take: 2 });
    expect(teams).toHaveLength(2);
    const firstTeam = teams[0];
    const secondTeam = teams[1];
    if (firstTeam === undefined || secondTeam === undefined) {
      throw new Error('Expected at least two seeded teams.');
    }

    const registration = await authService.register({
      email: uniqueEmail(),
      password: 'database secure password',
      metadata: { userAgent: null, ipAddress: null },
    });
    createdUserIds.add(registration.user.id);
    expect(registration.user.favoriteTeam).toBeNull();

    await expect(
      userService.updateFavoriteTeam(registration.user.id, firstTeam.id),
    ).resolves.toMatchObject({ favoriteTeam: { id: firstTeam.id } });
    await expect(
      userService.updateFavoriteTeam(registration.user.id, secondTeam.id),
    ).resolves.toMatchObject({ favoriteTeam: { id: secondTeam.id } });

    const login = await authService.login({
      email: registration.user.email,
      password: 'database secure password',
      metadata: { userAgent: null, ipAddress: null },
    });
    expect(login.user.favoriteTeam).toMatchObject({ id: secondTeam.id });
    expect(login.user).not.toHaveProperty('passwordHash');
    expect(login.user).not.toHaveProperty('sessions');
    expect(login.user.favoriteTeam).not.toHaveProperty('providerMaps');

    await userService.updateFavoriteTeam(registration.user.id, null);
    await expect(authService.getCurrentUser(registration.user.id)).resolves.toMatchObject({
      favoriteTeam: null,
    });

    await expect(
      client.user.update({
        where: { id: registration.user.id },
        data: { favoriteTeamId: randomUUID() },
      }),
    ).rejects.toBeDefined();

    const indexes = await client.$queryRaw<{ indexname: string }[]>`
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = current_schema()
        AND tablename = 'users'
        AND indexname = 'users_favorite_team_id_idx'
    `;
    expect(indexes).toEqual([{ indexname: 'users_favorite_team_id_idx' }]);
  });

  it('sets the favorite to null when its internal team is deleted', async () => {
    const client = requirePrisma(prisma);
    const { authService, userService } = createHarness(client);
    const teamId = randomUUID();
    createdTeamIds.add(teamId);
    await client.team.create({
      data: {
        id: teamId,
        league: 'NFL',
        city: 'Test City',
        name: 'Test Team',
        fullName: `Test Team ${teamId}`,
        abbreviation: `T${teamId.slice(0, 5)}`,
        conference: 'AFC',
        division: 'East',
        primaryColor: '#112233',
        secondaryColor: '#445566',
        isActive: true,
        providerMaps: {
          create: { provider: 'database-test', providerTeamId: teamId },
        },
      },
    });
    const registration = await authService.register({
      email: uniqueEmail(),
      password: 'database secure password',
      metadata: { userAgent: null, ipAddress: null },
    });
    createdUserIds.add(registration.user.id);

    const updated = await userService.updateFavoriteTeam(registration.user.id, teamId);
    expect(updated.favoriteTeam).toMatchObject({ id: teamId });
    expect(updated.favoriteTeam).not.toHaveProperty('providerMaps');

    await client.team.delete({ where: { id: teamId } });
    createdTeamIds.delete(teamId);

    const storedUser = await client.user.findUniqueOrThrow({
      where: { id: registration.user.id },
    });
    expect(storedUser.favoriteTeamId).toBeNull();
    await expect(authService.getCurrentUser(registration.user.id)).resolves.toMatchObject({
      favoriteTeam: null,
    });
  });
});

function createHarness(prisma: PrismaClient) {
  const authService = new AuthService({
    repository: new PrismaAuthRepository(prisma),
    passwordHasher: new Argon2idPasswordHasher(),
    accessTokens: new JwtAccessTokenService({
      secret: 'database-test-access-secret-that-is-at-least-32-characters',
      expiresInSeconds: 900,
    }),
    opaqueTokens: new CryptoOpaqueTokenService(),
    emailService: new InMemoryEmailService(),
    refreshTokenTtlSeconds: 2_592_000,
    passwordResetTokenTtlSeconds: 1_800,
    passwordResetFrontendUrl: 'http://localhost:5173/reset-password',
  });
  return {
    authService,
    userService: new UserService(new PrismaUserRepository(prisma)),
  };
}

function uniqueEmail(): string {
  return `codex-favorite-test-${randomUUID()}@example.com`;
}

function requirePrisma(prisma: PrismaClient | undefined): PrismaClient {
  if (prisma === undefined) {
    throw new Error('Database integration test client was not initialized.');
  }
  return prisma;
}
