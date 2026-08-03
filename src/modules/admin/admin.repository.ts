import type {
  GameSourceType,
  GameStatus,
  Prisma,
  PrismaClient,
  SeasonType,
  UserRole,
} from '../../generated/prisma/client.js';
import type {
  AdministrativeIdentityReader,
  AdministrativePrincipal,
} from './admin-authorization.js';
import { adminGameInclude, type AdminGameRecord, type AuditEventRecord } from './admin.dto.js';
import { sanitizeAuditSnapshot } from './audit-sanitizer.js';
import type {
  AdminGameListQuery,
  AuditListQuery,
  GameOverrideInput,
  ManualGameCreateInput,
  ManualGameUpdateInput,
  VerificationInput,
} from './admin.schemas.js';

export interface AuditActor {
  readonly userId: string | null;
  readonly emailSnapshot: string;
  readonly requestId: string | null;
}

export interface ImportGameWrite {
  readonly season: number;
  readonly seasonType: SeasonType;
  readonly week: number | null;
  readonly startTime: Date | null;
  readonly status: GameStatus;
  readonly homeTeamId: string;
  readonly awayTeamId: string;
  readonly venueName: string | null;
  readonly venueCity: string | null;
  readonly broadcastNetwork: string | null;
  readonly isNeutralSite: boolean;
  readonly sourceName: string;
  readonly sourceType: Extract<
    GameSourceType,
    'MANUAL_IMPORT' | 'OFFICIAL_WEB' | 'DEVELOPMENT_FIXTURE'
  >;
  readonly sourceUrl: string | null;
  readonly externalReference: string | null;
  readonly notes: string | null;
}

export interface AdminGamePage {
  readonly games: readonly AdminGameRecord[];
  readonly nextCursor: string | null;
}

export interface AuditPage {
  readonly events: readonly AuditEventRecord[];
  readonly nextCursor: string | null;
}

export interface AdminRepository extends AdministrativeIdentityReader {
  listGames(query: AdminGameListQuery): Promise<AdminGamePage>;
  findGame(gameId: string): Promise<AdminGameRecord | null>;
  findActiveTeams(
    teamIds: readonly string[],
  ): Promise<readonly { id: string; abbreviation: string }[]>;
  listActiveTeamAbbreviations(): Promise<readonly { id: string; abbreviation: string }[]>;
  findGameBySourceReference(sourceName: string, reference: string): Promise<AdminGameRecord | null>;
  findLikelyGame(input: ImportGameWrite): Promise<AdminGameRecord | null>;
  createManualGame(
    input: ManualGameCreateInput,
    actor: AuditActor,
    now: Date,
  ): Promise<AdminGameRecord>;
  updateManualGame(
    gameId: string,
    input: ManualGameUpdateInput,
    actor: AuditActor,
  ): Promise<AdminGameRecord>;
  upsertOverride(
    gameId: string,
    input: GameOverrideInput,
    actor: AuditActor,
  ): Promise<AdminGameRecord>;
  deleteOverride(gameId: string, actor: AuditActor): Promise<AdminGameRecord>;
  verifyGame(
    gameId: string,
    input: VerificationInput,
    actor: AuditActor,
    now: Date,
  ): Promise<AdminGameRecord>;
  createImportedGame(
    input: ImportGameWrite,
    actor: AuditActor,
    now: Date,
  ): Promise<AdminGameRecord>;
  updateImportedGame(
    gameId: string,
    input: ImportGameWrite,
    actor: AuditActor,
  ): Promise<AdminGameRecord>;
  createImportAudit(actor: AuditActor, summary: unknown): Promise<void>;
  listAuditEvents(query: AuditListQuery): Promise<AuditPage>;
  setUserRole(
    normalizedEmail: string,
    role: UserRole,
    actor: AuditActor,
  ): Promise<{ id: string; email: string; previousRole: UserRole; role: UserRole } | null>;
}

