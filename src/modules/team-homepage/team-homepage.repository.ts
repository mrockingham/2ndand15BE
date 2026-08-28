import type { Prisma, PrismaClient } from '../../generated/prisma/client.js';
import type { AuditActor } from '../../common/audit/audit-actor.js';
import { sanitizeAuditSnapshot } from '../admin/audit-sanitizer.js';
import { articleInclude, type ArticleRecord } from '../articles/article.dto.js';
import type {
  TeamHomepageConfigRecord,
  TeamHomepageHighlightPlacementRecord,
  TeamHomepageHighlightSettingsRecord,
  TeamHomepageMediaSourceType,
  TeamHomepagePlacementRecord,
} from './team-homepage.dto.js';
import type { UpdateTeamBannerInput } from './team-homepage.schemas.js';

export interface TeamHomepageArticleCandidateRecord {
  readonly id: string;
  readonly title: string;
  readonly status: string;
  readonly publishedAt: Date | null;
  readonly updatedAt: Date;
}

export interface TeamHomepageMediaCandidateRecord {
  readonly sourceType: TeamHomepageMediaSourceType;
  readonly sourceId: string;
  readonly gameId: string;
  readonly title: string;
  readonly thumbnailUrl: string | null;
  readonly canonicalUrl: string | null;
  readonly embedUrl: string | null;
  readonly canEmbed: boolean;
  readonly publishedAt: Date | null;
}

export interface TeamHomepageGameContext {
  readonly id: string;
  readonly startTime: Date | null;
}

export interface TeamHomepageRepository {
  isActiveTeam(teamId: string): Promise<boolean>;
  getConfig(teamId: string): Promise<TeamHomepageConfigRecord | null>;
  updateConfig(
    teamId: string,
    input: UpdateTeamBannerInput,
    actor: AuditActor,
  ): Promise<TeamHomepageConfigRecord>;
  listEditorialPlacements(teamId: string): Promise<readonly TeamHomepagePlacementRecord[]>;
  createEditorialPlacement(
    input: Omit<TeamHomepagePlacementRecord, 'id' | 'position' | 'createdAt' | 'updatedAt'>,
    actor: AuditActor,
  ): Promise<TeamHomepagePlacementRecord>;
  updateEditorialLead(
    teamId: string,
    placementId: string,
    isLeadReplacement: boolean,
    actor: AuditActor,
  ): Promise<TeamHomepagePlacementRecord | null>;
  deleteEditorialPlacement(
    teamId: string,
    placementId: string,
    actor: AuditActor,
  ): Promise<TeamHomepagePlacementRecord | null>;
  reorderEditorialPlacements(
    teamId: string,
    placementIds: readonly string[],
    actor: AuditActor,
  ): Promise<readonly TeamHomepagePlacementRecord[]>;
  findArticleCandidate(
    teamId: string,
    articleId: string,
  ): Promise<TeamHomepageArticleCandidateRecord | null>;
  findPublicArticle(teamId: string, articleId: string, now: Date): Promise<ArticleRecord | null>;
  findMediaCandidate(
    teamId: string,
    sourceType: TeamHomepageMediaSourceType,
    sourceId: string,
  ): Promise<TeamHomepageMediaCandidateRecord | null>;
  listArticleCandidates(teamId: string): Promise<readonly TeamHomepageArticleCandidateRecord[]>;
  listMediaCandidates(teamId: string): Promise<readonly TeamHomepageMediaCandidateRecord[]>;
  listHighlightPlacements(teamId: string): Promise<readonly TeamHomepageHighlightPlacementRecord[]>;
  createHighlightPlacement(
    teamId: string,
    source: TeamHomepageMediaCandidateRecord,
    actor: AuditActor,
  ): Promise<TeamHomepageHighlightPlacementRecord>;
  deleteHighlightPlacement(
    teamId: string,
    placementId: string,
    actor: AuditActor,
  ): Promise<TeamHomepageHighlightPlacementRecord | null>;
  reorderHighlightPlacements(
    teamId: string,
    placementIds: readonly string[],
    actor: AuditActor,
  ): Promise<readonly TeamHomepageHighlightPlacementRecord[]>;
  getHighlightSettings(teamId: string): Promise<TeamHomepageHighlightSettingsRecord>;
  updateHighlightSettings(
    teamId: string,
    input: TeamHomepageHighlightSettingsRecord,
    actor: AuditActor,
  ): Promise<TeamHomepageHighlightSettingsRecord>;
  listRecentMediaGames(teamId: string, limit: number): Promise<readonly TeamHomepageGameContext[]>;
  findGamesByIds(gameIds: readonly string[]): Promise<readonly TeamHomepageGameContext[]>;
}

