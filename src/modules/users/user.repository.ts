import { Prisma, type PrismaClient } from '../../generated/prisma/client.js';
import { userWithFavoriteTeamInclude, type UserWithFavoriteTeam } from './user.dto.js';

export interface FavoriteTeamCandidate {
  readonly id: string;
  readonly isActive: boolean;
}

export interface UserRepository {
  findTeamById(teamId: string): Promise<FavoriteTeamCandidate | null>;
  updateFavoriteTeam(
    userId: string,
    favoriteTeamId: string | null,
  ): Promise<UserWithFavoriteTeam | null>;
}

export class PrismaUserRepository implements UserRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findTeamById(teamId: string): Promise<FavoriteTeamCandidate | null> {
    return this.prisma.team.findUnique({
      where: { id: teamId },
      select: { id: true, isActive: true },
    });
  }

  async updateFavoriteTeam(
    userId: string,
    favoriteTeamId: string | null,
  ): Promise<UserWithFavoriteTeam | null> {
    try {
      return await this.prisma.user.update({
        where: { id: userId, isActive: true },
        data: { favoriteTeamId },
        include: userWithFavoriteTeamInclude,
      });
    } catch (error: unknown) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        return null;
      }
      throw error;
    }
  }
}
