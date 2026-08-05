import { randomUUID } from 'node:crypto';

import type {
  HistoricalImportStatus,
  Prisma,
  PrismaClient,
  SeasonType,
} from '../../generated/prisma/client.js';
import type { HistoricalManifestFile } from './historical-manifest.js';
import {
  canonicalTeamAbbreviation,
  cleanOptionalText,
  nflversePlayerIdentifiers,
  nflverseRosterIdentifiers,
  normalizePlayerName,
  normalizePosition,
  normalizeRosterSeasonType,
  parseOptionalInteger,
  sourceRowHash,
  type NflversePlayer,
  type NflversePlayerStat,
  type NflverseRoster,
} from './historical-normalization.js';
import type { HistoricalScheduleRow } from './nflverse-schedule.js';

export interface HistoricalLookupState {
  readonly teams: ReadonlyMap<string, string>;
  readonly players: ReadonlyMap<string, string>;
  readonly games: ReadonlyMap<string, string>;
}

export interface MutationCounts {
  readonly created: number;
  readonly updated: number;
  readonly skipped: number;
}

export interface DatabaseSizeReport {
  readonly databaseBytes: bigint;
  readonly relations: readonly { relation: string; tableBytes: bigint; indexBytes: bigint }[];
}

export interface ImportFileOutcome extends MutationCounts {
  readonly sourceRows: number;
  readonly acceptedRows: number;
  readonly warnings: number;
  readonly failures: number;
  readonly schemaReport: Prisma.InputJsonValue;
  readonly reconciliation: Prisma.InputJsonValue;
}

export interface HistoricalImportRepository {
  loadLookupState(seasons: readonly number[]): Promise<HistoricalLookupState>;
  upsertSchedules(
    rows: readonly HistoricalScheduleRow[],
    teams: ReadonlyMap<string, string>,
  ): Promise<MutationCounts>;
  upsertPlayers(
    rows: readonly NflversePlayer[],
    teams: ReadonlyMap<string, string>,
  ): Promise<MutationCounts>;
  upsertRosters(
    rows: readonly NflverseRoster[],
    lookup: HistoricalLookupState,
  ): Promise<MutationCounts>;
  upsertPlayerStats(
    rows: readonly NflversePlayerStat[],
    lookup: HistoricalLookupState,
  ): Promise<MutationCounts>;
  rebuildSeasonSummaries(season: number): Promise<number>;
  measureDatabase(): Promise<DatabaseSizeReport>;
  beginImport(dryRun: boolean, initiatedBy: string, sizeBefore: bigint): Promise<string>;
  beginImportFile(runId: string, file: HistoricalManifestFile): Promise<string>;
  finishImportFile(
    id: string,
    status: HistoricalImportStatus,
    outcome: ImportFileOutcome,
  ): Promise<void>;
  finishImport(
    runId: string,
    status: HistoricalImportStatus,
    sizeAfter: bigint,
    summary: Prisma.InputJsonValue,
  ): Promise<void>;
}

const ROSTER_PROVIDER_COLUMNS = [
  ['GSIS', 'gsis_id'],
  ['SMART', 'smart_id'],
  ['ESB', 'esb_id'],
  ['ESPN', 'espn_id'],
  ['PFR', 'pfr_id'],
  ['PFF', 'pff_id'],
  ['SPORTRADAR', 'sportradar_id'],
  ['YAHOO', 'yahoo_id'],
  ['SLEEPER', 'sleeper_id'],
] as const;

