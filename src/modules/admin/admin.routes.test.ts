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

const userId = '00000000-0000-4000-8000-000000000010';
const dummyGame = {} as AdminGameDto;

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
    deleteOverride: vi.fn().mockResolvedValue(dummyGame),
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
});
