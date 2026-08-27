#!/usr/bin/env node
/**
 * Production smoke test.
 *
 * A dependency-free Node ESM script that exercises a running deployment's
 * public HTTP surface (and, optionally, an authenticated flow using
 * disposable smoke credentials) to confirm the deployment is basically
 * healthy. Intended to be run by a human or a deploy pipeline step AFTER a
 * deployment, against a real base URL -- never imported as a module.
 *
 * Usage:
 *   SMOKE_API_BASE_URL=https://api.example.com node scripts/production-smoke.mjs
 *
 * Environment variables:
 *   SMOKE_API_BASE_URL   required. Base URL of the deployment, WITHOUT the
 *                         /api/v1 suffix (it's appended automatically).
 *   SMOKE_GAME_ID         optional. An internal game UUID to exercise
 *                         game-specific read endpoints. Skipped (with a
 *                         warning) if unset.
 *   SMOKE_TEST_EMAIL       optional (with SMOKE_TEST_PASSWORD). Credentials
 *   SMOKE_TEST_PASSWORD    for a disposable smoke-test account used to
 *                         exercise the authenticated login/me/refresh/logout
 *                         flow. Both must be set together; if either is
 *                         missing, the auth checks are skipped with a
 *                         warning. This script NEVER registers a new user --
 *                         the account must already exist.
 *
 * This script never throws uncaught: every check is individually wrapped,
 * prints a pass/fail line, and contributes to a final summary. Exit code is
 * 1 if any check failed, 0 otherwise.
 */

const baseUrl = process.env.SMOKE_API_BASE_URL;
const gameId = process.env.SMOKE_GAME_ID;
const testEmail = process.env.SMOKE_TEST_EMAIL;
const testPassword = process.env.SMOKE_TEST_PASSWORD;

if (!baseUrl) {
  console.error('✗ SMOKE_API_BASE_URL is required. Example:');
  console.error('  SMOKE_API_BASE_URL=https://api.example.com node scripts/production-smoke.mjs');
  process.exit(1);
}

const apiBase = `${baseUrl.replace(/\/+$/, '')}/api/v1`;

let passed = 0;
let failed = 0;

function pass(label, detail) {
  passed += 1;
  console.log(`✓ ${label}${detail ? ` -- ${detail}` : ''}`);
}

function fail(label, detail) {
  failed += 1;
  console.log(`✗ ${label}${detail ? ` -- ${detail}` : ''}`);
}

function warn(label) {
  console.log(`⚠ ${label}`);
}