export class PrismaHistoricalImportRepository implements HistoricalImportRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async loadLookupState(seasons: readonly number[]): Promise<HistoricalLookupState> {
    const [teams, games] = await Promise.all([
      this.prisma.team.findMany({
        where: { league: 'NFL' },
        select: { id: true, abbreviation: true },
      }),
      this.prisma.gameProviderMapping.findMany({
        where: { provider: 'nflverse', game: { season: { in: [...seasons] } } },
        select: { gameId: true, providerGameId: true },
      }),
    ]);
    let playerIds: readonly { playerId: string; provider: string; externalId: string }[];
    try {
      playerIds = await this.prisma.playerExternalIdentifier.findMany({
        select: { playerId: true, provider: true, externalId: true },
      });
    } catch (error) {
      if (!isMissingHistoricalTableError(error)) throw error;
      playerIds = [];
    }
    return {
      teams: new Map(teams.map((team) => [team.abbreviation, team.id])),
      players: new Map(
        playerIds.map((mapping) => [`${mapping.provider}:${mapping.externalId}`, mapping.playerId]),
      ),
      games: new Map(games.map((mapping) => [mapping.providerGameId, mapping.gameId])),
    };
  }

  async upsertSchedules(
    rows: readonly HistoricalScheduleRow[],
    teams: ReadonlyMap<string, string>,
  ): Promise<MutationCounts> {
    return this.prisma.$transaction(
      async (transaction) => {
        let created = 0;
        let updated = 0;
        let skipped = 0;
        for (const row of rows) {
          const homeTeamId = requiredLookup(teams, row.homeTeam, 'team');
          const awayTeamId = requiredLookup(teams, row.awayTeam, 'team');
          const mapping = await transaction.gameProviderMapping.findUnique({
            where: {
              provider_providerGameId: { provider: 'nflverse', providerGameId: row.providerGameId },
            },
            include: { game: true },
          });
          if (mapping !== null) {
            const changed =
              mapping.game.homeScore !== row.homeScore ||
              mapping.game.awayScore !== row.awayScore ||
              mapping.game.status !== row.status ||
              mapping.game.venueName !== row.venueName;
            if (!changed) {
              skipped += 1;
              continue;
            }
            await transaction.game.update({
              where: { id: mapping.gameId },
              data: {
                homeScore: row.homeScore,
                awayScore: row.awayScore,
                status: row.status,
                venueName: row.venueName,
              },
            });
            updated += 1;
            continue;
          }
          const candidates = await transaction.game.findMany({
            where: {
              league: 'NFL',
              season: row.season,
              seasonType: row.seasonType,
              week: row.week,
              homeTeamId,
              awayTeamId,
              NOT: { provenance: { is: { sourceType: 'DEVELOPMENT_FIXTURE' } } },
            },
            select: { id: true },
            take: 2,
          });
          if (candidates.length > 1)
            throw new Error(`Ambiguous historical game match for ${row.providerGameId}.`);
          if (candidates[0] !== undefined) {
            await transaction.gameProviderMapping.create({
              data: {
                gameId: candidates[0].id,
                provider: 'nflverse',
                providerGameId: row.providerGameId,
              },
            });
            updated += 1;
            continue;
          }
          await transaction.game.create({
            data: {
              league: 'NFL',
              season: row.season,
              seasonType: row.seasonType,
              week: row.week,
              startTime: null,
              status: row.status,
              homeTeamId,
              awayTeamId,
              homeScore: row.homeScore,
              awayScore: row.awayScore,
              venueName: row.venueName,
              isNeutralSite: false,
              providerMaps: {
                create: { provider: 'nflverse', providerGameId: row.providerGameId },
              },
              provenance: {
                create: {
                  sourceType: 'PROVIDER',
                  sourceName: 'nflverse schedules',
                  sourceUrl: 'https://github.com/nflverse/nflverse-data/releases/tag/schedules',
                  externalReference: row.providerGameId,
                  notes:
                    'Historical identity import; kickoff intentionally omitted rather than inferred from local time.',
                },
              },
            },
          });
          created += 1;
        }
        return { created, updated, skipped };
      },
      { timeout: 120_000 },
    );
  }

  async upsertPlayers(
    rows: readonly NflversePlayer[],
    teams: ReadonlyMap<string, string>,
  ): Promise<MutationCounts> {
    return this.prisma.$transaction(
      async (transaction) => {
        let created = 0;
        let updated = 0;
        let skipped = 0;
        const sourceIdentifiers = rows.flatMap((row) => nflversePlayerIdentifiers(row));
        const matchingMappings = await transaction.playerExternalIdentifier.findMany({
          where: {
            OR: sourceIdentifiers.map(([provider, externalId]) => ({ provider, externalId })),
          },
          select: { playerId: true, provider: true, externalId: true },
        });
        const existingPlayerIds = [...new Set(matchingMappings.map((mapping) => mapping.playerId))];
        const existingMappings = await transaction.playerExternalIdentifier.findMany({
          where: { playerId: { in: existingPlayerIds } },
          select: { playerId: true, provider: true, externalId: true },
        });
        const externalOwners = new Map(
          existingMappings.map((mapping) => [
            `${mapping.provider}:${mapping.externalId}`,
            mapping.playerId,
          ]),
        );
        const providerOwners = new Map(
          existingMappings.map((mapping) => [
            `${mapping.playerId}:${mapping.provider}`,
            mapping.externalId,
          ]),
        );
        const existingPlayers = await transaction.player.findMany({
          where: { id: { in: existingPlayerIds } },
        });
        const currentPlayers = new Map(existingPlayers.map((player) => [player.id, player]));
        const playerCreates: Prisma.PlayerCreateManyInput[] = [];
        const playerUpdates: { id: string; data: Prisma.PlayerUncheckedUpdateInput }[] = [];
        const identifierCreates: Prisma.PlayerExternalIdentifierCreateManyInput[] = [];
        const newPlayerIds = new Set<string>();
        const newPlayerCreateIndexes = new Map<string, number>();
        const newPlayerProfileRanks = new Map<string, number>();
        for (const row of rows) {
          const identifiers = nflversePlayerIdentifiers(row);
          if (identifiers.length === 0)
            throw new Error(`Player ${row.display_name} has no stable external identifier.`);
          const owners = new Set(
            identifiers.flatMap(([provider, externalId]) => {
              const owner = externalOwners.get(`${provider}:${externalId}`);
              return owner === undefined ? [] : [owner];
            }),
          );
          if (owners.size > 1)
            throw new Error(`Player identity collision for ${row.display_name}.`);
          const existingPlayerId = [...owners][0];
          const data = playerProfileData(row, teams);
          let playerId: string;
          if (existingPlayerId === undefined) {
            playerId = randomUUID();
            playerCreates.push({ id: playerId, ...data });
            newPlayerIds.add(playerId);
            newPlayerCreateIndexes.set(playerId, playerCreates.length - 1);
            newPlayerProfileRanks.set(playerId, playerProfileRank(row));
            created += 1;
          } else {
            playerId = existingPlayerId;
            if (newPlayerIds.has(playerId)) {
              const incomingRank = playerProfileRank(row);
              if (incomingRank > (newPlayerProfileRanks.get(playerId) ?? 0)) {
                const index = newPlayerCreateIndexes.get(playerId);
                if (index === undefined)
                  throw new Error('Queued player profile could not be found.');
                playerCreates[index] = { id: playerId, ...data };
                newPlayerProfileRanks.set(playerId, incomingRank);
              }
              skipped += 1;
            } else {
              const current = currentPlayers.get(playerId);
              if (current === undefined)
                throw new Error(`Mapped player ${playerId} could not be loaded.`);
              const hasCanonicalGsis =
                providerOwners.get(`${playerId}:GSIS`)?.startsWith('00-') === true;
              if (playerProfileRank(row) < 2 && hasCanonicalGsis) {
                skipped += 1;
              } else {
                const updateData = Object.fromEntries(
                  Object.entries(data).filter(([, value]) => value !== null),
                ) as Prisma.PlayerUncheckedUpdateInput;
                const changed = Object.entries(updateData).some(
                  ([key, value]) =>
                    !samePersistenceValue(current[key as keyof typeof current], value),
                );
                if (changed) {
                  playerUpdates.push({ id: playerId, data: updateData });
                  updated += 1;
                } else skipped += 1;
              }
            }
          }
          for (const [provider, externalId] of identifiers) {
            const externalKey = `${provider}:${externalId}`;
            const conflictOwner = externalOwners.get(externalKey);
            if (conflictOwner !== undefined && conflictOwner !== playerId)
              throw new Error(`Player identity collision for ${provider}:${externalId}.`);
            const providerKey = `${playerId}:${provider}`;
            const providerExternalId = providerOwners.get(providerKey);
            if (providerExternalId !== undefined && providerExternalId !== externalId) {
              throw new Error(`Player ${playerId} has conflicting ${provider} identifiers.`);
            }
            if (conflictOwner === undefined && providerExternalId === undefined) {
              identifierCreates.push({
                id: randomUUID(),
                playerId,
                provider,
                externalId,
                source: 'nflverse-players',
              });
              externalOwners.set(externalKey, playerId);
              providerOwners.set(providerKey, externalId);
            }
          }
        }
        if (playerCreates.length > 0) await transaction.player.createMany({ data: playerCreates });
        for (const change of playerUpdates)
          await transaction.player.update({ where: { id: change.id }, data: change.data });
        if (identifierCreates.length > 0)
          await transaction.playerExternalIdentifier.createMany({ data: identifierCreates });
        return { created, updated, skipped };
      },
      { timeout: 120_000 },
    );
  }

  async upsertRosters(
    rows: readonly NflverseRoster[],
    lookup: HistoricalLookupState,
  ): Promise<MutationCounts> {
    return this.prisma.$transaction(
      async (transaction) => {
        let created = 0;
        let updated = 0;
        let skipped = 0;
        const players = new Map(lookup.players);
        const prepared: {
          identity: {
            playerId: string;
            season: number;
            week: number;
            seasonType: SeasonType;
            sourceTeam: string;
          };
          data: Omit<Prisma.PlayerWeekRosterCreateManyInput, 'id'>;
          hash: string;
        }[] = [];
        for (const row of rows) {
          const playerId =
            resolveRosterPlayer(row, players) ??
            (await createRosterDerivedPlayer(transaction, row, players, lookup.teams));
          const canonicalTeam = canonicalTeamAbbreviation(row.team);
          const teamId =
            canonicalTeam === null ? null : requiredLookup(lookup.teams, canonicalTeam, 'team');
          const hash = sourceRowHash(row);
          const identity = {
            playerId,
            season: row.season,
            week: row.week,
            seasonType: normalizeRosterSeasonType(row.game_type),
            sourceTeam: row.team,
          };
          const data = {
            ...identity,
            teamId,
            position: normalizePosition(row.position),
            sourcePosition: cleanOptionalText(row.position),
            depthChartPosition: cleanOptionalText(row.depth_chart_position),
            jerseyNumber: row.jersey_number ?? null,
            status: cleanOptionalText(row.status),
            statusDescription: cleanOptionalText(row.status_description_abbr),
            footballName: cleanOptionalText(row.football_name),
            yearsExperience: row.years_exp ?? null,
            sourceRowHash: hash,
          };
          prepared.push({ identity, data, hash });
        }
        const existingRows = await transaction.playerWeekRoster.findMany({
          where: { OR: prepared.map(({ identity }) => identity) },
          select: {
            id: true,
            playerId: true,
            season: true,
            week: true,
            seasonType: true,
            sourceTeam: true,
            sourceRowHash: true,
          },
        });
        const existingByIdentity = new Map(
          existingRows.map((row) => [rosterIdentityKey(row), row]),
        );
        const creates: Prisma.PlayerWeekRosterCreateManyInput[] = [];
        const updates: { id: string; data: Prisma.PlayerWeekRosterUncheckedUpdateInput }[] = [];
        for (const row of prepared) {
          const existing = existingByIdentity.get(rosterIdentityKey(row.identity));
          if (existing?.sourceRowHash === row.hash) skipped += 1;
          else if (existing === undefined) {
            creates.push({ id: randomUUID(), ...row.data });
            created += 1;
          } else {
            updates.push({ id: existing.id, data: row.data });
            updated += 1;
          }
        }
        if (creates.length > 0) await transaction.playerWeekRoster.createMany({ data: creates });
        for (const change of updates)
          await transaction.playerWeekRoster.update({
            where: { id: change.id },
            data: change.data,
          });
        return { created, updated, skipped };
      },
      { timeout: 120_000 },
    );
  }

  async upsertPlayerStats(
    rows: readonly NflversePlayerStat[],
    lookup: HistoricalLookupState,
  ): Promise<MutationCounts> {
    return this.prisma.$transaction(
      async (transaction) => {
        let created = 0;
        let updated = 0;
        let skipped = 0;
        const prepared: {
          identity: { playerId: string; gameId: string; teamId: string };
          data: Omit<Prisma.PlayerGameStatCreateManyInput, 'id' | 'playerId' | 'gameId' | 'teamId'>;
          hash: string;
        }[] = [];
        for (const row of rows) {
          const playerId = requiredLookup(lookup.players, `GSIS:${row.player_id}`, 'player');
          const gameId = requiredLookup(lookup.games, row.game_id, 'game');
          const team = canonicalTeamAbbreviation(row.team);
          const opponent = canonicalTeamAbbreviation(row.opponent_team);
          if (team === null || opponent === null)
            throw new Error(`Stat ${row.game_id} has a non-team code.`);
          const teamId = requiredLookup(lookup.teams, team, 'team');
          const opponentTeamId = requiredLookup(lookup.teams, opponent, 'team');
          const hash = sourceRowHash(row);
          const data = playerGameStatData(row, opponentTeamId, hash);
          prepared.push({ identity: { playerId, gameId, teamId }, data, hash });
        }
        const existingRows = await transaction.playerGameStat.findMany({
          where: { OR: prepared.map(({ identity }) => identity) },
          select: {
            id: true,
            playerId: true,
            gameId: true,
            teamId: true,
            sourceRowHash: true,
          },
        });
        const existingByIdentity = new Map(existingRows.map((row) => [statIdentityKey(row), row]));
        const creates: Prisma.PlayerGameStatCreateManyInput[] = [];
        const updates: { id: string; data: Prisma.PlayerGameStatUncheckedUpdateInput }[] = [];
        for (const row of prepared) {
          const existing = existingByIdentity.get(statIdentityKey(row.identity));
          if (existing?.sourceRowHash === row.hash) skipped += 1;
          else if (existing === undefined) {
            creates.push({ id: randomUUID(), ...row.identity, ...row.data });
            created += 1;
          } else {
            updates.push({ id: existing.id, data: row.data });
            updated += 1;
          }
        }
        if (creates.length > 0) await transaction.playerGameStat.createMany({ data: creates });
        for (const change of updates)
          await transaction.playerGameStat.update({ where: { id: change.id }, data: change.data });
        return { created, updated, skipped };
      },
      { timeout: 120_000 },
    );
  }

  async rebuildSeasonSummaries(season: number): Promise<number> {
    const rows = await this.prisma.playerGameStat.findMany({
      where: { season },
      orderBy: { id: 'asc' },
    });
    const summaries = aggregateSummaries(rows);
    await this.prisma.$transaction(
      async (transaction) => {
        const existing = await transaction.playerSeasonStat.findMany({ where: { season } });
        const existingByIdentity = new Map(
          existing.map((row) => [`${row.playerId}:${row.summaryType}`, row]),
        );
        const retainedIds = new Set<string>();
        const creates: Prisma.PlayerSeasonStatCreateManyInput[] = [];
        const updates: {
          id: string;
          data: Prisma.PlayerSeasonStatUncheckedUpdateInput;
        }[] = [];
        for (const summary of summaries) {
          const current = existingByIdentity.get(`${summary.playerId}:${summary.summaryType}`);
          if (current === undefined) creates.push({ id: randomUUID(), ...summary });
          else {
            retainedIds.add(current.id);
            if (!sameSeasonSummary(current, summary))
              updates.push({ id: current.id, data: summary });
          }
        }
        if (creates.length > 0) await transaction.playerSeasonStat.createMany({ data: creates });
        for (const change of updates)
          await transaction.playerSeasonStat.update({
            where: { id: change.id },
            data: change.data,
          });
        const staleIds = existing.filter((row) => !retainedIds.has(row.id)).map((row) => row.id);
        if (staleIds.length > 0)
          await transaction.playerSeasonStat.deleteMany({ where: { id: { in: staleIds } } });
      },
      { timeout: 120_000 },
    );
    return summaries.length;
  }

  async measureDatabase(): Promise<DatabaseSizeReport> {
    const database = await this.prisma.$queryRaw<
      readonly { bytes: bigint }[]
    >`SELECT pg_database_size(current_database()) AS bytes`;
    const relations = await this.prisma.$queryRaw<
      readonly { relation: string; table_bytes: bigint; index_bytes: bigint }[]
    >`
      SELECT relname AS relation, pg_table_size(c.oid) AS table_bytes, pg_indexes_size(c.oid) AS index_bytes
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND relname IN ('players','player_external_identifiers','player_week_rosters','player_game_stats','player_season_stats','historical_datasets','historical_import_runs','historical_import_files')
      ORDER BY relname`;
    return {
      databaseBytes: database[0]?.bytes ?? 0n,
      relations: relations.map((row) => ({
        relation: row.relation,
        tableBytes: row.table_bytes,
        indexBytes: row.index_bytes,
      })),
    };
  }

  async beginImport(dryRun: boolean, initiatedBy: string, sizeBefore: bigint): Promise<string> {
    const run = await this.prisma.historicalImportRun.create({
      data: { dryRun, initiatedBy, databaseSizeBefore: sizeBefore },
    });
    return run.id;
  }

  async beginImportFile(runId: string, file: HistoricalManifestFile): Promise<string> {
    const leaseKey = buildHistoricalImportLeaseKey(file);
    const found = await this.prisma.historicalDataset.findFirst({
      where: { dataset: file.dataset, season: file.season, releaseId: file.releaseId },
    });
    const dataset =
      found === null
        ? await this.prisma.historicalDataset.create({
            data: {
              dataset: file.dataset,
              season: file.season,
              sourceUrl: file.sourceUrl,
              releaseId: file.releaseId,
              schemaVersion: file.schemaVersion,
              mappingVersion: file.mappingVersion,
              attribution: 'nflverse data, CC BY 4.0',
            },
          })
        : await this.prisma.historicalDataset.update({
            where: { id: found.id },
            data: {
              sourceUrl: file.sourceUrl,
              schemaVersion: file.schemaVersion,
              mappingVersion: file.mappingVersion,
            },
          });
    const record = await this.prisma.historicalImportFile.create({
      data: {
        runId,
        datasetId: dataset.id,
        leaseKey,
        checksumSha256: file.sha256,
        fileSizeBytes: BigInt(file.fileSizeBytes),
        downloadedAt: new Date(file.downloadedAt),
      },
    });
    return record.id;
  }

  async finishImportFile(
    id: string,
    status: HistoricalImportStatus,
    outcome: ImportFileOutcome,
  ): Promise<void> {
    await this.prisma.historicalImportFile.update({
      where: { id },
      data: {
        status,
        completedAt: new Date(),
        sourceRowCount: outcome.sourceRows,
        acceptedRowCount: outcome.acceptedRows,
        createdCount: outcome.created,
        updatedCount: outcome.updated,
        skippedCount: outcome.skipped,
        warningCount: outcome.warnings,
        failureCount: outcome.failures,
        schemaReport: outcome.schemaReport,
        reconciliation: outcome.reconciliation,
      },
    });
  }

  async finishImport(
    runId: string,
    status: HistoricalImportStatus,
    sizeAfter: bigint,
    summary: Prisma.InputJsonValue,
  ): Promise<void> {
    await this.prisma.historicalImportRun.update({
      where: { id: runId },
      data: { status, completedAt: new Date(), databaseSizeAfter: sizeAfter, summary },
    });
  }
}

