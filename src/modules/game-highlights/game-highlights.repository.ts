import type { PrismaClient } from '../../generated/prisma/client.js';
import type { NormalizedGameHighlight } from '../sports/game-highlight-normalization.js';

export type GameHighlightEmbedStatusValue =
  'ALLOWED' | 'NOT_ALLOWED' | 'GEO_RESTRICTED' | 'UNKNOWN';

export interface GameHighlightRecord {
  readonly id: string;
  readonly title: string;
  readonly description: string | null;
  readonly highlightType: string;
  readonly thumbnailUrl: string | null;
  readonly canonicalUrl: string | null;
  readonly embedUrl: string | null;
  readonly embedStatus: GameHighlightEmbedStatusValue;
  readonly canEmbed: boolean;
  readonly embedCheckedAt: Date | null;
  readonly publishedAt: Date | null;
  readonly firstSeenAt: Date;
  readonly lastSeenAt: Date;
}

/**
 * Internal-only projection used by embed-eligibility evaluation. Carries the
 * provider's own highlight identifier (needed to call the geo-restrictions
 * lookup) -- this must never reach `game-highlights.dto.ts` or any public/admin
 * response, matching the existing "never expose a provider highlight key"
 * convention for this module.
 */
export interface GameHighlightEligibilityCandidate {
  readonly id: string;
  readonly providerHighlightKey: string;
  readonly embedUrl: string | null;
}

export type GameHighlightCoverageValue =
  'PENDING' | 'AVAILABLE' | 'UNAVAILABLE' | 'PROVIDER_ERROR' | 'UNKNOWN';

export interface GameHighlightSyncStateRecord {
  readonly coverage: GameHighlightCoverageValue;
  readonly lastCheckedAt: Date | null;
  readonly providerCount: number | null;
  readonly requestCount: number | null;
  readonly errorCode: string | null;
}

export interface UpsertHighlightsResult {
  readonly created: number;
  readonly updated: number;
  readonly unchanged: number;
}

export interface SaveSyncStateInput {
  readonly coverage: Exclude<GameHighlightCoverageValue, 'UNKNOWN'>;
  readonly checkedAt: Date;
  readonly providerCount: number | null;
  readonly requestCount: number;
  readonly errorCode: string | null;
}

export interface UpdateEmbedEligibilityInput {
  readonly embedStatus: GameHighlightEmbedStatusValue;
  readonly canEmbed: boolean;
  readonly checkedAt: Date;
}

export interface GameHighlightsRepository {
  findGameStatus(gameId: string): Promise<{ readonly status: string } | null>;
  findProviderGameId(gameId: string, provider: string): Promise<string | null>;
  listHighlights(gameId: string): Promise<readonly GameHighlightRecord[]>;
  getSyncState(gameId: string): Promise<GameHighlightSyncStateRecord | null>;
  upsertHighlights(
    gameId: string,
    provider: string,
    highlights: readonly NormalizedGameHighlight[],
    seenAt: Date,
  ): Promise<UpsertHighlightsResult>;
  saveSyncState(gameId: string, provider: string, state: SaveSyncStateInput): Promise<void>;
  /**
   * Candidates never yet checked for embed eligibility, scoped to one game --
   * `forceRecheck` widens this to every row for the game (used by the bounded
   * repair/backfill path, never a season-wide scan).
   */
  listEligibilityCandidates(
    gameId: string,
    forceRecheck: boolean,
  ): Promise<readonly GameHighlightEligibilityCandidate[]>;
  updateEmbedEligibility(highlightId: string, input: UpdateEmbedEligibilityInput): Promise<void>;
}

