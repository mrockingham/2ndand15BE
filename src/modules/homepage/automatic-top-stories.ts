import { effectivePublishedAt } from '../articles/article.repository.js';
import type { ArticleRecord } from '../articles/article.dto.js';

/**
 * M42A: Top Stories automatic fallback. Explicit admin curation is always
 * authoritative and this never reorders or replaces a curated row -- it only
 * pads the list, the same way `HomepageService.getHighlights` already pads
 * curated highlight placements with automatic recency-based fill (M37A).
 *
 * Ranking principles (ticket order, highest priority first):
 *  1. explicit editorial curation -- out of scope here, handled by the caller
 *  2. freshness -- articles are walked in `effectivePublishedAt` descending
 *     order and this function never reorders that walk; a newer article is
 *     never passed over in favor of an older one to improve source/content
 *     balance.
 *  3. ARTICLE preference -- a soft cap limits how many VIDEO/HIGHLIGHT items
 *     the automatic pool contributes.
 *  4. source diversity -- a soft cap limits repeats of the same
 *     `sourceName` (staff-written articles have `sourceName: null` and are
 *     never capped against each other).
 * When the freshness-ordered pool can't satisfy both soft caps and the
 * requested count, remaining slots are filled by pure freshness rather than
 * left empty or backfilled with stale material -- soft targets never win
 * over having enough stories.
 */

const MAX_AUTOMATIC_VIDEO_ITEMS = 2;
const MAX_AUTOMATIC_ITEMS_PER_SOURCE = 2;

export function selectAutomaticTopStories(
  pool: readonly ArticleRecord[],
  excludeArticleIds: ReadonlySet<string>,
  count: number,
): readonly ArticleRecord[] {
  if (count <= 0) return [];

  const eligible = pool
    .filter((article) => !excludeArticleIds.has(article.id))
    .map((article) => ({ article, publishedAt: effectivePublishedAt(article) }))
    .filter(
      (entry): entry is { article: ArticleRecord; publishedAt: Date } => entry.publishedAt !== null,
    )
    .sort((left, right) => right.publishedAt.getTime() - left.publishedAt.getTime())
    .map((entry) => entry.article);

  const picks: ArticleRecord[] = [];
  const sourceCounts = new Map<string, number>();
  let videoLikeCount = 0;

  for (const article of eligible) {
    if (picks.length >= count) break;
    const isVideoLike = article.contentType !== 'ARTICLE';
    if (isVideoLike && videoLikeCount >= MAX_AUTOMATIC_VIDEO_ITEMS) continue;
    const sourceKey = article.sourceName;
    if (sourceKey !== null) {
      const used = sourceCounts.get(sourceKey) ?? 0;
      if (used >= MAX_AUTOMATIC_ITEMS_PER_SOURCE) continue;
      sourceCounts.set(sourceKey, used + 1);
    }
    if (isVideoLike) videoLikeCount += 1;
    picks.push(article);
  }

  if (picks.length < count) {
    const pickedIds = new Set(picks.map((article) => article.id));
    for (const article of eligible) {
      if (picks.length >= count) break;
      if (pickedIds.has(article.id)) continue;
      picks.push(article);
      pickedIds.add(article.id);
    }
  }

  return picks;
}
