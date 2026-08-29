import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from '../../generated/prisma/client.js';

/**
 * M42B.1: `createPrismaClient` is the one chokepoint every database
 * connection in this codebase goes through -- the HTTP server, every CLI
 * command, and every integration test. Placing the guard here (rather than
 * in test setup alone) means it cannot be bypassed by a test file that
 * forgets to opt in; it is structural, not a matter of developer discipline.
 *
 * The guard only ever activates when `NODE_ENV=test` (which Vitest sets
 * automatically for every test run, including `npm test`) -- production and
 * development runtimes are completely unaffected, by construction, since
 * the very first line returns immediately for any other `NODE_ENV`.
 */
export class ProductionDatabaseInTestRuntimeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProductionDatabaseInTestRuntimeError';
  }
}

export interface DatabaseGuardEnvironment {
  readonly NODE_ENV?: string;
  readonly DATABASE_URL?: string;
  readonly DATABASE_ENVIRONMENT?: string;
}

/**
 * Root cause this guards against: nothing previously stopped a
 * database-backed test from connecting to whatever `DATABASE_URL` happened
 * to resolve to -- in at least one real checkout, that was the production
 * Neon database, and an M42B integration test briefly auto-published real
 * production content as a result before being caught and reverted.
 *
 * Two independent, deterministic (never hostname-guessing) checks:
 *  1. `DATABASE_ENVIRONMENT=production` is an explicit, operator-set marker
 *     that unconditionally refuses any database connection under
 *     `NODE_ENV=test`, regardless of which URL variable produced it.
 *  2. The connection string being used must not be byte-for-byte identical
 *     to the application's own `DATABASE_URL` -- the app's already-
 *     configured single source of truth for "the real deployed database" is
 *     the simplest possible "explicit production database identifier"
 *     without parsing or guessing at hostnames. Tests must use a genuinely
 *     separate database (see `TEST_DATABASE_URL` /
 *     `tests/helpers/test-database.ts`).
 */
export function assertSafeDatabaseUrlForRuntime(
  databaseUrl: string,
  env: DatabaseGuardEnvironment = process.env,
): void {
  if (env.NODE_ENV !== 'test') return;

  if (env.DATABASE_ENVIRONMENT === 'production') {
    throw new ProductionDatabaseInTestRuntimeError(
      'Refusing to connect to a database under NODE_ENV=test: DATABASE_ENVIRONMENT=production. ' +
        'Database-backed tests must use a dedicated test database. See docs/testing/database-tests.md.',
    );
  }

  if (
    env.DATABASE_URL !== undefined &&
    env.DATABASE_URL.length > 0 &&
    databaseUrl === env.DATABASE_URL
  ) {
    throw new ProductionDatabaseInTestRuntimeError(
      'Refusing to connect to a database under NODE_ENV=test using the same connection string as ' +
        "DATABASE_URL. Tests must never reuse the application's own database connection -- set " +
        'TEST_DATABASE_URL to a dedicated test database or Neon branch. See docs/testing/database-tests.md.',
    );
  }
}

export function createPrismaClient(databaseUrl: string): PrismaClient {
  assertSafeDatabaseUrlForRuntime(databaseUrl);
  const adapter = new PrismaPg({ connectionString: databaseUrl });
  return new PrismaClient({ adapter });
}
