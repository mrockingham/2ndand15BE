/* Vitest repository mock methods are intentionally referenced as assertion subjects. */
/* eslint-disable @typescript-eslint/unbound-method */
import { describe, expect, it, vi } from 'vitest';

import { createGameRecord } from '../games/game.test-fixtures.js';
import type { ReconciliationDiagnosticService } from '../sports/current-game-play-reconciliation-diagnostic.js';
import type { PlayReconciliationRepairService } from '../sports/current-game-play-repair.js';
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
    findCurrentTeamStats: vi.fn().mockResolvedValue([]),
    upsertResultFallback: vi.fn().mockResolvedValue(createAdminGame()),
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

  it('preserves TBD as a null kickoff and skips an identical existing row', async () => {
    const existing = createAdminGame();
    existing.startTime = null;
    const repository = createRepository({
      findGameBySourceReference: vi.fn().mockResolvedValue(existing),
    });
    const result = await new AdminService(repository).importSchedule(
      importRequest({ startTime: 'TBD' }),
      editor,
      null,
    );

    expect(result).toMatchObject({ created: 0, updated: 0, skipped: 1, failed: 0 });
    expect(vi.mocked(repository.findGameBySourceReference)).toHaveBeenCalled();
    expect(vi.mocked(repository.updateImportedGame)).not.toHaveBeenCalled();
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
    await expect(
      service.listAuditEvents({ limit: 50, entityType: 'ARTICLE', entityId: 'article-1' }, editor),
    ).resolves.toMatchObject({ events: [] });
    await expect(
      service.listAuditEvents({ limit: 50, entityType: 'ARTICLE' }, editor),
    ).rejects.toMatchObject({ code: 'ADMIN_AUDIT_SCOPE_REQUIRED' });
    await expect(service.listAuditEvents({ limit: 50 }, admin)).resolves.toMatchObject({
      events: [],
    });
  });
});

