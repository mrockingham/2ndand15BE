# Highlightly NFL evaluation

## Scope

Highlightly is evaluated read-only. It is not an active sports provider, does not implement the `SportsDataProvider` synchronization contract, and cannot read or write PostgreSQL. The evaluator never creates team or game mappings and does not change public API behavior.

Run it only with a private key in the ignored `.env` file:

```text
HIGHLIGHTLY_API_KEY=
HIGHLIGHTLY_BASE_URL=https://american-football.highlightly.net
HIGHLIGHTLY_REQUEST_TIMEOUT_MS=10000
HIGHLIGHTLY_MAX_RETRIES=1
HIGHLIGHTLY_EVALUATION_SEASON=2026
```

The key is sent only in the documented `x-rapidapi-key` request header. The direct Highlightly host does not require `x-rapidapi-host`. `HIGHLIGHTLY_EVALUATION_SEASON` overrides the application's explicit `CURRENT_NFL_SEASON`; either may supply the target season. Configuration requires HTTPS, and missing credentials cause the evaluation command to exit nonzero before making a request.

Run:

```text
npm run sports:evaluate:highlightly
```

The command writes a dated sanitized report under `docs/provider-evaluations/`. It prints only the report location, request count, season, suitability classification, and non-database status.

## Official API contract

The evaluation inspected Highlightly's official NFL and NCAA documentation and its embedded OpenAPI document on August 1, 2026:

- Documentation version: 8.1.5
- OpenAPI version: 3.0.0
- Direct base URL: `https://american-football.highlightly.net`
- Documentation: `https://highlightly.net/nfl-api/documentation/`

The evaluation uses these paths:

- `GET /teams?league=NFL` for league and team discovery
- `GET /matches?league=NFL&season=2026` for season and schedule discovery, with bounded pagination
- `GET /matches/{id}` for one completed-game detail, events, injuries, and game statistics
- `GET /standings` for one current-season standings validation

The OpenAPI document also contains `/teams/statistics/{id}`, `/lineups/{matchId}`, `/players`, `/players/{id}/statistics`, `/box-score/{matchId}`, and `/odds`. These are recorded as documented but are not all called because schedule and event detail are the evaluation priorities. The documentation introduction advertises depth charts, but OpenAPI 8.1.5 contains no depth-chart path; that capability remains unverified.

The schedule list documents a one-minute refresh interval. The published API surface is REST-only; the evaluator does not infer WebSocket, server-sent-event, webhook, delta-feed, or correction support from marketing claims.

## Request budget and failure behavior

The command first calls teams and the requested season. When no 2026 games are returned it stops after two requests and classifies current-season suitability as failed. When games exist, schedule pagination is capped at four pages. The remaining budget permits one prior-season lookup when needed to locate a completed game, one detailed-match request, and one standings request. The hard evaluation design ceiling is eight successful request attempts before transport retries.

Authentication failure, transport exhaustion, rate-limit exhaustion, or malformed required responses make the command exit nonzero without writing a report. Retries apply only to transient idempotent failures and respect `Retry-After` for HTTP 429.

## Licensing boundary

Re-reviewed August 21, 2026 against terms last updated July 24, 2026. Section 6.1 permits distribution, transfer, storage, and use of API data in applications/products. Direct API resale, sublicensing/redistribution, and proxy/pass-through services require permission; section 6.2 also prohibits systematic extraction for a competing database or service. Sections 6.3-6.4 leave visual/logo permissions with the user.

The application therefore retains its explicit production-publication approval gate, stores no Highlightly visual assets, exposes no provider identifiers or raw payloads, and does not provide API pass-through access. See `https://highlightly.net/terms/` and [current-season-games/sync-hardening.md](current-season-games/sync-hardening.md).
