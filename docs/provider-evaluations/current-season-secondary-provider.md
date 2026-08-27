# Current-season secondary-provider evaluation

Test date: August 21, 2026

Status: evaluation complete; no provider integration approved; no hosted writes

## Decision

Recommendation: **F — continue evaluation** and make **no provider change** yet.

Highlightly remains the temporary primary current-game enrichment source. TheSportsDB is the only newly tested service that returned all three omitted Week 1 results with exact identity, orientation, kickoff, status, and score. It returned no team statistics, player game results, lineup, or timeline for any of those games. It therefore cannot close the statistical gap that motivated this review.

Current-season aggregate team rankings remain unsafe. The safe product boundary is still per-game statistics where a complete normalized pair exists. A future trial should test Tank01 first for the three missing box scores, followed by MySportsFeeds if Tank01's data or rights are insufficient. Neither should enter the provider factory without a separate approval.

## Safety and evidence levels

This evaluation was read-only. It made documented external GET requests and inspected existing local contracts and sanitized reports. It did not connect a new provider to production code, create mappings, update games or stats, reconcile players, add a migration, or alter provider precedence.

Evidence labels used below:

- `DIRECT`: an API response for the exact 2026 game was inspected.
- `EXISTING`: previously sanitized Highlightly/API-Sports evidence or hosted normalized data was inspected.
- `DOCUMENTED`: current first-party documentation describes the capability, but the exact games were not callable without a subscription/key.
- `UNTESTED`: neither exact-game data nor a sufficiently specific contract was available.
- `RIGHTS_UNCLEAR`: public terms do not clearly authorize the required commercial storage/display behavior.

No candidate is credited with actual 2026 coverage based only on a marketing page.

## Existing architecture reviewed

The application already has the correct provider-neutral seams:

- `SportsDataProvider` returns normalized teams and games.
- `CurrentGameProvider` performs bounded current-season game discovery.
- `CurrentGameDetailsProvider` returns a home/away team-stat pair, period scores, optional player rows, and neutral coverage counts.
- `CurrentPlayerIdentityProvider` returns stable provider player IDs plus profile evidence.
- `NormalizedGame` validates season type, status, paired score nullability, provider-owned identities, kickoff, orientation, and mutable state.
- `GameProviderMapping`, `TeamProviderMapping`, and `PlayerExternalIdentifier` keep provider IDs private.
- `CurrentGameTeamStat` and `CurrentGamePlayerStat` store typed normalized values with source provenance and preserve null separately from recorded zero.
- The current sync accepts one existing internal `Game.id`, matches mapping-first or by reviewed identity, is dry-run capable, and never creates a game.
- The reviewed internal schedule remains identity/kickoff authority. Reversed orientation, ambiguity, mapping collision, or incomplete final scores fail closed.

The production `SportsDataProvider` factory still contains only `mock` and `api-sports`. Highlightly remains an explicit evaluation/current-game path with a production publication gate. No candidate-specific schema should leak across these boundaries.

## Candidate summary

| Provider      | Classification                        | Exact 2026 test | Price class                               | Main conclusion                                                                                            |
| ------------- | ------------------------------------- | --------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Highlightly   | `PRIMARY_CANDIDATE`                   | `EXISTING`      | FREE to $10–25                            | Best current MVP fit, but omitted 3/16 Week 1 games and has weak textual PBP.                              |
| API-Sports    | `REJECT` for configured account       | `EXISTING`      | FREE to $10–25                            | Current docs advertise NFL coverage, but repeated configured 2026 evaluations returned no validated games. |
| TheSportsDB   | `FALLBACK_CANDIDATE` for results only | `DIRECT`        | FREE / < $10                              | Exact results work; exact team/player/PBP detail is absent.                                                |
| Tank01        | `EVALUATION_ONLY`                     | `UNTESTED`      | FREE to $10–25                            | Most promising affordable next box-score/PBP trial; rights and exact-game fields must be verified.         |
| MySportsFeeds | `EVALUATION_ONLY`                     | `UNTESTED`      | $25–50 minimum, likely higher with addons | Broad documented feeds; exact 2026 coverage, addon price, and API-data license need confirmation.          |
| SportsDataIO  | `SPECIALIZED_CANDIDATE`               | `UNTESTED`      | $100+                                     | Excellent documented structure; real commercial live data is sales-contract only and not MVP-priced.       |
| Sportradar    | `SPECIALIZED_CANDIDATE`               | `UNTESTED`      | $100+                                     | Strongest documented PBP/correction model; enterprise contract and implementation overhead.                |

