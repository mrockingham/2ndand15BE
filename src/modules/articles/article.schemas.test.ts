import { describe, expect, it } from 'vitest';

import {
  articleCreateSchema,
  articleUpdateSchema,
  publicArticleListQuerySchema,
} from './article.schemas.js';

function originalInput() {
  return {
    type: 'ORIGINAL',
    title: 'A fictional training-camp story',
    summary: 'An original fictional summary.',
    body: '# Fictional story\r\n\r\nNo real reporting is represented.',
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

describe('article boundary schemas', () => {
  it('normalizes Markdown line endings and accepts constrained original content', () => {
    const result = articleCreateSchema.parse(originalInput());
    expect(result.body).toContain('# Fictional story\n\nNo real');
  });

  it('rejects executable HTML, unsafe URL protocols, duplicate teams, and missing hero alt text', () => {
    expect(
      articleCreateSchema.safeParse({ ...originalInput(), body: '<script>alert(1)</script>' })
        .success,
    ).toBe(false);
    expect(
      articleCreateSchema.safeParse({ ...originalInput(), body: '[unsafe](javascript:alert(1))' })
        .success,
    ).toBe(false);
    expect(
      articleCreateSchema.safeParse({ ...originalInput(), sourceUrl: 'javascript:alert(1)' })
        .success,
    ).toBe(false);
    const teamId = '00000000-0000-4000-8000-000000000001';
    expect(
      articleCreateSchema.safeParse({ ...originalInput(), teamIds: [teamId, teamId] }).success,
    ).toBe(false);
    expect(
      articleCreateSchema.safeParse({
        ...originalInput(),
        heroImageUrl: 'https://example.com/image.jpg',
      }).success,
    ).toBe(false);
    expect(
      articleCreateSchema.safeParse({ ...originalInput(), body: 'x'.repeat(100_001) }).success,
    ).toBe(false);
  });

  it('requires optimistic concurrency and rejects empty update payloads', () => {
    expect(articleUpdateSchema.safeParse({ title: 'Changed' }).success).toBe(false);
    expect(articleUpdateSchema.safeParse({ expectedVersion: 1 }).success).toBe(false);
    expect(articleUpdateSchema.safeParse({ expectedVersion: 1, title: 'Changed' }).success).toBe(
      true,
    );
  });

  it('defaults contentType and mediaThumbnailUrl on create without polluting partial updates', () => {
    const created = articleCreateSchema.parse(originalInput());
    expect(created.contentType).toBe('ARTICLE');
    expect(created.mediaThumbnailUrl).toBeNull();

    const video = articleCreateSchema.parse({
      ...originalInput(),
      contentType: 'VIDEO',
      mediaThumbnailUrl: 'https://example.com/thumb.jpg',
    });
    expect(video.contentType).toBe('VIDEO');
    expect(video.mediaThumbnailUrl).toBe('https://example.com/thumb.jpg');

    expect(
      articleCreateSchema.safeParse({ ...originalInput(), contentType: 'PODCAST' }).success,
    ).toBe(false);

    const emptyUpdate = articleUpdateSchema.safeParse({ expectedVersion: 1 });
    expect(emptyUpdate.success).toBe(false);
    const contentTypeUpdate = articleUpdateSchema.parse({
      expectedVersion: 1,
      contentType: 'HIGHLIGHT',
    });
    expect(contentTypeUpdate.contentType).toBe('HIGHLIGHT');
    expect('mediaThumbnailUrl' in contentTypeUpdate).toBe(false);
  });

  it('accepts an optional public contentType filter', () => {
    expect(publicArticleListQuerySchema.parse({}).contentType).toBeUndefined();
    expect(publicArticleListQuerySchema.parse({ contentType: 'HIGHLIGHT' }).contentType).toBe(
      'HIGHLIGHT',
    );
    expect(publicArticleListQuerySchema.safeParse({ contentType: 'PODCAST' }).success).toBe(false);
  });

  it('defaults sourceIsOfficialTeam to false on create without polluting partial updates', () => {
    const created = articleCreateSchema.parse(originalInput());
    expect(created.sourceIsOfficialTeam).toBe(false);

    const official = articleCreateSchema.parse({
      ...originalInput(),
      sourceIsOfficialTeam: true,
    });
    expect(official.sourceIsOfficialTeam).toBe(true);

    const emptyUpdate = articleUpdateSchema.safeParse({ expectedVersion: 1 });
    expect(emptyUpdate.success).toBe(false);
    const officialUpdate = articleUpdateSchema.parse({
      expectedVersion: 1,
      sourceIsOfficialTeam: true,
    });
    expect(officialUpdate.sourceIsOfficialTeam).toBe(true);
    // Omitting the field on a partial update must leave it truly absent, not
    // silently reset to a default -- the same pitfall that hit `contentType`.
    const untouchedUpdate = articleUpdateSchema.parse({ expectedVersion: 1, title: 'Changed' });
    expect('sourceIsOfficialTeam' in untouchedUpdate).toBe(false);
  });
});
