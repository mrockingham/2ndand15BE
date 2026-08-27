import { randomUUID } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import type { AuditActor } from '../../common/audit/audit-actor.js';
import type { ContactMessageStatus } from '../../generated/prisma/client.js';
import { InMemoryEmailService } from '../email/in-memory-email.service.js';
import type {
  ContactMessageListResult,
  ContactMessageRecord,
  ContactRepository,
  CreateContactMessageInput,
} from './contact.repository.js';
import { ContactService } from './contact.service.js';
import type { AdminContactMessageListQuery } from './contact.schemas.js';

class FakeContactRepository implements ContactRepository {
  readonly messages: ContactMessageRecord[] = [];
  readonly updateStatusActors: AuditActor[] = [];

  create(input: CreateContactMessageInput): Promise<ContactMessageRecord> {
    const now = new Date();
    const record: ContactMessageRecord = {
      id: randomUUID(),
      name: input.name,
      email: input.email,
      subject: input.subject,
      message: input.message,
      status: 'NEW',
      createdAt: now,
      updatedAt: now,
    };
    this.messages.push(record);
    return Promise.resolve(record);
  }

  list(query: AdminContactMessageListQuery): Promise<ContactMessageListResult> {
    const messages =
      query.status === undefined
        ? this.messages
        : this.messages.filter((message) => message.status === query.status);
    return Promise.resolve({ messages, nextCursor: null });
  }

  find(contactMessageId: string): Promise<ContactMessageRecord | null> {
    const message = this.messages.find((candidate) => candidate.id === contactMessageId);
    return Promise.resolve(message ?? null);
  }

  updateStatus(
    contactMessageId: string,
    status: ContactMessageStatus,
    actor: AuditActor,
  ): Promise<ContactMessageRecord | null> {
    this.updateStatusActors.push(actor);
    const index = this.messages.findIndex((candidate) => candidate.id === contactMessageId);
    if (index === -1) return Promise.resolve(null);
    const existing = this.messages[index];
    if (existing === undefined) return Promise.resolve(null);
    const updated: ContactMessageRecord = { ...existing, status, updatedAt: new Date() };
    this.messages[index] = updated;
    return Promise.resolve(updated);
  }
}

function createHarness() {
  const repository = new FakeContactRepository();
  const emailService = new InMemoryEmailService();
  const onNotificationDeliveryError = vi.fn();
  const service = new ContactService({
    repository,
    emailService,
    onNotificationDeliveryError,
    now: () => new Date('2026-08-27T00:00:00.000Z'),
  });
  return { repository, emailService, onNotificationDeliveryError, service };
}

describe('ContactService', () => {
  it('persists a valid submission and sends exactly one notification with the correct fields', async () => {
    const { repository, emailService, service } = createHarness();

    await service.submit({
      name: 'Jane Doe',
      email: 'jane@example.com',
      subject: 'A question',
      message: 'This is a perfectly reasonable contact message.',
    });

    expect(repository.messages).toHaveLength(1);
    const created = repository.messages[0];
    expect(created).toBeDefined();
    expect(emailService.contactNotifications).toHaveLength(1);
    expect(emailService.contactNotifications[0]).toMatchObject({
      contactMessageId: created?.id,
      senderName: 'Jane Doe',
      senderEmail: 'jane@example.com',
      subject: 'A question',
      message: 'This is a perfectly reasonable contact message.',
      receivedAt: created?.createdAt,
    });
  });

  it('does not persist a row or send a notification when the honeypot field is populated', async () => {
    const { repository, emailService, service } = createHarness();

    await service.submit({
      name: 'Bot',
      email: 'bot@example.com',
      message: 'This is a spam message from a bot.',
      website: 'https://spam.example.com',
    });

    expect(repository.messages).toHaveLength(0);
    expect(emailService.contactNotifications).toHaveLength(0);
  });

  it('resolves successfully, still persists, and reports delivery errors when the email service rejects', async () => {
    const repository = new FakeContactRepository();
    const failingError = new Error('SMTP unavailable');
    const emailService = {
      sendPasswordResetEmail: vi.fn().mockResolvedValue(undefined),
      sendContactNotification: vi.fn().mockRejectedValue(failingError),
    };
    const onNotificationDeliveryError = vi.fn();
    const service = new ContactService({
      repository,
      emailService,
      onNotificationDeliveryError,
      now: () => new Date('2026-08-27T00:00:00.000Z'),
    });

    await expect(
      service.submit({
        name: 'Jane Doe',
        email: 'jane@example.com',
        message: 'This is a perfectly reasonable contact message.',
      }),
    ).resolves.toBeUndefined();

    expect(repository.messages).toHaveLength(1);
    expect(onNotificationDeliveryError).toHaveBeenCalledWith(failingError);
  });

  it('throws a 404 AppError when getting a nonexistent contact message', async () => {
    const { service } = createHarness();

    await expect(service.get(randomUUID())).rejects.toMatchObject({
      code: 'CONTACT_MESSAGE_NOT_FOUND',
      statusCode: 404,
    });
  });

  it('throws a 404 AppError when updating the status of a nonexistent contact message', async () => {
    const { service } = createHarness();
    const principal = {
      userId: randomUUID(),
      email: 'admin@example.com',
      role: 'ADMIN' as const,
    };

    await expect(
      service.updateStatus(randomUUID(), { status: 'READ' }, principal, null),
    ).rejects.toMatchObject({
      code: 'CONTACT_MESSAGE_NOT_FOUND',
      statusCode: 404,
    });
  });

  it('updates the status of an existing contact message and returns the updated record', async () => {
    const { repository, service } = createHarness();
    await service.submit({
      name: 'Jane Doe',
      email: 'jane@example.com',
      message: 'This is a perfectly reasonable contact message.',
    });
    const created = repository.messages[0];
    expect(created).toBeDefined();
    const principal = {
      userId: randomUUID(),
      email: 'admin@example.com',
      role: 'ADMIN' as const,
    };

    const updated = await service.updateStatus(
      created?.id ?? '',
      { status: 'RESOLVED' },
      principal,
      'req-1',
    );

    expect(updated.status).toBe('RESOLVED');
    expect(repository.updateStatusActors).toHaveLength(1);
    expect(repository.updateStatusActors[0]).toMatchObject({
      userId: principal.userId,
      emailSnapshot: principal.email,
      requestId: 'req-1',
    });
  });
});
