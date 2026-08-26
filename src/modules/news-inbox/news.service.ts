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
}

export interface IngestionResultDto {
  readonly sourceId: string;
  readonly sourceSlug: string;
  readonly testedOnly: boolean;
  readonly notModified: boolean;
  readonly feedKind: 'RSS' | 'ATOM' | null;
  readonly run: ReturnType<typeof toNewsIngestionRunDto>;
}

export class NewsInboxService implements NewsInboxServiceContract {
  constructor(
    private readonly repository: NewsInboxRepository,
    private readonly feedClient: FeedClient,
    private readonly now: () => Date = () => new Date(),
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
    try {
      const response = await this.feedClient.fetch(source.feedUrl, {
        etag: source.responseEtag,
        modified: source.responseModified,
      });
      responseBytes = response.bytes;
      responseEtag = response.etag ?? responseEtag;
      responseModified = response.modified ?? responseModified;
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
      let created = 0;
      let updated = 0;
      let skipped = 0;
      let failed = 0;
      let firstFailure: { code: string; summary: string } | null = null;
      if (!testedOnly) {
        const teams = await this.repository.listSuggestionTeams();
        for (const entry of parsed.entries.slice(
          0,
          Math.max(0, Math.min(MAXIMUM_WRITES_PER_RUN, maximumWrites)),
        )) {
          try {
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
        skipped = parsed.entries.length;
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
