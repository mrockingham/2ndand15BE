export interface PasswordResetEmailInput {
  readonly recipientEmail: string;
  readonly resetUrl: string;
  readonly expiresAt: Date;
}

export interface EmailService {
  sendPasswordResetEmail(input: PasswordResetEmailInput): Promise<void>;
}