/** Fetches JSON, never throwing -- returns { ok, status, body, error }. */
async function fetchJson(path, options = {}) {
  const url = `${apiBase}${path}`;
  try {
    const response = await fetch(url, options);
    let body;
    try {
      body = await response.json();
    } catch {
      body = undefined;
    }
    return { ok: true, status: response.status, body, headers: response.headers };
  } catch (error) {
    return {
      ok: false,
      status: null,
      body: undefined,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Runs one named check, swallowing any thrown error as a failure. */
async function check(label, fn) {
  try {
    await fn();
  } catch (error) {
    fail(label, `unexpected error: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function isArray(value) {
  return Array.isArray(value);
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// ---------------------------------------------------------------------------
// Public checks
// ---------------------------------------------------------------------------

async function runPublicChecks() {
  await check('GET /health', async () => {
    const result = await fetchJson('/health');
    if (!result.ok) return fail('GET /health', result.error);
    if (result.status !== 200) return fail('GET /health', `expected 200, got ${result.status}`);
    if (result.body?.data?.status !== 'ok') {
      return fail(
        'GET /health',
        `expected data.status === 'ok', got ${JSON.stringify(result.body)}`,
      );
    }
    pass('GET /health');
  });

  await check('GET /ready', async () => {
    const result = await fetchJson('/ready');
    if (!result.ok) return fail('GET /ready', result.error);
    if (result.status !== 200 && result.status !== 503) {
      return fail('GET /ready', `expected 200 or 503, got ${result.status}`);
    }
    if (typeof result.body?.data?.checks?.database !== 'boolean') {
      return fail(
        'GET /ready',
        `expected boolean data.checks.database, got ${JSON.stringify(result.body)}`,
      );
    }
    pass('GET /ready', `status=${result.status}, database=${result.body.data.checks.database}`);
  });

  await check('GET /teams', async () => {
    const result = await fetchJson('/teams');
    if (!result.ok) return fail('GET /teams', result.error);
    if (result.status !== 200) return fail('GET /teams', `expected 200, got ${result.status}`);
    if (!isArray(result.body?.data)) {
      return fail(
        'GET /teams',
        `expected data array, got ${JSON.stringify(result.body).slice(0, 200)}`,
      );
    }
    pass('GET /teams', `${result.body.data.length} teams`);
  });

  await check('GET /games', async () => {
    const result = await fetchJson('/games');
    if (!result.ok) return fail('GET /games', result.error);
    if (result.status !== 200) return fail('GET /games', `expected 200, got ${result.status}`);
    if (!isArray(result.body?.data)) {
      return fail(
        'GET /games',
        `expected data array, got ${JSON.stringify(result.body).slice(0, 200)}`,
      );
    }
    pass('GET /games', `${result.body.data.length} games`);
  });

  await check('GET /homepage', async () => {
    const result = await fetchJson('/homepage');
    if (!result.ok) return fail('GET /homepage', result.error);
    if (result.status !== 200) return fail('GET /homepage', `expected 200, got ${result.status}`);
    if (!isPlainObject(result.body?.data)) {
      return fail(
        'GET /homepage',
        `expected data object, got ${JSON.stringify(result.body).slice(0, 200)}`,
      );
    }
    pass('GET /homepage');
  });

  await check('GET /stats/metadata', async () => {
    const result = await fetchJson('/stats/metadata');
    if (!result.ok) return fail('GET /stats/metadata', result.error);
    if (result.status !== 200)
      return fail('GET /stats/metadata', `expected 200, got ${result.status}`);
    pass('GET /stats/metadata');
  });

  if (!gameId) {
    warn('SMOKE_GAME_ID not set -- skipping game-specific checks (GET /games/:id, /plays, /media)');
  } else {
    await check(`GET /games/${gameId}`, async () => {
      const result = await fetchJson(`/games/${gameId}`);
      if (!result.ok) return fail(`GET /games/${gameId}`, result.error);
      if (result.status !== 200)
        return fail(`GET /games/${gameId}`, `expected 200, got ${result.status}`);
      if (!isPlainObject(result.body?.data)) {
        return fail(
          `GET /games/${gameId}`,
          `expected data object, got ${JSON.stringify(result.body).slice(0, 200)}`,
        );
      }
      pass(`GET /games/${gameId}`);
    });

    await check(`GET /games/${gameId}/plays`, async () => {
      const result = await fetchJson(`/games/${gameId}/plays`);
      if (!result.ok) return fail(`GET /games/${gameId}/plays`, result.error);
      if (result.status !== 200)
        return fail(`GET /games/${gameId}/plays`, `expected 200, got ${result.status}`);
      pass(`GET /games/${gameId}/plays`);
    });

    await check(`GET /games/${gameId}/media`, async () => {
      const result = await fetchJson(`/games/${gameId}/media`);
      if (!result.ok) return fail(`GET /games/${gameId}/media`, result.error);
      if (result.status !== 200)
        return fail(`GET /games/${gameId}/media`, `expected 200, got ${result.status}`);
      pass(`GET /games/${gameId}/media`);
    });
  }
}

// ---------------------------------------------------------------------------
// Auth flow checks (only if both smoke credentials are set)
// ---------------------------------------------------------------------------

/** Extracts the refresh-token cookie's Set-Cookie header value verbatim, so
 * it can be replayed on the next request without parsing/storing a jar. */
function extractSetCookie(headers) {
  if (!headers) return null;
  const raw = typeof headers.getSetCookie === 'function' ? headers.getSetCookie() : null;
  if (raw && raw.length > 0) return raw.join('; ');
  const single = headers.get?.('set-cookie');
  return single ?? null;
}

function cookieHeaderFrom(setCookieValue) {
  if (!setCookieValue) return undefined;
  // Take just the "name=value" pairs (before the first ';' of each cookie).
  return setCookieValue
    .split(/,(?=[^;]+?=)/)
    .map((part) => part.split(';')[0].trim())
    .join('; ');
}

async function runAuthChecks() {
  if (!testEmail || !testPassword) {
    warn('SMOKE_TEST_EMAIL/SMOKE_TEST_PASSWORD not both set -- skipping authenticated flow checks');
    return;
  }

  let accessToken = null;
  let cookieHeader;

  await check('POST /auth/login', async () => {
    const result = await fetchJson('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testEmail, password: testPassword }),
    });
    if (!result.ok) return fail('POST /auth/login', result.error);
    if (result.status !== 200)
      return fail('POST /auth/login', `expected 200, got ${result.status}`);
    accessToken = result.body?.data?.accessToken ?? null;
    if (typeof accessToken !== 'string' || accessToken.length === 0) {
      return fail('POST /auth/login', 'no accessToken in response');
    }
    cookieHeader = cookieHeaderFrom(extractSetCookie(result.headers));
    pass('POST /auth/login');
  });

  if (!accessToken) {
    warn('Skipping /users/me, /auth/refresh, /auth/logout -- login did not succeed');
    return;
  }

  await check('GET /users/me', async () => {
    const result = await fetchJson('/users/me', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!result.ok) return fail('GET /users/me', result.error);
    if (result.status !== 200) return fail('GET /users/me', `expected 200, got ${result.status}`);
    pass('GET /users/me');
  });

  await check('POST /auth/refresh', async () => {
    const result = await fetchJson('/auth/refresh', {
      method: 'POST',
      headers: cookieHeader ? { Cookie: cookieHeader } : {},
    });
    if (!result.ok) return fail('POST /auth/refresh', result.error);
    if (result.status !== 200)
      return fail('POST /auth/refresh', `expected 200, got ${result.status}`);
    const newToken = result.body?.data?.accessToken;
    if (typeof newToken !== 'string' || newToken.length === 0) {
      return fail('POST /auth/refresh', 'no new accessToken in response');
    }
    const newCookie = cookieHeaderFrom(extractSetCookie(result.headers));
    if (newCookie) cookieHeader = newCookie;
    accessToken = newToken;
    pass('POST /auth/refresh');
  });

  await check('POST /auth/logout', async () => {
    const result = await fetchJson('/auth/logout', {
      method: 'POST',
      headers: cookieHeader ? { Cookie: cookieHeader } : {},
    });
    if (!result.ok) return fail('POST /auth/logout', result.error);
    if (result.status !== 200 && result.status !== 204) {
      return fail('POST /auth/logout', `expected 200 or 204, got ${result.status}`);
    }
    pass('POST /auth/logout');
  });
}

// ---------------------------------------------------------------------------
// Password reset check (never touches the real account's password)
// ---------------------------------------------------------------------------

async function runPasswordResetCheck() {
  const targetEmail = testEmail ?? 'production-smoke-test-nonexistent@example.com';

  await check('POST /auth/forgot-password', async () => {
    const result = await fetchJson('/auth/forgot-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: targetEmail }),
    });
    if (!result.ok) return fail('POST /auth/forgot-password', result.error);
    if (result.status !== 200) {
      return fail('POST /auth/forgot-password', `expected 200, got ${result.status}`);
    }
    if (typeof result.body?.data?.message !== 'string') {
      return fail(
        'POST /auth/forgot-password',
        `expected generic data.message, got ${JSON.stringify(result.body)}`,
      );
    }
    pass(
      'POST /auth/forgot-password',
      'generic response received (this script never calls /reset-password)',
    );
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log(`Production smoke test against ${apiBase}`);
  console.log('');

  await runPublicChecks();
  console.log('');
  await runAuthChecks();
  console.log('');
  await runPasswordResetCheck();

  console.log('');
  console.log(`${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error(
    '✗ Smoke test crashed unexpectedly:',
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
});
