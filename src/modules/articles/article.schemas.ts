import { z } from 'zod';

export const articleTypeSchema = z.enum(['ORIGINAL', 'CURATED', 'ANNOUNCEMENT']);
export const articleContentTypeSchema = z.enum(['ARTICLE', 'VIDEO', 'HIGHLIGHT']);
export const articleStatusSchema = z.enum([
  'DRAFT',
  'SCHEDULED',
  'PUBLISHED',
  'UNPUBLISHED',
  'ARCHIVED',
]);

const nullableText = (maximum: number) =>
  z.string().transform(normalizeText).pipe(z.string().trim().min(1).max(maximum)).nullable();
const nullableMarkdown = (maximum: number) =>
  z.string().transform(normalizeMarkdown).pipe(safeMarkdown(maximum)).nullable();
const httpUrl = z
  .url()
  .max(2_048)
  .refine((value) => ['http:', 'https:'].includes(new URL(value).protocol), {
    message: 'Only HTTP and HTTPS URLs are allowed.',
  });
const nullableHttpUrl = httpUrl.nullable();
const timestamp = z.iso.datetime({ offset: true });

const editorialFields = {
  type: articleTypeSchema,
  title: z.string().transform(normalizeText).pipe(z.string().trim().min(1).max(180)),
  slug: z.string().transform(normalizeText).pipe(z.string().trim().min(1).max(160)).optional(),
  summary: nullableText(1_000),
  body: nullableMarkdown(100_000),
  contentType: articleContentTypeSchema,
  mediaThumbnailUrl: nullableHttpUrl,
  sourceName: nullableText(160),
  sourceUrl: nullableHttpUrl,
  sourcePublishedAt: timestamp.nullable(),
  heroImageUrl: nullableHttpUrl,
  heroImageAlt: nullableText(300),
  heroImageAttribution: nullableText(500),
  heroImageAttributionUrl: nullableHttpUrl,
  seoTitle: nullableText(180),
  seoDescription: nullableText(320),
  isFeatured: z.boolean(),
  featuredPriority: z.number().int().min(1).max(1_000).nullable(),
  featuredStartsAt: timestamp.nullable(),
  featuredEndsAt: timestamp.nullable(),
} as const;

export const articleCreateSchema = z
  .object({
    ...editorialFields,
    slug: editorialFields.slug,
    contentType: articleContentTypeSchema.default('ARTICLE'),
    mediaThumbnailUrl: nullableHttpUrl.default(null),
    teamIds: z.array(z.uuid()).max(32).default([]),
    changeSummary: nullableText(500).optional(),
  })
  .strict()
  .superRefine(validateInputRelationships);

export const articleUpdateSchema = z
  .object(editorialFields)
  .partial()
  .extend({
    expectedVersion: z.number().int().min(1),
    changeSummary: nullableText(500).optional(),
  })
  .strict()
  .refine(
    (value) =>
      Object.keys(value).some((key) => !['expectedVersion', 'changeSummary'].includes(key)),
    'At least one editorial field is required.',
  );

export const articleTeamsUpdateSchema = z
  .object({
    expectedVersion: z.number().int().min(1),
    teamIds: z.array(z.uuid()).max(32),
    changeSummary: nullableText(500).optional(),
  })
  .strict();

export const articleVersionActionSchema = z
  .object({
    expectedVersion: z.number().int().min(1),
    changeSummary: nullableText(500).optional(),
  })
  .strict();

export const articleScheduleSchema = articleVersionActionSchema.extend({
  scheduledFor: timestamp,
});

export const articleIdParamsSchema = z.object({ articleId: z.uuid() }).strict();
export const articleRevisionParamsSchema = z
  .object({ articleId: z.uuid(), revisionId: z.uuid() })
  .strict();
export const articleSlugParamsSchema = z.object({ slug: z.string().min(1).max(160) }).strict();
export const teamArticleParamsSchema = z.object({ teamId: z.uuid() }).strict();

export const adminArticleListQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(25),
    cursor: z.uuid().optional(),
    status: articleStatusSchema.optional(),
    type: articleTypeSchema.optional(),
    contentType: articleContentTypeSchema.optional(),
    teamId: z.uuid().optional(),
    featured: z
      .enum(['true', 'false'])
      .transform((value) => value === 'true')
      .optional(),
    authorId: z.uuid().optional(),
    search: z.string().trim().min(2).max(100).optional(),
  })
  .strict();

