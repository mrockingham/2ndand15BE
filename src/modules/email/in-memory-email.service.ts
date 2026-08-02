import type { Logger } from 'pino';

import type { EmailService, PasswordResetEmailInput } from './email.service.js';

export class InMemoryEmailService implements EmailService {
  readonly passwordResetMessages: PasswordResetEmailInput[] = [];

  sendPasswordResetEmail(input: PasswordResetEmailInput): Promise<void> {
    this.passwordResetMessages.push({ ...input });
    return Promise.resolve();
  }
}

export class DevelopmentEmailService extends InMemoryEmailService {
  constructor(
    private readonly logger: Logger,
    private readonly logResetUrl: boolean,
  ) {
    super();
  }

  override async sendPasswordResetEmail(input: PasswordResetEmailInput): Promise<void> {
    await super.sendPasswordResetEmail(input);

    if (this.logResetUrl) {
      this.logger.warn(
        { recipientEmail: input.recipientEmail, resetUrl: input.resetUrl },
        'Development-only password reset URL',
      );
    }
  }
}
