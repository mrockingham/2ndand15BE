import type { UserRole } from '../../generated/prisma/client.js';
import { AppError } from '../../common/errors/app-error.js';
import { normalizeEmail } from '../auth/auth.service.js';
import { roleHasCapability, type AdministrativePrincipal } from './admin-authorization.js';
import { classifyCurrentGameTeamStats } from '../sports/current-game-team-stat-coverage.js';
import type {
  ReconciliationDiagnostic,
  ReconciliationDiagnosticService,
} from '../sports/current-game-play-reconciliation-diagnostic.js';
import type {
  PlayReconciliationRepairService,
  RepairResult,
} from '../sports/current-game-play-repair.js';
import type { PlaysReviewQueueEntry } from '../sports/current-game-poll-state.repository.js';
import {
  toAdminGameDto,
  toAuditEventDto,
  type AdminGameDto,
  type AdminGameRecord,
} from './admin.dto.js';
import {
  sourceIsManuallyOwned,
  type AdminRepository,
  type AuditActor,
  type ImportGameWrite,
} from './admin.repository.js';
import type {
  AdminGameListQuery,
  AuditListQuery,
  GameFeaturedInput,
  GameOverrideInput,
  GameResultFallbackInput,
  ManualGameCreateInput,
  ManualGameUpdateInput,
  PlaysReviewQueueQuery,
  RepairGamePlaysInput,
  ScheduleImportRequest,
  ScheduleImportRow,
  VerificationInput,
} from './admin.schemas.js';

const TEAM_ALIASES: Readonly<Record<string, string>> = { WSH: 'WAS', JAC: 'JAX' };

export interface ScheduleImportFailure {
  readonly row: number;
  readonly code: string;
  readonly message: string;
}

export interface ScheduleImportResult {
  readonly dryRun: boolean;
  readonly received: number;
  readonly created: number;
  readonly updated: number;
  readonly skipped: number;
  readonly warnings: number;
  readonly failed: number;
  readonly failures: readonly ScheduleImportFailure[];
}

export interface GameResultFallbackReport {
  readonly dryRun: boolean;
  readonly outcome: 'WOULD_CREATE' | 'WOULD_UPDATE' | 'CREATED' | 'UPDATED' | 'UNCHANGED';
  readonly game: AdminGameDto;
  readonly resultCoverage: 'EDITORIAL_RESULT_FALLBACK';
  readonly teamStatCoverage:
    'TEAM_STATS_COMPLETE' | 'TEAM_STATS_PARTIAL' | 'TEAM_STATS_UNAVAILABLE';
}

export interface AdministrativeScheduleService {
  listGames(
    query: AdminGameListQuery,
  ): Promise<{ readonly games: readonly AdminGameDto[]; readonly nextCursor: string | null }>;
  getGame(gameId: string): Promise<AdminGameDto>;
  createGame(
    input: ManualGameCreateInput,
    principal: AdministrativePrincipal,
    requestId: string | null,
  ): Promise<AdminGameDto>;
  updateGame(
    gameId: string,
    input: ManualGameUpdateInput,
    principal: AdministrativePrincipal,
    requestId: string | null,
  ): Promise<AdminGameDto>;
  upsertOverride(
    gameId: string,
    input: GameOverrideInput,
    principal: AdministrativePrincipal,
    requestId: string | null,
  ): Promise<AdminGameDto>;
  upsertResultFallback(
    gameId: string,
    input: GameResultFallbackInput,
    principal: AdministrativePrincipal,
    requestId: string | null,
  ): Promise<GameResultFallbackReport>;
  deleteOverride(
    gameId: string,
    principal: AdministrativePrincipal,
    requestId: string | null,
  ): Promise<AdminGameDto>;
  setFeatured(
    gameId: string,
    input: GameFeaturedInput,
    principal: AdministrativePrincipal,
    requestId: string | null,
  ): Promise<AdminGameDto>;
  verifyGame(
    gameId: string,
    input: VerificationInput,
    principal: AdministrativePrincipal,
    requestId: string | null,
  ): Promise<AdminGameDto>;
  importSchedule(
    input: ScheduleImportRequest,
    principal: AdministrativePrincipal | null,
    requestId: string | null,
  ): Promise<ScheduleImportResult>;
  listAuditEvents(
    query: AuditListQuery,
    principal: AdministrativePrincipal,
  ): Promise<{
    readonly events: readonly ReturnType<typeof toAuditEventDto>[];
    readonly nextCursor: string | null;
  }>;
  getPlaysDiagnostic(
    gameId: string,
    principal: AdministrativePrincipal,
  ): Promise<ReconciliationDiagnostic>;
  repairGamePlays(
    gameId: string,
    input: RepairGamePlaysInput,
    principal: AdministrativePrincipal,
    requestId: string | null,
  ): Promise<RepairResult>;
  listPlaysReviewQueue(
    query: PlaysReviewQueueQuery,
    principal: AdministrativePrincipal,
  ): Promise<{ readonly games: readonly PlaysReviewQueueEntry[] }>;
}

