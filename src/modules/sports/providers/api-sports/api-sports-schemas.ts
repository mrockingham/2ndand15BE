import { z } from 'zod';

export const apiSportsEnvelopeSchema = z
  .object({
    get: z.string().min(1),
    parameters: z.record(z.string(), z.unknown()),
    errors: z.union([z.array(z.unknown()), z.record(z.string(), z.unknown())]),
    results: z.number().int().min(0),
    paging: z
      .object({ current: z.number().int().positive(), total: z.number().int().min(0) })
      .optional(),
    response: z.array(z.unknown()),
  })
  .superRefine((envelope, context) => {
    if (envelope.results !== envelope.response.length) {
      context.addIssue({
        code: 'custom',
        path: ['results'],
        message: 'Result count does not match the response record count',
      });
    }
  });

export const apiSportsTeamSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1).max(128),
  code: z.string().min(1).max(8).nullable(),
  city: z.string().min(1).max(128).nullable(),
  logo: z.url().nullable(),
  country: z.object({
    name: z.string().min(1).max(128),
    code: z.string().min(1).max(8).nullable(),
    flag: z.url().nullable(),
  }),
});

const apiSportsGameTeamSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1).max(128),
  logo: z.url().nullable(),
});

const apiSportsScoreSchema = z.object({
  quarter_1: z.number().int().min(0).nullable(),
  quarter_2: z.number().int().min(0).nullable(),
  quarter_3: z.number().int().min(0).nullable(),
  quarter_4: z.number().int().min(0).nullable(),
  overtime: z.number().int().min(0).nullable(),
  total: z.number().int().min(0).nullable(),
});

export const apiSportsGameSchema = z.object({
  game: z.object({
    id: z.number().int().positive(),
    stage: z.string().min(1).max(64),
    week: z.string().min(1).max(64).nullable(),
    date: z.object({
      timezone: z.string().min(1).max(64),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      time: z.string().regex(/^\d{2}:\d{2}$/),
      timestamp: z.number().int().nonnegative(),
    }),
    venue: z.object({
      name: z.string().min(1).max(160).nullable(),
      city: z.string().min(1).max(128).nullable(),
    }),
    status: z.object({
      short: z.string().min(1).max(16),
      long: z.string().min(1).max(64),
      timer: z.union([z.string().max(16), z.number().nonnegative()]).nullable(),
    }),
  }),
  league: z.object({
    id: z.number().int().positive(),
    name: z.string().min(1).max(64),
    season: z.string().regex(/^\d{4}$/),
    logo: z.url().nullable(),
    country: z.object({
      name: z.string().min(1).max(128),
      code: z.string().min(1).max(8).nullable(),
      flag: z.url().nullable(),
    }),
  }),
  teams: z.object({ home: apiSportsGameTeamSchema, away: apiSportsGameTeamSchema }),
  scores: z.object({ home: apiSportsScoreSchema, away: apiSportsScoreSchema }),
});

export type ApiSportsTeam = z.infer<typeof apiSportsTeamSchema>;
export type ApiSportsGame = z.infer<typeof apiSportsGameSchema>;
