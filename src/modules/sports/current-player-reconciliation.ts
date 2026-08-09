import type { NormalizedCurrentPlayerProfile } from './current-player-identity-provider.js';

export type CurrentPlayerResolutionMethod =
  | 'EXISTING_MAPPING'
  | 'SHARED_EXTERNAL_ID'
  | 'STRONG_PROFILE'
  | 'NEW_CURRENT_PLAYER'
  | 'AMBIGUOUS'
  | 'UNRESOLVED';

export interface CurrentPlayerIdentityCandidate {
  readonly id: string;
  readonly displayName: string;
  readonly normalizedName: string;
  readonly birthDate: string | null;
  readonly position: string | null;
  readonly jerseyNumber: number | null;
  readonly heightInches: number | null;
  readonly weightPounds: number | null;
  readonly draftYear: number | null;
  readonly draftRound: number | null;
  readonly draftPick: number | null;
  readonly latestTeamId: string | null;
  readonly rosterTeamIds: readonly string[];
}

export interface CurrentPlayerResolution {
  readonly providerPlayerId: string;
  readonly method: CurrentPlayerResolutionMethod;
  readonly playerId: string | null;
  readonly profile: NormalizedCurrentPlayerProfile | null;
  readonly teamId: string;
  readonly evidence: readonly string[];
  readonly candidates: readonly CurrentPlayerIdentityCandidate[];
}

export function reconcileCurrentPlayer(input: {
  readonly providerPlayerId: string;
  readonly boxScoreName: string;
  readonly teamId: string;
  readonly teamProviderId: string;
  readonly existingPlayerId?: string | undefined;
  readonly profile?: NormalizedCurrentPlayerProfile | undefined;
  readonly candidates: readonly CurrentPlayerIdentityCandidate[];
}): CurrentPlayerResolution {
  if (input.existingPlayerId !== undefined) {
    return resolution(input, 'EXISTING_MAPPING', input.existingPlayerId, null, [
      'providerPlayerId',
    ]);
  }
  const profile = input.profile;
  if (profile === undefined) return resolution(input, 'UNRESOLVED', null, null, []);
  if (
    canonicalIdentityName(profile.displayName) !== canonicalIdentityName(input.boxScoreName) ||
    profile.teamProviderId !== input.teamProviderId
  ) {
    return resolution(input, 'UNRESOLVED', null, profile, []);
  }

  const nameCandidates = input.candidates.filter(
    (candidate) =>
      canonicalIdentityName(candidate.displayName) === canonicalIdentityName(profile.displayName),
  );
  const strong = nameCandidates.filter(
    (candidate) =>
      profile.birthDate !== null &&
      candidate.birthDate === profile.birthDate &&
      positionsCompatible(candidate.position, profile.position),
  );
  if (strong.length === 1) {
    return resolution(input, 'STRONG_PROFILE', strong[0]?.id ?? null, profile, [
      'normalizedFullName',
      'birthDate',
      'position',
    ]);
  }
  if (strong.length > 1) return resolution(input, 'AMBIGUOUS', null, profile, [], strong);

  const fallback = nameCandidates.filter((candidate) => {
    if (profile.birthDate === null || candidate.birthDate !== null) return false;
    if (!positionsCompatible(candidate.position, profile.position)) return false;
    const team =
      candidate.latestTeamId === input.teamId || candidate.rosterTeamIds.includes(input.teamId);
    const jersey = profile.jerseyNumber !== null && candidate.jerseyNumber === profile.jerseyNumber;
    const draft =
      profile.draftYear !== null &&
      candidate.draftYear === profile.draftYear &&
      (profile.draftRound === null || candidate.draftRound === profile.draftRound) &&
      (profile.draftPick === null || candidate.draftPick === profile.draftPick);
    const physical =
      profile.heightInches !== null &&
      profile.weightPounds !== null &&
      candidate.heightInches === profile.heightInches &&
      candidate.weightPounds === profile.weightPounds;
    return team && (jersey || draft || physical);
  });
  if (fallback.length === 1) {
    return resolution(input, 'STRONG_PROFILE', fallback[0]?.id ?? null, profile, [
      'normalizedFullName',
      'position',
      'teamHistory',
      'profileCorroboration',
    ]);
  }
  if (fallback.length > 1) return resolution(input, 'AMBIGUOUS', null, profile, [], fallback);
  if (nameCandidates.length > 0) {
    return resolution(input, 'UNRESOLVED', null, profile, [], nameCandidates);
  }
  if (input.candidates.length > 0) {
    return resolution(input, 'UNRESOLVED', null, profile, [], input.candidates);
  }
  if (
    profile.position !== null &&
    profile.birthDate !== null &&
    profile.teamProviderId === input.teamProviderId &&
    (profile.jerseyNumber !== null || profile.draftYear !== null)
  ) {
    return resolution(input, 'NEW_CURRENT_PLAYER', null, profile, [
      'providerPlayerId',
      'normalizedFullName',
      'birthDate',
      'position',
      'gameTeam',
      profile.jerseyNumber !== null ? 'jersey' : 'draftYear',
    ]);
  }
  return resolution(input, 'UNRESOLVED', null, profile, []);
}

