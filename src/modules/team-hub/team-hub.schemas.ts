import { z } from 'zod';

const season = z.coerce.number().int().min(1920).max(2100);
const position = z
  .string()
  .trim()
  .min(1)
  .max(24)
  .transform((value) => value.toUpperCase());

export const teamHubParamsSchema = z.object({ teamId: z.uuid() });

export const teamRosterQuerySchema = z.object({
  season,
  position: position.optional(),
  positionGroup: position.optional(),
  search: z.string().trim().min(2).max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().trim().min(1).max(1024).optional(),
});

export const teamStatLeadersQuerySchema = z.object({
  season,
  metric: z.string().trim().min(1).max(64),
  seasonType: z.enum(['REG', 'POST', 'REG_POST']).default('REG'),
  position: position.optional(),
  positionGroup: position.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().trim().min(1).max(1024).optional(),
});

export type TeamRosterQuery = z.infer<typeof teamRosterQuerySchema>;
export type TeamStatLeadersQuery = z.infer<typeof teamStatLeadersQuerySchema>;
