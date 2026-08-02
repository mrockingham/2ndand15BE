/* Vitest repository mock methods are intentionally referenced as assertion subjects. */
/* eslint-disable @typescript-eslint/unbound-method */
import { describe, expect, it, vi } from 'vitest';

import { createGameRecord } from '../games/game.test-fixtures.js';
import type { AdministrativePrincipal } from './admin-authorization.js';
import type { AdminGameRecord } from './admin.dto.js';
import type { AdminRepository } from './admin.repository.js';
import type { ScheduleImportRequest } from './admin.schemas.js';
import { AdminService } from './admin.service.js';

const editor: AdministrativePrincipal = {
  userId: '00000000-0000-4000-8000-000000000010',
  email: 'editor@example.com',
  role: 'EDITOR',
};

const admin: AdministrativePrincipal = {
  userId: '00000000-0000-4000-8000-000000000011',
  email: 'admin@example.com',
  role: 'ADMIN',
};

function importRequest(
  overrides: Partial<ScheduleImportRequest['rows'][number]> = {},
  dryRun = true,
): ScheduleImportRequest {
  return {
    dryRun,
    rows: [
      {
        season: 2026,
        seasonType: 'REG',
        week: 1,
        startTime: '2026-09-10T00:20:00Z',
        awayTeam: 'DAL',
        homeTeam: 'WSH',
        status: 'SCHEDULED',
        venueName: 'Development Stadium',
        venueCity: 'Example City',
        broadcastNetwork: null,
        isNeutralSite: false,
        sourceName: 'Development schedule',
        sourceType: 'DEVELOPMENT_FIXTURE',
        sourceUrl: null,
        externalReference: 'dev-game-1',
        notes: 'Fictional',
        ...overrides,
      },
    ],
  };
}

function createRepository(overrides: Partial<AdminRepository> = {}) {
  const repository = {
    listActiveTeamAbbreviations: vi.fn().mockResolvedValue([
      { id: '00000000-0000-4000-8000-000000000001', abbreviation: 'WAS' },
      { id: '00000000-0000-4000-8000-000000000002', abbreviation: 'DAL' },
    ]),
    findGameBySourceReference: vi.fn().mockResolvedValue(null),
    findLikelyGame: vi.fn().mockResolvedValue(null),
    createImportedGame: vi.fn().mockResolvedValue(createAdminGame()),
    updateImportedGame: vi.fn().mockResolvedValue(createAdminGame()),
    createImportAudit: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as AdminRepository;
  return repository;
}

describe('schedule import service', () => {
  it('resolves WSH to the internal WAS team and performs a mutation-free dry run', async () => {
    const repository = createRepository();
    const result = await new AdminService(repository).importSchedule(importRequest(), editor, null);
    expect(result).toMatchObject({ dryRun: true, created: 1, failed: 0 });
    const findLikelyGame = vi.mocked(repository.findLikelyGame);
    const createImportedGame = vi.mocked(repository.createImportedGame);
    const createImportAudit = vi.mocked(repository.createImportAudit);
    expect(findLikelyGame).toHaveBeenCalledWith(
      expect.objectContaining({ homeTeamId: '00000000-0000-4000-8000-000000000001' }),
    );
    expect(createImportedGame).not.toHaveBeenCalled();
    expect(createImportAudit).not.toHaveBeenCalled();
  });

  it('rejects unknown teams and duplicate rows before making any write', async () => {
    const repository = createRepository();
    const service = new AdminService(repository);
    await expect(
      service.importSchedule(importRequest({ homeTeam: 'XXX' }, false), editor, null),
    ).resolves.toMatchObject({ failed: 1, created: 0, updated: 0 });
    const duplicate = importRequest({}, false);
    await expect(
      service.importSchedule(
        { ...duplicate, rows: [...duplicate.rows, ...duplicate.rows] },
        editor,
        null,
      ),
    ).resolves.toMatchObject({ failed: 1, created: 0, updated: 0 });
    const createImportedGame = vi.mocked(repository.createImportedGame);
    expect(createImportedGame).not.toHaveBeenCalled();
  });

  it('is idempotent when the source reference and effective values already match', async () => {
    const existing = createAdminGame();
    const repository = createRepository({
      findGameBySourceReference: vi.fn().mockResolvedValue(existing),
    });
    const result = await new AdminService(repository).importSchedule(importRequest(), editor, null);
    expect(result).toMatchObject({ created: 0, updated: 0, skipped: 1, failed: 0 });
    const updateImportedGame = vi.mocked(repository.updateImportedGame);
    expect(updateImportedGame).not.toHaveBeenCalled();
  });

  it('compares imported base fields independently of an editorial override', async () => {
    const existing = {
      ...createAdminGame(),
      editorialOverride: createEditorialOverride(),
    } satisfies AdminGameRecord;
    const repository = createRepository({
      findGameBySourceReference: vi.fn().mockResolvedValue(existing),
    });
    const result = await new AdminService(repository).importSchedule(importRequest(), editor, null);
    expect(result).toMatchObject({ created: 0, updated: 0, skipped: 1, failed: 0 });
    expect(vi.mocked(repository.updateImportedGame)).not.toHaveBeenCalled();
  });

  it('writes only with explicit non-dry-run input and records an aggregate audit event', async () => {
    const repository = createRepository();
    const result = await new AdminService(repository).importSchedule(
      importRequest({}, false),
      editor,
      'req-1',
    );
    expect(result).toMatchObject({ dryRun: false, created: 1 });
    const createImportedGame = vi.mocked(repository.createImportedGame);
    const createImportAudit = vi.mocked(repository.createImportAudit);
    expect(createImportedGame).toHaveBeenCalledOnce();
    expect(createImportAudit).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: 'req-1' }),
      expect.objectContaining({ created: 1 }),
    );
  });
});

