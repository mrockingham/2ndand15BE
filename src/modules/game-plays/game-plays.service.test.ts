import { describe, expect, it, vi } from 'vitest';

import type { GameDto } from '../games/game.dto.js';
import type { GameReader } from '../games/game.service.js';
import { GamePlayService } from './game-plays.service.js';
import type { GamePlayRepository, PublicGamePlayRow } from './game-plays.repository.js';

const gameId = '8eea0601-deb8-4a28-891b-0f1fd9b1e3cd';

function game(status: GameDto['status']): GameDto {
  return {
    id: gameId,
    league: 'NFL',
    season: 2026,
    seasonType: 'PRE',
    week: 2,
    startTime: '2026-08-22T23:00:00.000Z',
    status,
    homeTeam: {
      id: 'home-team',
      fullName: 'New England Patriots',
      abbreviation: 'NE',
      logoUrl: null,
      primaryColor: '#000000',
      secondaryColor: '#ffffff',
    },
    awayTeam: {
      id: 'away-team',
      fullName: 'Philadelphia Eagles',
      abbreviation: 'PHI',
      logoUrl: null,
      primaryColor: '#000000',
      secondaryColor: '#ffffff',
    },
    homeScore: null,
    awayScore: null,
    quarter: null,
    clock: null,
    venue: { name: null, city: null },
    broadcastNetwork: null,
    isNeutralSite: false,
  };
}

function harness(status: GameDto['status'], rows: readonly PublicGamePlayRow[]) {
  const games: Pick<GameReader, 'getGame'> = {
    getGame: vi.fn(() => Promise.resolve(game(status))),
  };
  const repository: GamePlayRepository = { findPlays: vi.fn(() => Promise.resolve(rows)) };
  return new GamePlayService(repository, games);
}

describe('GamePlayService empty-play limitation copy', () => {
  it('reports plays as not yet available for a scheduled game', async () => {
    const response = await harness('SCHEDULED', []).getGamePlays(gameId);
    expect(response.meta.limitations).toEqual([
      'Structured play-by-play is not available yet for this game.',
    ]);
  });

  it('reports plays as not yet available for a live in-progress game', async () => {
    const response = await harness('IN_PROGRESS', []).getGamePlays(gameId);
    expect(response.meta.limitations).toEqual([
      'Structured play-by-play is not available yet for this game.',
    ]);
  });

  it('reports the completed-game wording only once the game is FINAL', async () => {
    const response = await harness('FINAL', []).getGamePlays(gameId);
    expect(response.meta.limitations).toEqual([
      'Structured play-by-play has not been imported for this completed game.',
    ]);
  });

  it('reports no limitations once plays are stored, regardless of status', async () => {
    const row: PublicGamePlayRow = {
      id: 'play-1',
      sequence: 1,
      period: 1,
      clock: '9:45',
      possessionTeamId: null,
      playType: 'RUSH',
      description: 'A live play',
      startDown: null,
      startDistance: null,
      startYardLine: null,
      endDown: null,
      endDistance: null,
      endYardLine: null,
      isScoringPlay: false,
      isPenalty: false,
      isTurnover: false,
    };
    const response = await harness('IN_PROGRESS', [row]).getGamePlays(gameId);
    expect(response.meta.limitations).toEqual([]);
    expect(response.data.playCount).toBe(1);
  });

  it('never exposes reconciliation/review state (admin/operator-only) through the public response', async () => {
    const row: PublicGamePlayRow = {
      id: 'play-1',
      sequence: 1,
      period: 1,
      clock: '9:45',
      possessionTeamId: null,
      playType: 'RUSH',
      description: 'A live play',
      startDown: null,
      startDistance: null,
      startYardLine: null,
      endDown: null,
      endDistance: null,
      endYardLine: null,
      isScoringPlay: false,
      isPenalty: false,
      isTurnover: false,
    };
    const response = await harness('IN_PROGRESS', [row]).getGamePlays(gameId);
    const serialized = JSON.stringify(response);
    for (const forbidden of [
      'playsReviewRequired',
      'playsBlockReason',
      'playsBlockedAt',
      'reconcil',
    ]) {
      expect(serialized.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });
});
