function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export interface RenderedEmail {
  readonly html: string;
  readonly text: string;
}

export function renderPasswordResetEmail(input: {
  readonly resetUrl: string;
  readonly expiresInMinutes: number;
}): RenderedEmail {
  const { resetUrl } = input;
  const expiresInMinutes = String(input.expiresInMinutes);

  const text = [
    'Reset your 2nd & 15 password',
    '',
    'We received a request to reset your password.',
    '',
    resetUrl,
    '',
    `This link expires in ${expiresInMinutes} minutes.`,
    '',
    "If you didn't request this, you can safely ignore this email.",
  ].join('\n');

  const html = `
<div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; color: #111;">
  <h1 style="font-size: 20px;">2nd &amp; 15</h1>
  <p>We received a request to reset your password.</p>
  <p>
    <a href="${escapeHtml(resetUrl)}" style="display:inline-block;padding:12px 20px;background:#0b5fff;color:#fff;border-radius:6px;text-decoration:none;">
      Reset Password
    </a>
  </p>
  <p>This link expires in ${expiresInMinutes} minutes.</p>
  <p style="color:#666;font-size:13px;">If you didn't request this, you can safely ignore this email.</p>
</div>`.trim();

  return { html, text };
}

export function renderContactNotificationEmail(input: {
  readonly contactMessageId: string;
  readonly senderName: string;
  readonly senderEmail: string;
  readonly subject: string | null;
  readonly message: string;
  readonly receivedAt: Date;
}): RenderedEmail {
  const receivedAtIso = input.receivedAt.toISOString();
  const subjectLine = input.subject ?? '(none)';

  const text = [
    'New contact form submission',
    '',
    `From: ${input.senderName} <${input.senderEmail}>`,
    `Subject: ${subjectLine}`,
    `Received: ${receivedAtIso}`,
    `Message ID: ${input.contactMessageId}`,
    '',
    input.message,
  ].join('\n');

  const html = `
<div style="font-family: sans-serif; max-width: 560px; margin: 0 auto; color: #111;">
  <h1 style="font-size: 18px;">New contact form submission</h1>
  <p><strong>From:</strong> ${escapeHtml(input.senderName)} &lt;${escapeHtml(input.senderEmail)}&gt;</p>
  <p><strong>Subject:</strong> ${escapeHtml(subjectLine)}</p>
  <p><strong>Received:</strong> ${escapeHtml(receivedAtIso)}</p>
  <p><strong>Message ID:</strong> ${escapeHtml(input.contactMessageId)}</p>
  <hr />
  <p style="white-space: pre-wrap;">${escapeHtml(input.message)}</p>
</div>`.trim();

  return { html, text };
}