export function candidateLookupNames(name: string): readonly string[] {
  const normalized = normalizeCandidateName(name);
  const tokens = normalized.split(' ');
  const first = tokens[0] ?? '';
  const variants = new Set([normalized]);
  variants.add(
    name
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .replace(/\s+/g, ' '),
  );
  if (/^[a-z]{2,3}$/.test(first))
    variants.add([...Array.from(first), ...tokens.slice(1)].join(' '));
  if (tokens.length >= 3 && tokens.slice(0, -1).every((token) => /^[a-z]$/.test(token))) {
    variants.add([tokens.slice(0, -1).join(''), tokens.at(-1) ?? ''].join(' ').trim());
  }
  return [...variants];
}

export function normalizeCandidateName(value: string): string {
  return value
    .normalize('NFC')
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/\./g, '')
    .replace(/[^\p{L}\p{N}' -]+/gu, ' ')
    .replace(/['-]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function canonicalIdentityName(value: string): string {
  const tokens = normalizeCandidateName(value).split(' ');
  const suffixes = new Set(['jr', 'sr', 'ii', 'iii', 'iv']);
  const suffix = suffixes.has(tokens.at(-1) ?? '') ? tokens.pop() : undefined;
  const firstTokens: string[] = [];
  while (tokens.length > 1 && /^[a-z]$/.test(tokens[0] ?? '')) {
    firstTokens.push(tokens.shift() ?? '');
  }
  if (firstTokens.length > 0) tokens.unshift(firstTokens.join(''));
  if (suffix !== undefined) tokens.push(suffix);
  return tokens.join(' ');
}

function positionsCompatible(left: string | null, right: string | null): boolean {
  if (left === null || right === null) return false;
  return normalizePosition(left) === normalizePosition(right);
}

function normalizePosition(value: string): string {
  const position = value.trim().toUpperCase();
  const aliases: Readonly<Record<string, string>> = {
    HB: 'RB',
    FB: 'RB',
    NT: 'DT',
    DE: 'DL',
    PK: 'K',
  };
  return aliases[position] ?? position;
}

function resolution(
  input: {
    readonly providerPlayerId: string;
    readonly teamId: string;
    readonly candidates: readonly CurrentPlayerIdentityCandidate[];
  },
  method: CurrentPlayerResolutionMethod,
  playerId: string | null,
  profile: NormalizedCurrentPlayerProfile | null,
  evidence: readonly string[],
  candidates: readonly CurrentPlayerIdentityCandidate[] = input.candidates,
): CurrentPlayerResolution {
  return {
    providerPlayerId: input.providerPlayerId,
    method,
    playerId,
    profile,
    teamId: input.teamId,
    evidence,
    candidates,
  };
}