export class PrismaTeamHomepageRepository implements TeamHomepageRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async isActiveTeam(teamId: string): Promise<boolean> {
    return (
      (await this.prisma.team.count({ where: { id: teamId, league: 'NFL', isActive: true } })) === 1
    );
  }

  getConfig(teamId: string): Promise<TeamHomepageConfigRecord | null> {
    return this.prisma.teamHomepageConfig.findUnique({ where: { teamId }, select: configSelect });
  }

  updateConfig(
    teamId: string,
    input: UpdateTeamBannerInput,
    actor: AuditActor,
  ): Promise<TeamHomepageConfigRecord> {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.teamHomepageConfig.findUnique({
        where: { teamId },
        select: configSelect,
      });
      const after = await tx.teamHomepageConfig.upsert({
        where: { teamId },
        create: {
          teamId,
          bannerImageUrl: input.imageUrl ?? null,
          bannerFocalX: input.focalX ?? 50,
          bannerFocalY: input.focalY ?? 50,
          bannerOverlayOpacity: input.overlayOpacity ?? 35,
          updatedById: actor.userId,
          updatedBySnapshot: actor.emailSnapshot,
        },
        update: {
          ...(input.imageUrl === undefined ? {} : { bannerImageUrl: input.imageUrl }),
          ...(input.focalX === undefined ? {} : { bannerFocalX: input.focalX }),
          ...(input.focalY === undefined ? {} : { bannerFocalY: input.focalY }),
          ...(input.overlayOpacity === undefined
            ? {}
            : { bannerOverlayOpacity: input.overlayOpacity }),
          updatedById: actor.userId,
          updatedBySnapshot: actor.emailSnapshot,
        },
        select: configSelect,
      });
      await createAudit(
        tx,
        actor,
        input.imageUrl === null ? 'TEAM_HOMEPAGE_BANNER_CLEARED' : 'TEAM_HOMEPAGE_BANNER_UPDATED',
        'TEAM_HOMEPAGE_CONFIG',
        teamId,
        before,
        after,
      );
      return after;
    });
  }

  listEditorialPlacements(teamId: string): Promise<readonly TeamHomepagePlacementRecord[]> {
    return this.prisma.teamHomepageEditorialPlacement.findMany({
      where: { teamId },
      orderBy: [{ position: 'asc' }, { id: 'asc' }],
      select: editorialSelect,
    });
  }

  createEditorialPlacement(
    input: Omit<TeamHomepagePlacementRecord, 'id' | 'position' | 'createdAt' | 'updatedAt'>,
    actor: AuditActor,
  ): Promise<TeamHomepagePlacementRecord> {
    return this.prisma.$transaction(async (tx) => {
      if (input.isLeadReplacement) {
        await tx.teamHomepageEditorialPlacement.updateMany({
          where: { teamId: input.teamId, isLeadReplacement: true },
          data: {
            isLeadReplacement: false,
            updatedById: actor.userId,
            updatedBySnapshot: actor.emailSnapshot,
          },
        });
      }
      const position = await tx.teamHomepageEditorialPlacement.count({
        where: { teamId: input.teamId },
      });
      const row = await tx.teamHomepageEditorialPlacement.create({
        data: {
          ...input,
          position,
          createdById: actor.userId,
          updatedById: actor.userId,
          createdBySnapshot: actor.emailSnapshot,
          updatedBySnapshot: actor.emailSnapshot,
        },
        select: editorialSelect,
      });
      await createAudit(
        tx,
        actor,
        'TEAM_HOMEPAGE_EDITORIAL_ADDED',
        'TEAM_HOMEPAGE_EDITORIAL_PLACEMENT',
        row.id,
        null,
        row,
      );
      if (input.isLeadReplacement)
        await createAudit(
          tx,
          actor,
          'TEAM_HOMEPAGE_LEAD_REPLACEMENT_CHANGED',
          'TEAM',
          input.teamId,
          null,
          { placementId: row.id },
        );
      return row;
    });
  }

  updateEditorialLead(
    teamId: string,
    placementId: string,
    isLeadReplacement: boolean,
    actor: AuditActor,
  ): Promise<TeamHomepagePlacementRecord | null> {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.teamHomepageEditorialPlacement.findFirst({
        where: { id: placementId, teamId },
        select: editorialSelect,
      });
      if (before === null) return null;
      if (isLeadReplacement) {
        await tx.teamHomepageEditorialPlacement.updateMany({
          where: { teamId, isLeadReplacement: true, id: { not: placementId } },
          data: {
            isLeadReplacement: false,
            updatedById: actor.userId,
            updatedBySnapshot: actor.emailSnapshot,
          },
        });
      }
      const after = await tx.teamHomepageEditorialPlacement.update({
        where: { id: placementId },
        data: {
          isLeadReplacement,
          updatedById: actor.userId,
          updatedBySnapshot: actor.emailSnapshot,
        },
        select: editorialSelect,
      });
      await createAudit(
        tx,
        actor,
        'TEAM_HOMEPAGE_LEAD_REPLACEMENT_CHANGED',
        'TEAM_HOMEPAGE_EDITORIAL_PLACEMENT',
        placementId,
        before,
        after,
      );
      return after;
    });
  }

  deleteEditorialPlacement(
    teamId: string,
    placementId: string,
    actor: AuditActor,
  ): Promise<TeamHomepagePlacementRecord | null> {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.teamHomepageEditorialPlacement.findFirst({
        where: { id: placementId, teamId },
        select: editorialSelect,
      });
      if (before === null) return null;
      await tx.teamHomepageEditorialPlacement.delete({ where: { id: placementId } });
      await compactEditorial(tx, teamId, actor);
      await createAudit(
        tx,
        actor,
        'TEAM_HOMEPAGE_EDITORIAL_REMOVED',
        'TEAM_HOMEPAGE_EDITORIAL_PLACEMENT',
        placementId,
        before,
        null,
      );
      return before;
    });
  }

  reorderEditorialPlacements(
    teamId: string,
    placementIds: readonly string[],
    actor: AuditActor,
  ): Promise<readonly TeamHomepagePlacementRecord[]> {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.teamHomepageEditorialPlacement.findMany({
        where: { teamId },
        orderBy: { position: 'asc' },
        select: editorialSelect,
      });
      if (
        !sameIds(
          before.map(({ id }) => id),
          placementIds,
        )
      )
        return before;
      await reorderEditorial(tx, placementIds, actor);
      const after = await tx.teamHomepageEditorialPlacement.findMany({
        where: { teamId },
        orderBy: { position: 'asc' },
        select: editorialSelect,
      });
      await createAudit(
        tx,
        actor,
        'TEAM_HOMEPAGE_EDITORIAL_REORDERED',
        'TEAM',
        teamId,
        { placementIds: before.map(({ id }) => id) },
        { placementIds },
      );
      return after;
    });
  }

  findArticleCandidate(
    teamId: string,
    articleId: string,
  ): Promise<TeamHomepageArticleCandidateRecord | null> {
    return this.prisma.article.findFirst({
      where: { id: articleId, status: { not: 'ARCHIVED' }, teams: { some: { teamId } } },
      select: articleCandidateSelect,
    });
  }

  findPublicArticle(teamId: string, articleId: string, now: Date): Promise<ArticleRecord | null> {
    return this.prisma.article.findFirst({
      where: {
        id: articleId,
        teams: { some: { teamId } },
        OR: [
          { status: 'PUBLISHED', publishedAt: { lte: now } },
          { status: 'SCHEDULED', scheduledFor: { lte: now } },
        ],
      },
      include: articleInclude,
    });
  }

  async findMediaCandidate(
    teamId: string,
    sourceType: TeamHomepageMediaSourceType,
    sourceId: string,
  ): Promise<TeamHomepageMediaCandidateRecord | null> {
    const candidates = await this.listMediaCandidates(teamId);
    return (
      candidates.find((row) => row.sourceType === sourceType && row.sourceId === sourceId) ?? null
    );
  }

  listArticleCandidates(teamId: string): Promise<readonly TeamHomepageArticleCandidateRecord[]> {
    return this.prisma.article.findMany({
      where: { status: { not: 'ARCHIVED' }, teams: { some: { teamId } } },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: 200,
      select: articleCandidateSelect,
    });
  }

  async listMediaCandidates(teamId: string): Promise<readonly TeamHomepageMediaCandidateRecord[]> {
    const gameWhere = { OR: [{ homeTeamId: teamId }, { awayTeamId: teamId }] };
    const [highlights, curated] = await Promise.all([
      this.prisma.gameHighlight.findMany({
        where: { game: gameWhere },
        take: 200,
        orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
        select: {
          id: true,
          gameId: true,
          title: true,
          thumbnailUrl: true,
          canonicalUrl: true,
          embedUrl: true,
          canEmbed: true,
          publishedAt: true,
          game: { select: { startTime: true } },
        },
      }),
      this.prisma.gameCuratedVideo.findMany({
        where: { game: gameWhere },
        take: 200,
        orderBy: [{ game: { startTime: 'desc' } }, { position: 'asc' }, { id: 'desc' }],
        select: {
          id: true,
          gameId: true,
          title: true,
          thumbnailUrl: true,
          canonicalUrl: true,
          embedUrl: true,
          game: { select: { startTime: true } },
        },
      }),
    ]);
    return [
      ...highlights.map((row): TeamHomepageMediaCandidateRecord => ({
        sourceType: 'GAME_HIGHLIGHT',
        sourceId: row.id,
        gameId: row.gameId,
        title: row.title,
        thumbnailUrl: row.thumbnailUrl,
        canonicalUrl: row.canonicalUrl,
        embedUrl: row.canEmbed ? row.embedUrl : null,
        canEmbed: row.canEmbed,
        publishedAt: row.publishedAt ?? row.game.startTime,
      })),
      ...curated.map((row): TeamHomepageMediaCandidateRecord => ({
        sourceType: 'CURATED_GAME_VIDEO',
        sourceId: row.id,
        gameId: row.gameId,
        title: row.title,
        thumbnailUrl: row.thumbnailUrl,
        canonicalUrl: row.canonicalUrl,
        embedUrl: row.embedUrl,
        canEmbed: true,
        publishedAt: row.game.startTime,
      })),
    ].sort(
      (a, b) =>
        (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0) ||
        a.sourceType.localeCompare(b.sourceType) ||
        a.sourceId.localeCompare(b.sourceId),
    );
  }

  listHighlightPlacements(
    teamId: string,
  ): Promise<readonly TeamHomepageHighlightPlacementRecord[]> {
    return this.prisma.teamHomepageHighlightPlacement.findMany({
      where: { teamId },
      orderBy: [{ position: 'asc' }, { id: 'asc' }],
      select: highlightSelect,
    });
  }

  createHighlightPlacement(
    teamId: string,
    source: TeamHomepageMediaCandidateRecord,
    actor: AuditActor,
  ): Promise<TeamHomepageHighlightPlacementRecord> {
    return this.prisma.$transaction(async (tx) => {
      const position = await tx.teamHomepageHighlightPlacement.count({ where: { teamId } });
      const row = await tx.teamHomepageHighlightPlacement.create({
        data: {
          teamId,
          sourceType: source.sourceType,
          sourceId: source.sourceId,
          gameId: source.gameId,
          position,
          createdById: actor.userId,
          updatedById: actor.userId,
          createdBySnapshot: actor.emailSnapshot,
          updatedBySnapshot: actor.emailSnapshot,
        },
        select: highlightSelect,
      });
      await createAudit(
        tx,
        actor,
        'TEAM_HOMEPAGE_HIGHLIGHT_ADDED',
        'TEAM_HOMEPAGE_HIGHLIGHT_PLACEMENT',
        row.id,
        null,
        row,
      );
      return row;
    });
  }

  deleteHighlightPlacement(
    teamId: string,
    placementId: string,
    actor: AuditActor,
  ): Promise<TeamHomepageHighlightPlacementRecord | null> {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.teamHomepageHighlightPlacement.findFirst({
        where: { id: placementId, teamId },
        select: highlightSelect,
      });
      if (before === null) return null;
      await tx.teamHomepageHighlightPlacement.delete({ where: { id: placementId } });
      await compactHighlights(tx, teamId, actor);
      await createAudit(
        tx,
        actor,
        'TEAM_HOMEPAGE_HIGHLIGHT_REMOVED',
        'TEAM_HOMEPAGE_HIGHLIGHT_PLACEMENT',
        placementId,
        before,
        null,
      );
      return before;
    });
  }

  reorderHighlightPlacements(
    teamId: string,
    placementIds: readonly string[],
    actor: AuditActor,
  ): Promise<readonly TeamHomepageHighlightPlacementRecord[]> {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.teamHomepageHighlightPlacement.findMany({
        where: { teamId },
        orderBy: { position: 'asc' },
        select: highlightSelect,
      });
      if (
        !sameIds(
          before.map(({ id }) => id),
          placementIds,
        )
      )
        return before;
      for (const [index, id] of placementIds.entries())
        await tx.teamHomepageHighlightPlacement.update({
          where: { id },
          data: { position: 100 + index },
        });
      for (const [index, id] of placementIds.entries())
        await tx.teamHomepageHighlightPlacement.update({
          where: { id },
          data: {
            position: index,
            updatedById: actor.userId,
            updatedBySnapshot: actor.emailSnapshot,
          },
        });
      const after = await tx.teamHomepageHighlightPlacement.findMany({
        where: { teamId },
        orderBy: { position: 'asc' },
        select: highlightSelect,
      });
      await createAudit(
        tx,
        actor,
        'TEAM_HOMEPAGE_HIGHLIGHTS_REORDERED',
        'TEAM',
        teamId,
        { placementIds: before.map(({ id }) => id) },
        { placementIds },
      );
      return after;
    });
  }

  async getHighlightSettings(teamId: string): Promise<TeamHomepageHighlightSettingsRecord> {
    return (
      (await this.prisma.teamHomepageHighlightSettings.findUnique({
        where: { teamId },
        select: settingsSelect,
      })) ?? { displayLimit: 5, fillWithAutomatic: true }
    );
  }

  updateHighlightSettings(
    teamId: string,
    input: TeamHomepageHighlightSettingsRecord,
    actor: AuditActor,
  ): Promise<TeamHomepageHighlightSettingsRecord> {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.teamHomepageHighlightSettings.findUnique({
        where: { teamId },
        select: settingsSelect,
      });
      const after = await tx.teamHomepageHighlightSettings.upsert({
        where: { teamId },
        create: {
          teamId,
          ...input,
          updatedById: actor.userId,
          updatedBySnapshot: actor.emailSnapshot,
        },
        update: { ...input, updatedById: actor.userId, updatedBySnapshot: actor.emailSnapshot },
        select: settingsSelect,
      });
      await createAudit(
        tx,
        actor,
        'TEAM_HOMEPAGE_HIGHLIGHT_SETTINGS_UPDATED',
        'TEAM_HOMEPAGE_HIGHLIGHT_SETTINGS',
        teamId,
        before ?? { displayLimit: 5, fillWithAutomatic: true },
        after,
      );
      return after;
    });
  }

  listRecentMediaGames(teamId: string, limit: number): Promise<readonly TeamHomepageGameContext[]> {
    return this.prisma.game.findMany({
      where: {
        status: 'FINAL',
        OR: [{ homeTeamId: teamId }, { awayTeamId: teamId }],
        AND: [{ OR: [{ highlights: { some: {} } }, { curatedVideos: { some: {} } }] }],
      },
      orderBy: [{ startTime: 'desc' }, { id: 'desc' }],
      take: limit,
      select: gameSelect,
    });
  }

  findGamesByIds(gameIds: readonly string[]): Promise<readonly TeamHomepageGameContext[]> {
    if (gameIds.length === 0) return Promise.resolve([]);
    return this.prisma.game.findMany({
      where: { id: { in: [...new Set(gameIds)] } },
      select: gameSelect,
    });
  }
}

