import type {
  CurrentGamePlayerStat,
  CurrentGamePlayerStatCoverage,
  CurrentGameTeamStat,
  Prisma,
  PrismaClient,
} from '../../generated/prisma/client.js';
import type {
  NormalizedCurrentGamePlayerStats,
  NormalizedCurrentGamePeriodScores,
  NormalizedCurrentGameTeamStats,
} from './current-game-details-provider.js';
import type { NormalizedCurrentPlayerProfile } from './current-player-identity-provider.js';
import type { CurrentPlayerIdentityCandidate } from './current-player-reconciliation.js';

export interface CurrentGameDetailsTarget {
  readonly id: string;
  readonly homeTeamId: string;
  readonly awayTeamId: string;
  readonly homeAbbreviation: string;
  readonly awayAbbreviation: string;
  readonly providerMapping: { readonly providerGameId: string } | null;
  readonly teamStats: readonly CurrentGameTeamStat[];
  readonly playerStats: readonly CurrentGamePlayerStat[];
  readonly playerCoverage: CurrentGamePlayerStatCoverage | null;
}

export interface CurrentGameTeamStatWrite extends NormalizedCurrentGameTeamStats {
  readonly gameId: string;
  readonly teamId: string;
  readonly isHome: boolean;
  readonly period1Score: number | null;
  readonly period2Score: number | null;
  readonly period3Score: number | null;
  readonly period4Score: number | null;
  readonly overtime1Score: number | null;
  readonly overtime2Score: number | null;
  readonly sourceProvider: string;
  readonly sourceUpdatedAt: Date;
}

export interface CurrentGameDetailsApplyInput {
  readonly target: CurrentGameDetailsTarget;
  readonly rows: readonly CurrentGameTeamStatWrite[];
  readonly provider: string;
  readonly usageMode: 'evaluation' | 'approved';
  readonly unmatchedPlayerCount: number;
}

export type CurrentGamePlayerStatValues = Omit<
  NormalizedCurrentGamePlayerStats,
  'providerPlayerId' | 'teamProviderId' | 'displayName'
>;

export interface CurrentGamePlayerStatPlan {
  readonly providerPlayerId: string;
  readonly playerId: string | null;
  readonly teamId: string;
  readonly profile: NormalizedCurrentPlayerProfile | null;
  readonly createMapping: boolean;
  readonly values: CurrentGamePlayerStatValues;
  readonly changed: boolean;
}

export interface CurrentGamePlayerApplyInput {
  readonly target: CurrentGameDetailsTarget;
  readonly plans: readonly CurrentGamePlayerStatPlan[];
  readonly provider: string;
  readonly usageMode: 'evaluation' | 'approved';
  readonly sourceUpdatedAt: Date;
  readonly unresolvedPlayerCount: number;
  readonly providerPlayerCount: number;
  readonly resolvedPlayerCount: number;
  readonly coverageChanged: boolean;
}

export interface CurrentGameDetailsRepository {
  findTarget(gameId: string, provider: string): Promise<CurrentGameDetailsTarget | null>;
  findPlayerMappings(
    provider: string,
    providerPlayerIds: readonly string[],
  ): Promise<ReadonlyMap<string, string>>;
  findPlayerMappingOwners?(
    provider: string,
    playerIds: readonly string[],
  ): Promise<ReadonlyMap<string, string>>;
  findPlayerIdentityCandidates?(
    normalizedNames: readonly string[],
    birthDates: readonly string[],
  ): Promise<readonly CurrentPlayerIdentityCandidate[]>;
  applyStats(input: CurrentGameDetailsApplyInput): Promise<void>;
  applyPlayerStats?(input: CurrentGamePlayerApplyInput): Promise<void>;
}

