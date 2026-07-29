import { AppError } from '../../common/errors/app-error.js';
import type { AccessTokenService } from '../../common/security/access-token.js';
import type { OpaqueTokenService } from '../../common/security/opaque-token.js';
import type { PasswordHasher } from '../../common/security/password-hasher.js';
import type { EmailService } from '../email/email.service.js';
import { toUserDto, type UserDto } from '../users/user.dto.js';
import {
  DuplicateEmailError,
  type AuthRepository,
  type SessionMetadata,
} from './auth.repository.js';

export interface AuthenticationResult {
  readonly user: UserDto;
  readonly accessToken: string;
  readonly accessTokenExpiresIn: number;
  readonly refreshToken: string;
}

export interface RegisterInput {
  readonly email: string;
  readonly password: string;
  readonly displayName?: string | null;
  readonly metadata: SessionMetadata;
}

export interface LoginInput {
  readonly email: string;
  readonly password: string;
  readonly metadata: SessionMetadata;
}

export interface ForgotPasswordInput {
  readonly email: string;
  readonly metadata: SessionMetadata;
}

export interface AuthServiceOptions {
  readonly repository: AuthRepository;
  readonly passwordHasher: PasswordHasher;
  readonly accessTokens: AccessTokenService;
  readonly opaqueTokens: OpaqueTokenService;
  readonly emailService: EmailService;
  readonly refreshTokenTtlSeconds: number;
  readonly passwordResetTokenTtlSeconds: number;
  readonly passwordResetFrontendUrl: string;
  readonly now?: () => Date;
  readonly onEmailDeliveryError?: (error: unknown) => void;
}

export interface AuthenticationService {
  register(input: RegisterInput): Promise<AuthenticationResult>;
  login(input: LoginInput): Promise<AuthenticationResult>;
  refresh(refreshToken: string | null): Promise<AuthenticationResult>;
  logout(refreshToken: string | null): Promise<void>;
  getCurrentUser(userId: string): Promise<UserDto>;
  forgotPassword(input: ForgotPasswordInput): Promise<void>;
  resetPassword(token: string, password: string): Promise<void>;
}

export class AuthService implements AuthenticationService {
  private readonly repository: AuthRepository;
  private readonly passwordHasher: PasswordHasher;
  private readonly accessTokens: AccessTokenService;
  private readonly opaqueTokens: OpaqueTokenService;
  private readonly emailService: EmailService;
  private readonly refreshTokenTtlSeconds: number;
  private readonly passwordResetTokenTtlSeconds: number;
  private readonly passwordResetFrontendUrl: string;
  private readonly now: () => Date;
  private readonly onEmailDeliveryError: (error: unknown) => void;

  constructor(options: AuthServiceOptions) {
    this.repository = options.repository;
    this.passwordHasher = options.passwordHasher;
    this.accessTokens = options.accessTokens;
    this.opaqueTokens = options.opaqueTokens;
    this.emailService = options.emailService;
    this.refreshTokenTtlSeconds = options.refreshTokenTtlSeconds;
    this.passwordResetTokenTtlSeconds = options.passwordResetTokenTtlSeconds;
    this.passwordResetFrontendUrl = options.passwordResetFrontendUrl;
    this.now = options.now ?? (() => new Date());
    this.onEmailDeliveryError = options.onEmailDeliveryError ?? (() => undefined);
  }

  async register(input: RegisterInput): Promise<AuthenticationResult> {
    const now = this.now();
    const refreshToken = this.opaqueTokens.generate();
    const passwordHash = await this.passwordHasher.hash(input.password);

    try {
      const { user, session } = await this.repository.createUserWithSession({
        email: input.email.trim(),
        normalizedEmail: normalizeEmail(input.email),
        passwordHash,
        displayName: input.displayName ?? null,
        refreshTokenHash: this.opaqueTokens.hash(refreshToken),
        sessionExpiresAt: addSeconds(now, this.refreshTokenTtlSeconds),
        ...input.metadata,
      });
      return await this.createAuthenticationResult(user, session.id, refreshToken);
    } catch (error: unknown) {
      if (error instanceof DuplicateEmailError) {
        throw new AppError({
          code: 'EMAIL_ALREADY_REGISTERED',
          message: 'An account with that email already exists.',
          statusCode: 409,
        });
      }
      throw error;
    }
  }

