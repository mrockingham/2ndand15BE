import { describe, expect, it } from 'vitest';

import { CryptoOpaqueTokenService } from '../../common/security/opaque-token.js';
import { InMemoryEmailService } from '../email/in-memory-email.service.js';
import { InMemoryAuthRepository } from '../../../tests/helpers/in-memory-auth-repository.js';
import {
  TestAccessTokenService,
  TestPasswordHasher,
} from '../../../tests/helpers/test-auth-services.js';
import { AuthService } from './auth.service.js';

const metadata = { userAgent: 'test-agent', ipAddress: '127.0.0.1' } as const;

function createHarness() {
  let now = new Date('2026-07-28T12:00:00.000Z');
  const repository = new InMemoryAuthRepository();
  const emailService = new InMemoryEmailService();
  const passwordHasher = new TestPasswordHasher();
  const opaqueTokens = new CryptoOpaqueTokenService();
  const service = new AuthService({
    repository,
    passwordHasher,
    accessTokens: new TestAccessTokenService(),
    opaqueTokens,
    emailService,
    refreshTokenTtlSeconds: 2_592_000,
    passwordResetTokenTtlSeconds: 1_800,
    passwordResetFrontendUrl: 'http://localhost:5173/reset-password',
    now: () => now,
  });
  return {
    service,
    repository,
    emailService,
    passwordHasher,
    opaqueTokens,
    setNow: (replacement: Date) => {
      now = replacement;
    },
  };
}