## Exact missing Week 1 games

TheSportsDB's documented v1 free endpoint was queried with league `4391` and season `2026`. Its free season response is capped at 15 records, so this does not prove complete-season schedule coverage. It did contain all three target games:

| Internal matchup | Provider event | Provider orientation | Kickoff UTC            | Status | Provider score | Expected      | Identity result |
| ---------------- | -------------- | -------------------- | ---------------------- | ------ | -------------- | ------------- | --------------- |
| LAC @ HOU        | `2475340`      | HOU home / LAC away  | `2026-08-14T00:00:00Z` | `FT`   | HOU 7, LAC 27  | HOU 7, LAC 27 | Exact           |
| ARI @ LV         | `2480385`      | LV home / ARI away   | `2026-08-14T00:00:00Z` | `FT`   | LV 14, ARI 27  | LV 14, ARI 27 | Exact           |
| TEN @ SF         | `2480386`      | SF home / TEN away   | `2026-08-14T01:00:00Z` | `FT`   | SF 13, TEN 19  | SF 13, TEN 19 | Exact           |

For every event, the documented event-statistics, event-results, lineup, and timeline endpoints returned a null collection:

| Matchup   | Team stats | Player game data | Lineup | PBP/timeline |
| --------- | ---------- | ---------------- | ------ | ------------ |
| LAC @ HOU | No         | No               | No     | No           |
| ARI @ LV  | No         | No               | No     | No           |
| TEN @ SF  | No         | No               | No     | No           |

The other authenticated candidates could not be tested because no SportsDataIO, Sportradar, Tank01, or MySportsFeeds credential is configured. Registering or purchasing a service was outside the authorized read-only evaluation. Their exact-game cells therefore remain `UNTESTED`, not failures and not verified coverage.

API-Sports was not credited from its newly published coverage claims because the configured account's repeated 2026 evaluations returned zero validated seasons/games. Highlightly's known outcome remains provider-missing for these three records.

## Overlap accuracy

Three Week 1 games already covered by Highlightly were also present in the same TheSportsDB response:

| Matchup   | Kickoff UTC            | Highlightly/internal final | TheSportsDB final | Difference |
| --------- | ---------------------- | -------------------------- | ----------------- | ---------- |
| GB @ PIT  | `2026-08-13T23:00:00Z` | GB 9, PIT 28               | GB 9, PIT 28      | None       |
| DET @ CIN | `2026-08-13T23:00:00Z` | DET 14, CIN 16             | DET 14, CIN 16    | None       |
| IND @ NE  | `2026-08-13T23:30:00Z` | IND 13, NE 13              | IND 13, NE 13     | None       |

All three home/away orientations, kickoffs, statuses, and scores agreed. Team-stat comparison was impossible because TheSportsDB supplied no event-stat rows; no statistical agreement is inferred from score agreement.

## Capability and normalization fit

### Highlightly

- **Game:** direct match/team IDs, season, round-derived `PRE/REG/POST`, kickoff, status, paired scores, quarter and clock. Venue/broadcast are not currently populated by the adapter.
- **Team stats:** all required normalized fields were complete for each of the 15 provider-covered completed games audited in M25/M25.1; unplayed overtime fields correctly remained null.
- **Player stats:** broad passing/rushing/receiving/defense/kicking/punting/return coverage with stable provider IDs. Profile endpoint supplies DOB, position, jersey, team, dimensions, active state, and some draft data, but no shared GSIS/ESPN/Sportradar ID.
- **PBP:** 183 textual plays in 18 event groups for the Hall of Fame Game, but no structured play rows, explicit play IDs, drive IDs, down/distance, field positions, participant IDs, or correction/deletion markers.
- **Semantics:** result and team-stat fit is good; player identity remains incomplete; PBP is insufficient for a robust Game Center.

### API-Sports

