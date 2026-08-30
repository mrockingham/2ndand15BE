import { AppError } from '../../common/errors/app-error.js';
import type { AdministrativePrincipal } from '../admin/admin-authorization.js';
import {
  toAdminEditionDetailDto,
  toAdminEditionListDto,
  toPublicEditionSummaryDto,
  toPublicPowerRankingsDto,
  type AdminPowerRankingEditionDetailDto,
  type AdminPowerRankingEditionListDto,
  type PublicPowerRankingEditionSummaryDto,
  type PublicPowerRankingsDto,
} from './power-ranking.dto.js';
import type { PowerRankingRepository, ResolvedImportEntry } from './power-ranking.repository.js';
import type {
  AdminPowerRankingListQuery,
  PowerRankingEditionCreateInput,
  PowerRankingEditionUpdateInput,
  PowerRankingEntryUpdateInput,
  PowerRankingImportDocument,
} from './power-ranking.schemas.js';
import {
  buildTeamLookup,
  isTeamMatchError,
  matchImportEntryToTeam,
} from './power-ranking.team-matching.js';

const REQUIRED_NFL_TEAM_COUNT = 32;

export interface ImportValidationIssue {
  readonly rank: number | null;
  readonly teamId: string | null;
  readonly message: string;
}

export interface ImportPreviewReport {
  readonly valid: boolean;
  readonly isExistingEdition: boolean;
  readonly season: number;
  readonly edition: string;
  readonly entryCount: number;
  readonly errors: readonly ImportValidationIssue[];
  readonly teamMatches: readonly {
    readonly rank: number;
    readonly teamId: string;
    readonly matchedTeamId: string;
    readonly matchedBy: 'ID' | 'ABBREVIATION' | 'SLUG';
  }[];
}

export interface ImportUpsertOutcome {
  readonly edition: AdminPowerRankingEditionDetailDto;
  readonly created: boolean;
}

export interface PowerRankingsService {
  getPublic(season?: number, edition?: string): Promise<PublicPowerRankingsDto>;
  listPublicEditions(season?: number): Promise<readonly PublicPowerRankingEditionSummaryDto[]>;
  listAdmin(query: AdminPowerRankingListQuery): Promise<{
    readonly editions: readonly AdminPowerRankingEditionListDto[];
    readonly nextCursor: string | null;
  }>;
  getAdmin(editionId: string): Promise<AdminPowerRankingEditionDetailDto>;
  createEdition(
    input: PowerRankingEditionCreateInput,
    principal: AdministrativePrincipal,
    requestId: string | null,
  ): Promise<AdminPowerRankingEditionDetailDto>;
  updateEdition(
    editionId: string,
    input: PowerRankingEditionUpdateInput,
    principal: AdministrativePrincipal,
    requestId: string | null,
  ): Promise<AdminPowerRankingEditionDetailDto>;
  updateEntry(
    editionId: string,
    entryId: string,
    input: PowerRankingEntryUpdateInput,
    principal: AdministrativePrincipal,
    requestId: string | null,
  ): Promise<AdminPowerRankingEditionDetailDto>;
  reorderEntries(
    editionId: string,
    orderedEntryIds: readonly string[],
    principal: AdministrativePrincipal,
    requestId: string | null,
  ): Promise<AdminPowerRankingEditionDetailDto>;
  publish(
    editionId: string,
    principal: AdministrativePrincipal,
    requestId: string | null,
  ): Promise<AdminPowerRankingEditionDetailDto>;
  unpublish(
    editionId: string,
    principal: AdministrativePrincipal,
    requestId: string | null,
  ): Promise<AdminPowerRankingEditionDetailDto>;
  previewImport(document: PowerRankingImportDocument): Promise<ImportPreviewReport>;
  upsertImport(
    document: PowerRankingImportDocument,
    publish: boolean,
    principal: AdministrativePrincipal,
    requestId: string | null,
  ): Promise<ImportUpsertOutcome>;
}

export class PowerRankingService implements PowerRankingsService {
  constructor(private readonly repository: PowerRankingRepository) {}

