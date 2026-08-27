# NFL 2026 schedule dataset review

Reviewed: August 2, 2026

Import status: **Imported and idempotency-verified**

## Sources and method

Primary sources were the official NFL schedule pages for preseason Weeks 1-3 and regular-season Weeks 1-18:

- `https://www.nfl.com/schedules/2026/by-week/preseason-week-1` (and Weeks 2-3)
- `https://www.nfl.com/schedules/2026/by-week/week-1` (and Weeks 2-18)
- `https://www.nfl.com/news/2026-nfl-preseason-complete-team-by-team-opponents`
- `https://operations.nfl.com/media/urolxkdj/05-14-26-preseason-schedule.pdf`
- `https://www.nfl.com/news/2026-nfl-schedule-release-nine-international-games-dates-times-matchups`

The bounded one-time extraction retained only factual game fields from official pages. Team/logo media, article text, and unrelated material were not copied. ESPN schedule/scoreboard data was used only as a secondary check for unresolved Weeks 16-18 kickoffs. It labels the same 24 games `TBD`; its `05:00Z` date values were rejected as non-kickoff placeholders.

## Dataset totals

| Scope                                | Rows |
| ------------------------------------ | ---: |
| All represented games                |  321 |
| Preseason                            |   49 |
| Regular season                       |  272 |
| Explicitly represented TBD kickoffs  |   24 |
| Hall of Fame Game (`PRE`, null week) |    1 |

Preseason Weeks 1-3 each contain 16 games. The Hall of Fame Game is represented separately as `PRE` with `week = null`. NFL.com's Game Center identifies the source event as `PRE 0`, but the established hosted `games_week_check` permits only weeks 1-22 or null; the milestone's preference order therefore selects null without a schema migration. Carolina is away and Arizona is home, following the NFL schedule and its explicit Arizona home-team designation. The Canton venue is neutral; home/away is not inferred from the venue.

The reviewed static identity is Carolina at Arizona on August 6, 2026 at 8:00 p.m. ET (`2026-08-07T00:00:00Z`), at Tom Benson Hall of Fame Stadium in Canton, Ohio, on NBC. Its initial stored state is `SCHEDULED` with null scores. Results and current-game state remain a separate provider-update concern.

Regular-season counts:

| Week | Games | Week | Games | Week | Games |
| ---: | ----: | ---: | ----: | ---: | ----: |
|    1 |    16 |    7 |    14 |   13 |    14 |
|    2 |    16 |    8 |    14 |   14 |    15 |
|    3 |    16 |    9 |    15 |   15 |    16 |
|    4 |    16 |   10 |    14 |   16 |    16 |
|    5 |    15 |   11 |    13 |   17 |    16 |
|    6 |    14 |   12 |    16 |   18 |    16 |

All 32 canonical teams appear, each has exactly 17 regular-season games and one bye, and no team appears twice in a regular-season week.

| Team | Bye | Team | Bye | Team | Bye | Team | Bye |
| ---- | --: | ---- | --: | ---- | --: | ---- | --: |
| ARI  |  14 | ATL  |  11 | BAL  |  13 | BUF  |   7 |
| CAR  |   5 | CHI  |  10 | CIN  |   6 | CLE  |  11 |
| DAL  |  14 | DEN  |  10 | DET  |   6 | GB   |  11 |
| HOU  |   8 | IND  |  13 | JAX  |   7 | KC   |   5 |
| LAC  |   7 | LAR  |  11 | LV   |  13 | MIA  |   6 |
| MIN  |   6 | NE   |  11 | NO   |   8 | NYG  |   8 |
| NYJ  |  13 | PHI  |  10 | PIT  |   9 | SEA  |  11 |
| SF   |   8 | TB   |  10 | TEN  |   9 | WAS  |   7 |

## Aggregate validation

