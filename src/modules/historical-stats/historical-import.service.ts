import type { Prisma } from '../../generated/prisma/client.js';
import type {
  HistoricalImportRepository,
  HistoricalLookupState,
  ImportFileOutcome,
  MutationCounts,
} from './historical.repository.js';
import {
  type HistoricalManifestFile,
  type LoadedHistoricalManifest,
  resolveManifestFilePath,
} from './historical-manifest.js';
import {
  NFLVERSE_PLAYER_COLUMNS,
  NFLVERSE_PLAYER_IMPORTED_COLUMNS,
  NFLVERSE_PLAYER_REQUIRED_COLUMNS,
  NFLVERSE_PLAYER_STAT_COLUMNS,
  NFLVERSE_PLAYER_STAT_FIELDS,
  NFLVERSE_PLAYER_STAT_IMPORTED_COLUMNS,
  NFLVERSE_ROSTER_COLUMNS,
  NFLVERSE_ROSTER_IMPORTED_COLUMNS,
  NFLVERSE_ROSTER_REQUIRED_COLUMNS,
} from './nflverse-field-mappings.js';
import {
  canonicalTeamAbbreviation,
  nflversePlayerIdentifiers,
  nflversePlayerSchema,
  nflversePlayerStatSchema,
  nflverseRosterIdentifiers,
  nflverseRosterSchema,
  normalizeRosterSeasonType,
  type NflverseRoster,
} from './historical-normalization.js';
import {
  detectSchemaDrift,
  inspectParquet,
  readParquetBatches,
  verifyLocalFile,
  type SchemaDriftReport,
} from './parquet-reader.js';
import { readNflverseSchedule } from './nflverse-schedule.js';

export interface HistoricalFileReview {
  readonly dataset: HistoricalManifestFile['dataset'];
  readonly season: number | null;
  readonly status: 'PASS' | 'WARNING' | 'FAIL';
  readonly sourceRows: number;
  readonly acceptedRows: number;
  readonly warningCount: number;
  readonly failureCount: number;
  readonly schema:
    SchemaDriftReport | { readonly status: 'PASS'; readonly columns: readonly string[] };
  readonly importedColumns: readonly string[];
  readonly omittedColumns: readonly string[];
  readonly reconciliation: Readonly<Record<string, unknown>>;
  readonly issues: readonly string[];
}

export interface HistoricalReviewReport {
  readonly status: 'PASS' | 'WARNING' | 'FAIL';
  readonly files: readonly HistoricalFileReview[];
  readonly totals: {
    readonly sourceRows: number;
    readonly acceptedRows: number;
    readonly warnings: number;
    readonly failures: number;
  };
}

export interface HistoricalImportResult {
  readonly dryRun: boolean;
  readonly review: HistoricalReviewReport;
  readonly writeStatus: 'NOT_REQUESTED' | 'SUCCEEDED';
  readonly databaseSizeBefore: string | null;
  readonly databaseSizeAfter: string | null;
  readonly databaseGrowthBytes: string | null;
  readonly summariesRebuilt: number;
}

interface ReviewContext {
  readonly lookup: HistoricalLookupState;
  readonly virtualPlayers: Map<string, string>;
  readonly virtualGames: Map<string, string>;
}

const FILE_ORDER: Readonly<Record<HistoricalManifestFile['dataset'], number>> = {
  SCHEDULES: 0,
  PLAYERS: 1,
  WEEKLY_ROSTERS: 2,
  PLAYER_STATS: 3,
};

export class HistoricalImportService {
  constructor(private readonly repository: HistoricalImportRepository) {}