export function buildHistoricalImportLeaseKey(
  file: Pick<HistoricalManifestFile, 'dataset' | 'season'>,
): string {
  return `${file.dataset}:${file.season === null ? 'global' : String(file.season)}`;
}

function playerProfileData(
  row: NflversePlayer,
  teams: ReadonlyMap<string, string>,
): Prisma.PlayerUncheckedCreateInput {
  const latest = cleanOptionalText(row.latest_team);
  const draft = cleanOptionalText(row.draft_team);
  const latestCanonical = latest === null ? null : canonicalTeamAbbreviation(latest);
  const draftCanonical = draft === null ? null : canonicalTeamAbbreviation(draft);
  const optional = <T>(value: T | null | undefined): T | null => value ?? null;
  return {
    displayName: row.display_name,
    normalizedName: normalizePlayerName(row.display_name),
    firstName: optional(cleanOptionalText(row.first_name)),
    lastName: optional(cleanOptionalText(row.last_name)),
    shortName: optional(cleanOptionalText(row.short_name)),
    footballName: optional(cleanOptionalText(row.football_name)),
    position: optional(normalizePosition(row.position)),
    sourcePosition: optional(cleanOptionalText(row.position)),
    positionGroup: optional(cleanOptionalText(row.position_group)),
    birthDate:
      row.birth_date === null || row.birth_date === undefined
        ? null
        : new Date(`${row.birth_date}T00:00:00.000Z`),
    heightInches: optional(reasonableRange(row.height, 48, 96)),
    weightPounds: optional(reasonableRange(row.weight, 100, 500)),
    college: optional(cleanOptionalText(row.college_name)),
    rookieSeason: optional(row.rookie_season),
    lastSeason: optional(row.last_season),
    draftYear: optional(row.draft_year),
    draftRound: optional(row.draft_round),
    draftPick: optional(row.draft_pick),
    draftTeamId: draftCanonical === null ? null : (teams.get(draftCanonical) ?? null),
    draftTeamSource: optional(draft),
    latestTeamId: latestCanonical === null ? null : (teams.get(latestCanonical) ?? null),
    latestTeamSource: optional(latest),
    jerseyNumber: optional(parseOptionalInteger(row.jersey_number)),
    status: optional(cleanOptionalText(row.status)),
    headshotUrl: optional(cleanOptionalText(row.headshot)),
    profileSource: 'nflverse-players',
  };
}

