import { describe, expect, it } from 'vitest';

import type {
  GameHighlightRecord,
  GameHighlightSyncStateRecord,
} from './game-highlights.repository.js';
import {
  toAdminGameHighlightDiagnosticDto,
  toPublicGameHighlightDto,
} from './game-highlights.dto.js';

function record(overrides: Partial<GameHighlightRecord> = {}): GameHighlightRecord {
  return {
    id: 'a0000000-0000-4000-8000-000000000001',
    title: 'Fictional Team vs. Fictional Team | Week 1',
    description: null,
    highlightType: 'GAME',
    thumbnailUrl: 'https://i.ytimg.com/vi/x/hqdefault.jpg',
    canonicalUrl: 'https://www.youtube.com/watch?v=x',
    embedUrl: 'https://www.youtube.com/embed/x',
    embedStatus: 'ALLOWED',
    canEmbed: true,
    embedCheckedAt: new Date('2026-08-25T12:00:00.000Z'),
    publishedAt: null,
    firstSeenAt: new Date('2026-08-25T12:00:00.000Z'),
    lastSeenAt: new Date('2026-08-25T12:00:00.000Z'),
    ...overrides,
  };
}

const availableState: GameHighlightSyncStateRecord = {
  coverage: 'AVAILABLE',
  lastCheckedAt: new Date('2026-08-25T12:00:00.000Z'),
  providerCount: 1,
  requestCount: 1,
  errorCode: null,
};

describe('toPublicGameHighlightDto', () => {
  it('never includes a provider name, provider ID, or raw payload', () => {
    const dto = toPublicGameHighlightDto('game-1', [record()], availableState);
    const serialized = JSON.stringify(dto).toLowerCase();
    expect(serialized).not.toContain('highlightly');
    expect(serialized).not.toContain('provider');
    expect(dto.highlights[0]?.id).toBe('a0000000-0000-4000-8000-000000000001');
    expect(dto.highlights[0]?.canEmbed).toBe(true);
  });

  it('M31C: forces canEmbed false when embedPlaybackEnabled is false, even if the row says ALLOWED', () => {
    const dto = toPublicGameHighlightDto('game-1', [record()], availableState, false);
    expect(dto.highlights[0]?.canEmbed).toBe(false);
  });

  it('M31C: defaults embedPlaybackEnabled to true when the argument is omitted', () => {
    const dto = toPublicGameHighlightDto('game-1', [record()], availableState);
    expect(dto.highlights[0]?.canEmbed).toBe(true);
  });

  it('never reports canEmbed true when embedUrl is null, even if the row says canEmbed', () => {
    const dto = toPublicGameHighlightDto(
      'game-1',
      [record({ embedUrl: null, canEmbed: true, embedStatus: 'ALLOWED' })],
      availableState,
    );
    expect(dto.highlights[0]?.canEmbed).toBe(false);
  });

  it('reports AVAILABLE whenever rows exist, independent of stale sync state', () => {
    const staleState: GameHighlightSyncStateRecord = {
      ...availableState,
      coverage: 'PROVIDER_ERROR',
    };
    const dto = toPublicGameHighlightDto('game-1', [record()], staleState);
    expect(dto.coverage).toBe('AVAILABLE');
  });

  it('falls back to the sync-state coverage when there are no rows', () => {
    const dto = toPublicGameHighlightDto('game-1', [], {
      ...availableState,
      coverage: 'UNAVAILABLE',
      providerCount: 0,
    });
    expect(dto.coverage).toBe('UNAVAILABLE');
  });

  it('reports UNKNOWN when no sync has ever been attempted', () => {
    const dto = toPublicGameHighlightDto('game-1', [], null);
    expect(dto.coverage).toBe('UNKNOWN');
  });
});

describe('toAdminGameHighlightDiagnosticDto', () => {
  it('never includes the raw provider highlight key or match ID', () => {
    const dto = toAdminGameHighlightDiagnosticDto('game-1', [record()], availableState);
    const serialized = JSON.stringify(dto);
    expect(serialized).not.toContain('105170');
    expect(dto).toEqual({
      gameId: 'game-1',
      dbHighlightCount: 1,
      coverage: 'AVAILABLE',
      lastCheckedAt: '2026-08-25T12:00:00.000Z',
      providerHighlightCount: 1,
      requestCount: 1,
      errorCode: null,
    });
  });

  it('lets a fresh sync error override a stale persisted error code', () => {
    const dto = toAdminGameHighlightDiagnosticDto(
      'game-1',
      [],
      { ...availableState, errorCode: 'OLD_ERROR' },
      'RATE_LIMITED',
    );
    expect(dto.errorCode).toBe('RATE_LIMITED');
  });
});
