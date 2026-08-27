export interface PasswordResetEmailInput {
  readonly recipientEmail: string;
  readonly resetUrl: string;
  readonly expiresAt: Date;
}

export interface ContactNotificationEmailInput {
  readonly contactMessageId: string;
  readonly senderName: string;
  readonly senderEmail: string;
  readonly subject: string | null;
  readonly message: string;
  readonly receivedAt: Date;
}

export interface EmailService {
  sendPasswordResetEmail(input: PasswordResetEmailInput): Promise<void>;
  sendContactNotification(input: ContactNotificationEmailInput): Promise<void>;
}