function playerProfileRank(row: NflversePlayer): number {
  return /^00-\d{7}$/.test(row.gsis_id) ? 2 : 1;
}

function resolveRosterPlayer(
  row: NflverseRoster,
  players: ReadonlyMap<string, string>,
): string | null {
  for (const [provider, column] of ROSTER_PROVIDER_COLUMNS) {
    const value = cleanOptionalText(row[column]);
    if (value !== null) {
      const player = players.get(`${provider}:${value}`);
      if (player !== undefined) return player;
    }
  }
  return null;
}

async function createRosterDerivedPlayer(
  transaction: Prisma.TransactionClient,
  row: NflverseRoster,
  players: Map<string, string>,
  teams: ReadonlyMap<string, string>,
): Promise<string> {
  const identifiers = nflverseRosterIdentifiers(row);
  if (identifiers.length === 0)
    throw new Error(`Roster player ${row.full_name} has no stable external identifier.`);
  const mappings = await transaction.playerExternalIdentifier.findMany({
    where: { OR: identifiers.map(([provider, externalId]) => ({ provider, externalId })) },
    select: { playerId: true },
  });
  const owners = new Set(mappings.map((mapping) => mapping.playerId));
  if (owners.size > 1) throw new Error(`Roster identity collision for ${row.full_name}.`);
  let playerId = [...owners][0];
  if (playerId === undefined) {
    const team = canonicalTeamAbbreviation(row.team);
    const player = await transaction.player.create({
      data: {
        displayName: row.full_name,
        normalizedName: normalizePlayerName(row.full_name),
        firstName: cleanOptionalText(row.first_name),
        lastName: cleanOptionalText(row.last_name),
        footballName: cleanOptionalText(row.football_name),
        position: normalizePosition(row.position),
        sourcePosition: cleanOptionalText(row.position),
        latestTeamId: team === null ? null : (teams.get(team) ?? null),
        latestTeamSource: cleanOptionalText(row.team),
        jerseyNumber: row.jersey_number ?? null,
        status: cleanOptionalText(row.status),
        headshotUrl: validHttpUrl(row.headshot_url),
        profileSource: 'nflverse-weekly-rosters',
      },
    });
    playerId = player.id;
  }
  for (const [provider, externalId] of identifiers) {
    const conflict = await transaction.playerExternalIdentifier.findUnique({
      where: { provider_externalId: { provider, externalId } },
    });
    if (conflict !== null && conflict.playerId !== playerId)
      throw new Error(`Roster identity collision for ${provider}:${externalId}.`);
    const existingProvider = await transaction.playerExternalIdentifier.findUnique({
      where: { playerId_provider: { playerId, provider } },
    });
    if (existingProvider !== null && existingProvider.externalId !== externalId)
      throw new Error(`Roster player has conflicting ${provider} identifiers.`);
    if (conflict === null && existingProvider === null)
      await transaction.playerExternalIdentifier.create({
        data: { playerId, provider, externalId, source: 'nflverse-weekly-rosters' },
      });
    players.set(`${provider}:${externalId}`, playerId);
  }
  return playerId;
}

