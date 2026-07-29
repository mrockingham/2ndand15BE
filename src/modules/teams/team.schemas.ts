import { z } from 'zod';

export const teamIdParamsSchema = z.object({
  teamId: z.uuid(),
});
