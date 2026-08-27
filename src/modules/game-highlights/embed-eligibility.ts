/**
 * M31C: provider-neutral embed-eligibility rules -- see
 * docs/current-season-games/highlightly-highlights-2026-08-25.md, "Rights /
 * delivery model" addendum. Pure and side-effect-free: it never makes a
 * network call itself, only classifies inputs the service already fetched
 * (a sanitized HTTPS `embedUrl` and, when available, a Highlightly
 * geo-restrictions lookup) into a conservative embed decision.
 */
export type GameHighlightEmbedStatusValue =
  'ALLOWED' | 'NOT_ALLOWED' | 'GEO_RESTRICTED' | 'UNKNOWN';

export interface EmbedEligibilityGeoState {
  readonly embeddable: boolean | null;
  readonly allowedCountries: readonly string[] | null;
  readonly blockedCountries: readonly string[] | null;
}

export interface EmbedEligibilityInput {
  /** Already HTTPS-sanitized (see `sanitizeHttpsUrl`); `null` if absent/unsafe. */
  readonly embedUrl: string | null;
  /** `null` means "no geo lookup result" -- either never checked or the lookup failed. */
  readonly geoState: EmbedEligibilityGeoState | null;
  /**
   * `null` disables host allowlisting entirely (any HTTPS embed URL passes this
   * check). A non-null list is matched case-insensitively against the embed
   * URL's hostname only -- see `docs` for the tradeoff of enabling this.
   */
  readonly allowedHosts: readonly string[] | null;
}

export interface EmbedEligibilityResult {
  readonly embedStatus: GameHighlightEmbedStatusValue;
  readonly canEmbed: boolean;
}

const NOT_EMBEDDABLE: EmbedEligibilityResult = { embedStatus: 'UNKNOWN', canEmbed: false };

export function isAllowedEmbedHost(embedUrl: string, allowedHosts: readonly string[]): boolean {
  try {
    const hostname = new URL(embedUrl).hostname.toLowerCase();
    return allowedHosts.some((host) => host.toLowerCase() === hostname);
  } catch {
    return false;
  }
}

export function evaluateEmbedEligibility(input: EmbedEligibilityInput): EmbedEligibilityResult {
  // #21: fail safe even if some upstream bug ever sets canEmbed without an
  // embed URL to embed -- there is nothing here to classify as embeddable.
  if (input.embedUrl === null) return NOT_EMBEDDABLE;

  // #12: host allowlisting is optional and provider-neutral; when enabled, a
  // disallowed host is a definite "not allowed" rather than "unknown" -- the
  // policy decision, not the provider's, is what is denying it.
  if (input.allowedHosts !== null && !isAllowedEmbedHost(input.embedUrl, input.allowedHosts)) {
    return { embedStatus: 'NOT_ALLOWED', canEmbed: false };
  }

  // #9: no geo result (never checked, or the lookup failed) -- conservative
  // default, never embed.
  if (input.geoState === null) return NOT_EMBEDDABLE;

  // #8: an explicit `false`, or a missing/unrecognized restriction state, is
  // always safe-by-default. Only an explicit `true` can lead to embedding.
  if (input.geoState.embeddable === false) return { embedStatus: 'NOT_ALLOWED', canEmbed: false };
  if (input.geoState.embeddable !== true) return NOT_EMBEDDABLE;

  // #7: `embeddable: true` scoped to specific countries is not the same as
  // globally embeddable. This backend does not resolve per-viewer country in
  // M31C, so any non-empty allow/block list falls back to the external link.
  const hasCountryScoping =
    (input.geoState.allowedCountries?.length ?? 0) > 0 ||
    (input.geoState.blockedCountries?.length ?? 0) > 0;
  if (hasCountryScoping) return { embedStatus: 'GEO_RESTRICTED', canEmbed: false };

  return { embedStatus: 'ALLOWED', canEmbed: true };
}
