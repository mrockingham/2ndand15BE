import { describe, expect, it } from 'vitest';

import { formatGameClock } from './game-clock.js';

describe('formatGameClock', () => {
  it('converts raw seconds remaining to M:SS', () => {
    expect(formatGameClock('857')).toBe('14:17');
    expect(formatGameClock('666')).toBe('11:06');
    expect(formatGameClock('120')).toBe('2:00');
    expect(formatGameClock('65')).toBe('1:05');
    expect(formatGameClock('0')).toBe('0:00');
  });

  it('preserves already-formatted M:SS / MM:SS values', () => {
    expect(formatGameClock('9:45')).toBe('9:45');
    expect(formatGameClock('12:03')).toBe('12:03');
  });

  it('strips a leading zero from already-formatted minutes', () => {
    expect(formatGameClock('05:09')).toBe('5:09');
  });

  it('returns null for null input', () => {
    expect(formatGameClock(null)).toBeNull();
  });

  it('returns null for malformed seconds fields', () => {
    expect(formatGameClock('61')).not.toBeNull(); // sanity: 61s is plausible (1:01)
    expect(formatGameClock('9:60')).toBeNull(); // seconds out of range
    expect(formatGameClock('abc')).toBeNull();
    expect(formatGameClock('')).toBeNull();
    expect(formatGameClock('-5')).toBeNull();
    expect(formatGameClock('99999')).toBeNull(); // implausibly large
  });
});
