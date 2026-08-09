import { createHash } from 'node:crypto';

import { AppError } from '../../common/errors/app-error.js';
import type { EditorialAiReviewStatus } from '../../generated/prisma/client.js';
import type { AdministrativePrincipal } from '../admin/admin-authorization.js';
import { articleCreateSchema } from '../articles/article.schemas.js';
import { normalizeSlug, prepareArticleCreate } from '../articles/article.service.js';
import type {
  EditorialAiProvider,
  EditorialDraft,
  EditorialSourceMaterial,
} from './editorial-ai.provider.js';
import type {
  DraftPersistenceInput,
  DuplicateArticle,
  DuplicateCandidate,
  EditorialAiRepository,
  EditorialCandidate,
  EditorialCoverageRow,
  EditorialTeam,
  SourceRightsWrite,
  MediaCandidateWrite,
} from './editorial-ai.repository.js';

const MAX_BATCH_SIZE = 10;
const BATCH_CONCURRENCY = 2;
const SOURCE_OVERLAP_THRESHOLD = 0.35;
const TEAM_ALIASES: Readonly<Record<string, string>> = { WSH: 'WAS', JAC: 'JAX' };

export interface GenerateDraftResult {
  readonly article: {
    readonly id: string;
    readonly slug: string;
    readonly version: number;
    readonly status: 'DRAFT';
  };
  readonly reviewStatus: 'NEEDS_REVIEW';
  readonly candidateId: string;
  readonly primaryTeamId: string | null;
  readonly additionalTeamIds: readonly string[];
  readonly playerIds: readonly string[];
  readonly unresolvedPlayers: readonly { readonly name: string; readonly team: string | null }[];
  readonly category: EditorialDraft['category'];
  readonly topicTags: readonly string[];
  readonly confidence: EditorialDraft['confidence'];
  readonly riskFlags: readonly string[];
  readonly overlap: DuplicateResult;
  readonly sourceOverlapScore: number;
  readonly mediaSearchTerms: readonly string[];
  readonly attribution: string;
  readonly ai: {
    readonly provider: string;
    readonly model: string;
    readonly promptVersion: string;
    readonly inputTokens: number | null;
    readonly outputTokens: number | null;
  };
  readonly performance: {
    readonly sourcePreparationMs: number;
    readonly aiDurationMs: number;
    readonly entityResolutionMs: number;
    readonly duplicateDetectionMs: number;
    readonly totalMs: number;
  };
}

export interface DuplicateResult {
  readonly status: 'UNIQUE' | 'RELATED' | 'LIKELY_DUPLICATE' | 'DUPLICATE';
  readonly score: number | null;
  readonly closestCandidateId: string | null;
  readonly closestArticleId: string | null;
}

export interface EditorialAiServiceContract {
  generateDraft(
    candidateId: string,
    actor: AdministrativePrincipal,
    requestId: string | null,
    instruction?: string,
  ): Promise<GenerateDraftResult>;
  generateBatch(
    candidateIds: readonly string[],
    actor: AdministrativePrincipal,
    requestId: string | null,
  ): Promise<BatchResult>;
  regenerateDraft(
    articleId: string,
    expectedVersion: number,
    actor: AdministrativePrincipal,
    requestId: string | null,
    instruction?: string,
  ): Promise<GenerateDraftResult>;
  coverage(target: number): Promise<CoverageResult>;
  setReviewStatus(
    articleId: string,
    status: EditorialAiReviewStatus,
    actor: AdministrativePrincipal,
    requestId: string | null,
  ): Promise<{ readonly articleId: string; readonly reviewStatus: EditorialAiReviewStatus }>;
  attachMedia(
    articleId: string,
    mediaId: string,
    actor: AdministrativePrincipal,
    requestId: string | null,
  ): Promise<{
    readonly articleId: string;
    readonly mediaCandidateId: string;
    readonly status: 'ATTACHED';
  }>;
  createMediaCandidate(
    articleId: string,
    input: Omit<MediaCandidateWrite, 'publishedAt'> & { readonly publishedAt: string | null },
    actor: AdministrativePrincipal,
    requestId: string | null,
  ): Promise<object>;
  getSourceRights(sourceId: string): Promise<ReturnType<typeof rightsDto>>;
  updateSourceRights(
    sourceId: string,
    input: SourceRightsWrite,
    actor: AdministrativePrincipal,
    requestId: string | null,
  ): Promise<ReturnType<typeof rightsDto>>;
}

