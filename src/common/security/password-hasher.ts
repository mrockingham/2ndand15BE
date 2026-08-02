import { randomBytes } from 'node:crypto';

import { argon2id, hash, verify } from 'argon2';

export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(password: string, passwordHash: string | null): Promise<boolean>;
}

const argon2Options = {
  type: argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
  hashLength: 32,
} as const;

export class Argon2idPasswordHasher implements PasswordHasher {
  private readonly dummyHash: Promise<string> = hash(randomBytes(32), argon2Options);

  async hash(password: string): Promise<string> {
    return hash(password, argon2Options);
  }

  async verify(password: string, passwordHash: string | null): Promise<boolean> {
    const comparisonHash = passwordHash ?? (await this.dummyHash);

    try {
      return await verify(comparisonHash, password);
    } catch {
      return false;
    }
  }
}
