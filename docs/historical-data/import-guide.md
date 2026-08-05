# Historical nflverse import guide

Milestone 15 imports the 2020-2025 nflverse player snapshot, weekly rosters, weekly player statistics, and the factual game identities needed to relate statistics to internal `Game.id` values. Normal HTTP requests read PostgreSQL only; they never contact GitHub or nflverse.

## Source and attribution

The core files come from the [`nflverse-data` GitHub releases](https://github.com/nflverse/nflverse-data) and are used under CC BY 4.0. nflverse contributors are the data collectors; 2nd & 15 is a downstream user. The committed manifest records source URLs, release keys, download timestamps, sizes, SHA-256 checksums, schema versions, and mapping versions.

Raw Parquet and CSV files live below `data/nflverse/` and are ignored by Git. Only manifests and human-readable review documentation are committed. Headshots remain untrusted external HTTP(S) metadata and are never downloaded or proxied.

## Safe workflow

```sh
npm run historical:download -- --dataset=players
npm run historical:download -- --dataset=weekly-rosters --seasons=2020-2025
npm run historical:download -- --dataset=player-stats --seasons=2020-2025
npm run historical:review -- --manifest=./data/nflverse/manifests/nflverse-2020-2025.json
npm run historical:import -- --manifest=./data/nflverse/manifests/nflverse-2020-2025.json --dry-run
npm run historical:import -- --manifest=./data/nflverse/manifests/nflverse-2020-2025.json --season=2020 --write
npm run historical:reconcile -- --seasons=2020-2025
```

`historical:import` is a dry run unless `--write` is explicit. `--season=YYYY` limits a full manifest to one season and includes the shared player snapshot unless `--skip-players` is supplied. `--max-growth-mb=500` is the default projected-growth ceiling and can be lowered for a particular environment.

The downloader accepts HTTPS files only from the nflverse-data GitHub release path, follows at most five redirects only to GitHub release-asset hosts, streams to a temporary file, enforces time and byte limits, and computes SHA-256. The review then checks the manifest size and checksum before parsing.

## Review and write behavior

The review gate records all Parquet columns and physical types, fails missing required or incompatible identity columns, and warns on unknown columns. Zod validates every selected source row. A write is refused on any review failure or when projected storage exceeds the configured threshold.

Writes use bounded 500-row transactions. Existing external identities and row hashes are prefetched per batch; unchanged rows are skipped, changed rows are updated, and new rows are bulk-created. A partial connection failure is resumable because completed batches are idempotent. A release-independent lease key and partial unique index prevent two active imports of the same dataset and season.

Player names are never identities. Canonical GSIS IDs are preferred, and other reviewed IDs live in `PlayerExternalIdentifier`. A roster-only player may be created only when at least one stable external ID is present. Name-only roster records and non-player aggregate stat rows are reported and skipped.

Historical games use `GameProviderMapping(provider = "nflverse")`. Matching uses the stable nflverse game ID or the reviewed season/type/week/home/away tuple and excludes development fixtures. The import never touches 2026, never creates postseason placeholders, and deliberately leaves historical kickoff times null rather than guessing from date/local-time fields.

## Corrections and summaries

`PlayerWeekRoster` and `PlayerGameStat` retain source-row hashes. Reimporting a corrected file updates only changed rows and keeps internal player/game UUIDs stable. Null profile values do not erase an existing non-null profile field. Missing statistics remain null; they are not converted to zero.

`PlayerSeasonStat` is derived from weekly rows with aggregation version `weekly-sum-v1`. It stores player-wide `REG`, `POST`, and `REG_POST` summaries so a traded player is counted once while `teamCount` preserves team context. Rebuilds create missing rows, update changed rows, retain unchanged rows, and remove stale summaries for the rebuilt season.

The reconciliation command compares additive regular-season totals against `stats_player_reg_YEAR.parquet`. These files are reconciliation inputs only and are not persisted as authoritative totals.

## Public API

- `GET /api/v1/players`
- `GET /api/v1/players/:playerId`
- `GET /api/v1/players/:playerId/stats`
- `GET /api/v1/players/:playerId/seasons`

List and weekly-stat endpoints use bounded cursor pagination. Public DTOs use internal UUIDs and page-level nflverse/CC BY 4.0 attribution. They omit provider IDs, source paths, checksums, raw rows, import actors, and conflict information.

See [the field mapping](field-mapping.md), [the 2025 pilot report](nflverse-player-stats-2025-pilot.md), and [the full review report](nflverse-player-stats-2020-2025.md).
