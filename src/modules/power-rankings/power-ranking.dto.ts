import type { Prisma } from '../../generated/prisma/client.js';

export const powerRankingEntryInclude = {
  team: {
    select: {
      id: true,
      name: true,
      fullName: true,
      abbreviation: true,
      conference: true,
      division: true,
    },
  },
} satisfies Prisma.PowerRankingEntryInclude;

export const powerRankingEditionInclude = {
  entries: {
    include: powerRankingEntryInclude,
    orderBy: { rank: 'asc' },
  },
} satisfies Prisma.PowerRankingEditionInclude;

export type PowerRankingEditionRecord = Prisma.PowerRankingEditionGetPayload<{
  include: typeof powerRankingEditionInclude;
}>;
export type PowerRankingEntryRecord = Prisma.PowerRankingEntryGetPayload<{
  include: typeof powerRankingEntryInclude;
}>;

export interface PublicPowerRankingTeamDto {
  readonly id: string;
  readonly name: string;
  readonly fullName: string;
  readonly abbreviation: string;
  readonly conference: string;
  readonly division: string;
}

export interface PublicPowerRankingEntryDto {
  readonly rank: number;
  readonly previousRank: number | null;
  readonly movement: number | null;
  readonly tier: string;
  readonly headline: string;
  readonly summary: string;
  readonly strengths: readonly string[];
  readonly concerns: readonly string[];
  readonly team: PublicPowerRankingTeamDto;
}

export interface PublicPowerRankingEditionDto {
  readonly id: string;
  readonly title: string;
  readonly subtitle: string | null;
  readonly season: number;
  readonly edition: string;
  readonly asOf: string;
  readonly methodology: string;
  readonly sources: readonly string[];
  readonly publishedAt: string | null;
}

export interface PublicPowerRankingsDto {
  readonly edition: PublicPowerRankingEditionDto;
  readonly rankings: readonly PublicPowerRankingEntryDto[];
}

export interface PublicPowerRankingEditionSummaryDto {
  readonly id: string;
  readonly title: string;
  readonly season: number;
  readonly edition: string;
  readonly asOf: string;
  readonly publishedAt: string | null;
}

export interface AdminPowerRankingEntryDto extends PublicPowerRankingEntryDto {
  readonly id: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AdminPowerRankingEditionListDto {
  readonly id: string;
  readonly title: string;
  readonly subtitle: string | null;
  readonly season: number;
  readonly edition: string;
  readonly asOf: string;
  readonly status: string;
  readonly publishedAt: string | null;
  readonly entryCount: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AdminPowerRankingEditionDetailDto extends AdminPowerRankingEditionListDto {
  readonly methodology: string;
  readonly sources: readonly string[];
  readonly entries: readonly AdminPowerRankingEntryDto[];
}

function toTeamDto(team: PowerRankingEntryRecord['team']): PublicPowerRankingTeamDto {
  return {
    id: team.id,
    name: team.name,
    fullName: team.fullName,
    abbreviation: team.abbreviation,
    conference: team.conference,
    division: team.division,
  };
}

export function toPublicEntryDto(entry: PowerRankingEntryRecord): PublicPowerRankingEntryDto {
  return {
    rank: entry.rank,
    previousRank: entry.previousRank,
    movement: entry.movement,
    tier: entry.tier,
    headline: entry.headline,
    summary: entry.summary,
    strengths: entry.strengths,
    concerns: entry.concerns,
    team: toTeamDto(entry.team),
  };
}

export function toAdminEntryDto(entry: PowerRankingEntryRecord): AdminPowerRankingEntryDto {
  return {
    ...toPublicEntryDto(entry),
    id: entry.id,
    createdAt: entry.createdAt.toISOString(),
    updatedAt: entry.updatedAt.toISOString(),
  };
}

export function toPublicEditionDto(
  edition: PowerRankingEditionRecord,
): PublicPowerRankingEditionDto {
  return {
    id: edition.id,
    title: edition.title,
    subtitle: edition.subtitle,
    season: edition.season,
    edition: edition.edition,
    asOf: edition.asOf.toISOString(),
    methodology: edition.methodology,
    sources: edition.sources,
    publishedAt: edition.publishedAt?.toISOString() ?? null,
  };
}

export function toPublicPowerRankingsDto(
  edition: PowerRankingEditionRecord,
): PublicPowerRankingsDto {
  return {
    edition: toPublicEditionDto(edition),
    rankings: edition.entries.map(toPublicEntryDto),
  };
}

export function toPublicEditionSummaryDto(
  edition: PowerRankingEditionRecord,
): PublicPowerRankingEditionSummaryDto {
  return {
    id: edition.id,
    title: edition.title,
    season: edition.season,
    edition: edition.edition,
    asOf: edition.asOf.toISOString(),
    publishedAt: edition.publishedAt?.toISOString() ?? null,
  };
}

export function toAdminEditionListDto(
  edition: PowerRankingEditionRecord,
): AdminPowerRankingEditionListDto {
  return {
    id: edition.id,
    title: edition.title,
    subtitle: edition.subtitle,
    season: edition.season,
    edition: edition.edition,
    asOf: edition.asOf.toISOString(),
    status: edition.status,
    publishedAt: edition.publishedAt?.toISOString() ?? null,
    entryCount: edition.entries.length,
    createdAt: edition.createdAt.toISOString(),
    updatedAt: edition.updatedAt.toISOString(),
  };
}

export function toAdminEditionDetailDto(
  edition: PowerRankingEditionRecord,
): AdminPowerRankingEditionDetailDto {
  return {
    ...toAdminEditionListDto(edition),
    methodology: edition.methodology,
    sources: edition.sources,
    entries: edition.entries.map(toAdminEntryDto),
  };
}
