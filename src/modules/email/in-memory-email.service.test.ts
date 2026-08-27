import { Writable } from 'node:stream';

import pino from 'pino';
import { describe, expect, it } from 'vitest';

import { DevelopmentEmailService } from './in-memory-email.service.js';

function createCapturingLogger() {
  let output = '';
  const destination = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      output += chunk.toString();
      callback();
    },
  });
  const logger = pino({ level: 'info' }, destination);
  return { logger, output: () => output };
}

describe('DevelopmentEmailService', () => {
  it('never logs the raw reset URL or token when logResetUrl is false', async () => {
    const { logger, output } = createCapturingLogger();
    const service = new DevelopmentEmailService(logger, false);
    const rawToken = 'super-secret-raw-reset-token';
    const resetUrl = `http://localhost:5173/reset-password?token=${rawToken}`;

    await service.sendPasswordResetEmail({
      recipientEmail: 'user@example.com',
      resetUrl,
      expiresAt: new Date('2026-08-27T01:00:00.000Z'),
    });

    expect(output()).not.toContain(rawToken);
    expect(output()).not.toContain(resetUrl);
    expect(service.passwordResetMessages).toHaveLength(1);
  });

  it('logs the reset URL only when logResetUrl is explicitly true (dev-only convenience)', async () => {
    const { logger, output } = createCapturingLogger();
    const service = new DevelopmentEmailService(logger, true);
    const rawToken = 'super-secret-raw-reset-token';
    const resetUrl = `http://localhost:5173/reset-password?token=${rawToken}`;

    await service.sendPasswordResetEmail({
      recipientEmail: 'user@example.com',
      resetUrl,
      expiresAt: new Date('2026-08-27T01:00:00.000Z'),
    });

    expect(output()).toContain(rawToken);
  });

  it('never logs the contact message content, only its id', async () => {
    const { logger, output } = createCapturingLogger();
    const service = new DevelopmentEmailService(logger, false);

    await service.sendContactNotification({
      contactMessageId: 'fixture-id',
      senderName: 'Jane Doe',
      senderEmail: 'jane@example.com',
      subject: 'A secret subject',
      message: 'A secret message body',
      receivedAt: new Date('2026-08-27T01:00:00.000Z'),
    });

    expect(output()).toContain('fixture-id');
    expect(output()).not.toContain('A secret subject');
    expect(output()).not.toContain('A secret message body');
  });
});