const configSelect = {
  bannerImageUrl: true,
  bannerFocalX: true,
  bannerFocalY: true,
  bannerOverlayOpacity: true,
} as const;
const editorialSelect = {
  id: true,
  teamId: true,
  sourceType: true,
  sourceId: true,
  mediaSourceType: true,
  gameId: true,
  position: true,
  isLeadReplacement: true,
  createdAt: true,
  updatedAt: true,
} as const;
const highlightSelect = {
  id: true,
  teamId: true,
  sourceType: true,
  sourceId: true,
  gameId: true,
  position: true,
  createdAt: true,
  updatedAt: true,
} as const;
const settingsSelect = { displayLimit: true, fillWithAutomatic: true } as const;
const gameSelect = { id: true, startTime: true } as const;
const articleCandidateSelect = {
  id: true,
  title: true,
  status: true,
  publishedAt: true,
  updatedAt: true,
} as const;

function sameIds(current: readonly string[], supplied: readonly string[]): boolean {
  return (
    current.length === supplied.length &&
    new Set(supplied).size === supplied.length &&
    current.every((id) => supplied.includes(id))
  );
}

async function reorderEditorial(
  tx: Prisma.TransactionClient,
  ids: readonly string[],
  actor: AuditActor,
): Promise<void> {
  for (const [index, id] of ids.entries())
    await tx.teamHomepageEditorialPlacement.update({
      where: { id },
      data: { position: 100 + index },
    });
  for (const [index, id] of ids.entries())
    await tx.teamHomepageEditorialPlacement.update({
      where: { id },
      data: { position: index, updatedById: actor.userId, updatedBySnapshot: actor.emailSnapshot },
    });
}

