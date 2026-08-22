# Administrative schedule operations

All administrative HTTP routes are below `/api/v1/admin`, require a valid access token, and load the current role from PostgreSQL for every request. Roles are `USER`, `EDITOR`, and `ADMIN`; they are never accepted by registration or public profile updates.

Editors may maintain schedules and editorial articles, publish or schedule content, inspect revisions, test/ingest approved news sources, review candidates, and convert candidates into drafts. Admins additionally remove overrides, archive/restore articles, manage source definitions, and read the complete audit trail. Role changes are intentionally CLI-only:

```sh
npm run admin:set-role -- --email=user@example.com --role=ADMIN
```

The command requires an existing normalized email, never creates a user, prints only the internal user ID/email and role transition, and records an audit event.

## Ownership and precedence

Public values resolve field-by-field as:

```text
editorial override -> normalized Game -> null/unknown

Final score corrections for provider omissions use the dedicated sourced result-fallback operation, not the generic schedule override. It is dry-run by default, requires an existing reviewed game plus `FINAL` and both oriented scores, records source/reason/server verification time/actor, and writes an append-only game audit only when state changes. See `docs/current-season-games/result-fallback.md`.
```

Public game shapes remain unchanged and never expose provenance, internal notes, audit events, actor emails, or provider mappings. Date, week, and status filters plus kickoff ordering use resolved values. Resolution is performed from a bounded maximum of 1,000 season/source candidates; broader requests fail explicitly instead of returning incomplete results.

Manually owned base games may be edited directly. Provider-backed games require overrides. Provider synchronization may continue updating the base game, never removes an override, and reports how many base updates remain hidden by overrides. An override is not automatically removed when provider and editorial values later match.

## Provenance, verification, and audit

Each maintained game can record source type/name, optional source URL and external reference, import time, notes, and verification actor/time. Verification means an editor checked factual schedule information; it does not grant publication or trademark rights. Editing schedule fields or overrides clears prior verification.

Administrative writes create immutable-style audit events with actor snapshots, action, entity identity, sanitized before/after snapshots, and correlation ID when supplied. Passwords, tokens, cookies, authorization headers, and provider credentials are redacted. Audit events have no update/delete API, and deleting a user sets relational actor IDs to null while retaining actor snapshots.

Highlightly remains evaluation-only until publication, storage, caching, transformation, and logo rights are confirmed in writing.

## Official schedule baseline and corrections

The reviewed 2026 CSV is an imported provider-independent baseline, not immutable truth. Twenty-four official kickoffs are still TBD and are represented by a null base kickoff/public `startTime`, not placeholder timestamps. CLI-created rows remain unverified because `schedule-import-cli` is an audit snapshot, not a human verifying actor.

For a later official schedule change:

1. Find the game in `/admin/games/:gameId`.
2. Edit a manually owned base game, or create an override for a provider-backed game.
3. Record the official source name and URL and a concise correction note.
4. Verify the corrected game as the authenticated editor/admin.
5. Confirm the audit history retained the prior and updated values.

The intentionally fictional 2099 import and other development fixtures remain stored for isolated development/audit coverage. They are hidden from normal current-season public results by `CURRENT_NFL_SEASON` and `FIXTURE_DATA_ENABLED=false`. They were not deleted because there is no approved audited deletion workflow and ad hoc destructive SQL is prohibited.

## News-source capabilities

`EDITOR` receives `VIEW_NEWS_SOURCES`, `RUN_NEWS_INGESTION`, `VIEW_NEWS_CANDIDATES`, `REVIEW_NEWS_CANDIDATES`, and `CONVERT_NEWS_CANDIDATE`. `ADMIN` also receives `MANAGE_NEWS_SOURCES`. Current persisted roles are checked on every request; none of these routes are public.

Source and candidate changes reuse `AdminAuditEvent` with compact snapshots. Audits include source creation/update/test, ingestion initiation, pause/resume, manual submission, review transitions, dismissal, and conversion. They never contain raw XML, source descriptions, article bodies, validators, credentials, cookies, or authorization headers. See [news-source ingestion](news-source-ingestion.md).
