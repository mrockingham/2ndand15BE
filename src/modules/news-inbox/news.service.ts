import type { NewsCandidateStatus, NewsSourceStatus } from '../../generated/prisma/client.js';
import { AppError } from '../../common/errors/app-error.js';
import type { AdministrativePrincipal } from '../admin/admin-authorization.js';
import type { ArticleCreateInput } from '../articles/article.schemas.js';
import { prepareArticleCreate } from '../articles/article.service.js';
import {
  toConvertedArticleDto,
  toNewsCandidateDetailDto,
  toNewsCandidateListDto,
  toNewsIngestionRunDto,
  toNewsSourceDto,
  type AutoPublishCandidateRecord,
  type CandidateConversionResult,
  type NewsCandidateRecord,
  type NewsSourceRecord,
} from './news.dto.js';
import type { FeedClient } from './feed-client.js';
import {
  parseNewsFeed,
  sanitizeSourceDescription,
  type NormalizedFeedEntry,
} from './feed-parser.js';
import { classifyInitialIngestEntries, isLateOutOfOrderEntry } from './initial-ingest-policy.js';
import { evaluateAutoPublishBatch } from './auto-publish-batch.js';
import type { NewsInboxRepository, TeamSuggestionWrite } from './news.repository.js';
import {
  newsSourceCreateSchema,
  type ManualCandidateCreateInput,
  type NewsCandidateConvertInput,
  type NewsCandidateListQuery,
  type NewsSourceCreateInput,
  type NewsSourceListQuery,
  type NewsSourceUpdateInput,
} from './news.schemas.js';
import { normalizeNewsUrl } from './news-url.js';

const MAXIMUM_FEED_ENTRIES = 100;
const MAXIMUM_WRITES_PER_RUN = 100;
const TEAM_ALIASES: Readonly<Record<string, readonly string[]>> = {
  WAS: ['WSH'],
  JAX: ['JAC'],
};

/** M30D: bounds applied only to a source's first-ever completed ingest, plus the
 * steady-state late/out-of-order tolerance applied afterward. See
 * `initial-ingest-policy.ts` and `docs/news/official-team-source-activation.md`. */
export interface NewsIngestionPolicyConfig {
  readonly initialLookbackHours: number;
  readonly initialMaxItemsPerSource: number;
  readonly lateItemToleranceHours: number;
}

export const DEFAULT_NEWS_INGESTION_POLICY: NewsIngestionPolicyConfig = {
  initialLookbackHours: 72,
  initialMaxItemsPerSource: 25,
  lateItemToleranceHours: 48,
};

/** M42B. `enabled` is the global kill switch -- see `docs/news-source-ingestion.md`. */
export interface NewsAutoPublishPolicyConfig {
  readonly enabled: boolean;
  readonly maxAgeHours: number;
  readonly maxPerRun: number;
  readonly maxPerSourcePerRun: number;
  readonly minDescriptionLength: number;
}

export const DEFAULT_NEWS_AUTO_PUBLISH_POLICY: NewsAutoPublishPolicyConfig = {
  enabled: false,
  maxAgeHours: 24,
  maxPerRun: 20,
  maxPerSourcePerRun: 10,
  minDescriptionLength: 40,
};

/** M42B: the DB account attributed on every auto-published article's audit
 * trail and `createdBySnapshot`/`reviewedBySnapshot` fields -- never the
 * human `NEWS_INGESTION_ACTOR_EMAIL` that runs the CLI, so accountability is
 * never falsified as a human editorial action (ticket §O). This service
 * itself never looks this account up -- `autoPublishEligibleCandidates`
 * takes its `actor` as a parameter, same as every other write path here.
 * The caller (`src/commands/news-ingest.ts`'s `requireSystemActor`) resolves
 * this email to a real, active EDITOR/ADMIN `User` row and fails closed if
 * it doesn't exist, rather than creating it lazily or silently falling back
 * to the human CLI actor. */
export const NEWS_AUTO_PUBLISH_SYSTEM_ACTOR_EMAIL = 'news-auto-publish@system.2ndand15.internal';

export interface AutoPublishItemDto {
  readonly candidateId: string;
  readonly sourceSlug: string;
  readonly headline: string;
  readonly sourcePublishedAt: string | null;
  readonly outcome: 'PUBLISHED' | 'ELIGIBLE' | 'SKIPPED' | 'FAILED';
  readonly reason: string | null;
  readonly articleId: string | null;
}

export interface AutoPublishRunDto {
  readonly dryRun: boolean;
  readonly evaluated: number;
  readonly eligible: number;
  readonly published: number;
  readonly skipped: number;
  readonly failed: number;
  readonly items: readonly AutoPublishItemDto[];
}

