import { toPublicArticleListDto, toAdminArticleListDto } from '../articles/article.dto.js';
import type {
  ArticleRecord,
  PublicArticleListDto,
  AdminArticleListDto,
} from '../articles/article.dto.js';
import { effectivePublishedAt } from '../articles/article.repository.js';
import { toTeamSummary } from '../games/game.dto.js';
import type { GameTeamSummaryDto, GameWithTeams } from '../games/game.dto.js';
import type { HeroRichTextDocument } from './homepage-rich-text.js';
import type {
  HomepageHeroCtaRecord,
  HomepageHeroSlideRecord,
  HomepageHighlightCandidateRecord,
  HomepageHighlightPlacementRecord,
  HomepageHighlightSettingsRecord,
  HomepageTopStoryRecord,
} from './homepage.repository.js';
import type {
  DisplayMediaItemDto,
  GameMediaItemType,
} from '../game-media-curation/game-media-curation.dto.js';

export const MIN_ACTIVE_HERO_SLIDES_FOR_PUBLISH_READY = 3;

export interface HomepageHeroCtaDto {
  readonly id: string;
  readonly position: number;
  readonly label: string;
  readonly url: string;
  readonly variant: 'PRIMARY' | 'SECONDARY';
}

function toHeroCtaDto(cta: HomepageHeroCtaRecord): HomepageHeroCtaDto {
  return {
    id: cta.id,
    position: cta.position,
    label: cta.label,
    url: cta.url,
    variant: cta.variant,
  };
}

export interface HomepageHeroContentBlockDto {
  readonly slot: string;
  readonly content: HeroRichTextDocument;
}

/** Admin shape -- never includes creator/updater identity (matches
 * `AdminGameCuratedVideoDto`'s convention; accountability lives in
 * `AdminAuditEvent`, not this CRUD response). */
