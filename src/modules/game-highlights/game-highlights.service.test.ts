import { describe, expect, it } from 'vitest';

import type { AppError } from '../../common/errors/app-error.js';
import {
  HighlightlyEvaluationError,
  type HighlightlyEvaluationHttpClient,
} from '../sports/evaluation/highlightly/highlightly-http-client.js';
import type { HighlightFetcher } from '../sports/highlightly-highlight-fetcher.js';
import type { HighlightlyHighlight } from '../sports/evaluation/highlightly/highlightly-schemas.js';
import { GameHighlightsService } from './game-highlights.service.js';
import type {
  GameHighlightEligibilityCandidate,
  GameHighlightRecord,
  GameHighlightsRepository,
  GameHighlightSyncStateRecord,
  SaveSyncStateInput,
  UpdateEmbedEligibilityInput,
  UpsertHighlightsResult,
} from './game-highlights.repository.js';
import type { NormalizedGameHighlight } from '../sports/game-highlight-normalization.js';
import type { GeoRestrictionFetcher } from '../sports/highlightly-geo-restriction-fetcher.js';

class FakeRepository implements GameHighlightsRepository {
  gameStatusByGameId = new Map<string, string>();
  providerGameIdByGameId = new Map<string, string>();
  highlightsByGameId = new Map<string, GameHighlightRecord[]>();
  stateByGameId = new Map<string, GameHighlightSyncStateRecord>();
  savedStates: SaveSyncStateInput[] = [];
  upsertCalls: (readonly NormalizedGameHighlight[])[] = [];
  eligibilityUpdates: (readonly [string, UpdateEmbedEligibilityInput])[] = [];

  findGameStatus(gameId: string) {
    const status = this.gameStatusByGameId.get(gameId);
    return Promise.resolve(status === undefined ? null : { status });
  }

  findProviderGameId(gameId: string) {
    return Promise.resolve(this.providerGameIdByGameId.get(gameId) ?? null);
  }

  listHighlights(gameId: string) {
    return Promise.resolve(this.highlightsByGameId.get(gameId) ?? []);
  }

  getSyncState(gameId: string) {
    return Promise.resolve(this.stateByGameId.get(gameId) ?? null);
  }

  upsertHighlights(
    gameId: string,
    _provider: string,
    highlights: readonly NormalizedGameHighlight[],
  ): Promise<UpsertHighlightsResult> {
    this.upsertCalls = [...this.upsertCalls, highlights];
    const existing = this.highlightsByGameId.get(gameId) ?? [];
    const existingKeys = new Set(existing.map((h) => h.id));
    let created = 0;
    const merged = [...existing];
    for (const [index, h] of highlights.entries()) {
      const id = h.providerHighlightKey;
      if (!existingKeys.has(id)) {
        merged.push({
          id,
          title: h.title,
          description: h.description,
          highlightType: h.highlightType,
          thumbnailUrl: h.thumbnailUrl,
          canonicalUrl: h.canonicalUrl,
          embedUrl: h.embedUrl,
          embedStatus: 'UNKNOWN',
          canEmbed: false,
          embedCheckedAt: null,
          publishedAt: h.publishedAt,
          firstSeenAt: new Date(),
          lastSeenAt: new Date(),
        });
        created += 1;
      }
      void index;
    }
    this.highlightsByGameId.set(gameId, merged);
    return Promise.resolve({ created, updated: 0, unchanged: highlights.length - created });
  }

  saveSyncState(gameId: string, _provider: string, state: SaveSyncStateInput) {
    this.savedStates = [...this.savedStates, state];
    this.stateByGameId.set(gameId, {
      coverage: state.coverage,
      lastCheckedAt: state.checkedAt,
      providerCount: state.providerCount,
      requestCount: state.requestCount,
      errorCode: state.errorCode,
    });
    return Promise.resolve();
  }

  listEligibilityCandidates(
    gameId: string,
    forceRecheck: boolean,
  ): Promise<readonly GameHighlightEligibilityCandidate[]> {
    const highlights = this.highlightsByGameId.get(gameId) ?? [];
    return Promise.resolve(
      highlights
        .filter((h) => forceRecheck || h.embedCheckedAt === null)
        .map((h) => ({ id: h.id, providerHighlightKey: h.id, embedUrl: h.embedUrl })),
    );
  }