  async review(loaded: LoadedHistoricalManifest): Promise<HistoricalReviewReport> {
    const files = [...loaded.manifest.files].sort(
      (left, right) => FILE_ORDER[left.dataset] - FILE_ORDER[right.dataset],
    );
    const seasons = [
      ...new Set(files.flatMap((file) => (file.season === null ? [] : [file.season]))),
    ];
    const lookup = await this.repository.loadLookupState(seasons);
    const context: ReviewContext = {
      lookup,
      virtualPlayers: new Map(lookup.players),
      virtualGames: new Map(lookup.games),
    };
    const reviews: HistoricalFileReview[] = [];
    for (const file of files) reviews.push(await this.reviewFile(loaded, file, context));
    const totals = reviews.reduce(
      (result, file) => ({
        sourceRows: result.sourceRows + file.sourceRows,
        acceptedRows: result.acceptedRows + file.acceptedRows,
        warnings: result.warnings + file.warningCount,
        failures: result.failures + file.failureCount,
      }),
      { sourceRows: 0, acceptedRows: 0, warnings: 0, failures: 0 },
    );
    return {
      status: totals.failures > 0 ? 'FAIL' : totals.warnings > 0 ? 'WARNING' : 'PASS',
      files: reviews,
      totals,
    };
  }

  async execute(
    loaded: LoadedHistoricalManifest,
    options: {
      readonly write: boolean;
      readonly initiatedBy: string;
      readonly maxGrowthBytes: number;
    },
  ): Promise<HistoricalImportResult> {
    const review = await this.review(loaded);
    if (!options.write)
      return {
        dryRun: true,
        review,
        writeStatus: 'NOT_REQUESTED',
        databaseSizeBefore: null,
        databaseSizeAfter: null,
        databaseGrowthBytes: null,
        summariesRebuilt: 0,
      };
    if (review.status === 'FAIL')
      throw new Error('Historical import review failed; no database writes were performed.');
    const before = await this.repository.measureDatabase();
    const projected =
      loaded.manifest.files.reduce((total, file) => total + file.fileSizeBytes, 0) * 4;
    if (projected > options.maxGrowthBytes) {
      throw new Error(
        `Projected database growth ${String(projected)} exceeds configured threshold ${String(options.maxGrowthBytes)}.`,
      );
    }
    const runId = await this.repository.beginImport(
      false,
      options.initiatedBy,
      before.databaseBytes,
    );
    let summariesRebuilt = 0;
    const results: Record<string, unknown>[] = [];
    try {
      const files = [...loaded.manifest.files].sort(
        (left, right) => FILE_ORDER[left.dataset] - FILE_ORDER[right.dataset],
      );
      let lookup = await this.repository.loadLookupState(
        files.flatMap((file) => (file.season === null ? [] : [file.season])),
      );
      for (const file of files) {
        const fileId = await this.repository.beginImportFile(runId, file);
        const fileReview = review.files.find(
          (entry) => entry.dataset === file.dataset && entry.season === file.season,
        );
        if (fileReview === undefined)
          throw new Error('Reviewed historical file could not be resolved.');
        try {
          const counts = await this.writeFile(loaded, file, lookup);
          if (
            file.dataset === 'SCHEDULES' ||
            file.dataset === 'PLAYERS' ||
            file.dataset === 'WEEKLY_ROSTERS'
          ) {
            lookup = await this.repository.loadLookupState(
              files.flatMap((entry) => (entry.season === null ? [] : [entry.season])),
            );
          }
          if (file.dataset === 'PLAYER_STATS' && file.season !== null)
            summariesRebuilt += await this.repository.rebuildSeasonSummaries(file.season);
          const outcome = toOutcome(fileReview, counts);
          await this.repository.finishImportFile(fileId, 'SUCCEEDED', outcome);
          results.push({ dataset: file.dataset, season: file.season, ...counts });
        } catch (error) {
          const failed = toOutcome(fileReview, { created: 0, updated: 0, skipped: 0 }, 1);
          await this.repository.finishImportFile(fileId, 'FAILED', failed);
          throw error;
        }
      }
      const after = await this.repository.measureDatabase();
      const summary = jsonValue({
        files: results,
        summariesRebuilt,
        databaseGrowthBytes: (after.databaseBytes - before.databaseBytes).toString(),
        relations: after.relations.map((entry) => ({
          relation: entry.relation,
          tableBytes: entry.tableBytes.toString(),
          indexBytes: entry.indexBytes.toString(),
        })),
      });
      await this.repository.finishImport(runId, 'SUCCEEDED', after.databaseBytes, summary);
      return {
        dryRun: false,
        review,
        writeStatus: 'SUCCEEDED',
        databaseSizeBefore: before.databaseBytes.toString(),
        databaseSizeAfter: after.databaseBytes.toString(),
        databaseGrowthBytes: (after.databaseBytes - before.databaseBytes).toString(),
        summariesRebuilt,
      };
    } catch (error) {
      const after = await this.repository.measureDatabase();
      await this.repository.finishImport(
        runId,
        'FAILED',
        after.databaseBytes,
        jsonValue({ error: safeError(error) }),
      );
      throw error;
    }
  }

