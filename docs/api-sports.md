# API-Sports NFL integration

## Boundary and endpoints

The `api-sports` adapter implements `SportsDataProvider`. It uses API-Sports' NFL v1 service at `https://v1.american-football.api-sports.io` by default and sends the credential only in the `x-apisports-key` request header.

API-Sports advertises an NFL standings endpoint and a 2024 real response was validated, but the configured plan rejects 2025-2026 and the response does not identify preseason. M40A standings ingestion therefore uses the already-evaluated Highlightly integration; public reads remain provider-neutral and PostgreSQL-only. See `docs/standings.md`.

One team synchronization calls `GET /teams?league=1&season=<season>`. One game synchronization calls `GET /games?league=1&season=<season>`. Supported provider lookups may also send `team`, `date`, or `id`. Public HTTP handlers never call API-Sports; they read normalized PostgreSQL records.

The response envelope, error collection, result count, paging, teams, games, league/season, dates, venues, statuses, and scores are validated with Zod. Malformed records and unknown statuses are excluded and included in safe synchronization summaries. Provider response bodies and credentials are never returned by public endpoints.

## Configuration

`SPORTS_PROVIDER` defaults to `mock`. Select the live adapter explicitly with `SPORTS_PROVIDER=api-sports` and configure `SPORTS_API`. `API_SPORTS_KEY` is accepted as a compatibility alias, but `SPORTS_API` is the canonical name used by this project.

Other settings are:

- `API_SPORTS_BASE_URL`
- `API_SPORTS_REQUEST_TIMEOUT_MS`
- `API_SPORTS_MAX_RETRIES` (zero through five retries)
- `API_SPORTS_SYNC_SEASON`
- `API_SPORTS_SYNC_SEASON_TYPE` (`ALL`, `PRE`, `REG`, or `POST`)
- `API_SPORTS_STORE_LOGO_URLS` (defaults to `false`)

API-Sports may return a successful HTTP status with a non-empty provider error object when a plan cannot access a season or quota is exhausted. The adapter treats that as a failed provider operation, not an empty successful synchronization.

## Status mapping

| API-Sports                              | Normalized status |
| --------------------------------------- | ----------------- |
| `NS`, `TBD`                             | `SCHEDULED`       |
| `PREG`                                  | `PREGAME`         |
| `Q1`, `Q2`, `Q3`, `Q4`, `OT`, `BT`, `P` | `IN_PROGRESS`     |
| `HT`                                    | `HALFTIME`        |
| `FT`, `AOT`                             | `FINAL`           |
| `POST`                                  | `POSTPONED`       |
| `CANC`                                  | `CANCELED`        |
| `SUSP`, `INT`                           | `SUSPENDED`       |

An unlisted status is not guessed. Its game is skipped and reported as a record failure. API-Sports does not supply broadcast network, a reliable provider-update timestamp, or a neutral-site flag in the games response used here; broadcast and update time remain null, while the existing non-null normalized neutral-site field uses the documented `false` fallback.

During the August 1, 2026 hosted verification, 16 records in the accessible 2024 season had an empty `status.short`; they were rejected as malformed rather than assigned a guessed state. The configured plan returned a plan-access error for 2025 and no records for 2026. A non-empty provider error collection is always treated as a failed operation rather than an empty successful result.

## Synchronization and matching

```sh
npm run sports:sync:teams
npm run sports:sync:games
npm run sports:sync
```

Append `-- --dry-run` to calculate a summary without database writes. A team synchronization deterministically matches the existing catalog by an existing API-Sports mapping, then abbreviation, then normalized full name. In API-Sports mode it does not create teams or replace approved local display fields; it adds or updates provider mappings. Ambiguous and unresolved teams are reported.

Games resolve both provider team IDs through `TeamProviderMapping`, preserve internal game IDs, and upsert through `GameProviderMapping`. Repeating a synchronization skips unchanged records and updates mutable fields. Missing mappings fail only the affected records. No synchronization deletes records omitted by a provider response.

A normal team run uses one provider request, a normal game run uses one, and a combined run uses two. Transient HTTP/network/timeout failures can consume up to `1 + API_SPORTS_MAX_RETRIES` calls per endpoint. HTTP 429 honors `Retry-After` up to 30 seconds. Avoid running duplicate commands concurrently.

## Fixture separation and recovery

The mock fixture remains development data with provider key `mock`; real records use `api-sports`. When the server runs with `SPORTS_PROVIDER=api-sports`, public game reads require an `api-sports` game mapping, so fictional mock games are not silently mixed into production-like responses. With `SPORTS_PROVIDER=mock`, fixture games remain hidden unless `FIXTURE_DATA_ENABLED=true`. Records are retained rather than destructively cleared.

All unseasoned game queries are constrained to `CURRENT_NFL_SEASON` unless the non-production historical-default override is explicitly enabled. API-Sports 2024 records therefore remain available through `?season=2024` but cannot appear as current 2026 data.

Provider and database failures are recoverable by correcting configuration or missing team mappings and rerunning the same idempotent command. Review the structured summary before retrying. Do not delete either provider's mappings merely to force a refresh.

## Safe live verification

The opt-in verification makes exactly two read-only provider calls and never writes to PostgreSQL:

```powershell
$env:RUN_API_SPORTS_LIVE_VERIFY = 'true'
npm.cmd run sports:verify:live
Remove-Item Env:RUN_API_SPORTS_LIVE_VERIFY
```

It reports only record counts and failure counts. It is not part of the default test suite or CI. Scheduling, queues, live polling, WebSockets, and play-by-play remain deferred.
