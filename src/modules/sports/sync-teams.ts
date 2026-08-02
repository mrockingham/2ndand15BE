import type { Prisma, PrismaClient } from '../../generated/prisma/client.js';
import type { NormalizedTeam } from './normalized-team.js';
import type { SportsDataProvider } from './sports-data-provider.js';

export interface TeamSyncFailure {
  readonly providerTeamId: string | null;
  readonly reason: string;
}

export interface TeamSyncResult {
  readonly provider: string;
  readonly providerRecordsReceived: number;
  readonly teamsMatched: number;
  readonly teamsCreated: number;
  readonly teamsUpdated: number;
  readonly mappingsCreated: number;
  readonly mappingsUpdated: number;
  readonly skipped: number;
  readonly failed: number;
  readonly ambiguous: number;
  readonly failures: readonly TeamSyncFailure[];
  readonly dryRun: boolean;
}

export interface TeamSyncOptions {
  readonly allowCreate?: boolean;
  readonly updateDisplayFields?: boolean;
  readonly dryRun?: boolean;
}

type ExistingTeam = Prisma.TeamGetPayload<{ include: { providerMaps: true } }>;

export async function syncTeams(
  provider: SportsDataProvider,
  prisma: PrismaClient,
  options: TeamSyncOptions = {},
): Promise<TeamSyncResult> {
  const batch = await provider.getTeams();
  const providerNames = new Set(batch.records.map((team) => team.provider));
  if (providerNames.size > 1 || (providerNames.size === 1 && !providerNames.has(batch.provider))) {
    throw new Error('A team sync batch must contain exactly one provider.');
  }

  const existingTeams = await prisma.team.findMany({
    where: { league: 'NFL' },
    include: { providerMaps: true },
  });
  const failures: TeamSyncFailure[] = batch.failures.map((failure) => ({
    providerTeamId: failure.providerRecordId,
    reason: failure.reason,
  }));
  let teamsMatched = 0;
  let teamsCreated = 0;
  let teamsUpdated = 0;
  let mappingsCreated = 0;
  let mappingsUpdated = 0;
  let ambiguous = 0;
  let skipped = Math.max(0, batch.received - batch.records.length - batch.failures.length);

  for (const normalized of batch.records) {
    const match = findExistingTeam(existingTeams, normalized, batch.provider);
    if (match.kind === 'ambiguous') {
      ambiguous += 1;
      failures.push({
        providerTeamId: normalized.providerTeamId,
        reason: 'Team match was ambiguous.',
      });
      continue;
    }

    if (match.kind === 'missing') {
      if (!(options.allowCreate ?? true)) {
        failures.push({
          providerTeamId: normalized.providerTeamId,
          reason: `No existing NFL team matched ${normalized.abbreviation} / ${normalized.fullName}.`,
        });
        continue;
      }

      teamsCreated += 1;
      mappingsCreated += 1;
      if (!(options.dryRun ?? false)) {
        try {
          await prisma.$transaction(async (transaction) => {
            const created = await transaction.team.create({ data: toTeamCreate(normalized) });
            await transaction.teamProviderMapping.create({
              data: {
                teamId: created.id,
                provider: batch.provider,
                providerTeamId: normalized.providerTeamId,
              },
            });
          });
        } catch {
          teamsCreated -= 1;
          mappingsCreated -= 1;
          failures.push({
            providerTeamId: normalized.providerTeamId,
            reason: 'Database writes failed for this provider team.',
          });
        }
      }
      continue;
    }

    teamsMatched += 1;
    const existing = match.team;
    const shouldUpdateTeam =
      (options.updateDisplayFields ?? true) && !matchesTeamDisplay(existing, normalized);
    const providerMappings = existing.providerMaps.filter(
      (mapping) => mapping.provider === batch.provider,
    );
    const exactMapping = providerMappings.find(
      (mapping) => mapping.providerTeamId === normalized.providerTeamId,
    );
    const mappingToUpdate = exactMapping === undefined ? providerMappings.at(0) : undefined;

    if (providerMappings.length > 1 && exactMapping === undefined) {
      ambiguous += 1;
      failures.push({
        providerTeamId: normalized.providerTeamId,
        reason: 'Existing team has multiple ambiguous mappings for this provider.',
      });
      continue;
    }

    if (shouldUpdateTeam) teamsUpdated += 1;
    if (exactMapping === undefined && mappingToUpdate === undefined) mappingsCreated += 1;
    if (mappingToUpdate !== undefined) mappingsUpdated += 1;
    if (!shouldUpdateTeam && exactMapping !== undefined) skipped += 1;

    if (options.dryRun ?? false) continue;
    try {
      await prisma.$transaction(async (transaction) => {
        if (shouldUpdateTeam) {
          await transaction.team.update({
            where: { id: existing.id },
            data: toTeamUpdate(normalized),
          });
        }
        if (mappingToUpdate !== undefined) {
          await transaction.teamProviderMapping.update({
            where: { id: mappingToUpdate.id },
            data: { providerTeamId: normalized.providerTeamId },
          });
        } else if (exactMapping === undefined) {
          await transaction.teamProviderMapping.create({
            data: {
              teamId: existing.id,
              provider: batch.provider,
              providerTeamId: normalized.providerTeamId,
            },
          });
        }
      });
    } catch {
      if (shouldUpdateTeam) teamsUpdated -= 1;
      if (mappingToUpdate !== undefined) mappingsUpdated -= 1;
      else if (exactMapping === undefined) mappingsCreated -= 1;
      failures.push({
        providerTeamId: normalized.providerTeamId,
        reason: 'Database writes failed for this provider team.',
      });
    }
  }

  return {
    provider: batch.provider,
    providerRecordsReceived: batch.received,
    teamsMatched,
    teamsCreated,
    teamsUpdated,
    mappingsCreated,
    mappingsUpdated,
    skipped,
    failed: failures.length,
    ambiguous,
    failures,
    dryRun: options.dryRun ?? false,
  };
}