export interface NewsSourcePageDto {
  readonly sources: readonly ReturnType<typeof toNewsSourceDto>[];
  readonly nextCursor: string | null;
}

export interface NewsCandidatePageDto {
  readonly candidates: readonly ReturnType<typeof toNewsCandidateListDto>[];
  readonly nextCursor: string | null;
}

export interface NewsInboxServiceContract {
  listSources(query: NewsSourceListQuery): Promise<NewsSourcePageDto>;
  getSource(id: string): Promise<{
    source: ReturnType<typeof toNewsSourceDto>;
    recentRuns: readonly ReturnType<typeof toNewsIngestionRunDto>[];
  }>;
  createSource(
    input: NewsSourceCreateInput,
    actor: AdministrativePrincipal,
    requestId: string | null,
  ): Promise<ReturnType<typeof toNewsSourceDto>>;
  updateSource(
    id: string,
    input: NewsSourceUpdateInput,
    actor: AdministrativePrincipal,
    requestId: string | null,
  ): Promise<ReturnType<typeof toNewsSourceDto>>;
  pauseSource(
    id: string,
    actor: AdministrativePrincipal,
    requestId: string | null,
  ): Promise<ReturnType<typeof toNewsSourceDto>>;
  resumeSource(
    id: string,
    actor: AdministrativePrincipal,
    requestId: string | null,
  ): Promise<ReturnType<typeof toNewsSourceDto>>;
  testSource(
    id: string,
    actor: AdministrativePrincipal,
    requestId: string | null,
  ): Promise<IngestionResultDto>;
  ingestSource(
    id: string,
    actor: AdministrativePrincipal,
    requestId: string | null,
    maximumWrites?: number,
  ): Promise<IngestionResultDto>;
  listCandidates(query: NewsCandidateListQuery): Promise<NewsCandidatePageDto>;
  getCandidate(id: string): Promise<ReturnType<typeof toNewsCandidateDetailDto>>;
  createManualCandidate(
    input: ManualCandidateCreateInput,
    actor: AdministrativePrincipal,
    requestId: string | null,
  ): Promise<ReturnType<typeof toNewsCandidateDetailDto>>;
  reviewCandidate(
    id: string,
    actor: AdministrativePrincipal,
    requestId: string | null,
  ): Promise<ReturnType<typeof toNewsCandidateDetailDto>>;
  saveCandidate(
    id: string,
    actor: AdministrativePrincipal,
    requestId: string | null,
  ): Promise<ReturnType<typeof toNewsCandidateDetailDto>>;
  dismissCandidate(
    id: string,
    reason: string,
    actor: AdministrativePrincipal,
    requestId: string | null,
  ): Promise<ReturnType<typeof toNewsCandidateDetailDto>>;
  convertCandidate(
    id: string,
    input: NewsCandidateConvertInput,
    actor: AdministrativePrincipal,
    requestId: string | null,
  ): Promise<CandidateConversionResult>;
  previewAutoPublish(): Promise<AutoPublishRunDto>;
  autoPublishEligibleCandidates(
    actor: AdministrativePrincipal,
    requestId: string | null,
  ): Promise<AutoPublishRunDto>;
}

export interface IngestionResultDto {
  readonly sourceId: string;
  readonly sourceSlug: string;
  readonly testedOnly: boolean;
  readonly notModified: boolean;
  readonly feedKind: 'RSS' | 'ATOM' | null;
  readonly run: ReturnType<typeof toNewsIngestionRunDto>;
  /** M30D: true when this run was (or, for a dry-run test, would have been) the
   * source's bounded initial ingest -- i.e. no real candidate had ever been written
   * for this source when the run started. */
  readonly initialIngest: boolean;
  /** M30D: counts of entries this run did not write for policy reasons, broken out
   * from the existing `run.skippedCount` total (which also includes ordinary
   * unchanged-duplicate skips). Zero outside the cases they describe. */
  readonly diagnostics: {
    readonly outsideLookback: number;
    readonly missingPublishedAt: number;
    readonly truncated: number;
    readonly lateRejected: number;
  };
}

export class NewsInboxService implements NewsInboxServiceContract {
  constructor(
    private readonly repository: NewsInboxRepository,
    private readonly feedClient: FeedClient,
    private readonly ingestionPolicy: NewsIngestionPolicyConfig = DEFAULT_NEWS_INGESTION_POLICY,
    private readonly now: () => Date = () => new Date(),
    private readonly autoPublishPolicy: NewsAutoPublishPolicyConfig = DEFAULT_NEWS_AUTO_PUBLISH_POLICY,
  ) {}

