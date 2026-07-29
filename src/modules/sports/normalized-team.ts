import { z } from 'zod';

export const leagueSchema = z.literal('NFL');
export const conferenceSchema = z.enum(['AFC', 'NFC']);
export const divisionSchema = z.enum(['East', 'North', 'South', 'West']);
export const hexColorSchema = z.string().regex(/^#[0-9A-F]{6}$/, 'Must be an uppercase hex color');

export const normalizedTeamSchema = z.object({
  provider: z.string().min(1).max(64),
  providerTeamId: z.string().min(1).max(128),
  league: leagueSchema,
  city: z.string().min(1).max(64),
  name: z.string().min(1).max(64),
  fullName: z.string().min(1).max(128),
  abbreviation: z
    .string()
    .min(2)
    .max(8)
    .regex(/^[A-Z]+$/),
  conference: conferenceSchema,
  division: divisionSchema,
  primaryColor: hexColorSchema,
  secondaryColor: hexColorSchema,
  logoUrl: z.url().nullable(),
  logoSource: z.string().min(1).max(128).nullable(),
  isActive: z.boolean(),
});

export type NormalizedTeam = z.infer<typeof normalizedTeamSchema>;