function validHttpUrl(value: string | null | undefined): string | null {
  const cleaned = cleanOptionalText(value);
  if (cleaned === null) return null;
  try {
    return ['http:', 'https:'].includes(new URL(cleaned).protocol) ? cleaned : null;
  } catch {
    return null;
  }
}

function playerGameStatData(
  row: NflversePlayerStat,
  opponentTeamId: string,
  hash: string,
): Omit<Prisma.PlayerGameStatUncheckedCreateInput, 'playerId' | 'gameId' | 'teamId'> {
  const value = (key: keyof NflversePlayerStat): number | null => {
    const item = row[key];
    return typeof item === 'number' ? item : null;
  };
  return {
    opponentTeamId,
    season: row.season,
    week: row.week,
    seasonType: row.season_type,
    position: cleanOptionalText(row.position),
    positionGroup: cleanOptionalText(row.position_group),
    completions: value('completions'),
    attempts: value('attempts'),
    passingYards: value('passing_yards'),
    passingTouchdowns: value('passing_tds'),
    passingInterceptions: value('passing_interceptions'),
    sacksSuffered: value('sacks_suffered'),
    sackYardsLost: value('sack_yards_lost'),
    passingAirYards: value('passing_air_yards'),
    passingYardsAfterCatch: value('passing_yards_after_catch'),
    passingFirstDowns: value('passing_first_downs'),
    passingEpa: value('passing_epa'),
    passing2ptConversions: value('passing_2pt_conversions'),
    carries: value('carries'),
    rushingYards: value('rushing_yards'),
    rushingTouchdowns: value('rushing_tds'),
    rushingFirstDowns: value('rushing_first_downs'),
    rushingEpa: value('rushing_epa'),
    rushingFumbles: value('rushing_fumbles'),
    rushingFumblesLost: value('rushing_fumbles_lost'),
    rushing2ptConversions: value('rushing_2pt_conversions'),
    targets: value('targets'),
    receptions: value('receptions'),
    receivingYards: value('receiving_yards'),
    receivingTouchdowns: value('receiving_tds'),
    receivingAirYards: value('receiving_air_yards'),
    receivingYardsAfterCatch: value('receiving_yards_after_catch'),
    receivingFirstDowns: value('receiving_first_downs'),
    receivingEpa: value('receiving_epa'),
    targetShare: value('target_share'),
    receiving2ptConversions: value('receiving_2pt_conversions'),
    fumbles: value('fumbles_total'),
    fumblesLost: value('fumbles_lost_total'),
    tacklesSolo: value('def_tackles_solo'),
    tacklesWithAssist: value('def_tackles_with_assist'),
    tackleAssists: value('def_tackle_assists'),
    tacklesForLoss: value('def_tackles_for_loss'),
    defensiveSacks: value('def_sacks'),
    defensiveSackYards: value('def_sack_yards'),
    quarterbackHits: value('def_qb_hits'),
    defensiveInterceptions: value('def_interceptions'),
    interceptionYards: value('def_interception_yards'),
    passesDefended: value('def_pass_defended'),
    forcedFumbles: value('def_fumbles_forced'),
    fumbleRecoveries: value('fumble_recovery_opp'),
    defensiveTouchdowns: value('def_tds'),
    fieldGoalsMade: value('fg_made'),
    fieldGoalsAttempted: value('fg_att'),
    extraPointsMade: value('pat_made'),
    extraPointsAttempted: value('pat_att'),
    punts: value('pt_att'),
    puntYards: value('pt_yards'),
    puntReturnYards: value('punt_return_yards'),
    puntReturnTouchdowns: value('pt_return_tds'),
    kickoffReturnYards: value('kickoff_return_yards'),
    specialTeamsTouchdowns: value('special_teams_tds'),
    fantasyPointsStandard: value('fantasy_points'),
    fantasyPointsPpr: value('fantasy_points_ppr'),
    sourceRowHash: hash,
  };
}

