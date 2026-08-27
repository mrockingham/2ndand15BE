import { AppError } from '../../common/errors/app-error.js';
import { HighlightlyEvaluationError } from '../sports/evaluation/highlightly/highlightly-http-client.js';
import type { HighlightlyEvaluationHttpClient } from '../sports/evaluation/highlightly/highlightly-http-client.js';
import type { HighlightFetcher } from '../sports/highlightly-highlight-fetcher.js';
import type { GeoRestrictionFetcher } from '../sports/highlightly-geo-restriction-fetcher.js';
import { normalizeHighlightlyHighlight } from '../sports/providers/highlightly/highlightly-highlight-normalizer.js';
import { evaluateEmbedEligibility, isAllowedEmbedHost } from './embed-eligibility.js';
import {
  toAdminGameHighlightDiagnosticDto,
  toPublicGameHighlightDto,
  type AdminGameHighlightDiagnosticDto,
  type PublicGameHighlightsDto,
} from './game-highlights.dto.js';
import type {
  GameHighlightEligibilityCandidate,
  GameHighlightsRepository,
} from './game-highlights.repository.js';

const HIGHLIGHTLY_PROVIDER = 'highlightly';

// M31C: geo-restriction lookups run one per never-before-checked highlight (see
// listEligibilityCandidates); Highlightly's own real samples never exceed a small
// handful of highlights per game, so a small fixed cap bounds worst-case
// concurrency without needing a real work-queue dependency.
const EMBED_ELIGIBILITY_CONCURRENCY = 4;

export interface GameHighlightSyncDependencies {
  readonly fetcher: HighlightFetcher;
  readonly client: HighlightlyEvaluationHttpClient;
  readonly geoFetcher: GeoRestrictionFetcher;
  /** `null` disables embed-host allowlisting. See embed-eligibility.ts. */
  readonly embedAllowedHosts: readonly string[] | null;
}

export interface SyncGameOptions {
  /**
   * M31A: whether a zero-highlight provider result should be treated as a final
   * answer (`UNAVAILABLE`) or as still-pending (`PENDING`, retryable later).
   * Defaults to `true` -- an explicit admin/CLI check is a one-off, authoritative
   * request, so "checked and found nothing" is reported as `UNAVAILABLE`
   * immediately, exactly as before this option existed. The FINAL-reconciliation
   * poller is the one caller that passes `false` for its FINAL_IMMEDIATE and
   * FINAL_10 attempts (highlights may not be published yet) and `true` only for
   * its final FINAL_60 attempt, once the lifecycle is exhausted.
   */
  readonly exhaustiveCheck?: boolean;
}

export interface GameHighlightsServiceContract {
  getPublicHighlights(gameId: string): Promise<PublicGameHighlightsDto>;
  getDiagnostic(gameId: string): Promise<AdminGameHighlightDiagnosticDto>;
  syncGame(gameId: string, options?: SyncGameOptions): Promise<AdminGameHighlightDiagnosticDto>;
  /**
   * M31C: bounded repair/backfill -- forces every existing highlight row for
   * this one game to be re-evaluated for embed eligibility, regardless of
   * whether it was already checked. Never touches highlight metadata itself
   * and never fetches `/highlights` again; only the geo-restrictions lookup
   * runs, once per row.
   */
  refreshEmbedEligibility(gameId: string): Promise<AdminGameHighlightDiagnosticDto>;
}

/** Sanitized provider-error taxonomy, matching the `classifyProbeError` convention
 * already used by the Data Health probe -- never the raw message/body. */
function classifySyncError(error: unknown): string {
  if (error instanceof HighlightlyEvaluationError) return error.code;
  return 'OTHER';
}

