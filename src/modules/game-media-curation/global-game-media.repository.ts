import type { AuditActor } from '../../common/audit/audit-actor.js';
import { sanitizeAuditSnapshot } from '../admin/audit-sanitizer.js';
import type { Prisma, PrismaClient } from '../../generated/prisma/client.js';

export interface GlobalGameCenterVideoRecord {
  readonly id: string;
  readonly title: string;
  readonly embedUrl: string;
  readonly canonicalUrl: string | null;
  readonly thumbnailUrl: string | null;
  readonly sourceLabel: string | null;
  readonly isActive: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface GlobalGameCenterVideoWriteInput {
  readonly title: string;
  readonly embedUrl: string;
  readonly canonicalUrl: string | null;
  readonly thumbnailUrl: string | null;
  readonly sourceLabel: string | null;
}

export interface GlobalGameMediaRepository {
  findActive(): Promise<GlobalGameCenterVideoRecord | null>;
  /** Creates the one global video if none exists, otherwise updates the
   * existing row in place -- the table is designed to hold at most one row,
   * so this is never an insert-a-second-row operation. */
  upsert(
    input: GlobalGameCenterVideoWriteInput,
    actor: AuditActor,
  ): Promise<GlobalGameCenterVideoRecord>;
  /** Returns the removed record, or `null` if none existed. */
  remove(actor: AuditActor): Promise<GlobalGameCenterVideoRecord | null>;
}

export class PrismaGlobalGameMediaRepository implements GlobalGameMediaRepository {
  constructor(private readonly prisma: PrismaClient) {}

  findActive(): Promise<GlobalGameCenterVideoRecord | null> {
    return this.prisma.globalGameCenterVideo.findFirst({ where: { isActive: true } });
  }

  upsert(
    input: GlobalGameCenterVideoWriteInput,
    actor: AuditActor,
  ): Promise<GlobalGameCenterVideoRecord> {
    return this.prisma.$transaction(async (transaction) => {
      const existing = await transaction.globalGameCenterVideo.findFirst({
        where: { isActive: true },
      });
      const data = {
        title: input.title,
        embedUrl: input.embedUrl,
        canonicalUrl: input.canonicalUrl,
        thumbnailUrl: input.thumbnailUrl,
        sourceLabel: input.sourceLabel,
        updatedById: actor.userId,
        updatedBySnapshot: actor.emailSnapshot,
      };
      if (existing === null) {
        const created = await transaction.globalGameCenterVideo.create({
          data: { ...data, createdById: actor.userId, createdBySnapshot: actor.emailSnapshot },
        });
        await createAudit(
          transaction,
          actor,
          'GLOBAL_GAME_MEDIA_CREATED',
          'GLOBAL_GAME_MEDIA',
          created.id,
          null,
          created,
        );
        return created;
      }
      const updated = await transaction.globalGameCenterVideo.update({
        where: { id: existing.id },
        data,
      });
      await createAudit(
        transaction,
        actor,
        'GLOBAL_GAME_MEDIA_UPDATED',
        'GLOBAL_GAME_MEDIA',
        updated.id,
        existing,
        updated,
      );
      return updated;
    });
  }

  remove(actor: AuditActor): Promise<GlobalGameCenterVideoRecord | null> {
    return this.prisma.$transaction(async (transaction) => {
      const existing = await transaction.globalGameCenterVideo.findFirst({
        where: { isActive: true },
      });
      if (existing === null) return null;
      const deleted = await transaction.globalGameCenterVideo.delete({
        where: { id: existing.id },
      });
      await createAudit(
        transaction,
        actor,
        'GLOBAL_GAME_MEDIA_REMOVED',
        'GLOBAL_GAME_MEDIA',
        existing.id,
        existing,
        null,
      );
      return deleted;
    });
  }
}

/** Matches the `createAudit` helper in `game-media-curation.repository.ts`
 * (and the same per-module-copy convention as `admin.repository.ts`). */
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
