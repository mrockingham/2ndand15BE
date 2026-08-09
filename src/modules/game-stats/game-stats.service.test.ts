import { describe, expect, it, vi } from 'vitest';

import { toGameDto } from '../games/game.dto.js';
import { createGameRecord } from '../games/game.test-fixtures.js';
import type {
  GameStatsRepository,
  PublicCurrentGamePlayerStatRow,
  PublicCurrentGameTeamStatRow,
} from './game-stats.repository.js';
import { GameStatsService } from './game-stats.service.js';

const game = toGameDto(createGameRecord());

describe('GameStatsService', () => {
  it('returns correctly oriented game-only team totals with distinct null and zero values', async () => {
    const repository: GameStatsRepository = {
      findTeamStats: vi
        .fn()
        .mockResolvedValue([
          row(game.homeTeam.id, true, { totalYards: 425, turnovers: 0, overtime1Score: null }),
          row(game.awayTeam.id, false, { totalYards: 378, turnovers: 1, overtime1Score: null }),
        ]),
    };
    const service = new GameStatsService(repository, { getGame: () => Promise.resolve(game) });
    const response = await service.getGameStats(game.id);
    expect(response.data.teamStats.home).toMatchObject({
      teamId: game.homeTeam.id,
      totalYards: 425,
      turnovers: 0,
      scoringByPeriod: { q1: 0, ot1: null },
    });
    expect(response.data.teamStats.away).toMatchObject({
      teamId: game.awayTeam.id,
      totalYards: 378,
      turnovers: 1,
    });
    expect(response.meta.playerStatsAvailable).toBe(false);
    expect(JSON.stringify(response)).not.toMatch(
      /highlightly|providerGameId|sourceProvider|rawPayload/,
    );
  });

  it('rejects missing or incorrectly oriented stat pairs', async () => {
    const service = new GameStatsService(
      { findTeamStats: () => Promise.resolve([row(game.homeTeam.id, true)]) },
      { getGame: () => Promise.resolve(game) },
    );
    await expect(service.getGameStats(game.id)).rejects.toMatchObject({
      code: 'GAME_STATS_NOT_FOUND',
      statusCode: 404,
    });
  });

  it('returns multi-category player rows with internal identity and coverage only', async () => {
    const player = playerRow(game.homeTeam.id, {
      passingAttempts: 0,
      passingCompletions: 0,
      rushingAttempts: 2,
      rushingYards: -1,
    });
    const repository: GameStatsRepository = {
      findTeamStats: () =>
        Promise.resolve([row(game.homeTeam.id, true), row(game.awayTeam.id, false)]),
      findPlayerBoxScore: () =>
        Promise.resolve({
          rows: [player],
          coverage: { providerRows: 82, resolvedRows: 76, unresolvedRows: 6 },
        }),
    };
    const response = await new GameStatsService(repository, {
      getGame: () => Promise.resolve(game),
    }).getGameStats(game.id);
    expect(response.data.playerStats.home.passing[0]).toMatchObject({
      player: { id: 'internal-player', displayName: 'Example Player' },
      attempts: 0,
    });
    expect(response.data.playerStats.home.rushing[0]).toMatchObject({ attempts: 2, yards: -1 });
    expect(response.data.playerStats.away.passing).toEqual([]);
    expect(response.meta).toMatchObject({
      playerStatsAvailable: true,
      playerStatsCoverage: { providerRows: 82, resolvedRows: 76, unresolvedRows: 6 },
    });
    expect(JSON.stringify(response)).not.toMatch(/highlightly|providerPlayerId|externalId/);
  });
});

function playerRow(
  teamId: string,
  overrides: Partial<PublicCurrentGamePlayerStatRow> = {},
): PublicCurrentGamePlayerStatRow {
  return {
    teamId,
    passingCompletions: null,
    passingAttempts: null,
    passingYards: null,
    passingTouchdowns: null,
    passingInterceptions: null,
    sacksSuffered: null,
    sackYardsLost: null,
    rushingAttempts: null,
    rushingYards: null,
    rushingTouchdowns: null,
    longestRush: null,
    targets: null,
    receptions: null,
    receivingYards: null,
    receivingTouchdowns: null,
    longestReception: null,
    fumbles: null,
    fumbleRecoveries: null,
    tacklesTotal: null,
    tacklesSolo: null,
    defensiveSacks: null,
    tacklesForLoss: null,
    passesDefended: null,
    defensiveTouchdowns: null,
    fieldGoalsMade: null,
    fieldGoalsAttempted: null,
    longestFieldGoal: null,
    extraPointsMade: null,
    extraPointsAttempted: null,
    punts: null,
    puntYards: null,
    puntAverage: null,
    puntsInside20: null,
    puntTouchbacks: null,
    longestPunt: null,
    kickReturns: null,
    kickReturnYards: null,
    kickReturnTouchdowns: null,
    longestKickReturn: null,
    puntReturns: null,
    puntReturnYards: null,
    puntReturnTouchdowns: null,
    longestPuntReturn: null,
    player: {
      id: 'internal-player',
      displayName: 'Example Player',
      position: 'QB',
      positionGroup: 'QB',
      headshotUrl: null,
    },
    ...overrides,
  };
}

export function row(
  teamId: string,
  isHome: boolean,
  overrides: Partial<PublicCurrentGameTeamStatRow> = {},
): PublicCurrentGameTeamStatRow {
  return {
    teamId,
    isHome,
    firstDowns: 0,
    firstDownsPassing: null,
    firstDownsRushing: null,
    firstDownsPenalty: null,
    totalPlays: 0,
    totalYards: 0,
    passingCompletions: 0,
    passingAttempts: 0,
    passingYards: 0,
    passingInterceptions: 0,
    rushingAttempts: 0,
    rushingYards: 0,
    turnovers: 0,
    fumblesLost: 0,
    sacks: 0,
    sackYardsLost: 0,
    thirdDownConversions: 0,
    thirdDownAttempts: 0,
    fourthDownConversions: 0,
    fourthDownAttempts: 0,
    penalties: 0,
    penaltyYards: 0,
    possessionSeconds: null,
    redZoneConversions: 0,
    redZoneAttempts: 0,
    totalDrives: 0,
    period1Score: 0,
    period2Score: 0,
    period3Score: 0,
    period4Score: 0,
    overtime1Score: null,
    overtime2Score: null,
    ...overrides,
  };
}
