import { toGameDto, type GameTeamSummaryDto, type GameWithTeams } from '../games/game.dto.js';
import type { PublicGameHighlightItemDto } from '../game-highlights/game-highlights.dto.js';
import type { GameCuratedVideoRecord } from './game-media-curation.repository.js';
import type { GlobalGameCenterVideoRecord } from './global-game-media.repository.js';

/**
 * M32: `CURATED` takes over Game Center whenever any game-specific curated
 * video exists, `AUTOMATIC` is the existing Highlightly-driven experience.
 * M32B adds `GLOBAL` -- the sole-media-source case where nothing game-specific
 * exists but the one cross-game global video does. `NONE` is truly nothing.
 * Computed once here so neither the admin UI nor Game Center ever has to
 * infer override precedence itself. Critically, the global video's mere
 * *presence* never upgrades `AUTOMATIC`/`CURATED` to anything else -- it only
 * becomes the mode when it is the sole source (see composeDisplayVideos for
 * where it's positioned within an existing CURATED/AUTOMATIC list).
 */
export type GameMediaDisplayMode = 'CURATED' | 'AUTOMATIC' | 'GLOBAL' | 'NONE';

export function computeDisplayMode(
  curatedVideoCount: number,
  automaticHighlightCount: number,
  hasGlobalVideo: boolean,
): GameMediaDisplayMode {
  if (curatedVideoCount > 0) return 'CURATED';
  if (automaticHighlightCount > 0) return 'AUTOMATIC';
  if (hasGlobalVideo) return 'GLOBAL';
  return 'NONE';
}

/** Never includes creator/updater identity -- that accountability lives in
 * `AdminAuditEvent`, not this CRUD response. */
