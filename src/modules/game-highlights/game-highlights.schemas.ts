import { z } from 'zod';

export const gameHighlightsGameIdParamsSchema = z.object({ gameId: z.uuid() }).strict();

export type GameHighlightsGameIdParams = z.output<typeof gameHighlightsGameIdParamsSchema>;
