import express, { type RequestHandler } from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { errorHandler } from '../../common/middleware/error-handler.js';
import { createEditorialAiRouters } from './editorial-ai.routes.js';
import type { EditorialAiServiceContract } from './editorial-ai.service.js';

const userId = '00000000-0000-4000-8000-000000000001';
const candidateId = '00000000-0000-4000-8000-000000000100';

function service(): EditorialAiServiceContract {
  return {
    generateDraft: vi.fn().mockResolvedValue({
      article: { id: 'a', slug: 'draft', version: 1, status: 'DRAFT' },
      reviewStatus: 'NEEDS_REVIEW',
    }),
    generateBatch: vi.fn().mockResolvedValue({ requested: 1, generated: 1 }),
    evaluateCandidate: vi
      .fn()
      .mockResolvedValue({ candidateId: 'candidate', decision: 'NFL_RELEVANT_LINK_ONLY' }),
    evaluateCandidates: vi.fn().mockResolvedValue({ requested: 1, evaluated: 1 }),
    evaluateAllCandidates: vi.fn().mockResolvedValue({ requested: 1, evaluated: 1 }),
    overrideCandidateQuality: vi
      .fn()
      .mockResolvedValue({ candidateId: 'candidate', decision: 'NFL_RELEVANT_SHORT_BRIEF' }),
    discoverLaunchCandidates: vi.fn().mockResolvedValue({ mode: 'PILOT', teamsAttempted: [] }),
    regenerateDraft: vi.fn().mockResolvedValue({
      article: { id: 'a', slug: 'draft', version: 2, status: 'DRAFT' },
      reviewStatus: 'NEEDS_REVIEW',
    }),
    coverage: vi.fn().mockResolvedValue({
      targetCount: 7,
      teams: Array.from({ length: 32 }, (_, index) => ({
        id: `team-${String(index)}`,
        abbreviation: `T${String(index)}`,
        publishedCount: 0,
        draftCount: 0,
        candidateCount: 0,
        recentPublishedCount: 0,
        videoArticleCount: 0,
        remainingToTarget: 7,
      })),
      totals: {
        teamsAtTarget: 0,
        teamsBelowTarget: 32,
        totalPublished: 0,
        totalDrafts: 0,
        totalCandidates: 0,
      },
      durationMs: 2,
    }),
    setReviewStatus: vi.fn().mockResolvedValue({ articleId: 'a', reviewStatus: 'APPROVED' }),
    createMediaCandidate: vi.fn().mockResolvedValue({ id: 'm' }),
    attachMedia: vi
      .fn()
      .mockResolvedValue({ articleId: 'a', mediaCandidateId: 'm', status: 'ATTACHED' }),
    getSourceRights: vi.fn().mockResolvedValue({
      sourceId: 's',
      textUsage: 'UNKNOWN',
      imageUsage: 'UNKNOWN',
      videoUsage: 'UNKNOWN',
      quotationPolicy: 'UNKNOWN',
      reviewRequired: true,
      notes: null,
      reviewedBySnapshot: null,
      reviewedAt: null,
    }),
    updateSourceRights: vi.fn().mockResolvedValue({ sourceId: 's' }),
  };
}

function app(editorial: EditorialAiServiceContract) {
  const authenticate: RequestHandler = (req, _res, next) => {
    if (req.headers.authorization === 'Bearer editor')
      req.auth = { userId, sessionId: '00000000-0000-4000-8000-000000000002' };
    next();
  };
  const routers = createEditorialAiRouters({
    authenticate,
    identities: {
      findAdministrativeIdentity: (id) =>
        Promise.resolve(
          id === userId ? { userId, email: 'editor@example.com', role: 'ADMIN' } : null,
        ),
    },
    service: editorial,
  });
  const instance = express();
  instance.use(express.json());
  instance.use('/api/v1/admin/news-candidates', routers.candidates);
  instance.use('/api/v1/admin/articles', routers.articles);
  instance.use('/api/v1/admin/editorial', routers.editorial);
  instance.use('/api/v1/admin/news-sources', routers.sources);
  instance.use(errorHandler);
  return instance;
}

describe('editorial AI admin routes', () => {
  it('requires current administrative authorization', async () => {
    await request(app(service())).get('/api/v1/admin/editorial/coverage').expect(401);
  });

  it('validates generation input and never accepts an unbounded batch', async () => {
    const editorial = service();
    await request(app(editorial))
      .post(`/api/v1/admin/news-candidates/${candidateId}/generate-draft`)
      .set('authorization', 'Bearer editor')
      .send({ instruction: 'be concise' })
      .expect(201);
    await request(app(editorial))
      .post('/api/v1/admin/news-candidates/generate-drafts')
      .set('authorization', 'Bearer editor')
      .send({ candidateIds: [] })
      .expect(400);
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(editorial.generateDraft).toHaveBeenCalledOnce();
  });

  it('returns all 32 teams with target bounds', async () => {
    const response = await request(app(service()))
      .get('/api/v1/admin/editorial/coverage?target=7')
      .set('authorization', 'Bearer editor')
      .expect(200);
    const body = z.object({ data: z.object({ teams: z.array(z.unknown()) }) }).parse(response.body);
    expect(body.data.teams).toHaveLength(32);
    await request(app(service()))
      .get('/api/v1/admin/editorial/coverage?target=100')
      .set('authorization', 'Bearer editor')
      .expect(400);
  });

  it('evaluates candidates and validates bounded quality overrides', async () => {
    const editorial = service();
    await request(app(editorial))
      .post(`/api/v1/admin/news-candidates/${candidateId}/evaluate`)
      .set('authorization', 'Bearer editor')
      .send({})
      .expect(200);
    await request(app(editorial))
      .post('/api/v1/admin/news-candidates/evaluate-batch')
      .set('authorization', 'Bearer editor')
      .send({ candidateIds: [] })
      .expect(400);
    await request(app(editorial))
      .post(`/api/v1/admin/news-candidates/${candidateId}/quality-override`)
      .set('authorization', 'Bearer editor')
      .send({
        relevance: 'NFL',
        sufficiency: 'SHORT_BRIEF_ELIGIBLE',
        reason: 'Editor verified the NFL connection.',
      })
      .expect(200);
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(editorial.evaluateCandidate).toHaveBeenCalledOnce();
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(editorial.overrideCandidateQuality).toHaveBeenCalledOnce();
  });

  it('validates launch discovery bounds and remains admin-only', async () => {
    await request(app(service()))
      .post('/api/v1/admin/editorial/discover-launch-candidates')
      .send({ pilot: true })
      .expect(401);
    await request(app(service()))
      .post('/api/v1/admin/editorial/discover-launch-candidates')
      .set('authorization', 'Bearer editor')
      .send({ targetPerTeam: 10, freshnessDays: 14, maxNewCandidates: 321, pilot: true })
      .expect(400);
  });
});
