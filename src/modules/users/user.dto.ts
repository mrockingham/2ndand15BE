import type { Prisma } from '../../generated/prisma/client.js';
import { toTeamDto, type TeamDto } from '../teams/team.dto.js';

export const userWithFavoriteTeamInclude = {
  favoriteTeam: true,
} satisfies Prisma.UserInclude;

export type UserWithFavoriteTeam = Prisma.UserGetPayload<{
  include: typeof userWithFavoriteTeamInclude;
}>;

export interface UserDto {
  readonly id: string;
  readonly email: string;
  readonly displayName: string | null;
  readonly isActive: boolean;
  readonly favoriteTeam: TeamDto | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export function toUserDto(user: UserWithFavoriteTeam): UserDto {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    isActive: user.isActive,
    favoriteTeam: user.favoriteTeam === null ? null : toTeamDto(user.favoriteTeam),
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}