  async listSources(query: NewsSourceListQuery): Promise<NewsSourcePageDto> {
    const page = await this.repository.listSources(query);
    return { sources: page.sources.map(toNewsSourceDto), nextCursor: page.nextCursor };
  }

  async getSource(id: string) {
    const source = await this.requireSource(id);
    const runs = await this.repository.listRuns(id, 20);
    return { source: toNewsSourceDto(source), recentRuns: runs.map(toNewsIngestionRunDto) };
  }

  async createSource(
    input: NewsSourceCreateInput,
    actor: AdministrativePrincipal,
    requestId: string | null,
  ) {
    if ((await this.repository.findSourceBySlug(input.slug)) !== null) throw sourceSlugConflict();
    await this.validateSource(input);
    return toNewsSourceDto(await this.repository.createSource(input, actor, requestId));
  }

  async updateSource(
    id: string,
    input: NewsSourceUpdateInput,
    actor: AdministrativePrincipal,
    requestId: string | null,
  ) {
    const current = await this.requireSource(id);
    const merged = newsSourceCreateSchema.parse({
      name: input.name ?? current.name,
      slug: input.slug ?? current.slug,
      kind: input.kind ?? current.kind,
      status: input.status ?? (current.status === 'ERROR' ? 'PAUSED' : current.status),
      feedUrl: input.feedUrl === undefined ? current.feedUrl : input.feedUrl,
      siteUrl: input.siteUrl ?? current.siteUrl,
      publisherName: input.publisherName ?? current.publisherName,
      defaultTeamId:
        input.defaultTeamId === undefined ? current.defaultTeamId : input.defaultTeamId,
      isOfficialLeague: input.isOfficialLeague ?? current.isOfficialLeague,
      isOfficialTeam: input.isOfficialTeam ?? current.isOfficialTeam,
      allowsDescriptionUse: input.allowsDescriptionUse ?? current.allowsDescriptionUse,
      autoPublishArticles: input.autoPublishArticles ?? current.autoPublishArticles,
      notes: input.notes === undefined ? current.notes : input.notes,
    });
    if (
      merged.slug !== current.slug &&
      (await this.repository.findSourceBySlug(merged.slug)) !== null
    )
      throw sourceSlugConflict();
    await this.validateSource(merged);
    const updated = await this.repository.updateSource(id, input, actor, requestId);
    if (updated === null) throw sourceNotFound();
    return toNewsSourceDto(updated);
  }

  pauseSource(id: string, actor: AdministrativePrincipal, requestId: string | null) {
    return this.changeSourceStatus(id, 'PAUSED', actor, requestId);
  }

  resumeSource(id: string, actor: AdministrativePrincipal, requestId: string | null) {
    return this.changeSourceStatus(id, 'ACTIVE', actor, requestId);
  }

  async testSource(
    id: string,
    actor: AdministrativePrincipal,
    requestId: string | null,
  ): Promise<IngestionResultDto> {
    try {
      const result = await this.runSource(id, actor, requestId, true);
      const source = await this.requireSource(id);
      await this.repository.createSourceAudit(source, 'NEWS_SOURCE_TESTED', actor, requestId, {
        runId: result.run.id,
        status: result.run.status,
        fetchedCount: result.run.fetchedCount,
        feedKind: result.feedKind,
      });
      return result;
    } catch (error) {
      const source = await this.requireSource(id);
      const details = safeError(error);
      await this.repository.createSourceAudit(source, 'NEWS_SOURCE_TESTED', actor, requestId, {
        status: 'FAILED',
        errorCode: details.code,
      });
      throw error;
    }
  }

  ingestSource(
    id: string,
    actor: AdministrativePrincipal,
    requestId: string | null,
    maximumWrites = MAXIMUM_WRITES_PER_RUN,
  ): Promise<IngestionResultDto> {
    return this.runSource(id, actor, requestId, false, maximumWrites);
  }

  async listCandidates(query: NewsCandidateListQuery): Promise<NewsCandidatePageDto> {
    const page = await this.repository.listCandidates(query);
    return { candidates: page.candidates.map(toNewsCandidateListDto), nextCursor: page.nextCursor };
  }

  async getCandidate(id: string) {
    return toNewsCandidateDetailDto(await this.requireCandidate(id));
  }