export interface BatchResult {
  readonly requested: number;
  readonly generated: number;
  readonly alreadyDrafted: number;
  readonly duplicates: number;
  readonly failed: number;
  readonly flagged: number;
  readonly concurrency: number;
  readonly durationMs: number;
  readonly averageGenerationMs: number | null;
  readonly results: readonly (
    | {
        readonly candidateId: string;
        readonly outcome: 'GENERATED';
        readonly articleId: string;
        readonly riskFlags: readonly string[];
      }
    | {
        readonly candidateId: string;
        readonly outcome: 'ALREADY_DRAFTED' | 'FAILED';
        readonly errorCode: string;
      }
  )[];
}

export interface CoverageResult {
  readonly targetCount: number;
  readonly teams: readonly (EditorialCoverageRow & { readonly remainingToTarget: number })[];
  readonly totals: {
    readonly teamsAtTarget: number;
    readonly teamsBelowTarget: number;
    readonly totalPublished: number;
    readonly totalDrafts: number;
    readonly totalCandidates: number;
  };
  readonly durationMs: number;
}

export class EditorialAiService implements EditorialAiServiceContract {
  constructor(
    private readonly repository: EditorialAiRepository,
    private readonly provider: EditorialAiProvider,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async generateDraft(
    candidateId: string,
    actor: AdministrativePrincipal,
    requestId: string | null,
    instruction?: string,
  ): Promise<GenerateDraftResult> {
    const totalStarted = performance.now();
    const preparationStarted = performance.now();
    const candidate = await this.requireAvailableCandidate(candidateId);
    const rights = sourceRights(candidate);
    const source = toSourceMaterial(candidate, rights);
    const sourcePreparationMs = elapsed(preparationStarted);

    const [ai, teams, duplicateCandidates, duplicateArticles] = await Promise.all([
      this.provider.generateDraft(source, instruction),
      this.repository.listTeams(),
      this.repository.findDuplicateCandidates(candidate.id),
      this.repository.findDuplicateArticles(),
    ]);

    const entityStarted = performance.now();
    const teamResolution = resolveTeams(ai.draft, candidate, teams);
    const playerResolution = await this.resolvePlayers(ai.draft, teamResolution.teamIds, teams);
    const entityResolutionMs = elapsed(entityStarted);

    const duplicateStarted = performance.now();
    const duplicate = detectDuplicate(
      candidate,
      ai.draft.headline,
      teamResolution.teamIds,
      duplicateCandidates,
      duplicateArticles,
    );
    const duplicateDetectionMs = elapsed(duplicateStarted);
    const sourceOverlapScore =
      source.description === null ? 0 : phraseOverlap(source.description, ai.draft.body);
    const riskFlags = new Set<string>(ai.draft.riskFlags);
    if (source.description === null) riskFlags.add('THIN_SOURCE');
    if (rights.reviewRequired || rights.textUsage !== 'SUMMARY_ALLOWED')
      riskFlags.add('MEDIA_RIGHTS_UNCLEAR');
    if (duplicate.status === 'LIKELY_DUPLICATE' || duplicate.status === 'DUPLICATE')
      riskFlags.add('POSSIBLE_DUPLICATE');
    if (playerResolution.unresolved.length > 0) riskFlags.add('PLAYER_IDENTITY_UNCERTAIN');
    if (sourceOverlapScore >= SOURCE_OVERLAP_THRESHOLD) riskFlags.add('SOURCE_OVERLAP');

    const slug = await this.availableSlug(ai.draft.headline, candidate.id);
    const parsedArticle = articleCreateSchema.parse({
      type: 'ORIGINAL',
      title: ai.draft.headline,
      slug,
      summary: ai.draft.dek,
      body: ai.draft.body,
      sourceName: candidate.sourceNameSnapshot,
      sourceUrl: candidate.canonicalUrl,
      sourcePublishedAt: candidate.sourcePublishedAt?.toISOString() ?? null,
      heroImageUrl: null,
      heroImageAlt: null,
      heroImageAttribution: null,
      heroImageAttributionUrl: null,
      seoTitle: ai.draft.seoTitle,
      seoDescription: ai.draft.seoDescription,
      isFeatured: false,
      featuredPriority: null,
      featuredStartsAt: null,
      featuredEndsAt: null,
      teamIds: teamResolution.teamIds,
      changeSummary: 'AI draft generated; human review required.',
    });
    const generatedAt = this.now();
    const metadata: DraftPersistenceInput['metadata'] = {
      provider: ai.provider,
      model: ai.model,
      promptVersion: ai.promptVersion,
      generatedAt,
      confidence:
        source.description === null && ai.draft.confidence === 'HIGH'
          ? 'MEDIUM'
          : ai.draft.confidence,
      riskFlags: [...riskFlags] as DraftPersistenceInput['metadata']['riskFlags'],
      category: ai.draft.category,
      topicTags: unique(ai.draft.topicTags),
      mediaSearchTerms: unique(ai.draft.mediaSearchTerms),
      primaryTeamId: teamResolution.primaryTeamId,
      unresolvedEntities: playerResolution.unresolved,
      overlapStatus: duplicate.status,
      closestCandidateId: duplicate.closestCandidateId,
      closestArticleId: duplicate.closestArticleId,
      duplicateScore: duplicate.score,
      sourceOverlapScore,
      inputTokens: ai.usage.inputTokens,
      outputTokens: ai.usage.outputTokens,
      estimatedCostMicros: ai.usage.estimatedCostMicros,
      sourcePreparationMs,
      aiDurationMs: ai.durationMs,
      entityResolutionMs,
      duplicateDetectionMs,
      databaseDurationMs: 0,
      totalDurationMs: elapsed(totalStarted),
    };
    let article: { readonly articleId: string; readonly slug: string; readonly version: number };
    try {
      article = await this.repository.createDraft(
        {
          candidate,
          fields: prepareArticleCreate(parsedArticle),
          teamIds: teamResolution.teamIds,
          playerIds: playerResolution.playerIds,
          metadata,
        },
        actor,
        requestId,
      );
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw candidateConflict();
    }
    return {
      article: {
        id: article.articleId,
        slug: article.slug,
        version: article.version,
        status: 'DRAFT',
      },
      reviewStatus: 'NEEDS_REVIEW',
      candidateId,
      primaryTeamId: teamResolution.primaryTeamId,
      additionalTeamIds: teamResolution.teamIds.filter((id) => id !== teamResolution.primaryTeamId),
      playerIds: playerResolution.playerIds,
      unresolvedPlayers: playerResolution.unresolved,
      category: ai.draft.category,
      topicTags: unique(ai.draft.topicTags),
      confidence: metadata.confidence,
      riskFlags: [...riskFlags],
      overlap: duplicate,
      sourceOverlapScore,
      mediaSearchTerms: unique(ai.draft.mediaSearchTerms),
      attribution: ai.draft.sourceAttribution,
      ai: {
        provider: ai.provider,
        model: ai.model,
        promptVersion: ai.promptVersion,
        inputTokens: ai.usage.inputTokens,
        outputTokens: ai.usage.outputTokens,
      },
      performance: {
        sourcePreparationMs,
        aiDurationMs: ai.durationMs,
        entityResolutionMs,
        duplicateDetectionMs,
        totalMs: elapsed(totalStarted),
      },
    };
  }

  async generateBatch(
    candidateIds: readonly string[],
    actor: AdministrativePrincipal,
    requestId: string | null,
  ): Promise<BatchResult> {
    if (
      candidateIds.length === 0 ||
      candidateIds.length > MAX_BATCH_SIZE ||
      new Set(candidateIds).size !== candidateIds.length
    )
      throw validationError(`candidateIds must contain 1-${String(MAX_BATCH_SIZE)} distinct IDs.`);
    const started = performance.now();
    const results: BatchResult['results'][number][] = [];
    let cursor = 0;
    const worker = async (): Promise<void> => {
      while (cursor < candidateIds.length) {
        const candidateId = candidateIds[cursor++];
        if (candidateId === undefined) return;
        try {
          const generated = await this.generateDraft(candidateId, actor, requestId);
          results.push({
            candidateId,
            outcome: 'GENERATED',
            articleId: generated.article.id,
            riskFlags: generated.riskFlags,
          });
        } catch (error) {
          const code = error instanceof AppError ? error.code : 'EDITORIAL_AI_FAILED';
          results.push({
            candidateId,
            outcome: code === 'EDITORIAL_AI_ALREADY_GENERATED' ? 'ALREADY_DRAFTED' : 'FAILED',
            errorCode: code,
          });
        }
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(BATCH_CONCURRENCY, candidateIds.length) }, worker),
    );
    const requestedOrder = new Map(candidateIds.map((id, index) => [id, index]));
    results.sort(
      (left, right) =>
        (requestedOrder.get(left.candidateId) ?? 0) - (requestedOrder.get(right.candidateId) ?? 0),
    );
    const generated = results.filter((result) => result.outcome === 'GENERATED');
    const durationMs = elapsed(started);
    return {
      requested: candidateIds.length,
      generated: generated.length,
      alreadyDrafted: results.filter((result) => result.outcome === 'ALREADY_DRAFTED').length,
      duplicates: generated.filter((result) => result.riskFlags.includes('POSSIBLE_DUPLICATE'))
        .length,
      failed: results.filter((result) => result.outcome === 'FAILED').length,
      flagged: generated.filter((result) => result.riskFlags.length > 0).length,
      concurrency: Math.min(BATCH_CONCURRENCY, candidateIds.length),
      durationMs,
      averageGenerationMs:
        generated.length === 0 ? null : Math.round(durationMs / generated.length),
      results,
    };
  }

