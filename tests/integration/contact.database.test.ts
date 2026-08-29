import 'dotenv/config';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPrismaClient } from '../../src/common/database/prisma.js';
import { resolveTestDatabaseUrl } from '../helpers/test-database.js';
import type { PrismaClient } from '../../src/generated/prisma/client.js';
import type { AdministrativePrincipal } from '../../src/modules/admin/admin-authorization.js';
import { PrismaContactRepository } from '../../src/modules/contact/contact.repository.js';
import { ContactService } from '../../src/modules/contact/contact.service.js';
import { InMemoryEmailService } from '../../src/modules/email/in-memory-email.service.js';

const databaseTestsEnabled = process.env.RUN_DATABASE_TESTS === 'true';

function requirePrisma(client: PrismaClient | undefined): PrismaClient {
  if (client === undefined) throw new Error('Expected a connected Prisma client.');
  return client;
}

describe.skipIf(!databaseTestsEnabled)('contact database integration', () => {
  let prisma: PrismaClient | undefined;
  let principal: AdministrativePrincipal | undefined;
  let createdMessageId: string | undefined;

  beforeAll(async () => {
    prisma = createPrismaClient(resolveTestDatabaseUrl());
    const adminUser = await prisma.user.findFirstOrThrow({ where: { role: 'ADMIN' } });
    principal = { userId: adminUser.id, email: adminUser.email, role: 'ADMIN' };
  });

  function requirePrincipal(): AdministrativePrincipal {
    if (principal === undefined) throw new Error('Expected a seeded ADMIN user for this test.');
    return principal;
  }

  afterAll(async () => {
    const client = requirePrisma(prisma);
    if (createdMessageId !== undefined) {
      await client.adminAuditEvent
        .deleteMany({ where: { entityType: 'CONTACT_MESSAGE', entityId: createdMessageId } })
        .catch(() => undefined);
      await client.contactMessage
        .delete({ where: { id: createdMessageId } })
        .catch(() => undefined);
    }
    await client.$disconnect();
  });

  it('persists a real row on submit and a real AdminAuditEvent row on updateStatus', async () => {
    const client = requirePrisma(prisma);
    const principal = requirePrincipal();
    const repository = new PrismaContactRepository(client);
    const emailService = new InMemoryEmailService();
    const service = new ContactService({
      repository,
      emailService,
      onNotificationDeliveryError: () => undefined,
    });

    await service.submit({
      name: 'Contact Fixture',
      email: 'contact-fixture@example.com',
      subject: 'Integration test',
      message: 'This is a fixture contact message for the database integration test.',
    });

    expect(emailService.contactNotifications).toHaveLength(1);
    const notification = emailService.contactNotifications[0];
    expect(notification).toBeDefined();
    createdMessageId = notification?.contactMessageId;

    const persisted = await client.contactMessage.findUnique({
      where: { id: createdMessageId ?? '' },
    });
    expect(persisted).not.toBeNull();
    expect(persisted?.name).toBe('Contact Fixture');
    expect(persisted?.email).toBe('contact-fixture@example.com');
    expect(persisted?.status).toBe('NEW');

    const updated = await service.updateStatus(
      createdMessageId ?? '',
      { status: 'READ' },
      principal,
      null,
    );
    expect(updated.status).toBe('READ');

    const auditEvents = await client.adminAuditEvent.findMany({
      where: { entityType: 'CONTACT_MESSAGE', entityId: createdMessageId ?? '' },
    });
    expect(auditEvents).toHaveLength(1);
    expect(auditEvents[0]?.action).toBe('CONTACT_MESSAGE_STATUS_UPDATED');
  });
});