- Exact CSV header and row schema: pass
- Canonical team resolution, including `WAS`, `JAX`, `LAR`, `LAC`, `LV`, `TB`, `SF`, `KC`, `NE`, `NO`, and `GB`: pass
- Unknown teams: 0
- Same-team games: 0
- Duplicate schedule identities: 0
- Duplicate external references: 0
- Unstable external references: 0
- Team twice in a regular-season week: 0
- Invalid timestamps: 0
- Invalid/missing offsets among concrete timestamps: 0
- Explicit TBD kickoffs: 24
- Required-field omissions: 0
- Rows lacking a confidently verified venue name or city: 311
- Rows lacking a confirmed broadcast network: 49
- Rows with review notes: 33

Optional venues are blank unless confidently verified. Network labels are normalized to `CBS`, `FOX`, `NBC`, `ESPN`, `NFL Network`, `Prime Video`, and `Netflix` where listed.

## International and neutral-site review

Nine official international games are marked `isNeutralSite=true` with verified venue context:

| Week | Matchup    | Venue / city                                    | UTC kickoff       |
| ---: | ---------- | ----------------------------------------------- | ----------------- |
|    1 | SF at LAR  | Melbourne Cricket Ground - Melbourne, Australia | 2026-09-11 00:35Z |
|    3 | BAL at DAL | Maracana Stadium - Rio de Janeiro, Brazil       | 2026-09-27 20:25Z |
|    4 | IND at WAS | Tottenham Hotspur Stadium - London, England     | 2026-10-04 13:30Z |
|    5 | PHI at JAX | Tottenham Hotspur Stadium - London, England     | 2026-10-11 13:30Z |
|    6 | HOU at JAX | Wembley Stadium - London, England               | 2026-10-18 13:30Z |
|    7 | PIT at NO  | Stade de France - Paris, France                 | 2026-10-25 13:30Z |
|    9 | CIN at ATL | Bernabeu Stadium - Madrid, Spain                | 2026-11-08 14:30Z |
|   10 | NE at DET  | FC Bayern Munich Stadium - Munich, Germany      | 2026-11-15 14:30Z |
|   11 | MIN at SF  | Estadio Banorte - Mexico City, Mexico           | 2026-11-23 01:20Z |

The Week 7 versus Week 9 European samples confirm the expected daylight-saving transition rather than applying one fixed offset to the season.

## TBD workflow and discrepancies

NFL.com publishes matchups but no kickoff timestamp for:

- Week 16: TB-ATL, CIN-IND, WAS-MIN, CAR-PIT
- Week 17: WAS-JAX, KC-LAC, DEN-NE, LAR-TB
- Week 18: SF-ARI, PIT-BAL, NYJ-BUF, ATL-CAR, CLE-CIN, LAC-DEN, DET-GB, TEN-HOU, JAX-IND, LV-KC, SEA-LAR, CHI-MIN, MIA-NE, TB-NO, PHI-NYG, DAL-WAS

ESPN agrees that all 24 are TBD. These rows use CSV `TBD`, nullable PostgreSQL `Game.startTime`, and public `startTime: null`. They retain week/team identity, official provenance, stable external reference, and a review note so an editor can assign and verify the kickoff later. No source disagreement affects team identity or any concrete kickoff.

The explicit-TBD policy preserves the 24 unresolved kickoffs. Milestone 22A resolved the former Hall of Fame omission through the explicit null-week convention without adding a season type or changing the Prisma schema.

## Import and hosted database results

- Dry run: `received=320`, `created=320`, `updated=0`, `skipped=0`, `warnings=0`, `failed=0`
- First write: `received=320`, `created=320`, `updated=0`, `skipped=0`, `warnings=0`, `failed=0`
- Identical second write: `received=320`, `created=0`, `updated=0`, `skipped=320`, `warnings=0`, `failed=0`
- Stable official-reference/game-ID digest after both writes: `7ad09eda0cc863204e8e780f3fa0b5664a64d1736aea5e3467a8b457b613e1cd`