export interface AdminHeroSlideDto {
  readonly id: string;
  readonly position: number;
  readonly isActive: boolean;
  readonly imageUrl: string;
  readonly imageAlt: string | null;
  readonly imageBrightness: number;
  readonly imageContrast: number;
  readonly imageSaturation: number;
  readonly overlayOpacity: number;
  readonly focalPointX: number;
  readonly focalPointY: number;
  readonly imageScale: number;
  readonly contentBlocks: readonly HomepageHeroContentBlockDto[];
  readonly ctas: readonly HomepageHeroCtaDto[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export function toAdminHeroSlideDto(slide: HomepageHeroSlideRecord): AdminHeroSlideDto {
  return {
    id: slide.id,
    position: slide.position,
    isActive: slide.isActive,
    imageUrl: slide.imageUrl,
    imageAlt: slide.imageAlt,
    imageBrightness: slide.imageBrightness,
    imageContrast: slide.imageContrast,
    imageSaturation: slide.imageSaturation,
    overlayOpacity: slide.overlayOpacity,
    focalPointX: slide.focalPointX,
    focalPointY: slide.focalPointY,
    imageScale: slide.imageScale,
    contentBlocks: slide.contentBlocks.map((block) => ({
      slot: block.slot,
      content: block.content,
    })),
    ctas: slide.ctas.map(toHeroCtaDto),
    createdAt: slide.createdAt.toISOString(),
    updatedAt: slide.updatedAt.toISOString(),
  };
}

export interface AdminHeroListDto {
  readonly slides: readonly AdminHeroSlideDto[];
  readonly meta: {
    readonly activeCount: number;
    readonly totalCount: number;
    /** `true` once at least `MIN_ACTIVE_HERO_SLIDES_FOR_PUBLISH_READY`
     * slides are active -- advisory only, never enforced server-side (see
     * docs/homepage/homepage-cms.md "3-10 slide behavior"). */
    readonly readyForPublish: boolean;
  };
}

export function toAdminHeroListDto(slides: readonly HomepageHeroSlideRecord[]): AdminHeroListDto {
  const activeCount = slides.filter((slide) => slide.isActive).length;
  return {
    slides: slides.map(toAdminHeroSlideDto),
    meta: {
      activeCount,
      totalCount: slides.length,
      readyForPublish: activeCount >= MIN_ACTIVE_HERO_SLIDES_FOR_PUBLISH_READY,
    },
  };
}

/** Public shape -- no `isActive` (only active slides are ever returned
 * publicly), no creator/updater/timestamp fields. */
export interface PublicHeroSlideDto {
  readonly id: string;
  readonly position: number;
  readonly imageUrl: string;
  readonly imageAlt: string | null;
  readonly imageBrightness: number;
  readonly imageContrast: number;
  readonly imageSaturation: number;
  readonly overlayOpacity: number;
  readonly focalPointX: number;
  readonly focalPointY: number;
  readonly imageScale: number;
  readonly contentBlocks: readonly HomepageHeroContentBlockDto[];
  readonly ctas: readonly HomepageHeroCtaDto[];
}

export function toPublicHeroSlideDto(slide: HomepageHeroSlideRecord): PublicHeroSlideDto {
  return {
    id: slide.id,
    position: slide.position,
    imageUrl: slide.imageUrl,
    imageAlt: slide.imageAlt,
    imageBrightness: slide.imageBrightness,
    imageContrast: slide.imageContrast,
    imageSaturation: slide.imageSaturation,
    overlayOpacity: slide.overlayOpacity,
    focalPointX: slide.focalPointX,
    focalPointY: slide.focalPointY,
    imageScale: slide.imageScale,
    contentBlocks: slide.contentBlocks.map((block) => ({
      slot: block.slot,
      content: block.content,
    })),
    ctas: slide.ctas.map(toHeroCtaDto),
  };
}

export interface AdminTopStoryDto {
  readonly id: string;
  readonly position: number;
  readonly article: AdminArticleListDto;
}

export function toAdminTopStoryDto(
  topStory: HomepageTopStoryRecord,
  article: ArticleRecord,
): AdminTopStoryDto {
  return { id: topStory.id, position: topStory.position, article: toAdminArticleListDto(article) };
}

export interface PublicTopStoryDto {
  readonly id: string;
  readonly position: number;
  readonly article: PublicArticleListDto;
}

export function toPublicTopStoryDto(
  topStory: HomepageTopStoryRecord,
  article: ArticleRecord,
): PublicTopStoryDto {
  const publishedAt = effectivePublishedAt(article);
  return {
    id: topStory.id,
    position: topStory.position,
    article: toPublicArticleListDto(article, publishedAt ?? article.createdAt),
  };
}

/** Provider-neutral -- never a raw Highlightly provider ID, and `mediaType`
 * is never `'GLOBAL'` here: the homepage Highlights section only ever
 * surfaces game-specific media (see M35A spec §19-20 and
 * `HomepageService.getHighlights`). `homepageSelection` is additive (M37A) --
 * internal/debugging provenance, the public UI doesn't have to render it. */
export interface PublicHomepageHighlightDto {
  readonly gameId: string;
  readonly title: string;
  readonly thumbnailUrl: string | null;
  readonly canonicalUrl: string | null;
  readonly embedUrl: string | null;
  readonly canEmbed: boolean;
  readonly mediaType: Exclude<GameMediaItemType, 'GLOBAL'>;
  readonly awayTeam: GameTeamSummaryDto;
  readonly homeTeam: GameTeamSummaryDto;
  readonly gameDate: string | null;
  readonly homepageSelection: 'CURATED' | 'AUTOMATIC';
}

export function toPublicHomepageHighlightDto(
  game: GameWithTeams,
  item: DisplayMediaItemDto,
  homepageSelection: 'CURATED' | 'AUTOMATIC',
): PublicHomepageHighlightDto {
  if (item.mediaType === 'GLOBAL') {
    throw new Error('The homepage Highlights section never surfaces the global video.');
  }
  return {
    gameId: game.id,
    title: item.title,
    thumbnailUrl: item.thumbnailUrl,
    canonicalUrl: item.canonicalUrl,
    embedUrl: item.embedUrl,
    canEmbed: item.canEmbed,
    mediaType: item.mediaType,
    awayTeam: toTeamSummary(game.awayTeam),
    homeTeam: toTeamSummary(game.homeTeam),
    gameDate: game.startTime?.toISOString() ?? null,
    homepageSelection,
  };
}

// ---------------------------------------------------------------------------
// M37A: admin highlight curation
// ---------------------------------------------------------------------------

export interface AdminHomepageHighlightDto {
  readonly id: string;
  readonly position: number;
  readonly sourceType: 'GAME_HIGHLIGHT' | 'CURATED_GAME_VIDEO';
  readonly sourceId: string;
  readonly gameId: string;
  readonly matchup: {
    readonly awayTeam: GameTeamSummaryDto;
    readonly homeTeam: GameTeamSummaryDto;
  };
  readonly gameDate: string | null;
  /** `null` when the underlying media row has been deleted or is no longer
   * publicly eligible -- the placement row still exists (and is still
   * manageable/removable by an admin) but is currently excluded from the
   * public Homepage (see `HomepageService.getHighlights`). */
  readonly preview: {
    readonly title: string;
    readonly thumbnailUrl: string | null;
  } | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** `game` is looked up via `findGamesWithTeamsByIds` -- always resolvable in
 * practice, since a placement's `gameId` foreign key cascade-deletes the
 * placement row itself if the game is ever removed. */
export function toAdminHomepageHighlightDto(
  placement: HomepageHighlightPlacementRecord,
  game: GameWithTeams,
  preview: { readonly title: string; readonly thumbnailUrl: string | null } | null,
): AdminHomepageHighlightDto {
  return {
    id: placement.id,
    position: placement.position,
    sourceType: placement.sourceType,
    sourceId: placement.sourceId,
    gameId: placement.gameId,
    matchup: { awayTeam: toTeamSummary(game.awayTeam), homeTeam: toTeamSummary(game.homeTeam) },
    gameDate: game.startTime?.toISOString() ?? null,
    preview,
    createdAt: placement.createdAt.toISOString(),
    updatedAt: placement.updatedAt.toISOString(),
  };
}

export interface HomepageHighlightCandidateDto {
  readonly sourceType: 'GAME_HIGHLIGHT' | 'CURATED_GAME_VIDEO';
  readonly sourceId: string;
  readonly gameId: string;
  readonly matchup: {
    readonly awayTeam: GameTeamSummaryDto;
    readonly homeTeam: GameTeamSummaryDto;
  };
  readonly title: string;
  readonly thumbnailUrl: string | null;
  readonly gameDate: string | null;
  readonly isSelected: boolean;
}

export function toHomepageHighlightCandidateDto(
  candidate: HomepageHighlightCandidateRecord,
  isSelected: boolean,
): HomepageHighlightCandidateDto {
  return {
    sourceType: candidate.sourceType,
    sourceId: candidate.sourceId,
    gameId: candidate.gameId,
    matchup: {
      awayTeam: toTeamSummary(candidate.game.awayTeam),
      homeTeam: toTeamSummary(candidate.game.homeTeam),
    },
    title: candidate.title,
    thumbnailUrl: candidate.thumbnailUrl,
    gameDate: candidate.game.startTime?.toISOString() ?? null,
    isSelected,
  };
}

export interface HomepageHighlightSettingsDto {
  readonly displayLimit: number;
  readonly fillWithAutomatic: boolean;
}

export function toHomepageHighlightSettingsDto(
  settings: HomepageHighlightSettingsRecord,
): HomepageHighlightSettingsDto {
  return { displayLimit: settings.displayLimit, fillWithAutomatic: settings.fillWithAutomatic };
}

// ---------------------------------------------------------------------------
// M37A: Insight Rail
// ---------------------------------------------------------------------------

export interface HomepageInsightGameDto {
  readonly gameId: string;
  readonly startTime: string | null;
  readonly homeTeam: {
    readonly id: string;
    readonly fullName: string;
    readonly abbreviation: string;
  };
  readonly awayTeam: {
    readonly id: string;
    readonly fullName: string;
    readonly abbreviation: string;
  };
}

export interface HomepageInsightPickDto {
  readonly game: HomepageInsightGameDto;
  readonly favoriteTeam: {
    readonly id: string;
    readonly fullName: string;
    readonly abbreviation: string;
  };
  readonly favoriteProbability: number;
  readonly projectedScore: { readonly home: number; readonly away: number } | null;
  readonly projectedTotal: number | null;
}

export interface HomepageAiHubSnapshotDto {
  readonly season: number;
  readonly week: number;
  readonly seasonType: 'PRE' | 'REG' | 'POST';
  readonly strongestPick: HomepageInsightPickDto | null;
  readonly closestMatchup: HomepageInsightPickDto | null;
  readonly highestProjectedTotal: HomepageInsightPickDto | null;
}

export interface HomepageWeeklyLeaderDto {
  readonly playerId: string;
  readonly playerName: string;
  readonly team: string;
  readonly value: number;
  readonly metric: string;
  readonly week: number;
  readonly season: number;
}

export interface HomepageWeeklyLeadersDto {
  readonly season: number;
  readonly week: number;
  readonly seasonType: 'REG' | 'POST';
  readonly passing: HomepageWeeklyLeaderDto | null;
  readonly rushing: HomepageWeeklyLeaderDto | null;
  readonly receiving: HomepageWeeklyLeaderDto | null;
}

export interface HomepageInsightsDto {
  readonly aiHub: HomepageAiHubSnapshotDto | null;
  readonly weeklyLeaders: HomepageWeeklyLeadersDto | null;
}

export interface PublicHomepageLeaderPlayerDto {
  readonly id: string;
  readonly displayName: string;
  readonly position: string | null;
  readonly positionGroup: string | null;
  readonly headshotUrl: string | null;
}

export interface PublicHomepageLeaderTeamDto {
  readonly id: string;
  readonly abbreviation: string;
  readonly fullName: string;
}

export interface PublicHomepageLeaderDto {
  readonly rank: number;
  readonly player: PublicHomepageLeaderPlayerDto;
  readonly team: PublicHomepageLeaderTeamDto | null;
  readonly value: number;
}

export interface PublicHomepageLeadersDto {
  readonly season: number;
  readonly seasonType: 'REG';
  readonly passing: readonly PublicHomepageLeaderDto[];
  readonly rushing: readonly PublicHomepageLeaderDto[];
  readonly receiving: readonly PublicHomepageLeaderDto[];
}

export interface PublicHomepageDto {
  readonly heroSlides: readonly PublicHeroSlideDto[];
  readonly topStories: readonly PublicTopStoryDto[];
  readonly highlights: readonly PublicHomepageHighlightDto[];
  readonly leaders: PublicHomepageLeadersDto;
  readonly insights: HomepageInsightsDto;
}
