import { describe, expect, it } from 'vitest';

import {
  ProductionDatabaseInTestRuntimeError,
  assertSafeDatabaseUrlForRuntime,
  type DatabaseGuardEnvironment,
} from './prisma.js';

const PRODUCTION_URL = 'postgresql://neondb_owner:secret@ep-prod.us-east-1.aws.neon.tech/neondb';
const TEST_URL = 'postgresql://test_owner:secret@ep-test-branch.us-east-1.aws.neon.tech/neondb';
const DEV_URL = 'postgresql://secondand15:secondand15@localhost:5432/secondand15';

describe('assertSafeDatabaseUrlForRuntime', () => {
  it('rejects a database URL identified as production under NODE_ENV=test (same string as DATABASE_URL)', () => {
    const env: DatabaseGuardEnvironment = { NODE_ENV: 'test', DATABASE_URL: PRODUCTION_URL };
    expect(() => {
      assertSafeDatabaseUrlForRuntime(PRODUCTION_URL, env);
    }).toThrow(ProductionDatabaseInTestRuntimeError);
  });

  it('rejects any database URL under NODE_ENV=test when DATABASE_ENVIRONMENT=production, even one that looks like a test URL', () => {
    const env: DatabaseGuardEnvironment = {
      NODE_ENV: 'test',
      DATABASE_URL: PRODUCTION_URL,
      DATABASE_ENVIRONMENT: 'production',
    };
    expect(() => {
      assertSafeDatabaseUrlForRuntime(TEST_URL, env);
    }).toThrow(ProductionDatabaseInTestRuntimeError);
  });

  it('accepts a genuinely separate test database URL under NODE_ENV=test', () => {
    const env: DatabaseGuardEnvironment = { NODE_ENV: 'test', DATABASE_URL: PRODUCTION_URL };
    expect(() => {
      assertSafeDatabaseUrlForRuntime(TEST_URL, env);
    }).not.toThrow();
  });

  it('accepts a test database URL under NODE_ENV=test when DATABASE_URL is unset entirely', () => {
    const env: DatabaseGuardEnvironment = { NODE_ENV: 'test' };
    expect(() => {
      assertSafeDatabaseUrlForRuntime(TEST_URL, env);
    }).not.toThrow();
  });

  it('accepts the development database under NODE_ENV=development, even if it were somehow identical to DATABASE_URL', () => {
    const env: DatabaseGuardEnvironment = { NODE_ENV: 'development', DATABASE_URL: DEV_URL };
    expect(() => {
      assertSafeDatabaseUrlForRuntime(DEV_URL, env);
    }).not.toThrow();
  });

  it('leaves the production application runtime completely unaffected under NODE_ENV=production', () => {
    const env: DatabaseGuardEnvironment = { NODE_ENV: 'production', DATABASE_URL: PRODUCTION_URL };
    expect(() => {
      assertSafeDatabaseUrlForRuntime(PRODUCTION_URL, env);
    }).not.toThrow();
  });

  it('does not engage at all when NODE_ENV is unset', () => {
    const env: DatabaseGuardEnvironment = { DATABASE_URL: PRODUCTION_URL };
    expect(() => {
      assertSafeDatabaseUrlForRuntime(PRODUCTION_URL, env);
    }).not.toThrow();
  });
});