export class AdminService implements AdministrativeScheduleService {
  constructor(
    private readonly repository: AdminRepository,
    private readonly now: () => Date = () => new Date(),
    private readonly playsDiagnostic?: ReconciliationDiagnosticService,
    private readonly playsRepair?: PlayReconciliationRepairService,
  ) {}

  async listGames(query: AdminGameListQuery) {
    const page = await this.repository.listGames(query);
    return { games: page.games.map(toAdminGameDto), nextCursor: page.nextCursor };
  }

  async getGame(gameId: string): Promise<AdminGameDto> {
    return toAdminGameDto(await this.requireGame(gameId));
  }

  async createGame(
    input: ManualGameCreateInput,
    principal: AdministrativePrincipal,
    requestId: string | null,
  ): Promise<AdminGameDto> {
    await this.requireActiveTeams(input.homeTeamId, input.awayTeamId);
    const existing = await this.repository.findLikelyGame(toImportWrite(input));
    if (existing !== null) throw duplicateGameError(existing.id);
    return toAdminGameDto(
      await this.repository.createManualGame(input, toActor(principal, requestId), this.now()),
    );
  }

  async updateGame(
    gameId: string,
    input: ManualGameUpdateInput,
    principal: AdministrativePrincipal,
    requestId: string | null,
  ): Promise<AdminGameDto> {
    const existing = await this.requireGame(gameId);
    if (
      existing.providerMaps.length > 0 ||
      !sourceIsManuallyOwned(existing.provenance?.sourceType)
    ) {
      throw new AppError({
        code: 'PROVIDER_GAME_REQUIRES_OVERRIDE',
        message: 'Provider-managed games must be changed through an editorial override.',
        statusCode: 409,
      });
    }
    const homeTeamId = input.homeTeamId ?? existing.homeTeamId;
    const awayTeamId = input.awayTeamId ?? existing.awayTeamId;
    if (homeTeamId === awayTeamId) {
      throw new AppError({
        code: 'SAME_GAME_TEAMS',
        message: 'Home and away teams must differ.',
        statusCode: 400,
      });
    }
    if (input.homeTeamId !== undefined || input.awayTeamId !== undefined) {
      await this.requireActiveTeams(homeTeamId, awayTeamId);
    }
    return toAdminGameDto(
      await this.repository.updateManualGame(gameId, input, toActor(principal, requestId)),
    );
  }

  async upsertOverride(
    gameId: string,
    input: GameOverrideInput,
    principal: AdministrativePrincipal,
    requestId: string | null,
  ): Promise<AdminGameDto> {
    const existing = await this.requireGame(gameId);
    if (
      existing.editorialOverride?.resultVerifiedAt !== null &&
      existing.editorialOverride?.resultVerifiedAt !== undefined &&
      input.status !== undefined
    ) {
      throw new AppError({
        code: 'RESULT_FALLBACK_STATUS_PROTECTED',
        message: 'Use the reviewed result fallback operation to change a fallback final status.',
        statusCode: 409,
      });
    }
    return toAdminGameDto(
      await this.repository.upsertOverride(gameId, input, toActor(principal, requestId)),
    );
  }

