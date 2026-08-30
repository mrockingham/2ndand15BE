# Power rankings (M43A)

`GET /api/v1/power-rankings` is a public, database-only endpoint over 2nd & 15's own editorial power rankings -- independent editorial analysis by 2nd & 15, not an official NFL ranking. It never calls a provider during a public request. Product placement is directly under Standings.

## Data model

`PowerRankingEdition` is one versioned, durable edition (e.g. season 2026, edition `preseason` or `week-1`), unique per `(season, edition)` so a new weekly edition never overwrites history. `PowerRankingEntry` is one team's slot within an edition: `rank`, `previousRank`, a server-derived `movement`, `tier`, `headline`, `summary`, `strengths[]`, `concerns[]`. Team identity (name, abbreviation, conference, division) is never duplicated onto an entry -- it's always read live from the related `Team` row via `teamId`. `rank` is unique per edition and constrained to 1..32 at the database level; a `PUBLISHED` edition must have exactly 32 entries, each a distinct active NFL team, enforced at publish time.

`movement` is always `previousRank - rank`, recomputed server-side whenever rank or previousRank changes -- positive means moved up, negative moved down, 0 unchanged, `null` means no previous ranking. It is never accepted as direct input.

## Public API

- `GET /api/v1/power-rankings?season=&edition=` -- defaults to the latest `PUBLISHED` edition; `edition` requires `season`. 404s if none is published yet (a `DRAFT` edition is never visible here).
- `GET /api/v1/power-rankings/editions?season=` -- published editions, most recent first, for historical edition selection in the UI.

## Admin API

Mounted at `/api/v1/admin/power-rankings`, gated by the `VIEW_POWER_RANKINGS` (read) / `MANAGE_POWER_RANKINGS` (write) capabilities -- granted to both EDITOR and ADMIN, matching `PUBLISH_ARTICLE`'s precedent.

- `GET /`, `GET /:editionId` -- list/detail, any status.
- `POST /` -- create an edition's metadata (no entries yet; entries arrive via import).
- `PATCH /:editionId` -- edit title/subtitle/asOf/methodology/sources.
- `PATCH /:editionId/entries/:entryId` -- edit one entry's content fields and/or `rank`. Changing `rank` triggers a safe transactional reorder of every entry between the old and new rank (two-phase negative-offset reassignment, the same pattern used by `game-media-curation`'s and `homepage`'s position reordering) -- ranks stay unique and contiguous 1..32.
- `POST /:editionId/entries/reorder` -- bulk reorder given the full ordered list of an edition's entry ids.
- `POST /:editionId/publish` -- requires exactly 32 entries, each a distinct currently-active NFL team.
- `POST /:editionId/unpublish` -- returns a `PUBLISHED` edition to `DRAFT` (reuses `DRAFT`, no separate "unpublished" status was needed).

## Batch JSON import

Both a CLI and an admin HTTP endpoint accept the same document shape (`title`, `season`, `edition`, `asOf`, `methodology`, `sources[]`, `rankings[]`), matching the source 2026 preseason rankings JSON.

```bash
npm run power-rankings:import -- --file=./data/2026-preseason-power-rankings.json --actor=<editor-or-admin-email>              # PREVIEW: validates only, writes nothing
npm run power-rankings:import -- --file=./data/2026-preseason-power-rankings.json --actor=<editor-or-admin-email> --write      # UPSERT
npm run power-rankings:import -- --file=./data/2026-preseason-power-rankings.json --actor=<editor-or-admin-email> --write --publish
```

`POST /api/v1/admin/power-rankings/import` takes `{ data, mode: "PREVIEW" | "UPSERT", publish? }` -- never a filesystem path. PREVIEW validates everything (ranks, duplicate ranks/teams, team matching, cross-field checks) and writes nothing. UPSERT is one transaction: either the whole edition and every entry is written, or nothing is -- a single invalid entry rejects the entire import.

**Team matching.** Each ranking's `teamId` (e.g. `los-angeles-rams`) is treated as an import-time identifier/slug, never assumed to be a `Team` UUID. It's resolved in order: (1) an existing `Team` UUID if it happens to be one, (2) the entry's own `abbreviation`, (3) a normalized slug derived from `teamId` matched against `Team.fullName`/`Team.name`. Once matched, the entry's `team`/`abbreviation`/`conference`/`division` are cross-checked against the canonical `Team` row; any mismatch rejects that entry with a clear error rather than silently trusting the JSON or writing to `Team`. `Team` is never created, updated, or duplicated by this import.

## Audit

Every write emits an `AdminAuditEvent` (`entityType: 'POWER_RANKING'`): `POWER_RANKING_EDITION_CREATED`, `POWER_RANKING_EDITION_UPDATED`, `POWER_RANKING_ENTRY_UPDATED`, `POWER_RANKING_REORDERED`, `POWER_RANKING_BATCH_IMPORTED`, `POWER_RANKING_PUBLISHED`, `POWER_RANKING_UNPUBLISHED`, with before/after snapshots via the shared `sanitizeAuditSnapshot` helper.

## Editorial labeling

`asOf`, `methodology`, and `sources[]` are stored so the frontend can render "Independent editorial analysis by 2nd & 15." `sources` (e.g. DAZN, PFT / NBC Sports, Kalshi) are research-input provenance only -- no third-party article bodies or ranking text are scraped or reproduced, and no official NFL or team logo assets are used.
