import { describe, expect, it } from 'vitest';

import { roleHasCapability } from './admin-authorization.js';

describe('administrative capabilities', () => {
  it('keeps users out, grants editor operations narrowly, and grants admins all capabilities', () => {
    expect(roleHasCapability('USER', 'VIEW_SCHEDULE')).toBe(false);
    expect(roleHasCapability('EDITOR', 'EDIT_SCHEDULE')).toBe(true);
    expect(roleHasCapability('EDITOR', 'VIEW_SCHEDULE_AUDIT')).toBe(true);
    expect(roleHasCapability('EDITOR', 'REMOVE_OVERRIDE')).toBe(false);
    expect(roleHasCapability('EDITOR', 'VIEW_FULL_AUDIT')).toBe(false);
    expect(roleHasCapability('ADMIN', 'REMOVE_OVERRIDE')).toBe(true);
    expect(roleHasCapability('ADMIN', 'MANAGE_ROLES')).toBe(true);
  });
});
