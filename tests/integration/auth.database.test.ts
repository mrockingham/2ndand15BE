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

const databaseTestsEnabled = process.env.RUN_DATABASE_TESTS === 'true';

describe.skipIf(!databaseTestsEnabled)('authentication database integration', () => {
  let prisma: PrismaClient | undefined;
  const createdUserIds = new Set<string>();

  beforeAll(() => {
    prisma = createPrismaClient(resolveTestDatabaseUrl());
  });

  afterAll(async () => {
    const client = requirePrisma(prisma);
    if (createdUserIds.size > 0) {
      await client.user.deleteMany({ where: { id: { in: [...createdUserIds] } } });
    }
    await client.$disconnect();
  });

  it('enforces case-insensitive email uniqueness through normalized storage', async () => {
    const { service } = createHarness(requirePrisma(prisma));
    const email = uniqueEmail();
    const registration = await service.register({
      email,
      password: 'database secure password',
      metadata: { userAgent: null, ipAddress: null },
    });
    createdUserIds.add(registration.user.id);

    await expect(
      service.register({
        email: email.toUpperCase(),
        password: 'another secure password',
        metadata: { userAgent: null, ipAddress: null },
      }),
    ).rejects.toMatchObject({ code: 'EMAIL_ALREADY_REGISTERED', statusCode: 409 });
  });

  it('persists only password and refresh hashes and rotates atomically', async () => {
    const client = requirePrisma(prisma);
    const { service, opaqueTokens } = createHarness(client);
    const password = 'database secure password';
    const registration = await service.register({
      email: uniqueEmail(),
      password,
      metadata: { userAgent: 'database-test', ipAddress: '127.0.0.1' },
    });
    createdUserIds.add(registration.user.id);

    const user = await client.user.findUniqueOrThrow({ where: { id: registration.user.id } });
    const originalSession = await client.session.findFirstOrThrow({
      where: { userId: registration.user.id },
    });
    expect(user.passwordHash).toMatch(/^\$argon2id\$/);
    expect(user.passwordHash).not.toContain(password);
    expect(originalSession.refreshTokenHash).toBe(opaqueTokens.hash(registration.refreshToken));
    expect(originalSession.refreshTokenHash).not.toBe(registration.refreshToken);

    const refreshed = await service.refresh(registration.refreshToken);
    const rotatedSession = await client.session.findUniqueOrThrow({
      where: { id: originalSession.id },
    });
    expect(rotatedSession.refreshTokenHash).toBe(opaqueTokens.hash(refreshed.refreshToken));
    expect(rotatedSession.refreshTokenHash).not.toBe(originalSession.refreshTokenHash);
    await expect(service.refresh(registration.refreshToken)).rejects.toMatchObject({
      code: 'INVALID_REFRESH_TOKEN',
    });
  });

  it('stores only reset hashes and revokes every session after a password reset', async () => {
    const client = requirePrisma(prisma);
    const { service, emailService, opaqueTokens } = createHarness(client);
    const email = uniqueEmail();
    const registration = await service.register({
      email,
      password: 'old database password',
      metadata: { userAgent: null, ipAddress: null },
    });
    createdUserIds.add(registration.user.id);
    await service.login({
      email,
      password: 'old database password',
      metadata: { userAgent: null, ipAddress: null },
    });
    await service.forgotPassword({
      email: email.toUpperCase(),
      metadata: { userAgent: null, ipAddress: null },
    });
    const resetUrl = new URL(emailService.passwordResetMessages[0]?.resetUrl ?? '');
    const rawToken = resetUrl.searchParams.get('token') ?? '';
    const storedReset = await client.passwordResetToken.findFirstOrThrow({
      where: { userId: registration.user.id },
    });
    expect(storedReset.tokenHash).toBe(opaqueTokens.hash(rawToken));
    expect(storedReset.tokenHash).not.toBe(rawToken);

    await service.resetPassword(rawToken, 'new database password');

    const sessions = await client.session.findMany({ where: { userId: registration.user.id } });
    expect(sessions).toHaveLength(2);
    expect(sessions.every((session) => session.revokedAt !== null)).toBe(true);
    await expect(
      service.login({
        email,
        password: 'old database password',
        metadata: { userAgent: null, ipAddress: null },
      }),
    ).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
    await expect(
      service.login({
        email,
        password: 'new database password',
        metadata: { userAgent: null, ipAddress: null },
      }),
    ).resolves.toBeDefined();
  });

  it('cascades sessions and reset tokens when a user is deleted', async () => {
    const client = requirePrisma(prisma);
    const { service } = createHarness(client);
    const email = uniqueEmail();
    const registration = await service.register({
      email,
      password: 'database secure password',
      metadata: { userAgent: null, ipAddress: null },
    });
    createdUserIds.add(registration.user.id);
    await service.forgotPassword({
      email,
      metadata: { userAgent: null, ipAddress: null },
    });

    await client.user.delete({ where: { id: registration.user.id } });

    await expect(client.session.count({ where: { userId: registration.user.id } })).resolves.toBe(
      0,
    );
    await expect(
      client.passwordResetToken.count({ where: { userId: registration.user.id } }),
    ).resolves.toBe(0);
  });
});

function createHarness(prisma: PrismaClient) {
  const opaqueTokens = new CryptoOpaqueTokenService();
  const emailService = new InMemoryEmailService();
  const service = new AuthService({
    repository: new PrismaAuthRepository(prisma),
    passwordHasher: new Argon2idPasswordHasher(),
    accessTokens: new JwtAccessTokenService({
      secret: 'database-test-access-secret-that-is-at-least-32-characters',
      expiresInSeconds: 900,
    }),
    opaqueTokens,
    emailService,
    refreshTokenTtlSeconds: 2_592_000,
    passwordResetTokenTtlSeconds: 1_800,
    passwordResetFrontendUrl: 'http://localhost:5173/reset-password',
  });
  return { service, opaqueTokens, emailService };
}

function uniqueEmail(): string {
  return `codex-auth-test-${randomUUID()}@example.com`;
}

function requirePrisma(prisma: PrismaClient | undefined): PrismaClient {
  if (prisma === undefined) {
    throw new Error('Database integration test client was not initialized.');
  }
  return prisma;
}
