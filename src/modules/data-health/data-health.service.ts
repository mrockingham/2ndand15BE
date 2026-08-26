import { AppError } from '../../common/errors/app-error.js';
import type { DataHealthProbeResult } from './data-health-probe.service.js';
import type { GameDataHealthProbeService } from './data-health-probe.service.js';
import {
  summarizeDataHealthRows,
  toDataHealthGameDetailDto,
  toDataHealthGameRow,
  type DataHealthGameRow,
  type DataHealthSummary,
} from './data-health.dto.js';
import type { DataHealthGameListQuery, DataHealthProbeListQuery } from './data-health.schemas.js';
import type { DataHealthProbeRecord, DataHealthRepository } from './data-health.repository.js';

export interface DataHealthGameListResult {
  readonly games: readonly DataHealthGameRow[];
  readonly summary: DataHealthSummary;
  readonly nextCursor: string | null;
}

export interface DataHealthServiceContract {
  listGames(query: DataHealthGameListQuery): Promise<DataHealthGameListResult>;
  getGame(gameId: string): Promise<ReturnType<typeof toDataHealthGameDetailDto>>;
  listProbes(
    gameId: string,
    query: DataHealthProbeListQuery,
  ): Promise<readonly DataHealthProbeRecord[]>;
  runProbe(gameId: string): Promise<DataHealthProbeResult>;
}

export class DataHealthService implements DataHealthServiceContract {
  constructor(
    private readonly repository: DataHealthRepository,
    private readonly probeService?: GameDataHealthProbeService,
  ) {}

  async listGames(query: DataHealthGameListQuery): Promise<DataHealthGameListResult> {
    const page = await this.repository.listGames(query);
    const rows = page.games.map((game) =>
      toDataHealthGameRow(game, page.activePlayCounts.get(game.id) ?? 0),
    );
    const summary = summarizeDataHealthRows(rows);
    const games = query.issuesOnly === true ? rows.filter((row) => row.needsInvestigation) : rows;
    return { games, summary, nextCursor: page.nextCursor };
  }

  async getGame(gameId: string): Promise<ReturnType<typeof toDataHealthGameDetailDto>> {
    const found = await this.repository.getGame(gameId);
    if (found === null) {
      throw new AppError({
        code: 'GAME_NOT_FOUND',
        message: 'The internal game was not found.',
        statusCode: 404,
      });
    }
    return toDataHealthGameDetailDto(found.game, {
      activeCount: found.activePlayCount,
      supersededCount: found.supersededPlayCount,
    });
  }

  listProbes(
    gameId: string,
    query: DataHealthProbeListQuery,
  ): Promise<readonly DataHealthProbeRecord[]> {
    return this.repository.listProbes(gameId, query);
  }

  async runProbe(gameId: string): Promise<DataHealthProbeResult> {
    return this.requireProbeService().probe(gameId);
  }

  private requireProbeService(): GameDataHealthProbeService {
    if (this.probeService === undefined) {
      throw new AppError({
        code: 'GAME_DATA_HEALTH_PROBE_UNCONFIGURED',
        message: 'The Highlightly data-health probe is not configured on this server.',
        statusCode: 500,
      });
    }
    return this.probeService;
  }
}
