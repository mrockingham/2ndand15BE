import type { TeamIdentity } from './power-ranking.repository.js';
import type { PowerRankingImportEntry } from './power-ranking.schemas.js';

export interface TeamMatchError {
  readonly rank: number;
  readonly teamId: string;
  readonly message: string;
}

export interface TeamMatchSuccess {
  readonly rank: number;
  readonly teamId: string;
  readonly matchedTeam: TeamIdentity;
  readonly matchedBy: 'ID' | 'ABBREVIATION' | 'SLUG';
}

export type TeamMatchResult = TeamMatchSuccess | TeamMatchError;

export function isTeamMatchError(result: TeamMatchResult): result is TeamMatchError {
  return !('matchedTeam' in result);
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Normalizes a Team's identity into the same slug shape the import format
 * uses for `teamId` (e.g. "los-angeles-rams") -- this is a derived matching
 * key only, never persisted; Team has no slug column of its own. */
export function slugifyTeamIdentity(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

interface TeamLookup {
  readonly byId: ReadonlyMap<string, TeamIdentity>;
  readonly byAbbreviation: ReadonlyMap<string, TeamIdentity>;
  readonly bySlug: ReadonlyMap<string, TeamIdentity>;
}

export function buildTeamLookup(teams: readonly TeamIdentity[]): TeamLookup {
  const byId = new Map(teams.map((team) => [team.id, team]));
  const byAbbreviation = new Map(teams.map((team) => [team.abbreviation.toUpperCase(), team]));
  const bySlug = new Map<string, TeamIdentity>();
  for (const team of teams) {
    bySlug.set(slugifyTeamIdentity(team.fullName), team);
    bySlug.set(slugifyTeamIdentity(team.name), team);
  }
  return { byId, byAbbreviation, bySlug };
}

/** Resolves one import entry's `teamId` against canonical Team rows, in the
 * documented preference order: (1) an existing Team UUID if `teamId` happens
 * to be one, (2) the entry's own `abbreviation` field, (3) a
 * provider-neutral normalized slug derived from `teamId` -- the current
 * source JSON's `teamId` values ("los-angeles-rams") are never assumed to be
 * DB UUIDs. Once matched, the entry's supplied team/abbreviation/conference/
 * division are cross-checked against the canonical Team row; any mismatch is
 * rejected rather than silently trusted, and Team is never written to. */
export function matchImportEntryToTeam(
  entry: PowerRankingImportEntry,
  lookup: TeamLookup,
): TeamMatchResult {
  let matchedTeam: TeamIdentity | undefined;
  let matchedBy: TeamMatchSuccess['matchedBy'] | undefined;

  if (UUID_PATTERN.test(entry.teamId) && lookup.byId.has(entry.teamId)) {
    matchedTeam = lookup.byId.get(entry.teamId);
    matchedBy = 'ID';
  } else if (lookup.byAbbreviation.has(entry.abbreviation.toUpperCase())) {
    matchedTeam = lookup.byAbbreviation.get(entry.abbreviation.toUpperCase());
    matchedBy = 'ABBREVIATION';
  } else if (lookup.bySlug.has(slugifyTeamIdentity(entry.teamId))) {
    matchedTeam = lookup.bySlug.get(slugifyTeamIdentity(entry.teamId));
    matchedBy = 'SLUG';
  }

  if (matchedTeam === undefined || matchedBy === undefined) {
    return {
      rank: entry.rank,
      teamId: entry.teamId,
      message: `No active NFL team matches teamId "${entry.teamId}" (tried UUID, abbreviation "${entry.abbreviation}", and normalized slug).`,
    };
  }

  const mismatches: string[] = [];
  if (matchedTeam.abbreviation.toUpperCase() !== entry.abbreviation.toUpperCase()) {
    mismatches.push(
      `abbreviation "${entry.abbreviation}" does not match Team ${matchedTeam.id} ("${matchedTeam.abbreviation}")`,
    );
  }
  if (matchedTeam.conference.toUpperCase() !== entry.conference.toUpperCase()) {
    mismatches.push(
      `conference "${entry.conference}" does not match Team ${matchedTeam.id} ("${matchedTeam.conference}")`,
    );
  }
  if (matchedTeam.division.toUpperCase() !== entry.division.toUpperCase()) {
    mismatches.push(
      `division "${entry.division}" does not match Team ${matchedTeam.id} ("${matchedTeam.division}")`,
    );
  }
  if (
    slugifyTeamIdentity(entry.team) !== slugifyTeamIdentity(matchedTeam.fullName) &&
    slugifyTeamIdentity(entry.team) !== slugifyTeamIdentity(matchedTeam.name)
  ) {
    mismatches.push(
      `team name "${entry.team}" does not match Team ${matchedTeam.id} ("${matchedTeam.fullName}")`,
    );
  }
  if (mismatches.length > 0) {
    return {
      rank: entry.rank,
      teamId: entry.teamId,
      message: `Import entry is inconsistent with the canonical Team record: ${mismatches.join('; ')}.`,
    };
  }

  return { rank: entry.rank, teamId: entry.teamId, matchedTeam, matchedBy };
}
