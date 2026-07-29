import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export interface OpaqueTokenService {
  generate(): string;
  hash(token: string): string;
  hashesEqual(leftHash: string, rightHash: string): boolean;
}

export class CryptoOpaqueTokenService implements OpaqueTokenService {
  generate(): string {
    return randomBytes(32).toString('base64url');
  }

  hash(token: string): string {
    return createHash('sha256').update(token, 'utf8').digest('hex');
  }

  hashesEqual(leftHash: string, rightHash: string): boolean {
    const left = Buffer.from(leftHash, 'hex');
    const right = Buffer.from(rightHash, 'hex');
    return left.length === right.length && timingSafeEqual(left, right);
  }
}