  async upsertResultFallback(
    gameId: string,
    input: GameResultFallbackInput,
    principal: AdministrativePrincipal,
    requestId: string | null,
  ): Promise<GameResultFallbackReport> {
    const existing = await this.requireGame(gameId);
    if (!sourceIsManuallyOwned(existing.provenance?.sourceType)) {
      throw new AppError({
        code: 'REVIEWED_GAME_REQUIRED',
        message: 'Result fallback is limited to an existing reviewed internal game.',
        statusCode: 409,
      });
    }
    const unchanged = resultFallbackMatches(existing, input);
    const teamStats = await this.repository.findCurrentTeamStats(gameId);
    const coverage = classifyCurrentGameTeamStats({
      rows: teamStats,
      homeTeamId: existing.homeTeamId,
      awayTeamId: existing.awayTeamId,
    });
    const teamStatCoverage =
      coverage.classification === 'COMPLETE'
        ? ('TEAM_STATS_COMPLETE' as const)
        : coverage.classification === 'PARTIAL'
          ? ('TEAM_STATS_PARTIAL' as const)
          : ('TEAM_STATS_UNAVAILABLE' as const);
    if (unchanged || input.dryRun) {
      return {
        dryRun: input.dryRun,
        outcome: unchanged
          ? 'UNCHANGED'
          : existing.editorialOverride?.resultVerifiedAt === null ||
              existing.editorialOverride === null
            ? 'WOULD_CREATE'
            : 'WOULD_UPDATE',
        game: toAdminGameDto(
          unchanged ? existing : withPlannedResultFallback(existing, input, principal, this.now()),
        ),
        resultCoverage: 'EDITORIAL_RESULT_FALLBACK',
        teamStatCoverage,
      };
    }
    const existingVerifiedAt = existing.editorialOverride?.resultVerifiedAt;
    const created = existingVerifiedAt === null || existingVerifiedAt === undefined;
    const updated = await this.repository.upsertResultFallback(
      gameId,
      input,
      toActor(principal, requestId),
      this.now(),
    );
    return {
      dryRun: false,
      outcome: created ? 'CREATED' : 'UPDATED',
      game: toAdminGameDto(updated),
      resultCoverage: 'EDITORIAL_RESULT_FALLBACK',
      teamStatCoverage,
    };
  }

  async deleteOverride(
    gameId: string,
    principal: AdministrativePrincipal,
    requestId: string | null,
  ): Promise<AdminGameDto> {
    const game = await this.requireGame(gameId);
    if (game.editorialOverride === null) {
      throw new AppError({
        code: 'GAME_OVERRIDE_NOT_FOUND',
        message: 'The game does not have an editorial override.',
        statusCode: 404,
      });
    }
    return toAdminGameDto(
      await this.repository.deleteOverride(gameId, toActor(principal, requestId)),
    );
  }

  async setFeatured(
    gameId: string,
    input: GameFeaturedInput,
    principal: AdministrativePrincipal,
    requestId: string | null,
  ): Promise<AdminGameDto> {
    await this.requireGame(gameId);
    return toAdminGameDto(
      await this.repository.setFeatured(gameId, input, toActor(principal, requestId), this.now()),
    );
  }

  async verifyGame(
    gameId: string,
    input: VerificationInput,
    principal: AdministrativePrincipal,
    requestId: string | null,
  ): Promise<AdminGameDto> {
    await this.requireGame(gameId);
    return toAdminGameDto(
      await this.repository.verifyGame(gameId, input, toActor(principal, requestId), this.now()),
    );
  }

