import { z } from 'zod';

const season = z.coerce.number().int().min(1920).max(2100);
const metric = z.string().trim().min(1).max(64);
const position = z
  .string()
  .trim()
  .min(1)
  .max(24)
  .transform((value) => value.toUpperCase());
const cursor = z.string().trim().min(1).max(1024);

export const seasonLeadersQuerySchema = z.object({
  season,
  metric,
  seasonType: z.enum(['REG', 'POST', 'REG_POST']).default('REG'),
  position: position.optional(),
  positionGroup: position.optional(),
  teamId: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: cursor.optional(),
});

export const weeklyLeadersQuerySchema = z.object({
  season,
  week: z.coerce.number().int().min(1).max(22),
  metric,
  seasonType: z.enum(['REG', 'POST']).default('REG'),
  position: position.optional(),
  positionGroup: position.optional(),
  teamId: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: cursor.optional(),
});

export const recentPerformanceQuerySchema = z.object({
  playerId: z.uuid(),
  metric,
  season: season.optional(),
  seasonType: z.enum(['REG', 'POST']).optional(),
  games: z.coerce.number().int().min(1).max(20).default(5),
});

export type SeasonLeadersQuery = z.infer<typeof seasonLeadersQuerySchema>;
export type WeeklyLeadersQuery = z.infer<typeof weeklyLeadersQuerySchema>;
export type RecentPerformanceQuery = z.infer<typeof recentPerformanceQuerySchema>;
