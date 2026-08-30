/* Repository mocks are intentionally inspected as assertion subjects. */
/* eslint-disable @typescript-eslint/unbound-method */
import { describe, expect, it, vi } from 'vitest';

import type { AdministrativePrincipal } from '../admin/admin-authorization.js';
import type { PowerRankingEditionRecord, PowerRankingEntryRecord } from './power-ranking.dto.js';
import type { PowerRankingRepository, TeamIdentity } from './power-ranking.repository.js';
import type { PowerRankingImportDocument } from './power-ranking.schemas.js';
import { PowerRankingService } from './power-ranking.service.js';

const editor: AdministrativePrincipal = {
  userId: '00000000-0000-4000-8000-000000000010',
  email: 'editor@example.com',
  role: 'EDITOR',
};

const RAMS: TeamIdentity = {
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Rams',
  fullName: 'Los Angeles Rams',
  abbreviation: 'LAR',
  conference: 'NFC',
  division: 'West',
};
const CHIEFS: TeamIdentity = {
  id: '00000000-0000-4000-8000-000000000002',
  name: 'Chiefs',
  fullName: 'Kansas City Chiefs',
  abbreviation: 'KC',
  conference: 'AFC',
  division: 'West',
};

function entryRecord(
  overrides: Omit<Partial<PowerRankingEntryRecord>, 'team'> & { readonly team?: TeamIdentity } = {},
): PowerRankingEntryRecord {
  return {
    id: '00000000-0000-4000-8000-000000000101',
    editionId: '00000000-0000-4000-8000-000000000900',
    teamId: RAMS.id,
    rank: 1,
    previousRank: null,
    movement: null,
    tier: 'Contender',
    headline: 'A fictional headline',
    summary: 'A fictional forty-plus character summary used for testing.',
    strengths: ['Fictional strength'],
    concerns: ['Fictional concern'],
    createdAt: new Date('2026-08-30T00:00:00.000Z'),
    updatedAt: new Date('2026-08-30T00:00:00.000Z'),
    team: RAMS,
    ...overrides,
  } as unknown as PowerRankingEntryRecord;
}

function editionRecord(
  overrides: Partial<PowerRankingEditionRecord> = {},
  entries: readonly PowerRankingEntryRecord[] = [entryRecord()],
): PowerRankingEditionRecord {
  return {
    id: '00000000-0000-4000-8000-000000000900',
    season: 2026,
    edition: 'preseason',
    title: '2026 NFL Power Rankings',
    subtitle: '2nd & 15 Preseason Edition',
    asOf: new Date('2026-08-30T00:00:00.000Z'),
    methodology: 'A fictional methodology.',
    sources: ['DAZN', 'PFT / NBC Sports', 'Kalshi'],
    status: 'DRAFT',
    publishedAt: null,
    createdById: editor.userId,
    updatedById: editor.userId,
    createdBySnapshot: editor.email,
    updatedBySnapshot: editor.email,
    createdAt: new Date('2026-08-30T00:00:00.000Z'),
    updatedAt: new Date('2026-08-30T00:00:00.000Z'),
    entries,
    ...overrides,
  } as unknown as PowerRankingEditionRecord;
}

function repositoryMock(overrides: Partial<PowerRankingRepository> = {}): PowerRankingRepository {
  return {
    listActiveNflTeams: vi.fn().mockResolvedValue([RAMS, CHIEFS]),
    findById: vi.fn().mockResolvedValue(null),
    findPublished: vi.fn().mockResolvedValue(null),
    findBySeasonEdition: vi.fn().mockResolvedValue(null),
    findLatestPublished: vi.fn().mockResolvedValue(null),
    listPublishedEditions: vi.fn().mockResolvedValue([]),
    listAdmin: vi.fn().mockResolvedValue({ editions: [], nextCursor: null }),
    createEdition: vi.fn().mockResolvedValue(editionRecord()),
    updateEdition: vi.fn().mockResolvedValue(editionRecord()),
    setStatus: vi.fn().mockResolvedValue(editionRecord({ status: 'PUBLISHED' })),
    updateEntry: vi.fn().mockResolvedValue({ kind: 'OK', edition: editionRecord() }),
    reorderEntries: vi.fn().mockResolvedValue(editionRecord()),
    importUpsert: vi.fn().mockResolvedValue({ edition: editionRecord(), created: true }),
    ...overrides,
  };
}

const RAMS_RANKING = {
  rank: 1,
  teamId: 'los-angeles-rams',
  team: 'Los Angeles Rams',
  abbreviation: 'LAR',
  conference: 'NFC',
  division: 'West',
  tier: 'Contender',
  headline: 'A fictional headline',
  summary: 'A fictional forty-plus character summary used for testing.',
  strengths: ['Fictional strength'],
  concerns: ['Fictional concern'],
};
const CHIEFS_RANKING = {
  rank: 2,
  teamId: 'kansas-city-chiefs',
  team: 'Kansas City Chiefs',
  abbreviation: 'KC',
  conference: 'AFC',
  division: 'West',
  tier: 'Contender',
  headline: 'Another fictional headline',
  summary: 'Another fictional forty-plus character summary used for testing.',
  strengths: ['Fictional strength'],
  concerns: ['Fictional concern'],
};

function importDocument(
  overrides: Partial<PowerRankingImportDocument> = {},
): PowerRankingImportDocument {
  return {
    title: '2026 NFL Power Rankings',
    season: 2026,
    edition: 'preseason',
    asOf: '2026-08-30T00:00:00.000Z',
    methodology: 'A fictional methodology.',
    sources: ['DAZN'],
    subtitle: '2nd & 15 Preseason Edition',
    rankings: [RAMS_RANKING, CHIEFS_RANKING],
    ...overrides,
  };
}