export class GameHighlightsService implements GameHighlightsServiceContract {
  constructor(
    private readonly repository: GameHighlightsRepository,
    // Optional exactly like `DataHealthService`'s probe service: the DB-only reads
    // below must always work even when Highlightly configuration is unavailable at
    // startup, and only `syncGame` (the one path that makes a live provider call)
    // requires this.
    private readonly syncDependencies?: GameHighlightSyncDependencies,
    private readonly now: () => Date = () => new Date(),
    // M31C global kill-switch: independent of `syncDependencies` because public
    // reads must keep working (and keep refusing to report canEmbed) even when
    // Highlightly sync is entirely unconfigured. Defaults to `true` here so
    // existing/unit-test callers keep prior behavior; production wiring passes
    // `config.currentGame.embedPlaybackEnabled` explicitly (currently `false` --
    // see embed-eligibility.ts and the M31C doc addendum).
    private readonly embedPlaybackEnabled = true,
  ) {}

  async getPublicHighlights(gameId: string): Promise<PublicGameHighlightsDto> {
    await this.requireGame(gameId);
    const [highlights, state] = await Promise.all([
      this.repository.listHighlights(gameId),
      this.repository.getSyncState(gameId),
    ]);
    return toPublicGameHighlightDto(gameId, highlights, state, this.embedPlaybackEnabled);
  }

  async getDiagnostic(gameId: string): Promise<AdminGameHighlightDiagnosticDto> {
    await this.requireGame(gameId);
    const [highlights, state] = await Promise.all([
      this.repository.listHighlights(gameId),
      this.repository.getSyncState(gameId),
    ]);
    return toAdminGameHighlightDiagnosticDto(gameId, highlights, state);
  }

  async syncGame(
    gameId: string,
    options: SyncGameOptions = {},
  ): Promise<AdminGameHighlightDiagnosticDto> {
    const exhaustiveCheck = options.exhaustiveCheck ?? true;
    const game = await this.requireGame(gameId);
    const { fetcher, client } = this.requireSyncDependencies();
    const checkedAt = this.now();

    const providerGameId = await this.repository.findProviderGameId(gameId, HIGHLIGHTLY_PROVIDER);
    if (providerGameId === null) {
      await this.repository.saveSyncState(gameId, HIGHLIGHTLY_PROVIDER, {
        coverage: 'PENDING',
        checkedAt,
        providerCount: null,
        requestCount: 0,
        errorCode: null,
      });
      return this.reportDiagnostic(gameId, 'MISSING_PROVIDER_MAPPING');
    }

    const requestCountBefore = client.getRequestCount();
    let errorCode: string | null = null;
    let providerCount: number | null = null;
    try {
      const result = await fetcher.fetch(providerGameId);
      if (result.highlights === null) {
        errorCode = result.failureReason ?? 'INVALID_RESPONSE';
      } else {
        providerCount = result.highlights.length;
        const normalized = result.highlights.map(normalizeHighlightlyHighlight);
        await this.repository.upsertHighlights(gameId, HIGHLIGHTLY_PROVIDER, normalized, checkedAt);
      }
    } catch (error: unknown) {
      errorCode = classifySyncError(error);
    }

    // M31C: embed eligibility never blocks or fails the highlight sync above --
    // a geo-lookup failure degrades to "do not embed" per highlight, not a
    // PROVIDER_ERROR for the whole game (see embed-eligibility.ts and #9 in the
    // M31C spec). This still runs on a provider-fetch failure: rows persisted by
    // an earlier successful sync may still be waiting on their first eligibility
    // check.
    await this.evaluateEmbedEligibility(gameId, checkedAt, false);

    const requestCount = client.getRequestCount() - requestCountBefore;

    const coverage =
      errorCode !== null
        ? 'PROVIDER_ERROR'
        : (providerCount ?? 0) > 0
          ? 'AVAILABLE'
          : game.status === 'FINAL' && exhaustiveCheck
            ? 'UNAVAILABLE'
            : 'PENDING';
    await this.repository.saveSyncState(gameId, HIGHLIGHTLY_PROVIDER, {
      coverage,
      checkedAt,
      providerCount,
      requestCount,
      errorCode,
    });
    return this.reportDiagnostic(gameId, errorCode);
  }

  async refreshEmbedEligibility(gameId: string): Promise<AdminGameHighlightDiagnosticDto> {
    await this.requireGame(gameId);
    await this.evaluateEmbedEligibility(gameId, this.now(), true);
    return this.reportDiagnostic(gameId, null);
  }

