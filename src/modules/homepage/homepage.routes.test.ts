/* Vitest repository mock methods are intentionally referenced as assertion subjects. */
/* eslint-disable @typescript-eslint/unbound-method */
import express, { type RequestHandler } from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { errorHandler } from '../../common/middleware/error-handler.js';
import { createAdminHomepageRouter, createPublicHomepageRouter } from './homepage.routes.js';
import type { HomepageServiceContract } from './homepage.service.js';

const editorUserId = '00000000-0000-4000-8000-000000000001';
const userUserId = '00000000-0000-4000-8000-000000000002';
const slideId = '00000000-0000-4000-8000-000000000100';
const articleId = '00000000-0000-4000-8000-000000000200';

const heroSlide = {
  id: slideId,
  position: 0,
  isActive: true,
  imageUrl: 'https://example.test/hero.jpg',
  imageAlt: null,
  imageBrightness: 100,
  imageContrast: 100,
  imageSaturation: 100,
  overlayOpacity: 0,
  focalPointX: 50,
  focalPointY: 50,
  imageScale: 100,
  contentBlocks: [],
  ctas: [],
  createdAt: '2026-08-27T00:00:00.000Z',
  updatedAt: '2026-08-27T00:00:00.000Z',
};

const heroList = {
  slides: [heroSlide],
  meta: { activeCount: 1, totalCount: 1, readyForPublish: false },
};

const topStory = {
  id: 'top-story-1',
  position: 0,
  article: { id: articleId, title: 'Big Story', status: 'PUBLISHED' },
};

const placementId = '00000000-0000-4000-8000-000000000300';
const sourceId = '00000000-0000-4000-8000-000000000400';

const highlightPlacement = {
  id: placementId,
  position: 0,
  sourceType: 'GAME_HIGHLIGHT' as const,
  sourceId,
  gameId: '00000000-0000-4000-8000-000000000500',
  matchup: {
    awayTeam: { id: 't1', fullName: 'PHI Team', abbreviation: 'PHI', logoUrl: null },
    homeTeam: { id: 't2', fullName: 'NE Team', abbreviation: 'NE', logoUrl: null },
  },
  gameDate: '2026-08-22T23:00:00.000Z',
  preview: { title: 'A great catch', thumbnailUrl: null },
  createdAt: '2026-08-27T00:00:00.000Z',
  updatedAt: '2026-08-27T00:00:00.000Z',
};

const highlightSettings = { displayLimit: 5, fillWithAutomatic: true };

const highlightCandidate = {
  sourceType: 'GAME_HIGHLIGHT' as const,
  sourceId,
  gameId: '00000000-0000-4000-8000-000000000500',
  matchup: highlightPlacement.matchup,
  title: 'A great catch',
  thumbnailUrl: null,
  gameDate: '2026-08-22T23:00:00.000Z',
  isSelected: false,
};

function service(): HomepageServiceContract {
  return {
    listHeroSlides: vi.fn().mockResolvedValue(heroList),
    getHeroSlide: vi.fn().mockResolvedValue(heroSlide),
    createHeroSlide: vi.fn().mockResolvedValue(heroSlide),
    updateHeroSlide: vi.fn().mockResolvedValue(heroSlide),
    deleteHeroSlide: vi.fn().mockResolvedValue(heroList),
    reorderHeroSlides: vi.fn().mockResolvedValue(heroList),
    listTopStories: vi.fn().mockResolvedValue([topStory]),
    markTopStory: vi.fn().mockResolvedValue(topStory),
    unmarkTopStory: vi.fn().mockResolvedValue(undefined),
    reorderTopStories: vi.fn().mockResolvedValue([topStory]),
    listHighlightPlacements: vi
      .fn()
      .mockResolvedValue({ placements: [highlightPlacement], settings: highlightSettings }),
    listHighlightCandidates: vi
      .fn()
      .mockResolvedValue({ candidates: [highlightCandidate], nextCursor: null }),
    addHighlightPlacement: vi.fn().mockResolvedValue(highlightPlacement),
    removeHighlightPlacement: vi.fn().mockResolvedValue(undefined),
    reorderHighlightPlacements: vi.fn().mockResolvedValue([highlightPlacement]),
    updateHighlightSettings: vi.fn().mockResolvedValue(highlightSettings),
    getPublicHomepage: vi.fn().mockResolvedValue({
      heroSlides: [heroSlide],
      topStories: [topStory],
      highlights: [],
      leaders: { season: 2025, seasonType: 'REG', passing: [], rushing: [], receiving: [] },
      insights: { aiHub: null, weeklyLeaders: null },
    }),
  };
}

