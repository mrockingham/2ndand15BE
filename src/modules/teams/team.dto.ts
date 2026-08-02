import type { Team } from '../../generated/prisma/client.js';

export interface TeamDto {
  readonly id: string;
  readonly league: 'NFL';
  readonly city: string;
  readonly name: string;
  readonly fullName: string;
  readonly abbreviation: string;
  readonly conference: 'AFC' | 'NFC';
  readonly division: 'East' | 'North' | 'South' | 'West';
  readonly primaryColor: string;
  readonly secondaryColor: string;
  readonly logoUrl: string | null;
  readonly logoSource: string | null;
  readonly isActive: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export function toTeamDto(team: Team): TeamDto {
  return {
    id: team.id,
    league: team.league,
    city: team.city,
    name: team.name,
    fullName: team.fullName,
    abbreviation: team.abbreviation,
    conference: team.conference,
    division: team.division,
    primaryColor: team.primaryColor,
    secondaryColor: team.secondaryColor,
    logoUrl: team.logoUrl,
    logoSource: team.logoSource,
    isActive: team.isActive,
    createdAt: team.createdAt.toISOString(),
    updatedAt: team.updatedAt.toISOString(),
  };
}