  async regenerateDraft(
    articleId: string,
    expectedVersion: number,
    actor: AdministrativePrincipal,
    requestId: string | null,
    instruction?: string,
  ): Promise<GenerateDraftResult> {
    const totalStarted = performance.now();
    const existing = await this.repository.findAiDraft(articleId);
    if (existing === null)
      throw new AppError({
        code: 'EDITORIAL_AI_DRAFT_NOT_FOUND',
        message: 'The requested AI draft was not found.',
        statusCode: 404,
      });
    if (existing.status !== 'DRAFT' || existing.version !== expectedVersion)
      throw new AppError({
        code: 'ARTICLE_VERSION_CONFLICT',
        message: 'Only the current unpublished draft version can be regenerated.',
        statusCode: 409,
      });
    const candidate = existing.candidate;
    const preparationStarted = performance.now();
    const rights = sourceRights(candidate);
    const source = toSourceMaterial(candidate, rights);
    const sourcePreparationMs = elapsed(preparationStarted);
    const [ai, teams, duplicateCandidates, duplicateArticles] = await Promise.all([
      this.provider.generateDraft(source, instruction),
      this.repository.listTeams(),
      this.repository.findDuplicateCandidates(candidate.id),
      this.repository.findDuplicateArticles(),
    ]);
    const entityStarted = performance.now();
    const teamResolution = resolveTeams(ai.draft, candidate, teams);
    const playerResolution = await this.resolvePlayers(ai.draft, teamResolution.teamIds, teams);
    const entityResolutionMs = elapsed(entityStarted);
    const duplicateStarted = performance.now();
    const duplicate = detectDuplicate(
      candidate,
      ai.draft.headline,
      teamResolution.teamIds,
      duplicateCandidates,
      duplicateArticles.filter((article) => article.id !== articleId),
    );
    const duplicateDetectionMs = elapsed(duplicateStarted);
    const sourceOverlapScore =
      source.description === null ? 0 : phraseOverlap(source.description, ai.draft.body);
    const riskFlags = new Set<string>(ai.draft.riskFlags);
    if (source.description === null) riskFlags.add('THIN_SOURCE');
    if (rights.reviewRequired || rights.textUsage !== 'SUMMARY_ALLOWED')
      riskFlags.add('MEDIA_RIGHTS_UNCLEAR');
    if (duplicate.status === 'LIKELY_DUPLICATE' || duplicate.status === 'DUPLICATE')
      riskFlags.add('POSSIBLE_DUPLICATE');
    if (playerResolution.unresolved.length > 0) riskFlags.add('PLAYER_IDENTITY_UNCERTAIN');
    if (sourceOverlapScore >= SOURCE_OVERLAP_THRESHOLD) riskFlags.add('SOURCE_OVERLAP');
    const parsedArticle = articleCreateSchema.parse({
      type: 'ORIGINAL',
      title: ai.draft.headline,
      slug: await this.availableSlugForRegeneration(ai.draft.headline, candidate.id),
      summary: ai.draft.dek,
      body: ai.draft.body,
      sourceName: candidate.sourceNameSnapshot,
      sourceUrl: candidate.canonicalUrl,
      sourcePublishedAt: candidate.sourcePublishedAt?.toISOString() ?? null,
      heroImageUrl: null,
      heroImageAlt: null,
      heroImageAttribution: null,
      heroImageAttributionUrl: null,
      seoTitle: ai.draft.seoTitle,
      seoDescription: ai.draft.seoDescription,
      isFeatured: false,
      featuredPriority: null,
      featuredStartsAt: null,
      featuredEndsAt: null,
      teamIds: teamResolution.teamIds,
      changeSummary: 'AI draft regenerated; human review required.',
    });
    const metadata: DraftPersistenceInput['metadata'] = {
      provider: ai.provider,
      model: ai.model,
      promptVersion: ai.promptVersion,
      generatedAt: this.now(),
      confidence:
        source.description === null && ai.draft.confidence === 'HIGH'
          ? 'MEDIUM'
          : ai.draft.confidence,
      riskFlags: [...riskFlags] as DraftPersistenceInput['metadata']['riskFlags'],
      category: ai.draft.category,
      topicTags: unique(ai.draft.topicTags),
      mediaSearchTerms: unique(ai.draft.mediaSearchTerms),
      primaryTeamId: teamResolution.primaryTeamId,
      unresolvedEntities: playerResolution.unresolved,
      overlapStatus: duplicate.status,
      closestCandidateId: duplicate.closestCandidateId,
      closestArticleId: duplicate.closestArticleId,
      duplicateScore: duplicate.score,
      sourceOverlapScore,
      inputTokens: ai.usage.inputTokens,
      outputTokens: ai.usage.outputTokens,
      estimatedCostMicros: ai.usage.estimatedCostMicros,
      sourcePreparationMs,
      aiDurationMs: ai.durationMs,
      entityResolutionMs,
      duplicateDetectionMs,
      databaseDurationMs: 0,
      totalDurationMs: elapsed(totalStarted),
    };
    const regenerated = await this.repository.regenerateDraft(
      articleId,
      expectedVersion,
      {
        candidate,
        fields: prepareArticleCreate(parsedArticle),
        teamIds: teamResolution.teamIds,
        playerIds: playerResolution.playerIds,
        metadata,
      },
      actor,
      requestId,
    );
    if (regenerated === null)
      throw new AppError({
        code: 'ARTICLE_VERSION_CONFLICT',
        message: 'The draft changed before regeneration completed.',
        statusCode: 409,
      });
    return {
      article: {
        id: articleId,
        slug: parsedArticle.slug ?? '',
        version: regenerated.version,
        status: 'DRAFT',
      },
      reviewStatus: 'NEEDS_REVIEW',
      candidateId: candidate.id,
      primaryTeamId: teamResolution.primaryTeamId,
      additionalTeamIds: teamResolution.teamIds.filter((id) => id !== teamResolution.primaryTeamId),
      playerIds: playerResolution.playerIds,
      unresolvedPlayers: playerResolution.unresolved,
      category: ai.draft.category,
      topicTags: unique(ai.draft.topicTags),
      confidence: metadata.confidence,
      riskFlags: [...riskFlags],
      overlap: duplicate,
      sourceOverlapScore,
      mediaSearchTerms: unique(ai.draft.mediaSearchTerms),
      attribution: ai.draft.sourceAttribution,
      ai: {
        provider: ai.provider,
        model: ai.model,
        promptVersion: ai.promptVersion,
        inputTokens: ai.usage.inputTokens,
        outputTokens: ai.usage.outputTokens,
      },
      performance: {
        sourcePreparationMs,
        aiDurationMs: ai.durationMs,
        entityResolutionMs,
        duplicateDetectionMs,
        totalMs: elapsed(totalStarted),
      },
    };
  }

