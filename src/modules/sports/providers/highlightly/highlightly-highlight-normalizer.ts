import type { HighlightlyHighlight } from '../../evaluation/highlightly/highlightly-schemas.js';
import { sanitizeHttpsUrl, type NormalizedGameHighlight } from '../../game-highlight-normalization.js';

const MAX_TITLE_LENGTH = 500;
const MAX_DESCRIPTION_LENGTH = 2_000;

/**
 * Real Highlightly `/highlights` data (evaluated 2026-08-25) is, for every NFL game
 * sampled, a single full-game recap video sourced from the league's own YouTube
 * channel -- never a play- or player-specific clip, and Highlightly's own `category`
 * field is a uniform "other" that carries no useful signal. `highlightType` is
 * therefore always `GAME` here rather than mapped from that field. Highlightly
 * never supplies a highlight-level publish timestamp (only the game's kickoff
 * `match.date`, which is not this highlight's own publish time), so `publishedAt`
 * is always null for this provider.
 */
export function normalizeHighlightlyHighlight(raw: HighlightlyHighlight): NormalizedGameHighlight {
  return {
    providerHighlightKey: String(raw.id),
    title: raw.title.trim().slice(0, MAX_TITLE_LENGTH),
    description: normalizeText(raw.description, MAX_DESCRIPTION_LENGTH),
    highlightType: 'GAME',
    thumbnailUrl: sanitizeHttpsUrl(raw.imgUrl ?? null),
    canonicalUrl: sanitizeHttpsUrl(raw.url ?? null),
    embedUrl: sanitizeHttpsUrl(raw.embedUrl ?? null),
    publishedAt: null,
  };
}

function normalizeText(value: string | null | undefined, max: number): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed.slice(0, max);
}
