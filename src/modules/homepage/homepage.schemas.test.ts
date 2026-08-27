import { describe, expect, it } from 'vitest';

import {
  createHeroSlideSchema,
  reorderHeroSlidesSchema,
  reorderTopStoriesSchema,
  updateHeroSlideSchema,
} from './homepage.schemas.js';

function richTextDoc(text = 'Hello') {
  return { type: 'doc', children: [{ type: 'paragraph', children: [{ type: 'text', text }] }] };
}

describe('createHeroSlideSchema', () => {
  it('accepts a minimal slide and applies documented defaults', () => {
    const result = createHeroSlideSchema.safeParse({ imageUrl: 'https://example.test/hero.jpg' });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toMatchObject({
      isActive: true,
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
    });
  });

  it('rejects a non-HTTPS image URL', () => {
    expect(
      createHeroSlideSchema.safeParse({ imageUrl: 'http://example.test/hero.jpg' }).success,
    ).toBe(false);
  });

  it('rejects brightness outside 25-150', () => {
    expect(
      createHeroSlideSchema.safeParse({
        imageUrl: 'https://example.test/hero.jpg',
        imageBrightness: 200,
      }).success,
    ).toBe(false);
    expect(
      createHeroSlideSchema.safeParse({
        imageUrl: 'https://example.test/hero.jpg',
        imageBrightness: 10,
      }).success,
    ).toBe(false);
  });

  it('rejects overlayOpacity outside 0-100', () => {
    expect(
      createHeroSlideSchema.safeParse({
        imageUrl: 'https://example.test/hero.jpg',
        overlayOpacity: 150,
      }).success,
    ).toBe(false);
  });

  it('rejects focalPointX/Y outside 0-100', () => {
    expect(
      createHeroSlideSchema.safeParse({
        imageUrl: 'https://example.test/hero.jpg',
        focalPointX: -1,
      }).success,
    ).toBe(false);
    expect(
      createHeroSlideSchema.safeParse({
        imageUrl: 'https://example.test/hero.jpg',
        focalPointY: 101,
      }).success,
    ).toBe(false);
  });

  it('rejects imageScale outside 100-200', () => {
    expect(
      createHeroSlideSchema.safeParse({ imageUrl: 'https://example.test/hero.jpg', imageScale: 99 })
        .success,
    ).toBe(false);
    expect(
      createHeroSlideSchema.safeParse({
        imageUrl: 'https://example.test/hero.jpg',
        imageScale: 201,
      }).success,
    ).toBe(false);
  });

  it('accepts up to nine unique content block slots', () => {
    const slots = [
      'TOP_LEFT',
      'TOP_CENTER',
      'TOP_RIGHT',
      'MIDDLE_LEFT',
      'MIDDLE_CENTER',
      'MIDDLE_RIGHT',
      'BOTTOM_LEFT',
      'BOTTOM_CENTER',
      'BOTTOM_RIGHT',
    ];
    const result = createHeroSlideSchema.safeParse({
      imageUrl: 'https://example.test/hero.jpg',
      contentBlocks: slots.map((slot) => ({ slot, content: richTextDoc() })),
    });
    expect(result.success).toBe(true);
  });

  it('rejects a duplicate content block slot', () => {
    const result = createHeroSlideSchema.safeParse({
      imageUrl: 'https://example.test/hero.jpg',
      contentBlocks: [
        { slot: 'TOP_LEFT', content: richTextDoc('a') },
        { slot: 'TOP_LEFT', content: richTextDoc('b') },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('rejects more than nine content blocks', () => {
    const result = createHeroSlideSchema.safeParse({
      imageUrl: 'https://example.test/hero.jpg',
      contentBlocks: Array.from({ length: 10 }, (_, i) => ({
        slot: 'TOP_LEFT',
        content: richTextDoc(String(i)),
      })),
    });
    expect(result.success).toBe(false);
  });

  it('rejects an unrecognized slot', () => {
    const result = createHeroSlideSchema.safeParse({
      imageUrl: 'https://example.test/hero.jpg',
      contentBlocks: [{ slot: 'CENTER_CENTER', content: richTextDoc() }],
    });
    expect(result.success).toBe(false);
  });

  it('accepts up to two CTAs with internal or https URLs', () => {
    const result = createHeroSlideSchema.safeParse({
      imageUrl: 'https://example.test/hero.jpg',
      ctas: [
        { label: 'Read more', url: '/articles/foo' },
        { label: 'Watch', url: 'https://www.youtube.com/watch?v=abc', variant: 'SECONDARY' },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('rejects a third CTA', () => {
    const result = createHeroSlideSchema.safeParse({
      imageUrl: 'https://example.test/hero.jpg',
      ctas: [
        { label: 'A', url: '/a' },
        { label: 'B', url: '/b' },
        { label: 'C', url: '/c' },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('rejects a CTA with a javascript: URL', () => {
    const result = createHeroSlideSchema.safeParse({
      imageUrl: 'https://example.test/hero.jpg',
      ctas: [{ label: 'Bad', url: 'javascript:alert(1)' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects raw iframe markup passed as a CTA URL', () => {
    const result = createHeroSlideSchema.safeParse({
      imageUrl: 'https://example.test/hero.jpg',
      ctas: [{ label: 'Bad', url: '<iframe src="https://evil.example.com"></iframe>' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects unknown top-level fields', () => {
    const result = createHeroSlideSchema.safeParse({
      imageUrl: 'https://example.test/hero.jpg',
      unexpected: true,
    });
    expect(result.success).toBe(false);
  });
});

describe('updateHeroSlideSchema', () => {
  it('accepts a single-field partial update', () => {
    expect(updateHeroSlideSchema.safeParse({ isActive: false }).success).toBe(true);
  });

  it('rejects an empty update', () => {
    expect(updateHeroSlideSchema.safeParse({}).success).toBe(false);
  });

  it('rejects a duplicate slot within an update contentBlocks array', () => {
    const result = updateHeroSlideSchema.safeParse({
      contentBlocks: [
        { slot: 'BOTTOM_RIGHT', content: richTextDoc('a') },
        { slot: 'BOTTOM_RIGHT', content: richTextDoc('b') },
      ],
    });
    expect(result.success).toBe(false);
  });
});

describe('reorderHeroSlidesSchema', () => {
  it('accepts up to ten slide IDs', () => {
    const ids = Array.from(
      { length: 10 },
      (_, i) => `00000000-0000-4000-8000-00000000000${String(i)}`,
    );
    expect(reorderHeroSlidesSchema.safeParse({ slideIds: ids }).success).toBe(true);
  });

  it('rejects more than ten', () => {
    const ids = Array.from({ length: 11 }, () => '00000000-0000-4000-8000-000000000001');
    expect(reorderHeroSlidesSchema.safeParse({ slideIds: ids }).success).toBe(false);
  });

  it('rejects an empty list', () => {
    expect(reorderHeroSlidesSchema.safeParse({ slideIds: [] }).success).toBe(false);
  });
});

describe('reorderTopStoriesSchema', () => {
  it('rejects more than six article IDs', () => {
    const ids = Array.from({ length: 7 }, () => '00000000-0000-4000-8000-000000000001');
    expect(reorderTopStoriesSchema.safeParse({ articleIds: ids }).success).toBe(false);
  });
});