  async createManualCandidate(
    input: ManualCandidateCreateInput,
    actor: AdministrativePrincipal,
    requestId: string | null,
  ) {
    const normalized = normalizeNewsUrl(input.url);
    if (input.sourceId !== null) await this.requireSource(input.sourceId);
    const sourceDescription =
      input.sourceDescription === null ? null : sanitizeSourceDescription(input.sourceDescription);
    const teams = await this.requireActiveTeams(input.suggestedTeamIds);
    const suggestions = teams.map(({ id }) => ({ teamId: id, rule: 'EDITOR_SUPPLIED' }));
    const candidate = await this.repository.createManualCandidate(
      { ...input, sourceDescription },
      normalized.url,
      normalized.hash,
      suggestions,
      actor,
      requestId,
      this.now(),
    );
    if (candidate === null) throw candidateDuplicate();
    return toNewsCandidateDetailDto(candidate);
  }

  reviewCandidate(id: string, actor: AdministrativePrincipal, requestId: string | null) {
    return this.transitionCandidate(id, ['NEW', 'SAVED'], 'REVIEWING', null, actor, requestId);
  }

  saveCandidate(id: string, actor: AdministrativePrincipal, requestId: string | null) {
    return this.transitionCandidate(id, ['NEW', 'REVIEWING'], 'SAVED', null, actor, requestId);
  }

  dismissCandidate(
    id: string,
    reason: string,
    actor: AdministrativePrincipal,
    requestId: string | null,
  ) {
    return this.transitionCandidate(
      id,
      ['NEW', 'REVIEWING', 'SAVED'],
      'DISMISSED',
      reason,
      actor,
      requestId,
    );
  }

  async convertCandidate(
    id: string,
    input: NewsCandidateConvertInput,
    actor: AdministrativePrincipal,
    requestId: string | null,
  ): Promise<CandidateConversionResult> {
    const candidate = await this.requireCandidate(id);
    if (!['NEW', 'REVIEWING', 'SAVED'].includes(candidate.status)) throw candidateStateConflict();
    if (
      candidate.sourceDescription !== null &&
      normalizeForComparison(candidate.sourceDescription) ===
        normalizeForComparison(input.originalSummary)
    ) {
      throw new AppError({
        code: 'NEWS_CANDIDATE_SUMMARY_NOT_ORIGINAL',
        message:
          'The curated summary must be deliberately written and may not copy the source description verbatim.',
        statusCode: 400,
      });
    }
    await this.requireActiveTeams(input.confirmedTeamIds);
    const articleInput: ArticleCreateInput = {
      type: 'CURATED',
      title: input.title,
      ...(input.slug === undefined ? {} : { slug: input.slug }),
      summary: input.originalSummary,
      body: input.originalCommentary,
      contentType: candidate.contentType,
      mediaThumbnailUrl: candidate.mediaThumbnailUrl,
      sourceName: candidate.sourceNameSnapshot,
      sourceUrl: candidate.canonicalUrl,
      sourcePublishedAt: candidate.sourcePublishedAt?.toISOString() ?? null,
      sourceIsOfficialTeam: candidate.source?.isOfficialTeam ?? false,
      heroImageUrl: input.heroImageUrl,
      heroImageAlt: input.heroImageAlt,
      heroImageAttribution: input.heroImageAttribution,
      heroImageAttributionUrl: input.heroImageAttributionUrl,
      seoTitle: null,
      seoDescription: null,
      isFeatured: false,
      featuredPriority: null,
      featuredStartsAt: null,
      featuredEndsAt: null,
      teamIds: input.confirmedTeamIds,
      changeSummary: input.changeSummary,
    };
    const result = await this.repository.convertCandidate(
      id,
      ['NEW', 'REVIEWING', 'SAVED'],
      {
        fields: prepareArticleCreate(articleInput),
        teamIds: input.confirmedTeamIds,
        changeSummary: input.changeSummary,
      },
      actor,
      requestId,
      this.now(),
    );
    if (result === null) throw candidateConversionConflict();
    return {
      candidate: toNewsCandidateDetailDto(result.candidate),
      article: toConvertedArticleDto(result.article),
    };
  }

  /** Dry-run: evaluates the same pool and policy `autoPublishEligibleCandidates`
   * would use, but never writes and is never gated by the global kill
   * switch (an operator must be able to preview "what would happen if I
   * enabled source X" before flipping any flag -- ticket §R/§V). */
  async previewAutoPublish(): Promise<AutoPublishRunDto> {
    return this.runAutoPublishBatch(null);
  }

  autoPublishEligibleCandidates(
    actor: AdministrativePrincipal,
    requestId: string | null,
  ): Promise<AutoPublishRunDto> {
    return this.runAutoPublishBatch({ actor, requestId });
  }

