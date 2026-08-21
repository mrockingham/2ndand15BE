# Current-game provider coverage

Verified: August 21, 2026. The reviewed internal schedule contains 49 preseason games; Highlightly returned 46. Provider count is informational only and never controls internal schedule existence.

## Hosted Week 1

- Reviewed internal games: 16
- Provider matches: 13
- Provider missing: 3
- Final games applied: 13
- Remaining scheduled: 3
- Highlightly mappings created: 13
- `CurrentGameTeamStat` rows created: 26
- Ambiguous/failed/provider-only: 0/0/0

Matched finals (away at home, away-home score): GB@PIT 9-28; DET@CIN 14-16; IND@NE 13-13; TB@NYJ 24-16; MIA@WAS 7-20; DEN@ATL 27-7; CLE@CHI 10-34; MIN@NYG 13-10; CAR@BUF 14-29; LAR@KC 20-12; JAX@NO 24-20; PHI@BAL 7-24; DAL@SEA 17-7.

Missing-result fallback report:

| Internal UUID                          | Matchup   | Week | Kickoff (UTC)            | Stored status | Provider status |
| -------------------------------------- | --------- | ---: | ------------------------ | ------------- | --------------- |
| `11093a87-a885-4535-aca5-a762675a000b` | LAC @ HOU |    1 | 2026-08-14T00:00:00.000Z | SCHEDULED     | missing         |
| `6e63d621-c3ba-45a6-b5ed-70cf98f3923c` | ARI @ LV  |    1 | 2026-08-14T00:00:00.000Z | SCHEDULED     | missing         |
| `c967dc85-aaa9-4832-b28d-3fdb2adcd3d0` | TEN @ SF  |    1 | 2026-08-14T01:00:00.000Z | SCHEDULED     | missing         |

No result was inferred and no destructive action occurred for these rows.

## Hosted Week 2

- Reviewed internal games/provider matches: 16/16
- Current provider state at execution: 2 FINAL, 0 live, 14 SCHEDULED
- Final results: LV@HOU 22-20; SF@LAC 41-17
- Mappings created: 16
- `CurrentGameTeamStat` rows created: 4
- Ambiguous/failed/provider-only: 0/0/0

The 14 upcoming games retained `SCHEDULED`, null scores, and a null clock. Their only persistence changes were verified provider mappings and provider-update/audit metadata; reviewed schedule fields were preserved.

## Replay and performance

The exact second apply returned Week 1 `updated=0`, `unchanged=13`, `provider missing=3`; Week 2 returned `updated=0`, `unchanged=16`. All completed team-stat pairs were unchanged and produced no second write.

State-sync measurements (provider response / database / total): Week 1 first apply 346 / 2,707 / 3,056 ms; Week 2 first apply 295 / 2,826 / 3,125 ms. Replays were 452 / 791 / 1,246 ms and 339 / 847 / 1,187 ms. Team details used one request per completed game, separate from the single week schedule request.

The report contract now exposes adapter normalization as a separate duration from transport. The hosted runs above preceded that final timing split, so their provider-response number includes the sub-millisecond/millisecond normalization work rather than inventing a retrospective value. Team-detail reports separately expose provider/normalization, comparison, database-read, and database-write time.

## Public API and preservation verification

Local public HTTP requests backed by the hosted database verified:

- `GET /api/v1/games`: Week 1 returned 16 (13 final/3 scheduled); Week 2 returned 16 (2 final/14 scheduled).
- `GET /api/v1/games/:gameId`: GB@PIT returned `FINAL`, 9-28 with correct orientation.
- A representative upcoming CAR@JAX detail remained `SCHEDULED` with null scores and clock.
- `GET /api/v1/teams/:teamId/games` returned the updated team schedule.
- Pittsburgh Team Hub placed GB@PIT in `recent` and NYJ@PIT in `upcoming`.
- `GET /api/v1/games/:gameId/stats` returned both normalized team-stat sides.
- Combined response inspection found no `highlightly` or `providerGameId` value.

Post-apply counts were 2,024 games, 330 games in 2026, 16 reviewed Week 1 games, 16 reviewed Week 2 games, 1,988 provider mappings, and 32 current team-stat rows (the pre-existing Hall of Fame pair plus 30 new rows). Historical `PlayerGameStat` remained 112,316; `PlayerWeekRoster` 276,063; `Player` 25,766; current player stats/coverage both zero. There were no duplicate reviewed preseason schedule identities.

Quality gates: 407 tests passed and 39 environment-gated tests skipped; lint, strict TypeScript, formatting, build, Prisma validation, all 15 migration checks, and `git diff --check` passed. The dependency audit reports three high-severity `deepmerge-ts` findings through Prisma tooling; the offered automated fix is a breaking Prisma downgrade to 6.12.0, so no unsafe dependency mutation was made in this milestone.