  async importSchedule(
    input: ScheduleImportRequest,
    principal: AdministrativePrincipal | null,
    requestId: string | null,
  ): Promise<ScheduleImportResult> {
    const actor =
      principal === null
        ? { userId: null, emailSnapshot: 'schedule-import-cli', requestId }
        : toActor(principal, requestId);
    const teamMap = new Map(
      (await this.repository.listActiveTeamAbbreviations()).map((team) => [
        team.abbreviation.toUpperCase(),
        team.id,
      ]),
    );
    const failures: ScheduleImportFailure[] = [];
    const prepared: {
      row: number;
      write: ImportGameWrite;
      existing: AdminGameRecord | null;
      warning: boolean;
    }[] = [];
    const identities = new Set<string>();

    for (const [index, row] of input.rows.entries()) {
      const rowNumber = index + 2;
      const unsafeField = findFormulaField(row);
      if (unsafeField !== null) {
        failures.push({
          row: rowNumber,
          code: 'UNSAFE_CSV_VALUE',
          message: `${unsafeField} begins with a spreadsheet formula marker.`,
        });
        continue;
      }
      const homeTeamId = resolveTeam(row.homeTeam, teamMap);
      const awayTeamId = resolveTeam(row.awayTeam, teamMap);
      if (homeTeamId === null || awayTeamId === null) {
        failures.push({
          row: rowNumber,
          code: 'UNKNOWN_TEAM',
          message: `Unknown active team abbreviation: ${homeTeamId === null ? row.homeTeam : row.awayTeam}.`,
        });
        continue;
      }
      if (homeTeamId === awayTeamId) {
        failures.push({
          row: rowNumber,
          code: 'SAME_GAME_TEAMS',
          message: 'Home and away teams must differ.',
        });
        continue;
      }
      const write = toResolvedImportWrite(row, homeTeamId, awayTeamId);
      const identity = `${String(write.season)}|${write.seasonType}|${String(write.week)}|${homeTeamId}|${awayTeamId}|${write.startTime?.toISOString() ?? 'TBD'}`;
      if (identities.has(identity)) {
        failures.push({
          row: rowNumber,
          code: 'DUPLICATE_IMPORT_ROW',
          message: 'The import contains a duplicate game row.',
        });
        continue;
      }
      identities.add(identity);
      const existing =
        write.externalReference === null
          ? await this.repository.findLikelyGame(write)
          : ((await this.repository.findGameBySourceReference(
              write.sourceName,
              write.externalReference,
            )) ?? (await this.repository.findLikelyGame(write)));
      prepared.push({
        row: rowNumber,
        write,
        existing,
        warning: existing?.providerMaps.length !== 0,
      });
    }

    if (failures.length > 0) {
      return result(input, 0, 0, 0, 0, failures);
    }

    let created = 0;
    let updated = 0;
    let skipped = 0;
    let warnings = 0;
    for (const item of prepared) {
      if (item.existing === null) {
        created += 1;
        if (!input.dryRun) await this.repository.createImportedGame(item.write, actor, this.now());
      } else if (matchesImport(item.existing, item.write)) {
        skipped += 1;
      } else {
        updated += 1;
        if (item.warning) warnings += 1;
        if (!input.dryRun) {
          await this.repository.updateImportedGame(item.existing.id, item.write, actor);
        }
      }
    }
    const output = result(input, created, updated, skipped, warnings, []);
    if (!input.dryRun) await this.repository.createImportAudit(actor, output);
    return output;
  }

  async listAuditEvents(query: AuditListQuery, principal: AdministrativePrincipal) {
    if (
      !roleHasCapability(principal.role, 'VIEW_FULL_AUDIT') &&
      query.entityType !== 'GAME' &&
      !(query.entityType === 'ARTICLE' && query.entityId !== undefined)
    ) {
      throw new AppError({
        code: 'ADMIN_AUDIT_SCOPE_REQUIRED',
        message: 'Editors may view game events or audit history scoped to one article.',
        statusCode: 403,
      });
    }
    const page = await this.repository.listAuditEvents(query);
    return { events: page.events.map(toAuditEventDto), nextCursor: page.nextCursor };
  }

  async getPlaysDiagnostic(
    gameId: string,
    principal: AdministrativePrincipal,
  ): Promise<ReconciliationDiagnostic> {
    void principal;
    return this.requirePlaysDiagnostic().diagnose(gameId);
  }

