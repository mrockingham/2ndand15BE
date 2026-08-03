import { z } from 'zod';

import { normalizeMarkdown } from '../articles/article.schemas.js';

export const newsSourceKindSchema = z.enum(['RSS', 'ATOM', 'MANUAL_ONLY']);
export const newsSourceStatusSchema = z.enum(['ACTIVE', 'PAUSED', 'DISABLED', 'ERROR']);
export const newsCandidateStatusSchema = z.enum([
  'NEW',
  'REVIEWING',
  'SAVED',
  'CONVERTED',
  'DISMISSED',
]);

const text = (maximum: number) =>
  z
    .string()
    .transform(normalizeText)
    .pipe(
      z
        .string()
        .trim()
        .min(1)
        .max(maximum)
        .refine(
          (value) => !hasUnsupportedText(value),
          'Text contains malformed Unicode or unsupported control characters.',
        ),
    );
const nullableText = (maximum: number) => text(maximum).nullable();
const httpUrl = z
  .url()
  .max(2_048)
  .refine((value) => {
    const parsed = new URL(value);
    return ['http:', 'https:'].includes(parsed.protocol) && !parsed.username && !parsed.password;
  }, 'Only HTTP and HTTPS URLs without credentials are allowed.');
const nullableHttpUrl = httpUrl.nullable();
const timestamp = z.iso.datetime({ offset: true });
const nullableTimestamp = timestamp.nullable();

export const newsSourceCreateSchema = z
  .object({
    name: text(160),
    slug: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      .max(96),
    kind: newsSourceKindSchema,
    status: newsSourceStatusSchema.exclude(['ERROR']).default('PAUSED'),
    feedUrl: nullableHttpUrl,
    siteUrl: httpUrl,
    publisherName: text(160),
    defaultTeamId: z.uuid().nullable().default(null),
    isOfficialLeague: z.boolean().default(false),
    isOfficialTeam: z.boolean().default(false),
    allowsDescriptionUse: z.boolean().default(false),
    notes: nullableText(1_000).default(null),
  })
  .strict()
  .superRefine(validateSourceRelationships);

export const newsSourceUpdateSchema = z
  .object({
    name: text(160).optional(),
    slug: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      .max(96)
      .optional(),
    kind: newsSourceKindSchema.optional(),
    status: newsSourceStatusSchema.exclude(['ERROR']).optional(),
    feedUrl: nullableHttpUrl.optional(),
    siteUrl: httpUrl.optional(),
    publisherName: text(160).optional(),
    defaultTeamId: z.uuid().nullable().optional(),
    isOfficialLeague: z.boolean().optional(),
    isOfficialTeam: z.boolean().optional(),
    allowsDescriptionUse: z.boolean().optional(),
    notes: nullableText(1_000).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'At least one source field is required.');

export const newsSourceListQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(25),
    cursor: z.uuid().optional(),
    status: newsSourceStatusSchema.optional(),
    kind: newsSourceKindSchema.optional(),
  })
  .strict();

export const newsCandidateListQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(25),
    cursor: z.uuid().optional(),
    status: newsCandidateStatusSchema.optional(),
    sourceId: z.uuid().optional(),
    teamId: z.uuid().optional(),
    publishedFrom: timestamp.optional(),
    publishedTo: timestamp.optional(),
    search: z.string().trim().min(2).max(100).optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.publishedFrom === undefined ||
      value.publishedTo === undefined ||
      new Date(value.publishedFrom) <= new Date(value.publishedTo),
    'publishedFrom must not be after publishedTo.',
  );

export const manualCandidateCreateSchema = z
  .object({
    url: httpUrl,
    headline: text(300),
    sourceName: text(160),
    sourceId: z.uuid().nullable().default(null),
    sourceDescription: nullableText(2_000).default(null),
    sourceAuthor: nullableText(160).default(null),
    sourcePublishedAt: nullableTimestamp.default(null),
    suggestedTeamIds: z.array(z.uuid()).max(32).default([]),
  })
  .strict()
  .refine((value) => new Set(value.suggestedTeamIds).size === value.suggestedTeamIds.length, {
    path: ['suggestedTeamIds'],
    message: 'Duplicate team suggestions are not allowed.',
  });

export const newsCandidateDismissSchema = z.object({ reason: text(500) }).strict();

export const newsCandidateActionSchema = z.object({}).strict();

const nullableMarkdown = z
  .string()
  .transform(normalizeMarkdown)
  .pipe(
    z
      .string()
      .min(1)
      .max(2_000)
      .refine((value) => !/<\/?[A-Za-z!][^>]*>/.test(value), 'Embedded HTML is not allowed.')
      .refine(
        (value) => !/\]\(\s*(?:javascript|data):/i.test(value),
        'Unsafe links are not allowed.',
      ),
  )
  .nullable();

export const newsCandidateConvertSchema = z
  .object({
    title: text(180),
    slug: z.string().trim().min(1).max(160).optional(),
    originalSummary: text(1_000),
    originalCommentary: nullableMarkdown.default(null),
    confirmedTeamIds: z.array(z.uuid()).max(32).default([]),
    heroImageUrl: nullableHttpUrl.default(null),
    heroImageAlt: nullableText(300).default(null),
    heroImageAttribution: nullableText(500).default(null),
    heroImageAttributionUrl: nullableHttpUrl.default(null),
    changeSummary: nullableText(500).default(null),
  })
  .strict()
  .superRefine((value, context) => {
    if ((value.heroImageUrl === null) !== (value.heroImageAlt === null)) {
      context.addIssue({
        code: 'custom',
        path: ['heroImageAlt'],
        message: 'Hero image URL and alt text must be supplied together.',
      });
    }
    if (new Set(value.confirmedTeamIds).size !== value.confirmedTeamIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['confirmedTeamIds'],
        message: 'Duplicate team tags are not allowed.',
      });
    }
  });

export const sourceIdParamsSchema = z.object({ sourceId: z.uuid() }).strict();
export const candidateIdParamsSchema = z.object({ candidateId: z.uuid() }).strict();

export type NewsSourceCreateInput = z.output<typeof newsSourceCreateSchema>;
export type NewsSourceUpdateInput = z.output<typeof newsSourceUpdateSchema>;
export type NewsSourceListQuery = z.output<typeof newsSourceListQuerySchema>;
export type NewsCandidateListQuery = z.output<typeof newsCandidateListQuerySchema>;
export type ManualCandidateCreateInput = z.output<typeof manualCandidateCreateSchema>;
export type NewsCandidateDismissInput = z.output<typeof newsCandidateDismissSchema>;
export type NewsCandidateConvertInput = z.output<typeof newsCandidateConvertSchema>;

function validateSourceRelationships(
  value: { kind: z.output<typeof newsSourceKindSchema>; feedUrl: string | null },
  context: z.RefinementCtx,
): void {
  if (value.kind === 'MANUAL_ONLY' && value.feedUrl !== null) {
    context.addIssue({
      code: 'custom',
      path: ['feedUrl'],
      message: 'Manual-only sources cannot have feed URLs.',
    });
  }
  if (value.kind !== 'MANUAL_ONLY' && value.feedUrl === null) {
    context.addIssue({
      code: 'custom',
      path: ['feedUrl'],
      message: 'RSS and Atom sources require a feed URL.',
    });
  }
}

function normalizeText(value: string): string {
  return value.normalize('NFC').replace(/\r\n?/g, '\n').trim();
}

function hasUnsupportedText(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code === 0x7f || (code < 0x20 && ![0x09, 0x0a, 0x0d].includes(code))) return true;
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return true;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}