async function compactEditorial(
  tx: Prisma.TransactionClient,
  teamId: string,
  actor: AuditActor,
): Promise<void> {
  const rows = await tx.teamHomepageEditorialPlacement.findMany({
    where: { teamId },
    orderBy: { position: 'asc' },
    select: { id: true },
  });
  await reorderEditorial(
    tx,
    rows.map(({ id }) => id),
    actor,
  );
}

async function compactHighlights(
  tx: Prisma.TransactionClient,
  teamId: string,
  actor: AuditActor,
): Promise<void> {
  const rows = await tx.teamHomepageHighlightPlacement.findMany({
    where: { teamId },
    orderBy: { position: 'asc' },
    select: { id: true },
  });
  for (const [index, row] of rows.entries())
    await tx.teamHomepageHighlightPlacement.update({
      where: { id: row.id },
      data: { position: 100 + index },
    });
  for (const [index, row] of rows.entries())
    await tx.teamHomepageHighlightPlacement.update({
      where: { id: row.id },
      data: { position: index, updatedById: actor.userId, updatedBySnapshot: actor.emailSnapshot },
    });
}

async function createAudit(
  tx: Prisma.TransactionClient,
  actor: AuditActor,
  action: string,
  entityType: string,
  entityId: string | null,
  before: unknown,
  after: unknown,
): Promise<void> {
  await tx.adminAuditEvent.create({
    data: {
      actorUserId: actor.userId,
      actorEmailSnapshot: actor.emailSnapshot,
      action,
      entityType,
      entityId,
      ...(before === null ? {} : { beforeSnapshot: sanitizeAuditSnapshot(before) }),
      ...(after === null ? {} : { afterSnapshot: sanitizeAuditSnapshot(after) }),
      requestId: actor.requestId,
    },
  });
}