describe('reviewed result fallback', () => {
  const input = {
    status: 'FINAL' as const,
    homeScore: 7,
    awayScore: 27,
    sourceName: 'NFL.com',
    sourceUrl: 'https://www.nfl.com/games/chargers-at-texans-2026-pre-1',
    reason: 'Primary provider omitted the reviewed game.',
    internalNote: 'Independently reviewed.',
    dryRun: true,
  };

  it('dry-runs an existing reviewed game and keeps team-stat unavailability independent', async () => {
    const game = createAdminGame();
    markReviewed(game);
    const repository = createRepository({ findGame: vi.fn().mockResolvedValue(game) });

    await expect(
      new AdminService(repository).upsertResultFallback(game.id, input, editor, null),
    ).resolves.toMatchObject({
      dryRun: true,
      outcome: 'WOULD_CREATE',
      resultCoverage: 'EDITORIAL_RESULT_FALLBACK',
      teamStatCoverage: 'TEAM_STATS_UNAVAILABLE',
      game: { resolved: { status: 'FINAL', homeScore: 7, awayScore: 27 } },
    });
    expect(vi.mocked(repository.upsertResultFallback)).not.toHaveBeenCalled();
  });

  it('rejects games without reviewed schedule provenance', async () => {
    const repository = createRepository({ findGame: vi.fn().mockResolvedValue(createAdminGame()) });
    await expect(
      new AdminService(repository).upsertResultFallback('game', input, editor, null),
    ).rejects.toMatchObject({ code: 'REVIEWED_GAME_REQUIRED' });
  });

  it('cannot create a missing game through result fallback', async () => {
    const repository = createRepository({ findGame: vi.fn().mockResolvedValue(null) });
    await expect(
      new AdminService(repository).upsertResultFallback('missing', input, editor, null),
    ).rejects.toMatchObject({ code: 'GAME_NOT_FOUND' });
    expect(vi.mocked(repository.upsertResultFallback)).not.toHaveBeenCalled();
  });

  it('applies once with actor provenance and treats an identical repeat as a no-op', async () => {
    const game = createAdminGame();
    markReviewed(game);
    const applied = {
      ...game,
      editorialOverride: createEditorialOverride({
        status: 'FINAL',
        homeScore: 7,
        awayScore: 27,
        resultSourceName: input.sourceName,
        resultSourceUrl: input.sourceUrl,
        resultVerifiedAt: new Date('2026-08-21T12:00:00Z'),
        resultReason: input.reason,
        internalNote: input.internalNote,
        publicCorrectionNote: null,
      }),
    } satisfies AdminGameRecord;
    const findGame = vi.fn().mockResolvedValueOnce(game).mockResolvedValue(applied);
    const repository = createRepository({
      findGame,
      upsertResultFallback: vi.fn().mockResolvedValue(applied),
    });
    const service = new AdminService(repository, () => new Date('2026-08-21T12:00:00Z'));

    await expect(
      service.upsertResultFallback(game.id, { ...input, dryRun: false }, editor, 'req-1'),
    ).resolves.toMatchObject({ outcome: 'CREATED' });
    await expect(
      service.upsertResultFallback(game.id, { ...input, dryRun: false }, editor, 'req-2'),
    ).resolves.toMatchObject({ outcome: 'UNCHANGED' });
    expect(vi.mocked(repository.upsertResultFallback)).toHaveBeenCalledOnce();
    expect(vi.mocked(repository.upsertResultFallback)).toHaveBeenCalledWith(
      game.id,
      expect.objectContaining({ sourceName: 'NFL.com', reason: input.reason }),
      expect.objectContaining({ userId: editor.userId, requestId: 'req-1' }),
      new Date('2026-08-21T12:00:00Z'),
    );
  });

  it('sets a manual featured override and threads the actor/reason through to the repository', async () => {
    const game = createAdminGame();
    const repository = createRepository({
      findGame: vi.fn().mockResolvedValue(game),
      setFeatured: vi.fn().mockResolvedValue(game),
    });
    const service = new AdminService(repository, () => new Date('2026-08-23T12:00:00Z'));

    await service.setFeatured(
      game.id,
      { featured: true, reason: 'Close divisional game' },
      editor,
      'req-1',
    );

    expect(vi.mocked(repository.setFeatured)).toHaveBeenCalledWith(
      game.id,
      { featured: true, reason: 'Close divisional game' },
      expect.objectContaining({ userId: editor.userId, requestId: 'req-1' }),
      new Date('2026-08-23T12:00:00Z'),
    );
  });

  it('clears a manual featured override by passing featured: null', async () => {
    const game = createAdminGame();
    const repository = createRepository({
      findGame: vi.fn().mockResolvedValue(game),
      setFeatured: vi.fn().mockResolvedValue(game),
    });
    const service = new AdminService(repository);

    await service.setFeatured(game.id, { featured: null }, editor, null);

    expect(vi.mocked(repository.setFeatured)).toHaveBeenCalledWith(
      game.id,
      { featured: null },
      expect.objectContaining({ userId: editor.userId }),
      expect.any(Date),
    );
  });

  it('prevents the generic override path from contradicting an active result fallback', async () => {
    const game = createAdminGame();
    game.editorialOverride = createEditorialOverride({
      status: 'FINAL',
      homeScore: 7,
      awayScore: 27,
      resultVerifiedAt: new Date('2026-08-21T12:00:00Z'),
      resultSourceName: 'NFL.com',
      resultReason: 'Reviewed fallback.',
    });
    const repository = createRepository({ findGame: vi.fn().mockResolvedValue(game) });
    await expect(
      new AdminService(repository).upsertOverride(game.id, { status: 'SCHEDULED' }, editor, null),
    ).rejects.toMatchObject({ code: 'RESULT_FALLBACK_STATUS_PROTECTED' });
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

function markReviewed(game: AdminGameRecord): void {
  if (game.provenance === null) throw new Error('Test game provenance is required.');
  game.provenance = { ...game.provenance, sourceType: 'OFFICIAL_WEB' };
}

function createEditorialOverride(
  overrides: Partial<NonNullable<AdminGameRecord['editorialOverride']>> = {},
): NonNullable<AdminGameRecord['editorialOverride']> {
  return {
    id: '00000000-0000-4000-8000-000000000301',
    gameId: '00000000-0000-4000-8000-000000000101',
    startTime: new Date('2026-09-11T00:20:00Z'),
    status: null,
    homeScore: null,
    awayScore: null,
    week: null,
    venueName: null,
    venueCity: null,
    broadcastNetwork: null,
    isNeutralSite: null,
    publicCorrectionNote: 'Public kickoff correction',
    internalNote: null,
    resultSourceName: null,
    resultSourceUrl: null,
    resultVerifiedAt: null,
    resultReason: null,
    createdById: editor.userId,
    updatedById: editor.userId,
    createdBySnapshot: editor.email,
    updatedBySnapshot: editor.email,
    createdAt: new Date('2026-08-02T00:00:00Z'),
    updatedAt: new Date('2026-08-02T00:00:00Z'),
    ...overrides,
  };
}

describe('plays reconciliation review and repair delegation', () => {
  const gameId = '00000000-0000-4000-8000-000000000200';

  it('delegates diagnostics to the injected diagnostic service', async () => {
    const diagnose = vi.fn().mockResolvedValue({ gameId, safeRepairCandidate: 'APPEND_ONLY' });
    const diagnosticService = { diagnose } as unknown as ReconciliationDiagnosticService;
    const service = new AdminService(createRepository(), () => new Date(), diagnosticService);
    const result = await service.getPlaysDiagnostic(gameId, editor);
    expect(diagnose).toHaveBeenCalledWith(gameId);
    expect(result).toMatchObject({ safeRepairCandidate: 'APPEND_ONLY' });
  });

  it('reports unconfigured when no diagnostic service was wired', async () => {
    const service = new AdminService(createRepository());
    await expect(service.getPlaysDiagnostic(gameId, editor)).rejects.toMatchObject({
      code: 'GAME_PLAYS_REVIEW_UNCONFIGURED',
    });
  });

  it('converts the principal into a real audit actor before delegating a repair', async () => {
    const repair = vi.fn().mockResolvedValue({ mode: 'APPEND_ONLY', applied: true });
    const repairService = { repair } as unknown as PlayReconciliationRepairService;
    const service = new AdminService(
      createRepository(),
      () => new Date(),
      undefined,
      repairService,
    );
    await service.repairGamePlays(
      gameId,
      { mode: 'append-only', reason: 'confirmed safe' },
      admin,
      'req-1',
    );
    expect(repair).toHaveBeenCalledWith({
      gameId,
      mode: 'APPEND_ONLY',
      actor: { userId: admin.userId, emailSnapshot: admin.email, requestId: 'req-1' },
      reason: 'confirmed safe',
    });
  });

  it('passes manual links through for a structural-relink repair', async () => {
    const repair = vi.fn().mockResolvedValue({ mode: 'STRUCTURAL_RELINK', applied: true });
    const repairService = { repair } as unknown as PlayReconciliationRepairService;
    const service = new AdminService(
      createRepository(),
      () => new Date(),
      undefined,
      repairService,
    );
    const manualLinks = [
      { existingPlayId: '00000000-0000-4000-8000-000000000201', desiredSequence: 5 },
    ];
    await service.repairGamePlays(
      gameId,
      { mode: 'structural-relink', reason: 'disambiguated by operator', manualLinks },
      admin,
      null,
    );
    expect(repair).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'STRUCTURAL_RELINK', manualLinks }),
    );
  });

  it('passes the cutoff sequence through for a rebuild-after-cutoff repair', async () => {
    const repair = vi.fn().mockResolvedValue({ mode: 'REBUILD_AFTER_CUTOFF', applied: true });
    const repairService = { repair } as unknown as PlayReconciliationRepairService;
    const service = new AdminService(
      createRepository(),
      () => new Date(),
      undefined,
      repairService,
    );
    await service.repairGamePlays(
      gameId,
      { mode: 'rebuild-after-cutoff', reason: 'clean cutoff', cutoffSequence: 82 },
      admin,
      null,
    );
    expect(repair).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'REBUILD_AFTER_CUTOFF', cutoffSequence: 82 }),
    );
  });

  it('lists the plays review queue from the repository', async () => {
    const listPlaysReviewRequired = vi
      .fn()
      .mockResolvedValue([
        { gameId, playsBlockedAt: null, playsBlockReason: 'UNMATCHED_EXISTING' },
      ]);
    const repository = createRepository({ listPlaysReviewRequired });
    const service = new AdminService(repository);
    const result = await service.listPlaysReviewQueue({ limit: 50 }, editor);
    expect(listPlaysReviewRequired).toHaveBeenCalledWith(50);
    expect(result.games).toHaveLength(1);
  });
});