  private async runAutoPublishBatch(
    publish: { readonly actor: AdministrativePrincipal; readonly requestId: string | null } | null,
  ): Promise<AutoPublishRunDto> {
    // Global kill switch: false stops the real run before it fetches
    // anything or writes anything, regardless of any source's
    // autoPublishArticles flag (ticket §T). The dry-run preview is
    // deliberately exempt -- it must still work while the switch is off.
    if (publish !== null && !this.autoPublishPolicy.enabled) {
      return {
        dryRun: false,
        evaluated: 0,
        eligible: 0,
        published: 0,
        skipped: 0,
        failed: 0,
        items: [],
      };
    }

    const now = this.now();
    // Preview reads a much larger pool than a real run needs -- it's
    // read-only and diagnostic, and an operator deciding whether to trust a
    // source needs to see past whatever older, still-untrusted backlog
    // (e.g. official-team feeds) happens to sort earlier by
    // sourcePublishedAt, not just the same small window a bounded real run
    // would touch.
    const poolSize = publish === null ? 500 : Math.max(this.autoPublishPolicy.maxPerRun * 5, 50);
    const pool = await this.repository.listAutoPublishCandidatePool(poolSize);
    const batch = evaluateAutoPublishBatch(
      pool,
      now,
      this.autoPublishPolicy,
      this.autoPublishPolicy,
    );

    const items: AutoPublishItemDto[] = [];
    let published = 0;
    let failed = 0;

    for (const entry of batch) {
      const base = {
        candidateId: entry.candidate.id,
        sourceSlug: entry.candidate.source?.slug ?? 'unknown',
        headline: entry.candidate.headline,
        sourcePublishedAt: entry.candidate.sourcePublishedAt?.toISOString() ?? null,
      };
      if (!entry.shouldPublish) {
        items.push({ ...base, outcome: 'SKIPPED', reason: entry.reason, articleId: null });
        continue;
      }
      if (publish === null) {
        items.push({ ...base, outcome: 'ELIGIBLE', reason: null, articleId: null });
        continue;
      }
      try {
        const articleInput = buildAutoPublishArticleInput(entry.candidate);
        const result = await this.repository.convertCandidate(
          entry.candidate.id,
          ['NEW'],
          {
            fields: prepareArticleCreate(articleInput),
            teamIds: entry.candidate.suggestedTeams.map((suggestion) => suggestion.teamId),
            changeSummary: 'Auto-published from a trusted source feed (M42B).',
            publish: { status: 'PUBLISHED', publishedAt: now },
          },
          publish.actor,
          publish.requestId,
          now,
          'NEWS_CANDIDATE_AUTO_PUBLISHED',
          'AUTO_PUBLISH',
        );
        if (result === null) {
          // Another process converted/dismissed this candidate between the
          // pool read and this write -- leave it alone, don't retry, don't
          // fail the run (ticket §L/§Z).
          items.push({
            ...base,
            outcome: 'SKIPPED',
            reason: 'CONCURRENT_STATE_CHANGE',
            articleId: null,
          });
          continue;
        }
        published += 1;
        items.push({ ...base, outcome: 'PUBLISHED', reason: null, articleId: result.article.id });
      } catch (error) {
        // One candidate's failure never aborts the run -- log-equivalent
        // structured detail on the item, leave the candidate NEW (nothing
        // was written for it), and continue (ticket §Z).
        failed += 1;
        items.push({ ...base, outcome: 'FAILED', reason: safeError(error).code, articleId: null });
      }
    }

    const eligible = items.filter(
      (item) => item.outcome === 'PUBLISHED' || item.outcome === 'ELIGIBLE',
    ).length;
    return {
      dryRun: publish === null,
      evaluated: items.length,
      eligible,
      published,
      skipped: items.filter((item) => item.outcome === 'SKIPPED').length,
      failed,
      items,
    };
  }

