import { mockNflTeamsFixture } from '../sports/providers/mock/nfl-teams.fixture.js';
import type { ScheduleImportRow } from './admin.schemas.js';

const TEAM_ALIASES: Readonly<Record<string, string>> = { JAC: 'JAX', WSH: 'WAS' };
const INTERNATIONAL_CITY_PATTERN =
  /(?:berlin|dublin|london|madrid|melbourne|mexico city|munich|paris|rio de janeiro)/i;
const EXPLICIT_OFFSET_PATTERN = /(?:Z|[+-]\d{2}:\d{2})$/;

export interface ScheduleReviewIssue {
  readonly row: number;
  readonly message: string;
}

export interface ScheduleReviewGame {
  readonly row: number;
  readonly externalReference: string | null;
  readonly awayTeam: string;
  readonly homeTeam: string;
  readonly startTime: string;
}

export interface ScheduleReview {
  readonly totalRows: number;
  readonly countsBySeasonType: Readonly<Record<string, number>>;
  readonly countsByWeek: Readonly<Record<string, number>>;
  readonly teamsRepresented: readonly string[];
  readonly gamesPerTeam: Readonly<Record<string, number>>;
  readonly homeGamesPerTeam: Readonly<Record<string, number>>;
  readonly awayGamesPerTeam: Readonly<Record<string, number>>;
  readonly byeWeekPerTeam: Readonly<Record<string, number | null>>;
  readonly duplicateIdentities: readonly ScheduleReviewIssue[];
  readonly duplicateExternalReferences: readonly ScheduleReviewIssue[];
  readonly unstableExternalReferences: readonly ScheduleReviewIssue[];
  readonly unknownTeams: readonly ScheduleReviewIssue[];
  readonly sameTeamGames: readonly ScheduleReviewIssue[];
  readonly teamsPlayingTwiceInWeek: readonly ScheduleReviewIssue[];
  readonly invalidTimestamps: readonly ScheduleReviewIssue[];
  readonly invalidOffsets: readonly ScheduleReviewIssue[];
  readonly tbdKickoffs: readonly ScheduleReviewGame[];
  readonly missingRequiredFields: readonly ScheduleReviewIssue[];
  readonly missingVenueCount: number;
  readonly missingBroadcastCount: number;
  readonly neutralSiteGames: readonly ScheduleReviewGame[];
  readonly internationalGames: readonly ScheduleReviewGame[];
  readonly rowsWithNotes: readonly ScheduleReviewGame[];
  readonly warnings: readonly string[];
  readonly blockers: readonly string[];
  readonly readyForImport: boolean;
}

