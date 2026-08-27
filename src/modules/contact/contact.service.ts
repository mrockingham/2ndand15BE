import { AppError } from '../../common/errors/app-error.js';
import type { AuditActor } from '../../common/audit/audit-actor.js';
import type { AdministrativePrincipal } from '../admin/admin-authorization.js';
import type { EmailService } from '../email/email.service.js';
import type {
  ContactMessageListResult,
  ContactMessageRecord,
  ContactRepository,
} from './contact.repository.js';
import type {
  AdminContactMessageListQuery,
  SubmitContactMessageInput,
  UpdateContactMessageStatusInput,
} from './contact.schemas.js';

export interface ContactServiceContract {
  submit(input: SubmitContactMessageInput): Promise<void>;
  list(query: AdminContactMessageListQuery): Promise<ContactMessageListResult>;
  get(contactMessageId: string): Promise<ContactMessageRecord>;
  updateStatus(
    contactMessageId: string,
    input: UpdateContactMessageStatusInput,
    principal: AdministrativePrincipal,
    requestId: string | null,
  ): Promise<ContactMessageRecord>;
}

export interface ContactServiceOptions {
  readonly repository: ContactRepository;
  readonly emailService: EmailService;
  readonly onNotificationDeliveryError: (error: unknown) => void;
  readonly now?: () => Date;
}

export class ContactService implements ContactServiceContract {
  private readonly now: () => Date;

  constructor(private readonly options: ContactServiceOptions) {
    this.now = options.now ?? (() => new Date());
  }

  async submit(input: SubmitContactMessageInput): Promise<void> {
    // Honeypot: a populated `website` field means the submission almost
    // certainly came from a bot. Return silently (same outward behavior as a
    // real submission) without persisting a row or sending a notification --
    // never reveal that anti-spam logic exists.
    if (input.website !== undefined && input.website.trim().length > 0) {
      return;
    }

    const created = await this.options.repository.create({
      name: input.name,
      email: input.email,
      subject: input.subject ?? null,
      message: input.message,
    });

    // Durability first: the message is already persisted, so a notification
    // failure must not surface to the caller as a failed submission.
    try {
      await this.options.emailService.sendContactNotification({
        contactMessageId: created.id,
        senderName: created.name,
        senderEmail: created.email,
        subject: created.subject,
        message: created.message,
        receivedAt: created.createdAt,
      });
    } catch (error: unknown) {
      this.options.onNotificationDeliveryError(error);
    }
  }

  list(query: AdminContactMessageListQuery): Promise<ContactMessageListResult> {
    return this.options.repository.list(query);
  }

  async get(contactMessageId: string): Promise<ContactMessageRecord> {
    const message = await this.options.repository.find(contactMessageId);
    if (message === null) throw contactMessageNotFoundError();
    return message;
  }

  async updateStatus(
    contactMessageId: string,
    input: UpdateContactMessageStatusInput,
    principal: AdministrativePrincipal,
    requestId: string | null,
  ): Promise<ContactMessageRecord> {
    const actor: AuditActor = {
      userId: principal.userId,
      emailSnapshot: principal.email,
      requestId,
    };
    const updated = await this.options.repository.updateStatus(
      contactMessageId,
      input.status,
      actor,
    );
    if (updated === null) throw contactMessageNotFoundError();
    return updated;
  }
}

function contactMessageNotFoundError(): AppError {
  return new AppError({
    code: 'CONTACT_MESSAGE_NOT_FOUND',
    message: 'Contact message not found.',
    statusCode: 404,
  });
}
