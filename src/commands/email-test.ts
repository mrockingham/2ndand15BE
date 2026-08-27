import 'dotenv/config';

import { z } from 'zod';

import { createLogger } from '../common/logging/logger.js';
import { loadConfig } from '../config/env.js';
import { DevelopmentEmailService } from '../modules/email/in-memory-email.service.js';
import type { EmailService } from '../modules/email/email.service.js';
import { ResendEmailService } from '../modules/email/resend-email.service.js';

interface Args {
  readonly to: string;
}

try {
  const args = parseArgs(process.argv.slice(2));
  const config = loadConfig();
  const logger = createLogger(config);

  const emailService: EmailService =
    config.email.provider === 'resend'
      ? new ResendEmailService({
          apiKey: config.email.resendApiKey ?? '',
          from: config.email.from,
          contactToEmail: config.contact.toEmail,
          logger,
        })
      : new DevelopmentEmailService(logger, config.email.logResetUrl);

  await emailService.sendPasswordResetEmail({
    recipientEmail: args.to,
    resetUrl: 'https://example.com/reset-password?token=test-token',
    expiresAt: new Date(Date.now() + 30 * 60_000),
  });

  process.stdout.write(
    `${JSON.stringify({
      result: { provider: config.email.provider, to: args.to, status: 'sent' },
    })}\n`,
  );
} catch (error: unknown) {
  process.stderr.write(
    `${JSON.stringify({
      error: { message: error instanceof Error ? error.message : 'Email test send failed.' },
    })}\n`,
  );
  process.exitCode = 1;
}

function parseArgs(argv: readonly string[]): Args {
  const value = (name: string): string | undefined =>
    argv.find((entry) => entry.startsWith(`--${name}=`))?.slice(name.length + 3);

  const toRaw = value('to');
  if (toRaw === undefined) {
    throw new Error('--to=<email> is required.');
  }
  const parsed = z.email().safeParse(toRaw);
  if (!parsed.success) {
    throw new Error('--to must be a valid email address.');
  }

  return { to: parsed.data };
}