  private async evaluateEmbedEligibility(
    gameId: string,
    checkedAt: Date,
    forceRecheck: boolean,
  ): Promise<void> {
    const { geoFetcher, embedAllowedHosts } = this.requireSyncDependencies();
    const candidates = await this.repository.listEligibilityCandidates(gameId, forceRecheck);
    await mapWithConcurrency(candidates, EMBED_ELIGIBILITY_CONCURRENCY, (candidate) =>
      this.evaluateOneHighlight(candidate, geoFetcher, embedAllowedHosts, checkedAt),
    );
  }

  private async evaluateOneHighlight(
    candidate: GameHighlightEligibilityCandidate,
    geoFetcher: GeoRestrictionFetcher,
    embedAllowedHosts: readonly string[] | null,
    checkedAt: Date,
  ): Promise<void> {
    // #21: no embed URL at all -- nothing to embed, no geo request needed.
    if (candidate.embedUrl === null) {
      await this.repository.updateEmbedEligibility(candidate.id, {
        embedStatus: 'UNKNOWN',
        canEmbed: false,
        checkedAt,
      });
      return;
    }
    // #12: a host-allowlist rejection is decided locally and never spends a geo
    // request -- see the M31C request-economics note in the highlights doc.
    if (embedAllowedHosts !== null && !isAllowedEmbedHost(candidate.embedUrl, embedAllowedHosts)) {
      await this.repository.updateEmbedEligibility(candidate.id, {
        embedStatus: 'NOT_ALLOWED',
        canEmbed: false,
        checkedAt,
      });
      return;
    }
    const geoResult = await geoFetcher.fetch(candidate.providerHighlightKey);
    const { embedStatus, canEmbed } = evaluateEmbedEligibility({
      embedUrl: candidate.embedUrl,
      geoState:
        geoResult.restriction === null
          ? null
          : {
              embeddable: geoResult.restriction.embeddable ?? null,
              allowedCountries: geoResult.restriction.allowedCountries ?? null,
              blockedCountries: geoResult.restriction.blockedCountries ?? null,
            },
      // Already checked above -- passing null here avoids re-running the (already
      // passed) host check inside the pure evaluator.
      allowedHosts: null,
    });
    await this.repository.updateEmbedEligibility(candidate.id, {
      embedStatus,
      canEmbed,
      checkedAt,
    });
  }

  private async reportDiagnostic(
    gameId: string,
    overrideErrorCode: string | null,
  ): Promise<AdminGameHighlightDiagnosticDto> {
    const [highlights, state] = await Promise.all([
      this.repository.listHighlights(gameId),
      this.repository.getSyncState(gameId),
    ]);
    return toAdminGameHighlightDiagnosticDto(gameId, highlights, state, overrideErrorCode);
  }

  private async requireGame(gameId: string): Promise<{ readonly status: string }> {
    const game = await this.repository.findGameStatus(gameId);
    if (game === null) {
      throw new AppError({
        code: 'GAME_NOT_FOUND',
        message: 'The requested game was not found.',
        statusCode: 404,
      });
    }
    return game;
  }

  private requireSyncDependencies(): GameHighlightSyncDependencies {
    if (this.syncDependencies === undefined) {
      throw new AppError({
        code: 'GAME_HIGHLIGHT_SYNC_UNCONFIGURED',
        message: 'The Highlightly highlight sync is not configured on this server.',
        statusCode: 500,
      });
    }
    return this.syncDependencies;
  }
}

/** A tiny bounded-concurrency worker pool -- see EMBED_ELIGIBILITY_CONCURRENCY. */
async function mapWithConcurrency<T>(
  items: readonly T[],
  concurrency: number,
  task: (item: T) => Promise<void>,
): Promise<void> {
  let nextIndex = 0;
  const workerCount = Math.min(concurrency, items.length);
  const workers = Array.from({ length: workerCount }, async () => {
    for (;;) {
      const index = nextIndex;
      nextIndex += 1;
      const item = items[index];
      if (item === undefined) return;
      await task(item);
    }
  });
  await Promise.all(workers);
}
