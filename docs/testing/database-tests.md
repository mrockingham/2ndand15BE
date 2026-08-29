# Database-backed integration tests

## Root cause this exists to prevent

Every `*.database.test.ts` file under `tests/integration/` previously connected via `createPrismaClient(loadConfig().databaseUrl)` (or `loadDatabaseConfig()`/`loadNewsIngestionConfig()` -- all three just read `DATABASE_URL`). Nothing distinguished "the database this test should use" from "the database the running application is configured against." In a checkout where `.env`'s `DATABASE_URL` points at a real, shared database (as it does in this project's primary development checkout, which points at production Neon), running these tests connected straight to that database. This was not hypothetical: an M42B integration test run briefly auto-published real production articles before being caught and fully reverted.

## The guard

`src/common/database/prisma.ts`'s `createPrismaClient` -- the single chokepoint every database connection in this codebase goes through (HTTP server, every CLI command, every integration test) -- now calls `assertSafeDatabaseUrlForRuntime` before opening a connection. The check is structural, not a matter of remembering to opt in:

- It only ever activates when `NODE_ENV=test`. Vitest sets this automatically for every run, including plain `npm test`. Production (`NODE_ENV=production`) and local development (`NODE_ENV=development`) are unaffected by construction -- the function returns immediately for any other value.
- Under `NODE_ENV=test`, it refuses to proceed if:
  1. `DATABASE_ENVIRONMENT=production` is set (an explicit, operator-set marker -- refuses regardless of which URL variable produced the connection string), or
  2. the connection string being used is byte-for-byte identical to `DATABASE_URL` (the application's own already-configured "real database" identifier -- no hostname parsing or guessing involved).

Both checks are deterministic string/env comparisons, not heuristics.

## Test database setup

Database-backed tests must never call `loadConfig().databaseUrl` / `loadDatabaseConfig().databaseUrl` / `loadNewsIngestionConfig().databaseUrl` (all three resolve to the application's `DATABASE_URL`). Instead, every `*.database.test.ts` file resolves its connection through `tests/helpers/test-database.ts`'s `resolveTestDatabaseUrl()`:

```ts
import { createPrismaClient } from '../../src/common/database/prisma.js';
import { resolveTestDatabaseUrl } from '../helpers/test-database.js';

prisma = createPrismaClient(resolveTestDatabaseUrl());
```

`resolveTestDatabaseUrl()` reads `TEST_DATABASE_URL` and fails closed with an actionable error if it's unset, blank, or identical to `DATABASE_URL` -- the same structural check `createPrismaClient` applies, run earlier so the failure points at test setup rather than a generic Prisma error.

### Provisioning a dedicated test database

Pick one:

**Neon branch (recommended for this project -- matches production Postgres exactly):**

```sh
npx neonctl auth                       # one-time interactive login
npx neonctl branches create --project-id <project-id> --name test
npx neonctl connection-string test --project-id <project-id>
```

Set the printed connection string as `TEST_DATABASE_URL` in `.env`. A branch is a real, independent database -- migrations must be applied to it separately (`DATABASE_URL=<test-branch-url> npx prisma migrate deploy`) before running tests against it for the first time.

**Local PostgreSQL:**

```sh
createdb secondand15_test
DATABASE_URL=postgresql://<user>@localhost:5432/secondand15_test npx prisma migrate deploy
```

Set `TEST_DATABASE_URL=postgresql://<user>@localhost:5432/secondand15_test` in `.env`.

Either way, run the suite with:

```sh
RUN_DATABASE_TESTS=true npm test
```

`RUN_DATABASE_TESTS` gates whether the `*.database.test.ts` suites run at all (they're `describe.skipIf(!databaseTestsEnabled)`); `TEST_DATABASE_URL` gates which database they're allowed to touch once they do. Both are required together -- setting only one leaves the suites skipped (no `RUN_DATABASE_TESTS`) or fails closed with a clear error (`RUN_DATABASE_TESTS=true` but no valid `TEST_DATABASE_URL`).

## What's proven, and how

`src/common/database/prisma.test.ts` and `tests/helpers/test-database.test.ts` unit-test the guard and the resolver directly against constructed environment objects -- no live database connection is opened or needed to verify this logic, and that's deliberate: the property being proven ("does this function throw given these env values") doesn't depend on any real infrastructure. They cover:

- a database URL identified as production (identical to `DATABASE_URL`) is rejected under `NODE_ENV=test`;
- `DATABASE_ENVIRONMENT=production` rejects even a URL that looks like a test URL;
- a genuinely separate test database URL is accepted under `NODE_ENV=test`;
- the development database is accepted under `NODE_ENV=development` (unaffected, by construction);
- the production application runtime is unaffected under `NODE_ENV=production` (unaffected, by construction);
- `resolveTestDatabaseUrl` fails closed on a missing/blank `TEST_DATABASE_URL` and on one identical to `DATABASE_URL`.

This was also verified against the real failure mode it was built for: running `RUN_DATABASE_TESTS=true npx vitest run tests/integration/news-auto-publish.database.test.ts` with `TEST_DATABASE_URL` set to the real production connection string throws `ProductionDatabaseInTestRuntimeError` before any connection is attempted.