  async login(input: LoginInput): Promise<AuthenticationResult> {
    const user = await this.repository.findUserByNormalizedEmail(normalizeEmail(input.email));
    const passwordIsValid = await this.passwordHasher.verify(
      input.password,
      user?.passwordHash ?? null,
    );

    if (user?.isActive !== true || !passwordIsValid) {
      throw invalidCredentialsError();
    }

    const refreshToken = this.opaqueTokens.generate();
    const session = await this.repository.createSession({
      userId: user.id,
      refreshTokenHash: this.opaqueTokens.hash(refreshToken),
      expiresAt: addSeconds(this.now(), this.refreshTokenTtlSeconds),
      ...input.metadata,
    });
    return this.createAuthenticationResult(user, session.id, refreshToken);
  }

  async refresh(refreshToken: string | null): Promise<AuthenticationResult> {
    if (refreshToken === null) {
      throw invalidRefreshTokenError();
    }

    const now = this.now();
    const previousHash = this.opaqueTokens.hash(refreshToken);
    const session = await this.repository.findSessionByRefreshTokenHash(previousHash);

    if (session?.revokedAt !== null || session.expiresAt <= now || !session.user.isActive) {
      throw invalidRefreshTokenError();
    }

    const replacementToken = this.opaqueTokens.generate();
    const rotated = await this.repository.rotateSession(
      session.id,
      previousHash,
      this.opaqueTokens.hash(replacementToken),
      now,
    );

    if (!rotated) {
      throw invalidRefreshTokenError();
    }

    return this.createAuthenticationResult(session.user, session.id, replacementToken);
  }

  async logout(refreshToken: string | null): Promise<void> {
    if (refreshToken === null) {
      return;
    }
    await this.repository.revokeSessionByRefreshTokenHash(
      this.opaqueTokens.hash(refreshToken),
      this.now(),
    );
  }

  async getCurrentUser(userId: string): Promise<UserDto> {
    const user = await this.repository.findActiveUserById(userId);
    if (user === null) {
      throw unauthorizedError();
    }
    return toUserDto(user);
  }

  async forgotPassword(input: ForgotPasswordInput): Promise<void> {
    const user = await this.repository.findUserByNormalizedEmail(normalizeEmail(input.email));
    if (user?.isActive !== true) {
      return;
    }

    const now = this.now();
    const rawToken = this.opaqueTokens.generate();
    const expiresAt = addSeconds(now, this.passwordResetTokenTtlSeconds);
    await this.repository.createPasswordReset({
      userId: user.id,
      tokenHash: this.opaqueTokens.hash(rawToken),
      expiresAt,
      now,
      ...input.metadata,
    });

    const resetUrl = new URL(this.passwordResetFrontendUrl);
    resetUrl.searchParams.set('token', rawToken);

    try {
      await this.emailService.sendPasswordResetEmail({
        recipientEmail: user.email,
        resetUrl: resetUrl.toString(),
        expiresAt,
      });
    } catch (error: unknown) {
      this.onEmailDeliveryError(error);
    }
  }

  async resetPassword(token: string, password: string): Promise<void> {
    const now = this.now();
    const tokenHash = this.opaqueTokens.hash(token);
    const resetToken = await this.repository.findPasswordResetByTokenHash(tokenHash);

    if (resetToken?.usedAt !== null || resetToken.expiresAt <= now || !resetToken.user.isActive) {
      throw invalidResetTokenError();
    }

    const passwordHash = await this.passwordHasher.hash(password);
    const consumed = await this.repository.consumePasswordReset({
      resetTokenId: resetToken.id,
      userId: resetToken.userId,
      tokenHash,
      passwordHash,
      now,
    });

    if (!consumed) {
      throw invalidResetTokenError();
    }
  }

  private async createAuthenticationResult(
    user: Parameters<typeof toUserDto>[0],
    sessionId: string,
    refreshToken: string,
  ): Promise<AuthenticationResult> {
    const accessToken = await this.accessTokens.sign({ userId: user.id, sessionId });
    return {
      user: toUserDto(user),
      accessToken,
      accessTokenExpiresIn: this.accessTokens.expiresInSeconds,
      refreshToken,
    };
  }
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function addSeconds(date: Date, seconds: number): Date {
  return new Date(date.getTime() + seconds * 1000);
}

function invalidCredentialsError(): AppError {
  return new AppError({
    code: 'INVALID_CREDENTIALS',
    message: 'Invalid email or password.',
    statusCode: 401,
  });
}

function invalidRefreshTokenError(): AppError {
  return new AppError({
    code: 'INVALID_REFRESH_TOKEN',
    message: 'The refresh session is invalid or expired.',
    statusCode: 401,
  });
}

function invalidResetTokenError(): AppError {
  return new AppError({
    code: 'INVALID_RESET_TOKEN',
    message: 'The password reset token is invalid or expired.',
    statusCode: 400,
  });
}

export function unauthorizedError(): AppError {
  return new AppError({
    code: 'UNAUTHORIZED',
    message: 'A valid access token is required.',
    statusCode: 401,
  });
}
