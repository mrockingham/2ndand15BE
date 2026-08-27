/* Vitest mock methods are intentionally referenced as assertion subjects. */
/* eslint-disable @typescript-eslint/unbound-method */
import pino from 'pino';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { createApp } from '../../app.js';
import {
  createTestAccessTokenService,
  createTestAuthService,
  createTestConfig,
  createTestGameReader,
  createTestTeamReader,
  createTestUserService,
} from '../../../tests/helpers/test-config.js';
import type { UserRole } from '../../generated/prisma/client.js';
import type { AdministrativeIdentityReader } from './admin-authorization.js';
import type { AdminGameDto } from './admin.dto.js';
import type { AdministrativeScheduleService } from './admin.service.js';
import type { ReconciliationDiagnostic } from '../sports/current-game-play-reconciliation-diagnostic.js';
import type { RepairResult } from '../sports/current-game-play-repair.js';

const userId = '00000000-0000-4000-8000-000000000010';
const dummyGame = {} as AdminGameDto;
const dummyDiagnostic = {} as ReconciliationDiagnostic;
const dummyRepairResult = {} as RepairResult;

function createHarness(role: UserRole) {
  const identities: AdministrativeIdentityReader = {
    findAdministrativeIdentity: () => Promise.resolve({ userId, email: 'staff@example.com', role }),
  };
  const service: AdministrativeScheduleService = {
    listGames: vi.fn().mockResolvedValue({ games: [], nextCursor: null }),
    getGame: vi.fn().mockResolvedValue(dummyGame),
    createGame: vi.fn().mockResolvedValue(dummyGame),
    updateGame: vi.fn().mockResolvedValue(dummyGame),
    upsertOverride: vi.fn().mockResolvedValue(dummyGame),
    upsertResultFallback: vi.fn().mockResolvedValue({}),
    deleteOverride: vi.fn().mockResolvedValue(dummyGame),
    setFeatured: vi.fn().mockResolvedValue(dummyGame),
    verifyGame: vi.fn().mockResolvedValue(dummyGame),
    importSchedule: vi.fn().mockResolvedValue({
      dryRun: true,
      received: 1,
      created: 1,
      updated: 0,
      skipped: 0,
      warnings: 0,
      failed: 0,
      failures: [],
    }),
    listAuditEvents: vi.fn().mockResolvedValue({ events: [], nextCursor: null }),
    getPlaysDiagnostic: vi.fn().mockResolvedValue(dummyDiagnostic),
    repairGamePlays: vi.fn().mockResolvedValue(dummyRepairResult),
    listPlaysReviewQueue: vi.fn().mockResolvedValue({ games: [] }),
  };
  const app = createApp({
    config: createTestConfig(),
    logger: pino({ level: 'silent' }),
    teamReader: createTestTeamReader(),
    gameReader: createTestGameReader(),
    authService: createTestAuthService(),
    userService: createTestUserService(),
    accessTokens: createTestAccessTokenService(),
    adminService: service,
    adminIdentities: identities,
  });
  return { app, service };
}

