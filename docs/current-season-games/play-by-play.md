# Completed-game structured play-by-play

Milestone 26 adds a provider-neutral `GamePlay` persistence and read layer for completed games. Ingestion is an explicit, bounded operation for one internal game UUID. It does not add live polling, scheduling, queues, push delivery, or provider calls from public requests.

## Operations and rights gate

```text
npm run games:current:plays:verify -- --gameId=<internal-uuid>
npm run games:current:plays:sync -- --gameId=<internal-uuid> --dry-run
npm run games:current:plays:sync -- --gameId=<internal-uuid> --apply
```

The command reuses the current-game Highlightly evaluation/publication gate. Evaluation mode may be used only outside production; production writes require the separately reviewed publication approval flag. The target must already be `FINAL` and have a verified Highlightly `GameProviderMapping`. Provider home/away abbreviations must match the internal game.

## Observed Highlightly shape

The current detail response exposes `events[].playDetails[]`. Each observed play contains `period`, `clock`, `type`, `text`, `isPenalty`, and `start`/`end` objects with nullable `down`, `distance`, `yardLine`, `possessionText`, and `yardsToEndzone`. The response is oldest to newest. `playDetails` has no stable play ID, drive ID, correction marker, or deletion marker.

The enclosing event team ID, not `possessionText`, is used for possession because observed `possessionText` describes the side of the field. It is mapped only when it exactly equals the verified home or away provider team ID; otherwise possession is null.

`yardsToEndzone` becomes provider-neutral offense progress with `100 - yardsToEndzone`: 0 is the offense's own goal line, 50 is midfield, and 100 is the opponent goal line. Missing or out-of-range input stays null. Down and distance are independently nullable and are accepted only in their documented ranges.

Observed source types map into `PASS`, `RUSH`, `PUNT`, `KICKOFF`, `FIELD_GOAL`, `SACK`, `PENALTY`, `TIMEOUT`, `INTERCEPTION`, `FUMBLE`, `END_PERIOD`, or `OTHER`. Unknown values safely become `OTHER`; the raw source type remains private. Scoring is true only for source types ending in `touchdown` or exactly `Field Goal Good`. Turnover is true only for interception types or opponent fumble recovery. Penalty uses the explicit provider flag. These are deterministic rules and do not use AI.

## Identity and reconciliation

`playKey` is a SHA-256 hash over a canonical representation of the internal game ID, period, clock, normalized type, normalized start/end state, resolved possession, description, flags, and an occurrence index. Therefore repeated clocks and even identical descriptions remain distinct. A second structural hash excludes mutable description/flags and supports safe correction matching.

Each accepted full snapshot receives sequence `1..N`. Reconciliation first uses the exact key and then a unique structural match. It updates a changed safely matched play, detects reorderings, and treats an unchanged replay as a no-op. Ambiguous matches block the entire write. A shorter snapshot or any unmatched stored row also blocks the entire write: stored plays are never deleted merely because the provider omitted them. Writes and the compact audit record are transactional.

## Public API

`GET /api/v1/games/:gameId/plays` reads PostgreSQL only and returns oldest-to-newest normalized plays. It includes internal game and team identities, normalized type, description, positions, and safe flags. Provider IDs, source types, hashes, payloads, URLs, and reconciliation evidence are not public. A known game without imported plays returns a factual empty list with a limitation note. Completed feeds use `Cache-Control: public, max-age=300, stale-while-revalidate=3600` so factual corrections can propagate.

## Coverage and limitations

The initial bounded inspection found 188 structured plays for SF-LAC and 180 for LV-HOU. A completed GB-PIT game returned no `playDetails`, showing that provider coverage is not universal. Coverage varies for possession and down/distance; null remains distinct from zero.

This layer supports structured text, period/clock, available down/distance, conservative possession, normalized field progress, and safely derived scoring/penalty/turnover flags. It can support a future basic field-progress view. It does not support exact player movement, ball trajectory, snap reconstruction, official tracking replay, guaranteed correction detection, drive identity, or guaranteed real-time latency.

Future live validation may reuse normalization and reconciliation, but it requires a separate milestone and operational rights decision.

## Hosted baseline (2026-08-21)

The SF-LAC dry-run proposed 188 inserts and the LV-HOU dry-run proposed 180. Both reported zero collisions, unresolved possession rows, unknown types, and field-position failures. SF-LAC start/end down-distance coverage was 90.43%/91.49%; LV-HOU was 90.56%/92.22%. Both applies completed transactionally. Immediate replays were no-ops: 188 and 180 unchanged, with zero inserts or updates.

The public endpoint returned sequences 1-188 and 1-180. SF-LAC had 10 scoring, 13 penalty, and 2 turnover flags; LV-HOU had 8, 13, and 3. Direct hosted API-layer reads were 338.43 ms/99,209 bytes and 138.49 ms/94,836 bytes respectively, including remote database latency. Provider metadata leakage checks were negative.

Before/after preservation counts remained: Games 2,024; GameProviderMappings 1,988; CurrentGameTeamStat 32; CurrentGamePlayerStat 0; historical PlayerGameStat 112,316; Players 25,766. Only 368 new `GamePlay` rows and two compact audit events were added. The migration adds unique `(game_id, play_key)` and `(game_id, sequence)` indexes plus lookup indexes for `(game_id, period, sequence)` and `(game_id, reconciliation_key)`.