  private async reviewFile(
    loaded: LoadedHistoricalManifest,
    file: HistoricalManifestFile,
    context: ReviewContext,
  ): Promise<HistoricalFileReview> {
    const path = resolveManifestFilePath(loaded, file);
    await verifyLocalFile(path, file.fileSizeBytes, file.sha256);
    if (file.dataset === 'SCHEDULES') return this.reviewSchedule(path, file, context);
    const inspection = await inspectParquet(path);
    const expectation = schemaExpectation(file.dataset);
    const schema = detectSchemaDrift(inspection, expectation);
    const issues = schema.missingRequiredColumns
      .map((column) => `Missing required column ${column}.`)
      .concat(
        schema.incompatibleTypes.map(
          (entry) => `Column ${entry.column} changed from ${entry.expected} to ${entry.actual}.`,
        ),
      );
    let acceptedRows = 0;
    let warningCount = schema.unknownColumns.length;
    let failureCount = issues.length;
    const reconciliation: Record<string, unknown> = {};
    if (schema.status !== 'FAIL') {
      const result =
        file.dataset === 'PLAYERS'
          ? await this.reviewPlayers(path, context)
          : file.dataset === 'WEEKLY_ROSTERS'
            ? await this.reviewRosters(path, file, context)
            : await this.reviewStats(path, file, context);
      acceptedRows = result.accepted;
      warningCount += result.warnings;
      failureCount += result.failures;
      issues.push(...result.issues);
      Object.assign(reconciliation, result.reconciliation);
    }
    const importedColumns =
      file.dataset === 'PLAYER_STATS'
        ? [...NFLVERSE_PLAYER_STAT_IMPORTED_COLUMNS]
        : file.dataset === 'PLAYERS'
          ? [...NFLVERSE_PLAYER_IMPORTED_COLUMNS]
          : [...NFLVERSE_ROSTER_IMPORTED_COLUMNS];
    const sourceColumns = inspection.columns.map((column) => column.name);
    return {
      dataset: file.dataset,
      season: file.season,
      status: failureCount > 0 ? 'FAIL' : warningCount > 0 ? 'WARNING' : 'PASS',
      sourceRows: inspection.rowCount,
      acceptedRows,
      warningCount,
      failureCount,
      schema,
      importedColumns,
      omittedColumns: sourceColumns.filter((column) => !importedColumns.includes(column)),
      reconciliation,
      issues: issues.slice(0, 100),
    };
  }