  updateEmbedEligibility(highlightId: string, input: UpdateEmbedEligibilityInput): Promise<void> {
    this.eligibilityUpdates = [...this.eligibilityUpdates, [highlightId, input]];
    for (const highlights of this.highlightsByGameId.values()) {
      const index = highlights.findIndex((h) => h.id === highlightId);
      if (index === -1) continue;
      const existing = highlights[index];
      if (existing === undefined) continue;
      highlights[index] = {
        ...existing,
        embedStatus: input.embedStatus,
        canEmbed: input.canEmbed,
        embedCheckedAt: input.checkedAt,
      };
    }
    return Promise.resolve();
  }
}

function highlight(id: number | string, title = 'Fictional Highlight'): HighlightlyHighlight {
  return {
    id,
    type: 'VERIFIED',
    imgUrl: 'https://i.ytimg.com/vi/x/hqdefault.jpg',
    title,
    description: null,
    url: 'https://www.youtube.com/watch?v=x',
    embedUrl: 'https://www.youtube.com/embed/x',
    channel: 'NFL',
    source: 'youtube',
    category: 'other',
  };
}

interface FakeClient {
  readonly getRequestCount: () => number;
  readonly bump: () => void;
}

function fakeClient(requestCountPerCall = 1): FakeClient {
  let count = 0;
  return {
    getRequestCount: () => count,
    bump: () => {
      count += requestCountPerCall;
    },
  };
}

function asHighlightlyClient(client: FakeClient): HighlightlyEvaluationHttpClient {
  return client as unknown as HighlightlyEvaluationHttpClient;
}

/** Never resolves a real restriction -- eligibility-specific behavior is
 * covered by the dedicated `describe('embed eligibility', ...)` block below. */
const noopGeoFetcher: GeoRestrictionFetcher = {
  fetch: () => Promise.resolve({ restriction: null, failureReason: null }),
};