export function reviewSchedule(rows: readonly ScheduleImportRow[]): ScheduleReview {
  const canonicalTeams: string[] = mockNflTeamsFixture
    .map((team) => team.abbreviation as string)
    .sort();
  const canonicalSet = new Set<string>(canonicalTeams);
  const countsBySeasonType: Record<string, number> = {};
  const countsByWeek: Record<string, number> = {};
  const gamesPerTeam = initializeCounts(canonicalTeams);
  const homeGamesPerTeam = initializeCounts(canonicalTeams);
  const awayGamesPerTeam = initializeCounts(canonicalTeams);
  const regularWeeksByTeam = new Map(canonicalTeams.map((team) => [team, new Set<number>()]));
  const teamWeekRows = new Map<string, number>();
  const identities = new Map<string, number>();
  const externalReferences = new Map<string, number>();
  const duplicateIdentities: ScheduleReviewIssue[] = [];
  const duplicateExternalReferences: ScheduleReviewIssue[] = [];
  const unstableExternalReferences: ScheduleReviewIssue[] = [];
  const unknownTeams: ScheduleReviewIssue[] = [];
  const sameTeamGames: ScheduleReviewIssue[] = [];
  const teamsPlayingTwiceInWeek: ScheduleReviewIssue[] = [];
  const invalidTimestamps: ScheduleReviewIssue[] = [];
  const invalidOffsets: ScheduleReviewIssue[] = [];
  const tbdKickoffs: ScheduleReviewGame[] = [];
  const missingRequiredFields: ScheduleReviewIssue[] = [];
  const neutralSiteGames: ScheduleReviewGame[] = [];
  const internationalGames: ScheduleReviewGame[] = [];
  const rowsWithNotes: ScheduleReviewGame[] = [];
  let missingVenueCount = 0;
  let missingBroadcastCount = 0;

  for (const [index, row] of rows.entries()) {
    const rowNumber = index + 2;
    const homeTeam = canonicalTeam(row.homeTeam);
    const awayTeam = canonicalTeam(row.awayTeam);
    const game = toReviewGame(row, rowNumber, awayTeam, homeTeam);
    increment(countsBySeasonType, row.seasonType);
    increment(countsByWeek, `${row.seasonType}-${String(row.week ?? 'none')}`);

    if (!canonicalSet.has(homeTeam))
      unknownTeams.push({ row: rowNumber, message: `Unknown home team: ${row.homeTeam}.` });
    if (!canonicalSet.has(awayTeam))
      unknownTeams.push({ row: rowNumber, message: `Unknown away team: ${row.awayTeam}.` });
    if (homeTeam === awayTeam)
      sameTeamGames.push({ row: rowNumber, message: `${homeTeam} is both home and away.` });

    if (row.startTime === 'TBD') tbdKickoffs.push(game);
    else {
      const timestamp = Date.parse(row.startTime);
      if (Number.isNaN(timestamp))
        invalidTimestamps.push({ row: rowNumber, message: `Invalid timestamp: ${row.startTime}.` });
      if (!EXPLICIT_OFFSET_PATTERN.test(row.startTime))
        invalidOffsets.push({
          row: rowNumber,
          message: `Timestamp lacks an explicit offset: ${row.startTime}.`,
        });
    }

    for (const [field, value] of [
      ['sourceName', row.sourceName],
      ['seasonType', row.seasonType],
      ['startTime', row.startTime],
      ['homeTeam', row.homeTeam],
      ['awayTeam', row.awayTeam],
      ['status', row.status],
    ] as const) {
      if (value.trim() === '')
        missingRequiredFields.push({ row: rowNumber, message: `${field} is required.` });
    }

    if (row.venueName === null || row.venueCity === null) missingVenueCount += 1;
    if (row.broadcastNetwork === null) missingBroadcastCount += 1;
    if (row.isNeutralSite) neutralSiteGames.push(game);
    if (
      row.isNeutralSite ||
      (row.venueCity !== null && INTERNATIONAL_CITY_PATTERN.test(row.venueCity)) ||
      (row.notes !== null && /international/i.test(row.notes))
    )
      internationalGames.push(game);
    if (row.notes !== null) rowsWithNotes.push(game);

    const identity = [row.season, row.seasonType, row.week, awayTeam, homeTeam].join('|');
    recordDuplicate(identity, rowNumber, identities, duplicateIdentities, 'schedule identity');
    if (row.externalReference !== null) {
      recordDuplicate(
        row.externalReference,
        rowNumber,
        externalReferences,
        duplicateExternalReferences,
        'external reference',
      );
      const expected = expectedExternalReference(row, awayTeam, homeTeam);
      if (row.externalReference !== expected)
        unstableExternalReferences.push({
          row: rowNumber,
          message: `Expected ${expected}; received ${row.externalReference}.`,
        });
    }

    for (const [team, sideCounts] of [
      [homeTeam, homeGamesPerTeam],
      [awayTeam, awayGamesPerTeam],
    ] as const) {
      if (!canonicalSet.has(team)) continue;
      increment(gamesPerTeam, team);
      increment(sideCounts, team);
      if (row.seasonType === 'REG' && row.week !== null) {
        regularWeeksByTeam.get(team)?.add(row.week);
        const teamWeek = `${team}|${String(row.week)}`;
        const priorRow = teamWeekRows.get(teamWeek);
        if (priorRow !== undefined)
          teamsPlayingTwiceInWeek.push({
            row: rowNumber,
            message: `${team} also appears in row ${String(priorRow)} during REG week ${String(row.week)}.`,
          });
        else teamWeekRows.set(teamWeek, rowNumber);
      }
    }
  }

  const regularRows = rows.filter((row) => row.seasonType === 'REG');
  const regularTeams = new Set(
    regularRows.flatMap((row) => [canonicalTeam(row.awayTeam), canonicalTeam(row.homeTeam)]),
  );
  const byeWeekPerTeam: Record<string, number | null> = {};
  for (const team of canonicalTeams) {
    const playedWeeks = regularWeeksByTeam.get(team) ?? new Set<number>();
    const missingWeeks = range(1, 18).filter((week) => !playedWeeks.has(week));
    byeWeekPerTeam[team] = missingWeeks.length === 1 ? (missingWeeks[0] ?? null) : null;
  }

  const blockers = [
    ...(regularRows.length === 272
      ? []
      : [`Expected 272 regular-season games; found ${String(regularRows.length)}.`]),
    ...(regularTeams.size === 32
      ? []
      : [`Expected 32 regular-season teams; found ${String(regularTeams.size)}.`]),
    ...canonicalTeams.flatMap((team) => {
      const count = regularRows.filter(
        (row) => canonicalTeam(row.homeTeam) === team || canonicalTeam(row.awayTeam) === team,
      ).length;
      return count === 17
        ? []
        : [`${team} has ${String(count)} regular-season games; expected 17.`];
    }),
    ...canonicalTeams.flatMap((team) =>
      byeWeekPerTeam[team] === null ? [`${team} does not have exactly one bye week.`] : [],
    ),
    ...issuesToBlockers('Duplicate identities', duplicateIdentities),
    ...issuesToBlockers('Duplicate external references', duplicateExternalReferences),
    ...issuesToBlockers('Unstable external references', unstableExternalReferences),
    ...issuesToBlockers('Unknown teams', unknownTeams),
    ...issuesToBlockers('Same-team games', sameTeamGames),
    ...issuesToBlockers('Teams playing twice in one week', teamsPlayingTwiceInWeek),
    ...issuesToBlockers('Invalid timestamps', invalidTimestamps),
    ...issuesToBlockers('Invalid offsets', invalidOffsets),
    ...issuesToBlockers('Missing required fields', missingRequiredFields),
  ];
  const warnings = [
    ...(missingVenueCount > 0
      ? [`${String(missingVenueCount)} rows have an unverified venue name or city.`]
      : []),
    ...(missingBroadcastCount > 0
      ? [`${String(missingBroadcastCount)} rows have no confirmed broadcast network.`]
      : []),
    ...(rowsWithNotes.length > 0
      ? [`${String(rowsWithNotes.length)} rows contain review notes.`]
      : []),
    ...(tbdKickoffs.length > 0
      ? [`${String(tbdKickoffs.length)} rows have an explicitly unresolved kickoff (TBD).`]
      : []),
  ];

  return {
    totalRows: rows.length,
    countsBySeasonType,
    countsByWeek,
    teamsRepresented: [...regularTeams].filter((team) => canonicalSet.has(team)).sort(),
    gamesPerTeam,
    homeGamesPerTeam,
    awayGamesPerTeam,
    byeWeekPerTeam,
    duplicateIdentities,
    duplicateExternalReferences,
    unstableExternalReferences,
    unknownTeams,
    sameTeamGames,
    teamsPlayingTwiceInWeek,
    invalidTimestamps,
    invalidOffsets,
    tbdKickoffs,
    missingRequiredFields,
    missingVenueCount,
    missingBroadcastCount,
    neutralSiteGames,
    internationalGames,
    rowsWithNotes,
    warnings,
    blockers,
    readyForImport: blockers.length === 0,
  };
}

