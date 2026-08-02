import { createHash } from 'node:crypto';

import type {
  AccessTokenClaims,
  AccessTokenService,
} from '../../src/common/security/access-token.js';
import type { PasswordHasher } from '../../src/common/security/password-hasher.js';

export class TestPasswordHasher implements PasswordHasher {
  hash(password: string): Promise<string> {
    return Promise.resolve(`test$${createHash('sha256').update(password).digest('hex')}`);
  }

  async verify(password: string, passwordHash: string | null): Promise<boolean> {
    if (passwordHash === null) {
      await this.hash(password);
      return false;
    }
    return passwordHash === (await this.hash(password));
  }
}

export class TestAccessTokenService implements AccessTokenService {
  readonly expiresInSeconds = 900;
  private readonly claimsByToken = new Map<string, AccessTokenClaims>();
  private counter = 0;

  sign(claims: AccessTokenClaims): Promise<string> {
    this.counter += 1;
    const token = `test-access-token-${this.counter.toString()}`;
    this.claimsByToken.set(token, claims);
    return Promise.resolve(token);
  }

  verify(token: string): Promise<AccessTokenClaims> {
    const claims = this.claimsByToken.get(token);
    return claims === undefined
      ? Promise.reject(new Error('Invalid access token.'))
      : Promise.resolve(claims);
  }
}
