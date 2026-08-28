# M38A: live player box scores and poller recovery

Date: August 27–28, 2026 (America/New_York)

## Poller recovery

The August 27 missed-game root cause had two parts. Broad discovery admitted `SCHEDULED` and
`PREGAME` games only when `startTime >= now`, so a worker starting after kickoff could not ask the
provider to correct the stale internal status. Explicit `--gameId` then filtered that already
incomplete discovery result, so it could not recover the game either.

Broad discovery now includes a conservative four-hour recent-past window for
`SCHEDULED`/`PREGAME` games. Explicit `--gameId` uses an unwindowed internal-game lookup, requires
the verified Highlightly mapping, creates the normal durable poll state, and uses a conditional
recovery claim that ignores only `nextPollAt` due-ness. It still respects the same provider
execution/publication policy and unexpired DB lease as broad polling. Unknown and unmapped games
fail loudly without a provider request.

## Real Highlightly audit

The read-only command below selects recent stored 2026 games through internal mappings and uses
the production match and box-score clients/schemas. It never prints provider IDs, raw payloads, or
credentials.

```bash
npm run current-games:box-score-audit -- --hours=24 --limit=2
```

At 2026-08-28T01:48:52Z, two real live games were available. The audit made four physical
requests total: exactly one `/matches/{id}` and one `/box-score/{id}` per game.

| Game   | State       | Teams | Player rows | IDs | Names | Existing mappings | Unresolved |
| ------ | ----------- | ----: | ----------: | --: | ----: | ----------------: | ---------: |
| NE@CLE | HALFTIME    |     2 |          57 |  57 |    57 |                46 |         11 |
| SF@LV  | IN_PROGRESS |     2 |          70 |  70 |    70 |                39 |         31 |

Every requested supported field was present on each player row belonging to its category:

| Category  | NE@CLE rows | SF@LV rows | Supported fields observed                                     |
| --------- | ----------: | ---------: | ------------------------------------------------------------- |
| Passing   |           3 |          4 | completions, attempts, yards, TD, interceptions, sacks        |
| Rushing   |          10 |         10 | attempts, yards, TD, long                                     |
| Receiving |          16 |         17 | targets, receptions, yards, TD, long                          |
| Defense   |          34 |         42 | total/solo tackles, sacks, TFL, passes defended, defensive TD |
| Kicking   |           2 |          2 | FG made/attempted/long, XP made/attempted                     |
| Punting   |           1 |          2 | punts, yards, average, inside 20, touchbacks, long            |
| Returns   |           5 |          4 | KR and PR attempts/yards/TD/long where applicable             |

Both live responses passed schema and value normalization with no malformed values. Highlightly
also supplied eleven non-authoritative/derived fields that this contract deliberately ignores:
quarterback rating, field-goal percentage, interception variants/yards, total kicking points,
yards-per-pass/rush/reception, and yards-per-kick/punt-return. They are reported by the audit as
unexpected names but are not persisted or exposed.

This sample proves that box scores are populated during LIVE/HALFTIME. The two snapshots were not
captured as a controlled before/after pair, so M38A does not claim a measured refresh latency or a
specific value changed between polls. Prior FINAL Hall of Fame evidence remains 82 normalized
rows with all seven categories. Tonight's games had not reached FINAL during the audit, so their
own final completeness remains pending the existing final reconciliation passes.

## Live ingestion

Player stats use a narrow box-score fetcher and the already-fetched match detail for game/team
identity. A due refresh therefore adds exactly one box-score request and never adds a second match
request. The default independent cadence is:

- `SCHEDULED`/`PREGAME`: no box score;
- `IN_PROGRESS`: every 120 seconds, including featured games (configurable from 60–600 seconds);
- `HALFTIME`: once per halftime game tick (default 180 seconds);
- `FINAL`: immediate, +10 minute, and +60 minute reconciliation stages.

The durable `CurrentGamePlayerStatCoverage.sourceUpdatedAt` is the cadence clock, so restarts do
not reset it. Recurring live polling performs one batch lookup of existing
`PlayerExternalIdentifier` rows. It makes zero `/players/{id}` calls, creates no player or mapping,
and does no name matching. Unmapped/conflicting provider rows remain unresolved and absent from
public arrays. Existing `CurrentGamePlayerStat` and coverage writes retain provider provenance and
source time. Missing fields remain null; explicit provider zeroes remain zero.

