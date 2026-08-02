import { AppError } from '../../common/errors/app-error.js';
import { unauthorizedError } from '../auth/auth.service.js';
import { toUserDto, type UserDto } from './user.dto.js';
import type { UserRepository } from './user.repository.js';

export interface UserPersonalizationService {
  updateFavoriteTeam(userId: string, favoriteTeamId: string | null): Promise<UserDto>;
}

export class UserService implements UserPersonalizationService {
  constructor(private readonly repository: UserRepository) {}

  async updateFavoriteTeam(userId: string, favoriteTeamId: string | null): Promise<UserDto> {
    if (favoriteTeamId !== null) {
      const team = await this.repository.findTeamById(favoriteTeamId);
      if (team === null) {
        throw new AppError({
          code: 'TEAM_NOT_FOUND',
          message: 'The requested team was not found.',
          statusCode: 404,
        });
      }
      if (!team.isActive) {
        throw new AppError({
          code: 'TEAM_INACTIVE',
          message: 'An inactive team cannot be selected as a favorite.',
          statusCode: 409,
        });
      }
    }

    const user = await this.repository.updateFavoriteTeam(userId, favoriteTeamId);
    if (user === null) {
      throw unauthorizedError();
    }
    return toUserDto(user);
  }
}
