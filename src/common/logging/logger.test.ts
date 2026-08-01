import { Writable } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { createLogger } from './logger.js';

describe('createLogger', () => {
  it('redacts authentication secrets at the root and one nested level', () => {
    let output = '';
    const destination = new Writable({
      write(chunk: Buffer, _encoding, callback) {
        output += chunk.toString();
        callback();
      },
    });
    const logger = createLogger({ logLevel: 'info' }, destination);

    logger.info({
      password: 'raw-password',
      accessToken: 'raw-access-token',
      apiKey: 'raw-api-sports-key',
      request: {
        headers: {
          authorization: 'Bearer raw-bearer-token',
          cookie: 'refresh_token=raw-refresh-token',
          'x-apisports-key': 'raw-api-sports-header',
        },
        tokenHash: 'hashed-token-value',
      },
    });

    expect(output).not.toContain('raw-password');
    expect(output).not.toContain('raw-access-token');
    expect(output).not.toContain('raw-bearer-token');
    expect(output).not.toContain('raw-refresh-token');
    expect(output).not.toContain('hashed-token-value');
    expect(output).not.toContain('raw-api-sports-key');
    expect(output).not.toContain('raw-api-sports-header');
    expect(output).toContain('[REDACTED]');
  });
});