describe('audit event scope', () => {
  it('limits editors to game events while admins retain full audit access', async () => {
    const repository = createRepository({
      listAuditEvents: vi.fn().mockResolvedValue({ events: [], nextCursor: null }),
    });
    const service = new AdminService(repository);

    await expect(service.listAuditEvents({ limit: 50 }, editor)).rejects.toMatchObject({
      code: 'ADMIN_AUDIT_SCOPE_REQUIRED',
    });
    await expect(
      service.listAuditEvents({ limit: 50, entityType: 'GAME' }, editor),
    ).resolves.toMatchObject({ events: [] });
    await expect(service.listAuditEvents({ limit: 50 }, admin)).resolves.toMatchObject({
      events: [],
    });
  });
});

function createAdminGame(): AdminGameRecord {
  return {
    ...createGameRecord({
      homeTeamId: '00000000-0000-4000-8000-000000000001',
      awayTeamId: '00000000-0000-4000-8000-000000000002',
      venueName: 'Development Stadium',
      venueCity: 'Example City',
    }),
    providerMaps: [],
    provenance: {
      id: '00000000-0000-4000-8000-000000000201',
      gameId: '00000000-0000-4000-8000-000000000101',
      sourceName: 'Development schedule',
      sourceType: 'DEVELOPMENT_FIXTURE',
      sourceUrl: null,
      externalReference: 'dev-game-1',
      notes: 'Fictional',
      importedAt: new Date('2026-08-02T00:00:00Z'),
      verifiedAt: null,
      verifiedById: null,
      createdAt: new Date('2026-08-02T00:00:00Z'),
      updatedAt: new Date('2026-08-02T00:00:00Z'),
    },
  };
}

function createEditorialOverride(): NonNullable<AdminGameRecord['editorialOverride']> {
  return {
    id: '00000000-0000-4000-8000-000000000301',
    gameId: '00000000-0000-4000-8000-000000000101',
    startTime: new Date('2026-09-11T00:20:00Z'),
    status: null,
    week: null,
    venueName: null,
    venueCity: null,
    broadcastNetwork: null,
    isNeutralSite: null,
    publicCorrectionNote: 'Public kickoff correction',
    internalNote: null,
    createdById: editor.userId,
    updatedById: editor.userId,
    createdBySnapshot: editor.email,
    updatedBySnapshot: editor.email,
    createdAt: new Date('2026-08-02T00:00:00Z'),
    updatedAt: new Date('2026-08-02T00:00:00Z'),
  };
}
