# Current-season team-stat coverage

Measured against hosted PostgreSQL on August 21, 2026 after the dry-run-first Milestone 25 Week 1 and Week 2 backfill. This is a read-only measurement of stored normalized rows; it did not call Highlightly or mutate any table.

## Classification

- `COMPLETE`: exactly two rows, correctly oriented to the internal home and away teams, with non-null first downs, total plays, total yards, passing attempts/yards, rushing attempts/yards, and turnovers on both sides.
- `PARTIAL`: at least one normalized row exists but the pair, orientation, or a core field is incomplete.
- `UNAVAILABLE`: no normalized rows are available.

Recorded zero counts as present. Null remains distinct from zero. Overtime-period nulls do not make a regulation game partial because overtime is not a core field and may be inapplicable.

## Hosted results

| Scope           | Reviewed games | Provider matches | State at audit                     | Team rows | COMPLETE | PARTIAL | Provider unavailable |
| --------------- | -------------: | ---------------: | ---------------------------------- | --------: | -------: | ------: | -------------------: |
| 2026 PRE Week 1 |             16 |               13 | 13 FINAL, 3 still stored SCHEDULED |        26 |       13 |       0 |                    3 |
| 2026 PRE Week 2 |             16 |               16 | 2 FINAL, 14 SCHEDULED              |         4 |        2 |       0 |                    0 |

The three Week 1 unavailable-stat games are LAC at HOU, ARI at LV, and TEN at SF. Their final results are now independently sourced editorial fallbacks, but no team statistics were inferred. The 14 Week 2 scheduled games were not team-stat eligible at the time of the audit and are not classified as unavailable.

All 15 provider-matched finals have exactly two rows, correct internal home/away team IDs, and complete core fields. Every matched kickoff difference was 0 ms.

## Per-field coverage

Percentages use stored team rows as the denominator (26 in Week 1 and 4 in Week 2).

| Field                 |                          Week 1 |                         Week 2 |
| --------------------- | ------------------------------: | -----------------------------: |
| firstDowns            |                    26/26 (100%) |                     4/4 (100%) |
| firstDownsPassing     |                    26/26 (100%) |                     4/4 (100%) |
| firstDownsRushing     |                    26/26 (100%) |                     4/4 (100%) |
| firstDownsPenalty     |                    26/26 (100%) |                     4/4 (100%) |
| totalPlays            |                    26/26 (100%) |                     4/4 (100%) |
| totalYards            |                    26/26 (100%) |                     4/4 (100%) |
| passingCompletions    |                    26/26 (100%) |                     4/4 (100%) |
| passingAttempts       |                    26/26 (100%) |                     4/4 (100%) |
| passingYards          |                    26/26 (100%) |                     4/4 (100%) |
| passingInterceptions  |                    26/26 (100%) |                     4/4 (100%) |
| rushingAttempts       |                    26/26 (100%) |                     4/4 (100%) |
| rushingYards          |                    26/26 (100%) |                     4/4 (100%) |
| turnovers             |                    26/26 (100%) |                     4/4 (100%) |
| fumblesLost           |                    26/26 (100%) |                     4/4 (100%) |
| sacks                 |                    26/26 (100%) |                     4/4 (100%) |
| sackYardsLost         |                    26/26 (100%) |                     4/4 (100%) |
| thirdDownConversions  |                    26/26 (100%) |                     4/4 (100%) |
| thirdDownAttempts     |                    26/26 (100%) |                     4/4 (100%) |
| fourthDownConversions |                    26/26 (100%) |                     4/4 (100%) |
| fourthDownAttempts    |                    26/26 (100%) |                     4/4 (100%) |
| penalties             |                    26/26 (100%) |                     4/4 (100%) |
| penaltyYards          |                    26/26 (100%) |                     4/4 (100%) |
| possessionSeconds     |                    26/26 (100%) |                     4/4 (100%) |
| redZoneConversions    |                    26/26 (100%) |                     4/4 (100%) |
| redZoneAttempts       |                    26/26 (100%) |                     4/4 (100%) |
| totalDrives           |                    26/26 (100%) |                     4/4 (100%) |
| period1Score          |                    26/26 (100%) |                     4/4 (100%) |
| period2Score          |                    26/26 (100%) |                     4/4 (100%) |
| period3Score          |                    26/26 (100%) |                     4/4 (100%) |
| period4Score          |                    26/26 (100%) |                     4/4 (100%) |
| overtime1Score        | 0/26 (0%, not played/available) | 0/4 (0%, not played/available) |
| overtime2Score        | 0/26 (0%, not played/available) | 0/4 (0%, not played/available) |

## API readiness decision

Status: **PARTIALLY_READY** — recommendation **B: per-game team stats are safe where present, but aggregate rankings are incomplete**.

The normalized team-stat shape, orientation, null/zero handling, persistence, idempotency, and existing game-specific `GET /api/v1/games/:gameId/stats` read path are ready for available games. Result coverage is now 16/16, but statistical coverage remains 13/16 (81.25%). A season/week aggregate surface would therefore silently undercount the three editorial-fallback games. The current complete-stat sample is also only 13 Week 1 games plus the completed Week 2 games available at each audit.

The later public `GET /api/v1/games/current-stats` collection exposes these per-game classifications without computing unfair aggregate rankings. The three Week 1 gaps remain factual `UNAVAILABLE` games. No new provider, polling, cron, queue, scheduler, WebSocket, SSE, or player-stat reconciliation was added.
