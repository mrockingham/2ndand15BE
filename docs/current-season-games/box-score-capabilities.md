# Highlightly box-score capabilities

Date: August 8, 2026

Target: internal game `0768c441-16a6-457c-b50f-e7273d750d77`, private Highlightly match `565788`.

Discovery was read-only and did not access or mutate PostgreSQL. Five calls were made across two endpoint families, including bounded reruns after a local output-sanitizer failure:

- `/matches/{id}`: game identity, team totals, period scores, events, and plays.
- `/box-score/{id}`: player game-stat rows.

No raw response was persisted. Output retained only sanitized counts, field names, and normalized evidence.

## Capability matrix

| Data                   | Available | Quality and notes                                                                             |
| ---------------------- | --------- | --------------------------------------------------------------------------------------------- |
| Team first downs       | Yes       | Direct integer totals and pass/rush/penalty splits                                            |
| Team total plays/yards | Yes       | Direct integer totals                                                                         |
| Team passing/rushing   | Yes       | Direct attempts/completions/yards and rush attempts/yards                                     |
| Turnovers              | Yes       | Direct turnovers, thrown interceptions, and fumbles-lost totals                               |
| Downs                  | Yes       | Direct third/fourth conversions and attempts; provider spells one label `Forth Down Attempts` |
| Penalties              | Yes       | Direct count and yards; provider spells one label `Penalties Commited`                        |
| Possession             | Yes       | Direct `MM:SS`, normalized deterministically to seconds                                       |
| Red zone               | Yes       | Direct conversions and attempts                                                               |
| Team punts/returns     | No        | Not present as team totals; not derived from unresolved player rows                           |
| Player passing         | Yes       | Two rows per team; completions, attempts, yards, touchdowns, interceptions, sacks/yards       |
| Player rushing         | Yes       | Arizona 4 rows, Carolina 5; attempts, yards, touchdowns, long                                 |
| Player receiving       | Yes       | Arizona 10 rows, Carolina 15; targets, receptions, yards, touchdowns, long                    |
| Player defense         | Yes       | Arizona 20 rows, Carolina 30; total/solo tackles, sacks, TFL, passes defended, defensive TD   |
| Kicking                | Yes       | One row/team; FG/XP made-attempted and long FG                                                |
| Punting                | Yes       | One row/team; punts, yards, average, touchbacks, inside-20, long                              |
| Returns                | Yes       | Kick returns for 2 Arizona and 4 Carolina rows; one Arizona punt-return row                   |
| Quarter scoring        | Yes       | Q1-Q4 direct score pairs; two nullable overtime fields                                        |
| Scoring summary        | Partial   | 12 scoring event groups, but no explicit score-after fields; deferred                         |
| Play-by-play           | Partial   | 183 text plays in 18 event groups; zero structured play rows; deferred                        |

The team-stat response contained exactly 34 rows per side, 68 total. The player endpoint contained 35 Arizona rows and 47 Carolina rows, 82 total, with 646 individual statistic entries. Recorded zeroes are present and remain distinct from absent/null values.

## Identity findings

Both provider team IDs reconcile to the verified detailed-match home/away identity, which in turn is anchored by the existing internal `GameProviderMapping`. Team display names are not used as identity.

All 82 player rows had a provider player ID, but none supplied a position. PostgreSQL had zero Highlightly `PlayerExternalIdentifier` mappings. Names are forbidden as identity, so the result was:

- Provider player rows: 82
- Matched internal players: 0
- Unmatched players: 82
- Ambiguous players: 0

Player fields were normalized privately to test capability and zero/null semantics, but unresolved rows are neither persisted nor published. A stable external-ID crosswalk is required before player storage can be activated.

Milestone 22.6 subsequently verified the single-player profile endpoint. Of 82 requested unique profiles, 63 returned before the provider account reached its broader request quota. Every returned profile supplied birth date, position, team, height, and weight; 62 supplied jersey and 32 supplied draft metadata. No shared external identifier was exposed. The remaining 19 profiles require a later quota-refreshed dry-run before any hosted reconciliation may be applied.

## Scoring and play quality

Period scores are reliable structured fields and are implemented. Scoring events expose event order, period/clock context, team, result, description, and a scoring flag, but no explicit resulting home/away score. The milestone does not parse descriptions to invent score-after fields.

Play records are strings nested under event groups. They lack explicit sequence IDs, down, distance, structured participants, correction markers, and tracking coordinates. They may support a future basic textual field view, but not reliable detailed reconstruction or exact 2D animation.
