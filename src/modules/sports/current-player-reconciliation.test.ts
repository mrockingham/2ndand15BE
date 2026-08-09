import { describe, expect, it } from 'vitest';

import type { NormalizedCurrentPlayerProfile } from './current-player-identity-provider.js';
import {
  candidateLookupNames,
  reconcileCurrentPlayer,
  type CurrentPlayerIdentityCandidate,
} from './current-player-reconciliation.js';

describe('current player identity reconciliation', () => {
  it('uses an existing provider mapping without requiring a profile', () => {
    expect(reconcile({ existingPlayerId: 'internal-player', profile: undefined })).toMatchObject({
      method: 'EXISTING_MAPPING',
      playerId: 'internal-player',
    });
  });

  it('matches exact name, birth date, and compatible position despite a stale team', () => {
    expect(
      reconcile({
        candidates: [candidate({ latestTeamId: 'old-team', rosterTeamIds: ['old-team'] })],
      }),
    ).toMatchObject({ method: 'STRONG_PROFILE', playerId: 'internal-player' });
  });

  it('rejects the same name with a different birth date', () => {
    expect(reconcile({ candidates: [candidate({ birthDate: '1999-01-02' })] })).toMatchObject({
      method: 'UNRESOLVED',
      playerId: null,
    });
  });

  it('marks colliding exact profiles ambiguous', () => {
    expect(
      reconcile({ candidates: [candidate(), candidate({ id: 'other-player' })] }),
    ).toMatchObject({ method: 'AMBIGUOUS', playerId: null });
  });

  it('never accepts name-only evidence', () => {
    expect(
      reconcile({
        profile: profile({ birthDate: null, position: null, jerseyNumber: null }),
        candidates: [candidate({ birthDate: null, position: null, jerseyNumber: null })],
      }),
    ).toMatchObject({ method: 'UNRESOLVED' });
  });

  it('uses the controlled missing-DOB fallback only with position, team, and corroboration', () => {
    expect(
      reconcile({
        candidates: [candidate({ birthDate: null })],
      }),
    ).toMatchObject({ method: 'STRONG_PROFILE', playerId: 'internal-player' });
  });

  it('classifies a complete profile with no name candidate as a new current player', () => {
    expect(reconcile({ candidates: [] })).toMatchObject({
      method: 'NEW_CURRENT_PLAYER',
      playerId: null,
    });
  });

  it('does not create a duplicate when a DOB candidate has a different displayed name', () => {
    expect(
      reconcile({
        candidates: [candidate({ displayName: 'Known Alias', normalizedName: 'known alias' })],
      }),
    ).toMatchObject({ method: 'UNRESOLVED', playerId: null });
  });

  it('does not fuzzy-match and preserves suffixes while comparing initials conservatively', () => {
    expect(candidateLookupNames('A.J. Brown')).toContain('aj brown');
    expect(
      reconcile({
        boxScoreName: 'Example Player Jr.',
        profile: profile({ displayName: 'Example Player' }),
        candidates: [candidate()],
      }),
    ).toMatchObject({ method: 'UNRESOLVED' });
  });
});

function reconcile(overrides: Partial<Parameters<typeof reconcileCurrentPlayer>[0]> = {}) {
  return reconcileCurrentPlayer({
    providerPlayerId: 'provider-player',
    boxScoreName: 'Example Player',
    teamId: 'game-team',
    teamProviderId: 'provider-team',
    profile: profile(),
    candidates: [candidate()],
    ...overrides,
  });
}

function profile(
  overrides: Partial<NormalizedCurrentPlayerProfile> = {},
): NormalizedCurrentPlayerProfile {
  return {
    providerPlayerId: 'provider-player',
    displayName: 'Example Player',
    birthDate: '2000-01-01',
    position: 'RB',
    sourcePosition: 'Running Back',
    jerseyNumber: 22,
    teamProviderId: 'provider-team',
    teamAbbreviation: 'ARI',
    heightInches: 72,
    weightPounds: 210,
    draftYear: 2022,
    draftRound: 2,
    draftPick: 50,
    isActive: true,
    ...overrides,
  };
}

function candidate(
  overrides: Partial<CurrentPlayerIdentityCandidate> = {},
): CurrentPlayerIdentityCandidate {
  return {
    id: 'internal-player',
    displayName: 'Example Player',
    normalizedName: 'example player',
    birthDate: '2000-01-01',
    position: 'HB',
    jerseyNumber: 22,
    heightInches: 72,
    weightPounds: 210,
    draftYear: 2022,
    draftRound: 2,
    draftPick: 50,
    latestTeamId: 'game-team',
    rosterTeamIds: ['game-team'],
    ...overrides,
  };
}
