# NFL standings

`GET /api/v1/standings` is a public, database-only endpoint over the latest ingested normalized standings snapshot. It never calls a provider during a public request and never returns provider team IDs or raw provider rows.

## Query

`season` and `seasonType` are required. `seasonType` accepts `PRE`, `REG`, or `POST`, but the current Highlightly source publishes only preseason and regular-season standings; a missing combination returns `404 STANDINGS_NOT_FOUND`. `view` defaults to `division` and also accepts `conference` or `league`. Optional `conference` (`AFC`/`NFC`), `division` (`East`/`North`/`South`/`West`), and internal `teamId` filters can be combined.

Division view returns AFC/NFC groups with division children. Conference view returns AFC/NFC groups with teams directly. League view returns one `NFL` group. Conference and division views preserve the provider's official conference order. League view sorts by win percentage, wins, point differential, then stable provider order because the provider does not publish an official cross-conference rank.

The response `meta` includes the views, stored season types for the requested year, source key, and snapshot update time. Public responses cache for five minutes.

## Fields and limitations

Highlightly safely supplies W/L/T/PCT, home/road/division/conference records, PF/PA/differential, streak, playoff seed, and conference row order. `conferenceRank` reflects that provider order and `playoffSeed` preserves a positive provider seed (provider zero placeholders become null). The provider does not supply an official division rank or league rank, non-conference record, last-five form, clinch code, or eliminated flag, so those fields are returned as `null`. Missing provider statistics remain `null`, never inferred as zero.

The feed can return more than one same-season/type conference snapshot. Ingestion selects the provider snapshot with the greatest total recorded-games coverage for each conference; equal coverage selects the later provider result. A write requires exactly 32 unique teams and exact provider-ID mappings or an exact active internal team abbreviation/conference match. The latter creates the durable `TeamProviderMapping`; names are never used as identity.

The provider's documented Washington abbreviation `WSH` is normalized to this application's canonical `WAS` abbreviation before mapping. No other fuzzy alias or name matching is used.

## Ingestion

The command is dry-run by default:

```bash
npm run standings:sync -- --season=2026 --seasonType=PRE
npm run standings:sync -- --season=2026 --seasonType=PRE --write
```

Writes replace one complete provider/season/type snapshot transactionally and are idempotent. They never derive standings from games. `POST` is rejected because postseason standings are not supplied by the current provider.

## Real-data review (August 28, 2026)

Highlightly returned six 2026 NFL groups: duplicate AFC/NFC preseason snapshots plus AFC/NFC regular-season shells. The completion rule selected the populated preseason snapshot and produced 32 unique teams. The 2025 response returned AFC/NFC preseason and regular-season groups with 32 teams per season type. The additive migration was deployed and complete 2026 PRE and 2025 REG snapshots were stored with 32 rows each. An exact replay reused the 2026 snapshot ID and retained 32 rows. Division view returned two conferences, four four-team divisions per conference; conference view returned 16 teams per conference; league view returned 32 teams. AFC East returned BUF, NYJ, NE, and MIA with W/L/T/PCT/PF/PA/differential populated. API-Sports independently advertised standings and returned a valid 2024 regular-season sample, but the configured plan rejected 2025 and 2026 and its payload did not identify preseason; it is therefore not the M40A ingestion source.
