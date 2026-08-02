# NFL schedule imports

Schedule imports are an internal administrative workflow. PostgreSQL remains the application source of truth; imports do not call provider APIs, fetch source URLs, create provider mappings, or download media.

## CSV format

Start from `data/import-templates/nfl-schedule.csv`. The header must match exactly:

```text
season,seasonType,week,startTime,awayTeam,homeTeam,status,venueName,venueCity,broadcastNetwork,isNeutralSite,sourceName,sourceType,sourceUrl,externalReference,notes
```

- Teams use canonical abbreviations. `WSH` maps to internal `WAS`, and `JAC` maps to `JAX`.
- `startTime` must be ISO 8601 with `Z` or an explicit offset and is stored in UTC.
- `seasonType` is `PRE`, `REG`, or `POST`; status uses the normalized game-status enum.
- Empty optional cells become `null`. URLs are validated but never fetched.
- `sourceType` is `MANUAL_IMPORT`, `OFFICIAL_WEB`, or `DEVELOPMENT_FIXTURE`; fixture imports remain hidden unless fixture data is enabled.
- The parser rejects unknown or duplicate teams, equal home/away teams, duplicate rows, malformed quotes, spreadsheet formula prefixes in text fields, files over 1 MiB, rows over 16,384 characters, and imports over 500 games.

The committed row is fictional development data and is not an approved factual NFL schedule.

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
