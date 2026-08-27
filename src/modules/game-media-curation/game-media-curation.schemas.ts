import { z } from 'zod';

import { seasonTypeSchema } from '../sports/normalized-game.js';

/** Matches the article-module convention -- normalizes line endings/Unicode
 * form before length validation, never accepts raw HTML/markup. */
function normalizeText(value: string): string {
  return value.normalize('NFC').replace(/\r\n?/g, '\n').trim();
}

const requiredText = (maximum: number) =>
  z.string().transform(normalizeText).pipe(z.string().min(1).max(maximum));

const nullableText = (maximum: number) =>
  z.string().transform(normalizeText).pipe(z.string().min(1).max(maximum)).nullable();

/**
 * HTTPS-only (never `http:`/`javascript:`/`data:`/`file:`), bounded length.
 * `z.url()` alone would accept any syntactically valid URL scheme, so the
 * explicit protocol refine is what actually enforces "HTTPS or reject" --
 * matching the `httpUrl` convention in `article.schemas.ts` (which allows
 * both http/https; this module intentionally requires https only). A raw
 * `<iframe>` string is never a valid URL, so `z.url()` rejects it before the
 * refine ever runs -- no separate "no HTML" check is needed.
 */
const httpsUrl = (maximum = 2_048) =>
  z
    .url()
    .max(maximum)
    .refine(
      (value) => {
        // Zod runs every chained check regardless of whether an earlier one
        // already failed, so `value` may not be a parseable URL at all here
        // (e.g. raw `<iframe>` markup) -- `new URL()` throws in that case
        // rather than returning false, so it must be guarded explicitly.
        try {
          return new URL(value).protocol === 'https:';
        } catch {
          return false;
        }
      },
      { message: 'Only HTTPS URLs are allowed.' },
    );
const nullableHttpsUrl = (maximum = 2_048) => httpsUrl(maximum).nullable();

export const gameMediaGameIdParamsSchema = z.object({ gameId: z.uuid() }).strict();
export const gameMediaVideoIdParamsSchema = z.object({ videoId: z.uuid() }).strict();

export const gameMediaWeekQuerySchema = z
  .object({
    season: z.coerce.number().int().min(1920).max(2100),
    seasonType: seasonTypeSchema,
    week: z.coerce.number().int().min(1).max(22).optional(),
  })
  .strict();
export type GameMediaWeekQuery = z.infer<typeof gameMediaWeekQuerySchema>;

const curatedVideoFields = {
  title: requiredText(200),
  embedUrl: httpsUrl(2_048),
  canonicalUrl: nullableHttpsUrl(2_048),
  thumbnailUrl: nullableHttpsUrl(2_048),
  sourceLabel: nullableText(80),
} as const;

export const createCuratedVideoSchema = z
  .object({
    ...curatedVideoFields,
    canonicalUrl: curatedVideoFields.canonicalUrl.default(null),
    thumbnailUrl: curatedVideoFields.thumbnailUrl.default(null),
    sourceLabel: curatedVideoFields.sourceLabel.default(null),
  })
  .strict();
export type CreateCuratedVideoInput = z.infer<typeof createCuratedVideoSchema>;

export const updateCuratedVideoSchema = z
  .object(curatedVideoFields)
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'At least one field is required.');
export type UpdateCuratedVideoInput = z.infer<typeof updateCuratedVideoSchema>;

export const reorderCuratedVideosSchema = z
  .object({ videoIds: z.array(z.uuid()).min(1).max(4) })
  .strict();
export type ReorderCuratedVideosInput = z.infer<typeof reorderCuratedVideosSchema>;

/** M32B: identical field set/validators to `createCuratedVideoSchema` --
 * deliberately reusing `curatedVideoFields` rather than re-declaring the
 * HTTPS/host/length rules a second time. Kept as its own named schema/type
 * because the global-video endpoint is a conceptually distinct contract
 * (there is no `gameId`/`position` here at all). */
export const setGlobalGameCenterVideoSchema = z
  .object({
    ...curatedVideoFields,
    canonicalUrl: curatedVideoFields.canonicalUrl.default(null),
    thumbnailUrl: curatedVideoFields.thumbnailUrl.default(null),
    sourceLabel: curatedVideoFields.sourceLabel.default(null),
  })
  .strict();
export type SetGlobalGameCenterVideoInput = z.infer<typeof setGlobalGameCenterVideoSchema>;
