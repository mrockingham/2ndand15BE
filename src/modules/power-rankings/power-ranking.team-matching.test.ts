import { describe, expect, it } from 'vitest';

import type { TeamIdentity } from './power-ranking.repository.js';
import type { PowerRankingImportEntry } from './power-ranking.schemas.js';
import {
  buildTeamLookup,
  isTeamMatchError,
  matchImportEntryToTeam,
} from './power-ranking.team-matching.js';

const RAMS: TeamIdentity = {
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Rams',
  fullName: 'Los Angeles Rams',
  abbreviation: 'LAR',
  conference: 'NFC',
  division: 'West',
};
const CHIEFS: TeamIdentity = {
  id: '00000000-0000-4000-8000-000000000002',
  name: 'Chiefs',
  fullName: 'Kansas City Chiefs',
  abbreviation: 'KC',
  conference: 'AFC',
  division: 'West',
};

const lookup = buildTeamLookup([RAMS, CHIEFS]);

function entry(overrides: Partial<PowerRankingImportEntry> = {}): PowerRankingImportEntry {
  return {
    rank: 1,
    teamId: 'los-angeles-rams',
    team: 'Los Angeles Rams',
    abbreviation: 'LAR',
    conference: 'NFC',
    division: 'West',
    tier: 'Contender',
    headline: 'A fictional headline',
    summary: 'A fictional forty-plus character summary used for testing.',
    strengths: ['Fictional strength'],
    concerns: ['Fictional concern'],
    ...overrides,
  };
}

describe('matchImportEntryToTeam', () => {
  it('matches by an existing Team UUID when teamId happens to be one', () => {
    const result = matchImportEntryToTeam(entry({ teamId: RAMS.id }), lookup);
    expect(isTeamMatchError(result)).toBe(false);
    if (!isTeamMatchError(result)) {
      expect(result.matchedTeam.id).toBe(RAMS.id);
      expect(result.matchedBy).toBe('ID');
    }
  });

  it('matches by abbreviation when teamId is not a UUID', () => {
    const result = matchImportEntryToTeam(entry({ teamId: 'lar-rams' }), lookup);
    expect(isTeamMatchError(result)).toBe(false);
    if (!isTeamMatchError(result)) expect(result.matchedBy).toBe('ABBREVIATION');
  });

  it('accepts a conference-prefixed division ("NFC West") as equivalent to the bare stored value ("West")', () => {
    const result = matchImportEntryToTeam(entry({ division: 'NFC West' }), lookup);
    expect(isTeamMatchError(result)).toBe(false);
  });

  it('falls back to a normalized slug match derived from teamId', () => {
    const result = matchImportEntryToTeam(
      entry({ teamId: 'los-angeles-rams', abbreviation: 'ZZZ' }),
      lookup,
    );
    // abbreviation "ZZZ" doesn't match any team, but the slug does -- however
    // the matched team's real abbreviation ("LAR") then disagrees with the
    // entry's supplied "ZZZ", so this must be rejected as a mismatch, not
    // silently matched.
    expect(isTeamMatchError(result)).toBe(true);
  });

  it('rejects an unknown team (no UUID, abbreviation, or slug match)', () => {
    const result = matchImportEntryToTeam(
      entry({ teamId: 'nonexistent-team', abbreviation: 'ZZZ', team: 'Nonexistent Team' }),
      lookup,
    );
    expect(isTeamMatchError(result)).toBe(true);
    if (isTeamMatchError(result)) expect(result.message).toMatch(/No active NFL team matches/);
  });

  it('rejects an entry whose abbreviation disagrees with the matched canonical Team', () => {
    const result = matchImportEntryToTeam(
      entry({ teamId: 'los-angeles-rams', abbreviation: 'LAC' }),
      lookup,
    );
    expect(isTeamMatchError(result)).toBe(true);
    if (isTeamMatchError(result)) expect(result.message).toMatch(/abbreviation/);
  });

  it('rejects an entry whose conference/division disagrees with the matched canonical Team', () => {
    const result = matchImportEntryToTeam(entry({ conference: 'AFC' }), lookup);
    expect(isTeamMatchError(result)).toBe(true);
    if (isTeamMatchError(result)) expect(result.message).toMatch(/conference/);
  });

  it('rejects an entry whose team name disagrees with the matched canonical Team', () => {
    const result = matchImportEntryToTeam(entry({ team: 'Completely Different Name' }), lookup);
    expect(isTeamMatchError(result)).toBe(true);
    if (isTeamMatchError(result)) expect(result.message).toMatch(/team name/);
  });

  it('never mutates or reports the canonical Team record as changed', () => {
    const before = { ...RAMS };
    matchImportEntryToTeam(entry(), lookup);
    expect(RAMS).toEqual(before);
  });
});