An explicit production-safe tick for NE@CLE was claimed successfully and used three requests
(state, match/PBP, box score). It received 57 player rows, persisted 46 exactly mapped rows,
recorded 11 unresolved rows, and classified coverage `PARTIAL`. A read-back found the same 46
stored rows and 57/46/11 coverage. The public DTO produced all supported categories where resolved,
plus a passer/rusher/receiver leader for both teams. Team-stat coverage remained `COMPLETE`. The
pre-existing live-play reconciliation correctly blocked a shrinking/divergent snapshot instead of
deleting stored plays; this is unrelated to the player-stat write and preserves the M27 safety rule.

## Public contract

`GET /api/v1/games/:gameId/stats` remains the only current-game box-score endpoint. It adds:

- `data.gameLeaders.home|away.passer|rusher|receiver`, selected deterministically by yards, then
  touchdowns, then the category volume field, with internal player ID as the stable tie-breaker;
- `meta.playerStatsCoverageState`: `COMPLETE`, `PARTIAL`, `PENDING`, or `UNAVAILABLE`.

Existing categorized player arrays are unchanged and continue to expose only internal player
identity. No provider IDs, provider names, source timestamps, or reconciliation evidence are public.

## Game Center coverage

| Capability                      | Coverage | Evidence/boundary                                                            |
| ------------------------------- | -------- | ---------------------------------------------------------------------------- |
| Score                           | YES      | public Game DTO                                                              |
| Quarter/clock                   | YES      | public Game DTO                                                              |
| Possession                      | PARTIAL  | nullable per structured play; no authoritative game-level current possession |
| Down/distance                   | PARTIAL  | nullable structured play start/end fields                                    |
| Ball location                   | PARTIAL  | nullable normalized structured play yard line                                |
| Current drive                   | NO       | provider supplies no drive ID/boundary                                       |
| Drive play count/yards/duration | NO       | unsafe without unambiguous drive boundaries                                  |
| Drives tab                      | NO       | no reliable grouping key; M38A does not infer one                            |
| Scoring plays                   | YES      | structured plays expose deterministic `isScoringPlay`                        |
| PBP/latest play                 | YES      | ordered public structured plays; latest is the final returned row            |
| Team stats                      | YES      | per-game home/away rows with coverage                                        |
| Player stats                    | PARTIAL  | complete provider categories, but only safely mapped identities are public   |
| Game leaders                    | YES      | backend-composed from authoritative stored player rows                       |
| Period scoring                  | YES      | Q1–Q4 and nullable OT1/OT2                                                   |
| Venue                           | YES      | public normalized nullable venue                                             |
| Broadcast                       | YES      | public normalized nullable network                                           |
| Weather                         | NO       | no supported stored/provider contract                                        |
| Injuries                        | NO       | no supported stored/provider contract                                        |
| Win probability                 | NO       | Highlightly supplies no supported probability and no local model exists      |

PBP-derived player totals remain an assessment only. Penalties, no-plays, corrections, laterals,
tackle credit, and special teams make them unsuitable as an authoritative fallback in this
milestone. Provider box score remains first; unavailable remains unavailable.

## Request budget

Configured cadence is 120 seconds for normal live state/match ticks, 60 seconds for featured live
state/match ticks, and 120 seconds for player box scores. Highlightly Pro is documented as 7,500
requests/day.

| Concurrent live games | Normal state/h | Normal match/h | Box/h | Normal total/h | Featured total/h |
| --------------------: | -------------: | -------------: | ----: | -------------: | ---------------: |
|                     1 |             30 |             30 |    30 |             90 |              150 |
|                     4 |            120 |            120 |   120 |            360 |              600 |
|                     8 |            240 |            240 |   240 |            720 |            1,200 |
|                    16 |            480 |            480 |   480 |          1,440 |            2,400 |

Featured totals use 60 state + 60 match + 30 box requests per game/hour. A full 16-game hour at
featured cadence consumes 32% of the daily plan, so it is safe as a short peak but not sustainable
for several hours. The existing remaining-quota threshold (500) continues to suppress normal live,
pregame, and halftime work first. The 120-second box cadence avoids the additional 960 requests
that 16 featured games would consume if box scores followed the 60-second featured cadence.

## Production configuration

Add `CURRENT_GAME_PLAYER_STATS_POLL_SECONDS=120` to the Render worker. The default is also 120, so
deployment is behaviorally correct if omitted, but setting it explicitly makes the request budget
auditable. No migration is required. Deploy the same build to the worker and web service because
the worker writes the new data while the web service exposes the coverage state and leaders contract.
