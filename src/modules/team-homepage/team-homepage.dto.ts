import type { PublicArticleListDto } from '../articles/article.dto.js';
import type { DisplayMediaItemDto } from '../game-media-curation/game-media-curation.dto.js';

export type TeamHomepageMediaSourceType = 'GAME_HIGHLIGHT' | 'CURATED_GAME_VIDEO';

export interface TeamHomepageBannerDto {
  readonly imageUrl: string | null;
  readonly focalX: number;
  readonly focalY: number;
  readonly overlayOpacity: number;
}

export interface TeamHomepageVideoDto {
  readonly type: 'VIDEO';
  readonly id: string;
  readonly gameId: string;
  readonly title: string;
  readonly thumbnailUrl: string | null;
  readonly canonicalUrl: string | null;
  readonly embedUrl: string | null;
  readonly canEmbed: boolean;
  readonly publishedAt: string | null;
}

export interface TeamHomepageArticleDto {
  readonly type: 'ARTICLE';
  readonly article: PublicArticleListDto;
}

export type TeamHomepageEditorialItemDto = TeamHomepageArticleDto | TeamHomepageVideoDto;

export interface PublicTeamHomepageDto {
  readonly banner: TeamHomepageBannerDto;
  readonly editorial: {
    readonly featuredItem: TeamHomepageEditorialItemDto | null;
    readonly supportingItems: readonly TeamHomepageEditorialItemDto[];
  };
  readonly highlights: readonly TeamHomepageVideoDto[];
}

export interface TeamHomepageConfigRecord {
  readonly bannerImageUrl: string | null;
  readonly bannerFocalX: number;
  readonly bannerFocalY: number;
  readonly bannerOverlayOpacity: number;
}

export interface TeamHomepagePlacementRecord {
  readonly id: string;
  readonly teamId: string;
  readonly sourceType: 'ARTICLE' | 'VIDEO';
  readonly sourceId: string;
  readonly mediaSourceType: TeamHomepageMediaSourceType | null;
  readonly gameId: string | null;
  readonly position: number;
  readonly isLeadReplacement: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface TeamHomepageHighlightPlacementRecord {
  readonly id: string;
  readonly teamId: string;
  readonly sourceType: TeamHomepageMediaSourceType;
  readonly sourceId: string;
  readonly gameId: string;
  readonly position: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface TeamHomepageHighlightSettingsRecord {
  readonly displayLimit: number;
  readonly fillWithAutomatic: boolean;
}

export function toBannerDto(config: TeamHomepageConfigRecord | null): TeamHomepageBannerDto {
  return {
    imageUrl: config?.bannerImageUrl ?? null,
    focalX: config?.bannerFocalX ?? 50,
    focalY: config?.bannerFocalY ?? 50,
    overlayOpacity: config?.bannerOverlayOpacity ?? 35,
  };
}

export function toArticleItem(article: PublicArticleListDto): TeamHomepageArticleDto {
  return { type: 'ARTICLE', article };
}

export function toVideoItem(
  gameId: string,
  publishedAt: Date | null,
  item: DisplayMediaItemDto,
): TeamHomepageVideoDto {
  return {
    type: 'VIDEO',
    id: item.id,
    gameId,
    title: item.title,
    thumbnailUrl: item.thumbnailUrl,
    canonicalUrl: item.canonicalUrl,
    embedUrl: item.canEmbed ? item.embedUrl : null,
    canEmbed: item.canEmbed,
    publishedAt: publishedAt?.toISOString() ?? null,
  };
}
