import { z } from 'zod';
export const predictionIdParamsSchema = z.strictObject({ predictionId: z.uuid() });
export const predictionGameParamsSchema = z.strictObject({ gameId: z.uuid() });
export const predictionListSchema = z.object({
  season: z.coerce.number().int().min(2020).max(2100).optional(),
  seasonType: z.enum(['PRE', 'REG', 'POST']).optional(),
  week: z.coerce.number().int().min(1).max(25).optional(),
  teamId: z.uuid().optional(),
  status: z.enum(['UPCOMING', 'COMPLETED']).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export const predictionGenerationSchema = z
  .strictObject({
    gameId: z.uuid().optional(),
    season: z.number().int().min(2020).max(2100).optional(),
    seasonType: z.enum(['PRE', 'REG', 'POST']).optional(),
    week: z.number().int().min(1).max(25).nullable().optional(),
    dryRun: z.boolean().default(true),
    retrospective: z.boolean().default(false),
    includeAiExplanation: z.boolean().default(false),
  })
  .superRefine((value, context) => {
    if (
      value.gameId === undefined &&
      (value.season === undefined || value.seasonType === undefined)
    )
      context.addIssue({ code: 'custom', message: 'Provide gameId or season and seasonType.' });
  });
