/* Repository mocks are intentionally inspected as assertion subjects. */
/* eslint-disable @typescript-eslint/unbound-method */
import { describe, expect, it, vi } from 'vitest';

import { createTeamRecord } from '../teams/team.test-fixtures.js';
import type { AdministrativePrincipal } from '../admin/admin-authorization.js';
import type { ArticleRecord } from './article.dto.js';
import type { ArticleRepository } from './article.repository.js';
import type { ArticleCreateInput } from './article.schemas.js';
import { ArticleService, normalizeSlug } from './article.service.js';

const editor: AdministrativePrincipal = {
  userId: '00000000-0000-4000-8000-000000000010',
  email: 'editor@example.com',
  role: 'EDITOR',
};

describe('article service', () => {
  it('generates safe slugs and rejects reserved slugs', () => {
    expect(normalizeSlug('Bills & Dolphins: A Preview!')).toBe('bills-dolphins-a-preview');
    expect(() => normalizeSlug('admin')).toThrow(/reserved/i);
  });

  it('creates a draft with validated active team tags', async () => {
    const created = articleRecord();
    const repository = repositoryMock({ create: vi.fn().mockResolvedValue(created) });
    const result = await new ArticleService(repository).create(createInput(), editor, 'req-1');
    expect(result).toMatchObject({ status: 'DRAFT', version: 1, slug: created.slug });
    expect(vi.mocked(repository.create)).toHaveBeenCalledWith(
      expect.objectContaining({ slug: 'fictional-camp-notes' }),
      [created.teams[0]?.teamId],
      editor,
      null,
      'req-1',
    );
  });

  it('enforces curated attribution and short original commentary', async () => {
    const repository = repositoryMock();
    const service = new ArticleService(repository);
    await expect(
      service.create(
        { ...createInput(), type: 'CURATED', sourceName: null, sourceUrl: null },
        editor,
        null,
      ),
    ).rejects.toMatchObject({ code: 'ARTICLE_VALIDATION_ERROR' });
    await expect(
      service.create(
        {
          ...createInput(),
          type: 'CURATED',
          sourceName: 'Example publication',
          sourceUrl: 'https://example.com/story',
          body: 'x'.repeat(2_001),
        },
        editor,
        null,
      ),
    ).rejects.toMatchObject({ code: 'ARTICLE_VALIDATION_ERROR' });
    await expect(
      service.create({ ...createInput(), type: 'ANNOUNCEMENT', body: null }, editor, null),
    ).rejects.toMatchObject({ code: 'ARTICLE_VALIDATION_ERROR' });
  });

  it('rejects duplicate slugs with a stable conflict', async () => {
    const repository = repositoryMock({ findBySlug: vi.fn().mockResolvedValue(articleRecord()) });
    await expect(
      new ArticleService(repository).create(createInput(), editor, null),
    ).rejects.toMatchObject({ code: 'ARTICLE_SLUG_CONFLICT' });
  });

  it('rejects stale writes and archived edits before mutation', async () => {
    const repository = repositoryMock({ findById: vi.fn().mockResolvedValue(articleRecord()) });
    const service = new ArticleService(repository);
    await expect(
      service.update(articleRecord().id, { expectedVersion: 2, title: 'Stale edit' }, editor, null),
    ).rejects.toMatchObject({ code: 'ARTICLE_VERSION_CONFLICT' });
    const archived = articleRecord({ status: 'ARCHIVED' });
    vi.mocked(repository.findById).mockResolvedValue(archived);
    await expect(
      service.update(archived.id, { expectedVersion: 1, title: 'Edit' }, editor, null),
    ).rejects.toMatchObject({ code: 'ARTICLE_ARCHIVED' });
  });

  it('sorts featured articles by priority and keeps bodies out of list DTOs', async () => {
    const low = articleRecord({
      id: '00000000-0000-4000-8000-000000000201',
      isFeatured: true,
      featuredPriority: 9,
      status: 'PUBLISHED',
      publishedAt: new Date('2026-08-01T12:00:00Z'),
    });
    const high = articleRecord({
      id: '00000000-0000-4000-8000-000000000202',
      slug: 'high-priority',
      isFeatured: true,
      featuredPriority: 1,
      status: 'PUBLISHED',
      publishedAt: new Date('2026-08-01T11:00:00Z'),
    });
    const repository = repositoryMock({
      listPublicCandidates: vi.fn().mockResolvedValue([low, high]),
    });
    const page = await new ArticleService(
      repository,
      () => new Date('2026-08-02T00:00:00Z'),
    ).listFeatured({
      limit: 20,
      featured: true,
    });
    expect(page.articles.map(({ id }) => id)).toEqual([high.id, low.id]);
    expect(JSON.stringify(page.articles)).not.toContain('Original fictional body');
    const first = await new ArticleService(
      repository,
      () => new Date('2026-08-02T00:00:00Z'),
    ).listFeatured({ limit: 1, featured: true });
    expect(first).toMatchObject({ nextCursor: high.id });
    const second = await new ArticleService(
      repository,
      () => new Date('2026-08-02T00:00:00Z'),
    ).listFeatured({ limit: 1, featured: true, cursor: high.id });
    expect(second.articles.map(({ id }) => id)).toEqual([low.id]);
  });
});

function repositoryMock(overrides: Partial<ArticleRepository> = {}): ArticleRepository {
  return {
    findById: vi.fn().mockResolvedValue(null),
    findBySlug: vi.fn().mockResolvedValue(null),
    findPublicBySlug: vi.fn().mockResolvedValue(null),
    listAdmin: vi.fn().mockResolvedValue({ articles: [], nextCursor: null }),
    listPublicCandidates: vi.fn().mockResolvedValue([]),
    findActiveTeamIds: vi.fn().mockImplementation((ids: readonly string[]) => Promise.resolve(ids)),
    findActiveTeamIdByAbbreviation: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue(articleRecord()),
    mutate: vi.fn().mockResolvedValue(articleRecord()),
    listRevisions: vi.fn().mockResolvedValue({ revisions: [], nextCursor: null }),
    findRevision: vi.fn().mockResolvedValue(null),
    ...overrides,
  };
}

function createInput(): ArticleCreateInput {
  const record = articleRecord();
  return {
    type: 'ORIGINAL',
    title: 'Fictional Camp Notes',
    summary: 'A fictional editorial summary.',
    body: 'Original fictional body.',
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
    teamIds: [record.teams[0]?.teamId ?? ''],
  };
}

function articleRecord(overrides: Partial<ArticleRecord> = {}): ArticleRecord {
  const team = createTeamRecord();
  const articleId = overrides.id ?? '00000000-0000-4000-8000-000000000200';
  return {
    id: articleId,
    slug: 'fictional-camp-notes',
    type: 'ORIGINAL',
    status: 'DRAFT',
    version: 1,
    title: 'Fictional Camp Notes',
    summary: 'A fictional editorial summary.',
    body: 'Original fictional body.',
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
    publishedAt: null,
    scheduledFor: null,
    createdById: editor.userId,
    updatedById: editor.userId,
    createdBySnapshot: editor.email,
    updatedBySnapshot: editor.email,
    createdAt: new Date('2026-08-02T00:00:00Z'),
    updatedAt: new Date('2026-08-02T00:00:00Z'),
    teams: [
      {
        articleId,
        teamId: team.id,
        createdAt: new Date('2026-08-02T00:00:00Z'),
        team,
      },
    ],
    ...overrides,
  };
}