describe('PowerRankingService.getPublic', () => {
  it('returns the latest published edition when no edition is specified', async () => {
    const repository = repositoryMock({
      findLatestPublished: vi.fn().mockResolvedValue(editionRecord({ status: 'PUBLISHED' })),
    });
    const result = await new PowerRankingService(repository).getPublic();
    expect(result.edition.season).toBe(2026);
    expect(vi.mocked(repository.findLatestPublished)).toHaveBeenCalledWith(undefined);
  });

  it('returns a specific published edition when season and edition are given', async () => {
    const repository = repositoryMock({
      findPublished: vi.fn().mockResolvedValue(editionRecord({ status: 'PUBLISHED' })),
    });
    const result = await new PowerRankingService(repository).getPublic(2026, 'preseason');
    expect(result.edition.edition).toBe('preseason');
    expect(vi.mocked(repository.findPublished)).toHaveBeenCalledWith(2026, 'preseason');
  });

  it('404s when no published edition matches (e.g. it is still DRAFT)', async () => {
    const repository = repositoryMock({ findLatestPublished: vi.fn().mockResolvedValue(null) });
    await expect(new PowerRankingService(repository).getPublic()).rejects.toMatchObject({
      statusCode: 404,
    });
  });
});

describe('PowerRankingService publish readiness', () => {
  it('rejects publish when the edition does not have exactly 32 entries', async () => {
    const repository = repositoryMock({
      findById: vi.fn().mockResolvedValue(editionRecord({}, [entryRecord()])),
    });
    await expect(
      new PowerRankingService(repository).publish(
        '00000000-0000-4000-8000-000000000900',
        editor,
        null,
      ),
    ).rejects.toMatchObject({ code: 'POWER_RANKING_PUBLISH_INCOMPLETE' });
    expect(vi.mocked(repository.setStatus)).not.toHaveBeenCalled();
  });

  it('rejects publish when a team in the edition is no longer active', async () => {
    const thirtyTwoEntries = Array.from({ length: 32 }, (_, i) =>
      entryRecord({
        id: `00000000-0000-4000-8000-0000000002${String(i).padStart(2, '0')}`,
        rank: i + 1,
        teamId: i === 0 ? RAMS.id : `00000000-0000-4000-8000-00000000${String(9000 + i)}`,
        team:
          i === 0 ? RAMS : { ...RAMS, id: `00000000-0000-4000-8000-00000000${String(9000 + i)}` },
      }),
    );
    const repository = repositoryMock({
      findById: vi
        .fn()
        .mockResolvedValue(editionRecord({}, thirtyTwoEntriesGuard(thirtyTwoEntries))),
      listActiveNflTeams: vi.fn().mockResolvedValue([RAMS]),
    });
    await expect(
      new PowerRankingService(repository).publish(
        '00000000-0000-4000-8000-000000000900',
        editor,
        null,
      ),
    ).rejects.toMatchObject({ code: 'POWER_RANKING_PUBLISH_INACTIVE_TEAM' });
  });
});

describe('PowerRankingService import validation', () => {
  it('rejects duplicate ranks and duplicate teams without writing anything', async () => {
    const repository = repositoryMock();
    const service = new PowerRankingService(repository);
    const document = importDocument({
      rankings: [
        { ...RAMS_RANKING, rank: 1 },
        { ...CHIEFS_RANKING, rank: 1 },
      ],
    });
    const preview = await service.previewImport(document);
    expect(preview.valid).toBe(false);
    expect(preview.errors.some((issue) => issue.message.includes('Rank 1 is used'))).toBe(true);

    await expect(service.upsertImport(document, false, editor, null)).rejects.toMatchObject({
      code: 'POWER_RANKING_IMPORT_INVALID',
    });
    expect(vi.mocked(repository.importUpsert)).not.toHaveBeenCalled();
  });

  it('rejects an unknown team and an abbreviation mismatch during preview, writing nothing', async () => {
    const repository = repositoryMock();
    const service = new PowerRankingService(repository);
    const document = importDocument({
      rankings: [
        {
          ...RAMS_RANKING,
          teamId: 'nonexistent-team',
          abbreviation: 'ZZZ',
          team: 'Nonexistent',
        },
        CHIEFS_RANKING,
      ],
    });
    const preview = await service.previewImport(document);
    expect(preview.valid).toBe(false);
    expect(preview.errors).not.toHaveLength(0);
    expect(vi.mocked(repository.importUpsert)).not.toHaveBeenCalled();
  });

  it('rolls back (never calls the write path) when even one entry is invalid', async () => {
    const repository = repositoryMock();
    const service = new PowerRankingService(repository);
    const document = importDocument({
      rankings: [RAMS_RANKING, { ...CHIEFS_RANKING, abbreviation: 'ZZZ' }],
    });
    await expect(service.upsertImport(document, false, editor, null)).rejects.toMatchObject({
      code: 'POWER_RANKING_IMPORT_INVALID',
    });
    expect(vi.mocked(repository.importUpsert)).not.toHaveBeenCalled();
  });

  it('a clean, fully-matched document upserts successfully', async () => {
    const repository = repositoryMock();
    const service = new PowerRankingService(repository);
    const document = importDocument();
    const preview = await service.previewImport(document);
    expect(preview.valid).toBe(true);
    expect(preview.teamMatches).toHaveLength(2);

    const outcome = await service.upsertImport(document, false, editor, null);
    expect(outcome.created).toBe(true);
    expect(vi.mocked(repository.importUpsert)).toHaveBeenCalledOnce();
  });
});

function thirtyTwoEntriesGuard(
  entries: readonly PowerRankingEntryRecord[],
): readonly PowerRankingEntryRecord[] {
  if (entries.length !== 32) throw new Error('test fixture must contain exactly 32 entries');
  return entries;
}