  async getPublic(season?: number, edition?: string): Promise<PublicPowerRankingsDto> {
    const record =
      edition === undefined
        ? await this.repository.findLatestPublished(season)
        : await this.repository.findPublished(requireSeason(season), edition);
    if (record === null) throw editionNotFound();
    return toPublicPowerRankingsDto(record);
  }

  async listPublicEditions(
    season?: number,
  ): Promise<readonly PublicPowerRankingEditionSummaryDto[]> {
    const editions = await this.repository.listPublishedEditions(season);
    return editions.map(toPublicEditionSummaryDto);
  }

  async listAdmin(query: AdminPowerRankingListQuery): Promise<{
    readonly editions: readonly AdminPowerRankingEditionListDto[];
    readonly nextCursor: string | null;
  }> {
    const page = await this.repository.listAdmin({
      limit: query.limit,
      ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
      ...(query.status === undefined ? {} : { status: query.status }),
      ...(query.season === undefined ? {} : { season: query.season }),
    });
    return { editions: page.editions.map(toAdminEditionListDto), nextCursor: page.nextCursor };
  }

  async getAdmin(editionId: string): Promise<AdminPowerRankingEditionDetailDto> {
    const edition = await this.repository.findById(editionId);
    if (edition === null) throw editionNotFound();
    return toAdminEditionDetailDto(edition);
  }

  async createEdition(
    input: PowerRankingEditionCreateInput,
    principal: AdministrativePrincipal,
    requestId: string | null,
  ): Promise<AdminPowerRankingEditionDetailDto> {
    const created = await this.repository.createEdition(
      { ...input, asOf: new Date(input.asOf), subtitle: input.subtitle ?? null },
      principal,
      requestId,
    );
    return toAdminEditionDetailDto(created);
  }

  async updateEdition(
    editionId: string,
    input: PowerRankingEditionUpdateInput,
    principal: AdministrativePrincipal,
    requestId: string | null,
  ): Promise<AdminPowerRankingEditionDetailDto> {
    const updated = await this.repository.updateEdition(
      editionId,
      {
        ...(input.title === undefined ? {} : { title: input.title }),
        ...(input.subtitle === undefined ? {} : { subtitle: input.subtitle }),
        ...(input.asOf === undefined ? {} : { asOf: new Date(input.asOf) }),
        ...(input.methodology === undefined ? {} : { methodology: input.methodology }),
        ...(input.sources === undefined ? {} : { sources: input.sources }),
      },
      principal,
      requestId,
    );
    if (updated === null) throw editionNotFound();
    return toAdminEditionDetailDto(updated);
  }

  async updateEntry(
    editionId: string,
    entryId: string,
    input: PowerRankingEntryUpdateInput,
    principal: AdministrativePrincipal,
    requestId: string | null,
  ): Promise<AdminPowerRankingEditionDetailDto> {
    const outcome = await this.repository.updateEntry(
      editionId,
      entryId,
      {
        ...(input.rank === undefined ? {} : { rank: input.rank }),
        ...(input.previousRank === undefined ? {} : { previousRank: input.previousRank }),
        ...(input.tier === undefined ? {} : { tier: input.tier }),
        ...(input.headline === undefined ? {} : { headline: input.headline }),
        ...(input.summary === undefined ? {} : { summary: input.summary }),
        ...(input.strengths === undefined ? {} : { strengths: input.strengths }),
        ...(input.concerns === undefined ? {} : { concerns: input.concerns }),
      },
      principal,
      requestId,
    );
    if (outcome.kind === 'EDITION_NOT_FOUND') throw editionNotFound();
    if (outcome.kind === 'ENTRY_NOT_FOUND') throw entryNotFound();
    return toAdminEditionDetailDto(outcome.edition);
  }

  async reorderEntries(
    editionId: string,
    orderedEntryIds: readonly string[],
    principal: AdministrativePrincipal,
    requestId: string | null,
  ): Promise<AdminPowerRankingEditionDetailDto> {
    let updated;
    try {
      updated = await this.repository.reorderEntries(
        editionId,
        orderedEntryIds,
        principal,
        requestId,
      );
    } catch (error) {
      if (error instanceof RangeError) {
        throw new AppError({
          code: 'POWER_RANKING_REORDER_MISMATCH',
          message: error.message,
          statusCode: 422,
        });
      }
      throw error;
    }
    if (updated === null) throw editionNotFound();
    return toAdminEditionDetailDto(updated);
  }

