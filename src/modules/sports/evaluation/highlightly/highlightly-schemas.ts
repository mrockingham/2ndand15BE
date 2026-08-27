import { z } from 'zod';

const nullableString = z.string().nullable().optional();
const nullableNumber = z.number().nullable().optional();
const providerIdSchema = z.union([z.number().int().nonnegative(), z.string().min(1).max(128)]);

export const highlightlyPaginationSchema = z.object({
  totalCount: z.number().int().nonnegative(),
  offset: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
});

export const highlightlyPlanSchema = z.object({
  tier: z.string().min(1).max(128).optional(),
  message: z.string().min(1).max(1_000).optional(),
});

export const highlightlyErrorEnvelopeSchema = z.object({
  message: z.string().min(1).max(1_000).optional(),
  error: z.union([z.string().min(1).max(1_000), z.boolean()]).optional(),
  statusCode: z.number().int().min(400).max(599).optional(),
});

export const highlightlyTeamSchema = z.object({
  id: providerIdSchema,
  logo: z.url().nullable().optional(),
  name: z.string().min(1).max(128),
  displayName: z.string().min(1).max(256),
  abbreviation: z.string().min(1).max(16),
  league: z.string().min(1).max(64).optional(),
});

export const highlightlyTeamsResponseSchema = z.array(highlightlyTeamSchema);
export const highlightlyRawTeamsResponseSchema = z.array(z.unknown());

const highlightlyScoreSchema = z.object({
  current: nullableString,
  firstPeriod: nullableString,
  secondPeriod: nullableString,
  thirdPeriod: nullableString,
  fourthPeriod: nullableString,
  firstOvertimePeriod: nullableString,
  secondOvertimePeriod: nullableString,
});

const highlightlyStateSchema = z.object({
  period: z.union([z.number(), z.string()]).nullable().optional(),
  clock: z.union([z.number(), z.string()]).nullable().optional(),
  description: nullableString,
  score: highlightlyScoreSchema.nullable().optional(),
  report: nullableString,
});

export const highlightlyMatchSchema = z.object({
  id: providerIdSchema,
  round: nullableString,
  date: z.iso.datetime({ offset: true }),
  league: z.string().min(1).max(64),
  season: z.number().int().min(1920).max(2100),
  awayTeam: highlightlyTeamSchema,
  homeTeam: highlightlyTeamSchema,
  state: highlightlyStateSchema,
});

export const highlightlyMatchListResponseSchema = z.object({
  data: z.array(highlightlyMatchSchema),
  pagination: highlightlyPaginationSchema,
  plan: highlightlyPlanSchema.optional(),
});

export const highlightlyRawMatchListResponseSchema = highlightlyMatchListResponseSchema.extend({
  data: z.array(z.unknown()),
});

const highlightlyVenueSchema = z.object({
  city: nullableString,
  name: nullableString,
  state: nullableString,
});

const highlightlyStatisticSchema = z
  .object({
    name: z.string().min(1).max(256).optional(),
    displayName: z.string().min(1).max(256).optional(),
    value: z.union([z.string(), z.number(), z.boolean()]).nullable(),
    group: z.string().min(1).max(128).optional(),
    category: z.string().min(1).max(128).optional(),
  })
  .refine((statistic) => statistic.name !== undefined || statistic.displayName !== undefined, {
    message: 'Statistic requires name or displayName',
  });

const highlightlyPlayerSchema = z.object({
  id: providerIdSchema.optional(),
  name: z.string().min(1).max(256).optional(),
  fullName: z.string().min(1).max(256).optional(),
  jersey: z
    .union([z.number().int(), z.string().max(16)])
    .nullable()
    .optional(),
  position: nullableString,
  positionAbbreviation: nullableString,
});

const highlightlyPlayerProfilePositionSchema = z.object({
  main: nullableString,
  abbreviation: nullableString,
});

const highlightlyPlayerProfileDraftSchema = z.object({
  year: z.number().int().min(1900).max(2100).nullable().optional(),
  round: z.number().int().nonnegative().nullable().optional(),
  pick: z.number().int().nonnegative().nullable().optional(),
});

const highlightlyPlayerProfileSchema = z.object({
  fullName: z.string().min(1).max(256),
  birthDate: nullableString,
  birthPlace: nullableString,
  height: nullableString,
  weight: nullableString,
  jersey: z
    .union([z.number().int(), z.string().max(16)])
    .nullable()
    .optional(),
  isActive: z.boolean().nullable().optional(),
  position: highlightlyPlayerProfilePositionSchema.nullable().optional(),
  draft: highlightlyPlayerProfileDraftSchema.nullable().optional(),
  team: highlightlyTeamSchema.nullable().optional(),
});

export const highlightlyPlayerProfileResponseSchema = z
  .array(
    z.object({
      id: providerIdSchema,
      fullName: z.string().min(1).max(256),
      logo: z.url().nullable().optional(),
      profile: highlightlyPlayerProfileSchema,
    }),
  )
  .min(1);

