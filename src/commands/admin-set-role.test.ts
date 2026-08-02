import { describe, expect, it } from 'vitest';

import { parseArguments } from './admin-set-role.js';

describe('admin:set-role arguments', () => {
  it('accepts a normalized role for an existing-email lookup', () => {
    expect(parseArguments(['--email=Editor@Example.com', '--role=admin'])).toEqual({
      email: 'Editor@Example.com',
      role: 'ADMIN',
    });
  });

  it('rejects invalid roles and missing emails', () => {
    expect(() => parseArguments(['--email=user@example.com', '--role=OWNER'])).toThrow(
      expect.objectContaining({ code: 'ROLE_ARGUMENTS_INVALID' }),
    );
    expect(() => parseArguments(['--role=ADMIN'])).toThrow(
      expect.objectContaining({ code: 'ROLE_ARGUMENTS_INVALID' }),
    );
  });
});