  async coverage(target: number): Promise<CoverageResult> {
    const started = performance.now();
    const now = this.now();
    const [rows, totals] = await Promise.all([
      this.repository.listCoverage(now, new Date(now.getTime() - 30 * 86_400_000)),
      this.repository.getCoverageTotals(now),
    ]);
    const teams = rows.map((row) => ({
      ...row,
      remainingToTarget: Math.max(0, target - row.publishedCount - row.draftCount),
    }));
    return {
      targetCount: target,
      teams,
      totals: {
        teamsAtTarget: teams.filter((team) => team.remainingToTarget === 0).length,
        teamsBelowTarget: teams.filter((team) => team.remainingToTarget > 0).length,
        totalPublished: totals.totalPublished,
        totalDrafts: totals.totalDrafts,
        totalCandidates: totals.totalCandidates,
      },
      durationMs: elapsed(started),
    };
  }

  async setReviewStatus(
    articleId: string,
    status: EditorialAiReviewStatus,
    actor: AdministrativePrincipal,
    requestId: string | null,
  ) {
    if (!(await this.repository.setReviewStatus(articleId, status, actor, requestId)))
      throw new AppError({
        code: 'EDITORIAL_AI_REVIEW_CONFLICT',
        message: 'The AI draft was not found or already has that review state.',
        statusCode: 409,
      });
    return { articleId, reviewStatus: status };
  }