type StatRow = Awaited<ReturnType<PrismaClient['playerGameStat']['findMany']>>[number];
function aggregateSummaries(
  rows: readonly StatRow[],
): Prisma.PlayerSeasonStatUncheckedCreateInput[] {
  const groups = new Map<string, { summaryType: 'REG' | 'POST' | 'REG_POST'; rows: StatRow[] }>();
  for (const row of rows) {
    for (const summaryType of row.seasonType === 'REG'
      ? (['REG', 'REG_POST'] as const)
      : row.seasonType === 'POST'
        ? (['POST', 'REG_POST'] as const)
        : []) {
      const key = `${row.playerId}:${summaryType}`;
      const group = groups.get(key) ?? { summaryType, rows: [] };
      group.rows.push(row);
      groups.set(key, group);
    }
  }
  return [...groups.values()].map(({ summaryType, rows: group }) => {
    const first = group[0];
    if (first === undefined) throw new Error('Unexpected empty aggregation group.');
    const sum = (key: keyof StatRow): number | null => {
      const values = group
        .map((row) => row[key])
        .filter((entry): entry is number => typeof entry === 'number');
      return values.length === 0 ? null : values.reduce((total, entry) => total + entry, 0);
    };
    return {
      playerId: first.playerId,
      season: first.season,
      summaryType,
      position: first.position,
      positionGroup: first.positionGroup,
      games: new Set(group.map((row) => row.gameId)).size,
      teamCount: new Set(group.map((row) => row.teamId)).size,
      completions: sum('completions'),
      attempts: sum('attempts'),
      passingYards: sum('passingYards'),
      passingTouchdowns: sum('passingTouchdowns'),
      passingInterceptions: sum('passingInterceptions'),
      carries: sum('carries'),
      rushingYards: sum('rushingYards'),
      rushingTouchdowns: sum('rushingTouchdowns'),
      targets: sum('targets'),
      receptions: sum('receptions'),
      receivingYards: sum('receivingYards'),
      receivingTouchdowns: sum('receivingTouchdowns'),
      tacklesSolo: sum('tacklesSolo'),
      tackleAssists: sum('tackleAssists'),
      defensiveSacks: sum('defensiveSacks'),
      defensiveInterceptions: sum('defensiveInterceptions'),
      forcedFumbles: sum('forcedFumbles'),
      defensiveTouchdowns: sum('defensiveTouchdowns'),
      fieldGoalsMade: sum('fieldGoalsMade'),
      fieldGoalsAttempted: sum('fieldGoalsAttempted'),
      extraPointsMade: sum('extraPointsMade'),
      extraPointsAttempted: sum('extraPointsAttempted'),
      punts: sum('punts'),
      puntYards: sum('puntYards'),
      fantasyPointsStandard: sum('fantasyPointsStandard'),
      fantasyPointsPpr: sum('fantasyPointsPpr'),
      aggregationVersion: 'weekly-sum-v1',
    };
  });
}