  private async runSource(
    id: string,
    actor: AdministrativePrincipal,
    requestId: string | null,
    testedOnly: boolean,
    maximumWrites = MAXIMUM_WRITES_PER_RUN,
  ): Promise<IngestionResultDto> {
    const source = await this.requireSource(id);
    if (source.kind === 'MANUAL_ONLY' || source.feedUrl === null) {
      throw new AppError({
        code: 'NEWS_SOURCE_NOT_FETCHABLE',
        message: 'Manual-only sources cannot be fetched.',
        statusCode: 409,
      });
    }
    if (
      source.status === 'DISABLED' ||
      (!testedOnly && !['ACTIVE', 'ERROR'].includes(source.status))
    ) {
      throw new AppError({
        code: 'NEWS_SOURCE_NOT_ACTIVE',
        message: 'The source is not active for ingestion.',
        statusCode: 409,
      });
    }
    const startedAt = this.now();
    const lease = await this.repository.acquireIngestionLease(id, actor, requestId, startedAt);
    if (lease === null) {
      throw new AppError({
        code: 'NEWS_INGESTION_ALREADY_RUNNING',
        message: 'This source already has an active ingestion run.',
        statusCode: 409,
      });
    }
    let responseBytes: number | null = null;
    let responseEtag = source.responseEtag;
    let responseModified = source.responseModified;
    // M30D: a source that has never written a real candidate gets its one-time
    // bounded initial ingest (recent-only, capped, no blind import of dateless
    // items); every later run is steady-state and unbounded by this policy.
    // Deliberately keyed off actual candidate rows, not `lastSuccessfulAt` -- a
    // no-write `testSource` dry run completes successfully too (pre-existing
    // behavior) and must not be mistaken for a real first ingest.
    const isInitialIngest = !(await this.repository.hasAnyCandidates(source.id));
    try {
      const response = await this.feedClient.fetch(source.feedUrl, {
        etag: source.responseEtag,
        modified: source.responseModified,
      });
      responseBytes = response.bytes;
      // M42A: a `testSource()` dry run must never advance the persisted
      // conditional-GET cache validators -- doing so previously left the
      // source primed to receive a 304 Not Modified on the very next real
      // `ingestSource()` call if the remote feed hadn't changed in the
      // interim, silently turning a real (possibly bounded-initial) ingest
      // into a no-op with zero candidates created. `testedOnly` therefore
      // keeps whatever validators the source already had; only a real run
      // is allowed to move them forward.
      if (!testedOnly) {
        responseEtag = response.etag ?? responseEtag;
        responseModified = response.modified ?? responseModified;
      }
      if (response.notModified) {
        const run = await this.repository.completeIngestion(
          lease,
          completion('SUCCEEDED', 0, 0, 0, 0, 0, responseBytes, responseEtag, responseModified),
          this.now(),
        );
        return {
          sourceId: source.id,
          sourceSlug: source.slug,
          testedOnly,
          notModified: true,
          feedKind: null,
          run: toNewsIngestionRunDto(run),
          initialIngest: isInitialIngest,
          diagnostics: { outsideLookback: 0, missingPublishedAt: 0, truncated: 0, lateRejected: 0 },
        };
      }
      const parsed = parseNewsFeed(response.body ?? '', MAXIMUM_FEED_ENTRIES);
      if (parsed.kind !== source.kind) {
        throw new AppError({
          code: 'NEWS_FEED_KIND_MISMATCH',
          message: `The source is configured as ${source.kind} but returned ${parsed.kind}.`,
          statusCode: 422,
        });
      }
      let entriesToProcess: readonly NormalizedFeedEntry[] = parsed.entries;
      let outsideLookbackCount = 0;
      let missingPublishedAtCount = 0;
      let truncatedCount = 0;
      if (isInitialIngest) {
        const classification = classifyInitialIngestEntries(parsed.entries, this.now(), {
          lookbackHours: this.ingestionPolicy.initialLookbackHours,
          maxItemsPerSource: this.ingestionPolicy.initialMaxItemsPerSource,
        });
        entriesToProcess = classification.eligible;
        outsideLookbackCount = classification.outsideLookback.length;
        missingPublishedAtCount = classification.missingPublishedAt.length;
        truncatedCount = classification.truncated.length;
      }
      let created = 0;
      let updated = 0;
      let skipped = outsideLookbackCount + missingPublishedAtCount + truncatedCount;
      let failed = 0;
      let lateRejected = 0;
      let firstFailure: { code: string; summary: string } | null = null;
      if (!testedOnly) {
        const teams = await this.repository.listSuggestionTeams();
        // M30D: steady-state runs compare unseen entries against the newest
        // publication time this source has ever persisted, so a feed that reorders
        // itself can't silently backfill old, never-before-seen content.
        const lateItemWatermark = isInitialIngest
          ? null
          : await this.repository.getMaxCandidatePublishedAt(source.id);
        for (const entry of entriesToProcess.slice(
          0,
          Math.max(0, Math.min(MAXIMUM_WRITES_PER_RUN, maximumWrites)),
        )) {
          try {
            if (
              !isInitialIngest &&
              isLateOutOfOrderEntry(entry, lateItemWatermark, {
                toleranceHours: this.ingestionPolicy.lateItemToleranceHours,
              }) &&
              !(await this.repository.candidateExists(
                source.id,
                entry.externalId,
                entry.canonicalUrlHash,
              ))
            ) {
              lateRejected += 1;
              skipped += 1;
              continue;
            }
            const result = await this.repository.upsertFeedCandidate(
              source,
              entry,
              suggestTeams(source, entry, teams),
              this.now(),
            );
            if (result.action === 'created') created += 1;
            else if (result.action === 'updated') updated += 1;
            else skipped += 1;
          } catch (error) {
            failed += 1;
            firstFailure ??= safeError(error);
          }
        }
      } else {
        skipped += entriesToProcess.length;
      }
      const status = failed > 0 ? 'PARTIAL' : 'SUCCEEDED';
      const result = completion(
        status,
        parsed.entries.length,
        created,
        updated,
        skipped,
        failed,
        responseBytes,
        responseEtag,
        responseModified,
      );
      const run = await this.repository.completeIngestion(
        lease,
        failed === 0
          ? result
          : {
              ...result,
              errorCode: firstFailure?.code ?? 'NEWS_CANDIDATE_WRITE_PARTIAL',
              errorSummary:
                firstFailure === null
                  ? `${String(failed)} candidate entries could not be persisted.`
                  : `${String(failed)} candidate entries could not be persisted: ${firstFailure.summary}`.slice(
                      0,
                      500,
                    ),
            },
        this.now(),
      );
      return {
        sourceId: source.id,
        sourceSlug: source.slug,
        testedOnly,
        notModified: false,
        feedKind: parsed.kind,
        run: toNewsIngestionRunDto(run),
        initialIngest: isInitialIngest,
        diagnostics: {
          outsideLookback: outsideLookbackCount,
          missingPublishedAt: missingPublishedAtCount,
          truncated: truncatedCount,
          lateRejected,
        },
      };
    } catch (error) {
      const details = safeError(error);
      await this.repository.completeIngestion(
        lease,
        {
          ...completion('FAILED', 0, 0, 0, 0, 1, responseBytes, responseEtag, responseModified),
          errorCode: details.code,
          errorSummary: details.summary,
        },
        this.now(),
      );
      throw error;
    }
  }

