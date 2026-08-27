# Rollback plan

This document covers what to do if this change (or any subsequent
deployment) needs to be rolled back: frontend, backend, and database. The
database section in particular describes a **process the user needs to
execute themselves** in the Neon console — it has not been done yet and is
out of scope for this document to perform.

## Frontend rollback

This repository does not own the frontend. The general principle: redeploy
the previous known-good frontend commit/build. No backend-specific action is
required to roll back the frontend in isolation, though see the compatibility
note below if the frontend and backend are being rolled back together or
independently.

## Backend rollback

Redeploy the previous known-good backend commit/image — i.e. run the normal
deployment process (`docs/production/deployment.md`) against the prior
release artifact instead of the new one:

```sh
npm ci
npm run build
npm start                       # dist/server.js from the PREVIOUS commit/image
npm run current-games:worker    # same, for the worker process
```

Do **not** attempt to roll back by editing files in place on a running
deployment — redeploy the previous artifact through the normal deployment
pipeline so the rollback is itself a tracked, reviewable deploy.

## Database rollback policy

**Never migrate backward.** There is no supported "undo migration" step in
this workflow — `prisma:deploy` (`prisma migrate deploy`) only ever applies
forward migrations, and that remains true during a rollback. Rolling back the
database schema itself is a much higher-risk operation than rolling back
application code, and this change does not require it.

### Why this specific change's migrations are safe to leave in place

This change's migrations are **additive-only**:

- A new `ContactMessage` table (plus the `ContactMessageStatus` enum) — a
  brand-new table, nothing existing is altered.
- New/changed configuration is entirely env-var-driven (`TRUST_PROXY`,
  `EMAIL_PROVIDER`, the `CONTACT_*` and `CURRENT_GAME_POLLER_*` variables,
  etc.) — none of it touches the database schema.
- No columns were dropped, renamed, or had their type/nullability changed on
  any existing table.

Because of this, **rolling the application back while leaving the schema
forward-compatible is safe** for this specific change. Concretely: if the
backend is rolled back to a commit from before this change, that older
application code simply never queries the `ContactMessage` table — it has no
code path that references it, so the table's continued existence is inert
from that older code's perspective. Postgres does not require a table (or
enum) referenced by no application code to be removed for the application to
function correctly.

This safety argument is specific to **this change's** migrations. It does
not generalize automatically to a future change that, say, drops a column or
narrows a type — evaluate each migration's forward-compatibility
individually before assuming a rollback is schema-safe.

### What still needs to be done before the first production migration (human action required)

This is a process step that requires **Neon console access the assistant
does not have**, and it has **not been done yet** as of this writing:

1. **Confirm or create a Neon branch/restore point before running
   `prisma:deploy` against production for the first time.** Neon supports
   branching the production database (a cheap, copy-on-write branch) or
   creating an explicit restore point immediately before a migration, so
   that if a migration needs to be undone, the database can be restored to
   its pre-migration state rather than requiring a backward migration. Do
   this from the Neon console (or Neon CLI/API) immediately before running
   `npm run prisma:deploy` against the production database for the first
   time under this change.
2. **Record which deployment environment points at which Neon
   project/branch.** The `DATABASE_URL` in this repository's local `.env`
   currently points at a Neon project (`neondb`) used for development — it
   has not been confirmed which Neon project/branch is the actual production
   database. Before the first production deploy, verify and write down (in
   whatever runbook/secrets-management system the team uses — not
   necessarily this file) exactly which Neon project and branch each
   deployment environment's `DATABASE_URL` resolves to, so that "which
   database does production actually point at" is never a question that
   requires guessing or reverse-engineering a connection string under
   pressure during an incident.

Both of these are explicitly the user's responsibility to execute — they
require Neon console access and an operational decision about environment
naming/mapping that this document cannot make on its own.
