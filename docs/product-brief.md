# Product Brief

## Product summary

2nd and 15 is intended to be a fast, modern, AI-powered NFL platform that combines live football information, attributed news, predictions, personalization, and fantasy-football assistance in one responsive experience.

This repository is the backend only. The consumer frontend is maintained separately and will use the versioned REST API defined here.

## Product vision

The long-term product may include:

- Live and upcoming NFL games
- Schedules, scores, standings, and statistics
- Fast NFL news with visible source attribution
- AI-generated news summaries
- Pregame predictions, projected scores, confidence, and historical accuracy
- Live play-by-play and a custom animated top-down play visualizer
- Team and player pages
- Injury and transaction updates
- Fantasy tools, including Sleeper league imports, start/sit guidance, waivers, and trade analysis
- User accounts and personalization based on one favorite team, with additional followed teams later
- Dark and light themes and responsive desktop/mobile layouts in the frontend

Paid fantasy contests, wagering, and cash prizes are not part of the initial MVP.

## Intended users

- NFL fans who want a quick view of the games and news most relevant to their team
- Fantasy-football players who eventually want recommendations in the context of real NFL developments
- Fans who want understandable predictions with confidence and a visible accuracy record

## MVP objective

The first vertical slice proves that the backend can support a personalized frontend home experience without coupling the product to a commercial sports provider.

The MVP slice must allow a frontend to:

1. Retrieve a normalized list of active NFL teams.
2. Register a user and authenticate an existing user.
3. Set or change the authenticated user's one favorite team.
4. Retrieve the authenticated user together with favorite-team information.
5. Use that data to render a personalized-home starting state.

The initial team source is a version-controlled local fixture accessed through the same provider abstraction that future commercial adapters will implement.

## Core MVP journeys

### New user onboarding

1. The frontend loads the team catalog.
2. A person registers with valid credentials.
3. The person selects an active team as their favorite.
4. The frontend retrieves the user profile and receives normalized favorite-team details.

### Returning user

1. A person logs in.
2. The frontend uses an access token for authenticated requests.
3. The frontend refreshes authentication through the refresh flow when necessary.
4. The personalized home can retrieve the user and favorite-team context.

### Favorite-team change

1. An authenticated person selects a different team.
2. The backend verifies that the internal team record exists and is active.
3. The backend updates the relationship and returns the new profile state. The person may also clear the favorite by sending `favoriteTeamId: null`.

## MVP scope

### In scope

- Normalized NFL team catalog backed by local mock data
- User registration and login
- JWT access tokens and revocable refresh sessions
- Logout and token refresh
- Generic forgot-password and single-use password reset through a replaceable email abstraction
- Get-current-user endpoint
- Set or change one favorite team
- Health endpoint
- Consistent success/error response formats
- Request and environment validation
- Request logging, error handling, and basic authentication rate limiting
- PostgreSQL/Prisma persistence
- OpenAPI documentation and meaningful automated tests
- Docker Compose support for a local PostgreSQL database

### Out of scope for this slice

- Live games, scores, standings, statistics, or play-by-play
- Real commercial sports-provider calls
- News ingestion or AI summaries
- Predictions or accuracy tracking
- Team detail beyond the initial normalized record
- Player, injury, or transaction data
- Fantasy-provider imports and fantasy recommendations
- Additional followed teams
- Production email-vendor integration, email verification, password change for authenticated users, social login, roles, or administration
- Paid contests, wagering, and cash prizes
- Frontend implementation

## Product principles

- **Fast by default:** Keep response shapes focused and leave room for caching and provider-rate-limit protection.
- **Trustworthy:** Attribute sourced content, distinguish prediction from fact, and make accuracy measurable.
- **Provider-independent:** Product contracts use normalized internal models rather than vendor payloads.
- **Personal without friction:** A favorite team is optional at account creation and easy to change later.
- **Secure by design:** Authentication secrets and provider credentials stay in the backend; sensitive values are never logged.
- **Incremental:** Deliver thin, working vertical slices before broadening the domain.

## Success criteria for the first vertical slice

The slice is successful when an independent frontend can, against documented endpoints:

- List all active fixture-backed NFL teams in a stable normalized format.
- Register, log in, refresh, and log out.
- Set or replace the authenticated user's favorite team using an internal team ID.
- Retrieve the current user and favorite team without receiving password or token persistence fields.
- Receive predictable validation and error responses.

Engineering acceptance also requires passing automated tests, a reproducible local setup, validated configuration, and current OpenAPI documentation.

Product analytics targets such as registration conversion, favorite-team selection rate, retention, and API latency should be defined when a frontend and production telemetry plan exist. No numeric targets are assumed at this documentation stage.

## Assumptions and constraints

- NFL team fixture facts still require a provenance/licensing review before public production use, particularly logos and color data.
- Logo records may point to externally hosted assets and include their source; a URL does not imply redistribution rights.
- One account has at most one favorite team in the MVP, but the schema should not encode provider IDs into that relationship.
- The API is the integration boundary with a separately deployed frontend.
- Commercial provider selection is deferred; switching providers must not break user relationships.