function rosterIdentityKey(row: {
  readonly playerId: string;
  readonly season: number;
  readonly week: number;
  readonly seasonType: SeasonType;
  readonly sourceTeam: string;
}): string {
  return `${row.playerId}:${String(row.season)}:${String(row.week)}:${row.seasonType}:${row.sourceTeam}`;
}

function statIdentityKey(row: {
  readonly playerId: string;
  readonly gameId: string;
  readonly teamId: string;
}): string {
  return `${row.playerId}:${row.gameId}:${row.teamId}`;
}

function sameSeasonSummary(
  current: Awaited<ReturnType<PrismaClient['playerSeasonStat']['findMany']>>[number],
  next: Prisma.PlayerSeasonStatUncheckedCreateInput,
): boolean {
  return Object.entries(next).every(([key, value]) =>
    samePersistenceValue(current[key as keyof typeof current], value),
  );
}

function requiredLookup(map: ReadonlyMap<string, string>, key: string, kind: string): string {
  const value = map.get(key);
  if (value === undefined) throw new Error(`Unresolved ${kind} mapping: ${key}.`);
  return value;
}

function samePersistenceValue(left: unknown, right: unknown): boolean {
  if (left instanceof Date && right instanceof Date) return left.getTime() === right.getTime();
  return left === right;
}

function reasonableRange(
  value: number | null | undefined,
  minimum: number,
  maximum: number,
): number | null {
  return value !== null && value !== undefined && value >= minimum && value <= maximum
    ? value
    : null;
}

function isMissingHistoricalTableError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2021'
  );
}
