import { z } from 'zod';

import { leagueSchema } from './normalized-team.js';

export const seasonTypeSchema = z.enum(['PRE', 'REG', 'POST']);
export const gameStatusSchema = z.enum([
  'SCHEDULED',
  'PREGAME',
  'IN_PROGRESS',
  'HALFTIME',
  'FINAL',
  'POSTPONED',
  'CANCELED',
  'SUSPENDED',
]);

export const normalizedGameSchema = z
  .object({
    provider: z.string().min(1).max(64),
    providerGameId: z.string().min(1).max(128),
    league: leagueSchema,
    season: z.number().int().min(1920).max(2100),
    seasonType: seasonTypeSchema,
    week: z.number().int().min(1).max(22).nullable(),
    startTime: z.iso.datetime({ offset: true }),
    status: gameStatusSchema,
    homeProviderTeamId: z.string().min(1).max(128),
    awayProviderTeamId: z.string().min(1).max(128),
    homeAbbreviation: z.string().trim().toUpperCase().min(2).max(16).optional(),
    awayAbbreviation: z.string().trim().toUpperCase().min(2).max(16).optional(),
    homeScore: z.number().int().min(0).nullable(),
    awayScore: z.number().int().min(0).nullable(),
    quarter: z.number().int().min(1).max(10).nullable(),
    clock: z.string().min(1).max(16).nullable(),
    venueName: z.string().min(1).max(160).nullable(),
    venueCity: z.string().min(1).max(128).nullable(),
    broadcastNetwork: z.string().min(1).max(64).nullable(),
    isNeutralSite: z.boolean(),
    providerLastUpdatedAt: z.iso.datetime({ offset: true }).nullable(),
  })
  .superRefine((game, context) => {
    if (game.homeProviderTeamId === game.awayProviderTeamId) {
      context.addIssue({
        code: 'custom',
        message: 'Home and away teams must be different.',
        path: ['awayProviderTeamId'],
      });
    }

    const hasOneScore = game.homeScore !== null || game.awayScore !== null;
    if (hasOneScore && (game.homeScore === null || game.awayScore === null)) {
      context.addIssue({
        code: 'custom',
        message: 'Home and away scores must both be present or both be null.',
        path: ['homeScore'],
      });
    }
  });

export interface GameQuery {
  readonly season?: number;
  readonly seasonType?: z.infer<typeof seasonTypeSchema>;
  readonly week?: number;
  readonly startDate?: string;
  readonly endDate?: string;
  /** Provider-owned team identity; it never crosses into public API DTOs. */
  readonly teamId?: string;
  readonly status?: z.infer<typeof gameStatusSchema>;
}

export type NormalizedGame = z.infer<typeof normalizedGameSchema>;
export type GameStatus = z.infer<typeof gameStatusSchema>;
export type SeasonType = z.infer<typeof seasonTypeSchema>;
