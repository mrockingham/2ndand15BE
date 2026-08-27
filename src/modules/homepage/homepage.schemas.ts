import { z } from 'zod';

import { heroRichTextDocumentSchema } from './homepage-rich-text.js';

/** Matches the article-module convention -- normalizes line endings/Unicode
 * form before length validation, never accepts raw HTML/markup. */
function normalizeText(value: string): string {
  return value.normalize('NFC').replace(/\r\n?/g, '\n').trim();
}

const requiredText = (maximum: number) =>
  z.string().transform(normalizeText).pipe(z.string().min(1).max(maximum));

const nullableText = (maximum: number) =>
  z.string().transform(normalizeText).pipe(z.string().min(1).max(maximum)).nullable();

/** HTTPS-only, matching the `GameCuratedVideo`/`GlobalGameCenterVideo`
 * `httpsUrl` convention in `game-media-curation.schemas.ts` -- reused here in
 * spirit rather than by import, since that module's helper is not exported. */
const httpsUrl = (maximum = 2_048) =>
  z
    .url()
    .max(maximum)
    .refine(
      (value) => {
        try {
          return new URL(value).protocol === 'https:';
        } catch {
          return false;
        }
      },
      { message: 'Only HTTPS URLs are allowed.' },
    );

/** A CTA target may be an internal relative path (e.g. `/articles/foo`) or an
 * external `https:` URL -- never `http:`/`javascript:`/`data:`/`file:`, and
 * never a protocol-relative `//host` path (which browsers treat as external). */
const internalOrHttpsUrl = z
  .string()
  .trim()
  .min(1)
  .max(2_048)
  .refine(
    (value) => {
      if (value.startsWith('/')) return !value.startsWith('//');
      try {
        return new URL(value).protocol === 'https:';
      } catch {
        return false;
      }
    },
    { message: 'Must be an internal path starting with "/" or an https:// URL.' },
  );

export const MAX_HERO_SLIDES = 10;
export const MIN_ACTIVE_HERO_SLIDES_FOR_PUBLISH = 3;
export const MAX_HERO_CTAS_PER_SLIDE = 2;
export const MAX_TOP_STORIES = 6;

export const homepageHeroSlideIdParamsSchema = z.object({ slideId: z.uuid() }).strict();
export const homepageTopStoryArticleIdParamsSchema = z.object({ articleId: z.uuid() }).strict();

export const homepageHeroContentSlotSchema = z.enum([
  'TOP_LEFT',
  'TOP_CENTER',
  'TOP_RIGHT',
  'MIDDLE_LEFT',
  'MIDDLE_CENTER',
  'MIDDLE_RIGHT',
  'BOTTOM_LEFT',
  'BOTTOM_CENTER',
  'BOTTOM_RIGHT',
]);

export const homepageHeroCtaVariantSchema = z.enum(['PRIMARY', 'SECONDARY']);

const heroContentBlockInputSchema = z
  .object({
    slot: homepageHeroContentSlotSchema,
    content: heroRichTextDocumentSchema,
  })
  .strict();

const heroCtaInputSchema = z
  .object({
    label: requiredText(60),
    url: internalOrHttpsUrl,
    variant: homepageHeroCtaVariantSchema.default('PRIMARY'),
  })
  .strict();

function requireUniqueSlots(
  blocks: readonly { readonly slot: string }[],
  context: z.RefinementCtx,
): void {
  const seen = new Set<string>();
  for (const block of blocks) {
    if (seen.has(block.slot)) {
      context.addIssue({ code: 'custom', message: `Duplicate content block slot: ${block.slot}` });
      return;
    }
    seen.add(block.slot);
  }
}

/**
 * Presentation-only fields -- see `HomepageHeroSlide` doc comment in
 * `prisma/schema.prisma` for the bounded ranges. Every value here can be
 * reset to its default without ever touching `imageUrl`, matching the
 * "non-destructive editing" requirement (M35A spec §8).
 */
const heroImagePresentationFields = {
  imageUrl: httpsUrl(2_048),
  imageAlt: nullableText(300),
  imageBrightness: z.number().int().min(25).max(150),
  imageContrast: z.number().int().min(50).max(150),
  imageSaturation: z.number().int().min(0).max(200),
  overlayOpacity: z.number().int().min(0).max(100),
  focalPointX: z.number().int().min(0).max(100),
  focalPointY: z.number().int().min(0).max(100),
  imageScale: z.number().int().min(100).max(200),
} as const;

export const createHeroSlideSchema = z
  .object({
    isActive: z.boolean().default(true),
    imageUrl: heroImagePresentationFields.imageUrl,
    imageAlt: heroImagePresentationFields.imageAlt.default(null),
    imageBrightness: heroImagePresentationFields.imageBrightness.default(100),
    imageContrast: heroImagePresentationFields.imageContrast.default(100),
    imageSaturation: heroImagePresentationFields.imageSaturation.default(100),
    overlayOpacity: heroImagePresentationFields.overlayOpacity.default(0),
    focalPointX: heroImagePresentationFields.focalPointX.default(50),
    focalPointY: heroImagePresentationFields.focalPointY.default(50),
    imageScale: heroImagePresentationFields.imageScale.default(100),
    contentBlocks: z.array(heroContentBlockInputSchema).max(9).default([]),
    ctas: z.array(heroCtaInputSchema).max(MAX_HERO_CTAS_PER_SLIDE).default([]),
  })
  .strict()
  .superRefine((value, context) => {
    requireUniqueSlots(value.contentBlocks, context);
  });
