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
 * `HomepageService.getHighlights`). */
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
}

export function toPublicHomepageHighlightDto(
  game: GameWithTeams,
  item: DisplayMediaItemDto,
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
  };
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
}
