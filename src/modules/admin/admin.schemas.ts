import { z } from 'zod';

import { gameStatusSchema, seasonTypeSchema } from '../sports/normalized-game.js';

const nullableTrimmed = (maximum: number) => z.string().trim().min(1).max(maximum).nullable();
const optionalNullableUrl = z.url().max(2_048).nullable().optional();
const kickoffSchema = z.iso.datetime({ offset: true });

export const adminGameIdParamsSchema = z.object({ gameId: z.uuid() }).strict();

export const adminGameListQuerySchema = z
  .object({
    season: z.coerce.number().int().min(1920).max(2100).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    cursor: z.uuid().optional(),
  })
  .strict();

export const provenanceInputSchema = z
  .object({
    sourceName: z.string().trim().min(1).max(160),
    sourceUrl: optionalNullableUrl,
    externalReference: nullableTrimmed(256).optional(),
    notes: nullableTrimmed(1_000).optional(),
  })
  .strict();

const editableGameFields = {
  season: z.number().int().min(1920).max(2100),
  seasonType: seasonTypeSchema,
  week: z.number().int().min(1).max(22).nullable(),
  startTime: kickoffSchema,
  status: gameStatusSchema,
  homeTeamId: z.uuid(),
  awayTeamId: z.uuid(),
  venueName: nullableTrimmed(160),
  venueCity: nullableTrimmed(128),
  broadcastNetwork: nullableTrimmed(64),
  isNeutralSite: z.boolean(),
} as const;

export const manualGameCreateSchema = z
  .object({ ...editableGameFields, provenance: provenanceInputSchema })
  .strict()
  .refine((value) => value.homeTeamId !== value.awayTeamId, {
    path: ['awayTeamId'],
    message: 'Home and away teams must differ.',
  });

export const manualGameUpdateSchema = z
  .object(editableGameFields)
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'At least one field is required.')
  .refine(
    (value) =>
      value.homeTeamId === undefined ||
      value.awayTeamId === undefined ||
      value.homeTeamId !== value.awayTeamId,
    { path: ['awayTeamId'], message: 'Home and away teams must differ.' },
  );

export const gameOverrideInputSchema = z
  .object({
    startTime: kickoffSchema.nullable().optional(),
    status: gameStatusSchema.nullable().optional(),
    week: z.number().int().min(1).max(22).nullable().optional(),
    venueName: nullableTrimmed(160).optional(),
    venueCity: nullableTrimmed(128).optional(),
    broadcastNetwork: nullableTrimmed(64).optional(),
    isNeutralSite: z.boolean().nullable().optional(),
    publicCorrectionNote: nullableTrimmed(500).optional(),
    internalNote: nullableTrimmed(1_000).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'At least one override field is required.');

export const verificationInputSchema = z
  .object({
    sourceName: z.string().trim().min(1).max(160),
    sourceUrl: optionalNullableUrl,
    note: nullableTrimmed(1_000).optional(),
  })
  .strict();

export const scheduleImportRowSchema = z
  .object({
    season: z.number().int().min(1920).max(2100),
    seasonType: seasonTypeSchema,
    week: z.number().int().min(1).max(22).nullable(),
    startTime: kickoffSchema,
    awayTeam: z.string().trim().toUpperCase().min(2).max(8),
    homeTeam: z.string().trim().toUpperCase().min(2).max(8),
    status: gameStatusSchema,
    venueName: nullableTrimmed(160),
    venueCity: nullableTrimmed(128),
    broadcastNetwork: nullableTrimmed(64),
    isNeutralSite: z.boolean(),
    sourceName: z.string().trim().min(1).max(160),
    sourceType: z.enum(['MANUAL_IMPORT', 'OFFICIAL_WEB', 'DEVELOPMENT_FIXTURE']),
    sourceUrl: z.url().max(2_048).nullable(),
    externalReference: nullableTrimmed(256),
    notes: nullableTrimmed(1_000),
  })
  .strict()
  .refine((value) => value.homeTeam !== value.awayTeam, {
    path: ['awayTeam'],
    message: 'Home and away teams must differ.',
  });

export const scheduleImportRequestSchema = z
  .object({
    rows: z.array(scheduleImportRowSchema).min(1).max(500),
    dryRun: z.boolean().default(true),
  })
  .strict();

export const auditListQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
    cursor: z.uuid().optional(),
    action: z.string().trim().min(1).max(96).optional(),
    entityType: z.string().trim().min(1).max(64).optional(),
    entityId: z.string().trim().min(1).max(128).optional(),
  })
  .strict();

export type AdminGameListQuery = z.infer<typeof adminGameListQuerySchema>;
export type ManualGameCreateInput = z.infer<typeof manualGameCreateSchema>;
export type ManualGameUpdateInput = z.infer<typeof manualGameUpdateSchema>;
export type GameOverrideInput = z.infer<typeof gameOverrideInputSchema>;
export type VerificationInput = z.infer<typeof verificationInputSchema>;
export type ScheduleImportRow = z.infer<typeof scheduleImportRowSchema>;
export type ScheduleImportRequest = z.infer<typeof scheduleImportRequestSchema>;
export type AuditListQuery = z.infer<typeof auditListQuerySchema>;
