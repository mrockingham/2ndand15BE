# Team Hub semantics

## Identity and team status

Every Team Hub path uses internal `Team.id`. Provider IDs are never accepted or returned. A team must currently be an active NFL team; inactive and absent records both return `TEAM_NOT_FOUND`. Internal `Player.id` and `Game.id` remain the public player/game identities.

## Historical roster membership

Roster membership is evidence that a player has at least one stored weekly roster record linked to the selected team and season. It is not evidence that the player:

- belonged to the team for the full season;
- was on the opening-day or final roster;
- appeared in a game or produced a statistic;
- remains with that team now; or
- belongs to a fabricated 2026 roster.

Multiple weekly rows collapse to one player/team/season row. `firstWeek` and `lastWeek` are the minimum and maximum stored roster weeks, and `rosterWeekCount` counts distinct stored weeks. Position, jersey, and status use the latest recorded non-null value for that historical team-season. Historical missing values remain null.

The historical team is always labeled `historicalTeam`. `latestKnownTeam` comes from the imported player profile and is labeled separately; it may differ because of a later season or transaction and is not a live-current-roster claim.

## Positions and groups

The reviewed weekly roster import normalizes stored positions to `DB`, `DL`, `K`, `LB`, `LS`, `OL`, `P`, `QB`, `RB`, `TE`, and `WR`. Team Hub preserves those exact values. `K`, `LS`, and `P` derive to position group `SPEC`; every other normalized position is its own position group. This agrees with the reviewed broad groups used by imported player statistics without using a player’s latest profile position to rewrite history.

## Schedule and news

The overview uses only the stored configured current season (2026). Upcoming rows retain `SCHEDULED`/`PREGAME` state; recent rows require factual `FINAL` state. Officially TBD kickoffs stay `startTime: null` and sort after known upcoming times. Development fixtures remain hidden unless the existing fixture switch is explicitly enabled.

Article cards use the existing public visibility rules and list DTO. Draft, unpublished, archived, future-scheduled, revision, actor, and audit fields remain private. Team Hub never fetches an article or image URL.

## Stats

Team leaders are Stats Hub team splits, not roster-based qualifications. Values aggregate only stored player-game statistics recorded for the path team. Traded-player totals are therefore scoped honestly to that team. Null values remain missing and are excluded from rankings; recorded zeroes remain factual and eligible.

## Coverage and attribution

The current imported historical roster/stat coverage is 2020–2025. The overview reports roster and stat seasons separately and chooses the latest season present in both as its default when possible. Empty coverage remains an empty array/null default rather than being inferred. Historical player/roster/stat fields carry dataset-level nflverse attribution under CC BY 4.0.
