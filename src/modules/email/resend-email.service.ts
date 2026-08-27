import type { Logger } from 'pino';

import { EmailDeliveryError } from './email-delivery-error.js';
import { renderContactNotificationEmail, renderPasswordResetEmail } from './email-templates.js';
import type {
  ContactNotificationEmailInput,
  EmailService,
  PasswordResetEmailInput,
} from './email.service.js';

const RESEND_API_URL = 'https://api.resend.com/emails';

export interface ResendEmailServiceOptions {
  readonly apiKey: string;
  readonly from: string;
  readonly contactToEmail?: string | null;
  readonly logger: Logger;
  readonly fetchImpl?: typeof fetch;
  readonly baseUrl?: string;
}

interface ResendMessage {
  readonly to: readonly string[];
  readonly subject: string;
  readonly html: string;
  readonly text: string;
}

/** Strips CR/LF so user-supplied text can never smuggle extra header-like content. */
function sanitizeHeaderValue(value: string): string {
  return value.replaceAll(/[\r\n]+/g, ' ').trim();
}

export class ResendEmailService implements EmailService {
  private readonly apiKey: string;
  private readonly from: string;
  private readonly contactToEmail: string | null;
  private readonly logger: Logger;
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;

  constructor(options: ResendEmailServiceOptions) {
    this.apiKey = options.apiKey;
    this.from = options.from;
    this.contactToEmail = options.contactToEmail ?? null;
    this.logger = options.logger;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.baseUrl = options.baseUrl ?? RESEND_API_URL;
  }

  async sendPasswordResetEmail(input: PasswordResetEmailInput): Promise<void> {
    const expiresInMinutes = Math.max(
      1,
      Math.round((input.expiresAt.getTime() - Date.now()) / 60_000),
    );
    const { html, text } = renderPasswordResetEmail({ resetUrl: input.resetUrl, expiresInMinutes });

    await this.send({
      to: [input.recipientEmail],
      subject: 'Reset your 2nd & 15 password',
      html,
      text,
    });
  }

  async sendContactNotification(input: ContactNotificationEmailInput): Promise<void> {
    if (this.contactToEmail === null) {
      throw new EmailDeliveryError('CONTACT_TO_EMAIL is not configured');
    }

    const subject = sanitizeHeaderValue(
      input.subject === null ? 'New contact message' : `New contact message: ${input.subject}`,
    );
    const { html, text } = renderContactNotificationEmail(input);

    await this.send({ to: [this.contactToEmail], subject, html, text });
  }

  private async send(message: ResendMessage): Promise<void> {
    let response: Response;
    try {
      response = await this.fetchImpl(this.baseUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: this.from,
          to: [...message.to],
          subject: message.subject,
          html: message.html,
          text: message.text,
        }),
      });
    } catch (error: unknown) {
      this.logger.error(
        { message: error instanceof Error ? error.message : 'Unknown error' },
        'Resend email request failed to send',
      );
      throw new EmailDeliveryError('Failed to reach email provider', { cause: error });
    }

    if (!response.ok) {
      this.logger.error(
        { status: response.status },
        'Resend email provider returned an error status',
      );
      throw new EmailDeliveryError(
        `Email provider responded with status ${String(response.status)}`,
      );
    }
  }
}