export class PrismaAdminRepository implements AdminRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findAdministrativeIdentity(userId: string): Promise<AdministrativePrincipal | null> {
    return this.prisma.user
      .findFirst({
        where: { id: userId, isActive: true },
        select: { id: true, email: true, role: true },
      })
      .then((user) =>
        user === null ? null : { userId: user.id, email: user.email, role: user.role },
      );
  }

  async listGames(query: AdminGameListQuery): Promise<AdminGamePage> {
    const games = await this.prisma.game.findMany({
      where: { league: 'NFL', ...(query.season === undefined ? {} : { season: query.season }) },
      include: adminGameInclude,
      orderBy: [{ startTime: 'asc' }, { id: 'asc' }],
      take: query.limit + 1,
      ...(query.cursor === undefined ? {} : { cursor: { id: query.cursor }, skip: 1 }),
    });
    const hasMore = games.length > query.limit;
    const page = hasMore ? games.slice(0, query.limit) : games;
    return { games: page, nextCursor: hasMore ? (page.at(-1)?.id ?? null) : null };
  }

  findGame(gameId: string): Promise<AdminGameRecord | null> {
    return this.prisma.game.findUnique({ where: { id: gameId }, include: adminGameInclude });
  }

  findActiveTeams(teamIds: readonly string[]) {
    return this.prisma.team.findMany({
      where: { id: { in: [...teamIds] }, league: 'NFL', isActive: true },
      select: { id: true, abbreviation: true },
    });
  }

  listActiveTeamAbbreviations() {
    return this.prisma.team.findMany({
      where: { league: 'NFL', isActive: true },
      select: { id: true, abbreviation: true },
    });
  }

  findGameBySourceReference(
    sourceName: string,
    reference: string,
  ): Promise<AdminGameRecord | null> {
    return this.prisma.game.findFirst({
      where: { provenance: { is: { sourceName, externalReference: reference } } },
      include: adminGameInclude,
    });
  }

  findLikelyGame(input: ImportGameWrite): Promise<AdminGameRecord | null> {
    const tolerance = 6 * 60 * 60 * 1_000;
    return this.prisma.game.findFirst({
      where: {
        league: 'NFL',
        season: input.season,
        seasonType: input.seasonType,
        homeTeamId: input.homeTeamId,
        awayTeamId: input.awayTeamId,
        ...(input.startTime === null
          ? { week: input.week, startTime: null }
          : {
              startTime: {
                gte: new Date(input.startTime.getTime() - tolerance),
                lte: new Date(input.startTime.getTime() + tolerance),
              },
            }),
      },
      include: adminGameInclude,
      orderBy: { startTime: 'asc' },
    });
  }

  createManualGame(
    input: ManualGameCreateInput,
    actor: AuditActor,
    now: Date,
  ): Promise<AdminGameRecord> {
    return this.prisma.$transaction(async (transaction) => {
      const game = await transaction.game.create({
        data: {
          league: 'NFL',
          season: input.season,
          seasonType: input.seasonType,
          week: input.week,
          startTime: new Date(input.startTime),
          status: input.status,
          homeTeamId: input.homeTeamId,
          awayTeamId: input.awayTeamId,
          homeScore: null,
          awayScore: null,
          quarter: null,
          clock: null,
          venueName: input.venueName,
          venueCity: input.venueCity,
          broadcastNetwork: input.broadcastNetwork,
          isNeutralSite: input.isNeutralSite,
          provenance: {
            create: {
              sourceType: 'MANUAL_ENTRY',
              sourceName: input.provenance.sourceName,
              sourceUrl: input.provenance.sourceUrl ?? null,
              externalReference: input.provenance.externalReference ?? null,
              notes: input.provenance.notes ?? null,
              importedAt: now,
            },
          },
        },
        include: adminGameInclude,
      });
      await createAudit(transaction, actor, 'MANUAL_GAME_CREATED', 'GAME', game.id, null, game);
      return game;
    });
  }

  updateManualGame(
    gameId: string,
    input: ManualGameUpdateInput,
    actor: AuditActor,
  ): Promise<AdminGameRecord> {
    return this.prisma.$transaction(async (transaction) => {
      const before = await transaction.game.findUniqueOrThrow({
        where: { id: gameId },
        include: adminGameInclude,
      });
      const after = await transaction.game.update({
        where: { id: gameId },
        data: toBaseUpdate(input),
        include: adminGameInclude,
      });
      await transaction.gameProvenance.updateMany({
        where: { gameId },
        data: { verifiedAt: null, verifiedById: null },
      });
      await createAudit(transaction, actor, 'MANUAL_GAME_UPDATED', 'GAME', gameId, before, after);
      return after;
    });
  }

  upsertOverride(
    gameId: string,
    input: GameOverrideInput,
    actor: AuditActor,
  ): Promise<AdminGameRecord> {
    return this.prisma.$transaction(async (transaction) => {
      const before = await transaction.game.findUniqueOrThrow({
        where: { id: gameId },
        include: adminGameInclude,
      });
      const data = toOverrideUpdate(input);
      await transaction.gameEditorialOverride.upsert({
        where: { gameId },
        create: {
          gameId,
          ...data,
          createdById: actor.userId,
          updatedById: actor.userId,
          createdBySnapshot: actor.emailSnapshot,
          updatedBySnapshot: actor.emailSnapshot,
        },
        update: {
          ...data,
          updatedById: actor.userId,
          updatedBySnapshot: actor.emailSnapshot,
        },
      });
      await transaction.gameProvenance.updateMany({
        where: { gameId },
        data: { verifiedAt: null, verifiedById: null },
      });
      const after = await transaction.game.findUniqueOrThrow({
        where: { id: gameId },
        include: adminGameInclude,
      });
      await createAudit(
        transaction,
        actor,
        before.editorialOverride === null ? 'GAME_OVERRIDE_CREATED' : 'GAME_OVERRIDE_UPDATED',
        'GAME',
        gameId,
        before,
        after,
      );
      return after;
    });
  }

  deleteOverride(gameId: string, actor: AuditActor): Promise<AdminGameRecord> {
    return this.prisma.$transaction(async (transaction) => {
      const before = await transaction.game.findUniqueOrThrow({
        where: { id: gameId },
        include: adminGameInclude,
      });
      await transaction.gameEditorialOverride.delete({ where: { gameId } });
      const after = await transaction.game.findUniqueOrThrow({
        where: { id: gameId },
        include: adminGameInclude,
      });
      await createAudit(transaction, actor, 'GAME_OVERRIDE_DELETED', 'GAME', gameId, before, after);
      return after;
    });
  }

  verifyGame(
    gameId: string,
    input: VerificationInput,
    actor: AuditActor,
    now: Date,
  ): Promise<AdminGameRecord> {
    return this.prisma.$transaction(async (transaction) => {
      const before = await transaction.game.findUniqueOrThrow({
        where: { id: gameId },
        include: adminGameInclude,
      });
      await transaction.gameProvenance.upsert({
        where: { gameId },
        create: {
          gameId,
          sourceType: 'OFFICIAL_WEB',
          sourceName: input.sourceName,
          sourceUrl: input.sourceUrl ?? null,
          notes: input.note ?? null,
          importedAt: now,
          verifiedAt: now,
          verifiedById: actor.userId,
        },
        update: {
          sourceName: input.sourceName,
          sourceUrl: input.sourceUrl ?? null,
          notes: input.note ?? null,
          verifiedAt: now,
          verifiedById: actor.userId,
        },
      });
      const after = await transaction.game.findUniqueOrThrow({
        where: { id: gameId },
        include: adminGameInclude,
      });
      await createAudit(transaction, actor, 'GAME_VERIFIED', 'GAME', gameId, before, after);
      return after;
    });
  }

  createImportedGame(input: ImportGameWrite, actor: AuditActor, now: Date) {
    return this.prisma.$transaction(async (transaction) => {
      const game = await transaction.game.create({
        data: {
          league: 'NFL',
          ...toImportedBaseData(input),
          homeScore: null,
          awayScore: null,
          quarter: null,
          clock: null,
          provenance: {
            create: {
              sourceType: input.sourceType,
              sourceName: input.sourceName,
              sourceUrl: input.sourceUrl,
              externalReference: input.externalReference,
              notes: input.notes,
              importedAt: now,
            },
          },
        },
        include: adminGameInclude,
      });
      await createAudit(transaction, actor, 'IMPORTED_GAME_CREATED', 'GAME', game.id, null, game);
      return game;
    });
  }

  updateImportedGame(gameId: string, input: ImportGameWrite, actor: AuditActor) {
    return this.prisma.$transaction(async (transaction) => {
      const before = await transaction.game.findUniqueOrThrow({
        where: { id: gameId },
        include: adminGameInclude,
      });
      let action: string;
      if (before.providerMaps.length > 0) {
        await transaction.gameEditorialOverride.upsert({
          where: { gameId },
          create: {
            gameId,
            ...toImportOverride(input, before),
            createdById: actor.userId,
            updatedById: actor.userId,
            createdBySnapshot: actor.emailSnapshot,
            updatedBySnapshot: actor.emailSnapshot,
          },
          update: {
            ...toImportOverride(input, before),
            updatedById: actor.userId,
            updatedBySnapshot: actor.emailSnapshot,
          },
        });
        action = 'IMPORTED_PROVIDER_GAME_OVERRIDDEN';
      } else {
        await transaction.game.update({ where: { id: gameId }, data: toImportedBaseData(input) });
        await transaction.gameProvenance.upsert({
          where: { gameId },
          create: {
            gameId,
            sourceType: input.sourceType,
            sourceName: input.sourceName,
            sourceUrl: input.sourceUrl,
            externalReference: input.externalReference,
            notes: input.notes,
          },
          update: {
            sourceType: input.sourceType,
            sourceName: input.sourceName,
            sourceUrl: input.sourceUrl,
            externalReference: input.externalReference,
            notes: input.notes,
            verifiedAt: null,
            verifiedById: null,
          },
        });
        action = 'IMPORTED_GAME_UPDATED';
      }
      const after = await transaction.game.findUniqueOrThrow({
        where: { id: gameId },
        include: adminGameInclude,
      });
      await createAudit(transaction, actor, action, 'GAME', gameId, before, after);
      return after;
    });
  }

  async createImportAudit(actor: AuditActor, summary: unknown): Promise<void> {
    await createAudit(
      this.prisma,
      actor,
      'SCHEDULE_IMPORT_COMPLETED',
      'SCHEDULE_IMPORT',
      null,
      null,
      summary,
    );
  }

  async listAuditEvents(query: AuditListQuery): Promise<AuditPage> {
    const events = await this.prisma.adminAuditEvent.findMany({
      where: {
        ...(query.action === undefined ? {} : { action: query.action }),
        ...(query.entityType === undefined ? {} : { entityType: query.entityType }),
        ...(query.entityId === undefined ? {} : { entityId: query.entityId }),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      ...(query.cursor === undefined ? {} : { cursor: { id: query.cursor }, skip: 1 }),
    });
    const hasMore = events.length > query.limit;
    const page = hasMore ? events.slice(0, query.limit) : events;
    return { events: page, nextCursor: hasMore ? (page.at(-1)?.id ?? null) : null };
  }

  setUserRole(normalizedEmail: string, role: UserRole, actor: AuditActor) {
    return this.prisma.$transaction(async (transaction) => {
      const user = await transaction.user.findUnique({ where: { normalizedEmail } });
      if (user === null) return null;
      const previousRole = user.role;
      if (previousRole !== role) {
        await transaction.user.update({ where: { id: user.id }, data: { role } });
        await createAudit(
          transaction,
          actor,
          'USER_ROLE_CHANGED',
          'USER',
          user.id,
          { role: previousRole },
          { role },
        );
      }
      return { id: user.id, email: user.email, previousRole, role };
    });
  }
}