describe('administrative routes', () => {
  it('requires authentication and rejects ordinary users', async () => {
    const { app } = createHarness('USER');
    await request(app).get('/api/v1/admin/games').expect(401);
    const denied = await request(app)
      .get('/api/v1/admin/games')
      .set('authorization', 'Bearer valid')
      .expect(403);
    expect(denied.body as unknown).toMatchObject({
      error: { code: 'ADMIN_PERMISSION_REQUIRED' },
    });
  });

  it('allows editors to maintain schedules and read only game-scoped audit history', async () => {
    const { app, service } = createHarness('EDITOR');
    await request(app).get('/api/v1/admin/games').set('authorization', 'Bearer valid').expect(200);
    const listGames = vi.mocked(service.listGames);
    expect(listGames).toHaveBeenCalledOnce();
    await request(app)
      .delete('/api/v1/admin/games/00000000-0000-4000-8000-000000000101/override')
      .set('authorization', 'Bearer valid')
      .expect(403);
    await request(app)
      .get('/api/v1/admin/audit-events?entityType=GAME')
      .set('authorization', 'Bearer valid')
      .expect(200);
    const listAuditEvents = vi.mocked(service.listAuditEvents);
    expect(listAuditEvents).toHaveBeenCalledWith(
      expect.objectContaining({ entityType: 'GAME' }),
      expect.objectContaining({ role: 'EDITOR' }),
    );
  });

  it('allows admins to perform admin-only operations', async () => {
    const { app, service } = createHarness('ADMIN');
    await request(app)
      .delete('/api/v1/admin/games/00000000-0000-4000-8000-000000000101/override')
      .set('authorization', 'Bearer valid')
      .expect(200);
    await request(app)
      .get('/api/v1/admin/audit-events')
      .set('authorization', 'Bearer valid')
      .expect(200);
    const deleteOverride = vi.mocked(service.deleteOverride);
    expect(deleteOverride).toHaveBeenCalledOnce();
  });

  it('allows editors to view plays diagnostics and the review queue but not repair', async () => {
    const { app, service } = createHarness('EDITOR');
    await request(app)
      .get('/api/v1/admin/games/00000000-0000-4000-8000-000000000101/plays/diagnostic')
      .set('authorization', 'Bearer valid')
      .expect(200);
    expect(vi.mocked(service.getPlaysDiagnostic)).toHaveBeenCalledOnce();
    await request(app)
      .get('/api/v1/admin/games/plays-review-queue')
      .set('authorization', 'Bearer valid')
      .expect(200);
    expect(vi.mocked(service.listPlaysReviewQueue)).toHaveBeenCalledOnce();
    await request(app)
      .post('/api/v1/admin/games/00000000-0000-4000-8000-000000000101/plays/repair')
      .set('authorization', 'Bearer valid')
      .send({ mode: 'append-only', reason: 'test' })
      .expect(403);
    expect(service.repairGamePlays).not.toHaveBeenCalled();
  });

  it('allows admins to repair blocked game plays with a validated body', async () => {
    const { app, service } = createHarness('ADMIN');
    await request(app)
      .post('/api/v1/admin/games/00000000-0000-4000-8000-000000000101/plays/repair')
      .set('authorization', 'Bearer valid')
      .send({ mode: 'append-only', reason: 'confirmed safe append' })
      .expect(200);
    expect(vi.mocked(service.repairGamePlays)).toHaveBeenCalledWith(
      '00000000-0000-4000-8000-000000000101',
      { mode: 'append-only', reason: 'confirmed safe append' },
      expect.objectContaining({ role: 'ADMIN' }),
      null,
    );
    await request(app)
      .post('/api/v1/admin/games/00000000-0000-4000-8000-000000000101/plays/repair')
      .set('authorization', 'Bearer valid')
      .send({ mode: 'structural-relink', reason: 'missing manual links' })
      .expect(400);
  });

  it('validates JSON import rows and forces the validation endpoint to dry-run', async () => {
    const { app, service } = createHarness('EDITOR');
    await request(app)
      .post('/api/v1/admin/schedule-imports/validate')
      .set('authorization', 'Bearer valid')
      .send({
        dryRun: false,
        rows: [
          {
            season: 2026,
            seasonType: 'REG',
            week: 1,
            startTime: '2026-09-10T00:20:00Z',
            awayTeam: 'MIA',
            homeTeam: 'BUF',
            status: 'SCHEDULED',
            venueName: null,
            venueCity: null,
            broadcastNetwork: null,
            isNeutralSite: false,
            sourceName: 'Official schedule',
            sourceType: 'OFFICIAL_WEB',
            sourceUrl: null,
            externalReference: 'game-1',
            notes: null,
          },
        ],
      })
      .expect(200);
    const importSchedule = vi.mocked(service.importSchedule);
    expect(importSchedule).toHaveBeenCalledWith(
      expect.objectContaining({ dryRun: true }),
      expect.objectContaining({ role: 'EDITOR' }),
      null,
    );
  });

  it('requires schedule-edit authorization and validates reviewed final-result input', async () => {
    const path = '/api/v1/admin/games/00000000-0000-4000-8000-000000000101/result-fallback';
    const denied = createHarness('USER');
    await request(denied.app)
      .put(path)
      .set('authorization', 'Bearer valid')
      .send({ status: 'FINAL', homeScore: 7, awayScore: 27 })
      .expect(403);

    const { app, service } = createHarness('EDITOR');
    await request(app)
      .put(path)
      .set('authorization', 'Bearer valid')
      .send({
        status: 'FINAL',
        homeScore: 7,
        awayScore: 27,
        sourceName: 'NFL.com',
        sourceUrl: 'https://www.nfl.com/games/example',
        reason: 'Primary provider omitted the reviewed game.',
        dryRun: true,
      })
      .expect(200);
    expect(vi.mocked(service.upsertResultFallback)).toHaveBeenCalledWith(
      '00000000-0000-4000-8000-000000000101',
      expect.objectContaining({ status: 'FINAL', homeScore: 7, awayScore: 27, dryRun: true }),
      expect.objectContaining({ role: 'EDITOR' }),
      null,
    );

    await request(app)
      .put(path)
      .set('authorization', 'Bearer valid')
      .send({
        status: 'FINAL',
        homeScore: -1,
        awayScore: 27,
        sourceName: 'NFL.com',
        reason: 'Reviewed.',
      })
      .expect(400);

    await request(app)
      .put(path)
      .set('authorization', 'Bearer valid')
      .send({
        status: 'SCHEDULED',
        homeScore: 7,
        awayScore: 27,
        sourceName: 'NFL.com',
        reason: 'Reviewed.',
      })
      .expect(400);

    await request(app)
      .put(path)
      .set('authorization', 'Bearer valid')
      .send({
        status: 'FINAL',
        homeScore: 7,
        awayScore: 27,
        sourceName: 'NFL.com',
      })
      .expect(400);
  });
});
