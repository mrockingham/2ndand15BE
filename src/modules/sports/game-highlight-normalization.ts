/**
 * Provider-neutral game-highlight shape (M31). Deliberately excludes a direct
 * media/file URL and a duration field: no provider evaluated so far (Highlightly)
 * ever supplies either, so they are not modeled until a real source populates them.
 * See docs/current-season-games/highlightly-highlights-2026-08-25.md.
 */
export type GameHighlightKind = 'GAME' | 'PLAY' | 'PLAYER' | 'OTHER';

export interface NormalizedGameHighlight {
  readonly providerHighlightKey: string;
  readonly title: string;
  readonly description: string | null;
  readonly highlightType: GameHighlightKind;
  readonly thumbnailUrl: string | null;
  readonly canonicalUrl: string | null;
  readonly embedUrl: string | null;
  readonly publishedAt: Date | null;
}

/**
 * A URL is only ever stored/returned if it is syntactically valid and `https:`.
 * This never fetches the URL -- it is a display/reference-safety check (no
 * `javascript:`/`data:`/`http:` links), not the SSRF-guarding DNS resolution the
 * news-inbox feed client performs before it actually requests a URL.
 */
export function sanitizeHttpsUrl(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' ? parsed.toString() : null;
  } catch {
    return null;
  }
}