  async publish(
    editionId: string,
    principal: AdministrativePrincipal,
    requestId: string | null,
  ): Promise<AdminPowerRankingEditionDetailDto> {
    const edition = await this.repository.findById(editionId);
    if (edition === null) throw editionNotFound();
    await this.requirePublishReady(edition.entries.map((entry) => entry.team.id));
    const published = await this.repository.setStatus(
      editionId,
      'PUBLISHED',
      'POWER_RANKING_PUBLISHED',
      principal,
      requestId,
    );
    if (published === null) throw editionNotFound();
    return toAdminEditionDetailDto(published);
  }

  async unpublish(
    editionId: string,
    principal: AdministrativePrincipal,
    requestId: string | null,
  ): Promise<AdminPowerRankingEditionDetailDto> {
    const updated = await this.repository.setStatus(
      editionId,
      'DRAFT',
      'POWER_RANKING_UNPUBLISHED',
      principal,
      requestId,
    );
    if (updated === null) throw editionNotFound();
    return toAdminEditionDetailDto(updated);
  }

  async previewImport(document: PowerRankingImportDocument): Promise<ImportPreviewReport> {
    const { errors, teamMatches, resolved } = await this.validateImport(document);
    const existing = await this.repository.findBySeasonEdition(document.season, document.edition);
    return {
      valid: errors.length === 0,
      isExistingEdition: existing !== null,
      season: document.season,
      edition: document.edition,
      entryCount: resolved.length,
      errors,
      teamMatches,
    };
  }

  async upsertImport(
    document: PowerRankingImportDocument,
    publish: boolean,
    principal: AdministrativePrincipal,
    requestId: string | null,
  ): Promise<ImportUpsertOutcome> {
    const { errors, resolved } = await this.validateImport(document);
    if (errors.length > 0) {
      throw new AppError({
        code: 'POWER_RANKING_IMPORT_INVALID',
        message: 'The import document failed validation; no changes were written.',
        statusCode: 422,
        details: errors.map((issue) => ({
          field:
            issue.teamId ?? (issue.rank === null ? 'document' : `rankings[${String(issue.rank)}]`),
          message: issue.message,
        })),
      });
    }
    if (publish && resolved.length !== REQUIRED_NFL_TEAM_COUNT) {
      throw new AppError({
        code: 'POWER_RANKING_PUBLISH_INCOMPLETE',
        message: `A published NFL edition must contain exactly ${String(REQUIRED_NFL_TEAM_COUNT)} entries; got ${String(resolved.length)}.`,
        statusCode: 422,
      });
    }
    const result = await this.repository.importUpsert(
      {
        season: document.season,
        edition: document.edition,
        title: document.title,
        subtitle: document.subtitle ?? null,
        asOf: new Date(document.asOf),
        methodology: document.methodology,
        sources: document.sources,
      },
      resolved,
      publish,
      principal,
      requestId,
    );
    return { edition: toAdminEditionDetailDto(result.edition), created: result.created };
  }

  private async requirePublishReady(teamIds: readonly string[]): Promise<void> {
    if (teamIds.length !== REQUIRED_NFL_TEAM_COUNT) {
      throw new AppError({
        code: 'POWER_RANKING_PUBLISH_INCOMPLETE',
        message: `A published NFL edition must contain exactly ${String(REQUIRED_NFL_TEAM_COUNT)} entries; got ${String(teamIds.length)}.`,
        statusCode: 422,
      });
    }
    const uniqueTeamIds = new Set(teamIds);
    if (uniqueTeamIds.size !== REQUIRED_NFL_TEAM_COUNT) {
      throw new AppError({
        code: 'POWER_RANKING_PUBLISH_DUPLICATE_TEAM',
        message: 'A published NFL edition must contain 32 unique teams.',
        statusCode: 422,
      });
    }
    const activeTeams = await this.repository.listActiveNflTeams();
    const activeIds = new Set(activeTeams.map((team) => team.id));
    const inactive = [...uniqueTeamIds].filter((id) => !activeIds.has(id));
    if (inactive.length > 0) {
      throw new AppError({
        code: 'POWER_RANKING_PUBLISH_INACTIVE_TEAM',
        message: `Every team in a published edition must be an active NFL team. Not active: ${inactive.join(', ')}.`,
        statusCode: 422,
      });
    }
  }

