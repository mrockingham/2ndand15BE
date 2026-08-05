import type {
  Player,
  PlayerGameStat,
  PlayerSeasonStat,
  Team,
} from '../../generated/prisma/client.js';

export const NFLVERSE_PUBLIC_ATTRIBUTION = {
  source: 'nflverse',
  license: 'CC BY 4.0',
  url: 'https://github.com/nflverse/nflverse-data',
} as const;

export type PlayerWithTeam = Player & { latestTeam: Team | null };
export type PlayerStatWithContext = PlayerGameStat & {
  team: Team;
  opponentTeam: Team;
  game: { startTime: Date | null };
};

export function toPlayerDto(player: PlayerWithTeam) {
  return {
    id: player.id,
    displayName: player.displayName,
    firstName: player.firstName,
    lastName: player.lastName,
    shortName: player.shortName,
    position: player.position,
    positionGroup: player.positionGroup,
    birthDate: player.birthDate?.toISOString().slice(0, 10) ?? null,
    heightInches: player.heightInches,
    weightPounds: player.weightPounds,
    college: player.college,
    rookieSeason: player.rookieSeason,
    lastSeason: player.lastSeason,
    draft:
      player.draftYear === null
        ? null
        : { year: player.draftYear, round: player.draftRound, pick: player.draftPick },
    latestTeam:
      player.latestTeam === null
        ? null
        : {
            id: player.latestTeam.id,
            abbreviation: player.latestTeam.abbreviation,
            fullName: player.latestTeam.fullName,
          },
    jerseyNumber: player.jerseyNumber,
    status: player.status,
    headshotUrl: player.headshotUrl,
  };
}

export function toPlayerGameStatDto(stat: PlayerStatWithContext) {
  return {
    id: stat.id,
    gameId: stat.gameId,
    season: stat.season,
    week: stat.week,
    seasonType: stat.seasonType,
    startTime: stat.game.startTime?.toISOString() ?? null,
    team: { id: stat.team.id, abbreviation: stat.team.abbreviation },
    opponent: { id: stat.opponentTeam.id, abbreviation: stat.opponentTeam.abbreviation },
    position: stat.position,
    positionGroup: stat.positionGroup,
    passing: {
      completions: stat.completions,
      attempts: stat.attempts,
      yards: stat.passingYards,
      touchdowns: stat.passingTouchdowns,
      interceptions: stat.passingInterceptions,
      sacksSuffered: stat.sacksSuffered,
      sackYardsLost: stat.sackYardsLost,
      airYards: stat.passingAirYards,
      yardsAfterCatch: stat.passingYardsAfterCatch,
      firstDowns: stat.passingFirstDowns,
      epa: stat.passingEpa,
      twoPointConversions: stat.passing2ptConversions,
    },
    rushing: {
      carries: stat.carries,
      yards: stat.rushingYards,
      touchdowns: stat.rushingTouchdowns,
      firstDowns: stat.rushingFirstDowns,
      epa: stat.rushingEpa,
      fumbles: stat.rushingFumbles,
      fumblesLost: stat.rushingFumblesLost,
      twoPointConversions: stat.rushing2ptConversions,
    },
    receiving: {
      targets: stat.targets,
      receptions: stat.receptions,
      yards: stat.receivingYards,
      touchdowns: stat.receivingTouchdowns,
      airYards: stat.receivingAirYards,
      yardsAfterCatch: stat.receivingYardsAfterCatch,
      firstDowns: stat.receivingFirstDowns,
      epa: stat.receivingEpa,
      targetShare: stat.targetShare,
      twoPointConversions: stat.receiving2ptConversions,
    },
    defense: {
      tacklesSolo: stat.tacklesSolo,
      tacklesWithAssist: stat.tacklesWithAssist,
      tackleAssists: stat.tackleAssists,
      tacklesForLoss: stat.tacklesForLoss,
      sacks: stat.defensiveSacks,
      sackYards: stat.defensiveSackYards,
      quarterbackHits: stat.quarterbackHits,
      interceptions: stat.defensiveInterceptions,
      interceptionYards: stat.interceptionYards,
      passesDefended: stat.passesDefended,
      forcedFumbles: stat.forcedFumbles,
      fumbleRecoveries: stat.fumbleRecoveries,
      touchdowns: stat.defensiveTouchdowns,
    },
    kicking: {
      fieldGoalsMade: stat.fieldGoalsMade,
      fieldGoalsAttempted: stat.fieldGoalsAttempted,
      extraPointsMade: stat.extraPointsMade,
      extraPointsAttempted: stat.extraPointsAttempted,
      punts: stat.punts,
      puntYards: stat.puntYards,
    },
    returns: {
      puntReturnYards: stat.puntReturnYards,
      puntReturnTouchdowns: stat.puntReturnTouchdowns,
      kickoffReturnYards: stat.kickoffReturnYards,
      specialTeamsTouchdowns: stat.specialTeamsTouchdowns,
    },
    fantasy: { standard: stat.fantasyPointsStandard, ppr: stat.fantasyPointsPpr },
  };
}

export function toPlayerSeasonStatDto(stat: PlayerSeasonStat) {
  return {
    id: stat.id,
    season: stat.season,
    summaryType: stat.summaryType,
    position: stat.position,
    positionGroup: stat.positionGroup,
    games: stat.games,
    teamCount: stat.teamCount,
    passing: {
      completions: stat.completions,
      attempts: stat.attempts,
      yards: stat.passingYards,
      touchdowns: stat.passingTouchdowns,
      interceptions: stat.passingInterceptions,
    },
    rushing: {
      carries: stat.carries,
      yards: stat.rushingYards,
      touchdowns: stat.rushingTouchdowns,
    },
    receiving: {
      targets: stat.targets,
      receptions: stat.receptions,
      yards: stat.receivingYards,
      touchdowns: stat.receivingTouchdowns,
    },
    defense: {
      tacklesSolo: stat.tacklesSolo,
      tackleAssists: stat.tackleAssists,
      sacks: stat.defensiveSacks,
      interceptions: stat.defensiveInterceptions,
      forcedFumbles: stat.forcedFumbles,
      touchdowns: stat.defensiveTouchdowns,
    },
    kicking: {
      fieldGoalsMade: stat.fieldGoalsMade,
      fieldGoalsAttempted: stat.fieldGoalsAttempted,
      extraPointsMade: stat.extraPointsMade,
      extraPointsAttempted: stat.extraPointsAttempted,
      punts: stat.punts,
      puntYards: stat.puntYards,
    },
    fantasy: { standard: stat.fantasyPointsStandard, ppr: stat.fantasyPointsPpr },
  };
}