function canonicalTeam(team: string): string {
  const normalized = team.trim().toUpperCase();
  return TEAM_ALIASES[normalized] ?? normalized;
}

function expectedExternalReference(
  row: ScheduleImportRow,
  awayTeam: string,
  homeTeam: string,
): string {
  const week = row.week === null ? 'none' : String(row.week).padStart(2, '0');
  return `nfl-${String(row.season)}-${row.seasonType.toLowerCase()}-w${week}-${awayTeam.toLowerCase()}-${homeTeam.toLowerCase()}`;
}

function initializeCounts(teams: readonly string[]): Record<string, number> {
  return Object.fromEntries(teams.map((team) => [team, 0]));
}

function increment(counts: Record<string, number>, key: string): void {
  counts[key] = (counts[key] ?? 0) + 1;
}

function recordDuplicate(
  identity: string,
  row: number,
  seen: Map<string, number>,
  issues: ScheduleReviewIssue[],
  label: string,
): void {
  const priorRow = seen.get(identity);
  if (priorRow === undefined) seen.set(identity, row);
  else issues.push({ row, message: `Duplicate ${label}; first seen in row ${String(priorRow)}.` });
}

function toReviewGame(
  row: ScheduleImportRow,
  rowNumber: number,
  awayTeam: string,
  homeTeam: string,
): ScheduleReviewGame {
  return {
    row: rowNumber,
    externalReference: row.externalReference,
    awayTeam,
    homeTeam,
    startTime: row.startTime,
  };
}

function range(start: number, end: number): number[] {
  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}

function issuesToBlockers(label: string, issues: readonly ScheduleReviewIssue[]): string[] {
  return issues.length === 0 ? [] : [`${label}: ${String(issues.length)}.`];
}
