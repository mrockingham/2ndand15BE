# Email delivery

This document covers how the backend sends email: the `EmailService`
abstraction, the `development`/`resend` provider switch, the password-reset
email content, the anti-enumeration guarantee on `forgot-password`, the
policy decision around reset-token delivery failure, log-safety around reset
URLs, and how to send a real test email.

## The `EmailService` interface

All email-sending goes through one interface, `src/modules/email/email.service.ts`:

```ts
export interface EmailService {
  sendPasswordResetEmail(input: PasswordResetEmailInput): Promise<void>;
  sendContactNotification(input: ContactNotificationEmailInput): Promise<void>;
}
```

`AuthService` (password reset) and `ContactService` (contact-form operator
notifications) depend only on this interface — neither imports Resend, nor
knows anything about HTTP, API keys, or which provider is active. This keeps
both services trivially testable (an in-memory fake satisfies the interface)
and means adding a future email provider only requires a new class
implementing `EmailService`, with zero changes to `AuthService`/`ContactService`.

`src/server.ts` is the one place that decides which concrete implementation
to construct, based on `config.email.provider`:

```ts
const emailService: EmailService =
  config.email.provider === 'resend'
    ? new ResendEmailService({
        apiKey: config.email.resendApiKey ?? '',
        from: config.email.from,
        contactToEmail: config.contact.toEmail,
        logger,
      })
    : new DevelopmentEmailService(logger, config.email.logResetUrl);
```

## `EMAIL_PROVIDER` switch

- **`development`** (`DevelopmentEmailService`, `src/modules/email/in-memory-email.service.ts`) —
  stores sent messages in memory (`passwordResetMessages`, `contactNotifications`
  arrays) and never sends anything over the network. Optionally logs the raw
  reset URL if `EMAIL_DEV_LOG_RESET_URL=true` (see the log-safety section
  below). **Rejected in production** — `NODE_ENV=production` with
  `EMAIL_PROVIDER=development` fails config validation and the process
  refuses to start.
- **`resend`** (`ResendEmailService`, `src/modules/email/resend-email.service.ts`) —
  sends real email via the [Resend](https://resend.com) HTTP API
  (`https://api.resend.com/emails`) using the built-in `fetch`, with **no
  Resend npm SDK dependency**. A non-2xx response or a network failure is
  wrapped in an `EmailDeliveryError` and thrown to the caller.

### Required Resend environment variables

- `EMAIL_PROVIDER=resend`
- `RESEND_API_KEY` — required whenever `EMAIL_PROVIDER=resend` (enforced by
  config validation); sent as `Authorization: Bearer <key>`.
- `EMAIL_FROM` — the From header for every outbound message, e.g.
  `2nd & 15 <support@2ndand15.com>`.
- `CONTACT_TO_EMAIL` — required for `sendContactNotification` to have a
  destination; also required outright in production regardless of email
  provider (see `docs/production/contact.md`).

## Password reset email content

`src/modules/email/email-templates.ts` renders both the HTML and a
plain-text fallback for every outbound message. `renderPasswordResetEmail`
produces:

- **Branding** — a `2nd & 15` heading.
- **Explanation** — "We received a request to reset your password."
- **Link** — a styled button/link to the reset URL (HTML), and the raw URL
  inline (plain text).
- **Expiration** — "This link expires in {N} minutes," computed from the
  token's actual `expiresAt` at send time
  (`Math.max(1, Math.round((expiresAt - now) / 60_000))` in
  `ResendEmailService.sendPasswordResetEmail`), so the number always reflects
  the real remaining validity window rather than a hardcoded value.
- **Security notice** — "If you didn't request this, you can safely ignore
  this email."

All user-controllable values that reach the HTML template (there are none in
the reset-email path beyond the reset URL itself, which is generated
server-side) are passed through `escapeHtml` before interpolation, and the
same templates module escapes contact-notification fields
(name/email/subject/message) for the same reason.

## Anti-enumeration guarantee

`POST /api/v1/auth/forgot-password` always returns the same generic `200`
response regardless of whether the submitted email matches an active
account:

```
{ data: { message: "If an account exists for that email, password reset instructions have been sent." } }
```

`AuthService.forgotPassword` looks up the user, and if none is found (or the
account isn't active), it simply returns without creating a token or sending
an email — no error, no different response shape, no timing shortcut that
would be observably different from the success path in the controller layer.
This is enforced at the service/controller boundary: nothing about the
`/forgot-password` response can be used to determine whether a given email
address has an account.

## Policy decision: the reset token is not deleted on delivery failure

`AuthService.forgotPassword` creates the `PasswordResetToken` row **before**
attempting to send the email, and does not roll it back or delete it if
`emailService.sendPasswordResetEmail` throws:

```ts
await this.repository.createPasswordReset({ ... });

const resetUrl = new URL(this.passwordResetFrontendUrl);
resetUrl.searchParams.set('token', rawToken);

try {
  await this.emailService.sendPasswordResetEmail({ ... });
} catch (error: unknown) {
  this.onEmailDeliveryError(error);   // logged; not re-thrown, not rolled back
}
```

**This is a deliberate policy decision, not an oversight.** The token row is
left in place, valid, single-use, and expiring normally
(`PASSWORD_RESET_TOKEN_TTL`) exactly as if the send had succeeded. The
reasoning:

- If the send genuinely failed for good, the token simply expires unused
  after its TTL — no harm done, and the user can request another reset.
- If the send is retried out-of-band (e.g. Resend's own retry behavior, or
  an operator manually re-triggering delivery for a known-transient outage)
  and the email arrives late, the token is still valid and usable — deleting
  it on the first failed attempt would create a race where a late-arriving
  email links to a token that no longer exists, silently breaking the reset
  flow for the user with no clear error.
- Failures are still surfaced operationally via `onEmailDeliveryError` (in
  `src/server.ts`, logged as `Password reset email delivery failed`), so
  delivery problems are visible to operators without being visible to the
  end user or affecting the anti-enumeration response.

## No-token-no-URL-in-logs guarantee

Outside of the explicit, opt-in `EMAIL_DEV_LOG_RESET_URL=true` development
flag — which is rejected outright in production by config validation — the
raw reset token/URL is never written to logs. `ResendEmailService` logs only
the HTTP status code on failure, never the message body or recipient token.
`DevelopmentEmailService` only logs the reset URL when
`EMAIL_DEV_LOG_RESET_URL=true`, which exists purely so a developer without
Resend credentials can still click through a reset flow locally; it has no
production equivalent.

## Sending a real test email

`npm run email:test -- --to=<verified-address>` sends one real email through
whichever provider is currently configured (`EMAIL_PROVIDER`). This is
**never run automatically** — it's a manual, explicit operator action for
confirming Resend credentials/configuration work before relying on them for
real password-reset or contact-notification traffic. Point `--to` at an
address you control and can verify delivery to (and, if using a sandboxed or
domain-restricted Resend account, an address the account is actually allowed
to send to).