  async attachMedia(
    articleId: string,
    mediaId: string,
    actor: AdministrativePrincipal,
    requestId: string | null,
  ) {
    if (!(await this.repository.attachMedia(articleId, mediaId, actor, requestId)))
      throw new AppError({
        code: 'MEDIA_ATTACHMENT_NOT_ALLOWED',
        message: 'The media candidate is unavailable or its embedding rights are not approved.',
        statusCode: 409,
      });
    return { articleId, mediaCandidateId: mediaId, status: 'ATTACHED' as const };
  }

  async createMediaCandidate(
    articleId: string,
    input: Omit<MediaCandidateWrite, 'publishedAt'> & { readonly publishedAt: string | null },
    actor: AdministrativePrincipal,
    requestId: string | null,
  ) {
    const media = await this.repository.createMediaCandidate(
      articleId,
      { ...input, publishedAt: input.publishedAt === null ? null : new Date(input.publishedAt) },
      actor,
      requestId,
    );
    if (media === null)
      throw new AppError({
        code: 'ARTICLE_NOT_FOUND',
        message: 'The requested article was not found.',
        statusCode: 404,
      });
    return { ...media, publishedAt: media.publishedAt?.toISOString() ?? null };
  }

  async getSourceRights(sourceId: string) {
    const record = await this.repository.getSourceRights(sourceId);
    return rightsDto(
      record ?? {
        sourceId,
        textUsage: 'UNKNOWN',
        imageUsage: 'UNKNOWN',
        videoUsage: 'UNKNOWN',
        quotationPolicy: 'UNKNOWN',
        reviewRequired: true,
        notes: null,
        reviewedBySnapshot: null,
        reviewedAt: null,
      },
    );
  }