export class PrismaCurrentGameDetailsRepository implements CurrentGameDetailsRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findTarget(gameId: string, provider: string): Promise<CurrentGameDetailsTarget | null> {
    const game = await this.prisma.game.findUnique({
      where: { id: gameId },
      select: {
        id: true,
        homeTeamId: true,
        awayTeamId: true,
        homeTeam: { select: { abbreviation: true } },
        awayTeam: { select: { abbreviation: true } },
        providerMaps: {
          where: { provider },
          take: 1,
          select: { providerGameId: true },
        },
        currentTeamStats: true,
        currentPlayerStats: true,
        currentPlayerCoverage: true,
      },
    });
    if (game === null) return null;
    return {
      id: game.id,
      homeTeamId: game.homeTeamId,
      awayTeamId: game.awayTeamId,
      homeAbbreviation: game.homeTeam.abbreviation,
      awayAbbreviation: game.awayTeam.abbreviation,
      providerMapping: game.providerMaps[0] ?? null,
      teamStats: game.currentTeamStats,
      playerStats: game.currentPlayerStats,
      playerCoverage: game.currentPlayerCoverage,
    };
  }

  async findPlayerIdentityCandidates(
    normalizedNames: readonly string[],
    birthDates: readonly string[],
  ): Promise<readonly CurrentPlayerIdentityCandidate[]> {
    if (normalizedNames.length === 0 && birthDates.length === 0) return [];
    const players = await this.prisma.player.findMany({
      where: {
        OR: [
          ...(normalizedNames.length === 0
            ? []
            : [{ normalizedName: { in: [...new Set(normalizedNames)] } }]),
          ...(birthDates.length === 0
            ? []
            : [
                {
                  birthDate: {
                    in: [...new Set(birthDates)].map(
                      (birthDate) => new Date(`${birthDate}T00:00:00.000Z`),
                    ),
                  },
                },
              ]),
        ],
      },
      select: {
        id: true,
        displayName: true,
        normalizedName: true,
        birthDate: true,
        position: true,
        jerseyNumber: true,
        heightInches: true,
        weightPounds: true,
        draftYear: true,
        draftRound: true,
        draftPick: true,
        latestTeamId: true,
        weeklyRosters: { distinct: ['teamId'], select: { teamId: true } },
      },
    });
    return players.map((player) => ({
      ...player,
      birthDate: player.birthDate?.toISOString().slice(0, 10) ?? null,
      rosterTeamIds: player.weeklyRosters.flatMap(({ teamId }) =>
        teamId === null ? [] : [teamId],
      ),
    }));
  }

  async findPlayerMappings(
    provider: string,
    providerPlayerIds: readonly string[],
  ): Promise<ReadonlyMap<string, string>> {
    if (providerPlayerIds.length === 0) return new Map();
    const mappings = await this.prisma.playerExternalIdentifier.findMany({
      where: { provider, externalId: { in: [...new Set(providerPlayerIds)] } },
      select: { externalId: true, playerId: true },
    });
    return new Map(mappings.map((mapping) => [mapping.externalId, mapping.playerId]));
  }

  async findPlayerMappingOwners(
    provider: string,
    playerIds: readonly string[],
  ): Promise<ReadonlyMap<string, string>> {
    if (playerIds.length === 0) return new Map();
    const mappings = await this.prisma.playerExternalIdentifier.findMany({
      where: { provider, playerId: { in: [...new Set(playerIds)] } },
      select: { externalId: true, playerId: true },
    });
    return new Map(mappings.map((mapping) => [mapping.playerId, mapping.externalId]));
  }

  applyStats(input: CurrentGameDetailsApplyInput): Promise<void> {
    return this.prisma.$transaction(async (transaction) => {
      for (const row of input.rows) {
        const { gameId, teamId, ...data } = row;
        await transaction.currentGameTeamStat.upsert({
          where: { gameId_teamId: { gameId, teamId } },
          create: row,
          update: data,
        });
      }
      await transaction.adminAuditEvent.create({
        data: {
          actorEmailSnapshot: 'current-game-details-sync-cli',
          action: 'CURRENT_GAME_DETAILS_SYNC',
          entityType: 'GAME',
          entityId: input.target.id,
          beforeSnapshot: {
            teamStatRows: input.target.teamStats.length,
          },
          afterSnapshot: {
            provider: input.provider,
            usageMode: input.usageMode,
            changedTeamStatRows: input.rows.length,
            unmatchedPlayerRows: input.unmatchedPlayerCount,
          },
        },
      });
    });
  }

  applyPlayerStats(input: CurrentGamePlayerApplyInput): Promise<void> {
    return this.prisma.$transaction(async (transaction) => {
      let createdPlayers = 0;
      let createdMappings = 0;
      let changedStats = 0;
      for (const plan of input.plans) {
        let playerId = plan.playerId;
        if (playerId === null) {
          if (plan.profile === null) throw new Error('A new current player requires a profile.');
          const player = await transaction.player.create({
            data: currentPlayerCreateData(plan.profile, plan.teamId, input.provider),
            select: { id: true },
          });
          playerId = player.id;
          createdPlayers += 1;
        }
        if (plan.createMapping || plan.playerId === null) {
          await transaction.playerExternalIdentifier.create({
            data: {
              playerId,
              provider: input.provider,
              externalId: plan.providerPlayerId,
              source: 'current-game-player-profile',
            },
          });
          createdMappings += 1;
        }
        if (plan.changed || plan.playerId === null) {
          const row = {
            gameId: input.target.id,
            teamId: plan.teamId,
            playerId,
            ...plan.values,
            sourceProvider: input.provider,
            sourceUpdatedAt: input.sourceUpdatedAt,
          };
          const { gameId, playerId: resolvedPlayerId, ...update } = row;
          await transaction.currentGamePlayerStat.upsert({
            where: { gameId_playerId: { gameId, playerId: resolvedPlayerId } },
            create: row,
            update,
          });
          changedStats += 1;
        }
      }
      if (input.coverageChanged) {
        await transaction.currentGamePlayerStatCoverage.upsert({
          where: { gameId: input.target.id },
          create: {
            gameId: input.target.id,
            providerRows: input.providerPlayerCount,
            resolvedRows: input.resolvedPlayerCount,
            unresolvedRows: input.unresolvedPlayerCount,
            sourceProvider: input.provider,
            sourceUpdatedAt: input.sourceUpdatedAt,
          },
          update: {
            providerRows: input.providerPlayerCount,
            resolvedRows: input.resolvedPlayerCount,
            unresolvedRows: input.unresolvedPlayerCount,
            sourceProvider: input.provider,
            sourceUpdatedAt: input.sourceUpdatedAt,
          },
        });
      }
      await transaction.adminAuditEvent.create({
        data: {
          actorEmailSnapshot: 'current-game-details-sync-cli',
          action: 'CURRENT_GAME_PLAYER_STATS_SYNC',
          entityType: 'GAME',
          entityId: input.target.id,
          beforeSnapshot: { playerStatRows: input.target.playerStats.length },
          afterSnapshot: {
            provider: input.provider,
            usageMode: input.usageMode,
            createdPlayers,
            createdMappings,
            changedPlayerStatRows: changedStats,
            unresolvedPlayerRows: input.unresolvedPlayerCount,
          },
        },
      });
    });
  }
}