  private async reviewSchedule(
    path: string,
    file: HistoricalManifestFile,
    context: ReviewContext,
  ): Promise<HistoricalFileReview> {
    if (file.season === null) throw new Error('Schedule manifest entry requires a season.');
    const parsed = await readNflverseSchedule(path, new Set([file.season]));
    const issues: string[] = [];
    let accepted = 0;
    for (const row of parsed.rows) {
      if (!context.lookup.teams.has(row.homeTeam) || !context.lookup.teams.has(row.awayTeam)) {
        issues.push(`Unknown team in game ${row.providerGameId}.`);
        continue;
      }
      context.virtualGames.set(
        row.providerGameId,
        context.lookup.games.get(row.providerGameId) ?? `virtual:${row.providerGameId}`,
      );
      accepted += 1;
    }
    return {
      dataset: file.dataset,
      season: file.season,
      status: issues.length > 0 ? 'FAIL' : 'PASS',
      sourceRows: parsed.rows.length,
      acceptedRows: accepted,
      warningCount: 0,
      failureCount: issues.length,
      schema: { status: 'PASS', columns: parsed.sourceColumns },
      importedColumns: [
        'game_id',
        'season',
        'game_type',
        'week',
        'away_team',
        'away_score',
        'home_team',
        'home_score',
        'stadium',
      ],
      omittedColumns: parsed.sourceColumns.filter(
        (column) =>
          ![
            'game_id',
            'season',
            'game_type',
            'week',
            'away_team',
            'away_score',
            'home_team',
            'home_score',
            'stadium',
          ].includes(column),
      ),
      reconciliation: { uniqueGames: parsed.rows.length, unresolvedTeams: issues.length },
      issues: issues.slice(0, 100),
    };
  }

  private async reviewPlayers(path: string, context: ReviewContext): Promise<ReviewRowsResult> {
    const seen = new Map<string, string>();
    const sourcePlayers = new Set<string>();
    const issues: string[] = [];
    let accepted = 0;
    let warnings = 0;
    let failures = 0;
    let duplicateMergedRows = 0;
    for await (const batch of readParquetBatches(path, NFLVERSE_PLAYER_COLUMNS)) {
      for (const raw of batch) {
        const parsed = nflversePlayerSchema.safeParse(raw);
        if (!parsed.success) {
          issues.push(
            `Invalid player row: ${parsed.error.issues[0]?.message ?? 'validation failed'}`,
          );
          failures += 1;
          continue;
        }
        const player = parsed.data;
        if (
          (player.height !== null &&
            player.height !== undefined &&
            (player.height < 48 || player.height > 96)) ||
          (player.weight !== null &&
            player.weight !== undefined &&
            (player.weight < 100 || player.weight > 500))
        ) {
          warnings += 1;
          issues.push(
            `Player ${player.display_name} has an out-of-range measurement; that field will be omitted.`,
          );
        }
        const identifiers = nflversePlayerIdentifiers(player);
        const existingIds = new Set(
          identifiers.flatMap(([provider, id]) => {
            const owner = context.virtualPlayers.get(`${provider}:${id}`);
            return owner === undefined ? [] : [owner];
          }),
        );
        if (existingIds.size > 1) {
          issues.push(`Identity collision for ${player.display_name}.`);
          failures += 1;
          continue;
        }
        const virtualId =
          [...existingIds][0] ?? `virtual:${identifiers[0]?.join(':') ?? player.display_name}`;
        if (sourcePlayers.has(virtualId)) {
          duplicateMergedRows += 1;
          warnings += 1;
          issues.push(
            `Duplicate source profile for ${player.display_name} was merged by stable identifiers.`,
          );
        }
        let collision = false;
        for (const [provider, id] of identifiers) {
          const key = `${provider}:${id}`;
          const owner = seen.get(key) ?? context.virtualPlayers.get(key);
          if (owner !== undefined && owner !== virtualId) {
            issues.push(`Identity collision for ${key}.`);
            failures += 1;
            collision = true;
          } else {
            seen.set(key, virtualId);
            context.virtualPlayers.set(key, virtualId);
          }
        }
        if (!collision) {
          accepted += 1;
          sourcePlayers.add(virtualId);
        }
      }
    }
    return {
      accepted,
      warnings,
      failures,
      issues,
      reconciliation: {
        uniquePlayers: sourcePlayers.size,
        duplicateMergedRows,
        identityCollisions: failures,
      },
    };
  }

