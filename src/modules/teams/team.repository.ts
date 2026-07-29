import type { PrismaClient, Team } from '../../generated/prisma/client.js';

export interface TeamRepository {
  findActiveTeams(): Promise<readonly Team[]>;
  findActiveTeamById(teamId: string): Promise<Team | null>;
}

export class PrismaTeamRepository implements TeamRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findActiveTeams(): Promise<readonly Team[]> {
    return this.prisma.team.findMany({
      where: {
        league: 'NFL',
        isActive: true,
      },
      orderBy: [{ conference: 'asc' }, { division: 'asc' }, { fullName: 'asc' }],
    });
  }

  async findActiveTeamById(teamId: string): Promise<Team | null> {
    return this.prisma.team.findFirst({
      where: {
        id: teamId,
        league: 'NFL',
        isActive: true,
      },
    });
  }
}