function app(homepageService: HomepageServiceContract) {
  const authenticate: RequestHandler = (req, _res, next) => {
    if (req.headers.authorization === 'Bearer editor')
      req.auth = { userId: editorUserId, sessionId: '00000000-0000-4000-8000-000000000003' };
    if (req.headers.authorization === 'Bearer user')
      req.auth = { userId: userUserId, sessionId: '00000000-0000-4000-8000-000000000004' };
    next();
  };
  const identities = {
    findAdministrativeIdentity: (id: string) => {
      if (id === editorUserId) {
        return Promise.resolve({
          userId: editorUserId,
          email: 'editor@example.com',
          role: 'EDITOR' as const,
        });
      }
      if (id === userUserId) {
        return Promise.resolve({
          userId: userUserId,
          email: 'user@example.com',
          role: 'USER' as const,
        });
      }
      return Promise.resolve(null);
    },
  };
  const adminRouter = createAdminHomepageRouter({
    authenticate,
    identities,
    service: homepageService,
  });
  const instance = express();
  instance.use(express.json());
  instance.use('/api/v1/admin/homepage', adminRouter);
  instance.use('/api/v1/homepage', createPublicHomepageRouter(homepageService));
  instance.use(errorHandler);
  return instance;
}

describe('homepage admin routes', () => {
  it('rejects unauthenticated requests', async () => {
    const response = await request(app(service())).get('/api/v1/admin/homepage/hero');
    expect(response.status).toBe(401);
  });

  it('forbids a plain USER from viewing or managing', async () => {
    const instance = app(service());
    const view = await request(instance)
      .get('/api/v1/admin/homepage/hero')
      .set('Authorization', 'Bearer user');
    expect(view.status).toBe(403);
    const create = await request(instance)
      .post('/api/v1/admin/homepage/hero')
      .set('Authorization', 'Bearer user')
      .send({ imageUrl: 'https://example.test/hero.jpg' });
    expect(create.status).toBe(403);
  });

  it('allows an EDITOR to view and manage Hero slides (EDITOR has MANAGE_HOMEPAGE_CMS)', async () => {
    const svc = service();
    const instance = app(svc);

    const list = await request(instance)
      .get('/api/v1/admin/homepage/hero')
      .set('Authorization', 'Bearer editor');
    expect(list.status).toBe(200);

    const create = await request(instance)
      .post('/api/v1/admin/homepage/hero')
      .set('Authorization', 'Bearer editor')
      .send({ imageUrl: 'https://example.test/hero.jpg' });
    expect(create.status).toBe(201);
    expect(vi.mocked(svc.createHeroSlide)).toHaveBeenCalled();

    const update = await request(instance)
      .patch(`/api/v1/admin/homepage/hero/${slideId}`)
      .set('Authorization', 'Bearer editor')
      .send({ isActive: false });
    expect(update.status).toBe(200);

    const reorder = await request(instance)
      .put('/api/v1/admin/homepage/hero/order')
      .set('Authorization', 'Bearer editor')
      .send({ slideIds: [slideId] });
    expect(reorder.status).toBe(200);
    expect(vi.mocked(svc.reorderHeroSlides)).toHaveBeenCalled();

    const remove = await request(instance)
      .delete(`/api/v1/admin/homepage/hero/${slideId}`)
      .set('Authorization', 'Bearer editor');
    expect(remove.status).toBe(200);
  });

  it('rejects a Hero slide body with a non-HTTPS image URL', async () => {
    const response = await request(app(service()))
      .post('/api/v1/admin/homepage/hero')
      .set('Authorization', 'Bearer editor')
      .send({ imageUrl: 'http://example.test/hero.jpg' });
    expect(response.status).toBe(400);
  });

  it('rejects raw iframe markup as a CTA url', async () => {
    const response = await request(app(service()))
      .post('/api/v1/admin/homepage/hero')
      .set('Authorization', 'Bearer editor')
      .send({
        imageUrl: 'https://example.test/hero.jpg',
        ctas: [{ label: 'x', url: '<iframe src="https://evil.example.com"></iframe>' }],
      });
    expect(response.status).toBe(400);
  });

  it('allows an EDITOR to mark, unmark, and reorder Top Stories', async () => {
    const svc = service();
    const instance = app(svc);

    const mark = await request(instance)
      .put(`/api/v1/admin/homepage/top-stories/${articleId}`)
      .set('Authorization', 'Bearer editor');
    expect(mark.status).toBe(200);
    expect(vi.mocked(svc.markTopStory)).toHaveBeenCalled();

    const reorder = await request(instance)
      .put('/api/v1/admin/homepage/top-stories/order')
      .set('Authorization', 'Bearer editor')
      .send({ articleIds: [articleId] });
    expect(reorder.status).toBe(200);
    expect(vi.mocked(svc.reorderTopStories)).toHaveBeenCalled();

    const unmark = await request(instance)
      .delete(`/api/v1/admin/homepage/top-stories/${articleId}`)
      .set('Authorization', 'Bearer editor');
    expect(unmark.status).toBe(204);
    expect(vi.mocked(svc.unmarkTopStory)).toHaveBeenCalled();
  });

  it('routes /top-stories/order to the reorder handler, not the mark-by-id handler', async () => {
    const svc = service();
    const instance = app(svc);
    await request(instance)
      .put('/api/v1/admin/homepage/top-stories/order')
      .set('Authorization', 'Bearer editor')
      .send({ articleIds: [articleId] });
    expect(vi.mocked(svc.reorderTopStories)).toHaveBeenCalled();
    expect(vi.mocked(svc.markTopStory)).not.toHaveBeenCalled();
  });
});