export const publicArticleListQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(50).default(20),
    cursor: z.uuid().optional(),
    type: articleTypeSchema.optional(),
    contentType: articleContentTypeSchema.optional(),
    teamId: z.uuid().optional(),
    team: z.string().trim().toUpperCase().min(2).max(8).optional(),
    featured: z
      .enum(['true', 'false'])
      .transform((value) => value === 'true')
      .optional(),
    publishedFrom: timestamp.optional(),
    publishedTo: timestamp.optional(),
    search: z.string().trim().min(2).max(100).optional(),
  })
  .strict()
  .refine((value) => value.teamId === undefined || value.team === undefined, {
    message: 'Use either teamId or team, not both.',
  })
  .refine(
    (value) =>
      value.publishedFrom === undefined ||
      value.publishedTo === undefined ||
      new Date(value.publishedFrom) <= new Date(value.publishedTo),
    { message: 'publishedFrom must not be after publishedTo.' },
  );

export const revisionListQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(50).default(25),
    cursor: z.uuid().optional(),
  })
  .strict();

export type ArticleCreateInput = z.output<typeof articleCreateSchema>;
export type ArticleUpdateInput = z.output<typeof articleUpdateSchema>;
export type ArticleTeamsUpdateInput = z.output<typeof articleTeamsUpdateSchema>;
export type ArticleVersionActionInput = z.output<typeof articleVersionActionSchema>;
export type ArticleScheduleInput = z.output<typeof articleScheduleSchema>;
export type AdminArticleListQuery = z.output<typeof adminArticleListQuerySchema>;
export type PublicArticleListQuery = z.output<typeof publicArticleListQuerySchema>;
export type RevisionListQuery = z.output<typeof revisionListQuerySchema>;

export function normalizeMarkdown(value: string): string {
  return normalizeText(value)
    .replace(/[ \t]+$/gm, '')
    .trim();
}

function normalizeText(value: string): string {
  return value.normalize('NFC').replace(/\r\n?/g, '\n');
}

function safeMarkdown(maximum: number) {
  return z
    .string()
    .min(1)
    .max(maximum)
    .refine((value) => !hasUnsupportedControlCharacter(value), {
      message: 'Content contains unsupported control characters.',
    })
    .refine((value) => !/<\/?[A-Za-z!][^>]*>/.test(value), {
      message: 'Embedded HTML is not allowed; use Markdown only.',
    })
    .refine((value) => !/\]\(\s*(?:javascript|data):/i.test(value), {
      message: 'Markdown links may not use executable or embedded-data URL protocols.',
    })
    .refine((value) => !hasMalformedSurrogate(value), {
      message: 'Content contains malformed Unicode.',
    });
}

function hasMalformedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return true;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) return true;
  }
  return false;
}

function hasUnsupportedControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code === 0x7f || (code < 0x20 && ![0x09, 0x0a, 0x0d].includes(code))) return true;
  }
  return false;
}

function validateInputRelationships(
  input: {
    heroImageUrl: string | null;
    heroImageAlt: string | null;
    featuredStartsAt: string | null;
    featuredEndsAt: string | null;
    teamIds: string[];
  },
  context: z.RefinementCtx,
): void {
  if ((input.heroImageUrl === null) !== (input.heroImageAlt === null)) {
    context.addIssue({
      code: 'custom',
      path: ['heroImageAlt'],
      message: 'A hero image URL and meaningful alt text must be supplied together.',
    });
  }
  if (
    input.featuredStartsAt !== null &&
    input.featuredEndsAt !== null &&
    new Date(input.featuredEndsAt) <= new Date(input.featuredStartsAt)
  ) {
    context.addIssue({
      code: 'custom',
      path: ['featuredEndsAt'],
      message: 'The featured end must be after the featured start.',
    });
  }
  if (new Set(input.teamIds).size !== input.teamIds.length) {
    context.addIssue({
      code: 'custom',
      path: ['teamIds'],
      message: 'Duplicate team tags are not allowed.',
    });
  }
}