function toBaseUpdate(input: ManualGameUpdateInput): Prisma.GameUpdateInput {
  return {
    ...(input.season === undefined ? {} : { season: input.season }),
    ...(input.seasonType === undefined ? {} : { seasonType: input.seasonType }),
    ...(input.week === undefined ? {} : { week: input.week }),
    ...(input.startTime === undefined ? {} : { startTime: new Date(input.startTime) }),
    ...(input.status === undefined ? {} : { status: input.status }),
    ...(input.homeTeamId === undefined ? {} : { homeTeam: { connect: { id: input.homeTeamId } } }),
    ...(input.awayTeamId === undefined ? {} : { awayTeam: { connect: { id: input.awayTeamId } } }),
    ...(input.venueName === undefined ? {} : { venueName: input.venueName }),
    ...(input.venueCity === undefined ? {} : { venueCity: input.venueCity }),
    ...(input.broadcastNetwork === undefined ? {} : { broadcastNetwork: input.broadcastNetwork }),
    ...(input.isNeutralSite === undefined ? {} : { isNeutralSite: input.isNeutralSite }),
  };
}

interface OverrideWriteData {
  readonly startTime?: Date | null;
  readonly status?: GameStatus | null;
  readonly week?: number | null;
  readonly venueName?: string | null;
  readonly venueCity?: string | null;
  readonly broadcastNetwork?: string | null;
  readonly isNeutralSite?: boolean | null;
  readonly publicCorrectionNote?: string | null;
  readonly internalNote?: string | null;
}