  async updateSourceRights(
    sourceId: string,
    input: SourceRightsWrite,
    actor: AdministrativePrincipal,
    requestId: string | null,
  ) {
    const record = await this.repository.upsertSourceRights(
      sourceId,
      input,
      actor,
      requestId,
      this.now(),
    );
    if (record === null)
      throw new AppError({
        code: 'NEWS_SOURCE_NOT_FOUND',
        message: 'The requested news source was not found.',
        statusCode: 404,
      });
    return rightsDto(record);
  }

  private async requireAvailableCandidate(id: string): Promise<EditorialCandidate> {
    const candidate = await this.repository.findCandidate(id);
    if (candidate === null)
      throw new AppError({
        code: 'NEWS_CANDIDATE_NOT_FOUND',
        message: 'The requested news candidate was not found.',
        statusCode: 404,
      });
    if (candidate.aiMetadata !== null || candidate.convertedArticleId !== null)
      throw new AppError({
        code: 'EDITORIAL_AI_ALREADY_GENERATED',
        message: 'This candidate already has an article draft.',
        statusCode: 409,
      });
    if (candidate.status === 'DISMISSED') throw candidateConflict();
    return candidate;
  }

  private async resolvePlayers(
    draft: EditorialDraft,
    teamIds: readonly string[],
    teams: readonly EditorialTeam[],
  ) {
    const normalized = draft.players.map((player) => normalizeName(player.name));
    const candidates = await this.repository.findPlayers(normalized);
    const playerIds: string[] = [],
      unresolved: { name: string; team: string | null }[] = [];
    for (const suggestion of draft.players) {
      const matches = candidates.filter(
        (candidate) => candidate.normalizedName === normalizeName(suggestion.name),
      );
      const suggestedTeam =
        suggestion.team === null ? null : (resolveTeam(suggestion.team, teams)?.id ?? null);
      const contextual = matches.filter(
        (candidate) => suggestedTeam === null || candidate.latestTeamId === suggestedTeam,
      );
      const onlyCandidate = contextual[0];
      const safe =
        contextual.length === 1 &&
        onlyCandidate !== undefined &&
        (onlyCandidate.latestTeamId === null || teamIds.includes(onlyCandidate.latestTeamId))
          ? onlyCandidate
          : null;
      if (safe === null) unresolved.push(suggestion);
      else playerIds.push(safe.id);
    }
    return { playerIds: unique(playerIds), unresolved };
  }