const highlightlyInjurySchema = z.object({
  team: highlightlyTeamSchema,
  data: z.array(
    z.object({
      status: z.string().min(1).max(128),
      player: highlightlyPlayerSchema,
    }),
  ),
});

const highlightlyEventPositionSchema = z.object({
  clock: nullableString,
  period: nullableString,
  yardLine: nullableNumber,
  sideOfField: nullableString,
});

const highlightlyPlayDetailPositionSchema = z.object({
  down: nullableNumber,
  distance: nullableNumber,
  yardLine: nullableNumber,
  possessionText: nullableString,
  yardsToEndzone: nullableNumber,
});

export const highlightlyPlayDetailSchema = z.object({
  start: highlightlyPlayDetailPositionSchema,
  end: highlightlyPlayDetailPositionSchema,
  text: z.string().trim().min(1).max(4_000),
  type: z.string().trim().min(1).max(128),
  clock: z.string().trim().min(1).max(8),
  period: z.number().int().min(1).max(10),
  isPenalty: z.boolean(),
});

export const highlightlyStructuredPlaySchema = z.object({
  id: providerIdSchema.optional(),
  sequence: z.number().int().nonnegative().optional(),
  driveId: providerIdSchema.optional(),
  quarter: z.union([z.number(), z.string()]).nullable().optional(),
  clock: nullableString,
  down: nullableNumber,
  distance: nullableNumber,
  possession: nullableString,
  yardLine: nullableNumber,
  sideOfField: nullableString,
  startPosition: nullableString,
  endPosition: nullableString,
  type: nullableString,
  description: nullableString,
  yardsGained: nullableNumber,
  firstDown: z.boolean().nullable().optional(),
  scoringPlay: z.boolean().nullable().optional(),
  touchdown: z.boolean().nullable().optional(),
  passDirection: nullableString,
  passDepth: nullableString,
  rushDirection: nullableString,
  passer: highlightlyPlayerSchema.nullable().optional(),
  receiver: highlightlyPlayerSchema.nullable().optional(),
  target: highlightlyPlayerSchema.nullable().optional(),
  rusher: highlightlyPlayerSchema.nullable().optional(),
  tacklers: z.array(highlightlyPlayerSchema).nullable().optional(),
  sacks: z.array(highlightlyPlayerSchema).nullable().optional(),
  interceptions: z.array(highlightlyPlayerSchema).nullable().optional(),
  fumbles: z.array(highlightlyPlayerSchema).nullable().optional(),
  recoveries: z.array(highlightlyPlayerSchema).nullable().optional(),
  penalties: z
    .array(z.object({ description: nullableString }))
    .nullable()
    .optional(),
  kick: z.object({ description: nullableString }).nullable().optional(),
  punt: z.object({ description: nullableString }).nullable().optional(),
  review: z
    .object({ description: nullableString, overturned: z.boolean().optional() })
    .nullable()
    .optional(),
  corrected: z.boolean().nullable().optional(),
  deleted: z.boolean().nullable().optional(),
  teamStatistics: z.array(highlightlyStatisticSchema).nullable().optional(),
  playerStatistics: z.array(highlightlyStatisticSchema).nullable().optional(),
  trackingCoordinates: z
    .array(
      z.object({
        entityId: providerIdSchema,
        x: z.number(),
        y: z.number(),
        timestamp: z.union([z.number(), z.iso.datetime({ offset: true })]),
      }),
    )
    .nullable()
    .optional(),
});

export const highlightlyEventSchema = z.object({
  id: providerIdSchema.optional(),
  end: highlightlyEventPositionSchema.nullable().optional(),
  team: highlightlyTeamSchema.nullable().optional(),
  plays: z.array(z.union([z.string().min(1), highlightlyStructuredPlaySchema])).optional(),
  playDetails: z.array(highlightlyPlayDetailSchema).optional(),
  start: highlightlyEventPositionSchema.nullable().optional(),
  result: nullableString,
  description: nullableString,
  isScoringPlay: z.boolean().nullable().optional(),
});

const highlightlyTeamStatisticsSchema = z.object({
  statistics: z.array(highlightlyStatisticSchema),
});

const highlightlyBoxScorePlayerSchema = z.object({
  player: highlightlyPlayerSchema,
  statistics: z.array(highlightlyStatisticSchema),
});

const highlightlyBoxScoreTeamSchema = z.object({
  id: providerIdSchema.optional(),
  name: z.string().min(1).max(256).optional(),
  logo: z.url().nullable().optional(),
  boxScores: z.array(highlightlyBoxScorePlayerSchema).optional(),
});

export const highlightlyBoxScoreResponseSchema = z.array(
  z.object({
    team: z.object({
      id: providerIdSchema,
      name: z.string().min(1).max(256),
      logo: z.url().nullable().optional(),
      boxScores: z.array(highlightlyBoxScorePlayerSchema),
    }),
  }),
);

