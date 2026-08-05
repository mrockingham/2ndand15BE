import { AppError } from '../../common/errors/app-error.js';
import {
  NFLVERSE_PUBLIC_ATTRIBUTION,
  toPlayerDto,
  toPlayerGameStatDto,
  toPlayerSeasonStatDto,
} from './player.dto.js';
import type { PlayerFilters, PlayerRepository, PlayerStatFilters } from './player.repository.js';

export interface PlayerReader {
  listPlayers(filters: PlayerFilters): Promise<unknown>;
  getPlayer(id: string): Promise<unknown>;
  getPlayerStats(id: string, filters: PlayerStatFilters): Promise<unknown>;
  getPlayerSeasons(id: string): Promise<unknown>;
}
export class PlayerService implements PlayerReader {
  constructor(private readonly repository: PlayerRepository) {}
  async listPlayers(filters: PlayerFilters) {
    const page = await this.repository.findPlayers(filters);
    return {
      data: page.players.map(toPlayerDto),
      meta: { nextCursor: page.nextCursor, attribution: NFLVERSE_PUBLIC_ATTRIBUTION },
    };
  }
  async getPlayer(id: string) {
    const player = await this.requirePlayer(id);
    return { data: toPlayerDto(player), meta: { attribution: NFLVERSE_PUBLIC_ATTRIBUTION } };
  }
  async getPlayerStats(id: string, filters: PlayerStatFilters) {
    await this.requirePlayer(id);
    const page = await this.repository.findStats(id, filters);
    return {
      data: page.stats.map(toPlayerGameStatDto),
      meta: { nextCursor: page.nextCursor, attribution: NFLVERSE_PUBLIC_ATTRIBUTION },
    };
  }
  async getPlayerSeasons(id: string) {
    await this.requirePlayer(id);
    const rows = await this.repository.findSeasons(id);
    return {
      data: rows.map(toPlayerSeasonStatDto),
      meta: { attribution: NFLVERSE_PUBLIC_ATTRIBUTION },
    };
  }
  private async requirePlayer(id: string) {
    const player = await this.repository.findPlayer(id);
    if (player === null)
      throw new AppError({
        code: 'PLAYER_NOT_FOUND',
        message: 'The requested player was not found.',
        statusCode: 404,
      });
    return player;
  }
}