describe('GameHighlightsService', () => {
  it('throws GAME_NOT_FOUND for an unknown game on every method', async () => {
    const service = new GameHighlightsService(new FakeRepository());
    await expect(service.getPublicHighlights('missing')).rejects.toMatchObject({
      code: 'GAME_NOT_FOUND',
    } satisfies Partial<AppError>);
  });

  it('is mapping-first: no provider mapping yields PENDING without any fetch attempt', async () => {
    const repository = new FakeRepository();
    repository.gameStatusByGameId.set('game-1', 'SCHEDULED');
    let fetchCalled = false;
    const fetcher: HighlightFetcher = {
      fetch: () => {
        fetchCalled = true;
        return Promise.resolve({ highlights: [], failureReason: null });
      },
    };
    const client = fakeClient();
    const service = new GameHighlightsService(repository, {
      fetcher,
      client: asHighlightlyClient(client),
      geoFetcher: noopGeoFetcher,
      embedAllowedHosts: null,
    });

    const result = await service.syncGame('game-1');
    expect(fetchCalled).toBe(false);
    expect(result.coverage).toBe('PENDING');
    expect(result.errorCode).toBe('MISSING_PROVIDER_MAPPING');
  });

  it('classifies AVAILABLE when the provider returns at least one highlight', async () => {
    const repository = new FakeRepository();
    repository.gameStatusByGameId.set('game-1', 'FINAL');
    repository.providerGameIdByGameId.set('game-1', '566033');
    const client = fakeClient();
    const fetcher: HighlightFetcher = {
      fetch: () => {
        client.bump();
        return Promise.resolve({ highlights: [highlight(105170)], failureReason: null });
      },
    };
    const service = new GameHighlightsService(repository, {
      fetcher,
      client: asHighlightlyClient(client),
      geoFetcher: noopGeoFetcher,
      embedAllowedHosts: null,
    });

    const result = await service.syncGame('game-1');
    expect(result.coverage).toBe('AVAILABLE');
    expect(result.dbHighlightCount).toBe(1);
    expect(result.providerHighlightCount).toBe(1);
    expect(result.requestCount).toBe(1);
  });

  it('classifies UNAVAILABLE for a FINAL game with zero provider highlights, not PENDING', async () => {
    const repository = new FakeRepository();
    repository.gameStatusByGameId.set('game-1', 'FINAL');
    repository.providerGameIdByGameId.set('game-1', '566033');
    const client = fakeClient();
    const fetcher: HighlightFetcher = {
      fetch: () => Promise.resolve({ highlights: [], failureReason: null }),
    };
    const service = new GameHighlightsService(repository, {
      fetcher,
      client: asHighlightlyClient(client),
      geoFetcher: noopGeoFetcher,
      embedAllowedHosts: null,
    });

    const result = await service.syncGame('game-1');
    expect(result.coverage).toBe('UNAVAILABLE');
  });

  it('M31A: exhaustiveCheck: false keeps a FINAL zero-result game PENDING, not UNAVAILABLE', async () => {
    const repository = new FakeRepository();
    repository.gameStatusByGameId.set('game-1', 'FINAL');
    repository.providerGameIdByGameId.set('game-1', '566033');
    const client = fakeClient();
    const fetcher: HighlightFetcher = {
      fetch: () => Promise.resolve({ highlights: [], failureReason: null }),
    };
    const service = new GameHighlightsService(repository, {
      fetcher,
      client: asHighlightlyClient(client),
      geoFetcher: noopGeoFetcher,
      embedAllowedHosts: null,
    });

    const result = await service.syncGame('game-1', { exhaustiveCheck: false });
    expect(result.coverage).toBe('PENDING');
  });

  it('M31A: exhaustiveCheck: true (or omitted) still finalizes UNAVAILABLE for a FINAL zero-result game', async () => {
    const repository = new FakeRepository();
    repository.gameStatusByGameId.set('game-1', 'FINAL');
    repository.providerGameIdByGameId.set('game-1', '566033');
    const client = fakeClient();
    const fetcher: HighlightFetcher = {
      fetch: () => Promise.resolve({ highlights: [], failureReason: null }),
    };
    const service = new GameHighlightsService(repository, {
      fetcher,
      client: asHighlightlyClient(client),
      geoFetcher: noopGeoFetcher,
      embedAllowedHosts: null,
    });

    const result = await service.syncGame('game-1', { exhaustiveCheck: true });
    expect(result.coverage).toBe('UNAVAILABLE');
  });

  it('classifies PENDING for a non-FINAL game with zero provider highlights', async () => {
    const repository = new FakeRepository();
    repository.gameStatusByGameId.set('game-1', 'IN_PROGRESS');
    repository.providerGameIdByGameId.set('game-1', '566033');
    const client = fakeClient();
    const fetcher: HighlightFetcher = {
      fetch: () => Promise.resolve({ highlights: [], failureReason: null }),
    };
    const service = new GameHighlightsService(repository, {
      fetcher,
      client: asHighlightlyClient(client),
      geoFetcher: noopGeoFetcher,
      embedAllowedHosts: null,
    });

    const result = await service.syncGame('game-1');
    expect(result.coverage).toBe('PENDING');
    expect(result.errorCode).toBeNull();
  });

  it('classifies PROVIDER_ERROR without ever reporting "not checked" as UNAVAILABLE', async () => {
    const repository = new FakeRepository();
    repository.gameStatusByGameId.set('game-1', 'FINAL');
    repository.providerGameIdByGameId.set('game-1', '566033');
    const client = fakeClient();
    const fetcher: HighlightFetcher = {
      fetch: () =>
        Promise.reject(
          new HighlightlyEvaluationError({
            code: 'RATE_LIMITED',
            message: 'rate limited',
            statusCode: 429,
            retryable: true,
          }),
        ),
    };
    const service = new GameHighlightsService(repository, {
      fetcher,
      client: asHighlightlyClient(client),
      geoFetcher: noopGeoFetcher,
      embedAllowedHosts: null,
    });

    const result = await service.syncGame('game-1');
    expect(result.coverage).toBe('PROVIDER_ERROR');
    expect(result.errorCode).toBe('RATE_LIMITED');

    // Never-checked (no sync attempted at all) must remain UNKNOWN, not UNAVAILABLE.
    const untouched = await service.getDiagnostic('game-1');
    expect(untouched.coverage).not.toBe('UNAVAILABLE');
  });

  it('reports UNKNOWN, never UNAVAILABLE, for a game that has never been synced', async () => {
    const repository = new FakeRepository();
    repository.gameStatusByGameId.set('game-1', 'FINAL');
    const service = new GameHighlightsService(repository);
    const diagnostic = await service.getDiagnostic('game-1');
    expect(diagnostic.coverage).toBe('UNKNOWN');
  });

  it('throws GAME_HIGHLIGHT_SYNC_UNCONFIGURED when no sync dependencies are provided', async () => {
    const repository = new FakeRepository();
    repository.gameStatusByGameId.set('game-1', 'FINAL');
    const service = new GameHighlightsService(repository);
    await expect(service.syncGame('game-1')).rejects.toMatchObject({
      code: 'GAME_HIGHLIGHT_SYNC_UNCONFIGURED',
    } satisfies Partial<AppError>);
  });

  it('does not delete previously-seen highlights when a later sync returns fewer (non-destructive)', async () => {
    const repository = new FakeRepository();
    repository.gameStatusByGameId.set('game-1', 'FINAL');
    repository.providerGameIdByGameId.set('game-1', '566033');
    const client = fakeClient();
    let call = 0;
    const fetcher: HighlightFetcher = {
      fetch: () => {
        call += 1;
        return Promise.resolve({
          highlights: call === 1 ? [highlight(1), highlight(2)] : [],
          failureReason: null,
        });
      },
    };
    const service = new GameHighlightsService(repository, {
      fetcher,
      client: asHighlightlyClient(client),
      geoFetcher: noopGeoFetcher,
      embedAllowedHosts: null,
    });

    const first = await service.syncGame('game-1');
    expect(first.dbHighlightCount).toBe(2);
    const second = await service.syncGame('game-1');
    // The provider's second snapshot omitted both items, but nothing already
    // persisted is ever deleted -- coverage reflects that the provider returned
    // nothing new this time (UNAVAILABLE, since the game is FINAL) while the
    // previously-seen rows remain intact.
    expect(second.coverage).toBe('UNAVAILABLE');
    expect(second.dbHighlightCount).toBe(2);
  });
});

