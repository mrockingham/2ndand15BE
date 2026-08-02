import { z } from 'zod';

export const updateFavoriteTeamSchema = z
  .object({
    favoriteTeamId: z.uuid().nullable(),
  })
  .strict();
