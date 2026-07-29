import { describe, expect, it } from 'vitest';

import { JwtAccessTokenService } from './access-token.js';
import { CryptoOpaqueTokenService } from './opaque-token.js';
import { Argon2idPasswordHasher } from './password-hasher.js';

describe('security services', () => {
  it('hashes and verifies passwords with Argon2id', async () => {
    const hasher = new Argon2idPasswordHasher();
    const passwordHash = await hasher.hash('a secure testing password');

    expect(passwordHash).toMatch(/^\$argon2id\$/);
    expect(passwordHash).not.toContain('a secure testing password');
    await expect(hasher.verify('a secure testing password', passwordHash)).resolves.toBe(true);
    await expect(hasher.verify('the wrong password', passwordHash)).resolves.toBe(false);
    await expect(hasher.verify('unknown account password', null)).resolves.toBe(false);
  });

  it('generates high-entropy opaque tokens and deterministic hashes', () => {
    const tokens = new CryptoOpaqueTokenService();
    const first = tokens.generate();
    const second = tokens.generate();
    const firstHash = tokens.hash(first);

    expect(first).toHaveLength(43);
    expect(first).not.toBe(second);
    expect(firstHash).toMatch(/^[0-9a-f]{64}$/);
    expect(firstHash).not.toContain(first);
    expect(tokens.hashesEqual(firstHash, tokens.hash(first))).toBe(true);
    expect(tokens.hashesEqual(firstHash, tokens.hash(second))).toBe(false);
  });

  it('signs, verifies, and expires access JWTs', async () => {
    let now = new Date('2026-07-28T12:00:00.000Z');
    const accessTokens = new JwtAccessTokenService({
      secret: 'test-access-secret-that-is-at-least-32-characters',
      expiresInSeconds: 900,
      now: () => now,
    });
    const claims = {
      userId: '00000000-0000-4000-8000-000000000010',
      sessionId: '00000000-0000-4000-8000-000000000011',
    };

    const token = await accessTokens.sign(claims);
    await expect(accessTokens.verify(token)).resolves.toEqual(claims);

    now = new Date('2026-07-28T12:16:00.000Z');
    await expect(accessTokens.verify(token)).rejects.toThrow();
    await expect(accessTokens.verify(`${token}tampered`)).rejects.toThrow();
  });
});