- **Game:** the existing adapter maps provider IDs, league/season/type/week, orientation, kickoff, statuses, scores, venue and clock into `NormalizedGame`.
- **Documented detail:** API-NFL advertises events, team statistics, per-game player statistics, players, injuries and standings.
- **Runtime result:** the configured account returned no validated 2026 data in repeated bounded evaluations, so no exact field mapping, overlap accuracy, or PBP suitability is verified.
- **Semantics:** retain the adapter but do not use it as current-season fallback until the account/season response is independently fixed and rerun.

### TheSportsDB

- **Game direct fields:** `idEvent`, `idHomeTeam`, `idAwayTeam`, `strHomeTeam`, `strAwayTeam`, `strTimestamp`, `intHomeScore`, `intAwayScore`, `strStatus`, and `strVenue` map cleanly.
- **Game derived fields:** `FT` can map to `FINAL`; score strings require integer parsing.
- **Game ambiguous/missing fields:** `intRound=500` does not express PRE Week 1, season type is not explicit, neutral site is absent, and provider-updated time was not present. Internal reviewed season type/week/kickoff must remain authoritative.
- **Team stats:** the generic endpoint exists but returned no data for all three exact NFL games; every normalized field remains null/unavailable.
- **Player stats:** stable player IDs/profile endpoints are documented, but no game-level player results were returned for the exact games.
- **PBP:** generic timeline endpoint returned no rows. It is **WORSE** than Highlightly for the 2nd & 15 Game Center.
- **Operational limitation:** the free season endpoint returned only 15 records, matching its documented free limit. Premium documents a 3,000-row season limit and 100 requests/minute, but full 2026 retrieval was not tested.

### Tank01

- **Documented:** preseason/regular/postseason week queries, a stable game ID, team schedule, general game info, a live box score with team/player stats and optional PBP, stable player ID, player profile/roster/depth-chart routes, and real-time updates.
- **Potential mapping:** game identity/scores and player category totals appear close to the current contracts. The precise first-down, possession, red-zone, sack, penalty, period-score, play-ID, drive-ID, and correction semantics are unverified.
- **Identity:** provider player IDs are stable within Tank01; shared external IDs, DOB, draft metadata and collision-safe profile evidence were not verified.
- **Rights:** the provider page documents plans/capabilities, but public terms specific enough for commercial storage, caching, display, and PBP republication were not found. `RIGHTS_UNCLEAR`.

### MySportsFeeds

- **Documented:** current schedule/scores, game/team/player logs, box scores, lineups, players, injuries, and PBP through REST; current plus one prior season by default.
- **Potential mapping:** separate CORE, STATS and DETAILED products align conceptually with `NormalizedGame`, `CurrentGameTeamStat`, `CurrentGamePlayerStat`, and a future `GamePlay` contract.
- **Ambiguity:** exact NFL preseason coverage, field names/null rules, correction identity, current 2026 accuracy, addon pricing, and stable shared player IDs were not verifiable without an account.
- **Rights:** commercial pricing is explicit, but the public website terms govern site content and do not clearly grant the required API data storage/caching/redistribution rights. `RIGHTS_UNCLEAR` pending written API subscription terms.

### SportsDataIO

- **Documented:** NFL preseason, live/final scores, team/player game stats, full PBP, stable game/player/play IDs, ordered sequence, start/end game state, down/distance, scoring markers, play-linked player stats, corrections, and delta PBP.
- **Potential mapping:** all current normalized structures are supported directly or through deterministic conversions. Its PBP contract appears **BETTER** than Highlightly.
- **Identity:** long-lived player IDs and rich profiles should improve reconciliation, but shared IDs and exact 2026 player rows were not tested.
- **Access:** free/dev data is scrambled; Discovery Lab is next-day/personal and not licensed for commercial redistribution; real-time commercial NFL is a custom Leagues API agreement. It is technically strong but not a self-serve MVP fallback.

### Sportradar

- **Documented:** full preseason coverage, stable UUIDs, team/player game stats, rosters/profiles, detailed drives and ordered plays, possession/location, per-play statistics, review state, deleted games, a daily change log, REST snapshots and optional push feeds.
- **Potential mapping:** game and team/player stats map strongly. A future play contract can use game/drive/play IDs, sequence, period/clock, possession, play type, description, start/end situation, scoring/turnover/penalty state, participants, `official`, created/updated times, and deletion/correction signals.
- **PBP:** on documented structure it is **BETTER** than Highlightly and the strongest Game Center candidate evaluated.
- **Access/rights:** trial data is real but non-commercial and expires after 30 days; production price and licensed properties are order-form specific. Data retention/destruction obligations apply at termination. This is an enterprise option, not an immediate MVP dependency.