  private async validateImport(document: PowerRankingImportDocument): Promise<{
    readonly errors: ImportValidationIssue[];
    readonly teamMatches: ImportPreviewReport['teamMatches'];
    readonly resolved: readonly ResolvedImportEntry[];
  }> {
    const errors: ImportValidationIssue[] = [];

    const ranks = document.rankings.map((entry) => entry.rank);
    const duplicateRanks = findDuplicates(ranks);
    for (const rank of duplicateRanks) {
      errors.push({
        rank,
        teamId: null,
        message: `Rank ${String(rank)} is used by more than one entry.`,
      });
    }
    const outOfRangeRanks = ranks.filter((rank) => rank < 1 || rank > REQUIRED_NFL_TEAM_COUNT);
    for (const rank of outOfRangeRanks) {
      errors.push({
        rank,
        teamId: null,
        message: `Rank ${String(rank)} is outside the valid 1..${String(REQUIRED_NFL_TEAM_COUNT)} range.`,
      });
    }
    const teamIdSlugs = document.rankings.map((entry) => entry.teamId.toLowerCase());
    const duplicateTeamIds = findDuplicates(teamIdSlugs);
    for (const teamId of duplicateTeamIds) {
      errors.push({
        rank: null,
        teamId,
        message: `teamId "${teamId}" appears more than once in this document.`,
      });
    }

    const teams = await this.repository.listActiveNflTeams();
    const lookup = buildTeamLookup(teams);
    const teamMatches: {
      readonly rank: number;
      readonly teamId: string;
      readonly matchedTeamId: string;
      readonly matchedBy: 'ID' | 'ABBREVIATION' | 'SLUG';
    }[] = [];
    const resolved: ResolvedImportEntry[] = [];
    const matchedCanonicalIds = new Set<string>();

    for (const entry of document.rankings) {
      const result = matchImportEntryToTeam(entry, lookup);
      if (isTeamMatchError(result)) {
        errors.push({ rank: result.rank, teamId: result.teamId, message: result.message });
        continue;
      }
      if (matchedCanonicalIds.has(result.matchedTeam.id)) {
        errors.push({
          rank: entry.rank,
          teamId: entry.teamId,
          message: `Team ${result.matchedTeam.id} (${result.matchedTeam.abbreviation}) is matched by more than one ranking entry.`,
        });
        continue;
      }
      matchedCanonicalIds.add(result.matchedTeam.id);
      teamMatches.push({
        rank: entry.rank,
        teamId: entry.teamId,
        matchedTeamId: result.matchedTeam.id,
        matchedBy: result.matchedBy,
      });
      resolved.push({
        teamId: result.matchedTeam.id,
        rank: entry.rank,
        previousRank: entry.previousRank ?? null,
        tier: entry.tier,
        headline: entry.headline,
        summary: entry.summary,
        strengths: entry.strengths,
        concerns: entry.concerns,
      });
    }

    return { errors, teamMatches, resolved };
  }
}

function findDuplicates<T>(values: readonly T[]): T[] {
  const seen = new Set<T>();
  const duplicates = new Set<T>();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates];
}

function requireSeason(season: number | undefined): number {
  if (season === undefined) {
    throw new AppError({
      code: 'POWER_RANKING_SEASON_REQUIRED',
      message: 'season is required when edition is specified.',
      statusCode: 400,
    });
  }
  return season;
}

function editionNotFound(): AppError {
  return new AppError({
    code: 'POWER_RANKING_EDITION_NOT_FOUND',
    message: 'The requested power ranking edition was not found.',
    statusCode: 404,
  });
}

function entryNotFound(): AppError {
  return new AppError({
    code: 'POWER_RANKING_ENTRY_NOT_FOUND',
    message: 'The requested power ranking entry was not found.',
    statusCode: 404,
  });
}
