/* Vitest repository mock methods are intentionally referenced as assertion subjects. */
/* eslint-disable @typescript-eslint/unbound-method */
import express, { type RequestHandler } from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { errorHandler } from '../../common/middleware/error-handler.js';
import {
  createAdminGameMediaCurationRouter,
  createPublicGameMediaRouter,
} from './game-media-curation.routes.js';
import type { GameMediaCurationServiceContract } from './game-media-curation.service.js';

const adminUserId = '00000000-0000-4000-8000-000000000001';
const editorUserId = '00000000-0000-4000-8000-000000000002';
const gameId = '00000000-0000-4000-8000-000000000100';
const videoId = '00000000-0000-4000-8000-000000000200';
const globalVideoId = '00000000-0000-4000-8000-000000000300';

const globalVideo = {
  id: globalVideoId,
  title: 'NFL Kickoff Special',
  embedUrl: 'https://www.youtube.com/embed/global123',
  canonicalUrl: 'https://www.youtube.com/watch?v=global123',
  thumbnailUrl: null,
  sourceLabel: 'NFL',
  createdAt: '2026-08-27T00:00:00.000Z',
  updatedAt: '2026-08-27T00:00:00.000Z',
};

const detail = {
  game: {
    gameId,
    season: 2026,
    seasonType: 'PRE',
    week: 2,
    startTime: null,
    status: 'FINAL',
    homeTeam: {
      id: 'team-1',
      fullName: 'New England Patriots',
      abbreviation: 'NE',
      logoUrl: null,
      primaryColor: '#002244',
      secondaryColor: '#C60C30',
    },
    awayTeam: {
      id: 'team-2',
      fullName: 'Philadelphia Eagles',
      abbreviation: 'PHI',
      logoUrl: null,
      primaryColor: '#004C54',
      secondaryColor: '#A5ACAF',
    },
    homeScore: 20,
    awayScore: 17,
    curatedVideoCount: 1,
    automaticHighlightCount: 1,
    displayMode: 'CURATED',
  },
  curatedVideos: [
    {
      id: videoId,
      position: 0,
      isPrimary: true,
      title: 'Eagles vs. Patriots | Highlights',
      embedUrl: 'https://www.youtube.com/embed/abc123',
      canonicalUrl: 'https://www.youtube.com/watch?v=abc123',
      thumbnailUrl: null,
      sourceLabel: 'NFL',
      createdAt: '2026-08-26T00:00:00.000Z',
      updatedAt: '2026-08-26T00:00:00.000Z',
    },
  ],
  displayMode: 'CURATED',
};

function service(): GameMediaCurationServiceContract {
  return {
    listGamesForWeek: vi.fn().mockResolvedValue([detail.game]),
    getGameMediaDetail: vi.fn().mockResolvedValue(detail),
    addVideo: vi.fn().mockResolvedValue(detail),
    updateVideo: vi.fn().mockResolvedValue(detail),
    reorderVideos: vi.fn().mockResolvedValue(detail),
    deleteVideo: vi.fn().mockResolvedValue(detail),
    getPublicGameMedia: vi.fn().mockResolvedValue({
      gameId,
      displayMode: 'CURATED',
      curatedVideos: detail.curatedVideos,
      highlights: [],
      globalVideo: null,
      displayVideos: [],
      coverage: 'AVAILABLE',
    }),
    getGlobalVideo: vi.fn().mockResolvedValue(globalVideo),
    setGlobalVideo: vi.fn().mockResolvedValue(globalVideo),
    removeGlobalVideo: vi.fn().mockResolvedValue(globalVideo),
  };
}

function app(mediaService: GameMediaCurationServiceContract) {
  const authenticate: RequestHandler = (req, _res, next) => {
    if (req.headers.authorization === 'Bearer admin')
      req.auth = { userId: adminUserId, sessionId: '00000000-0000-4000-8000-000000000003' };
    if (req.headers.authorization === 'Bearer editor')
      req.auth = { userId: editorUserId, sessionId: '00000000-0000-4000-8000-000000000004' };
    next();
  };
  const identities = {
    findAdministrativeIdentity: (id: string) => {
      if (id === adminUserId) {
        return Promise.resolve({
          userId: adminUserId,
          email: 'admin@example.com',
          role: 'ADMIN' as const,
        });
      }
      if (id === editorUserId) {
        return Promise.resolve({
          userId: editorUserId,
          email: 'editor@example.com',
          role: 'EDITOR' as const,
        });
      }
      return Promise.resolve(null);
    },
  };
  const adminRouter = createAdminGameMediaCurationRouter({
    authenticate,
    identities,
    service: mediaService,
  });
  const instance = express();
  instance.use(express.json());
  instance.use('/api/v1/admin/game-media', adminRouter);
  instance.use('/api/v1/games', createPublicGameMediaRouter(mediaService));
  instance.use(errorHandler);
  return instance;
}

