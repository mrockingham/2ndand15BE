import { z } from 'zod';

const uuid = z.uuid();
const httpsUrl = z
  .url()
  .trim()
  .max(2048)
  .refine((value) => new URL(value).protocol === 'https:', 'URL must use HTTPS.');

export const teamHomepageParamsSchema = z.object({ teamId: uuid });
export const teamHomepagePlacementParamsSchema = z.object({
  teamId: uuid,
  placementId: uuid,
});

export const updateTeamBannerSchema = z
  .object({
    imageUrl: httpsUrl.nullable().optional(),
    focalX: z.number().int().min(0).max(100).optional(),
    focalY: z.number().int().min(0).max(100).optional(),
    overlayOpacity: z.number().int().min(0).max(100).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'At least one field is required.');

export const teamHomepageCandidatesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(25),
  cursor: z.coerce.number().int().min(0).optional(),
});

export const addTeamEditorialPlacementSchema = z
  .object({
    sourceType: z.enum(['ARTICLE', 'VIDEO']),
    sourceId: uuid,
    mediaSourceType: z.enum(['GAME_HIGHLIGHT', 'CURATED_GAME_VIDEO']).optional(),
    isLeadReplacement: z.boolean().default(false),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.sourceType === 'ARTICLE' && value.mediaSourceType !== undefined) {
      context.addIssue({
        code: 'custom',
        path: ['mediaSourceType'],
        message: 'Article placements cannot specify mediaSourceType.',
      });
    }
    if (value.sourceType === 'ARTICLE' && value.isLeadReplacement) {
      context.addIssue({
        code: 'custom',
        path: ['isLeadReplacement'],
        message: 'Only video placements can replace the lead article.',
      });
    }
    if (value.sourceType === 'VIDEO' && value.mediaSourceType === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['mediaSourceType'],
        message: 'Video placements require mediaSourceType.',
      });
    }
  });

export const updateTeamEditorialPlacementSchema = z
  .object({ isLeadReplacement: z.boolean() })
  .strict();

export const reorderTeamHomepagePlacementsSchema = z
  .object({ placementIds: z.array(uuid).max(10) })
  .strict()
  .refine((value) => new Set(value.placementIds).size === value.placementIds.length, {
    path: ['placementIds'],
    message: 'Placement IDs must be unique.',
  });

export const addTeamHighlightPlacementSchema = z
  .object({
    sourceType: z.enum(['GAME_HIGHLIGHT', 'CURATED_GAME_VIDEO']),
    sourceId: uuid,
  })
  .strict();

export const updateTeamHighlightSettingsSchema = z
  .object({
    displayLimit: z.number().int().min(3).max(10),
    fillWithAutomatic: z.boolean(),
  })
  .strict();

export type UpdateTeamBannerInput = z.infer<typeof updateTeamBannerSchema>;
export type TeamHomepageCandidatesQuery = z.infer<typeof teamHomepageCandidatesQuerySchema>;
export type AddTeamEditorialPlacementInput = z.infer<typeof addTeamEditorialPlacementSchema>;
export type UpdateTeamEditorialPlacementInput = z.infer<typeof updateTeamEditorialPlacementSchema>;
export type ReorderTeamHomepagePlacementsInput = z.infer<
  typeof reorderTeamHomepagePlacementsSchema
>;
export type AddTeamHighlightPlacementInput = z.infer<typeof addTeamHighlightPlacementSchema>;
export type UpdateTeamHighlightSettingsInput = z.infer<typeof updateTeamHighlightSettingsSchema>;
