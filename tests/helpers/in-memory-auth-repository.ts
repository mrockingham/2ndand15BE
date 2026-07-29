import { randomUUID } from 'node:crypto';

import type { PasswordResetToken, Session, Team, User } from '../../src/generated/prisma/client.js';
import {
  DuplicateEmailError,
  type AuthRepository,
  type ConsumePasswordResetInput,
  type CreatePasswordResetInput,
  type CreateSessionInput,
  type CreateUserWithSessionInput,
  type PasswordResetWithUser,
  type SessionWithUser,
} from '../../src/modules/auth/auth.repository.js';
import type { UserWithFavoriteTeam } from '../../src/modules/users/user.dto.js';
import type {
  FavoriteTeamCandidate,
  UserRepository,
} from '../../src/modules/users/user.repository.js';

export class InMemoryAuthRepository implements AuthRepository, UserRepository {
  readonly users: User[] = [];
  readonly sessions: Session[] = [];
  readonly passwordResetTokens: PasswordResetToken[] = [];
  readonly teams: Team[] = [];

  createUserWithSession(
    input: CreateUserWithSessionInput,
  ): Promise<{ readonly user: UserWithFavoriteTeam; readonly session: Session }> {
    if (this.users.some((user) => user.normalizedEmail === input.normalizedEmail)) {
      return Promise.reject(new DuplicateEmailError());
    }

    const now = new Date();
    const user: User = {
      id: randomUUID(),
      email: input.email,
      normalizedEmail: input.normalizedEmail,
      passwordHash: input.passwordHash,
      displayName: input.displayName,
      isActive: true,
      favoriteTeamId: null,
      createdAt: now,
      updatedAt: now,
    };
    this.users.push(user);
    const session = this.buildSession({
      userId: user.id,
      refreshTokenHash: input.refreshTokenHash,
      expiresAt: input.sessionExpiresAt,
      userAgent: input.userAgent,
      ipAddress: input.ipAddress,
    });
    this.sessions.push(session);
    return Promise.resolve({ user: this.withFavoriteTeam(user), session });
  }

  findUserByNormalizedEmail(normalizedEmail: string): Promise<UserWithFavoriteTeam | null> {
    const user = this.users.find((candidate) => candidate.normalizedEmail === normalizedEmail);
    return Promise.resolve(user === undefined ? null : this.withFavoriteTeam(user));
  }

  findActiveUserById(userId: string): Promise<UserWithFavoriteTeam | null> {
    const user = this.users.find((candidate) => candidate.id === userId && candidate.isActive);
    return Promise.resolve(user === undefined ? null : this.withFavoriteTeam(user));
  }

  createSession(input: CreateSessionInput): Promise<Session> {
    const session = this.buildSession(input);
    this.sessions.push(session);
    return Promise.resolve(session);
  }

  findSessionByRefreshTokenHash(refreshTokenHash: string): Promise<SessionWithUser | null> {
    const session = this.sessions.find(
      (candidate) => candidate.refreshTokenHash === refreshTokenHash,
    );
    if (session === undefined) {
      return Promise.resolve(null);
    }
    const user = this.users.find((candidate) => candidate.id === session.userId);
    return Promise.resolve(
      user === undefined ? null : { ...session, user: this.withFavoriteTeam(user) },
    );
  }

  rotateSession(
    sessionId: string,
    previousHash: string,
    replacementHash: string,
    now: Date,
  ): Promise<boolean> {
    const session = this.sessions.find(
      (candidate) =>
        candidate.id === sessionId &&
        candidate.refreshTokenHash === previousHash &&
        candidate.revokedAt === null &&
        candidate.expiresAt > now,
    );
    if (session === undefined) {
      return Promise.resolve(false);
    }
    session.refreshTokenHash = replacementHash;
    session.lastUsedAt = now;
    session.updatedAt = now;
    return Promise.resolve(true);
  }