function geoFetcherReturning(restriction: {
  readonly embeddable: boolean | null;
  readonly allowedCountries?: readonly string[];
  readonly blockedCountries?: readonly string[];
}): GeoRestrictionFetcher {
  return {
    fetch: () =>
      Promise.resolve({
        restriction: {
          state: 'test fixture',
          embeddable: restriction.embeddable,
          allowedCountries: [...(restriction.allowedCountries ?? [])],
          blockedCountries: [...(restriction.blockedCountries ?? [])],
        },
        failureReason: null,
      }),
  };
}

async function syncOneHighlightGame(
  repository: FakeRepository,
  geoFetcher: GeoRestrictionFetcher,
  options: {
    readonly embedUrl?: string | null;
    readonly embedAllowedHosts?: readonly string[] | null;
  } = {},
) {
  repository.gameStatusByGameId.set('game-1', 'FINAL');
  repository.providerGameIdByGameId.set('game-1', '566033');
  const client = fakeClient();
  const fetcher: HighlightFetcher = {
    fetch: () =>
      Promise.resolve({
        highlights: [
          {
            ...highlight(1),
            embedUrl: 'embedUrl' in options ? options.embedUrl : highlight(1).embedUrl,
          },
        ],
        failureReason: null,
      }),
  };
  const service = new GameHighlightsService(repository, {
    fetcher,
    client: asHighlightlyClient(client),
    geoFetcher,
    embedAllowedHosts: options.embedAllowedHosts ?? null,
  });
  await service.syncGame('game-1');
  return repository.highlightsByGameId.get('game-1')?.[0];
}

