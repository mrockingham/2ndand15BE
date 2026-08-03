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
import type { NewsInboxServiceContract } from './news.service.js';

const userId = '00000000-0000-4000-8000-000000000010';
const sourceId = '00000000-0000-4000-8000-000000000901';
const candidateId = '00000000-0000-4000-8000-000000000902';

describe('news inbox routes', () => {
  it('keeps all source and candidate endpoints private', async () => {
    const { app } = harness('EDITOR');
    await request(app).get('/api/v1/admin/news-sources').expect(401);
    await request(app).get('/api/v1/admin/news-candidates').expect(401);
  });

  it('allows editors to inspect, ingest, review, submit, and convert but not manage sources', async () => {
    const { app, service } = harness('EDITOR');
    const authorization = { authorization: 'Bearer valid' };
    await request(app).get('/api/v1/admin/news-sources').set(authorization).expect(200);
    await request(app)
      .post(`/api/v1/admin/news-sources/${sourceId}/test`)
      .set(authorization)
      .send({})
      .expect(200);
    await request(app)
      .post('/api/v1/admin/news-sources')
      .set(authorization)
      .send(sourceBody())
      .expect(403);
    await request(app)
      .post('/api/v1/admin/news-candidates/manual')
      .set(authorization)
      .send(manualBody())
      .expect(201);
    await request(app)
      .post(`/api/v1/admin/news-candidates/${candidateId}/review`)
      .set(authorization)
      .send({})
      .expect(200);
    await request(app)
      .post(`/api/v1/admin/news-candidates/${candidateId}/convert`)
      .set(authorization)
      .send(conversionBody())
      .expect(201);
    expect(vi.mocked(service.testSource)).toHaveBeenCalledOnce();
    expect(vi.mocked(service.createManualCandidate)).toHaveBeenCalledOnce();
    expect(vi.mocked(service.convertCandidate)).toHaveBeenCalledOnce();
  });

  it('allows admins to manage sources and rejects malformed candidate requests', async () => {
    const { app, service } = harness('ADMIN');
    await request(app)
      .post('/api/v1/admin/news-sources')
      .set('authorization', 'Bearer valid')
      .send(sourceBody())
      .expect(201);
    expect(vi.mocked(service.createSource)).toHaveBeenCalledOnce();
    await request(app)
      .post('/api/v1/admin/news-candidates/manual')
      .set('authorization', 'Bearer valid')
      .send({ ...manualBody(), url: 'file:///etc/passwd' })
      .expect(400);
  });

  it('denies ordinary users every news capability', async () => {
    const { app } = harness('USER');
    await request(app)
      .get('/api/v1/admin/news-sources')
      .set('authorization', 'Bearer valid')
      .expect(403);
    await request(app)
      .get('/api/v1/admin/news-candidates')
      .set('authorization', 'Bearer valid')
      .expect(403);
  });
});

function harness(role: UserRole) {
  const identities: AdministrativeIdentityReader = {
    findAdministrativeIdentity: () =>
      Promise.resolve({ userId, email: 'editor@example.com', role }),
  };
  const service = {
    listSources: vi.fn().mockResolvedValue({ sources: [], nextCursor: null }),
    getSource: vi.fn().mockResolvedValue({ source: {}, recentRuns: [] }),
    createSource: vi.fn().mockResolvedValue({}),
    updateSource: vi.fn().mockResolvedValue({}),
    pauseSource: vi.fn().mockResolvedValue({}),
    resumeSource: vi.fn().mockResolvedValue({}),
    testSource: vi.fn().mockResolvedValue({}),
    ingestSource: vi.fn().mockResolvedValue({}),
    listCandidates: vi.fn().mockResolvedValue({ candidates: [], nextCursor: null }),
    getCandidate: vi.fn().mockResolvedValue({}),
    createManualCandidate: vi.fn().mockResolvedValue({}),
    reviewCandidate: vi.fn().mockResolvedValue({}),
    saveCandidate: vi.fn().mockResolvedValue({}),
    dismissCandidate: vi.fn().mockResolvedValue({}),
    convertCandidate: vi.fn().mockResolvedValue({}),
  } as unknown as NewsInboxServiceContract;
  const app = createApp({
    config: createTestConfig(),
    logger: pino({ level: 'silent' }),
    teamReader: createTestTeamReader(),
    gameReader: createTestGameReader(),
    authService: createTestAuthService(),
    userService: createTestUserService(),
    accessTokens: createTestAccessTokenService(),
    adminIdentities: identities,
    newsInboxService: service,
  });
  return { app, service };
}

function sourceBody() {
  return {
    name: 'Fictional NFL News',
    slug: 'fictional-nfl-news',
    kind: 'RSS',
    status: 'PAUSED',
    feedUrl: 'https://news.example.com/feed.xml',
    siteUrl: 'https://news.example.com/',
    publisherName: 'Fictional Publisher',
    defaultTeamId: null,
    isOfficialLeague: false,
    isOfficialTeam: false,
    allowsDescriptionUse: false,
    notes: null,
  };
}

function manualBody() {
  return {
    url: 'https://news.example.com/story/manual',
    headline: 'Fictional manual candidate',
    sourceName: 'Fictional Publisher',
    sourceId: null,
    sourceDescription: 'Short source metadata.',
    sourceAuthor: null,
    sourcePublishedAt: null,
    suggestedTeamIds: [],
  };
}

function conversionBody() {
  return {
    title: 'Original 2nd & 15 headline',
    originalSummary: 'An editor-written summary that is original to 2nd & 15.',
    originalCommentary: null,
    confirmedTeamIds: [],
    heroImageUrl: null,
    heroImageAlt: null,
    heroImageAttribution: null,
    heroImageAttributionUrl: null,
    changeSummary: 'Converted from the controlled source inbox.',
  };
}
