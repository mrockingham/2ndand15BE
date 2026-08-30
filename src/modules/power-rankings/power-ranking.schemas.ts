import { z } from 'zod';

// `asOf` is editorially authored (e.g. "2026-08-30"), not machine-generated,
// so a bare ISO date is accepted alongside a full offset datetime and
// normalized to midnight UTC -- everything downstream (Date parsing, DTO
// serialization) only ever sees a valid full ISO string either way.
const timestamp = z
  .union([z.iso.datetime({ offset: true }), z.iso.date()])
  .transform((value) => (value.includes('T') ? value : `${value}T00:00:00.000Z`));
const trimmedText = (maximum: number) => z.string().trim().min(1).max(maximum);
const nullableTrimmedText = (maximum: number) => trimmedText(maximum).nullable();

export const powerRankingEditionStatusSchema = z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED']);

export const powerRankingEditionIdParamsSchema = z.object({ editionId: z.uuid() }).strict();
export const powerRankingEntryParamsSchema = z
  .object({ editionId: z.uuid(), entryId: z.uuid() })
  .strict();

export const powerRankingEditionCreateSchema = z
  .object({
    season: z.number().int().min(2000).max(2100),
    edition: z
      .string()
      .trim()
      .toLowerCase()
      .regex(
        /^[a-z0-9]+(-[a-z0-9]+)*$/,
        'edition must be a lowercase slug, e.g. "preseason" or "week-1".',
      )
      .max(64),
    title: trimmedText(180),
    subtitle: nullableTrimmedText(180).optional(),
    asOf: timestamp,
    methodology: trimmedText(20_000),
    sources: z.array(trimmedText(200)).max(50).default([]),
  })
  .strict();

export const powerRankingEditionUpdateSchema = z
  .object({
    title: trimmedText(180).optional(),
    subtitle: nullableTrimmedText(180).optional(),
    asOf: timestamp.optional(),
    methodology: trimmedText(20_000).optional(),
    sources: z.array(trimmedText(200)).max(50).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'At least one field is required.');

export const powerRankingEntryUpdateSchema = z
  .object({
    rank: z.number().int().min(1).max(32).optional(),
    previousRank: z.number().int().min(1).max(32).nullable().optional(),
    tier: trimmedText(64).optional(),
    headline: trimmedText(200).optional(),
    summary: trimmedText(5_000).optional(),
    strengths: z.array(trimmedText(300)).max(20).optional(),
    concerns: z.array(trimmedText(300)).max(20).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'At least one field is required.');

export const powerRankingReorderSchema = z
  .object({ orderedEntryIds: z.array(z.uuid()).min(1).max(32) })
  .strict();

export const publicPowerRankingsQuerySchema = z
  .object({
    season: z.coerce.number().int().min(2000).max(2100).optional(),
    edition: z.string().trim().toLowerCase().max(64).optional(),
  })
  .strict()
  .refine((value) => (value.edition === undefined ? true : value.season !== undefined), {
    message: 'season is required when edition is specified.',
  });

export const adminPowerRankingListQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(25),
    cursor: z.uuid().optional(),
    status: powerRankingEditionStatusSchema.optional(),
    season: z.coerce.number().int().min(2000).max(2100).optional(),
  })
  .strict();

// The import format's per-ranking entry. teamId is a slug-like import
// identifier ("los-angeles-rams"), never assumed to be a Team UUID -- see
// power-ranking.service.ts's team-matching logic. name/abbreviation/
// conference/division are accepted only for cross-validation against the
// canonical Team row; they are never written back to Team.
export const powerRankingImportEntrySchema = z
  .object({
    rank: z.number().int().min(1).max(32),
    teamId: z.string().trim().min(1).max(64),
    team: z.string().trim().min(1).max(128),
    abbreviation: z.string().trim().min(1).max(8),
    conference: z.string().trim().min(1).max(16),
    division: z.string().trim().min(1).max(16),
    tier: trimmedText(64),
    headline: trimmedText(200),
    summary: trimmedText(5_000),
    strengths: z.array(trimmedText(300)).max(20).default([]),
    concerns: z.array(trimmedText(300)).max(20).default([]),
    previousRank: z.number().int().min(1).max(32).nullable().optional(),
    movement: z.number().int().optional(),
  })
  .strict();

export const powerRankingImportDocumentSchema = z
  .object({
    title: trimmedText(180),
    season: z.number().int().min(2000).max(2100),
    edition: z
      .string()
      .trim()
      .toLowerCase()
      .regex(
        /^[a-z0-9]+(-[a-z0-9]+)*$/,
        'edition must be a lowercase slug, e.g. "preseason" or "week-1".',
      )
      .max(64),
    asOf: timestamp,
    methodology: trimmedText(20_000),
    sources: z.array(trimmedText(200)).max(50).default([]),
    subtitle: nullableTrimmedText(180).optional(),
    rankings: z.array(powerRankingImportEntrySchema).min(1).max(32),
  })
  .strict();

export const powerRankingImportRequestSchema = z
  .object({
    data: powerRankingImportDocumentSchema,
    mode: z.enum(['PREVIEW', 'UPSERT']),
    publish: z.boolean().default(false),
  })
  .strict();

export type PowerRankingEditionCreateInput = z.output<typeof powerRankingEditionCreateSchema>;
export type PowerRankingEditionUpdateInput = z.output<typeof powerRankingEditionUpdateSchema>;
export type PowerRankingEntryUpdateInput = z.output<typeof powerRankingEntryUpdateSchema>;
export type PowerRankingReorderInput = z.output<typeof powerRankingReorderSchema>;
export type PublicPowerRankingsQuery = z.output<typeof publicPowerRankingsQuerySchema>;
export type AdminPowerRankingListQuery = z.output<typeof adminPowerRankingListQuerySchema>;
export type PowerRankingImportEntry = z.output<typeof powerRankingImportEntrySchema>;
export type PowerRankingImportDocument = z.output<typeof powerRankingImportDocumentSchema>;
export type PowerRankingImportRequest = z.output<typeof powerRankingImportRequestSchema>;