  async repairGamePlays(
    gameId: string,
    input: RepairGamePlaysInput,
    principal: AdministrativePrincipal,
    requestId: string | null,
  ): Promise<RepairResult> {
    const actor = toActor(principal, requestId);
    const repair = this.requirePlaysRepair();
    if (input.mode === 'append-only') {
      return repair.repair({ gameId, mode: 'APPEND_ONLY', actor, reason: input.reason });
    }
    if (input.mode === 'structural-relink') {
      return repair.repair({
        gameId,
        mode: 'STRUCTURAL_RELINK',
        actor,
        reason: input.reason,
        manualLinks: input.manualLinks,
      });
    }
    return repair.repair({
      gameId,
      mode: 'REBUILD_AFTER_CUTOFF',
      actor,
      reason: input.reason,
      cutoffSequence: input.cutoffSequence,
    });
  }

  async listPlaysReviewQueue(
    query: PlaysReviewQueueQuery,
    principal: AdministrativePrincipal,
  ): Promise<{ readonly games: readonly PlaysReviewQueueEntry[] }> {
    void principal;
    const games = await this.repository.listPlaysReviewRequired(query.limit);
    return { games };
  }

  private requirePlaysDiagnostic(): ReconciliationDiagnosticService {
    if (this.playsDiagnostic === undefined) {
      throw new AppError({
        code: 'GAME_PLAYS_REVIEW_UNCONFIGURED',
        message: 'Game plays reconciliation review is not configured on this server.',
        statusCode: 500,
      });
    }
    return this.playsDiagnostic;
  }

  private requirePlaysRepair(): PlayReconciliationRepairService {
    if (this.playsRepair === undefined) {
      throw new AppError({
        code: 'GAME_PLAYS_REVIEW_UNCONFIGURED',
        message: 'Game plays reconciliation repair is not configured on this server.',
        statusCode: 500,
      });
    }
    return this.playsRepair;
  }

  async setRole(
    email: string,
    role: UserRole,
    actor: AuditActor,
  ): Promise<{ id: string; email: string; previousRole: UserRole; role: UserRole }> {
    const result = await this.repository.setUserRole(normalizeEmail(email), role, actor);
    if (result === null) {
      throw new AppError({
        code: 'USER_NOT_FOUND',
        message: 'No existing user has the supplied email.',
        statusCode: 404,
      });
    }
    return result;
  }

  private async requireGame(gameId: string): Promise<AdminGameRecord> {
    const game = await this.repository.findGame(gameId);
    if (game === null) {
      throw new AppError({
        code: 'GAME_NOT_FOUND',
        message: 'The requested game was not found.',
        statusCode: 404,
      });
    }
    return game;
  }

  private async requireActiveTeams(homeTeamId: string, awayTeamId: string): Promise<void> {
    const teams = await this.repository.findActiveTeams([homeTeamId, awayTeamId]);
    if (teams.length !== 2) {
      throw new AppError({
        code: 'ACTIVE_TEAM_NOT_FOUND',
        message: 'Both home and away teams must identify distinct active NFL teams.',
        statusCode: 404,
      });
    }
  }
}

function toActor(principal: AdministrativePrincipal, requestId: string | null): AuditActor {
  return { userId: principal.userId, emailSnapshot: principal.email, requestId };
}

function toImportWrite(input: ManualGameCreateInput): ImportGameWrite {
  return {
    season: input.season,
    seasonType: input.seasonType,
    week: input.week,
    startTime: new Date(input.startTime),
    status: input.status,
    homeTeamId: input.homeTeamId,
    awayTeamId: input.awayTeamId,
    venueName: input.venueName,
    venueCity: input.venueCity,
    broadcastNetwork: input.broadcastNetwork,
    isNeutralSite: input.isNeutralSite,
    sourceName: input.provenance.sourceName,
    sourceType: 'MANUAL_IMPORT',
    sourceUrl: input.provenance.sourceUrl ?? null,
    externalReference: input.provenance.externalReference ?? null,
    notes: input.provenance.notes ?? null,
  };
}

function toResolvedImportWrite(
  row: ScheduleImportRow,
  homeTeamId: string,
  awayTeamId: string,
): ImportGameWrite {
  return {
    ...row,
    startTime: row.startTime === 'TBD' ? null : new Date(row.startTime),
    homeTeamId,
    awayTeamId,
  };
}