function toOverrideUpdate(input: GameOverrideInput): OverrideWriteData {
  return {
    ...(input.startTime === undefined
      ? {}
      : { startTime: input.startTime === null ? null : new Date(input.startTime) }),
    ...(input.status === undefined ? {} : { status: input.status }),
    ...(input.week === undefined ? {} : { week: input.week }),
    ...(input.venueName === undefined ? {} : { venueName: input.venueName }),
    ...(input.venueCity === undefined ? {} : { venueCity: input.venueCity }),
    ...(input.broadcastNetwork === undefined ? {} : { broadcastNetwork: input.broadcastNetwork }),
    ...(input.isNeutralSite === undefined ? {} : { isNeutralSite: input.isNeutralSite }),
    ...(input.publicCorrectionNote === undefined
      ? {}
      : { publicCorrectionNote: input.publicCorrectionNote }),
    ...(input.internalNote === undefined ? {} : { internalNote: input.internalNote }),
  };
}

function toImportedBaseData(input: ImportGameWrite) {
  return {
    season: input.season,
    seasonType: input.seasonType,
    week: input.week,
    startTime: input.startTime,
    status: input.status,
    homeTeamId: input.homeTeamId,
    awayTeamId: input.awayTeamId,
    venueName: input.venueName,
    venueCity: input.venueCity,
    broadcastNetwork: input.broadcastNetwork,
    isNeutralSite: input.isNeutralSite,
  };
}