  private async reviewRosters(
    path: string,
    file: HistoricalManifestFile,
    context: ReviewContext,
  ): Promise<ReviewRowsResult> {
    const identities = new Set<string>();
    const issues: string[] = [];
    const unknownTeams = new Set<string>();
    let accepted = 0;
    let rosterDerivedPlayers = 0;
    let unidentifiableSourceRows = 0;
    for await (const batch of readParquetBatches(path, NFLVERSE_ROSTER_COLUMNS)) {
      for (const raw of batch) {
        if (!hasRosterIdentity(raw)) {
          unidentifiableSourceRows += 1;
          continue;
        }
        const parsed = nflverseRosterSchema.safeParse(raw);
        if (!parsed.success || parsed.data.season !== file.season) {
          issues.push('Invalid or wrong-season weekly roster row.');
          continue;
        }
        const row = parsed.data;
        let player = resolvePlayer(row, context.virtualPlayers, ROSTER_IDENTIFIERS);
        if (player === null) {
          const identifiers = nflverseRosterIdentifiers(row);
          if (identifiers.length === 0) {
            issues.push(`Unresolved roster player ${row.full_name}.`);
            continue;
          }
          player = `virtual:roster:${identifiers[0]?.join(':') ?? row.full_name}`;
          for (const [provider, id] of identifiers)
            context.virtualPlayers.set(`${provider}:${id}`, player);
          rosterDerivedPlayers += 1;
        }
        const team = canonicalTeamAbbreviation(row.team);
        if (team !== null && !context.lookup.teams.has(team)) {
          unknownTeams.add(row.team);
          issues.push(`Unknown roster team ${row.team}.`);
          continue;
        }
        const identity = `${player}:${String(row.season)}:${String(row.week)}:${normalizeRosterSeasonType(row.game_type)}:${row.team}`;
        if (identities.has(identity)) {
          issues.push(`Duplicate roster row ${identity}.`);
          continue;
        }
        identities.add(identity);
        accepted += 1;
      }
    }
    return {
      accepted,
      warnings: rosterDerivedPlayers + unidentifiableSourceRows,
      failures: issues.length,
      issues,
      reconciliation: {
        uniqueRosterRows: accepted,
        rosterDerivedPlayers,
        unidentifiableSourceRows,
        unknownTeams: [...unknownTeams],
      },
    };
  }

