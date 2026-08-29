import { describe, expect, it } from 'vitest';

import { resolveTestDatabaseUrl } from './test-database.js';

const PRODUCTION_URL = 'postgresql://neondb_owner:secret@ep-prod.us-east-1.aws.neon.tech/neondb';
const TEST_URL = 'postgresql://test_owner:secret@ep-test-branch.us-east-1.aws.neon.tech/neondb';

describe('resolveTestDatabaseUrl', () => {
  it('returns TEST_DATABASE_URL when it is set and distinct from DATABASE_URL', () => {
    const url = resolveTestDatabaseUrl({
      NODE_ENV: 'test',
      DATABASE_URL: PRODUCTION_URL,
      TEST_DATABASE_URL: TEST_URL,
    });
    expect(url).toBe(TEST_URL);
  });

  it('throws a clear, actionable error when TEST_DATABASE_URL is unset', () => {
    expect(() =>
      resolveTestDatabaseUrl({ NODE_ENV: 'test', DATABASE_URL: PRODUCTION_URL }),
    ).toThrow(/TEST_DATABASE_URL is required/);
  });

  it('throws a clear, actionable error when TEST_DATABASE_URL is blank', () => {
    expect(() =>
      resolveTestDatabaseUrl({
        NODE_ENV: 'test',
        DATABASE_URL: PRODUCTION_URL,
        TEST_DATABASE_URL: '   ',
      }),
    ).toThrow(/TEST_DATABASE_URL is required/);
  });

  it('refuses a TEST_DATABASE_URL that is identical to the production DATABASE_URL', () => {
    expect(() =>
      resolveTestDatabaseUrl({
        NODE_ENV: 'test',
        DATABASE_URL: PRODUCTION_URL,
        TEST_DATABASE_URL: PRODUCTION_URL,
      }),
    ).toThrow(/same connection string as/);
  });
});