function findExistingTeam(
  teams: readonly ExistingTeam[],
  normalized: NormalizedTeam,
  provider: string,
):
  | { readonly kind: 'matched'; readonly team: ExistingTeam }
  | { readonly kind: 'missing' }
  | { readonly kind: 'ambiguous' } {
  const mapped = teams.filter((team) =>
    team.providerMaps.some(
      (mapping) =>
        mapping.provider === provider && mapping.providerTeamId === normalized.providerTeamId,
    ),
  );
  if (mapped.length === 1 && mapped[0] !== undefined) return { kind: 'matched', team: mapped[0] };
  if (mapped.length > 1) return { kind: 'ambiguous' };

  const abbreviationMatches = teams.filter((team) => team.abbreviation === normalized.abbreviation);
  if (abbreviationMatches.length === 1 && abbreviationMatches[0] !== undefined) {
    return { kind: 'matched', team: abbreviationMatches[0] };
  }
  if (abbreviationMatches.length > 1) return { kind: 'ambiguous' };

  const targetName = normalizeName(normalized.fullName);
  const nameMatches = teams.filter((team) => normalizeName(team.fullName) === targetName);
  if (nameMatches.length === 1 && nameMatches[0] !== undefined) {
    return { kind: 'matched', team: nameMatches[0] };
  }
  return nameMatches.length > 1 ? { kind: 'ambiguous' } : { kind: 'missing' };
}

function normalizeName(value: string): string {
  return value.toLowerCase().replaceAll(/[^a-z0-9]/g, '');
}

function toTeamCreate(team: NormalizedTeam) {
  return {
    league: team.league,
    ...toTeamUpdate(team),
  };
}

function toTeamUpdate(team: NormalizedTeam) {
  return {
    city: team.city,
    name: team.name,
    fullName: team.fullName,
    abbreviation: team.abbreviation,
    conference: team.conference,
    division: team.division,
    primaryColor: team.primaryColor,
    secondaryColor: team.secondaryColor,
    logoUrl: team.logoUrl,
    logoSource: team.logoSource,
    isActive: team.isActive,
  };
}

function matchesTeamDisplay(team: ExistingTeam, expected: NormalizedTeam): boolean {
  return (
    team.city === expected.city &&
    team.name === expected.name &&
    team.fullName === expected.fullName &&
    team.abbreviation === expected.abbreviation &&
    team.conference === expected.conference &&
    team.division === expected.division &&
    team.primaryColor === expected.primaryColor &&
    team.secondaryColor === expected.secondaryColor &&
    team.logoUrl === expected.logoUrl &&
    team.logoSource === expected.logoSource &&
    team.isActive === expected.isActive
  );
}