function currentPlayerCreateData(
  profile: NormalizedCurrentPlayerProfile,
  teamId: string,
  provider: string,
): Prisma.PlayerUncheckedCreateInput {
  const nameParts = profile.displayName.trim().split(/\s+/);
  return {
    displayName: profile.displayName,
    normalizedName: profile.displayName
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .replace(/\s+/g, ' '),
    firstName: nameParts.length > 1 ? (nameParts[0] ?? null) : null,
    lastName: nameParts.length > 1 ? (nameParts.at(-1) ?? null) : (nameParts[0] ?? null),
    position: profile.position,
    sourcePosition: profile.sourcePosition,
    positionGroup: currentPositionGroup(profile.position),
    birthDate: profile.birthDate === null ? null : new Date(`${profile.birthDate}T00:00:00.000Z`),
    heightInches: profile.heightInches,
    weightPounds: profile.weightPounds,
    rookieSeason: profile.draftYear,
    lastSeason: null,
    draftYear: profile.draftYear,
    draftRound: profile.draftRound,
    draftPick: profile.draftPick,
    latestTeamId: teamId,
    latestTeamSource: null,
    jerseyNumber: profile.jerseyNumber,
    status: profile.isActive === null ? null : profile.isActive ? 'ACTIVE' : 'INACTIVE',
    profileSource: `${provider}-current-game-profile`,
  };
}

function currentPositionGroup(position: string | null): string | null {
  if (position === null) return null;
  if (position === 'K' || position === 'P' || position === 'LS') return 'SPEC';
  return position;
}

export function toTeamStatWrite(input: {
  readonly gameId: string;
  readonly teamId: string;
  readonly isHome: boolean;
  readonly stats: NormalizedCurrentGameTeamStats;
  readonly periods: NormalizedCurrentGamePeriodScores;
  readonly provider: string;
  readonly sourceUpdatedAt: Date;
}): CurrentGameTeamStatWrite {
  return {
    gameId: input.gameId,
    teamId: input.teamId,
    isHome: input.isHome,
    ...input.stats,
    period1Score: input.periods.period1,
    period2Score: input.periods.period2,
    period3Score: input.periods.period3,
    period4Score: input.periods.period4,
    overtime1Score: input.periods.overtime1,
    overtime2Score: input.periods.overtime2,
    sourceProvider: input.provider,
    sourceUpdatedAt: input.sourceUpdatedAt,
  };
}
