# Current-game synchronization semantics

## Boundary and identity

The provider adapter emits the existing normalized game contract. The synchronization service accepts exactly one existing internal `Game.id` and is update-only: no code path creates a `Game`. Internal IDs remain public identity; Highlightly match IDs remain private `GameProviderMapping` metadata.

An existing mapping is the first match key. Without one, a match requires all of:

- the requested internal game;
- the same season and season type;
- kickoff within 12 hours of the reviewed kickoff;
- exact home and away teams, using Highlightly team mappings when present and canonical abbreviations otherwise.

Reversed home/away orientation is a failure, including at a neutral site. Zero matches are unmatched; multiple exact matches are ambiguous. A provider match ID already mapped to another internal game is a failure. None of those outcomes writes anything.

## Mutable state

Only `status`, `homeScore`, `awayScore`, `quarter`, `clock`, `venueName`, `venueCity`, `broadcastNetwork`, and `providerLastUpdatedAt` can change. A null provider venue or broadcast retains the reviewed internal value. The pipeline never changes teams, kickoff, season, season type, week, neutral-site flag, schedule provenance, or editorial overrides.

Scheduled and pregame states require null scores. A final requires both scores. Provider scores are interpreted in provider home/away order and are not swapped based on winner.

## Dry-run, transaction, and idempotency

Dry-run executes provider fetch, validation, identity matching, collision checks, and change planning, but never invokes the write repository. Apply updates the existing game, optionally creates its unique provider mapping, and appends a private `CURRENT_GAME_PROVIDER_SYNC` audit in one transaction. A mapping failure rolls the entire transaction back.

Reapplying the same normalized state with its existing mapping returns `UNCHANGED` and creates no new audit. Public game and Team Hub reads continue to query PostgreSQL and expose neither provider IDs nor audit/provenance internals.
