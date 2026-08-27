# Contact form

This document covers the public contact form: the endpoint and its
validation bounds, the honeypot anti-spam mechanism, the separate rate
limiter, the durability-first delivery policy, what's stored (and what
deliberately isn't), the admin triage API, and audit logging.

## Public endpoint

`POST /api/v1/contact` — public, unauthenticated. Request body is validated
by `submitContactMessageSchema` (`src/modules/contact/contact.schemas.ts`):

| Field     | Rule                                                        |
| --------- | ----------------------------------------------------------- |
| `name`    | string, trimmed, 1–100 characters                           |
| `email`   | valid email, ≤254 characters                                |
| `subject` | optional, trimmed, ≤150 characters (empty string → omitted) |
| `message` | string, trimmed, 10–5000 characters                         |
| `website` | optional, ≤1000 characters — the honeypot field, see below  |

The schema is `.strict()`, so any unexpected field in the body is rejected
rather than silently ignored. On success the endpoint always returns `202`
with a generic acknowledgement:

```
{ data: { message: "Thanks -- we've received your message and will follow up soon." } }
```

## Honeypot mechanism

`website` is an invisible field a real human submitter should never
populate (the frontend should render it off-screen/unlabeled). If it's
present and non-blank, `ContactService.submit` returns immediately —
**no database row is created, no notification email is sent, and the caller
still receives the identical `202` generic-acknowledgement response** as a
genuine submission. The anti-spam check never reveals itself: there is no
error, no different status code, no different message, and no logging that
would let an automated submitter distinguish "silently dropped as spam" from
"accepted." This mirrors the anti-enumeration principle used for
`/forgot-password` — the response is the same either way.

## Rate limiting

Contact submissions are rate-limited by a **separate** limiter from the
general `/api/v1` traffic limiter (`RATE_LIMIT_*`), configured by
`CONTACT_RATE_LIMIT_WINDOW_MS` / `CONTACT_RATE_LIMIT_MAX` and applied only to
`POST /api/v1/contact` (`createPublicContactRouter`). Defaults are a 1-hour
window capped at 5 submissions — deliberately stricter than general API
traffic, since this is a public write endpoint with no authentication.

## Durability-first delivery policy

`ContactService.submit` persists the message to the database **before**
attempting to send the operator notification email, and a notification
failure does not fail the request or roll back the write:

```ts
const created = await this.options.repository.create({ ... });

// Durability first: the message is already persisted, so a notification
// failure must not surface to the caller as a failed submission.
try {
  await this.options.emailService.sendContactNotification({ ... });
} catch (error: unknown) {
  this.options.onNotificationDeliveryError(error);
}
```

The reasoning: from the submitter's point of view, "did my message go
through" should depend only on whether it was durably recorded, not on
whether an email happened to send successfully at that exact moment. A
transient Resend outage should never cause a real contact submission to be
lost or reported as failed to the person submitting it. Delivery failures
are still surfaced operationally — `onNotificationDeliveryError` is wired in
`src/server.ts` to log `Contact notification email delivery failed` — so an
operator relying solely on the notification email as their triage signal
would still need to periodically check the admin triage API (below) as a
backstop, since a notification-email outage doesn't page anyone by itself.

## What's stored

The `ContactMessage` model (`prisma/schema.prisma`) stores: `id`, `name`,
`email`, `subject` (nullable), `message`, `status`
(`NEW`/`READ`/`RESOLVED`/`SPAM`), `createdAt`, `updatedAt`.

**No raw IP address or user-agent is stored.** The schema comment is explicit
about this:

> Deliberately does not store raw IP or user-agent -- rate limiting
> (CONTACT_RATE_LIMIT_*) uses Express's resolved req.ip in-memory only, and
> no durable per-submitter fingerprint is kept.

Rate limiting still works (it uses the request's resolved IP transiently, in
memory, for the rate-limit window) — but that IP is never written to a
database row, so there is no durable per-submitter fingerprint tied to a
stored contact message.

## Admin triage API

`/api/v1/admin/contact-messages` — authenticated, role-protected, with two
distinct capability levels (`src/modules/contact/contact.routes.ts`,
`src/modules/admin/admin-authorization.ts`):

| Route                                             | Capability                | Role(s)       |
| ------------------------------------------------- | ------------------------- | ------------- |
| `GET /admin/contact-messages`                     | `VIEW_CONTACT_MESSAGES`   | EDITOR, ADMIN |
| `GET /admin/contact-messages/:contactMessageId`   | `VIEW_CONTACT_MESSAGES`   | EDITOR, ADMIN |
| `PATCH /admin/contact-messages/:contactMessageId` | `MANAGE_CONTACT_MESSAGES` | ADMIN only    |

Viewing/listing messages is available to both EDITOR and ADMIN roles;
changing a message's `status` requires `MANAGE_CONTACT_MESSAGES`, which is
ADMIN-only. This intentionally follows the same split used for other
operational/support actions (e.g. `PROBE_GAME_DATA`, `REPAIR_GAME_PLAYS`)
rather than the more permissive editorial-content precedent used for
homepage/article management — contact triage is treated as an operational
action, not editorial content.

List results are cursor-paginated (`limit`, `cursor`, optional `status`
filter) and ordered by `createdAt desc, id desc`.

## Audit logging

Every status change made through `PATCH /admin/contact-messages/:contactMessageId`
is recorded in the existing `AdminAuditEvent` table
(`PrismaContactRepository.updateStatus`, run inside the same transaction as
the update itself):

- `entityType: 'CONTACT_MESSAGE'`
- `entityId`: the contact message's id
- `action: 'CONTACT_MESSAGE_STATUS_UPDATED'`
- `beforeSnapshot` / `afterSnapshot`: sanitized before/after row snapshots
  (via `sanitizeAuditSnapshot`, the same sanitizer used elsewhere in the
  admin module)
- `actorUserId` / `actorEmailSnapshot` / `requestId`: who made the change and
  which request it came from

This reuses the same audit infrastructure as every other admin mutation in
the codebase — no new audit mechanism was introduced for contact triage.