## Proposed normalized play contract

No schema change is made in this milestone. If structured PBP is approved later, the minimum provider-neutral record should be:

```text
GamePlay
  internalGameId
  providerPlayId
  providerDriveId?
  sequence
  period
  clock?
  playType?
  description
  possessionInternalTeamId?
  down?
  distance?
  startFieldPosition?
  endFieldPosition?
  isScoring
  isTurnover
  isPenalty
  isOfficial?
  isDeleted?
  providerCreatedAt?
  providerUpdatedAt?
```

Provider game/team/player IDs remain private mapping metadata. Missing values remain null. Descriptions must not be parsed to invent structured facts, and corrections require stable IDs or an explicit deterministic replacement key.

## Player identity assessment

| Provider      | Stable player ID | DOB/position/team                           | Jersey/draft/profile depth            | Shared external ID verified          | Identity conclusion                                               |
| ------------- | ---------------- | ------------------------------------------- | ------------------------------------- | ------------------------------------ | ----------------------------------------------------------------- |
| Highlightly   | Yes              | Yes                                         | Strong, draft partial                 | No                                   | Strong-profile matching possible; current quota run incomplete.   |
| API-Sports    | Documented       | Documented                                  | Documented                            | No exact evidence                    | No current 2026 assessment.                                       |
| TheSportsDB   | Documented       | Generic profiles document DOB/position/team | Generic profile metadata              | No                                   | Does not help without exact player-game rows.                     |
| Tank01        | Documented       | Partially documented                        | Roster/profile/depth chart advertised | No                                   | Promising, exact profile evidence required.                       |
| MySportsFeeds | Documented       | Player feed advertised                      | Position/jersey/age shown             | No                                   | Potentially useful, exact profile contract required.              |
| SportsDataIO  | Yes              | Rich documented profile                     | Strong                                | Not verified                         | Likely strong but commercial access required.                     |
| Sportradar    | UUID             | Rich profile/roster                         | Strong                                | Sportradar IDs only in reviewed docs | Strong deterministic provider identity; crosswalk still required. |

No candidate authorizes name-only matching. Safe reconciliation remains existing mapping, exact shared external ID, or conservative DOB + normalized name + compatible position with additional team/jersey/draft evidence.

## Play-by-play comparison

| Provider      | Exact recent game inspected  | Plays/structure                                                              | IDs/drives                 | Corrections                                                   | Relative to Highlightly |
| ------------- | ---------------------------- | ---------------------------------------------------------------------------- | -------------------------- | ------------------------------------------------------------- | ----------------------- |
| Highlightly   | Yes, existing HOF evaluation | 183 text plays; zero structured rows                                         | No / no                    | Not documented                                                | Baseline                |
| API-Sports    | No usable 2026 game          | Unverified                                                                   | Unverified                 | Unverified                                                    | Unknown                 |
| TheSportsDB   | Yes, exact completed game    | Zero timeline rows                                                           | No / no                    | No evidence                                                   | **WORSE**               |
| Tank01        | No                           | PBP advertised in live box score                                             | Unverified                 | Unverified                                                    | Unknown                 |
| MySportsFeeds | No                           | Dedicated PBP documented                                                     | Unverified                 | Update/304 behavior documented, replacement semantics unclear | Unknown                 |
| SportsDataIO  | No exact 2026 call           | Structured play, sequence, state and player stats documented                 | Yes / game-state structure | Delta/stat corrections documented                             | **BETTER on contract**  |
| Sportradar    | No exact 2026 call           | Ordered structured plays, situations, possession and player stats documented | Yes / yes                  | Official-under-review, deleted games, change log              | **BETTER on contract**  |

Only a credentialed exact-game evaluation can promote a documented comparison to verified implementation suitability.

## Live delivery and request use

At one request per minute for one per-game endpoint:

- One 3.5-hour game: **210 calls**.
- Sixteen games: **3,360 calls**.
- A 13-game concurrent Sunday slate: **2,730 calls** over the live windows.
- Separate box-score and PBP endpoints double those figures to 420, 6,720, and 5,460 calls.