function toImportOverride(input: ImportGameWrite, game: AdminGameRecord) {
  return {
    startTime: sameDate(input.startTime, game.startTime) ? null : input.startTime,
    status: input.status === game.status ? null : input.status,
    week: input.week === game.week ? null : input.week,
    venueName: input.venueName === game.venueName ? null : input.venueName,
    venueCity: input.venueCity === game.venueCity ? null : input.venueCity,
    broadcastNetwork:
      input.broadcastNetwork === game.broadcastNetwork ? null : input.broadcastNetwork,
    isNeutralSite: input.isNeutralSite === game.isNeutralSite ? null : input.isNeutralSite,
    internalNote: input.notes,
  };
}

function sameDate(left: Date | null, right: Date | null): boolean {
  return left === null || right === null ? left === right : left.getTime() === right.getTime();
}

async function createAudit(
  transaction: Pick<PrismaClient, 'adminAuditEvent'> | Prisma.TransactionClient,
  actor: AuditActor,
  action: string,
  entityType: string,
  entityId: string | null,
  before: unknown,
  after: unknown,
): Promise<void> {
  await transaction.adminAuditEvent.create({
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

export function sourceIsManuallyOwned(sourceType: GameSourceType | undefined): boolean {
  return (
    sourceType === 'MANUAL_ENTRY' || sourceType === 'MANUAL_IMPORT' || sourceType === 'OFFICIAL_WEB'
  );
}