  private async availableSlug(headline: string, candidateId: string): Promise<string> {
    const base = normalizeSlug(headline);
    if (!(await this.repository.slugExists(base))) return base;
    return normalizeSlug(`${base}-${candidateId.slice(0, 8)}`);
  }

  private async availableSlugForRegeneration(
    headline: string,
    candidateId: string,
  ): Promise<string> {
    const base = normalizeSlug(headline);
    if (!(await this.repository.slugExists(base))) return base;
    return normalizeSlug(`${base}-${candidateId.slice(0, 8)}`);
  }
}

function sourceRights(candidate: EditorialCandidate) {
  const profile = candidate.source?.rightsProfile;
  return (
    profile ?? {
      textUsage: 'UNKNOWN' as const,
      imageUsage: 'UNKNOWN' as const,
      videoUsage: 'UNKNOWN' as const,
      quotationPolicy: 'UNKNOWN' as const,
      reviewRequired: true,
    }
  );
}

function toSourceMaterial(
  candidate: EditorialCandidate,
  rights: ReturnType<typeof sourceRights>,
): EditorialSourceMaterial {
  const mayUseDescription =
    rights.textUsage === 'SUMMARY_ALLOWED' && candidate.source?.allowsDescriptionUse === true;
  return {
    candidateId: candidate.id,
    headline: candidate.headline,
    publisher: candidate.sourceNameSnapshot,
    canonicalUrl: candidate.canonicalUrl,
    description: mayUseDescription ? candidate.sourceDescription : null,
    author: candidate.sourceAuthor,
    publishedAt: candidate.sourcePublishedAt?.toISOString() ?? null,
    suggestedTeams: candidate.suggestedTeams.map(({ team }) => team.abbreviation),
    rights: { textUsage: rights.textUsage, quotationPolicy: rights.quotationPolicy },
  };
}

function resolveTeams(
  draft: EditorialDraft,
  candidate: EditorialCandidate,
  teams: readonly EditorialTeam[],
) {
  const primary = draft.primaryTeam === null ? null : resolveTeam(draft.primaryTeam, teams);
  const suggestedFallback =
    candidate.suggestedTeams.length === 1 ? (candidate.suggestedTeams[0]?.team ?? null) : null;
  const primaryTeamId =
    primary?.id ?? (draft.primaryTeam === null ? null : (suggestedFallback?.id ?? null));
  const additional = draft.additionalTeams
    .map((value) => resolveTeam(value, teams)?.id)
    .filter((id): id is string => id !== undefined);
  return {
    primaryTeamId,
    teamIds: unique([...(primaryTeamId === null ? [] : [primaryTeamId]), ...additional]),
  };
}

function resolveTeam(value: string, teams: readonly EditorialTeam[]): EditorialTeam | null {
  const normalized = normalizeName(value);
  const abbreviation = TEAM_ALIASES[value.trim().toUpperCase()] ?? value.trim().toUpperCase();
  const matches = teams.filter(
    (team) =>
      team.abbreviation === abbreviation ||
      [team.fullName, `${team.city} ${team.name}`].some(
        (name) => normalizeName(name) === normalized,
      ),
  );
  return matches.length === 1 ? (matches[0] ?? null) : null;
}