  private async validateSource(input: NewsSourceCreateInput): Promise<void> {
    if (input.feedUrl !== null) await this.feedClient.validateUrl(input.feedUrl);
    if (input.defaultTeamId !== null) await this.requireActiveTeams([input.defaultTeamId]);
  }

  private async requireSource(id: string): Promise<NewsSourceRecord> {
    const source = await this.repository.findSource(id);
    if (source === null) throw sourceNotFound();
    return source;
  }

  private async requireCandidate(id: string): Promise<NewsCandidateRecord> {
    const candidate = await this.repository.findCandidate(id);
    if (candidate === null) throw candidateNotFound();
    return candidate;
  }

  private async requireActiveTeams(teamIds: readonly string[]) {
    if (teamIds.length === 0) return [];
    const teams = await this.repository.listSuggestionTeams();
    const selected = teams.filter(({ id }) => teamIds.includes(id));
    if (selected.length !== teamIds.length) {
      throw new AppError({
        code: 'ACTIVE_TEAM_NOT_FOUND',
        message: 'Every team must identify an active NFL team.',
        statusCode: 404,
      });
    }
    return selected;
  }

  private async transitionCandidate(
    id: string,
    expected: readonly NewsCandidateStatus[],
    status: NewsCandidateStatus,
    reason: string | null,
    actor: AdministrativePrincipal,
    requestId: string | null,
  ) {
    await this.requireCandidate(id);
    const candidate = await this.repository.updateCandidateStatus(
      id,
      expected,
      status,
      reason,
      actor,
      requestId,
      this.now(),
    );
    if (candidate === null) throw candidateStateConflict();
    return toNewsCandidateDetailDto(candidate);
  }

  private async changeSourceStatus(
    id: string,
    status: NewsSourceStatus,
    actor: AdministrativePrincipal,
    requestId: string | null,
  ) {
    const source = await this.requireSource(id);
    if (source.status === status)
      throw new AppError({
        code: 'NEWS_SOURCE_STATUS_CONFLICT',
        message: `The source is already ${status.toLowerCase()}.`,
        statusCode: 409,
      });
    const updated = await this.repository.setSourceStatus(id, status, actor, requestId);
    if (updated === null) throw sourceNotFound();
    return toNewsSourceDto(updated);
  }
}

function suggestTeams(
  source: NewsSourceRecord,
  entry: NormalizedFeedEntry,
  teams: readonly { id: string; fullName: string; abbreviation: string }[],
): TeamSuggestionWrite[] {
  const suggestions = new Map<string, TeamSuggestionWrite>();
  if (source.defaultTeamId !== null) {
    suggestions.set(source.defaultTeamId, {
      teamId: source.defaultTeamId,
      rule: 'SOURCE_DEFAULT_TEAM',
    });
  }
  for (const team of teams) {
    if (containsExact(entry.headline, team.fullName)) {
      suggestions.set(team.id, { teamId: team.id, rule: 'EXACT_FULL_NAME' });
      continue;
    }
    const abbreviations = [team.abbreviation, ...(TEAM_ALIASES[team.abbreviation] ?? [])];
    if (abbreviations.some((abbreviation) => containsExact(entry.headline, abbreviation))) {
      suggestions.set(team.id, { teamId: team.id, rule: 'EXACT_ABBREVIATION' });
    }
  }
  return [...suggestions.values()];
}

