import { z } from 'zod';

export const candidateParamsSchema = z.object({ candidateId: z.uuid() }).strict();
export const articleMediaParamsSchema = z
  .object({ articleId: z.uuid(), mediaCandidateId: z.uuid() })
  .strict();
export const articleParamsSchema = z.object({ articleId: z.uuid() }).strict();
export const sourceParamsSchema = z.object({ sourceId: z.uuid() }).strict();
export const generateDraftSchema = z
  .object({ instruction: z.string().trim().min(1).max(500).optional() })
  .strict()
  .default({});
export const regenerateDraftSchema = z
  .object({
    expectedVersion: z.number().int().min(1),
    instruction: z.string().trim().min(1).max(500).optional(),
  })
  .strict();
export const generateBatchSchema = z
  .object({ candidateIds: z.array(z.uuid()).min(1).max(10) })
  .strict();
export const evaluateBatchSchema = z
  .object({ candidateIds: z.array(z.uuid()).min(1).max(50) })
  .strict();
export const qualityOverrideSchema = z
  .object({
    relevance: z.enum(['NFL', 'NOT_NFL', 'UNCERTAIN']),
    sufficiency: z.enum([
      'FULL_DRAFT_ELIGIBLE',
      'SHORT_BRIEF_ELIGIBLE',
      'LINK_ONLY',
      'INSUFFICIENT',
      'MANUAL_REVIEW',
    ]),
    allowDuplicate: z.boolean().default(false),
    reason: z.string().trim().min(1).max(500),
  })
  .strict();
export const coverageQuerySchema = z
  .object({ target: z.coerce.number().int().min(1).max(20).default(7) })
  .strict();
export const launchDiscoverySchema = z
  .object({
    targetPerTeam: z.number().int().min(1).max(20).default(10),
    freshnessDays: z.number().int().min(1).max(30).default(14),
    maxNewCandidates: z.number().int().min(1).max(320).default(320),
    pilot: z.boolean().default(false),
  })
  .strict();
export const editorialReviewSchema = z
  .object({ status: z.enum(['APPROVED', 'REJECTED']) })
  .strict();
const httpUrl = z
  .url()
  .max(2048)
  .refine((value) => ['http:', 'https:'].includes(new URL(value).protocol));
export const mediaCandidateSchema = z
  .object({
    type: z.enum(['YOUTUBE', 'VIDEO_EMBED', 'IMAGE', 'EXTERNAL_LINK']),
    platform: z.string().trim().min(1).max(64),
    externalId: z.string().trim().min(1).max(256).nullable(),
    url: httpUrl,
    title: z.string().trim().min(1).max(300),
    publisher: z.string().trim().min(1).max(160).nullable(),
    thumbnailUrl: httpUrl.nullable(),
    publishedAt: z.iso.datetime({ offset: true }).nullable(),
    embedAllowed: z.boolean(),
    rightsStatus: z.enum(['OWNED', 'EMBED_ALLOWED', 'LINK_ONLY', 'UNKNOWN']),
    relevanceScore: z.number().min(0).max(1),
  })
  .strict();
export const sourceRightsSchema = z
  .object({
    textUsage: z.enum(['SUMMARY_ALLOWED', 'LINK_ONLY', 'UNKNOWN']),
    imageUsage: z.enum(['OWNED', 'EMBED_ALLOWED', 'LINK_ONLY', 'UNKNOWN']),
    videoUsage: z.enum(['OWNED', 'EMBED_ALLOWED', 'LINK_ONLY', 'UNKNOWN']),
    quotationPolicy: z.enum(['SHORT_QUOTES_ONLY', 'UNKNOWN']),
    reviewRequired: z.boolean(),
    notes: z.string().trim().min(1).max(1000).nullable(),
  })
  .strict();

export type SourceRightsInput = z.output<typeof sourceRightsSchema>;