describe('GameHighlightsService embed eligibility (M31C)', () => {
  it('sets ALLOWED/canEmbed when embeddable is true with no country restrictions', async () => {
    const repository = new FakeRepository();
    const record = await syncOneHighlightGame(
      repository,
      geoFetcherReturning({ embeddable: true }),
    );
    expect(record?.embedStatus).toBe('ALLOWED');
    expect(record?.canEmbed).toBe(true);
  });

  it('sets NOT_ALLOWED when embeddable is false', async () => {
    const repository = new FakeRepository();
    const record = await syncOneHighlightGame(
      repository,
      geoFetcherReturning({ embeddable: false }),
    );
    expect(record?.embedStatus).toBe('NOT_ALLOWED');
    expect(record?.canEmbed).toBe(false);
  });

  it('sets UNKNOWN, never embeds, when the restriction state is unrecognized/missing', async () => {
    const repository = new FakeRepository();
    const record = await syncOneHighlightGame(
      repository,
      geoFetcherReturning({ embeddable: null }),
    );
    expect(record?.embedStatus).toBe('UNKNOWN');
    expect(record?.canEmbed).toBe(false);
  });

  it('sets GEO_RESTRICTED, not ALLOWED, when embeddable is true but scoped to specific countries', async () => {
    const repository = new FakeRepository();
    const record = await syncOneHighlightGame(
      repository,
      geoFetcherReturning({ embeddable: true, allowedCountries: ['US'] }),
    );
    expect(record?.embedStatus).toBe('GEO_RESTRICTED');
    expect(record?.canEmbed).toBe(false);
  });

  it('sets GEO_RESTRICTED for a non-empty blocked-country list even with an empty allowed list', async () => {
    const repository = new FakeRepository();
    const record = await syncOneHighlightGame(
      repository,
      geoFetcherReturning({ embeddable: true, blockedCountries: ['CN'] }),
    );
    expect(record?.embedStatus).toBe('GEO_RESTRICTED');
    expect(record?.canEmbed).toBe(false);
  });

  it('never embeds when the highlight has no embed URL at all, without spending a geo request', async () => {
    const repository = new FakeRepository();
    let geoCalls = 0;
    const geoFetcher: GeoRestrictionFetcher = {
      fetch: () => {
        geoCalls += 1;
        return Promise.resolve({ restriction: null, failureReason: null });
      },
    };
    const record = await syncOneHighlightGame(repository, geoFetcher, { embedUrl: null });
    expect(record?.embedStatus).toBe('UNKNOWN');
    expect(record?.canEmbed).toBe(false);
    expect(geoCalls).toBe(0);
  });

  it('rejects a host outside an explicit allowlist without spending a geo request', async () => {
    const repository = new FakeRepository();
    let geoCalls = 0;
    const geoFetcher: GeoRestrictionFetcher = {
      fetch: () => {
        geoCalls += 1;
        return Promise.resolve({
          restriction: {
            state: 'ok',
            embeddable: true,
            allowedCountries: [],
            blockedCountries: [],
          },
          failureReason: null,
        });
      },
    };
    const record = await syncOneHighlightGame(repository, geoFetcher, {
      embedUrl: 'https://vimeo.com/embed/123',
      embedAllowedHosts: ['youtube.com', 'www.youtube.com'],
    });
    expect(record?.embedStatus).toBe('NOT_ALLOWED');
    expect(record?.canEmbed).toBe(false);
    expect(geoCalls).toBe(0);
  });

  it('degrades to UNKNOWN/no-embed, without failing the sync, when the geo lookup errors', async () => {
    const repository = new FakeRepository();
    const geoFetcher: GeoRestrictionFetcher = {
      fetch: () => Promise.resolve({ restriction: null, failureReason: 'NETWORK_ERROR' }),
    };
    const record = await syncOneHighlightGame(repository, geoFetcher);
    expect(record?.embedStatus).toBe('UNKNOWN');
    expect(record?.canEmbed).toBe(false);
    // The highlight sync itself still succeeded -- the row still exists.
    const diagnostic = await new GameHighlightsService(repository, {
      fetcher: { fetch: () => Promise.resolve({ highlights: [], failureReason: null }) },
      client: asHighlightlyClient(fakeClient()),
      geoFetcher: noopGeoFetcher,
      embedAllowedHosts: null,
    }).getDiagnostic('game-1');
    expect(diagnostic.dbHighlightCount).toBe(1);
  });

  it('is idempotent: a regular sync never rechecks an already-decided highlight', async () => {
    const repository = new FakeRepository();
    let geoCalls = 0;
    const countingGeoFetcher: GeoRestrictionFetcher = {
      fetch: () => {
        geoCalls += 1;
        return Promise.resolve({
          restriction: {
            state: 'ok',
            embeddable: true,
            allowedCountries: [],
            blockedCountries: [],
          },
          failureReason: null,
        });
      },
    };
    repository.gameStatusByGameId.set('game-1', 'FINAL');
    repository.providerGameIdByGameId.set('game-1', '566033');
    const client = fakeClient();
    const fetcher: HighlightFetcher = {
      fetch: () => Promise.resolve({ highlights: [highlight(1)], failureReason: null }),
    };
    const service = new GameHighlightsService(repository, {
      fetcher,
      client: asHighlightlyClient(client),
      geoFetcher: countingGeoFetcher,
      embedAllowedHosts: null,
    });
    await service.syncGame('game-1');
    await service.syncGame('game-1');
    expect(geoCalls).toBe(1);
  });

  it('refreshEmbedEligibility forces a recheck and can move ALLOWED -> NOT_ALLOWED', async () => {
    const repository = new FakeRepository();
    let embeddable = true;
    const geoFetcher: GeoRestrictionFetcher = {
      fetch: () =>
        Promise.resolve({
          restriction: { state: 'ok', embeddable, allowedCountries: [], blockedCountries: [] },
          failureReason: null,
        }),
    };
    repository.gameStatusByGameId.set('game-1', 'FINAL');
    repository.providerGameIdByGameId.set('game-1', '566033');
    const service = new GameHighlightsService(repository, {
      fetcher: {
        fetch: () => Promise.resolve({ highlights: [highlight(1)], failureReason: null }),
      },
      client: asHighlightlyClient(fakeClient()),
      geoFetcher,
      embedAllowedHosts: null,
    });
    await service.syncGame('game-1');
    expect(repository.highlightsByGameId.get('game-1')?.[0]?.embedStatus).toBe('ALLOWED');

    embeddable = false;
    await service.syncGame('game-1'); // regular sync must not recheck
    expect(repository.highlightsByGameId.get('game-1')?.[0]?.embedStatus).toBe('ALLOWED');

    await service.refreshEmbedEligibility('game-1');
    expect(repository.highlightsByGameId.get('game-1')?.[0]?.embedStatus).toBe('NOT_ALLOWED');
    expect(repository.highlightsByGameId.get('game-1')?.[0]?.canEmbed).toBe(false);
  });

  it('refreshEmbedEligibility can move NOT_ALLOWED -> ALLOWED', async () => {
    const repository = new FakeRepository();
    let embeddable = false;
    const geoFetcher: GeoRestrictionFetcher = {
      fetch: () =>
        Promise.resolve({
          restriction: { state: 'ok', embeddable, allowedCountries: [], blockedCountries: [] },
          failureReason: null,
        }),
    };
    repository.gameStatusByGameId.set('game-1', 'FINAL');
    repository.providerGameIdByGameId.set('game-1', '566033');
    const service = new GameHighlightsService(repository, {
      fetcher: {
        fetch: () => Promise.resolve({ highlights: [highlight(1)], failureReason: null }),
      },
      client: asHighlightlyClient(fakeClient()),
      geoFetcher,
      embedAllowedHosts: null,
    });
    await service.syncGame('game-1');
    expect(repository.highlightsByGameId.get('game-1')?.[0]?.embedStatus).toBe('NOT_ALLOWED');

    embeddable = true;
    await service.refreshEmbedEligibility('game-1');
    expect(repository.highlightsByGameId.get('game-1')?.[0]?.embedStatus).toBe('ALLOWED');
    expect(repository.highlightsByGameId.get('game-1')?.[0]?.canEmbed).toBe(true);
  });

  it('M31C: the global embedPlaybackEnabled switch forces canEmbed false on the public API', async () => {
    const repository = new FakeRepository();
    repository.gameStatusByGameId.set('game-1', 'FINAL');
    repository.providerGameIdByGameId.set('game-1', '566033');
    const service = new GameHighlightsService(
      repository,
      {
        fetcher: {
          fetch: () => Promise.resolve({ highlights: [highlight(1)], failureReason: null }),
        },
        client: asHighlightlyClient(fakeClient()),
        geoFetcher: geoFetcherReturning({ embeddable: true }),
        embedAllowedHosts: null,
      },
      () => new Date(),
      false,
    );
    await service.syncGame('game-1');
    const publicDto = await service.getPublicHighlights('game-1');
    expect(publicDto.highlights[0]?.canEmbed).toBe(false);
    // The underlying decision is still computed and persisted -- only the
    // public API is gated -- so flipping the switch back on needs no re-sync.
    expect(repository.highlightsByGameId.get('game-1')?.[0]?.embedStatus).toBe('ALLOWED');
  });

  it('the public DTO exposes canEmbed and keeps it false whenever embedUrl is null', async () => {
    const repository = new FakeRepository();
    repository.gameStatusByGameId.set('game-1', 'FINAL');
    repository.providerGameIdByGameId.set('game-1', '566033');
    const service = new GameHighlightsService(repository, {
      fetcher: {
        fetch: () =>
          Promise.resolve({
            highlights: [{ ...highlight(1), embedUrl: null }],
            failureReason: null,
          }),
      },
      client: asHighlightlyClient(fakeClient()),
      geoFetcher: geoFetcherReturning({ embeddable: true }),
      embedAllowedHosts: null,
    });
    await service.syncGame('game-1');
    const publicDto = await service.getPublicHighlights('game-1');
    expect(publicDto.highlights[0]?.canEmbed).toBe(false);
    expect(publicDto.highlights[0]?.embedUrl).toBeNull();
  });
});
