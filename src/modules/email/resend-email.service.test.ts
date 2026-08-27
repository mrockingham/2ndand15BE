import pino from 'pino';
import { describe, expect, it, vi } from 'vitest';

import { EmailDeliveryError } from './email-delivery-error.js';
import { renderPasswordResetEmail } from './email-templates.js';
import { ResendEmailService } from './resend-email.service.js';

const secretApiKey = 'resend-secret-api-key-do-not-leak';
const secretResetUrl = 'https://app.example.com/reset-password?token=super-secret-token';

function silentLogger() {
  return pino({ level: 'silent' });
}

function collectingLogger() {
  const calls: unknown[][] = [];
  const logger = pino({ level: 'silent' });
  const error = vi.fn((...args: unknown[]) => {
    calls.push(args);
  });
  return { logger: Object.assign(logger, { error }), calls, error };
}

describe('ResendEmailService.sendPasswordResetEmail', () => {
  it('calls the Resend API with the expected shape on success', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    const service = new ResendEmailService({
      apiKey: secretApiKey,
      from: '2nd & 15 <support@2ndand15.com>',
      logger: silentLogger(),
      fetchImpl,
      baseUrl: 'https://resend.test/emails',
    });

    await service.sendPasswordResetEmail({
      recipientEmail: 'user@example.com',
      resetUrl: secretResetUrl,
      expiresAt: new Date(Date.now() + 30 * 60_000),
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://resend.test/emails');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({
      Authorization: `Bearer ${secretApiKey}`,
      'Content-Type': 'application/json',
    });
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body).toMatchObject({
      from: '2nd & 15 <support@2ndand15.com>',
      to: ['user@example.com'],
      subject: 'Reset your 2nd & 15 password',
    });
    expect(body.html).toContain(secretResetUrl);
    expect(body.text).toContain(secretResetUrl);
  });

  it('does not leak the reset URL or token through the logger on success', async () => {
    const { logger, calls } = collectingLogger();
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    const service = new ResendEmailService({
      apiKey: secretApiKey,
      from: '2nd & 15 <support@2ndand15.com>',
      logger,
      fetchImpl,
    });

    await service.sendPasswordResetEmail({
      recipientEmail: 'user@example.com',
      resetUrl: secretResetUrl,
      expiresAt: new Date(Date.now() + 30 * 60_000),
    });

    const serializedCalls = JSON.stringify(calls);
    expect(serializedCalls).not.toContain(secretResetUrl);
    expect(serializedCalls).not.toContain('super-secret-token');
  });

  it('throws EmailDeliveryError on a non-ok response, without leaking the API key or reset URL', async () => {
    const { logger, calls } = collectingLogger();
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    const service = new ResendEmailService({
      apiKey: secretApiKey,
      from: '2nd & 15 <support@2ndand15.com>',
      logger,
      fetchImpl,
    });

    await expect(
      service.sendPasswordResetEmail({
        recipientEmail: 'user@example.com',
        resetUrl: secretResetUrl,
        expiresAt: new Date(Date.now() + 30 * 60_000),
      }),
    ).rejects.toBeInstanceOf(EmailDeliveryError);

    const serializedCalls = JSON.stringify(calls);
    expect(serializedCalls).not.toContain(secretApiKey);
    expect(serializedCalls).not.toContain(secretResetUrl);
    expect(serializedCalls).toContain('500');
  });

  it('throws EmailDeliveryError on a network failure, without leaking the API key', async () => {
    const { logger, calls } = collectingLogger();
    const fetchImpl = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const service = new ResendEmailService({
      apiKey: secretApiKey,
      from: '2nd & 15 <support@2ndand15.com>',
      logger,
      fetchImpl,
    });

    await expect(
      service.sendPasswordResetEmail({
        recipientEmail: 'user@example.com',
        resetUrl: secretResetUrl,
        expiresAt: new Date(Date.now() + 30 * 60_000),
      }),
    ).rejects.toBeInstanceOf(EmailDeliveryError);

    const serializedCalls = JSON.stringify(calls);
    expect(serializedCalls).not.toContain(secretApiKey);
  });
});

describe('ResendEmailService.sendContactNotification', () => {
  const contactInput = {
    contactMessageId: '00000000-0000-4000-8000-000000000123',
    senderName: 'Jane Fan',
    senderEmail: 'jane@example.com',
    subject: 'Question',
    message: 'Hello there',
    receivedAt: new Date('2026-08-27T00:00:00.000Z'),
  };

  it('sends to the configured contactToEmail on success', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    const service = new ResendEmailService({
      apiKey: secretApiKey,
      from: '2nd & 15 <support@2ndand15.com>',
      contactToEmail: 'contact@2ndand15.com',
      logger: silentLogger(),
      fetchImpl,
    });

    await service.sendContactNotification(contactInput);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body).toMatchObject({ to: ['contact@2ndand15.com'] });
  });

  it('throws EmailDeliveryError with a sanitized message on failure', async () => {
    const { logger, calls } = collectingLogger();
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 502 });
    const service = new ResendEmailService({
      apiKey: secretApiKey,
      from: '2nd & 15 <support@2ndand15.com>',
      contactToEmail: 'contact@2ndand15.com',
      logger,
      fetchImpl,
    });

    await expect(service.sendContactNotification(contactInput)).rejects.toBeInstanceOf(
      EmailDeliveryError,
    );
    const serializedCalls = JSON.stringify(calls);
    expect(serializedCalls).not.toContain(secretApiKey);
  });

  it('throws EmailDeliveryError without calling fetch when contactToEmail is null', async () => {
    const fetchImpl = vi.fn();
    const service = new ResendEmailService({
      apiKey: secretApiKey,
      from: '2nd & 15 <support@2ndand15.com>',
      contactToEmail: null,
      logger: silentLogger(),
      fetchImpl,
    });

    await expect(service.sendContactNotification(contactInput)).rejects.toBeInstanceOf(
      EmailDeliveryError,
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('renderPasswordResetEmail', () => {
  it('includes the reset URL and expiration minutes in both html and text, without a literal password value', () => {
    const { html, text } = renderPasswordResetEmail({
      resetUrl: 'https://app.example.com/reset-password?token=abc123',
      expiresInMinutes: 30,
    });

    expect(html).toContain('https://app.example.com/reset-password?token=abc123');
    expect(text).toContain('https://app.example.com/reset-password?token=abc123');
    expect(html).toContain('30');
    expect(text).toContain('30');
    expect(html).not.toMatch(/password:\s*\S+/i);
    expect(text).not.toMatch(/password:\s*\S+/i);
  });

  it('HTML-escapes the reset URL in html but leaves text unescaped', () => {
    const dangerousUrl = 'https://app.example.com/reset?x=<script>alert(1)</script>&y=1';
    const { html, text } = renderPasswordResetEmail({
      resetUrl: dangerousUrl,
      expiresInMinutes: 15,
    });

    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&amp;y=1');
    expect(text).toContain(dangerousUrl);
  });
});