export type CreateHeroSlideInput = z.infer<typeof createHeroSlideSchema>;

/**
 * `contentBlocks`/`ctas`, when provided, are a full replacement of that
 * slide's set -- never a partial merge -- matching the M35A spec §11
 * conceptual payload (`{ image, contentBlocks, ctas }` as one transactional
 * PATCH rather than nine separate content-block endpoints).
 */
export const updateHeroSlideSchema = z
  .object({
    isActive: z.boolean(),
    imageUrl: heroImagePresentationFields.imageUrl,
    imageAlt: heroImagePresentationFields.imageAlt,
    imageBrightness: heroImagePresentationFields.imageBrightness,
    imageContrast: heroImagePresentationFields.imageContrast,
    imageSaturation: heroImagePresentationFields.imageSaturation,
    overlayOpacity: heroImagePresentationFields.overlayOpacity,
    focalPointX: heroImagePresentationFields.focalPointX,
    focalPointY: heroImagePresentationFields.focalPointY,
    imageScale: heroImagePresentationFields.imageScale,
    contentBlocks: z.array(heroContentBlockInputSchema).max(9),
    ctas: z.array(heroCtaInputSchema).max(MAX_HERO_CTAS_PER_SLIDE),
  })
  .partial()
  .strict()
  .superRefine((value, context) => {
    if (Object.keys(value).length === 0) {
      context.addIssue({ code: 'custom', message: 'At least one field is required.' });
    }
    if (value.contentBlocks !== undefined) requireUniqueSlots(value.contentBlocks, context);
  });
export type UpdateHeroSlideInput = z.infer<typeof updateHeroSlideSchema>;

export const reorderHeroSlidesSchema = z
  .object({ slideIds: z.array(z.uuid()).min(1).max(MAX_HERO_SLIDES) })
  .strict();
export type ReorderHeroSlidesInput = z.infer<typeof reorderHeroSlidesSchema>;

export const reorderTopStoriesSchema = z
  .object({ articleIds: z.array(z.uuid()).min(1).max(MAX_TOP_STORIES) })
  .strict();
export type ReorderTopStoriesInput = z.infer<typeof reorderTopStoriesSchema>;

// ---------------------------------------------------------------------------
// M37A: Homepage highlight curation
// ---------------------------------------------------------------------------

export const MAX_HOMEPAGE_HIGHLIGHT_PLACEMENTS = 10;
export const MIN_HOMEPAGE_HIGHLIGHT_DISPLAY_LIMIT = 3;
export const MAX_HOMEPAGE_HIGHLIGHT_DISPLAY_LIMIT = 10;

export const homepageHighlightSourceTypeSchema = z.enum(['GAME_HIGHLIGHT', 'CURATED_GAME_VIDEO']);

export const homepageHighlightPlacementIdParamsSchema = z
  .object({ placementId: z.uuid() })
  .strict();

export const addHighlightPlacementSchema = z
  .object({
    sourceType: homepageHighlightSourceTypeSchema,
    sourceId: z.uuid(),
  })
  .strict();
export type AddHighlightPlacementInput = z.infer<typeof addHighlightPlacementSchema>;

export const reorderHighlightPlacementsSchema = z
  .object({
    placementIds: z.array(z.uuid()).min(1).max(MAX_HOMEPAGE_HIGHLIGHT_PLACEMENTS),
  })
  .strict();
export type ReorderHighlightPlacementsInput = z.infer<typeof reorderHighlightPlacementsSchema>;

export const updateHighlightSettingsSchema = z
  .object({
    displayLimit: z
      .number()
      .int()
      .min(MIN_HOMEPAGE_HIGHLIGHT_DISPLAY_LIMIT)
      .max(MAX_HOMEPAGE_HIGHLIGHT_DISPLAY_LIMIT),
    fillWithAutomatic: z.boolean(),
  })
  .partial()
  .strict()
  .superRefine((value, context) => {
    if (Object.keys(value).length === 0) {
      context.addIssue({ code: 'custom', message: 'At least one field is required.' });
    }
  });
export type UpdateHighlightSettingsInput = z.infer<typeof updateHighlightSettingsSchema>;

export const highlightCandidatesQuerySchema = z
  .object({
    gameId: z.uuid().optional(),
    dateFrom: z.coerce.date().optional(),
    dateTo: z.coerce.date().optional(),
    mediaType: homepageHighlightSourceTypeSchema.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    cursor: z.string().min(1).max(200).optional(),
  })
  .strict();
export type HighlightCandidatesQuery = z.infer<typeof highlightCandidatesQuerySchema>;
