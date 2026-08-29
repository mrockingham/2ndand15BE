import { assertSafeDatabaseUrlForRuntime } from '../../src/common/database/prisma.js';

/**
 * M42B.1: the one function every `*.database.test.ts` file should call to
 * get its connection string -- never `loadConfig().databaseUrl` /
 * `loadDatabaseConfig().databaseUrl` / `loadNewsIngestionConfig().databaseUrl`,
 * all of which resolve to the application's own `DATABASE_URL`.
 *
 * Fails closed with an actionable message if `TEST_DATABASE_URL` is unset,
 * and re-runs the same structural guard `createPrismaClient` itself applies
 * (so misconfiguration is caught here, before ever calling out to Prisma,
 * with a message pointed at the test setup rather than a generic one).
 */
export function resolveTestDatabaseUrl(
  env: Record<string, string | undefined> = process.env,
): string {
  const url = env.TEST_DATABASE_URL;
  if (url === undefined || url.trim().length === 0) {
    throw new Error(
      'TEST_DATABASE_URL is required to run database-backed integration tests. Set it to a ' +
        "dedicated test database or Neon branch -- never the application's own DATABASE_URL. " +
        'See docs/testing/database-tests.md for setup instructions.',
    );
  }
  assertSafeDatabaseUrlForRuntime(url, env);
  return url;
}
