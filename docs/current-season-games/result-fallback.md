# Reviewed current-game result fallback

Milestone 25.1 extends the existing one-per-game `GameEditorialOverride`; it does not create a parallel game or correction store. The reviewed internal schedule remains authoritative for identity, orientation, kickoff, week, venue, broadcast, neutral-site status, and provenance.

## When to use it

Use the fallback only when an existing reviewed game is stale because the current-state provider omitted it and an editor or administrator independently verified the final result. It is final-result-only: `FINAL`, `homeScore`, and `awayScore` are required together. Scores must be non-negative integers and always follow the stored internal home/away orientation. Ties are accepted and overtime is never inferred.

Every request requires a source name and reason. A source URL, private internal note, and public correction note are optional. The server records its own verification timestamp and the persisted editor/admin identity. The mutation and its before/after state are captured in `AdminAuditEvent`; read-only dry-runs and identical no-ops create no audit.

```text
PUT /api/v1/admin/games/:gameId/result-fallback
```

The request defaults to `dryRun=true`. The private operator CLI also requires exactly one of `--dry-run` and `--apply` and resolves an active persisted `EDITOR`/`ADMIN` actor:

```text
npm run games:result-fallback -- --gameId=<uuid> --homeScore=<n> --awayScore=<n> \
  --sourceName=<name> --sourceUrl=<url> --reason=<reason> --dry-run
```

The endpoint cannot create a `Game`, rejects non-reviewed provenance, and cannot create `CurrentGameTeamStat`. Generic schedule overrides cannot change the status of an active result fallback.

## Resolution and reconciliation

Public game resolution is field-by-field:

1. Active reviewed editorial override
2. Current provider-synced base state
3. Reviewed base game state

Provider sync continues to update only the base state. When a provider later returns a fallback game, the sync compares final status and oriented scores first:

- `AGREES`: normal mapping/base synchronization may proceed; audit history and the override remain.
- `DISAGREES`: report `RESULT_CONFLICT`; do not update base state or create a mapping.
- `PROVIDER_STILL_MISSING`: retain the fallback and report the omission.

Result and statistics coverage remain independent. A game can be `EDITORIAL_RESULT_FALLBACK` and `TEAM_STATS_UNAVAILABLE`; score review never fabricates team totals.

## Hosted Week 1 application

The bounded Highlightly recheck failed before returning a usable report, so it made no writes and could not establish that any of the three records had appeared. The 2026 API-Sports re-evaluation also returned no validated current-season data. Official NFL game/schedule pages independently verified:

| Internal game                          | Matchup    | Resolved final | Source                 |
| -------------------------------------- | ---------- | -------------- | ---------------------- |
| `11093a87-a885-4535-aca5-a762675a000b` | LAC at HOU | LAC 27, HOU 7  | NFL Game Center        |
| `6e63d621-c3ba-45a6-b5ed-70cf98f3923c` | ARI at LV  | ARI 27, LV 14  | NFL Cardinals schedule |
| `c967dc85-aaa9-4832-b28d-3fdb2adcd3d0` | TEN at SF  | TEN 19, SF 13  | NFL Game Center        |

All three dry-runs returned `WOULD_CREATE`, then the first apply returned `CREATED`. The exact replay returned `UNCHANGED` three times. No provider mapping or team-stat row was created.

Week 1 now has 16/16 result-complete games (100%): 13 provider-complete and three editorial fallbacks. Team-stat completeness remains 13/16 (81.25%), with the same three fallback games unavailable. Per-game team statistics are safe where present; season aggregate rankings remain incomplete.
