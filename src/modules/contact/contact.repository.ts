import type { AuditActor } from '../../common/audit/audit-actor.js';
import { sanitizeAuditSnapshot } from '../admin/audit-sanitizer.js';
import type {
  ContactMessage,
  ContactMessageStatus,
  Prisma,
  PrismaClient,
} from '../../generated/prisma/client.js';
import type { AdminContactMessageListQuery } from './contact.schemas.js';

export interface ContactMessageRecord {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly subject: string | null;
  readonly message: string;
  readonly status: ContactMessageStatus;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface CreateContactMessageInput {
  readonly name: string;
  readonly email: string;
  readonly subject: string | null;
  readonly message: string;
}

export interface ContactMessageListResult {
  readonly messages: readonly ContactMessageRecord[];
  readonly nextCursor: string | null;
}

export interface ContactRepository {
  create(input: CreateContactMessageInput): Promise<ContactMessageRecord>;
  list(query: AdminContactMessageListQuery): Promise<ContactMessageListResult>;
  find(contactMessageId: string): Promise<ContactMessageRecord | null>;
  updateStatus(
    contactMessageId: string,
    status: ContactMessageStatus,
    actor: AuditActor,
  ): Promise<ContactMessageRecord | null>;
}

export class PrismaContactRepository implements ContactRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(input: CreateContactMessageInput): Promise<ContactMessageRecord> {
    return this.prisma.contactMessage.create({ data: { ...input } });
  }

  async list(query: AdminContactMessageListQuery): Promise<ContactMessageListResult> {
    const messages = await this.prisma.contactMessage.findMany({
      where: query.status === undefined ? {} : { status: query.status },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      ...(query.cursor === undefined ? {} : { cursor: { id: query.cursor }, skip: 1 }),
    });
    const hasMore = messages.length > query.limit;
    const page = hasMore ? messages.slice(0, query.limit) : messages;
    return { messages: page, nextCursor: hasMore ? (page.at(-1)?.id ?? null) : null };
  }

  find(contactMessageId: string): Promise<ContactMessageRecord | null> {
    return this.prisma.contactMessage.findUnique({ where: { id: contactMessageId } });
  }

  async updateStatus(
    contactMessageId: string,
    status: ContactMessageStatus,
    actor: AuditActor,
  ): Promise<ContactMessageRecord | null> {
    return this.prisma.$transaction(async (transaction) => {
      const before = await transaction.contactMessage.findUnique({
        where: { id: contactMessageId },
      });
      if (before === null) return null;

      const after: ContactMessage = await transaction.contactMessage.update({
        where: { id: contactMessageId },
        data: { status },
      });

      await createAudit(
        transaction,
        actor,
        'CONTACT_MESSAGE_STATUS_UPDATED',
        after.id,
        before,
        after,
      );
      return after;
    });
  }
}

async function createAudit(
  transaction: Prisma.TransactionClient,
  actor: AuditActor,
  action: string,
  entityId: string,
  before: unknown,
  after: unknown,
): Promise<void> {
  await transaction.adminAuditEvent.create({
    data: {
      actorUserId: actor.userId,
      actorEmailSnapshot: actor.emailSnapshot,
      action,
      entityType: 'CONTACT_MESSAGE',
      entityId,
      beforeSnapshot: sanitizeAuditSnapshot(before),
      afterSnapshot: sanitizeAuditSnapshot(after),
      requestId: actor.requestId,
    },
  });
}