| Provider      | Delivery                                  | Documented freshness/limits                                                                       | One-minute polling fit                                                                       |
| ------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Highlightly   | REST full snapshots                       | Match list advertises one-minute refresh; Basic 100/day, Pro 7,500/day, Ultra 25,000/day          | Basic fails; Pro fits one/two endpoints narrowly; Ultra gives retry/reconciliation headroom. |
| API-Sports    | REST snapshots                            | Free 100/day/10 min; Pro 7,500/day/300 min; live endpoints document ~15–60 second refresh by type | Pro volume fits, but configured 2026 coverage does not.                                      |
| TheSportsDB   | REST; premium livescore                   | Free 30/min; Premium 100/min and two-minute livescores                                            | Good for a league-level result check; not detailed game ingestion.                           |
| Tank01        | REST live box score                       | Basic 1,000/month; Pro 1,000/day; Ultra 15,000/day                                                | Ultra is required for a full slate at one-minute per-game polling.                           |
| MySportsFeeds | REST, possible future push                | Calls are not the primary limiter; subscription freshness returns 304 until eligible              | Plan-specific frequency must be priced before sizing.                                        |
| SportsDataIO  | REST snapshots, PBP delta, replay         | Commercial Leagues API advertises unlimited calls; live PBP ~15–20 seconds behind broadcast       | Strong fit under a commercial contract.                                                      |
| Sportradar    | REST full snapshots plus paid Push add-on | Game feeds 3-second TTL live; change log for corrections; trial/package limits vary               | Strong fit, but use TTL/change-log/push rather than blind one-minute polling.                |

WebSocket and SSE were not documented for these candidates. Sportradar Push is a streaming add-on and explicitly complements rather than replaces REST recovery. MySportsFeeds describes a revised push engine as forthcoming, not a verified current dependency.

## Rights and licensing

| Provider      | Commercial app                                                                      | Storage/cache                                                                | Display/redistribution                                                                     | API proxy/database restrictions                          | Visual/PBP notes                                                               |
| ------------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Highlightly   | Allowed by current terms for applications/products                                  | Explicitly allowed                                                           | Data use/distribution allowed; direct API resale/sublicense/pass-through restricted        | Competing systematic database extraction prohibited      | Logos/images are not licensed; PBP display still needs product/legal judgment. |
| API-Sports    | Subscription use documented, exact publication grant not established in this review | `RIGHTS_UNCLEAR`                                                             | `RIGHTS_UNCLEAR`                                                                           | Rate/abuse restrictions documented                       | Treat logos/media separately.                                                  |
| TheSportsDB   | Paid API may be used to develop apps/services                                       | API content may be copied/modified; long-term retention limits not stated    | Attribution to TheSportsDB required; API resale prohibited                                 | No API resale; third-party rights remain user's duty     | Logo trademarks and third-party content require permission; do not import art. |
| Tank01        | `RIGHTS_UNCLEAR` beyond marketplace subscription                                    | `RIGHTS_UNCLEAR`                                                             | `RIGHTS_UNCLEAR`                                                                           | RapidAPI/provider terms must be obtained                 | Do not store/display PBP or images until confirmed.                            |
| MySportsFeeds | Commercial plans advertised                                                         | `RIGHTS_UNCLEAR` in public site terms                                        | `RIGHTS_UNCLEAR` for API data                                                              | Competing-site restriction appears in generic site terms | Obtain subscription agreement; images are separate.                            |
| SportsDataIO  | Yes under negotiated Leagues API agreement                                          | Contract-specific; historical guide expects local storage for immutable data | Discovery Lab explicitly not commercially redistributable; production is contract-specific | Contract-specific                                        | Headshots are separately licensed/quoted.                                      |
| Sportradar    | Yes under production order form                                                     | Permitted only as licensed; termination destruction obligations apply        | Properties/use defined by order form                                                       | Trial is evaluation-only; no commercial use              | Images and Push are separate products/add-ons.                                 |

This is an engineering rights review, not legal advice. `RIGHTS_UNCLEAR` is a release blocker, not an implied prohibition or permission.

## Secondary-provider architecture

### Option A — Highlightly primary plus fallback

Best near-term shape, but only if capability-specific:

- reviewed internal schedule owns game identity and kickoff;
- Highlightly supplies normal current state and available team stats;
- a secondary provider is queried only for a reviewed missing game;
- a mismatch is quarantined for review;
- no provider omission creates or deletes a game.

TheSportsDB could fill results after approval, but adds no value to the already completed editorial fallback and cannot fill team stats.

### Option B — scheduled dual-source reconciliation

Benefits: systematic disagreement detection and a correction trail. Costs: roughly double traffic, increased schema-semantic disputes, and a new decision problem for every differing stat. This is premature while no affordable second source has passed exact box-score tests.

### Option C — capability-specific providers

Best long-term fit:

- internal reviewed schedule: identity/kickoff;
- Highlightly: current state and its complete per-game team stats;
- approved result-only fallback: omissions;
- separately approved structured-PBP provider: Game Center;
- player stats only after deterministic player crosswalk.

This avoids pretending one vendor is equally reliable for every capability.

## Proposed precedence and conflicts

Scores/status:

1. reviewed `GameEditorialOverride` result;
2. verified primary provider result;
3. verified secondary result fallback;
4. reviewed base schedule state.

Team stats use a separate precedence:

1. an already accepted complete normalized primary pair;
2. an approved secondary complete pair only when the primary pair is absent;
3. unavailable.

Never merge providers field-by-field without explicit field provenance and proven semantic equivalence. If two complete pairs disagree, preserve the published pair, store neither overwrite nor blended totals automatically, and emit a private conflict for review. Compare exact raw concepts first: passing yards may be net versus gross, sacks may be made versus suffered, turnovers may include team events, and possession rounding may differ.

## Statistical completeness

| State                                           | Complete Week 1 team-stat games | Completeness |
| ----------------------------------------------- | ------------------------------: | -----------: |
| Before evaluation                               |                           13/16 |       81.25% |
| With tested TheSportsDB result fallback         |                           13/16 |       81.25% |
| Maximum supported by any exact-tested candidate |                           13/16 |       81.25% |

No tested fallback supplies even a partial normalized team-stat row for the three games. Aggregate current-season team totals/ranks remain biased and must not launch. Per-game-only remains safest.

## Cost estimate

All figures are rough monthly USD-equivalent planning numbers, exclude tax/bandwidth/overages, and must be rechecked before purchase.

| Scenario                                     | Suggested evaluation stack                               | Approximate monthly cost | Assumptions                                                                                        |
| -------------------------------------------- | -------------------------------------------------------- | -----------------------: | -------------------------------------------------------------------------------------------------- |
| Low-usage POC                                | observed Highlightly Basic + TheSportsDB free evaluation |                       $0 | 100 Highlightly calls/day is insufficient for continuous live polling; manual/bounded checks only. |
| Early public app, results/team box scores    | Highlightly Pro direct + TheSportsDB Premium             |                about $17 | $7.99 + $9; TheSportsDB is result-only, not statistical redundancy.                                |
| Early public app, trial secondary box scores | Highlightly Pro + Tank01 Ultra                           |                about $33 | $7.99 + $25; volume fits, but data/rights are not yet approved.                                    |
| Full Sunday live slate with headroom         | Highlightly Ultra + TheSportsDB Premium                  |                about $28 | $18.99 + $9; supports 6,720 two-endpoint calls/day with margin.                                    |
| Full slate with candidate secondary detail   | Highlightly Ultra + Tank01 Ultra + TheSportsDB Premium   |                about $53 | Technical budget only; do not purchase/integrate until exact data and rights pass.                 |
| Enterprise structured PBP                    | SportsDataIO or Sportradar                               |           $100+ / custom | Pricing and licensed use are sales/order-form specific and may be materially higher.               |

MySportsFeeds commercial NFL CORE begins at CAD $39/month non-live; STATS/DETAILED and live frequency add cost that was not publicly calculable. SportsDataIO Discovery Lab is $99/month but next-day, personal-use, and not suitable for the public live app.

## Scorecard

Scale: 0 unavailable/failed, 1 poor or rights-blocked, 2 documented but exact-current untested, 3 usable with caveats, 4 strong, 5 exact/strongest fit. Scores compare MVP suitability, not vendor quality in the abstract.