  private async reviewStats(
    path: string,
    file: HistoricalManifestFile,
    context: ReviewContext,
  ): Promise<ReviewRowsResult> {
    const columns = [...NFLVERSE_PLAYER_STAT_IMPORTED_COLUMNS];
    const identities = new Set<string>();
    const players = new Set<string>();
    const games = new Set<string>();
    const teams = new Set<string>();
    const weeks: Record<string, number> = {};
    const positions: Record<string, number> = {};
    const issues: string[] = [];
    let accepted = 0;
    let passingAttempts = 0;
    let rushingAttempts = 0;
    let receptions = 0;
    let touchdowns = 0;
    let defensiveRows = 0;
    let kickingRows = 0;
    let missingPlayers = 0;
    let missingGames = 0;
    let unidentifiableSourceRows = 0;
    for await (const batch of readParquetBatches(path, columns)) {
      for (const raw of batch) {
        if (raw.player_id === null || raw.player_id === undefined || raw.player_id === '') {
          unidentifiableSourceRows += 1;
          continue;
        }
        const parsed = nflversePlayerStatSchema.safeParse(raw);
        if (!parsed.success || parsed.data.season !== file.season) {
          issues.push(
            `Invalid player stat: ${
              parsed.success
                ? 'wrong season'
                : (parsed.error.issues[0]?.message ?? 'unknown validation error')
            }`,
          );
          continue;
        }
        const row = parsed.data;
        const player = context.virtualPlayers.get(`GSIS:${row.player_id}`);
        if (player === undefined) {
          missingPlayers += 1;
          issues.push(`Missing player ${row.player_id}.`);
          continue;
        }
        const game = context.virtualGames.get(row.game_id);
        if (game === undefined) {
          missingGames += 1;
          issues.push(`Missing game ${row.game_id}.`);
          continue;
        }
        const team = canonicalTeamAbbreviation(row.team);
        const opponent = canonicalTeamAbbreviation(row.opponent_team);
        if (
          team === null ||
          opponent === null ||
          !context.lookup.teams.has(team) ||
          !context.lookup.teams.has(opponent)
        ) {
          issues.push(`Unknown stat team in ${row.game_id}.`);
          continue;
        }
        const identity = `${player}:${game}:${team}`;
        if (identities.has(identity)) {
          issues.push(`Duplicate stat row ${identity}.`);
          continue;
        }
        identities.add(identity);
        players.add(player);
        games.add(game);
        teams.add(team);
        accepted += 1;
        weeks[String(row.week)] = (weeks[String(row.week)] ?? 0) + 1;
        const position = row.position_group ?? 'UNKNOWN';
        positions[position] = (positions[position] ?? 0) + 1;
        passingAttempts += row.attempts ?? 0;
        rushingAttempts += row.carries ?? 0;
        receptions += row.receptions ?? 0;
        touchdowns +=
          (row.passing_tds ?? 0) +
          (row.rushing_tds ?? 0) +
          (row.receiving_tds ?? 0) +
          (row.def_tds ?? 0) +
          (row.special_teams_tds ?? 0);
        if ((row.def_tackles_solo ?? 0) + (row.def_sacks ?? 0) + (row.def_interceptions ?? 0) > 0)
          defensiveRows += 1;
        if ((row.fg_att ?? 0) + (row.pat_att ?? 0) + (row.pt_att ?? 0) > 0) kickingRows += 1;
      }
    }
    return {
      accepted,
      warnings: unidentifiableSourceRows,
      failures: issues.length,
      issues,
      reconciliation: {
        uniquePlayers: players.size,
        uniqueGames: games.size,
        teamsRepresented: teams.size,
        rowsByPositionGroup: positions,
        rowsByWeek: weeks,
        passingAttempts,
        rushingAttempts,
        receptions,
        touchdowns,
        defensiveRows,
        kickingRows,
        missingPlayerMappings: missingPlayers,
        missingGameMappings: missingGames,
        unidentifiableSourceRows,
        duplicateRows: issues.filter((issue) => issue.startsWith('Duplicate stat')).length,
      },
    };
  }

  private async writeFile(
    loaded: LoadedHistoricalManifest,
    file: HistoricalManifestFile,
    lookup: HistoricalLookupState,
  ): Promise<MutationCounts> {
    const path = resolveManifestFilePath(loaded, file);
    let total: MutationCounts = { created: 0, updated: 0, skipped: 0 };
    if (file.dataset === 'SCHEDULES') {
      if (file.season === null) throw new Error('Schedule season is required.');
      const parsed = await readNflverseSchedule(path, new Set([file.season]));
      return this.repository.upsertSchedules(parsed.rows, lookup.teams);
    }
    const columns =
      file.dataset === 'PLAYERS'
        ? NFLVERSE_PLAYER_COLUMNS
        : file.dataset === 'WEEKLY_ROSTERS'
          ? NFLVERSE_ROSTER_COLUMNS
          : [...NFLVERSE_PLAYER_STAT_IMPORTED_COLUMNS];
    for await (const batch of readParquetBatches(path, columns, 500)) {
      const writableBatch =
        file.dataset === 'PLAYER_STATS'
          ? batch.filter(
              (row) =>
                row.player_id !== null && row.player_id !== undefined && row.player_id !== '',
            )
          : file.dataset === 'WEEKLY_ROSTERS'
            ? batch.filter(hasRosterIdentity)
            : batch;
      const counts =
        file.dataset === 'PLAYERS'
          ? await this.repository.upsertPlayers(
              writableBatch.map((row) => nflversePlayerSchema.parse(row)),
              lookup.teams,
            )
          : file.dataset === 'WEEKLY_ROSTERS'
            ? await this.repository.upsertRosters(
                writableBatch.map((row) => nflverseRosterSchema.parse(row)),
                lookup,
              )
            : await this.repository.upsertPlayerStats(
                writableBatch.map((row) => nflversePlayerStatSchema.parse(row)),
                lookup,
              );
      total = addCounts(total, counts);
    }
    return total;
  }
}