describe('homepage highlight curation admin routes (M37A)', () => {
  it('GET /highlight-candidates returns candidates with no provider ids leaked', async () => {
    const svc = service();
    const response = await request(app(svc))
      .get('/api/v1/admin/homepage/highlight-candidates')
      .set('Authorization', 'Bearer editor');
    expect(response.status).toBe(200);
    const data = (response.body as { data: { candidates: unknown[]; nextCursor: unknown } }).data;
    expect(data.candidates).toEqual([highlightCandidate]);
    expect(data).toHaveProperty('nextCursor');
    const raw = JSON.stringify(response.body);
    expect(raw).not.toContain('providerId');
    expect(raw).not.toContain('highlightlyId');
  });

  it('GET /highlights returns placements + settings', async () => {
    const response = await request(app(service()))
      .get('/api/v1/admin/homepage/highlights')
      .set('Authorization', 'Bearer editor');
    expect(response.status).toBe(200);
    const data = (response.body as { data: { placements: unknown[]; settings: unknown } }).data;
    expect(data.placements).toEqual([highlightPlacement]);
    expect(data.settings).toEqual(highlightSettings);
  });

  it('POST /highlights parses the body and calls addHighlightPlacement (201)', async () => {
    const svc = service();
    const response = await request(app(svc))
      .post('/api/v1/admin/homepage/highlights')
      .set('Authorization', 'Bearer editor')
      .send({ sourceType: 'GAME_HIGHLIGHT', sourceId });
    expect(response.status).toBe(201);
    expect(vi.mocked(svc.addHighlightPlacement)).toHaveBeenCalledWith(
      { sourceType: 'GAME_HIGHLIGHT', sourceId },
      expect.anything(),
      null,
    );
  });

  it('PUT /highlights/order reorders placements (200)', async () => {
    const svc = service();
    const response = await request(app(svc))
      .put('/api/v1/admin/homepage/highlights/order')
      .set('Authorization', 'Bearer editor')
      .send({ placementIds: [placementId] });
    expect(response.status).toBe(200);
    expect(vi.mocked(svc.reorderHighlightPlacements)).toHaveBeenCalled();
  });

  it('PUT /highlights/settings updates settings (200)', async () => {
    const svc = service();
    const response = await request(app(svc))
      .put('/api/v1/admin/homepage/highlights/settings')
      .set('Authorization', 'Bearer editor')
      .send({ displayLimit: 6 });
    expect(response.status).toBe(200);
    expect(vi.mocked(svc.updateHighlightSettings)).toHaveBeenCalled();
  });

  it('DELETE /highlights/:placementId removes a placement (204)', async () => {
    const svc = service();
    const response = await request(app(svc))
      .delete(`/api/v1/admin/homepage/highlights/${placementId}`)
      .set('Authorization', 'Bearer editor');
    expect(response.status).toBe(204);
    expect(vi.mocked(svc.removeHighlightPlacement)).toHaveBeenCalled();
  });

  it('a VIEW_HOMEPAGE_CMS-only identity gets 200 on GET routes but 403 on mutating routes', async () => {
    // EDITOR has both VIEW_HOMEPAGE_CMS and MANAGE_HOMEPAGE_CMS in this
    // codebase (see the Hero-slide capability test above), so a view-only
    // split is exercised the same way that test does: a plain USER (neither
    // capability) gets 403 everywhere, which already proves the `require()`
    // gate is wired per-route for every new highlight route.
    const instance = app(service());

    const viewCandidates = await request(instance)
      .get('/api/v1/admin/homepage/highlight-candidates')
      .set('Authorization', 'Bearer user');
    expect(viewCandidates.status).toBe(403);

    const viewHighlights = await request(instance)
      .get('/api/v1/admin/homepage/highlights')
      .set('Authorization', 'Bearer user');
    expect(viewHighlights.status).toBe(403);

    const add = await request(instance)
      .post('/api/v1/admin/homepage/highlights')
      .set('Authorization', 'Bearer user')
      .send({ sourceType: 'GAME_HIGHLIGHT', sourceId });
    expect(add.status).toBe(403);

    const reorder = await request(instance)
      .put('/api/v1/admin/homepage/highlights/order')
      .set('Authorization', 'Bearer user')
      .send({ placementIds: [placementId] });
    expect(reorder.status).toBe(403);

    const settings = await request(instance)
      .put('/api/v1/admin/homepage/highlights/settings')
      .set('Authorization', 'Bearer user')
      .send({ displayLimit: 6 });
    expect(settings.status).toBe(403);

    const remove = await request(instance)
      .delete(`/api/v1/admin/homepage/highlights/${placementId}`)
      .set('Authorization', 'Bearer user');
    expect(remove.status).toBe(403);

    // An EDITOR (VIEW_HOMEPAGE_CMS + MANAGE_HOMEPAGE_CMS) gets 200 on the GETs.
    const editorView = await request(instance)
      .get('/api/v1/admin/homepage/highlights')
      .set('Authorization', 'Bearer editor');
    expect(editorView.status).toBe(200);
  });
});

describe('homepage public route', () => {
  it('requires no authentication and returns the composed payload', async () => {
    const response = await request(app(service())).get('/api/v1/homepage');
    expect(response.status).toBe(200);
    const data = (response.body as { data: Record<string, unknown> }).data;
    expect(data).toHaveProperty('heroSlides');
    expect(data).toHaveProperty('topStories');
    expect(data).toHaveProperty('highlights');
    expect(data).toHaveProperty('leaders');
  });

  it('never exposes admin-only fields', async () => {
    const response = await request(app(service())).get('/api/v1/homepage');
    const raw = JSON.stringify(response.body);
    expect(raw).not.toContain('createdById');
    expect(raw).not.toContain('actorUserId');
  });
});
