import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createRateLimiter } from './common/middleware/rate-limit.js';

/**
 * Exercises Express's own `trust proxy` resolution (set via
 * `app.set('trust proxy', options.config.trustProxy)` in src/app.ts) rather
 * than any custom IP-parsing logic -- see docs/production/deployment.md and
 * the TRUST_PROXY schema in src/config/env.ts. These tests build a bare
 * express() app (not createApp) so behavior under test is exactly Express's
 * built-in `trust proxy` handling for `req.ip`/`req.ips`.
 *
 * A numeric `trust proxy` counts hops starting from the direct socket peer
 * (hop 0, always trusted once the count is >= 1): `req.ip` resolves to the
 * X-Forwarded-For entry sitting immediately past the trusted zone, counting
 * from the right (nearest the app). With one legitimate reverse proxy in
 * front of the app (the realistic single-hop deployment), that proxy
 * appends exactly one address -- the real client's -- to X-Forwarded-For,
 * so `trustProxy = 1` resolves `req.ip` to that single entry. Verified
 * empirically against this Express version rather than assumed from docs.
 */

interface WhoamiBody {
  readonly ip: string | undefined;
  readonly ips: readonly string[];
}

function whoamiApp(trustProxy: number | readonly string[]): express.Express {
  const app = express();
  app.set('trust proxy', trustProxy);
  app.get('/whoami', (req, res) => {
    res.json({ ip: req.ip, ips: req.ips });
  });
  return app;
}

describe('trust proxy resolution', () => {
  it('ignores a spoofed X-Forwarded-For header when trust proxy is disabled (default)', async () => {
    const app = whoamiApp(0);

    const response = await request(app)
      .get('/whoami')
      .set('X-Forwarded-For', '9.9.9.9')
      .expect(200);

    const body = response.body as WhoamiBody;
    expect(body.ip).not.toBe('9.9.9.9');
  });

  it('resolves the real client IP through one trusted proxy hop', async () => {
    const app = whoamiApp(1);

    // Realistic single-proxy deployment: the one legitimate reverse proxy
    // appends exactly the real client's address.
    const response = await request(app)
      .get('/whoami')
      .set('X-Forwarded-For', '5.5.5.5')
      .expect(200);

    const body = response.body as WhoamiBody;
    expect(body.ip).toBe('5.5.5.5');
  });

  it('does not let a spoofed extra hop override the real client behind the trusted hop count', async () => {
    const app = whoamiApp(1);

    // Attacker prepends a fake extra hop ahead of what the real proxy sent.
    // With hop count 1, Express only trusts the immediate proxy's own
    // append and resolves the client from just past that trusted boundary
    // -- the spoofed leading entry is never used as req.ip.
    const response = await request(app)
      .get('/whoami')
      .set('X-Forwarded-For', '9.9.9.9, 5.5.5.5')
      .expect(200);

    const body = response.body as WhoamiBody;
    expect(body.ip).toBe('5.5.5.5');
    expect(body.ip).not.toBe('9.9.9.9');
  });

  it('keys the rate limiter off the resolved client IP, not the raw connection', async () => {
    const app = whoamiApp(1);
    app.use(createRateLimiter({ windowMs: 60_000, max: 1 }));
    app.get('/limited', (req, res) => {
      res.json({ ip: req.ip });
    });

    const first = await request(app).get('/limited').set('X-Forwarded-For', '1.1.1.1').expect(200);
    expect((first.body as WhoamiBody).ip).toBe('1.1.1.1');

    const second = await request(app).get('/limited').set('X-Forwarded-For', '2.2.2.2').expect(200);
    expect((second.body as WhoamiBody).ip).toBe('2.2.2.2');

    const third = await request(app).get('/limited').set('X-Forwarded-For', '1.1.1.1').expect(429);
    expect(third.status).toBe(429);
  });
});
