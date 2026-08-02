import { jwtVerify, SignJWT } from 'jose';

export interface AccessTokenClaims {
  readonly userId: string;
  readonly sessionId: string;
}

export interface AccessTokenService {
  readonly expiresInSeconds: number;
  sign(claims: AccessTokenClaims): Promise<string>;
  verify(token: string): Promise<AccessTokenClaims>;
}

export interface JwtAccessTokenServiceOptions {
  readonly secret: string;
  readonly expiresInSeconds: number;
  readonly now?: () => Date;
}

const issuer = '2ndand15-api';
const audience = '2ndand15-web';

export class JwtAccessTokenService implements AccessTokenService {
  readonly expiresInSeconds: number;
  private readonly key: Uint8Array;
  private readonly now: () => Date;

  constructor(options: JwtAccessTokenServiceOptions) {
    this.key = new TextEncoder().encode(options.secret);
    this.expiresInSeconds = options.expiresInSeconds;
    this.now = options.now ?? (() => new Date());
  }

  async sign(claims: AccessTokenClaims): Promise<string> {
    const issuedAt = Math.floor(this.now().getTime() / 1000);
    return new SignJWT({ sid: claims.sessionId, tokenType: 'access' })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(claims.userId)
      .setIssuer(issuer)
      .setAudience(audience)
      .setIssuedAt(issuedAt)
      .setExpirationTime(issuedAt + this.expiresInSeconds)
      .sign(this.key);
  }

  async verify(token: string): Promise<AccessTokenClaims> {
    const { payload } = await jwtVerify(token, this.key, {
      algorithms: ['HS256'],
      audience,
      issuer,
      currentDate: this.now(),
    });

    if (
      payload.tokenType !== 'access' ||
      typeof payload.sub !== 'string' ||
      typeof payload.sid !== 'string'
    ) {
      throw new Error('Invalid access-token claims.');
    }

    return { userId: payload.sub, sessionId: payload.sid };
  }
}
