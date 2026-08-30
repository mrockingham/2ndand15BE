/* Vitest mock methods are intentionally referenced as assertion subjects. */
/* eslint-disable @typescript-eslint/unbound-method */
import pino from 'pino';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { createApp } from '../../app.js';
import type { UserRole } from '../../generated/prisma/client.js';
import {
  createTestAccessTokenService,
  createTestAuthService,
  createTestConfig,
  createTestGameReader,
  createTestTeamReader,
  createTestUserService,
} from '../../../tests/helpers/test-config.js';
import type { AdministrativeIdentityReader } from '../admin/admin-authorization.js';
import type { AdminArticleDetailDto } from './article.dto.js';
import type { EditorialArticleService, PublicArticleReader } from './article.service.js';

const userId = '00000000-0000-4000-8000-000000000010';
const articleId = '00000000-0000-4000-8000-000000000201';
const detail = {} as AdminArticleDetailDto;

describe('article routes', () => {
  it('serves bounded public article reads with cache metadata', async () => {
    const { app, reader } = harness('USER');
    const response = await request(app).get('/api/v1/articles?limit=10').expect(200);
    expect(response.headers['cache-control']).toContain('max-age=60');
    expect(vi.mocked(reader.list)).toHaveBeenCalledWith(expect.objectContaining({ limit: 10 }));
  });

  it('denies ordinary users and allows editors to create and inspect revisions', async () => {
    const normal = harness('USER');
    await request(normal.app)
      .post('/api/v1/admin/articles')
      .set('authorization', 'Bearer valid')
      .send(createBody())
      .expect(403);

    const editor = harness('EDITOR');
    await request(editor.app)
      .post('/api/v1/admin/articles')
      .set('authorization', 'Bearer valid')
      .set('x-request-id', 'article-route-1')
      .send(createBody())
      .expect(201);
    expect(vi.mocked(editor.service.create)).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'ORIGINAL' }),
      expect.objectContaining({ role: 'EDITOR' }),
      'article-route-1',
    );
    await request(editor.app)
      .get(`/api/v1/admin/articles/${articleId}/revisions`)
      .set('authorization', 'Bearer valid')
      .expect(200);
    await request(editor.app)
      .post(`/api/v1/admin/articles/${articleId}/archive`)
      .set('authorization', 'Bearer valid')
      .send({ expectedVersion: 1 })
      .expect(403);
  });

  it('allows admins to archive and rejects unsafe Markdown at the boundary', async () => {
    const { app, service } = harness('ADMIN');
    await request(app)
      .post(`/api/v1/admin/articles/${articleId}/archive`)
      .set('authorization', 'Bearer valid')
      .send({ expectedVersion: 1 })
      .expect(200);
    expect(vi.mocked(service.archive)).toHaveBeenCalledOnce();
    await request(app)
      .post('/api/v1/admin/articles')
      .set('authorization', 'Bearer valid')
      .send({ ...createBody(), body: '<iframe src="https://example.com"></iframe>' })
      .expect(400);
    expect(vi.mocked(service.create)).not.toHaveBeenCalled();
  });
});

function harness(role: UserRole) {
  const identities: AdministrativeIdentityReader = {
    findAdministrativeIdentity: () =>
      Promise.resolve({ userId, email: 'editor@example.com', role }),
  };
  const service: EditorialArticleService = {
    listAdmin: vi.fn().mockResolvedValue({ articles: [], nextCursor: null }),
    getAdmin: vi.fn().mockResolvedValue(detail),
    create: vi.fn().mockResolvedValue(detail),
    update: vi.fn().mockResolvedValue(detail),
    replaceTeams: vi.fn().mockResolvedValue(detail),
    publish: vi.fn().mockResolvedValue(detail),
    unpublish: vi.fn().mockResolvedValue(detail),
    schedule: vi.fn().mockResolvedValue(detail),
    archive: vi.fn().mockResolvedValue(detail),
    restore: vi.fn().mockResolvedValue(detail),
    listRevisions: vi.fn().mockResolvedValue({ revisions: [], nextCursor: null }),
    getRevision: vi.fn().mockResolvedValue({}),
    deleteArticle: vi.fn().mockResolvedValue(undefined),
  };
  const reader: PublicArticleReader = {
    list: vi.fn().mockResolvedValue({ articles: [], nextCursor: null }),
    listFeatured: vi.fn().mockResolvedValue({ articles: [], nextCursor: null }),
    listForTeam: vi.fn().mockResolvedValue({ articles: [], nextCursor: null }),
    getBySlug: vi.fn().mockResolvedValue({}),
  };
  const app = createApp({
    config: createTestConfig(),
    logger: pino({ level: 'silent' }),
    teamReader: createTestTeamReader(),
    gameReader: createTestGameReader(),
    authService: createTestAuthService(),
    userService: createTestUserService(),
    accessTokens: createTestAccessTokenService(),
    adminIdentities: identities,
    editorialArticleService: service,
    articleReader: reader,
  });
  return { app, service, reader };
}

function createBody() {
  return {
    type: 'ORIGINAL',
    title: 'Fictional route article',
    summary: 'A fictional summary for route validation.',
    body: '# Fictional\n\nOriginal development content.',
    sourceName: null,
    sourceUrl: null,
    sourcePublishedAt: null,
    heroImageUrl: null,
    heroImageAlt: null,
    heroImageAttribution: null,
    heroImageAttributionUrl: null,
    seoTitle: null,
    seoDescription: null,
    isFeatured: false,
    featuredPriority: null,
    featuredStartsAt: null,
    featuredEndsAt: null,
    teamIds: [],
  };
}
