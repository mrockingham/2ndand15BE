import type { PrismaClient } from '../../generated/prisma/client.js';
import type {
  DiscoverySource,
  DiscoveryTeam,
  LaunchDiscoveryRepository,
} from './launch-discovery.service.js';

export class PrismaLaunchDiscoveryRepository implements LaunchDiscoveryRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async listActiveSources(): Promise<readonly DiscoverySource[]> {
    const rows = await this.prisma.newsSource.findMany({
      where: { status: 'ACTIVE', kind: { in: ['RSS', 'ATOM'] }, feedUrl: { not: null } },
      orderBy: [
        { reliabilityWeight: 'desc' },
        { editorialUsefulnessWeight: 'desc' },
        { id: 'asc' },
      ],
      take: 5,
      select: { id: true, name: true, kind: true },
    });
    return rows.flatMap((row) =>
      row.kind === 'RSS' || row.kind === 'ATOM' ? [{ ...row, kind: row.kind }] : [],
    );
  }

  async listTeamsByGap(target: number): Promise<readonly DiscoveryTeam[]> {
    const teams = await this.prisma.team.findMany({
      where: { league: 'NFL', isActive: true },
      orderBy: { abbreviation: 'asc' },
      select: { id: true, abbreviation: true },
    });
    const results: DiscoveryTeam[] = [];
    for (const team of teams) {
      const [articles, candidates] = await Promise.all([
        this.prisma.articleTeam.count({
          where: {
            teamId: team.id,
            article: { status: { in: ['DRAFT', 'PUBLISHED', 'SCHEDULED'] } },
          },
        }),
        this.prisma.newsCandidateTeam.count({
          where: {
            teamId: team.id,
            candidate: {
              qualityEvaluation: {
                is: {
                  decision: {
                    in: [
                      'NFL_RELEVANT_FULL_DRAFT',
                      'NFL_RELEVANT_SHORT_BRIEF',
                      'NFL_RELEVANT_LINK_ONLY',
                    ],
                  },
                },
              },
            },
          },
        }),
      ]);
      results.push({
        id: team.id,
        abbreviation: team.abbreviation,
        opportunityCount: articles + candidates,
      });
    }
    return results.sort(
      (left, right) =>
        Math.max(0, target - right.opportunityCount) -
          Math.max(0, target - left.opportunityCount) ||
        left.abbreviation.localeCompare(right.abbreviation),
    );
  }

  async listCandidateIds(
    teamIds: readonly string[],
    since: Date,
    discoveredSince: Date,
    limit: number,
  ): Promise<readonly string[]> {
    const rows = await this.prisma.newsCandidate.findMany({
      where: {
        status: { in: ['NEW', 'REVIEWING', 'SAVED'] },
        sourcePublishedAt: { gte: since },
        OR: [
          { discoveredAt: { gte: discoveredSince } },
          ...(teamIds.length === 0
            ? []
            : [{ suggestedTeams: { some: { teamId: { in: [...teamIds] } } } }]),
        ],
      },
      orderBy: [{ sourcePublishedAt: 'desc' }, { id: 'asc' }],
      take: limit,
      select: { id: true },
    });
    return rows.map(({ id }) => id);
  }

  async sourceDiversity(candidateIds: readonly string[]): Promise<number> {
    if (candidateIds.length === 0) return 0;
    const rows = await this.prisma.newsCandidate.findMany({
      where: { id: { in: [...candidateIds] }, sourceId: { not: null } },
      distinct: ['sourceId'],
      select: { sourceId: true },
    });
    return rows.length;
  }
}
