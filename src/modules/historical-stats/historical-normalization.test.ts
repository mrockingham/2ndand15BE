import { describe, expect, it } from 'vitest';

import {
  canonicalTeamAbbreviation,
  nflversePlayerIdentifiers,
  nflversePlayerSchema,
  nflversePlayerStatSchema,
  nflverseRosterSchema,
  normalizePlayerName,
} from './historical-normalization.js';

function validStat(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    player_id: '00-0000001',
    player_display_name: 'Test Player',
    position: 'WR',
    position_group: 'WR',
    season: 2025,
    week: 1,
    season_type: 'REG',
    game_id: '2025_01_BUF_NYJ',
    team: 'BUF',
    opponent_team: 'NYJ',
    completions: 0,
    attempts: 0,
    receptions: 0,
    targets: 0,
    fg_made: 0,
    fg_att: 0,
    pat_made: 0,
    pat_att: 0,
    ...overrides,
  };
}

describe('historical normalization', () => {
  it('preserves missing separately from a factual zero', () => {
    const missing = nflversePlayerStatSchema.parse(validStat({ carries: null }));
    const zero = nflversePlayerStatSchema.parse(validStat({ carries: 0 }));
    expect(missing.carries).toBeNull();
    expect(zero.carries).toBe(0);
  });

  it.each([
    [{ completions: 2, attempts: 1 }, 'Completions'],
    [{ receptions: 2, targets: 1 }, 'Receptions'],
    [{ fg_made: 2, fg_att: 1 }, 'Field goals'],
    [{ pat_made: 2, pat_att: 1 }, 'Extra points'],
    [{ attempts: -1 }, 'Counting statistic'],
  ])('rejects impossible stat relationships', (overrides, message) => {
    const result = nflversePlayerStatSchema.safeParse(validStat(overrides));
    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.issues.some((issue) => issue.message.includes(message))).toBe(true);
  });

  it('normalizes historical team aliases without inventing free-agent teams', () => {
    expect(canonicalTeamAbbreviation('LA')).toBe('LAR');
    expect(canonicalTeamAbbreviation('JAC')).toBe('JAX');
    expect(canonicalTeamAbbreviation('FA')).toBeNull();
  });

  it('builds a punctuation-insensitive normalized search name', () => {
    expect(normalizePlayerName('Amon-Ra St. Brown')).toBe('amon ra st brown');
  });

  it('requires stable roster identity and does not identify by name', () => {
    const result = nflverseRosterSchema.safeParse({
      season: 2025,
      team: 'BUF',
      full_name: 'Same Name',
      gsis_id: null,
      week: 1,
      game_type: 'REG',
    });
    expect(result.success).toBe(false);
  });

  it('keeps a legacy GSIS fallback as ESB rather than masquerading as GSIS', () => {
    const player = nflversePlayerSchema.parse({
      gsis_id: 'PRY456541',
      esb_id: 'PRY456541',
      display_name: 'Layne Pryor',
    });
    expect(nflversePlayerIdentifiers(player)).toContainEqual(['ESB', 'PRY456541']);
    expect(nflversePlayerIdentifiers(player).some(([provider]) => provider === 'GSIS')).toBe(false);
  });
});