export class PrismaGameHighlightsRepository implements GameHighlightsRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findGameStatus(gameId: string): Promise<{ readonly status: string } | null> {
    const game = await this.prisma.game.findUnique({
      where: { id: gameId },
      select: { status: true },
    });
    return game === null ? null : { status: game.status };
  }

  async findProviderGameId(gameId: string, provider: string): Promise<string | null> {
    const game = await this.prisma.game.findUnique({
      where: { id: gameId },
      select: { providerMaps: { where: { provider }, take: 1, select: { providerGameId: true } } },
    });
    return game?.providerMaps[0]?.providerGameId ?? null;
  }

  listHighlights(gameId: string): Promise<readonly GameHighlightRecord[]> {
    return this.prisma.gameHighlight.findMany({
      where: { gameId },
      orderBy: [{ publishedAt: 'desc' }, { firstSeenAt: 'asc' }],
    });
  }

  async listEligibilityCandidates(
    gameId: string,
    forceRecheck: boolean,
  ): Promise<readonly GameHighlightEligibilityCandidate[]> {
    return this.prisma.gameHighlight.findMany({
      where: { gameId, ...(forceRecheck ? {} : { embedCheckedAt: null }) },
      select: { id: true, providerHighlightKey: true, embedUrl: true },
    });
  }

  async updateEmbedEligibility(
    highlightId: string,
    input: UpdateEmbedEligibilityInput,
  ): Promise<void> {
    await this.prisma.gameHighlight.update({
      where: { id: highlightId },
      data: {
        embedStatus: input.embedStatus,
        canEmbed: input.canEmbed,
        embedCheckedAt: input.checkedAt,
      },
    });
  }

  async getSyncState(gameId: string): Promise<GameHighlightSyncStateRecord | null> {
    const state = await this.prisma.gameHighlightSyncState.findUnique({ where: { gameId } });
    if (state === null) return null;
    return {
      coverage: state.coverage,
      lastCheckedAt: state.lastCheckedAt,
      providerCount: state.providerCount,
      requestCount: state.requestCount,
      errorCode: state.errorCode,
    };
  }

  async upsertHighlights(
    gameId: string,
    provider: string,
    highlights: readonly NormalizedGameHighlight[],
    seenAt: Date,
  ): Promise<UpsertHighlightsResult> {
    let created = 0;
    let updated = 0;
    let unchanged = 0;
    for (const highlight of highlights) {
      const existing = await this.prisma.gameHighlight.findUnique({
        where: {
          provider_providerHighlightKey: {
            provider,
            providerHighlightKey: highlight.providerHighlightKey,
          },
        },
      });
      if (existing === null) {
        await this.prisma.gameHighlight.create({
          data: {
            gameId,
            provider,
            providerHighlightKey: highlight.providerHighlightKey,
            title: highlight.title,
            description: highlight.description,
            highlightType: highlight.highlightType,
            thumbnailUrl: highlight.thumbnailUrl,
            canonicalUrl: highlight.canonicalUrl,
            embedUrl: highlight.embedUrl,
            publishedAt: highlight.publishedAt,
            firstSeenAt: seenAt,
            lastSeenAt: seenAt,
          },
        });
        created += 1;
        continue;
      }
      const changed =
        existing.title !== highlight.title ||
        existing.description !== highlight.description ||
        existing.thumbnailUrl !== highlight.thumbnailUrl ||
        existing.canonicalUrl !== highlight.canonicalUrl ||
        existing.embedUrl !== highlight.embedUrl ||
        (existing.publishedAt?.getTime() ?? null) !== (highlight.publishedAt?.getTime() ?? null);
      // A changed embedUrl invalidates any prior eligibility decision -- it was
      // evaluated against a URL this highlight no longer has.
      const embedUrlChanged = existing.embedUrl !== highlight.embedUrl;
      await this.prisma.gameHighlight.update({
        where: { id: existing.id },
        data: {
          ...(changed
            ? {
                title: highlight.title,
                description: highlight.description,
                thumbnailUrl: highlight.thumbnailUrl,
                canonicalUrl: highlight.canonicalUrl,
                embedUrl: highlight.embedUrl,
                publishedAt: highlight.publishedAt,
              }
            : {}),
          ...(embedUrlChanged
            ? { embedStatus: 'UNKNOWN' as const, canEmbed: false, embedCheckedAt: null }
            : {}),
          lastSeenAt: seenAt,
        },
      });
      if (changed) updated += 1;
      else unchanged += 1;
    }
    return { created, updated, unchanged };
  }

  async saveSyncState(gameId: string, provider: string, state: SaveSyncStateInput): Promise<void> {
    await this.prisma.gameHighlightSyncState.upsert({
      where: { gameId },
      create: {
        gameId,
        provider,
        coverage: state.coverage,
        lastCheckedAt: state.checkedAt,
        providerCount: state.providerCount,
        requestCount: state.requestCount,
        errorCode: state.errorCode,
      },
      update: {
        provider,
        coverage: state.coverage,
        lastCheckedAt: state.checkedAt,
        providerCount: state.providerCount,
        requestCount: state.requestCount,
        errorCode: state.errorCode,
      },
    });
  }
}
