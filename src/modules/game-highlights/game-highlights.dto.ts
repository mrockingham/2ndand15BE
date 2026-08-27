import type {
  GameHighlightRecord,
  GameHighlightSyncStateRecord,
} from './game-highlights.repository.js';

/**
 * Public shape (M31). Never includes a provider name, provider match/highlight ID,
 * or any raw provider payload -- only the internal row's own UUID as `id`, matching
 * the established convention that internal IDs are the only identity ever exposed
 * publicly (see `game.dto.ts`).
 */
export interface PublicGameHighlightItemDto {
  readonly id: string;
  readonly title: string;
  readonly description: string | null;
  readonly highlightType: string;
  readonly thumbnailUrl: string | null;
  readonly canonicalUrl: string | null;
  readonly embedUrl: string | null;
  /**
   * M31C: the only signal the frontend needs to decide inline playback vs.
   * canonical-link fallback -- `canEmbed && embedUrl !== null`. Never derived
   * client-side from provider-specific geo/embeddable rules; always the
   * backend's own eligibility decision (see embed-eligibility.ts). Independent
   * of `embedUrl` being present: a `true` value with a `null` embedUrl cannot
   * occur (see `toPublicGameHighlightItemDto`), so the frontend check is safe
   * even without re-validating that combination itself.
   */
  readonly canEmbed: boolean;
  readonly publishedAt: string | null;
}

export interface PublicGameHighlightsDto {
  readonly gameId: string;
  readonly coverage: string;
  readonly highlights: readonly PublicGameHighlightItemDto[];
}

export function toPublicGameHighlightDto(
  gameId: string,
  highlights: readonly GameHighlightRecord[],
  state: GameHighlightSyncStateRecord | null,
  // M31C real-data finding: both real highlights checked (PHI @ NE, SEA @ TEN)
  // reported `embedStatus: 'ALLOWED'` from Highlightly's geo-restrictions check
  // yet failed to actually play ("this video ... has blocked it from display on
  // this website or application") -- a YouTube-side per-video/domain embedding
  // permission Highlightly's API never exposes. This global switch lets
  // eligibility stay computed and persisted (so it's ready to use again once
  // this is resolved) while forcing every public response to the canonical-link
  // fallback in the meantime. Defaults to `true` here (matching the eligibility
  // decision at face value) -- production wiring explicitly passes
  // `config.currentGame.embedPlaybackEnabled`, which itself defaults to `false`.
  // See docs/current-season-games/highlightly-highlights-2026-08-25.md §13.
  embedPlaybackEnabled = true,
): PublicGameHighlightsDto {
  return {
    gameId,
    coverage: highlights.length > 0 ? 'AVAILABLE' : (state?.coverage ?? 'UNKNOWN'),
    highlights: highlights.map((highlight) =>
      toPublicGameHighlightItemDto(highlight, embedPlaybackEnabled),
    ),
  };
}

function toPublicGameHighlightItemDto(
  highlight: GameHighlightRecord,
  embedPlaybackEnabled: boolean,
): PublicGameHighlightItemDto {
  return {
    id: highlight.id,
    title: highlight.title,
    description: highlight.description,
    highlightType: highlight.highlightType,
    thumbnailUrl: highlight.thumbnailUrl,
    canonicalUrl: highlight.canonicalUrl,
    embedUrl: highlight.embedUrl,
    // Fail-safe even if a future bug ever set canEmbed without an embedUrl:
    // the public contract never asserts canEmbed without something to embed.
    canEmbed: embedPlaybackEnabled && highlight.canEmbed && highlight.embedUrl !== null,
    publishedAt: highlight.publishedAt?.toISOString() ?? null,
  };
}

/**
 * Admin diagnostic shape. Mirrors Data Health's `providerMapping: { available }`
 * convention -- even this admin-only view reports counts/coverage, never the raw
 * provider highlight key or match ID.
 */
export interface AdminGameHighlightDiagnosticDto {
  readonly gameId: string;
  readonly dbHighlightCount: number;
  readonly coverage: string;
  readonly lastCheckedAt: string | null;
  readonly providerHighlightCount: number | null;
  readonly requestCount: number | null;
  readonly errorCode: string | null;
}

export function toAdminGameHighlightDiagnosticDto(
  gameId: string,
  highlights: readonly GameHighlightRecord[],
  state: GameHighlightSyncStateRecord | null,
  overrideErrorCode: string | null = null,
): AdminGameHighlightDiagnosticDto {
  return {
    gameId,
    dbHighlightCount: highlights.length,
    coverage: state?.coverage ?? 'UNKNOWN',
    lastCheckedAt: state?.lastCheckedAt?.toISOString() ?? null,
    providerHighlightCount: state?.providerCount ?? null,
    requestCount: state?.requestCount ?? null,
    errorCode: overrideErrorCode ?? state?.errorCode ?? null,
  };
}