export function detectDuplicate(
  candidate: EditorialCandidate,
  headline: string,
  teamIds: readonly string[],
  candidates: readonly DuplicateCandidate[],
  articles: readonly DuplicateArticle[],
): DuplicateResult {
  let best: DuplicateResult = {
    status: 'UNIQUE',
    score: null,
    closestCandidateId: null,
    closestArticleId: null,
  };
  const consider = (
    status: DuplicateResult['status'],
    score: number,
    candidateId: string | null,
    articleId: string | null,
  ) => {
    const rank = { UNIQUE: 0, RELATED: 1, LIKELY_DUPLICATE: 2, DUPLICATE: 3 } as const;
    if (
      rank[status] > rank[best.status] ||
      (rank[status] === rank[best.status] && score > (best.score ?? -1))
    )
      best = { status, score, closestCandidateId: candidateId, closestArticleId: articleId };
  };
  for (const other of candidates) {
    if (
      other.canonicalUrlHash === candidate.canonicalUrlHash ||
      (candidate.sourceExternalId !== null && other.sourceExternalId === candidate.sourceExternalId)
    ) {
      consider('DUPLICATE', 1, other.id, null);
      continue;
    }
    scoreHeadline(
      headline,
      other.headline,
      teamIds,
      other.teamIds,
      candidate.sourcePublishedAt,
      other.sourcePublishedAt,
      (status, score) => {
        consider(status, score, other.id, null);
      },
    );
  }
  for (const article of articles) {
    if (article.sourceUrl === candidate.canonicalUrl) {
      consider('DUPLICATE', 1, null, article.id);
      continue;
    }
    scoreHeadline(
      headline,
      article.title,
      teamIds,
      article.teamIds,
      candidate.sourcePublishedAt,
      article.publishedAt ?? article.createdAt,
      (status, score) => {
        consider(status, score, null, article.id);
      },
    );
  }
  return best;
}

function scoreHeadline(
  left: string,
  right: string,
  leftTeams: readonly string[],
  rightTeams: readonly string[],
  leftTime: Date | null,
  rightTime: Date | null,
  accept: (status: DuplicateResult['status'], score: number) => void,
) {
  const normalizedLeft = normalizeName(left),
    normalizedRight = normalizeName(right);
  const similarity = jaccard(
    new Set(normalizedLeft.split(' ')),
    new Set(normalizedRight.split(' ')),
  );
  const sameTeam = leftTeams.some((id) => rightTeams.includes(id));
  const closeTime =
    leftTime !== null &&
    rightTime !== null &&
    Math.abs(leftTime.getTime() - rightTime.getTime()) <= 72 * 3_600_000;
  if (normalizedLeft === normalizedRight) accept('LIKELY_DUPLICATE', 0.98);
  else if (similarity >= 0.75 && (sameTeam || closeTime)) accept('LIKELY_DUPLICATE', similarity);
  else if (similarity >= 0.5 && (sameTeam || closeTime)) accept('RELATED', similarity);
}

export function phraseOverlap(source: string, draft: string): number {
  const sourceGrams = ngrams(normalizeName(source).split(' '), 5),
    draftGrams = ngrams(normalizeName(draft).split(' '), 5);
  if (sourceGrams.size === 0 || draftGrams.size === 0) return 0;
  let shared = 0;
  for (const gram of sourceGrams) if (draftGrams.has(gram)) shared++;
  return Number((shared / Math.min(sourceGrams.size, draftGrams.size)).toFixed(4));
}

function ngrams(words: readonly string[], size: number): Set<string> {
  const result = new Set<string>();
  for (let index = 0; index <= words.length - size; index++)
    result.add(words.slice(index, index + size).join(' '));
  return result;
}
function jaccard(left: ReadonlySet<string>, right: ReadonlySet<string>): number {
  let shared = 0;
  for (const item of left) if (right.has(item)) shared++;
  return shared / Math.max(1, left.size + right.size - shared);
}
function normalizeName(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}
function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}
function elapsed(started: number): number {
  return Math.max(0, Math.round(performance.now() - started));
}
function validationError(message: string): AppError {
  return new AppError({ code: 'VALIDATION_ERROR', message, statusCode: 400 });
}
function candidateConflict(): AppError {
  return new AppError({
    code: 'NEWS_CANDIDATE_STATE_CONFLICT',
    message: 'The candidate is not available for AI draft generation.',
    statusCode: 409,
  });
}
function rightsDto(record: {
  sourceId: string;
  textUsage: string;
  imageUsage: string;
  videoUsage: string;
  quotationPolicy: string;
  reviewRequired: boolean;
  notes: string | null;
  reviewedBySnapshot: string | null;
  reviewedAt: Date | null;
}) {
  return { ...record, reviewedAt: record.reviewedAt?.toISOString() ?? null };
}
export function canonicalUrlHash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
