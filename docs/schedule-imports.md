# NFL schedule imports

Schedule imports are an internal administrative workflow. PostgreSQL remains the application source of truth; imports do not call provider APIs, fetch source URLs, create provider mappings, or download media.

## CSV format

Start from `data/import-templates/nfl-schedule.csv`. The header must match exactly:

```text
season,seasonType,week,startTime,awayTeam,homeTeam,status,venueName,venueCity,broadcastNetwork,isNeutralSite,sourceName,sourceType,sourceUrl,externalReference,notes
```

- Teams use canonical abbreviations. `WSH` maps to internal `WAS`, and `JAC` maps to `JAX`.
- `startTime` is ISO 8601 with `Z`/an explicit offset, or the literal `TBD`. Timestamps are stored in UTC; `TBD` stores a null kickoff and is returned publicly as `startTime: null`.
- `seasonType` is `PRE`, `REG`, or `POST`; status uses the normalized game-status enum.
- Empty optional cells become `null`. URLs are validated but never fetched.
- `sourceType` is `MANUAL_IMPORT`, `OFFICIAL_WEB`, or `DEVELOPMENT_FIXTURE`; fixture imports remain hidden unless fixture data is enabled.
- The parser rejects unknown or duplicate teams, equal home/away teams, duplicate rows, malformed quotes, spreadsheet formula prefixes in text fields, files over 1 MiB, rows over 16,384 characters, and imports over 500 games.

The committed row is fictional development data and is not an approved factual NFL schedule.

## Dataset review

Run aggregate review before a database dry run:

```sh
npm run schedule:review -- --file=./data/schedules/nfl-2026.csv
```

This command is deliberately database-free and does not import Prisma. It reports row/type/week/team counts, home and away counts, bye coverage, duplicates, unknown/alias teams, same-team and team-week conflicts, timestamps and offsets, stable external references, missing optional venue/broadcast values, neutral/international games, notes, warnings, and readiness blockers. A non-ready review exits unsuccessfully.

For the 2026 baseline, external references use `nfl-2026-{pre|reg}-wNN-away-home`, are independent of kickoff time, and use canonical internal abbreviations. NFL.com week pages are the primary row source; the official NFL international-games release supplies verified venue context. ESPN is secondary evidence only when checking ambiguity.

Official event timestamps are normalized to UTC with `Z`. They must represent a published kickoff, not a date-only placeholder. When no time is assigned, the literal `TBD` preserves the matchup without fabricating time; the review reports it as an unresolved warning. Daylight-saving offsets are checked on the event date, and international samples are reviewed against the official listed time. Optional venue or broadcast cells remain empty instead of being inferred.

As of August 2, 2026, the 2026 file contains 24 regular-season `TBD` kickoffs: four in Week 16, four in Week 17, and all 16 in Week 18. ESPN labels the same rows TBD and its `05:00Z` values are rejected date placeholders. The Hall of Fame Game is omitted because the current product has no documented separate preseason-week convention. The full file passed review/dry-run and was imported idempotently; see `docs/schedule-reviews/nfl-2026-review.md`.

## CLI workflow

Dry-run is the default and performs parsing, validation, team resolution, matching, duplicate checks, and projected counts without mutation:

```sh
npm run schedule:import -- --file=./data/import-templates/nfl-schedule.csv --dry-run
```

A write requires the explicit `--write` flag:

```sh
npm run schedule:import -- --file=./data/import-templates/nfl-schedule.csv --write
```

The summary reports received, created, updated, skipped, warning, and failed counts. Any row failure prevents all import writes. Repeating the same import preserves internal game IDs and skips matching values. Provider-backed matches retain their mappings and base records; schedule differences become editorial overrides.

Matching uses source name plus external reference first, then season, season type, home team, away team, and kickoff within six hours. Omitted games are never deleted.

After a baseline reaches `readyForImport: true`, run the dry-run command against that same file, review every projected create/update/skip/warning/failure, and only then use `--write`. Repeat the exact write to confirm stable internal IDs and no duplicate provenance. Imports remain unverified because the CLI has no legitimate human verifying actor; an editor verifies rows after review through the administrative workflow.
