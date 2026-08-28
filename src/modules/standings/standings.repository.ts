import type { Prisma, PrismaClient, SeasonType } from '../../generated/prisma/client.js';
import type { NormalizedStanding } from './standings.types.js';

const publicSnapshotInclude = {
  rows: {
    include: { team: true },
    orderBy: { providerOrder: 'asc' },
  },
} as const satisfies Prisma.StandingsSnapshotInclude;

export type StoredStandingsSnapshot = Prisma.StandingsSnapshotGetPayload<{
  include: typeof publicSnapshotInclude;
}>;

export interface StandingsRepository {
  findSnapshot(season: number, seasonType: SeasonType): Promise<StoredStandingsSnapshot | null>;
  findAvailableSeasonTypes(season: number): Promise<readonly SeasonType[]>;
}

export class PrismaStandingsRepository implements StandingsRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findSnapshot(
    season: number,
    seasonType: SeasonType,
  ): Promise<StoredStandingsSnapshot | null> {
    return this.prisma.standingsSnapshot.findFirst({
      where: { season, seasonType },
      orderBy: { updatedAt: 'desc' },
      include: publicSnapshotInclude,
    });
  }

  async findAvailableSeasonTypes(season: number): Promise<readonly SeasonType[]> {
    const rows = await this.prisma.standingsSnapshot.findMany({
      where: { season },
      distinct: ['seasonType'],
      select: { seasonType: true },
      orderBy: { seasonType: 'asc' },
    });
    return rows.map((row) => row.seasonType);
  }

  async replaceProviderSnapshot(input: {
    readonly provider: string;
    readonly season: number;
    readonly seasonType: SeasonType;
    readonly updatedAt: Date;
    readonly records: readonly NormalizedStanding[];
  }): Promise<{ readonly snapshotId: string; readonly rows: number }> {
    if (input.records.length !== 32)
      throw new Error('A standings write requires all 32 NFL teams.');
    const mappings = await this.prisma.teamProviderMapping.findMany({
      where: { provider: input.provider },
      include: { team: true },
    });
    const mappingByProviderId = new Map(
      mappings.map((mapping) => [mapping.providerTeamId, mapping]),
    );
    const mappingByTeamId = new Map(mappings.map((mapping) => [mapping.teamId, mapping]));
    const teams = await this.prisma.team.findMany({
      where: {
        league: 'NFL',
        isActive: true,
        abbreviation: { in: input.records.map((record) => record.teamAbbreviation) },
      },
    });
    const teamByAbbreviation = new Map(teams.map((team) => [team.abbreviation, team]));
    const unresolved = input.records.filter((record) => {
      const mapping = mappingByProviderId.get(record.providerTeamId);
      const team = teamByAbbreviation.get(record.teamAbbreviation);
      if (team?.conference !== record.conference) return true;
      return (
        (mapping?.teamId !== undefined && mapping.teamId !== team.id) ||
        (mapping?.teamId === undefined && mappingByTeamId.has(team.id))
      );
    });
    if (unresolved.length > 0) {
      throw new Error(
        `Standings team mappings are missing or inconsistent for ${String(unresolved.length)} record(s).`,
      );
    }
    const resolvedRecords = input.records.map((record) => {
      const team = teamByAbbreviation.get(record.teamAbbreviation);
      if (team === undefined) throw new Error('A validated standings team became unavailable.');
      return { record, teamId: team.id };
    });

    return this.prisma.$transaction(async (transaction) => {
      await transaction.teamProviderMapping.createMany({
        data: resolvedRecords
          .filter(({ record }) => !mappingByProviderId.has(record.providerTeamId))
          .map(({ record, teamId }) => ({
            provider: input.provider,
            providerTeamId: record.providerTeamId,
            teamId,
          })),
        skipDuplicates: true,
      });
      const snapshot = await transaction.standingsSnapshot.upsert({
        where: {
          provider_season_seasonType: {
            provider: input.provider,
            season: input.season,
            seasonType: input.seasonType,
          },
        },
        create: {
          provider: input.provider,
          season: input.season,
          seasonType: input.seasonType,
          updatedAt: input.updatedAt,
        },
        update: { updatedAt: input.updatedAt },
      });
      await transaction.teamStanding.deleteMany({ where: { snapshotId: snapshot.id } });
      await transaction.teamStanding.createMany({
        data: resolvedRecords.map(({ record, teamId }) => ({
          snapshotId: snapshot.id,
          teamId,
          providerOrder: record.providerOrder,
          conferenceRank: record.conferenceRank,
          playoffSeed: record.playoffSeed,
          wins: record.wins,
          losses: record.losses,
          ties: record.ties,
          winPercentage: record.winPercentage,
          homeWins: record.homeWins,
          homeLosses: record.homeLosses,
          homeTies: record.homeTies,
          awayWins: record.awayWins,
          awayLosses: record.awayLosses,
          awayTies: record.awayTies,
          divisionWins: record.divisionWins,
          divisionLosses: record.divisionLosses,
          divisionTies: record.divisionTies,
          conferenceWins: record.conferenceWins,
          conferenceLosses: record.conferenceLosses,
          conferenceTies: record.conferenceTies,
          pointsFor: record.pointsFor,
          pointsAgainst: record.pointsAgainst,
          pointDifferential: record.pointDifferential,
          streakType: record.streakType,
          streakLength: record.streakLength,
          streakDisplay: record.streakDisplay,
        })),
      });
      return { snapshotId: snapshot.id, rows: input.records.length };
    });
  }
}
