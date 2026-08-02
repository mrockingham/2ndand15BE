import { describe, expect, it } from 'vitest';

import { sanitizeAuditSnapshot } from './audit-sanitizer.js';

describe('audit snapshot sanitization', () => {
  it('redacts nested credential-like keys while retaining safe administrative facts', () => {
    expect(
      sanitizeAuditSnapshot({
        gameId: 'game-1',
        authorization: 'Bearer private',
        nested: { refreshToken: 'private', status: 'SCHEDULED' },
      }),
    ).toEqual({
      gameId: 'game-1',
      authorization: '[REDACTED]',
      nested: { refreshToken: '[REDACTED]', status: 'SCHEDULED' },
    });
  });
});