describe('AuthService', () => {
  it('registers transactionally with normalized email and hashed credentials', async () => {
    const harness = createHarness();

    const result = await harness.service.register({
      email: '  User@Example.com ',
      password: 'a secure password',
      displayName: 'Michael',
      metadata,
    });

    expect(result.user).toMatchObject({ email: 'User@Example.com', displayName: 'Michael' });
    expect(result).toMatchObject({ accessTokenExpiresIn: 900 });
    expect(harness.repository.users[0]).toMatchObject({ normalizedEmail: 'user@example.com' });
    expect(harness.repository.users[0]?.passwordHash).not.toContain('a secure password');
    expect(harness.repository.sessions[0]?.refreshTokenHash).toBe(
      harness.opaqueTokens.hash(result.refreshToken),
    );
    expect(harness.repository.sessions[0]?.refreshTokenHash).not.toBe(result.refreshToken);
  });

  it('rejects duplicate emails regardless of casing', async () => {
    const { service } = createHarness();
    await service.register({
      email: 'user@example.com',
      password: 'a secure password',
      metadata,
    });

    await expect(
      service.register({
        email: 'USER@example.com',
        password: 'another secure password',
        metadata,
      }),
    ).rejects.toMatchObject({ code: 'EMAIL_ALREADY_REGISTERED', statusCode: 409 });
  });

  it('logs in successfully and uses one generic failure for unknown or bad credentials', async () => {
    const { service } = createHarness();
    await service.register({
      email: 'user@example.com',
      password: 'a secure password',
      metadata,
    });

    await expect(
      service.login({ email: 'USER@example.com', password: 'a secure password', metadata }),
    ).resolves.toMatchObject({ user: { email: 'user@example.com' } });

    for (const attempt of [
      { email: 'user@example.com', password: 'wrong password value', metadata },
      { email: 'unknown@example.com', password: 'wrong password value', metadata },
    ]) {
      await expect(service.login(attempt)).rejects.toMatchObject({
        code: 'INVALID_CREDENTIALS',
        message: 'Invalid email or password.',
      });
    }
  });

  it('rotates refresh tokens and rejects reuse of the old token', async () => {
    const { service, repository, opaqueTokens } = createHarness();
    const registration = await service.register({
      email: 'user@example.com',
      password: 'a secure password',
      metadata,
    });

    const refreshed = await service.refresh(registration.refreshToken);

    expect(refreshed.refreshToken).not.toBe(registration.refreshToken);
    expect(repository.sessions).toHaveLength(1);
    expect(repository.sessions[0]?.refreshTokenHash).toBe(
      opaqueTokens.hash(refreshed.refreshToken),
    );
    await expect(service.refresh(registration.refreshToken)).rejects.toMatchObject({
      code: 'INVALID_REFRESH_TOKEN',
    });
  });

  it('rejects expired and revoked refresh sessions', async () => {
    const expired = createHarness();
    const expiredRegistration = await expired.service.register({
      email: 'expired@example.com',
      password: 'a secure password',
      metadata,
    });
    expired.setNow(new Date('2026-08-28T12:00:01.000Z'));
    await expect(expired.service.refresh(expiredRegistration.refreshToken)).rejects.toMatchObject({
      code: 'INVALID_REFRESH_TOKEN',
    });

    const revoked = createHarness();
    const revokedRegistration = await revoked.service.register({
      email: 'revoked@example.com',
      password: 'a secure password',
      metadata,
    });
    await revoked.service.logout(revokedRegistration.refreshToken);
    await revoked.service.logout(revokedRegistration.refreshToken);
    await expect(revoked.service.refresh(revokedRegistration.refreshToken)).rejects.toMatchObject({
      code: 'INVALID_REFRESH_TOKEN',
    });
  });

  it('returns the active user DTO without password or session fields', async () => {
    const { service } = createHarness();
    const registration = await service.register({
      email: 'user@example.com',
      password: 'a secure password',
      metadata,
    });

    const user = await service.getCurrentUser(registration.user.id);

    expect(user).toMatchObject({ id: registration.user.id, email: 'user@example.com' });
    expect(user).not.toHaveProperty('passwordHash');
    expect(user).not.toHaveProperty('sessions');
  });

  it('captures reset email only for active known users and stores no raw reset token', async () => {
    const harness = createHarness();
    await harness.service.register({
      email: 'User@Example.com',
      password: 'a secure password',
      metadata,
    });

    await harness.service.forgotPassword({ email: 'USER@example.com', metadata });
    await harness.service.forgotPassword({ email: 'unknown@example.com', metadata });

    expect(harness.emailService.passwordResetMessages).toHaveLength(1);
    const resetUrl = new URL(harness.emailService.passwordResetMessages[0]?.resetUrl ?? '');
    const rawToken = resetUrl.searchParams.get('token');
    expect(rawToken).not.toBeNull();
    expect(harness.repository.passwordResetTokens[0]?.tokenHash).toBe(
      harness.opaqueTokens.hash(rawToken ?? ''),
    );
    expect(harness.repository.passwordResetTokens[0]?.tokenHash).not.toBe(rawToken);
  });

  it('invalidates the previous reset token when a newer request is created', async () => {
    const harness = createHarness();
    await harness.service.register({
      email: 'user@example.com',
      password: 'a secure password',
      metadata,
    });
    await harness.service.forgotPassword({ email: 'user@example.com', metadata });
    const firstUrl = new URL(harness.emailService.passwordResetMessages[0]?.resetUrl ?? '');
    await harness.service.forgotPassword({ email: 'USER@example.com', metadata });

    expect(harness.repository.passwordResetTokens[0]?.usedAt).not.toBeNull();
    await expect(
      harness.service.resetPassword(
        firstUrl.searchParams.get('token') ?? '',
        'new secure password',
      ),
    ).rejects.toMatchObject({ code: 'INVALID_RESET_TOKEN' });
  });

  it('resets the password once, revokes sessions, and invalidates other reset tokens', async () => {
    const harness = createHarness();
    await harness.service.register({
      email: 'user@example.com',
      password: 'old secure password',
      metadata,
    });
    await harness.service.login({
      email: 'user@example.com',
      password: 'old secure password',
      metadata,
    });
    await harness.service.forgotPassword({ email: 'user@example.com', metadata });
    const message = harness.emailService.passwordResetMessages[0];
    const rawToken = new URL(message?.resetUrl ?? '').searchParams.get('token') ?? '';

    await harness.service.resetPassword(rawToken, 'new secure password');

    expect(harness.repository.sessions.every((session) => session.revokedAt !== null)).toBe(true);
    expect(harness.repository.passwordResetTokens.every((token) => token.usedAt !== null)).toBe(
      true,
    );
    await expect(
      harness.service.login({
        email: 'user@example.com',
        password: 'old secure password',
        metadata,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
    await expect(
      harness.service.login({
        email: 'user@example.com',
        password: 'new secure password',
        metadata,
      }),
    ).resolves.toMatchObject({ user: { email: 'user@example.com' } });
    await expect(
      harness.service.resetPassword(rawToken, 'another secure password'),
    ).rejects.toMatchObject({
      code: 'INVALID_RESET_TOKEN',
    });
  });

  it('resolves identically (no throw, no distinguishing value) for forgotPassword on a known vs. an unknown email', async () => {
    const harness = createHarness();
    await harness.service.register({
      email: 'user@example.com',
      password: 'a secure password',
      metadata,
    });

    await expect(
      harness.service.forgotPassword({ email: 'user@example.com', metadata }),
    ).resolves.toBeUndefined();
    await expect(
      harness.service.forgotPassword({ email: 'definitely-unknown@example.com', metadata }),
    ).resolves.toBeUndefined();
  });

  it('rejects invalid and expired reset tokens with one generic error', async () => {
    const harness = createHarness();
    await harness.service.register({
      email: 'user@example.com',
      password: 'a secure password',
      metadata,
    });
    await expect(
      harness.service.resetPassword('invalid-token-that-is-long-enough', 'new secure password'),
    ).rejects.toMatchObject({ code: 'INVALID_RESET_TOKEN' });

    await harness.service.forgotPassword({ email: 'user@example.com', metadata });
    const rawToken = new URL(
      harness.emailService.passwordResetMessages[0]?.resetUrl ?? '',
    ).searchParams.get('token');
    harness.setNow(new Date('2026-07-28T12:31:00.000Z'));
    await expect(
      harness.service.resetPassword(rawToken ?? '', 'new secure password'),
    ).rejects.toMatchObject({ code: 'INVALID_RESET_TOKEN' });
  });
});
