import { AppError } from '../../common/errors/app-error.js';
import type { AdministrativePrincipal } from '../admin/admin-authorization.js';
import type { NewsInboxServiceContract } from '../news-inbox/news.service.js';
import type { CandidateQualityGate, CandidateQualityResult } from './candidate-quality.service.js';

export interface DiscoveryTeam {
  readonly id: string;
  readonly abbreviation: string;
  readonly opportunityCount: number;
}

export interface DiscoverySource {
  readonly id: string;
  readonly name: string;
  readonly kind: 'RSS' | 'ATOM';
}

export interface LaunchDiscoveryRepository {
  listActiveSources(): Promise<readonly DiscoverySource[]>;
  listTeamsByGap(target: number): Promise<readonly DiscoveryTeam[]>;
  listCandidateIds(
    teamIds: readonly string[],
    since: Date,
    discoveredSince: Date,
    limit: number,
  ): Promise<readonly string[]>;
  sourceDiversity(candidateIds: readonly string[]): Promise<number>;
}

export interface LaunchDiscoveryInput {
  readonly targetPerTeam: number;
  readonly freshnessDays: number;
  readonly maxNewCandidates: number;
  readonly pilot: boolean;
}

export interface LaunchDiscoveryResult {
  readonly mode: 'PILOT' | 'FULL';
  readonly teamsAttempted: readonly { id: string; abbreviation: string; gap: number }[];
  readonly sourceRequests: number;
  readonly sources: readonly { id: string; name: string; kind: string }[];
  readonly rawResults: number;
  readonly created: number;
  readonly updated: number;
  readonly deduplicated: number;
  readonly nflRelevant: number;
  readonly usefulCandidates: number;
  readonly sourceDiversity: number;
  readonly quality: {
    readonly fullDraft: number;
    readonly shortBrief: number;
    readonly linkOnly: number;
    readonly insufficient: number;
    readonly nonNfl: number;
    readonly duplicates: number;
    readonly manualReview: number;
    readonly failed: number;
  };
  readonly stoppedEarly: boolean;
  readonly stopReason: string | null;
  readonly articleGenerationCount: 0;
  readonly publicationCount: 0;
}

export class LaunchDiscoveryService {
  constructor(
    private readonly repository: LaunchDiscoveryRepository,
    private readonly news: NewsInboxServiceContract,
    private readonly quality: CandidateQualityGate,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async discover(
    input: LaunchDiscoveryInput,
    actor: AdministrativePrincipal,
    requestId: string | null,
  ): Promise<LaunchDiscoveryResult> {
    const operationStarted = this.now();
    const sources = await this.repository.listActiveSources();
    if (sources.length === 0)
      throw new AppError({
        code: 'LAUNCH_DISCOVERY_SOURCE_UNAVAILABLE',
        message: 'No approved active RSS or Atom source is configured for launch discovery.',
        statusCode: 409,
      });
    const ranked = await this.repository.listTeamsByGap(input.targetPerTeam);
    const selected = input.pilot ? selectPilotTeams(ranked) : ranked;
    let sourceRequests = 0,
      rawResults = 0,
      created = 0,
      updated = 0,
      deduplicated = 0,
      stoppedEarly = false;
    let stopReason: string | null = null;
    for (const source of sources) {
      const remaining = input.maxNewCandidates - created;
      if (remaining <= 0) break;
      try {
        const ingestion = await this.news.ingestSource(
          source.id,
          actor,
          requestId,
          Math.min(100, remaining),
        );
        sourceRequests++;
        rawResults += ingestion.run.fetchedCount;
        created += ingestion.run.createdCount;
        updated += ingestion.run.updatedCount;
        deduplicated += ingestion.run.skippedCount;
      } catch (error) {
        stoppedEarly = true;
        stopReason = error instanceof AppError ? error.code : 'NEWS_DISCOVERY_FAILED';
        break;
      }
    }
    const candidateIds = await this.repository.listCandidateIds(
      selected.map(({ id }) => id),
      new Date(this.now().getTime() - input.freshnessDays * 86_400_000),
      operationStarted,
      input.maxNewCandidates,
    );
    const evaluated: CandidateQualityResult[] = [];
    let failed = 0;
    for (let index = 0; index < candidateIds.length; index += 50) {
      const batch = await this.quality.evaluateBatch(
        candidateIds.slice(index, index + 50),
        actor,
        requestId,
      );
      for (const row of batch.results) {
        if ('decision' in row) evaluated.push(row);
        else failed++;
      }
    }
    const useful = evaluated.filter((row) =>
      ['NFL_RELEVANT_FULL_DRAFT', 'NFL_RELEVANT_SHORT_BRIEF', 'NFL_RELEVANT_LINK_ONLY'].includes(
        row.decision,
      ),
    );
    return {
      mode: input.pilot ? 'PILOT' : 'FULL',
      teamsAttempted: selected.map((team) => ({
        id: team.id,
        abbreviation: team.abbreviation,
        gap: Math.max(0, input.targetPerTeam - team.opportunityCount),
      })),
      sourceRequests,
      sources,
      rawResults,
      created,
      updated,
      deduplicated,
      nflRelevant: evaluated.filter((row) => row.relevance === 'NFL').length,
      usefulCandidates: useful.length,
      sourceDiversity: await this.repository.sourceDiversity(
        useful.map(({ candidateId }) => candidateId),
      ),
      quality: {
        fullDraft: evaluated.filter((row) => row.decision === 'NFL_RELEVANT_FULL_DRAFT').length,
        shortBrief: evaluated.filter((row) => row.decision === 'NFL_RELEVANT_SHORT_BRIEF').length,
        linkOnly: evaluated.filter((row) => row.decision === 'NFL_RELEVANT_LINK_ONLY').length,
        insufficient: evaluated.filter((row) => row.decision === 'REJECT_INSUFFICIENT').length,
        nonNfl: evaluated.filter((row) => row.decision === 'REJECT_NON_NFL').length,
        duplicates: evaluated.filter((row) => row.decision === 'REJECT_DUPLICATE').length,
        manualReview: evaluated.filter((row) => row.decision === 'NEEDS_MANUAL_REVIEW').length,
        failed,
      },
      stoppedEarly,
      stopReason,
      articleGenerationCount: 0,
      publicationCount: 0,
    };
  }
}

export function selectPilotTeams(teams: readonly DiscoveryTeam[]): readonly DiscoveryTeam[] {
  const withContent = teams
    .filter((team) => team.opportunityCount > 0)
    .sort((left, right) => left.opportunityCount - right.opportunityCount)[0];
  const zero = teams.filter((team) => team.opportunityCount === 0).slice(0, 3);
  return [...(withContent === undefined ? [] : [withContent]), ...zero].slice(0, 4);
}