describe('game-media-curation admin routes', () => {
  it('rejects unauthenticated requests', async () => {
    const response = await request(app(service())).get('/api/v1/admin/game-media/games');
    expect(response.status).toBe(401);
  });

  it('allows an EDITOR to view games and game media detail', async () => {
    const listResponse = await request(app(service()))
      .get('/api/v1/admin/game-media/games?season=2026&seasonType=PRE&week=2')
      .set('Authorization', 'Bearer editor');
    expect(listResponse.status).toBe(200);

    const detailResponse = await request(app(service()))
      .get(`/api/v1/admin/game-media/games/${gameId}`)
      .set('Authorization', 'Bearer editor');
    expect(detailResponse.status).toBe(200);
  });

  it('forbids an EDITOR from adding, updating, reordering, or deleting curated videos', async () => {
    const instance = app(service());
    const add = await request(instance)
      .post(`/api/v1/admin/game-media/games/${gameId}/videos`)
      .set('Authorization', 'Bearer editor')
      .send({ title: 'x', embedUrl: 'https://www.youtube.com/embed/x' });
    expect(add.status).toBe(403);

    const update = await request(instance)
      .patch(`/api/v1/admin/game-media/videos/${videoId}`)
      .set('Authorization', 'Bearer editor')
      .send({ title: 'x' });
    expect(update.status).toBe(403);

    const reorder = await request(instance)
      .put(`/api/v1/admin/game-media/games/${gameId}/videos/order`)
      .set('Authorization', 'Bearer editor')
      .send({ videoIds: [videoId] });
    expect(reorder.status).toBe(403);

    const remove = await request(instance)
      .delete(`/api/v1/admin/game-media/videos/${videoId}`)
      .set('Authorization', 'Bearer editor');
    expect(remove.status).toBe(403);
  });

  it('allows an ADMIN to add, update, reorder, and delete curated videos', async () => {
    const svc = service();
    const instance = app(svc);

    const add = await request(instance)
      .post(`/api/v1/admin/game-media/games/${gameId}/videos`)
      .set('Authorization', 'Bearer admin')
      .send({ title: 'Eagles vs. Patriots', embedUrl: 'https://www.youtube.com/embed/abc123' });
    expect(add.status).toBe(201);
    expect(vi.mocked(svc.addVideo)).toHaveBeenCalled();

    const update = await request(instance)
      .patch(`/api/v1/admin/game-media/videos/${videoId}`)
      .set('Authorization', 'Bearer admin')
      .send({ title: 'Updated title' });
    expect(update.status).toBe(200);
    expect(vi.mocked(svc.updateVideo)).toHaveBeenCalled();

    const reorder = await request(instance)
      .put(`/api/v1/admin/game-media/games/${gameId}/videos/order`)
      .set('Authorization', 'Bearer admin')
      .send({ videoIds: [videoId] });
    expect(reorder.status).toBe(200);
    expect(vi.mocked(svc.reorderVideos)).toHaveBeenCalled();

    const remove = await request(instance)
      .delete(`/api/v1/admin/game-media/videos/${videoId}`)
      .set('Authorization', 'Bearer admin');
    expect(remove.status).toBe(200);
    expect(vi.mocked(svc.deleteVideo)).toHaveBeenCalled();
  });

  it('rejects a request body containing raw iframe markup as the embed URL', async () => {
    const response = await request(app(service()))
      .post(`/api/v1/admin/game-media/games/${gameId}/videos`)
      .set('Authorization', 'Bearer admin')
      .send({ title: 'x', embedUrl: '<iframe src="https://www.youtube.com/embed/x"></iframe>' });
    expect(response.status).toBe(400);
  });
});

describe('game-media-curation admin global-video routes (M32B)', () => {
  it('allows an EDITOR to view the global video but forbids managing it', async () => {
    const instance = app(service());
    const view = await request(instance)
      .get('/api/v1/admin/game-media/global-video')
      .set('Authorization', 'Bearer editor');
    expect(view.status).toBe(200);

    const set = await request(instance)
      .put('/api/v1/admin/game-media/global-video')
      .set('Authorization', 'Bearer editor')
      .send({ title: 'x', embedUrl: 'https://www.youtube.com/embed/x' });
    expect(set.status).toBe(403);

    const remove = await request(instance)
      .delete('/api/v1/admin/game-media/global-video')
      .set('Authorization', 'Bearer editor');
    expect(remove.status).toBe(403);
  });

  it('allows an ADMIN to view, set, and remove the global video', async () => {
    const svc = service();
    const instance = app(svc);

    const view = await request(instance)
      .get('/api/v1/admin/game-media/global-video')
      .set('Authorization', 'Bearer admin');
    expect(view.status).toBe(200);
    expect((view.body as { data: { id: string } }).data.id).toBe(globalVideoId);

    const set = await request(instance)
      .put('/api/v1/admin/game-media/global-video')
      .set('Authorization', 'Bearer admin')
      .send({ title: 'NFL Kickoff Special', embedUrl: 'https://www.youtube.com/embed/global123' });
    expect(set.status).toBe(200);
    expect(vi.mocked(svc.setGlobalVideo)).toHaveBeenCalled();

    const remove = await request(instance)
      .delete('/api/v1/admin/game-media/global-video')
      .set('Authorization', 'Bearer admin');
    expect(remove.status).toBe(200);
    expect(vi.mocked(svc.removeGlobalVideo)).toHaveBeenCalled();
  });

  it('rejects a global-video body containing raw iframe markup', async () => {
    const response = await request(app(service()))
      .put('/api/v1/admin/game-media/global-video')
      .set('Authorization', 'Bearer admin')
      .send({ title: 'x', embedUrl: '<iframe src="https://www.youtube.com/embed/x"></iframe>' });
    expect(response.status).toBe(400);
  });

  it('rejects unauthenticated requests to the global-video route', async () => {
    const response = await request(app(service())).get('/api/v1/admin/game-media/global-video');
    expect(response.status).toBe(401);
  });
});

describe('game-media-curation public route', () => {
  it('never exposes admin-only fields (creator IDs, audit info)', async () => {
    const response = await request(app(service())).get(`/api/v1/games/${gameId}/media`);
    expect(response.status).toBe(200);
    const raw = JSON.stringify(response.body);
    expect(raw).not.toContain('createdById');
    expect(raw).not.toContain('updatedById');
    expect(raw).not.toContain('createdBy');
    expect(raw).not.toContain('actorUserId');
  });

  it('requires no authentication', async () => {
    const response = await request(app(service())).get(`/api/v1/games/${gameId}/media`);
    expect(response.status).toBe(200);
  });
});