export interface AdminGameCuratedVideoDto {
  readonly id: string;
  readonly position: number;
  readonly isPrimary: boolean;
  readonly title: string;
  readonly embedUrl: string;
  readonly canonicalUrl: string | null;
  readonly thumbnailUrl: string | null;
  readonly sourceLabel: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export function toAdminGameCuratedVideoDto(
  record: GameCuratedVideoRecord,
): AdminGameCuratedVideoDto {
  return {
    id: record.id,
    position: record.position,
    isPrimary: record.position === 0,
    title: record.title,
    embedUrl: record.embedUrl,
    canonicalUrl: record.canonicalUrl,
    thumbnailUrl: record.thumbnailUrl,
    sourceLabel: record.sourceLabel,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

/** Public shape (M32) -- no creator/updater IDs, no audit metadata, no
 * provider details. The row's own UUID is the only identity exposed, matching
 * `PublicGameHighlightItemDto`'s convention. */
export interface PublicGameCuratedVideoDto {
  readonly id: string;
  readonly position: number;
  readonly isPrimary: boolean;
  readonly title: string;
  readonly embedUrl: string;
  readonly canonicalUrl: string | null;
  readonly thumbnailUrl: string | null;
  readonly sourceLabel: string | null;
}

export function toPublicGameCuratedVideoDto(
  record: GameCuratedVideoRecord,
): PublicGameCuratedVideoDto {
  return {
    id: record.id,
    position: record.position,
    isPrimary: record.position === 0,
    title: record.title,
    embedUrl: record.embedUrl,
    canonicalUrl: record.canonicalUrl,
    thumbnailUrl: record.thumbnailUrl,
    sourceLabel: record.sourceLabel,
  };
}

export interface AdminGameMediaSummaryDto {
  readonly gameId: string;
  readonly season: number;
  readonly seasonType: 'PRE' | 'REG' | 'POST';
  readonly week: number | null;
  readonly startTime: string | null;
  readonly status: string;
  readonly homeTeam: GameTeamSummaryDto;
  readonly awayTeam: GameTeamSummaryDto;
  readonly homeScore: number | null;
  readonly awayScore: number | null;
  readonly curatedVideoCount: number;
  readonly automaticHighlightCount: number;
  /** M32B: whether the one cross-game global video is currently active --
   * deliberately a boolean, not a count, so an admin game list never implies
   * a per-game global video exists (see docs/game-center/admin-media-curation.md). */
  readonly hasGlobalVideo: boolean;
  readonly displayMode: GameMediaDisplayMode;
}

export function toAdminGameMediaSummaryDto(
  game: GameWithTeams,
  curatedVideoCount: number,
  automaticHighlightCount: number,
  hasGlobalVideo: boolean,
): AdminGameMediaSummaryDto {
  const gameDto = toGameDto(game);
  return {
    gameId: gameDto.id,
    season: gameDto.season,
    seasonType: gameDto.seasonType,
    week: gameDto.week,
    startTime: gameDto.startTime,
    status: gameDto.status,
    homeTeam: gameDto.homeTeam,
    awayTeam: gameDto.awayTeam,
    homeScore: gameDto.homeScore,
    awayScore: gameDto.awayScore,
    curatedVideoCount,
    automaticHighlightCount,
    hasGlobalVideo,
    displayMode: computeDisplayMode(curatedVideoCount, automaticHighlightCount, hasGlobalVideo),
  };
}

export interface AdminGameMediaDetailDto {
  readonly game: AdminGameMediaSummaryDto;
  readonly curatedVideos: readonly AdminGameCuratedVideoDto[];
  readonly globalVideo: AdminGlobalGameCenterVideoDto | null;
  readonly displayMode: GameMediaDisplayMode;
}

export function toAdminGameMediaDetailDto(
  game: GameWithTeams,
  curatedVideos: readonly GameCuratedVideoRecord[],
  automaticHighlightCount: number,
  globalVideo: GlobalGameCenterVideoRecord | null,
): AdminGameMediaDetailDto {
  const summary = toAdminGameMediaSummaryDto(
    game,
    curatedVideos.length,
    automaticHighlightCount,
    globalVideo !== null,
  );
  return {
    game: summary,
    curatedVideos: curatedVideos.map(toAdminGameCuratedVideoDto),
    globalVideo: globalVideo === null ? null : toAdminGlobalGameCenterVideoDto(globalVideo),
    displayMode: summary.displayMode,
  };
}

/** Never includes creator/updater identity -- matches
 * `AdminGameCuratedVideoDto`'s convention. */
export interface AdminGlobalGameCenterVideoDto {
  readonly id: string;
  readonly title: string;
  readonly embedUrl: string;
  readonly canonicalUrl: string | null;
  readonly thumbnailUrl: string | null;
  readonly sourceLabel: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export function toAdminGlobalGameCenterVideoDto(
  record: GlobalGameCenterVideoRecord,
): AdminGlobalGameCenterVideoDto {
  return {
    id: record.id,
    title: record.title,
    embedUrl: record.embedUrl,
    canonicalUrl: record.canonicalUrl,
    thumbnailUrl: record.thumbnailUrl,
    sourceLabel: record.sourceLabel,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

/** Public shape (M32B) -- no creator/updater IDs, no audit metadata. */
export interface PublicGlobalGameCenterVideoDto {
  readonly id: string;
  readonly title: string;
  readonly embedUrl: string;
  readonly canonicalUrl: string | null;
  readonly thumbnailUrl: string | null;
  readonly sourceLabel: string | null;
}

export function toPublicGlobalGameCenterVideoDto(
  record: GlobalGameCenterVideoRecord,
): PublicGlobalGameCenterVideoDto {
  return {
    id: record.id,
    title: record.title,
    embedUrl: record.embedUrl,
    canonicalUrl: record.canonicalUrl,
    thumbnailUrl: record.thumbnailUrl,
    sourceLabel: record.sourceLabel,
  };
}

/**
 * M32B: the provider-neutral ordered list a frontend actually renders, so it
 * never has to reimplement the CURATED/AUTOMATIC/GLOBAL precedence rules
 * itself. `curatedVideos`/`highlights`/`globalVideo` on `PublicGameMediaDto`
 * remain as they were pre-M32B (additive, backward-compatible) -- this is a
 * new field alongside them, not a replacement.
 */
export type GameMediaItemType = 'CURATED' | 'AUTOMATIC' | 'GLOBAL';

export interface DisplayMediaItemDto {
  readonly id: string;
  readonly mediaType: GameMediaItemType;
  readonly title: string;
  readonly embedUrl: string | null;
  readonly canonicalUrl: string | null;
  readonly thumbnailUrl: string | null;
  readonly sourceLabel: string | null;
  readonly canEmbed: boolean;
}

function toCuratedDisplayItem(video: PublicGameCuratedVideoDto): DisplayMediaItemDto {
  return {
    id: video.id,
    mediaType: 'CURATED',
    title: video.title,
    embedUrl: video.embedUrl,
    canonicalUrl: video.canonicalUrl,
    thumbnailUrl: video.thumbnailUrl,
    sourceLabel: video.sourceLabel,
    // Operator-entered and already HTTPS/host-validated at write time --
    // unlike Highlightly's automatic highlights, no separate provider geo/
    // embeddability check ever applies to a manually curated video.
    canEmbed: true,
  };
}

function toAutomaticDisplayItem(highlight: PublicGameHighlightItemDto): DisplayMediaItemDto {
  return {
    id: highlight.id,
    mediaType: 'AUTOMATIC',
    title: highlight.title,
    embedUrl: highlight.embedUrl,
    canonicalUrl: highlight.canonicalUrl,
    thumbnailUrl: highlight.thumbnailUrl,
    sourceLabel: null,
    canEmbed: highlight.canEmbed,
  };
}

function toGlobalDisplayItem(video: PublicGlobalGameCenterVideoDto): DisplayMediaItemDto {
  return {
    id: video.id,
    mediaType: 'GLOBAL',
    title: video.title,
    embedUrl: video.embedUrl,
    canonicalUrl: video.canonicalUrl,
    thumbnailUrl: video.thumbnailUrl,
    sourceLabel: video.sourceLabel,
    canEmbed: true,
  };
}

/** Inserts the global item as the second entry in an otherwise-ordered list
 * (the game-specific primary stays first) -- a no-op if there is no global
 * item, or if `items` is unexpectedly empty (callers only call this branch
 * once they've already confirmed `items.length > 0`). */
function insertGlobalSecond(
  items: readonly DisplayMediaItemDto[],
  globalItem: DisplayMediaItemDto | null,
): readonly DisplayMediaItemDto[] {
  if (globalItem === null) return items;
  const [first, ...rest] = items;
  if (first === undefined) return items;
  return [first, globalItem, ...rest];
}

/**
 * Composition rules (M32B spec §12-14):
 * - Curated videos exist: `[C0, GLOBAL, C1, C2, C3]` -- the curated primary
 *   stays primary; global is always second, never first.
 * - No curated but automatic highlights exist: `[A0, GLOBAL, A1, ...]` --
 *   same shape, generalized to however many automatic highlights exist (never
 *   hard-coded to exactly one).
 * - Neither curated nor automatic, but a global video is active: `[GLOBAL]`
 *   -- global becomes primary only in this sole-media-source case.
 * - Nothing at all: `[]`.
 */
export function composeDisplayVideos(
  curatedVideos: readonly PublicGameCuratedVideoDto[],
  highlights: readonly PublicGameHighlightItemDto[],
  globalVideo: PublicGlobalGameCenterVideoDto | null,
): readonly DisplayMediaItemDto[] {
  const curatedItems = curatedVideos.map(toCuratedDisplayItem);
  const automaticItems = highlights.map(toAutomaticDisplayItem);
  const globalItem = globalVideo === null ? null : toGlobalDisplayItem(globalVideo);

  if (curatedItems.length > 0) return insertGlobalSecond(curatedItems, globalItem);
  if (automaticItems.length > 0) return insertGlobalSecond(automaticItems, globalItem);
  return globalItem === null ? [] : [globalItem];
}

export interface PublicGameMediaDto {
  readonly gameId: string;
  readonly displayMode: GameMediaDisplayMode;
  readonly curatedVideos: readonly PublicGameCuratedVideoDto[];
  readonly highlights: readonly PublicGameHighlightItemDto[];
  readonly globalVideo: PublicGlobalGameCenterVideoDto | null;
  readonly displayVideos: readonly DisplayMediaItemDto[];
  readonly coverage: string;
}

export function toPublicGameMediaDto(
  gameId: string,
  curatedVideos: readonly GameCuratedVideoRecord[],
  highlights: readonly PublicGameHighlightItemDto[],
  coverage: string,
  globalVideo: GlobalGameCenterVideoRecord | null,
): PublicGameMediaDto {
  const publicCurated = curatedVideos.map(toPublicGameCuratedVideoDto);
  const publicGlobal = globalVideo === null ? null : toPublicGlobalGameCenterVideoDto(globalVideo);
  return {
    gameId,
    displayMode: computeDisplayMode(curatedVideos.length, highlights.length, globalVideo !== null),
    curatedVideos: publicCurated,
    highlights,
    globalVideo: publicGlobal,
    displayVideos: composeDisplayVideos(publicCurated, highlights, publicGlobal),
    coverage,
  };
}