function resolveTeam(abbreviation: string, teams: ReadonlyMap<string, string>): string | null {
  const normalized = abbreviation.toUpperCase();
  return teams.get(TEAM_ALIASES[normalized] ?? normalized) ?? null;
}

function matchesImport(game: AdminGameRecord, input: ImportGameWrite): boolean {
  return (
    game.season === input.season &&
    game.seasonType === input.seasonType &&
    game.homeTeamId === input.homeTeamId &&
    game.awayTeamId === input.awayTeamId &&
    sameDate(game.startTime, input.startTime) &&
    game.status === input.status &&
    game.week === input.week &&
    game.venueName === input.venueName &&
    game.venueCity === input.venueCity &&
    game.broadcastNetwork === input.broadcastNetwork &&
    game.isNeutralSite === input.isNeutralSite &&
    (game.provenance?.externalReference ?? null) === input.externalReference &&
    (game.provenance?.sourceName ?? input.sourceName) === input.sourceName &&
    (game.provenance?.sourceType ?? input.sourceType) === input.sourceType
  );
}

function sameDate(left: Date | null, right: Date | null): boolean {
  return left === null || right === null ? left === right : left.getTime() === right.getTime();
}

function findFormulaField(row: ScheduleImportRow): string | null {
  const fields: readonly (keyof ScheduleImportRow)[] = [
    'venueName',
    'venueCity',
    'broadcastNetwork',
    'sourceName',
    'sourceType',
    'externalReference',
    'notes',
  ];
  return (
    fields.find((field) => {
      const value = row[field];
      return typeof value === 'string' && /^[=+\-@]/.test(value.trimStart());
    }) ?? null
  );
}

function result(
  input: ScheduleImportRequest,
  created: number,
  updated: number,
  skipped: number,
  warnings: number,
  failures: readonly ScheduleImportFailure[],
): ScheduleImportResult {
  return {
    dryRun: input.dryRun,
    received: input.rows.length,
    created,
    updated,
    skipped,
    warnings,
    failed: failures.length,
    failures,
  };
}

function duplicateGameError(gameId: string): AppError {
  return new AppError({
    code: 'GAME_ALREADY_EXISTS',
    message: 'A likely duplicate game already exists.',
    statusCode: 409,
    details: { gameId },
  });
}

function resultFallbackMatches(game: AdminGameRecord, input: GameResultFallbackInput): boolean {
  const override = game.editorialOverride;
  return (
    override !== null &&
    override.resultVerifiedAt !== null &&
    override.status === input.status &&
    override.homeScore === input.homeScore &&
    override.awayScore === input.awayScore &&
    override.resultSourceName === input.sourceName &&
    override.resultSourceUrl === (input.sourceUrl ?? null) &&
    override.resultReason === input.reason &&
    override.internalNote === (input.internalNote ?? null) &&
    override.publicCorrectionNote === (input.publicCorrectionNote ?? null)
  );
}

function withPlannedResultFallback(
  game: AdminGameRecord,
  input: GameResultFallbackInput,
  principal: AdministrativePrincipal,
  now: Date,
): AdminGameRecord {
  const existing = game.editorialOverride;
  return {
    ...game,
    editorialOverride: {
      id: existing?.id ?? '00000000-0000-4000-8000-000000000000',
      gameId: game.id,
      startTime: existing?.startTime ?? null,
      status: input.status,
      homeScore: input.homeScore,
      awayScore: input.awayScore,
      week: existing?.week ?? null,
      venueName: existing?.venueName ?? null,
      venueCity: existing?.venueCity ?? null,
      broadcastNetwork: existing?.broadcastNetwork ?? null,
      isNeutralSite: existing?.isNeutralSite ?? null,
      publicCorrectionNote: input.publicCorrectionNote ?? null,
      internalNote: input.internalNote ?? null,
      resultSourceName: input.sourceName,
      resultSourceUrl: input.sourceUrl ?? null,
      resultVerifiedAt: now,
      resultReason: input.reason,
      createdById: existing?.createdById ?? principal.userId,
      updatedById: principal.userId,
      createdBySnapshot: existing?.createdBySnapshot ?? principal.email,
      updatedBySnapshot: principal.email,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    },
  };
}