  revokeSessionByRefreshTokenHash(refreshTokenHash: string, now: Date): Promise<void> {
    const session = this.sessions.find(
      (candidate) =>
        candidate.refreshTokenHash === refreshTokenHash && candidate.revokedAt === null,
    );
    if (session !== undefined) {
      session.revokedAt = now;
      session.updatedAt = now;
    }
    return Promise.resolve();
  }

  createPasswordReset(input: CreatePasswordResetInput): Promise<PasswordResetToken> {
    this.passwordResetTokens
      .filter((token) => token.userId === input.userId && token.usedAt === null)
      .forEach((token) => {
        token.usedAt = input.now;
      });
    const resetToken: PasswordResetToken = {
      id: randomUUID(),
      userId: input.userId,
      tokenHash: input.tokenHash,
      expiresAt: input.expiresAt,
      usedAt: null,
      userAgent: input.userAgent,
      ipAddress: input.ipAddress,
      createdAt: input.now,
    };
    this.passwordResetTokens.push(resetToken);
    return Promise.resolve(resetToken);
  }

  findPasswordResetByTokenHash(tokenHash: string): Promise<PasswordResetWithUser | null> {
    const token = this.passwordResetTokens.find((candidate) => candidate.tokenHash === tokenHash);
    if (token === undefined) {
      return Promise.resolve(null);
    }
    const user = this.users.find((candidate) => candidate.id === token.userId);
    return Promise.resolve(user === undefined ? null : { ...token, user });
  }

  consumePasswordReset(input: ConsumePasswordResetInput): Promise<boolean> {
    const token = this.passwordResetTokens.find(
      (candidate) =>
        candidate.id === input.resetTokenId &&
        candidate.userId === input.userId &&
        candidate.tokenHash === input.tokenHash &&
        candidate.usedAt === null &&
        candidate.expiresAt > input.now,
    );
    const user = this.users.find((candidate) => candidate.id === input.userId);
    if (token === undefined || user === undefined) {
      return Promise.resolve(false);
    }

    token.usedAt = input.now;
    user.passwordHash = input.passwordHash;
    user.updatedAt = input.now;
    this.sessions
      .filter((session) => session.userId === input.userId && session.revokedAt === null)
      .forEach((session) => {
        session.revokedAt = input.now;
        session.updatedAt = input.now;
      });
    this.passwordResetTokens
      .filter((candidate) => candidate.userId === input.userId && candidate.usedAt === null)
      .forEach((candidate) => {
        candidate.usedAt = input.now;
      });
    return Promise.resolve(true);
  }

  findTeamById(teamId: string): Promise<FavoriteTeamCandidate | null> {
    const team = this.teams.find((candidate) => candidate.id === teamId);
    return Promise.resolve(team === undefined ? null : { id: team.id, isActive: team.isActive });
  }

  updateFavoriteTeam(
    userId: string,
    favoriteTeamId: string | null,
  ): Promise<UserWithFavoriteTeam | null> {
    const user = this.users.find((candidate) => candidate.id === userId && candidate.isActive);
    if (user === undefined) {
      return Promise.resolve(null);
    }
    user.favoriteTeamId = favoriteTeamId;
    user.updatedAt = new Date();
    return Promise.resolve(this.withFavoriteTeam(user));
  }

  private buildSession(input: CreateSessionInput): Session {
    const now = new Date();
    return {
      id: randomUUID(),
      userId: input.userId,
      refreshTokenHash: input.refreshTokenHash,
      expiresAt: input.expiresAt,
      revokedAt: null,
      lastUsedAt: null,
      userAgent: input.userAgent,
      ipAddress: input.ipAddress,
      createdAt: now,
      updatedAt: now,
    };
  }

  private withFavoriteTeam(user: User): UserWithFavoriteTeam {
    return {
      ...user,
      favoriteTeam:
        user.favoriteTeamId === null
          ? null
          : (this.teams.find((team) => team.id === user.favoriteTeamId) ?? null),
    };
  }
}