| Provider      | 26 sched | PRE | Results | Team | Player | Identity | PBP | IDs | Live | Limits | Price | Docs | Comm rights | Storage | Complexity |
| ------------- | -------: | --: | ------: | ---: | -----: | -------: | --: | --: | ---: | -----: | ----: | ---: | ----------: | ------: | ---------: |
| Highlightly   |        4 |   4 |       4 |    4 |      3 |        3 |   2 |   4 |    4 |      4 |     5 |    4 |           4 |       5 |          4 |
| API-Sports    |        0 |   0 |       0 |    0 |      0 |        1 |   0 |   3 |    1 |      4 |     4 |    4 |           2 |       2 |          4 |
| TheSportsDB   |        3 |   3 |       5 |    0 |      0 |        2 |   0 |   4 |    2 |      4 |     5 |    3 |           4 |       3 |          5 |
| Tank01        |        2 |   3 |       2 |    3 |      3 |        2 |   2 |   3 |    4 |      4 |     5 |    3 |           1 |       1 |          4 |
| MySportsFeeds |        2 |   2 |       2 |    4 |      4 |        3 |   3 |   4 |    4 |      4 |     3 |    3 |           2 |       2 |          3 |
| SportsDataIO  |        2 |   5 |       4 |    5 |      5 |        4 |   5 |   5 |    5 |      5 |     1 |    5 |           4 |       4 |          3 |
| Sportradar    |        2 |   5 |       4 |    5 |      5 |        4 |   5 |   5 |    5 |      4 |     1 |    5 |           4 |       3 |          2 |

The `26 sched` score deliberately caps authenticated candidates at 2 when no exact 2026 request was made, regardless of documented general coverage.

## Recommendation and next milestone

- Overall choice: **F — continue evaluation**.
- Provider action now: **5 — no provider change**.
- TheSportsDB: retain as a documented **results-only fallback candidate**. It is unnecessary for the three already resolved editorial results and cannot improve team statistics.
- Next provider test: obtain explicit approval plus a free Tank01 key/subscription, then run a bounded no-write exact-game evaluator for the three missing games and the same three overlaps. Require full sanitized field evidence and written commercial storage/display/PBP rights before integration.
- If Tank01 fails, run the same gate with MySportsFeeds and obtain the actual CORE + STATS + DETAILED live quote/terms.
- If a structured Game Center becomes the higher priority and budget permits, evaluate Sportradar trial PBP against one exact game; do not begin ingestion from documentation alone.

Until a secondary provider returns the three exact box scores and agrees acceptably on overlapping Highlightly games, full aggregate team stats are **not ready**. The existing per-game stats endpoint remains the only safe current-season statistics surface.

## Sources

- Highlightly [NFL API and pricing](https://highlightly.net/nfl-api/), [terms](https://highlightly.net/terms/), and repository evaluations.
- API-Sports [NFL coverage/pricing](https://api-sports.io/sports/nfl), [current API-NFL guide](https://www.api-football.com/news/post/how-to-get-started-with-api-nfl-the-complete-beginners-guide), and repository evaluation.
- TheSportsDB [API guide](https://www.thesportsdb.com/docs_api_guide), [pricing](https://www.thesportsdb.com/docs_api), and [terms](https://www.thesportsdb.com/docs_terms_of_use.php).
- Tank01 [provider capability and pricing page](https://www.tank01.com/) and its linked RapidAPI NFL documentation.
- MySportsFeeds [feed overview](https://www.mysportsfeeds.com/data-feeds), [pricing](https://www.mysportsfeeds.com/feed-pricing/), [FAQ](https://www.mysportsfeeds.com/faq/), and [public terms](https://www.mysportsfeeds.com/terms-use/).
- SportsDataIO [access/pricing models](https://sportsdata.io/developers), [NFL workflow](https://sportsdata.io/developers/workflow-guide/nfl), and [NFL data dictionary](https://sportsdata.io/developers/data-dictionary/nfl).
- Sportradar [NFL update frequencies](https://developer.sportradar.com/football/docs/nfl-ig-update-frequencies), [game statistics](https://developer.sportradar.com/football/reference/nfl-game-statistics), [PBP](https://developer.sportradar.com/football/reference/nfl-play-by-play), [push feeds](https://developer.sportradar.com/football/docs/nfl-ig-push), and [terms](https://developer.sportradar.com/sportradar-updates/page/terms-and-conditions).
