import { describe, expect, it, vi } from 'vitest';

import { AppError } from '../../common/errors/app-error.js';
import type { AdministrativePrincipal } from '../admin/admin-authorization.js';
import type { EditorialAiProvider } from './editorial-ai.provider.js';
import type {
  EditorialAiRepository,
  EditorialCandidate,
  EditorialTeam,
} from './editorial-ai.repository.js';
import { detectDuplicate, EditorialAiService, phraseOverlap } from './editorial-ai.service.js';

const actor: AdministrativePrincipal = {
  userId: '00000000-0000-4000-8000-000000000001',
  email: 'editor@example.com',
  role: 'EDITOR',
};
const ari: EditorialTeam = {
  id: '00000000-0000-4000-8000-000000000010',
  abbreviation: 'ARI',
  fullName: 'Arizona Cardinals',
  city: 'Arizona',
  name: 'Cardinals',
};
const car: EditorialTeam = {
  id: '00000000-0000-4000-8000-000000000011',
  abbreviation: 'CAR',
  fullName: 'Carolina Panthers',
  city: 'Carolina',
  name: 'Panthers',
};

function candidate(overrides: Partial<EditorialCandidate> = {}): EditorialCandidate {
  return {
    id: '00000000-0000-4000-8000-000000000100',
    sourceId: '00000000-0000-4000-8000-000000000200',
    sourceNameSnapshot: 'Example Sports',
    sourceExternalId: 'story-1',
    canonicalUrl: 'https://example.com/story',
    canonicalUrlHash: 'hash-1',
    headline: 'Cardinals prepare for preseason opener',
    sourceDescription:
      'Arizona prepared for its preseason opener with Carolina after a week of training camp practices.',
    sourceAuthor: 'Reporter',
    sourcePublishedAt: new Date('2026-08-09T12:00:00Z'),
    discoveredAt: new Date('2026-08-09T12:01:00Z'),
    status: 'NEW',
    convertedArticleId: null,
    source: {
      allowsDescriptionUse: true,
      rightsProfile: {
        textUsage: 'SUMMARY_ALLOWED',
        imageUsage: 'UNKNOWN',
        videoUsage: 'UNKNOWN',
        quotationPolicy: 'SHORT_QUOTES_ONLY',
        reviewRequired: false,
      },
    },
    suggestedTeams: [
      { team: { id: ari.id, abbreviation: ari.abbreviation, fullName: ari.fullName } },
    ],
    aiMetadata: null,
    ...overrides,
  };
}

function provider(
  overrides: Partial<Awaited<ReturnType<EditorialAiProvider['generateDraft']>>> = {},
): EditorialAiProvider {
  return {
    generateDraft: vi.fn().mockResolvedValue({
      draft: {
        headline: 'Cardinals set for preseason test against Panthers',
        dek: 'Arizona opens its preseason slate against Carolina.',
        body: 'The Arizona Cardinals are preparing to face the Carolina Panthers in a preseason matchup, according to Example Sports. The clubs enter the exhibition after training camp work.',
        primaryTeam: 'ARI',
        additionalTeams: ['CAR'],
        players: [],
        category: 'PRESEASON',
        topicTags: ['preseason', 'training camp'],
        sourceAttribution: 'Reporting based on Example Sports.',
        seoTitle: 'Cardinals prepare for Panthers preseason game',
        seoDescription: 'Arizona prepares to meet Carolina in preseason action.',
        confidence: 'HIGH',
        riskFlags: [],
        mediaSearchTerms: ['Cardinals Panthers preseason 2026'],
      },
      provider: 'fake-ai',
      model: 'test-model',
      promptVersion: 'test-v1',
      usage: { inputTokens: 100, outputTokens: 200, estimatedCostMicros: null },
      durationMs: 12,
      ...overrides,
    }),
  };
}

function repository(overrides: Partial<EditorialAiRepository> = {}): EditorialAiRepository {
  return {
    findCandidate: vi.fn().mockResolvedValue(candidate()),
    listTeams: vi.fn().mockResolvedValue([ari, car]),
    findAiDraft: vi.fn().mockResolvedValue(null),
    findPlayers: vi.fn().mockResolvedValue([]),
    findDuplicateCandidates: vi.fn().mockResolvedValue([]),
    findDuplicateArticles: vi.fn().mockResolvedValue([]),
    slugExists: vi.fn().mockResolvedValue(false),
    createDraft: vi.fn().mockResolvedValue({
      articleId: '00000000-0000-4000-8000-000000000300',
      slug: 'cardinals-set-for-preseason-test-against-panthers',
      version: 1,
    }),
    regenerateDraft: vi.fn().mockResolvedValue({ version: 2 }),
    listCoverage: vi.fn().mockResolvedValue([]),
    getCoverageTotals: vi
      .fn()
      .mockResolvedValue({ totalPublished: 0, totalDrafts: 0, totalCandidates: 0 }),
    setReviewStatus: vi.fn().mockResolvedValue(true),
    attachMedia: vi.fn().mockResolvedValue(true),
    createMediaCandidate: vi.fn().mockResolvedValue(null),
    getSourceRights: vi.fn().mockResolvedValue(null),
    upsertSourceRights: vi.fn().mockResolvedValue(null),
    ...overrides,
  };
}

