import {
  Prisma,
  type PasswordResetToken,
  type PrismaClient,
  type Session,
  type User,
} from '../../generated/prisma/client.js';
import { userWithFavoriteTeamInclude, type UserWithFavoriteTeam } from '../users/user.dto.js';

export interface SessionMetadata {
  readonly userAgent: string | null;
  readonly ipAddress: string | null;
}

export interface CreateSessionInput extends SessionMetadata {
  readonly userId: string;
  readonly refreshTokenHash: string;
  readonly expiresAt: Date;
}

export interface CreateUserWithSessionInput extends SessionMetadata {
  readonly email: string;
  readonly normalizedEmail: string;
  readonly passwordHash: string;
  readonly displayName: string | null;
  readonly refreshTokenHash: string;
  readonly sessionExpiresAt: Date;
}

export interface SessionWithUser extends Session {
  readonly user: UserWithFavoriteTeam;
}

export interface PasswordResetWithUser extends PasswordResetToken {
  readonly user: User;
}

export interface CreatePasswordResetInput extends SessionMetadata {
  readonly userId: string;
  readonly tokenHash: string;
  readonly expiresAt: Date;
  readonly now: Date;
}

export interface ConsumePasswordResetInput {
  readonly resetTokenId: string;
  readonly userId: string;
  readonly tokenHash: string;
  readonly passwordHash: string;
  readonly now: Date;
}

export interface AuthRepository {
  createUserWithSession(
    input: CreateUserWithSessionInput,
  ): Promise<{ readonly user: UserWithFavoriteTeam; readonly session: Session }>;
  findUserByNormalizedEmail(normalizedEmail: string): Promise<UserWithFavoriteTeam | null>;
  findActiveUserById(userId: string): Promise<UserWithFavoriteTeam | null>;
  createSession(input: CreateSessionInput): Promise<Session>;
  findSessionByRefreshTokenHash(refreshTokenHash: string): Promise<SessionWithUser | null>;
  rotateSession(
    sessionId: string,
    previousHash: string,
    replacementHash: string,
    now: Date,
  ): Promise<boolean>;
  revokeSessionByRefreshTokenHash(refreshTokenHash: string, now: Date): Promise<void>;
  createPasswordReset(input: CreatePasswordResetInput): Promise<PasswordResetToken>;
  findPasswordResetByTokenHash(tokenHash: string): Promise<PasswordResetWithUser | null>;
  consumePasswordReset(input: ConsumePasswordResetInput): Promise<boolean>;
}

export class DuplicateEmailError extends Error {
  constructor() {
    super('The normalized email already exists.');
    this.name = 'DuplicateEmailError';
  }
}

export class PrismaAuthRepository implements AuthRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async createUserWithSession(
    input: CreateUserWithSessionInput,
  ): Promise<{ readonly user: UserWithFavoriteTeam; readonly session: Session }> {
    return this.prisma.$transaction(async (transaction) => {
      let user: UserWithFavoriteTeam;
      try {
        user = await transaction.user.create({
          data: {
            email: input.email,
            normalizedEmail: input.normalizedEmail,
            passwordHash: input.passwordHash,
            displayName: input.displayName,
          },
          include: userWithFavoriteTeamInclude,
        });
      } catch (error: unknown) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          throw new DuplicateEmailError();
        }
        throw error;
      }

      const session = await transaction.session.create({
        data: {
          userId: user.id,
          refreshTokenHash: input.refreshTokenHash,
          expiresAt: input.sessionExpiresAt,
          userAgent: input.userAgent,
          ipAddress: input.ipAddress,
        },
      });
      return { user, session };
    });
  }

  async findUserByNormalizedEmail(normalizedEmail: string): Promise<UserWithFavoriteTeam | null> {
    return this.prisma.user.findUnique({
      where: { normalizedEmail },
      include: userWithFavoriteTeamInclude,
    });
  }

  async findActiveUserById(userId: string): Promise<UserWithFavoriteTeam | null> {
    return this.prisma.user.findFirst({
      where: { id: userId, isActive: true },
      include: userWithFavoriteTeamInclude,
    });
  }

  async createSession(input: CreateSessionInput): Promise<Session> {
    return this.prisma.session.create({
      data: {
        userId: input.userId,
        refreshTokenHash: input.refreshTokenHash,
        expiresAt: input.expiresAt,
        userAgent: input.userAgent,
        ipAddress: input.ipAddress,
      },
    });
  }

  async findSessionByRefreshTokenHash(refreshTokenHash: string): Promise<SessionWithUser | null> {
    return this.prisma.session.findUnique({
      where: { refreshTokenHash },
      include: { user: { include: userWithFavoriteTeamInclude } },
    });
  }

  async rotateSession(
    sessionId: string,
    previousHash: string,
    replacementHash: string,
    now: Date,
  ): Promise<boolean> {
    const result = await this.prisma.session.updateMany({
      where: {
        id: sessionId,
        refreshTokenHash: previousHash,
        revokedAt: null,
        expiresAt: { gt: now },
      },
      data: {
        refreshTokenHash: replacementHash,
        lastUsedAt: now,
      },
    });
    return result.count === 1;
  }

  async revokeSessionByRefreshTokenHash(refreshTokenHash: string, now: Date): Promise<void> {
    await this.prisma.session.updateMany({
      where: { refreshTokenHash, revokedAt: null },
      data: { revokedAt: now },
    });
  }

  async createPasswordReset(input: CreatePasswordResetInput): Promise<PasswordResetToken> {
    return this.prisma.$transaction(async (transaction) => {
      await transaction.passwordResetToken.updateMany({
        where: { userId: input.userId, usedAt: null },
        data: { usedAt: input.now },
      });
      return transaction.passwordResetToken.create({
        data: {
          userId: input.userId,
          tokenHash: input.tokenHash,
          expiresAt: input.expiresAt,
          userAgent: input.userAgent,
          ipAddress: input.ipAddress,
        },
      });
    });
  }

  async findPasswordResetByTokenHash(tokenHash: string): Promise<PasswordResetWithUser | null> {
    return this.prisma.passwordResetToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });
  }

  async consumePasswordReset(input: ConsumePasswordResetInput): Promise<boolean> {
    return this.prisma.$transaction(async (transaction) => {
      const claimed = await transaction.passwordResetToken.updateMany({
        where: {
          id: input.resetTokenId,
          userId: input.userId,
          tokenHash: input.tokenHash,
          usedAt: null,
          expiresAt: { gt: input.now },
        },
        data: { usedAt: input.now },
      });

      if (claimed.count !== 1) {
        return false;
      }

      await transaction.user.update({
        where: { id: input.userId },
        data: { passwordHash: input.passwordHash },
      });
      await transaction.session.updateMany({
        where: { userId: input.userId, revokedAt: null },
        data: { revokedAt: input.now },
      });
      await transaction.passwordResetToken.updateMany({
        where: { userId: input.userId, usedAt: null },
        data: { usedAt: input.now },
      });
      return true;
    });
  }
}
