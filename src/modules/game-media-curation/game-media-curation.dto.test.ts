import { describe, expect, it } from 'vitest';

import {
  computeDisplayMode,
  composeDisplayVideos,
  toAdminGameCuratedVideoDto,
  toAdminGlobalGameCenterVideoDto,
  toPublicGameCuratedVideoDto,
  toPublicGameMediaDto,
  toPublicGlobalGameCenterVideoDto,
} from './game-media-curation.dto.js';
import type { GameCuratedVideoRecord } from './game-media-curation.repository.js';
import type { GlobalGameCenterVideoRecord } from './global-game-media.repository.js';
import type { PublicGameHighlightItemDto } from '../game-highlights/game-highlights.dto.js';

function record(overrides: Partial<GameCuratedVideoRecord> = {}): GameCuratedVideoRecord {
  return {
    id: 'a0000000-0000-4000-8000-000000000001',
    gameId: 'b0000000-0000-4000-8000-000000000001',
    position: 0,
    title: 'Eagles vs. Patriots | Game Highlights',
    embedUrl: 'https://www.youtube.com/embed/abc123',
    canonicalUrl: 'https://www.youtube.com/watch?v=abc123',
    thumbnailUrl: 'https://i.ytimg.com/vi/abc123/hqdefault.jpg',
    sourceLabel: 'NFL',
    createdAt: new Date('2026-08-26T12:00:00.000Z'),
    updatedAt: new Date('2026-08-26T12:00:00.000Z'),
    ...overrides,
  };
}

function globalRecord(
  overrides: Partial<GlobalGameCenterVideoRecord> = {},
): GlobalGameCenterVideoRecord {
  return {
    id: 'c0000000-0000-4000-8000-000000000001',
    title: 'NFL Kickoff Special',
    embedUrl: 'https://www.youtube.com/embed/global123',
    canonicalUrl: 'https://www.youtube.com/watch?v=global123',
    thumbnailUrl: null,
    sourceLabel: 'NFL',
    isActive: true,
    createdAt: new Date('2026-08-27T00:00:00.000Z'),
    updatedAt: new Date('2026-08-27T00:00:00.000Z'),
    ...overrides,
  };
}

function highlight(
  id: string,
  overrides: Partial<PublicGameHighlightItemDto> = {},
): PublicGameHighlightItemDto {
  return {
    id,
    title: 'Highlight',
    description: null,
    highlightType: 'GAME',
    thumbnailUrl: null,
    canonicalUrl: null,
    embedUrl: null,
    canEmbed: false,
    publishedAt: null,
    ...overrides,
  };
}

describe('computeDisplayMode', () => {
  it('is CURATED whenever any curated video exists, regardless of highlight or global-video presence', () => {
    expect(computeDisplayMode(1, 0, false)).toBe('CURATED');
    expect(computeDisplayMode(4, 10, true)).toBe('CURATED');
  });

  it('is AUTOMATIC when no curated videos exist but highlights do, regardless of global-video presence', () => {
    expect(computeDisplayMode(0, 1, false)).toBe('AUTOMATIC');
    expect(computeDisplayMode(0, 1, true)).toBe('AUTOMATIC');
  });

  it('is GLOBAL only when it is the sole media source', () => {
    expect(computeDisplayMode(0, 0, true)).toBe('GLOBAL');
  });

  it('is NONE when nothing exists at all', () => {
    expect(computeDisplayMode(0, 0, false)).toBe('NONE');
  });
});

describe('toAdminGameCuratedVideoDto', () => {
  it('marks position 0 as primary and higher positions as not primary', () => {
    expect(toAdminGameCuratedVideoDto(record({ position: 0 })).isPrimary).toBe(true);
    expect(toAdminGameCuratedVideoDto(record({ position: 1 })).isPrimary).toBe(false);
  });

  it('never includes creator/updater identity fields', () => {
    const serialized = JSON.stringify(toAdminGameCuratedVideoDto(record()));
    expect(serialized).not.toContain('createdBy');
    expect(serialized).not.toContain('updatedBy');
  });
});

describe('toAdminGlobalGameCenterVideoDto / toPublicGlobalGameCenterVideoDto', () => {
  it('never includes creator/updater identity or isActive in either shape', () => {
    const admin = toAdminGlobalGameCenterVideoDto(globalRecord());
    const publicDto = toPublicGlobalGameCenterVideoDto(globalRecord());
    expect(JSON.stringify(admin)).not.toContain('createdBy');
    expect(JSON.stringify(publicDto)).not.toContain('createdBy');
    expect(publicDto).toEqual({
      id: globalRecord().id,
      title: globalRecord().title,
      embedUrl: globalRecord().embedUrl,
      canonicalUrl: globalRecord().canonicalUrl,
      thumbnailUrl: globalRecord().thumbnailUrl,
      sourceLabel: globalRecord().sourceLabel,
    });
  });
});

