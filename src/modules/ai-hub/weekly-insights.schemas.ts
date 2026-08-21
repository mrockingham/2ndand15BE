import { z } from 'zod';
export const weeklyInsightsQuerySchema = z.object({
  season: z.coerce.number().int().min(2020).max(2100),
  seasonType: z.enum(['PRE', 'REG', 'POST']),
  week: z.coerce.number().int().min(1).max(25),
  teamId: z.uuid().optional(),
  top: z.coerce.number().int().min(1).max(5).default(5),
});