function containsExact(headline: string, term: string): boolean {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^A-Za-z0-9])${escaped}([^A-Za-z0-9]|$)`, 'i').test(headline);
}

function completion(
  status: 'SUCCEEDED' | 'PARTIAL' | 'FAILED',
  fetchedCount: number,
  createdCount: number,
  updatedCount: number,
  skippedCount: number,
  failedCount: number,
  responseBytes: number | null,
  responseEtag: string | null,
  responseModified: string | null,
) {
  return {
    status,
    fetchedCount,
    createdCount,
    updatedCount,
    skippedCount,
    failedCount,
    responseBytes,
    responseEtag,
    responseModified,
    errorCode: null,
    errorSummary: null,
  } as const;
}

function safeError(error: unknown): { code: string; summary: string } {
  if (error instanceof AppError) return { code: error.code, summary: error.message.slice(0, 500) };
  return {
    code: 'NEWS_INGESTION_FAILED',
    summary:
      error instanceof Error
        ? error.message.replace(/[\r\n]+/g, ' ').slice(0, 500)
        : 'The ingestion run failed.',
  };
}

function normalizeForComparison(value: string): string {
  return value.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
}

const ARTICLE_SUMMARY_MAX_LENGTH = 1_000;

/** M42B rights-model boundary: `body` is always null -- there is no human
 * commentary and no scraped/AI-generated body text, ever. `summary` is the
 * source's own feed description verbatim (eligibility already required
 * `source.allowsDescriptionUse` and a minimum length), truncated to
 * `Article.summary`'s DB column width since candidate descriptions are
 * bounded to 2,000 chars at ingestion but the column is 1,000. Every field
 * here traces back to data the ingestion pipeline already validated --
 * nothing is fetched, enriched, or invented for this article. */
function buildAutoPublishArticleInput(candidate: AutoPublishCandidateRecord): ArticleCreateInput {
  return {
    type: 'CURATED',
    title: candidate.headline,
    summary: (candidate.sourceDescription ?? '').trim().slice(0, ARTICLE_SUMMARY_MAX_LENGTH),
    body: null,
    contentType: candidate.contentType,
    mediaThumbnailUrl: candidate.mediaThumbnailUrl,
    sourceName: candidate.sourceNameSnapshot,
    sourceUrl: candidate.canonicalUrl,
    sourcePublishedAt: candidate.sourcePublishedAt?.toISOString() ?? null,
    sourceIsOfficialTeam: candidate.source?.isOfficialTeam ?? false,
    heroImageUrl: null,
    heroImageAlt: null,
    heroImageAttribution: null,
    heroImageAttributionUrl: null,
    seoTitle: null,
    seoDescription: null,
    isFeatured: false,
    featuredPriority: null,
    featuredStartsAt: null,
    featuredEndsAt: null,
    teamIds: candidate.suggestedTeams.map((suggestion) => suggestion.teamId),
    changeSummary: 'Auto-published from a trusted source feed (M42B).',
  };
}

function sourceNotFound(): AppError {
  return new AppError({
    code: 'NEWS_SOURCE_NOT_FOUND',
    message: 'The requested news source was not found.',
    statusCode: 404,
  });
}

function sourceSlugConflict(): AppError {
  return new AppError({
    code: 'NEWS_SOURCE_SLUG_CONFLICT',
    message: 'A news source already uses this slug.',
    statusCode: 409,
  });
}

function candidateNotFound(): AppError {
  return new AppError({
    code: 'NEWS_CANDIDATE_NOT_FOUND',
    message: 'The requested news candidate was not found.',
    statusCode: 404,
  });
}

function candidateDuplicate(): AppError {
  return new AppError({
    code: 'NEWS_CANDIDATE_DUPLICATE',
    message: 'A candidate with this canonical URL already exists.',
    statusCode: 409,
  });
}

function candidateStateConflict(): AppError {
  return new AppError({
    code: 'NEWS_CANDIDATE_STATUS_CONFLICT',
    message: 'The candidate cannot make that editorial transition from its current state.',
    statusCode: 409,
  });
}

function candidateConversionConflict(): AppError {
  return new AppError({
    code: 'NEWS_CANDIDATE_CONVERSION_CONFLICT',
    message:
      'The candidate changed, was already converted, has invalid teams, or the article slug is unavailable.',
    statusCode: 409,
  });
}