describe('EditorialAiService', () => {
  it('creates an original DRAFT in NEEDS_REVIEW with internal team IDs and no publication', async () => {
    const repo = repository();
    const result = await new EditorialAiService(
      repo,
      provider(),
      () => new Date('2026-08-09T13:00:00Z'),
    ).generateDraft(candidate().id, actor, null);
    expect(result.article.status).toBe('DRAFT');
    expect(result.reviewStatus).toBe('NEEDS_REVIEW');
    expect(result.primaryTeamId).toBe(ari.id);
    expect(result.additionalTeamIds).toEqual([car.id]);
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const write = vi.mocked(repo.createDraft).mock.calls[0]?.[0];
    expect(write?.fields.type).toBe('ORIGINAL');
    expect(write?.fields.sourceUrl).toBe('https://example.com/story');
    expect(write?.metadata.promptVersion).toBe('test-v1');
  });

  it('omits unapproved descriptions and flags a thin, rights-unclear source', async () => {
    const repo = repository({
      findCandidate: vi
        .fn()
        .mockResolvedValue(
          candidate({ source: { allowsDescriptionUse: false, rightsProfile: null } }),
        ),
    });
    const ai = provider();
    const result = await new EditorialAiService(repo, ai).generateDraft(
      candidate().id,
      actor,
      null,
    );
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(vi.mocked(ai.generateDraft).mock.calls[0]?.[0].description).toBeNull();
    expect(result.riskFlags).toEqual(
      expect.arrayContaining(['THIN_SOURCE', 'MEDIA_RIGHTS_UNCLEAR']),
    );
  });

  it('does not write when the provider fails', async () => {
    const repo = repository();
    const ai: EditorialAiProvider = {
      generateDraft: vi.fn().mockRejectedValue(
        new AppError({
          code: 'EDITORIAL_AI_UNAVAILABLE',
          message: 'Unavailable',
          statusCode: 503,
        }),
      ),
    };
    await expect(
      new EditorialAiService(repo, ai).generateDraft(candidate().id, actor, null),
    ).rejects.toMatchObject({ code: 'EDITORIAL_AI_UNAVAILABLE' });
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(repo.createDraft).not.toHaveBeenCalled();
  });

  it('resolves only one exact player with matching team context', async () => {
    const repo = repository({
      findPlayers: vi.fn().mockResolvedValue([
        {
          id: '00000000-0000-4000-8000-000000000400',
          displayName: 'Example Player',
          normalizedName: 'example player',
          latestTeamId: ari.id,
        },
      ]),
    });
    const base = await provider().generateDraft({} as never);
    const ai = provider({
      draft: {
        ...base.draft,
        players: [
          { name: 'Example Player', team: 'ARI' },
          { name: 'Unknown Player', team: 'CAR' },
        ],
      },
    });
    const result = await new EditorialAiService(repo, ai).generateDraft(
      candidate().id,
      actor,
      null,
    );
    expect(result.playerIds).toEqual(['00000000-0000-4000-8000-000000000400']);
    expect(result.unresolvedPlayers).toEqual([{ name: 'Unknown Player', team: 'CAR' }]);
    expect(result.riskFlags).toContain('PLAYER_IDENTITY_UNCERTAIN');
  });

  it('reports already-generated candidates without calling AI', async () => {
    const ai = provider();
    const repo = repository({
      findCandidate: vi
        .fn()
        .mockResolvedValue(
          candidate({ convertedArticleId: '00000000-0000-4000-8000-000000000300' }),
        ),
    });
    await expect(
      new EditorialAiService(repo, ai).generateDraft(candidate().id, actor, null),
    ).rejects.toMatchObject({ code: 'EDITORIAL_AI_ALREADY_GENERATED' });
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(ai.generateDraft).not.toHaveBeenCalled();
  });

  it('batch generation is bounded, partial, and independently reports failures', async () => {
    const ids = ['00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000102'];
    const repo = repository({
      findCandidate: vi
        .fn()
        .mockImplementation((id: string) =>
          Promise.resolve(id === ids[0] ? candidate({ id }) : null),
        ),
    });
    const result = await new EditorialAiService(repo, provider()).generateBatch(ids, actor, null);
    expect(result).toMatchObject({ requested: 2, generated: 1, failed: 1, concurrency: 2 });
    await expect(
      new EditorialAiService(repo, provider()).generateBatch(
        Array.from(
          { length: 11 },
          (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
        ),
        actor,
        null,
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('regenerates only the current unpublished AI draft and returns it to review', async () => {
    const repo = repository({
      findAiDraft: vi
        .fn()
        .mockResolvedValue({ version: 1, status: 'DRAFT', candidate: candidate() }),
    });
    const result = await new EditorialAiService(repo, provider()).regenerateDraft(
      '00000000-0000-4000-8000-000000000300',
      1,
      actor,
      null,
      'shorter',
    );
    expect(result).toMatchObject({
      article: { version: 2, status: 'DRAFT' },
      reviewStatus: 'NEEDS_REVIEW',
    });
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(repo.regenerateDraft).toHaveBeenCalledOnce();
    await expect(
      new EditorialAiService(
        repository({
          findAiDraft: vi
            .fn()
            .mockResolvedValue({ version: 1, status: 'PUBLISHED', candidate: candidate() }),
        }),
        provider(),
      ).regenerateDraft('00000000-0000-4000-8000-000000000300', 1, actor, null),
    ).rejects.toMatchObject({ code: 'ARTICLE_VERSION_CONFLICT' });
  });

  it('returns target arithmetic for every team without counting candidates as ready content', async () => {
    const rows = [ari, car].map((team, index) => ({
      id: team.id,
      abbreviation: team.abbreviation,
      publishedCount: index === 0 ? 5 : 1,
      draftCount: 1,
      candidateCount: 4,
      recentPublishedCount: 1,
      videoArticleCount: 0,
    }));
    const result = await new EditorialAiService(
      repository({
        listCoverage: vi.fn().mockResolvedValue(rows),
        getCoverageTotals: vi
          .fn()
          .mockResolvedValue({ totalPublished: 6, totalDrafts: 2, totalCandidates: 8 }),
      }),
      provider(),
    ).coverage(7);
    expect(result.teams.map((team) => team.remainingToTarget)).toEqual([1, 5]);
    expect(result.totals).toMatchObject({
      teamsAtTarget: 0,
      teamsBelowTarget: 2,
      totalPublished: 6,
      totalDrafts: 2,
      totalCandidates: 8,
    });
  });

  it('blocks media attachment when the repository rejects rights', async () => {
    const service = new EditorialAiService(
      repository({ attachMedia: vi.fn().mockResolvedValue(false) }),
      provider(),
    );
    await expect(
      service.attachMedia(
        '00000000-0000-4000-8000-000000000300',
        '00000000-0000-4000-8000-000000000500',
        actor,
        null,
      ),
    ).rejects.toMatchObject({ code: 'MEDIA_ATTACHMENT_NOT_ALLOWED' });
  });
});

describe('editorial deterministic safeguards', () => {
  it('detects exact source identity and related headlines', () => {
    const exact = detectDuplicate(
      candidate(),
      'Different',
      [ari.id],
      [
        {
          id: 'other',
          canonicalUrlHash: 'hash-1',
          sourceExternalId: null,
          headline: 'Other',
          sourcePublishedAt: null,
          teamIds: [],
        },
      ],
      [],
    );
    expect(exact.status).toBe('DUPLICATE');
    const related = detectDuplicate(
      candidate(),
      'Cardinals prepare preseason opener',
      [ari.id],
      [
        {
          id: 'other',
          canonicalUrlHash: 'different',
          sourceExternalId: null,
          headline: 'Cardinals prepare for preseason opener',
          sourcePublishedAt: new Date('2026-08-09T11:00:00Z'),
          teamIds: [ari.id],
        },
      ],
      [],
    );
    expect(['RELATED', 'LIKELY_DUPLICATE']).toContain(related.status);
  });

  it('flags high five-word source overlap without synonym swapping', () => {
    const copied =
      'The Cardinals prepared for the preseason opener after a week of training camp practices.';
    expect(phraseOverlap(copied, copied)).toBe(1);
    expect(phraseOverlap(copied, 'Arizona will play Carolina next.')).toBe(0);
  });
});
