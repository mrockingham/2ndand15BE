# Administrative schedule operations

All administrative HTTP routes are below `/api/v1/admin`, require a valid access token, and load the current role from PostgreSQL for every request. Roles are `USER`, `EDITOR`, and `ADMIN`; they are never accepted by registration or public profile updates.

Editors may maintain schedules and editorial articles, publish or schedule content, inspect revisions, and read game audit events or one explicitly identified article's audit events. Admins additionally remove overrides, archive/restore articles, and read the complete audit trail. Role changes are intentionally CLI-only:

```sh
npm run admin:set-role -- --email=user@example.com --role=ADMIN
```

The command requires an existing normalized email, never creates a user, prints only the internal user ID/email and role transition, and records an audit event.

## Ownership and precedence

Public values resolve field-by-field as:

```text
editorial override -> normalized Game -> null/unknown
```

Public game shapes remain unchanged and never expose provenance, internal notes, audit events, actor emails, or provider mappings. Date, week, and status filters plus kickoff ordering use resolved values. Resolution is performed from a bounded maximum of 1,000 season/source candidates; broader requests fail explicitly instead of returning incomplete results.

Manually owned base games may be edited directly. Provider-backed games require overrides. Provider synchronization may continue updating the base game, never removes an override, and reports how many base updates remain hidden by overrides. An override is not automatically removed when provider and editorial values later match.

## Provenance, verification, and audit

Each maintained game can record source type/name, optional source URL and external reference, import time, notes, and verification actor/time. Verification means an editor checked factual schedule information; it does not grant publication or trademark rights. Editing schedule fields or overrides clears prior verification.

Administrative writes create immutable-style audit events with actor snapshots, action, entity identity, sanitized before/after snapshots, and correlation ID when supplied. Passwords, tokens, cookies, authorization headers, and provider credentials are redacted. Audit events have no update/delete API, and deleting a user sets relational actor IDs to null while retaining actor snapshots.

Highlightly remains evaluation-only until publication, storage, caching, transformation, and logo rights are confirmed in writing.
