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

Highlightly's published terms were last updated July 24, 2026. They say the subscription does not grant a license to publish or redistribute delivered data, does not grant rights to league or team logos and trademarks, and restricts systematic extraction or reuse of a substantial part of the database. The subscription must not be treated as an NFL trademark or content license.

Written confirmation and, where applicable, rights-holder permission are required before commercial public display, paid-subscription use, caching, long-term storage, derived analytics, AI training, logo display or hosting, play-description republication, play-animation generation, or video-highlight embedding. See `https://highlightly.net/terms/` and obtain legal review before production use.
