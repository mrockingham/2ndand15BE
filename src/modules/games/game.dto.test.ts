import { describe, expect, it } from 'vitest';

import type { GameEditorialOverride } from '../../generated/prisma/client.js';
import { toGameDto } from './game.dto.js';
import { createGameRecord } from './game.test-fixtures.js';

describe('resolved public game DTO', () => {
  it('uses editorial values without exposing raw override metadata', () => {
    const override: GameEditorialOverride = {
      id: '00000000-0000-4000-8000-000000000301',
      gameId: '00000000-0000-4000-8000-000000000101',
      startTime: new Date('2026-09-11T00:20:00Z'),
      status: 'POSTPONED',
      homeScore: null,
      awayScore: null,
      week: 2,
      venueName: 'Corrected Stadium',
      venueCity: null,
      broadcastNetwork: 'ESPN',
      isNeutralSite: true,
      publicCorrectionNote: 'Schedule corrected.',
      internalNote: 'Internal source note',
      resultSourceName: null,
      resultSourceUrl: null,
      resultVerifiedAt: null,
      resultReason: null,
      createdById: null,
      updatedById: null,
      createdBySnapshot: 'editor@example.com',
      updatedBySnapshot: 'editor@example.com',
      createdAt: new Date('2026-08-02T00:00:00Z'),
      updatedAt: new Date('2026-08-02T00:00:00Z'),
    };
    const dto = toGameDto({ ...createGameRecord(), editorialOverride: override });
    expect(dto).toMatchObject({
      startTime: '2026-09-11T00:20:00.000Z',
      status: 'POSTPONED',
      week: 2,
      venue: { name: 'Corrected Stadium' },
      broadcastNetwork: 'ESPN',
      isNeutralSite: true,
    });
    expect(JSON.stringify(dto)).not.toMatch(/internalNote|createdBy|provider/i);
  });

  it('falls back field-by-field when an override field is cleared', () => {
    const base = createGameRecord({ venueName: 'Base Stadium' });
    const override = {
      id: '00000000-0000-4000-8000-000000000301',
      gameId: base.id,
      startTime: null,
      status: null,
      homeScore: null,
      awayScore: null,
      week: null,
      venueName: null,
      venueCity: null,
      broadcastNetwork: null,
      isNeutralSite: null,
      publicCorrectionNote: null,
      internalNote: null,
      resultSourceName: null,
      resultSourceUrl: null,
      resultVerifiedAt: null,
      resultReason: null,
      createdById: null,
      updatedById: null,
      createdBySnapshot: 'editor@example.com',
      updatedBySnapshot: 'editor@example.com',
      createdAt: new Date(),
      updatedAt: new Date(),
    } satisfies GameEditorialOverride;
    expect(toGameDto({ ...base, editorialOverride: override }).venue.name).toBe('Base Stadium');
  });

  it('returns null instead of a fabricated time for an officially TBD kickoff', () => {
    expect(toGameDto(createGameRecord({ startTime: null })).startTime).toBeNull();
  });

  it('resolves a reviewed final result without exposing fallback provenance', () => {
    const base = createGameRecord({ status: 'SCHEDULED', homeScore: null, awayScore: null });
    const override: GameEditorialOverride = {
      id: '00000000-0000-4000-8000-000000000301',
      gameId: base.id,
      startTime: null,
      status: 'FINAL',
      homeScore: 7,
      awayScore: 27,
      week: null,
      venueName: null,
      venueCity: null,
      broadcastNetwork: null,
      isNeutralSite: null,
      publicCorrectionNote: null,
      internalNote: 'Private verification note',
      resultSourceName: 'NFL.com',
      resultSourceUrl: 'https://www.nfl.com/games/example',
      resultVerifiedAt: new Date('2026-08-21T12:00:00Z'),
      resultReason: 'Primary provider omitted the reviewed game.',
      createdById: null,
      updatedById: null,
      createdBySnapshot: 'editor@example.com',
      updatedBySnapshot: 'editor@example.com',
      createdAt: new Date('2026-08-21T12:00:00Z'),
      updatedAt: new Date('2026-08-21T12:00:00Z'),
    };

    const dto = toGameDto({ ...base, editorialOverride: override });
    expect(dto).toMatchObject({ status: 'FINAL', homeScore: 7, awayScore: 27 });
    expect(JSON.stringify(dto)).not.toMatch(/NFL\.com|verification|resultSource|editor/i);
  });
});