The figures above are the original Milestone 11 baseline import. Milestone 22A subsequently added the one reviewed Hall of Fame row through the same importer; its hosted dry-run/write/idempotency results are recorded below after verification.

### Milestone 22A Hall of Fame addendum

- Before: 2,023 total games; 329 games in 2026; no 2026 CAR/ARI game
- Bounded dry run: `received=1`, `created=1`, `updated=0`, `skipped=0`, `warnings=0`, `failed=0`
- First write: `received=1`, `created=1`, `updated=0`, `skipped=0`, `warnings=0`, `failed=0`
- Identical second write: `received=1`, `created=0`, `updated=0`, `skipped=1`, `warnings=0`, `failed=0`
- After: 2,024 total games; 330 games in 2026; exactly one 2026 preseason CAR/ARI game
- Internal game ID: `0768c441-16a6-457c-b50f-e7273d750d77`
- Provider mappings remained 1,958; no provider identity was invented
- Team, historical player/stat, article, and news-candidate counts were unchanged

All six public verification reads returned HTTP 200. Game detail, the preseason listing, both team-game listings, and both Team Hubs contained the internal game exactly once. The public DTO preserved `week: null`, `SCHEDULED`, null scores, Arizona home, Carolina away, the Canton venue, NBC, and `isNeutralSite: true` without exposing provenance or provider identifiers.

Sanitized preservation counts:

| Record type                   | Before | After |
| ----------------------------- | -----: | ----: |
| Teams                         |     32 |    32 |
| Team provider mappings        |     64 |    64 |
| Game provider mappings        |    265 |   265 |
| Editorial overrides           |      0 |     0 |
| Users                         |      1 |     1 |
| Refresh sessions              |      3 |     3 |
| Articles                      |      0 |     0 |
| Article revisions             |      0 |     0 |
| Fictional 2099 games          |      1 |     1 |
| Official 2026 provenance rows |      0 |   320 |
| Verified 2026 provenance rows |      0 |     0 |

Total games increased from 266 to 586 and provenance rows from 266 to 586, exactly matching the 320 imported rows. Audit events increased from 4 to 326: 320 create events and one import-summary event for each of the two writes. The no-op second write did not create per-game audits. Imported rows remain unverified pending legitimate human review.

## API smoke results

- `GET /api/v1/games?season=2026&limit=100`: 100 rows and a non-null next cursor
- `GET /api/v1/games?season=2026&seasonType=REG&week=1`: 16 rows
- `GET /api/v1/games?season=2026&seasonType=REG&week=18`: 16 rows, all with `startTime: null`
- `GET /api/v1/teams/:teamId/games?season=2026`: 20 rows for the sampled team (3 preseason + 17 regular season)
- Default current-season/upcoming query: 16 rows; fictional fixtures remain hidden
- Explicit 2024 query: HTTP 200 and an empty page under the configured mock/fixture-disabled source policy
- Unauthenticated admin game query: HTTP 401
- Public payload scan: no provider mappings/IDs, provenance, audit, or external-reference fields

## Reviewer checklist

- [x] Official NFL week pages used as primary source
- [x] ESPN used only to cross-check unresolved timestamps
- [x] Exact importer header and schema validated
- [x] Concrete timestamps use UTC / explicit offsets
- [x] Canonical teams, aliases, identities, and team-week conflicts reviewed
- [x] International games and DST samples reviewed
- [x] Optional unknown venue/broadcast values left null
- [x] Hall of Fame Game represented as `PRE` with a null week
- [x] Fictional 2099 fixture isolation documented and preserved
- [x] Explicitly represent 24 official TBD kickoffs without fake times
- [x] Reach 272 regular-season games and one bye / 17 games per team
- [x] Run complete database dry run (0 warnings / failures)
- [x] Run first write and identical idempotency write
- [x] Verify public API privacy/pagination and database preservation counts
- [ ] Verify imported games through a legitimate human editor/admin actor