export const highlightlyDetailedMatchSchema = highlightlyMatchSchema.extend({
  venue: highlightlyVenueSchema.nullable().optional(),
  neutralSite: z.boolean().nullable().optional(),
  broadcast: z
    .union([z.string(), z.array(z.string())])
    .nullable()
    .optional(),
  updatedAt: z.iso.datetime({ offset: true }).nullable().optional(),
  matchStatistics: z
    .object({
      homeTeam: highlightlyTeamStatisticsSchema.optional(),
      awayTeam: highlightlyTeamStatisticsSchema.optional(),
    })
    .nullable()
    .optional(),
  injuries: z.array(highlightlyInjurySchema).nullable().optional(),
  events: z.array(highlightlyEventSchema).nullable().optional(),
  boxScores: z.array(highlightlyBoxScoreTeamSchema).nullable().optional(),
  topPerformers: z.array(highlightlyPlayerSchema).nullable().optional(),
  predictions: z.record(z.string(), z.unknown()).nullable().optional(),
});

export const highlightlyMatchDetailResponseSchema = z.array(highlightlyDetailedMatchSchema).min(1);
export const highlightlyRawMatchDetailResponseSchema = z.array(z.unknown()).min(1);

export const highlightlyStandingResponseSchema = z.object({
  leagueName: z.string().min(1).max(256),
  abbreviation: z.string().min(1).max(32),
  year: z.number().int().min(1920).max(2100),
  leagueType: z.string().min(1).max(64),
  seasonType: z.string().min(1).max(128),
  startDate: z.iso.datetime({ offset: true }),
  endDate: z.iso.datetime({ offset: true }),
  data: z.array(
    z.object({
      team: highlightlyTeamSchema,
      statistics: z.array(highlightlyStatisticSchema),
    }),
  ),
});

export const highlightlyRawStandingListResponseSchema = z.object({
  data: z.array(z.unknown()),
  pagination: highlightlyPaginationSchema,
  plan: highlightlyPlanSchema.optional(),
});

// M31: `/highlights` -- confirmed real (2026-08-25) to be a dedicated endpoint, never
// embedded in `/matches/{id}`. Every sampled NFL highlight was a single full-game
// recap sourced from the league's own YouTube channel: `url` is the canonical
// YouTube watch page, `embedUrl` is the YouTube iframe-embed URL, `imgUrl` is a
// YouTube-hosted thumbnail. No direct video file or HLS manifest URL, no duration,
// and no play/event-level identifier are ever present.
const highlightlyHighlightMatchSchema = z.object({
  id: providerIdSchema,
  league: z.string().min(1).max(64).optional(),
  season: z.number().int().optional(),
  date: nullableString,
  round: nullableString,
  homeTeam: highlightlyTeamSchema.optional(),
  awayTeam: highlightlyTeamSchema.optional(),
});

export const highlightlyHighlightSchema = z.object({
  id: providerIdSchema,
  type: z.enum(['VERIFIED', 'UNVERIFIED']).nullable().optional(),
  imgUrl: z.url().nullable().optional(),
  title: z.string().min(1).max(500),
  description: nullableString,
  url: z.url().nullable().optional(),
  embedUrl: z.url().nullable().optional(),
  channel: nullableString,
  source: nullableString,
  category: nullableString,
  match: highlightlyHighlightMatchSchema.optional(),
});

export const highlightlyHighlightsResponseSchema = z.object({
  data: z.array(highlightlyHighlightSchema),
  pagination: highlightlyPaginationSchema.optional(),
  plan: highlightlyPlanSchema.optional(),
});

export const highlightlyRawHighlightsResponseSchema = z.object({
  data: z.array(z.unknown()),
  pagination: highlightlyPaginationSchema.optional(),
  plan: highlightlyPlanSchema.optional(),
});

export const highlightlyGeoRestrictionsSchema = z.object({
  state: nullableString,
  embeddable: z.boolean().nullable().optional(),
  allowedCountries: z.array(z.string()).nullable().optional(),
  blockedCountries: z.array(z.string()).nullable().optional(),
});

export type HighlightlyGeoRestrictions = z.infer<typeof highlightlyGeoRestrictionsSchema>;

export type HighlightlyTeam = z.infer<typeof highlightlyTeamSchema>;
export type HighlightlyMatch = z.infer<typeof highlightlyMatchSchema>;
export type HighlightlyDetailedMatch = z.infer<typeof highlightlyDetailedMatchSchema>;
export type HighlightlyBoxScoreResponse = z.infer<typeof highlightlyBoxScoreResponseSchema>;
export type HighlightlyEvent = z.infer<typeof highlightlyEventSchema>;
export type HighlightlyStructuredPlay = z.infer<typeof highlightlyStructuredPlaySchema>;
export type HighlightlyPlayDetail = z.infer<typeof highlightlyPlayDetailSchema>;
export type HighlightlyMatchListResponse = z.infer<typeof highlightlyMatchListResponseSchema>;
export type HighlightlyStandingResponse = z.infer<typeof highlightlyStandingResponseSchema>;
export type HighlightlyHighlight = z.infer<typeof highlightlyHighlightSchema>;
export type HighlightlyPlayerProfileResponse = z.infer<
  typeof highlightlyPlayerProfileResponseSchema
>;
