/* Service mocks are assertion subjects. */
/* eslint-disable @typescript-eslint/unbound-method */
import express, { type RequestHandler } from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { errorHandler } from '../../common/middleware/error-handler.js';
import { createAdminTeamHomepageRouter } from './team-homepage.routes.js';
import type { TeamHomepageServiceContract } from './team-homepage.service.js';

const TEAM = '11111111-1111-4111-8111-111111111111';
const PLACEMENT = '22222222-2222-4222-8222-222222222222';
const SOURCE = '33333333-3333-4333-8333-333333333333';
const EDITOR = '44444444-4444-4444-8444-444444444444';
const USER = '55555555-5555-4555-8555-555555555555';

function service(): TeamHomepageServiceContract {
  return {
    getPublicHomepage: vi.fn(),
    getAdminHomepage: vi.fn().mockResolvedValue({ banner: { imageUrl: null } }),
    updateBanner: vi.fn().mockResolvedValue({ imageUrl: 'https://example.com/banner.jpg' }),
    listEditorial: vi.fn().mockResolvedValue({ placements: [] }),
    listEditorialCandidates: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
    addEditorial: vi.fn().mockResolvedValue({ id: PLACEMENT }),
    updateEditorial: vi.fn().mockResolvedValue({ id: PLACEMENT, isLeadReplacement: true }),
    removeEditorial: vi.fn().mockResolvedValue(undefined),
    reorderEditorial: vi.fn().mockResolvedValue({ placements: [] }),
    listHighlights: vi.fn().mockResolvedValue({
      placements: [],
      settings: { displayLimit: 5, fillWithAutomatic: true },
    }),
    listHighlightCandidates: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
    addHighlight: vi.fn().mockResolvedValue({ id: PLACEMENT }),
    removeHighlight: vi.fn().mockResolvedValue(undefined),
    reorderHighlights: vi.fn().mockResolvedValue({ placements: [] }),
    updateHighlightSettings: vi
      .fn()
      .mockResolvedValue({ displayLimit: 5, fillWithAutomatic: true }),
  };
}

function app(cms: TeamHomepageServiceContract) {
  const authenticate: RequestHandler = (req, _res, next) => {
    if (req.headers.authorization === 'Bearer editor')
      req.auth = { userId: EDITOR, sessionId: crypto.randomUUID() };
    if (req.headers.authorization === 'Bearer user')
      req.auth = { userId: USER, sessionId: crypto.randomUUID() };
    next();
  };
  const identities = {
    findAdministrativeIdentity: (id: string) =>
      Promise.resolve(
        id === EDITOR
          ? { userId: EDITOR, email: 'editor@example.com', role: 'EDITOR' as const }
          : id === USER
            ? { userId: USER, email: 'user@example.com', role: 'USER' as const }
            : null,
      ),
  };
  const instance = express();
  instance.use(express.json());
  instance.use(
    '/api/v1/admin/teams',
    createAdminTeamHomepageRouter({ authenticate, identities, service: cms }),
  );
  instance.use(errorHandler);
  return instance;
}

describe('Team Homepage admin routes', () => {
  it('returns the composed CMS state to an editor', async () => {
    const cms = service();
    const response = await request(app(cms))
      .get(`/api/v1/admin/teams/${TEAM}/homepage`)
      .set('Authorization', 'Bearer editor');
    expect(response.status).toBe(200);
    expect(cms.getAdminHomepage).toHaveBeenCalledWith(TEAM);
  });

  it('validates HTTPS banner URLs', async () => {
    const cms = service();
    const response = await request(app(cms))
      .put(`/api/v1/admin/teams/${TEAM}/homepage/banner`)
      .set('Authorization', 'Bearer editor')
      .send({ imageUrl: 'http://example.com/banner.jpg' });
    expect(response.status).toBe(400);
    expect(cms.updateBanner).not.toHaveBeenCalled();
  });

  it('forbids a normal user from CMS reads', async () => {
    const response = await request(app(service()))
      .get(`/api/v1/admin/teams/${TEAM}/homepage`)
      .set('Authorization', 'Bearer user');
    expect(response.status).toBe(403);
  });

  it('requires authentication', async () => {
    expect((await request(app(service())).get(`/api/v1/admin/teams/${TEAM}/homepage`)).status).toBe(
      401,
    );
  });

  it('forwards lead replacement and highlight settings mutations', async () => {
    const cms = service();
    const instance = app(cms);
    const lead = await request(instance)
      .put(`/api/v1/admin/teams/${TEAM}/homepage/editorial/${PLACEMENT}`)
      .set('Authorization', 'Bearer editor')
      .send({ isLeadReplacement: true });
    const settings = await request(instance)
      .put(`/api/v1/admin/teams/${TEAM}/homepage/highlights/settings`)
      .set('Authorization', 'Bearer editor')
      .send({ displayLimit: 10, fillWithAutomatic: false });
    const add = await request(instance)
      .post(`/api/v1/admin/teams/${TEAM}/homepage/highlights`)
      .set('Authorization', 'Bearer editor')
      .send({ sourceType: 'GAME_HIGHLIGHT', sourceId: SOURCE });
    expect([lead.status, settings.status, add.status]).toEqual([200, 200, 201]);
    expect(cms.updateEditorial).toHaveBeenCalled();
    expect(cms.updateHighlightSettings).toHaveBeenCalled();
    expect(cms.addHighlight).toHaveBeenCalled();
  });
});