describe('composeDisplayVideos', () => {
  const global = toPublicGlobalGameCenterVideoDto(globalRecord());

  it('is empty when there is nothing at all', () => {
    expect(composeDisplayVideos([], [], null)).toEqual([]);
  });

  it('is [G] when global is the sole source', () => {
    const result = composeDisplayVideos([], [], global);
    expect(result.map((item) => item.mediaType)).toEqual(['GLOBAL']);
    expect(result[0]?.id).toBe(global.id);
  });

  it('inserts global as position 2 for a single automatic highlight: [A0, G]', () => {
    const result = composeDisplayVideos([], [highlight('a0')], global);
    expect(result.map((item) => item.mediaType)).toEqual(['AUTOMATIC', 'GLOBAL']);
  });

  it('inserts global as position 2 for multiple automatic highlights: [A0, G, A1, A2]', () => {
    const result = composeDisplayVideos(
      [],
      [highlight('a0'), highlight('a1'), highlight('a2')],
      global,
    );
    expect(result.map((item) => `${item.mediaType}:${item.id}`)).toEqual([
      'AUTOMATIC:a0',
      'GLOBAL:' + global.id,
      'AUTOMATIC:a1',
      'AUTOMATIC:a2',
    ]);
  });

  it('inserts global as position 2 for curated videos, preserving the curated primary: [C0, G, C1, C2, C3]', () => {
    const curated = [
      toPublicGameCuratedVideoDto(record({ id: 'c0', position: 0 })),
      toPublicGameCuratedVideoDto(record({ id: 'c1', position: 1 })),
      toPublicGameCuratedVideoDto(record({ id: 'c2', position: 2 })),
      toPublicGameCuratedVideoDto(record({ id: 'c3', position: 3 })),
    ];
    const result = composeDisplayVideos(curated, [highlight('a0')], global);
    expect(result.map((item) => `${item.mediaType}:${item.id}`)).toEqual([
      'CURATED:c0',
      'GLOBAL:' + global.id,
      'CURATED:c1',
      'CURATED:c2',
      'CURATED:c3',
    ]);
  });

  it('never drops the global video when there is no game-specific media to attach it to', () => {
    expect(composeDisplayVideos([], [], global).length).toBe(1);
  });

  it('omits global entirely when none is configured, regardless of other media', () => {
    expect(composeDisplayVideos([], [highlight('a0')], null).map((i) => i.mediaType)).toEqual([
      'AUTOMATIC',
    ]);
  });
});

describe('toPublicGameCuratedVideoDto / toPublicGameMediaDto', () => {
  it('never includes creator/updater IDs, audit info, or the gameId row field', () => {
    const dto = toPublicGameCuratedVideoDto(record());
    const serialized = JSON.stringify(dto);
    expect(serialized).not.toContain('createdBy');
    expect(serialized).not.toContain('updatedBy');
    expect(serialized).not.toContain('created_at');
    expect(dto).toEqual({
      id: record().id,
      position: 0,
      isPrimary: true,
      title: record().title,
      embedUrl: record().embedUrl,
      canonicalUrl: record().canonicalUrl,
      thumbnailUrl: record().thumbnailUrl,
      sourceLabel: record().sourceLabel,
    });
  });

  it('preserves the given video order (the repository is responsible for ordering by position) and reports CURATED display mode when any exist', () => {
    const videos = [record({ id: 'v2', position: 1 }), record({ id: 'v1', position: 0 })];
    const dto = toPublicGameMediaDto('game-1', videos, [], 'AVAILABLE', null);
    expect(dto.displayMode).toBe('CURATED');
    expect(dto.curatedVideos.map((v) => v.id)).toEqual(['v2', 'v1']);
    expect(dto.curatedVideos[1]?.isPrimary).toBe(true);
    expect(dto.globalVideo).toBeNull();
  });

  it('falls back to AUTOMATIC when no curated videos exist but highlights do', () => {
    const dto = toPublicGameMediaDto('game-1', [], [highlight('h1')], 'AVAILABLE', null);
    expect(dto.displayMode).toBe('AUTOMATIC');
  });

  it('is NONE when neither curated videos, highlights, nor a global video exist', () => {
    const dto = toPublicGameMediaDto('game-1', [], [], 'UNKNOWN', null);
    expect(dto.displayMode).toBe('NONE');
    expect(dto.displayVideos).toEqual([]);
  });

  it('is GLOBAL when only the global video exists, and includes it in displayVideos/globalVideo', () => {
    const dto = toPublicGameMediaDto('game-1', [], [], 'UNKNOWN', globalRecord());
    expect(dto.displayMode).toBe('GLOBAL');
    expect(dto.globalVideo?.id).toBe(globalRecord().id);
    expect(dto.displayVideos.map((item) => item.mediaType)).toEqual(['GLOBAL']);
  });

  it('composes displayVideos with global inserted second when curated videos exist', () => {
    const videos = [record({ id: 'c0', position: 0 }), record({ id: 'c1', position: 1 })];
    const dto = toPublicGameMediaDto('game-1', videos, [], 'AVAILABLE', globalRecord());
    expect(dto.displayMode).toBe('CURATED'); // global presence never changes this
    expect(dto.displayVideos.map((item) => item.mediaType)).toEqual([
      'CURATED',
      'GLOBAL',
      'CURATED',
    ]);
  });
});
