import type { PrismaClient } from '../../generated/prisma/client.js';
import type { SportsDataProvider } from './sports-data-provider.js';

export interface TeamSyncResult {
  readonly provider: string;
  readonly teamCount: number;
}

export async function syncTeams(
  provider: SportsDataProvider,
  prisma: PrismaClient,
): Promise<TeamSyncResult> {
  const teams = await provider.getTeams();
  const providerNames = new Set(teams.map((team) => team.provider));

  if (providerNames.size !== 1) {
    throw new Error('A team sync batch must contain exactly one provider.');
  }

  const providerName = teams[0]?.provider;
  if (providerName === undefined) {
    throw new Error('A team sync batch cannot be empty.');
  }

  await prisma.$transaction(async (transaction) => {
    for (const team of teams) {
      const persistedTeam = await transaction.team.upsert({
        where: {
          league_abbreviation: {
            league: team.league,
            abbreviation: team.abbreviation,
          },
        },
        create: {
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
        },
        update: {
          city: team.city,
          name: team.name,
          fullName: team.fullName,
          conference: team.conference,
          division: team.division,
          primaryColor: team.primaryColor,
          secondaryColor: team.secondaryColor,
          logoUrl: team.logoUrl,
          logoSource: team.logoSource,
          isActive: team.isActive,
        },
      });

      await transaction.teamProviderMapping.upsert({
        where: {
          provider_providerTeamId: {
            provider: team.provider,
            providerTeamId: team.providerTeamId,
          },
        },
        create: {
          teamId: persistedTeam.id,
          provider: team.provider,
          providerTeamId: team.providerTeamId,
        },
        update: {
          teamId: persistedTeam.id,
        },
      });
    }
  });

  return { provider: providerName, teamCount: teams.length };
}
