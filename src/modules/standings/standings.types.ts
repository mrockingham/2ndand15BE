import type { Conference, Division, SeasonType } from '../../generated/prisma/client.js';

export type StandingsView = 'division' | 'conference' | 'league';

export interface NormalizedStanding {
  readonly provider: string;
  readonly providerTeamId: string;
  readonly teamAbbreviation: string;
  readonly season: number;
  readonly seasonType: SeasonType;
  readonly conference: Conference;
  readonly providerOrder: number;
  readonly conferenceRank: number;
  readonly playoffSeed: number | null;
  readonly wins: number | null;
  readonly losses: number | null;
  readonly ties: number | null;
  readonly winPercentage: number | null;
  readonly homeWins: number | null;
  readonly homeLosses: number | null;
  readonly homeTies: number | null;
  readonly awayWins: number | null;
  readonly awayLosses: number | null;
  readonly awayTies: number | null;
  readonly divisionWins: number | null;
  readonly divisionLosses: number | null;
  readonly divisionTies: number | null;
  readonly conferenceWins: number | null;
  readonly conferenceLosses: number | null;
  readonly conferenceTies: number | null;
  readonly pointsFor: number | null;
  readonly pointsAgainst: number | null;
  readonly pointDifferential: number | null;
  readonly streakType: 'W' | 'L' | 'T' | null;
  readonly streakLength: number | null;
  readonly streakDisplay: string | null;
}

export interface StandingProvider {
  readonly providerKey: string;
  getStandings(query: {
    readonly season: number;
    readonly seasonType: SeasonType;
  }): Promise<readonly NormalizedStanding[]>;
}

export interface StandingTeamDto {
  readonly teamId: string;
  readonly name: string;
  readonly abbreviation: string;
  readonly conference: Conference;
  readonly division: Division;
  readonly season: number;
  readonly seasonType: SeasonType;
  readonly wins: number | null;
  readonly losses: number | null;
  readonly ties: number | null;
  readonly winPercentage: number | null;
  readonly homeWins: number | null;
  readonly homeLosses: number | null;
  readonly homeTies: number | null;
  readonly awayWins: number | null;
  readonly awayLosses: number | null;
  readonly awayTies: number | null;
  readonly divisionWins: number | null;
  readonly divisionLosses: number | null;
  readonly divisionTies: number | null;
  readonly conferenceWins: number | null;
  readonly conferenceLosses: number | null;
  readonly conferenceTies: number | null;
  readonly nonConferenceWins: null;
  readonly nonConferenceLosses: null;
  readonly nonConferenceTies: null;
  readonly pointsFor: number | null;
  readonly pointsAgainst: number | null;
  readonly pointDifferential: number | null;
  readonly streakType: string | null;
  readonly streakLength: number | null;
  readonly streakDisplay: string | null;
  readonly lastFiveWins: null;
  readonly lastFiveLosses: null;
  readonly lastFiveTies: null;
  readonly lastFiveDisplay: null;
  readonly conferenceRank: number | null;
  readonly playoffSeed: number | null;
  readonly divisionRank: number | null;
  readonly leagueRank: number | null;
  readonly clinchedCode: null;
  readonly eliminated: null;
}