interface ReviewRowsResult {
  readonly accepted: number;
  readonly warnings: number;
  readonly failures: number;
  readonly issues: readonly string[];
  readonly reconciliation: Readonly<Record<string, unknown>>;
}

const ROSTER_IDENTIFIERS = [
  ['GSIS', 'gsis_id'],
  ['SMART', 'smart_id'],
  ['ESB', 'esb_id'],
  ['ESPN', 'espn_id'],
  ['PFR', 'pfr_id'],
  ['PFF', 'pff_id'],
  ['SPORTRADAR', 'sportradar_id'],
  ['YAHOO', 'yahoo_id'],
  ['SLEEPER', 'sleeper_id'],
] as const satisfies readonly (readonly [string, keyof NflverseRoster])[];

function hasRosterIdentity(row: Readonly<Record<string, unknown>>): boolean {
  return ROSTER_IDENTIFIERS.some(([, column]) => {
    const value = row[column];
    return typeof value === 'string' && value.trim() !== '';
  });
}

function resolvePlayer<T extends Readonly<Record<string, unknown>>>(
  row: T,
  players: ReadonlyMap<string, string>,
  identifiers: readonly (readonly [string, keyof T])[],
): string | null {
  for (const [provider, column] of identifiers) {
    const value = row[column];
    if (typeof value === 'string' && value.trim() !== '') {
      const player = players.get(`${provider}:${value.trim()}`);
      if (player !== undefined) return player;
    }
  }
  return null;
}

function schemaExpectation(dataset: 'PLAYERS' | 'WEEKLY_ROSTERS' | 'PLAYER_STATS') {
  if (dataset === 'PLAYERS')
    return {
      approvedColumns: NFLVERSE_PLAYER_COLUMNS,
      requiredColumns: NFLVERSE_PLAYER_REQUIRED_COLUMNS,
      expectedTypes: { gsis_id: 'BYTE_ARRAY', display_name: 'BYTE_ARRAY' } as const,
    };
  if (dataset === 'WEEKLY_ROSTERS')
    return {
      approvedColumns: NFLVERSE_ROSTER_COLUMNS,
      requiredColumns: NFLVERSE_ROSTER_REQUIRED_COLUMNS,
      expectedTypes: {
        season: 'INT32',
        team: 'BYTE_ARRAY',
        week: 'INT32',
        game_type: 'BYTE_ARRAY',
      } as const,
    };
  return {
    approvedColumns: NFLVERSE_PLAYER_STAT_COLUMNS,
    requiredColumns: NFLVERSE_PLAYER_STAT_FIELDS.filter((field) => field.required).map(
      (field) => field.source,
    ),
    expectedTypes: Object.fromEntries(
      NFLVERSE_PLAYER_STAT_FIELDS.map((field) => [field.source, field.type]),
    ),
  };
}

function addCounts(left: MutationCounts, right: MutationCounts): MutationCounts {
  return {
    created: left.created + right.created,
    updated: left.updated + right.updated,
    skipped: left.skipped + right.skipped,
  };
}

function toOutcome(
  review: HistoricalFileReview,
  counts: MutationCounts,
  extraFailure = 0,
): ImportFileOutcome {
  return {
    ...counts,
    sourceRows: review.sourceRows,
    acceptedRows: review.acceptedRows,
    warnings: review.warningCount,
    failures: review.failureCount + extraFailure,
    schemaReport: jsonValue(review.schema),
    reconciliation: jsonValue(review.reconciliation),
  };
}

function jsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}
function safeError(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 500) : 'Historical import failed.';
}
