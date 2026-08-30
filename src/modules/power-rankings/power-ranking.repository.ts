import type {
  PowerRankingEditionStatus,
  Prisma,
  PrismaClient,
} from '../../generated/prisma/client.js';
import type { AdministrativePrincipal } from '../admin/admin-authorization.js';
import { sanitizeAuditSnapshot } from '../admin/audit-sanitizer.js';
import { powerRankingEditionInclude, type PowerRankingEditionRecord } from './power-ranking.dto.js';

export interface TeamIdentity {
  readonly id: string;
  readonly name: string;
  readonly fullName: string;
  readonly abbreviation: string;
  readonly conference: string;
  readonly division: string;
}

export interface PowerRankingEditionWriteFields {
  readonly title: string;
  readonly subtitle: string | null;
  readonly asOf: Date;
  readonly methodology: string;
  readonly sources: readonly string[];
}

export interface PowerRankingEditionCreateFields extends PowerRankingEditionWriteFields {
  readonly season: number;
  readonly edition: string;
}

export interface PowerRankingEntryWriteFields {
  readonly rank?: number;
  readonly previousRank?: number | null;
  readonly tier?: string;
  readonly headline?: string;
  readonly summary?: string;
  readonly strengths?: readonly string[];
  readonly concerns?: readonly string[];
}

/** Resolved against a canonical Team row by the service layer -- the
 * repository never re-derives team identity, it only writes what it's given. */
export interface ResolvedImportEntry {
  readonly teamId: string;
  readonly rank: number;
  readonly previousRank: number | null;
  readonly tier: string;
  readonly headline: string;
  readonly summary: string;
  readonly strengths: readonly string[];
  readonly concerns: readonly string[];
}

export interface ImportUpsertResult {
  readonly edition: PowerRankingEditionRecord;
  readonly created: boolean;
}

export type EntryUpdateOutcome =
  | { readonly kind: 'OK'; readonly edition: PowerRankingEditionRecord }
  | { readonly kind: 'EDITION_NOT_FOUND' }
  | { readonly kind: 'ENTRY_NOT_FOUND' };

export interface PowerRankingRepository {
  listActiveNflTeams(): Promise<readonly TeamIdentity[]>;
  findById(editionId: string): Promise<PowerRankingEditionRecord | null>;
  findPublished(season: number, edition: string): Promise<PowerRankingEditionRecord | null>;
  findBySeasonEdition(season: number, edition: string): Promise<PowerRankingEditionRecord | null>;
  findLatestPublished(season?: number): Promise<PowerRankingEditionRecord | null>;
  listPublishedEditions(season?: number): Promise<readonly PowerRankingEditionRecord[]>;
  listAdmin(query: {
    readonly limit: number;
    readonly cursor?: string;
    readonly status?: PowerRankingEditionStatus;
    readonly season?: number;
  }): Promise<{
    readonly editions: readonly PowerRankingEditionRecord[];
    readonly nextCursor: string | null;
  }>;
  createEdition(
    fields: PowerRankingEditionCreateFields,
    principal: AdministrativePrincipal,
    requestId: string | null,
  ): Promise<PowerRankingEditionRecord>;
  updateEdition(
    editionId: string,
    fields: Partial<PowerRankingEditionWriteFields>,
    principal: AdministrativePrincipal,
    requestId: string | null,
  ): Promise<PowerRankingEditionRecord | null>;
  setStatus(
    editionId: string,
    status: PowerRankingEditionStatus,
    action: string,
    principal: AdministrativePrincipal,
    requestId: string | null,
  ): Promise<PowerRankingEditionRecord | null>;
  updateEntry(
    editionId: string,
    entryId: string,
    fields: PowerRankingEntryWriteFields,
    principal: AdministrativePrincipal,
    requestId: string | null,
  ): Promise<EntryUpdateOutcome>;
  reorderEntries(
    editionId: string,
    orderedEntryIds: readonly string[],
    principal: AdministrativePrincipal,
    requestId: string | null,
  ): Promise<PowerRankingEditionRecord | null>;
  importUpsert(
    fields: PowerRankingEditionCreateFields,
    entries: readonly ResolvedImportEntry[],
    publish: boolean,
    principal: AdministrativePrincipal,
    requestId: string | null,
  ): Promise<ImportUpsertResult>;
}

export class PrismaPowerRankingRepository implements PowerRankingRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async listActiveNflTeams(): Promise<readonly TeamIdentity[]> {
    return this.prisma.team.findMany({
      where: { league: 'NFL', isActive: true },
      select: {
        id: true,
        name: true,
        fullName: true,
        abbreviation: true,
        conference: true,
        division: true,
      },
      orderBy: [{ conference: 'asc' }, { division: 'asc' }, { fullName: 'asc' }],
    });
  }

  findById(editionId: string): Promise<PowerRankingEditionRecord | null> {
    return this.prisma.powerRankingEdition.findUnique({
      where: { id: editionId },
      include: powerRankingEditionInclude,
    });
  }

  findPublished(season: number, edition: string): Promise<PowerRankingEditionRecord | null> {
    return this.prisma.powerRankingEdition.findFirst({
      where: { season, edition, status: 'PUBLISHED' },
      include: powerRankingEditionInclude,
    });
  }

  findBySeasonEdition(season: number, edition: string): Promise<PowerRankingEditionRecord | null> {
    return this.prisma.powerRankingEdition.findUnique({
      where: { season_edition: { season, edition } },
      include: powerRankingEditionInclude,
    });
  }

  findLatestPublished(season?: number): Promise<PowerRankingEditionRecord | null> {
    return this.prisma.powerRankingEdition.findFirst({
      where: { status: 'PUBLISHED', ...(season === undefined ? {} : { season }) },
      orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
      include: powerRankingEditionInclude,
    });
  }

  listPublishedEditions(season?: number): Promise<readonly PowerRankingEditionRecord[]> {
    return this.prisma.powerRankingEdition.findMany({
      where: { status: 'PUBLISHED', ...(season === undefined ? {} : { season }) },
      orderBy: [{ season: 'desc' }, { publishedAt: 'desc' }, { id: 'desc' }],
      include: powerRankingEditionInclude,
    });
  }

  async listAdmin(query: {
    readonly limit: number;
    readonly cursor?: string;
    readonly status?: PowerRankingEditionStatus;
    readonly season?: number;
  }): Promise<{
    readonly editions: readonly PowerRankingEditionRecord[];
    readonly nextCursor: string | null;
  }> {
    const editions = await this.prisma.powerRankingEdition.findMany({
      where: {
        ...(query.status === undefined ? {} : { status: query.status }),
        ...(query.season === undefined ? {} : { season: query.season }),
      },
      orderBy: [{ season: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      ...(query.cursor === undefined ? {} : { cursor: { id: query.cursor }, skip: 1 }),
      include: powerRankingEditionInclude,
    });
    const hasMore = editions.length > query.limit;
    const page = hasMore ? editions.slice(0, query.limit) : editions;
    return { editions: page, nextCursor: hasMore ? (page.at(-1)?.id ?? null) : null };
  }

  async createEdition(
    fields: PowerRankingEditionCreateFields,
    principal: AdministrativePrincipal,
    requestId: string | null,
  ): Promise<PowerRankingEditionRecord> {
    return this.prisma.$transaction(async (transaction) => {
      const created = await transaction.powerRankingEdition.create({
        data: {
          ...fields,
          sources: [...fields.sources],
          createdById: principal.userId,
          updatedById: principal.userId,
          createdBySnapshot: principal.email,
          updatedBySnapshot: principal.email,
        },
        include: powerRankingEditionInclude,
      });
      await createAudit(
        transaction,
        principal,
        requestId,
        'POWER_RANKING_EDITION_CREATED',
        created.id,
        null,
        compactEditionSnapshot(created),
      );
      return created;
    });
  }

  async updateEdition(
    editionId: string,
    fields: Partial<PowerRankingEditionWriteFields>,
    principal: AdministrativePrincipal,
    requestId: string | null,
  ): Promise<PowerRankingEditionRecord | null> {
    return this.prisma.$transaction(async (transaction) => {
      const before = await transaction.powerRankingEdition.findUnique({
        where: { id: editionId },
        include: powerRankingEditionInclude,
      });
      if (before === null) return null;
      const after = await transaction.powerRankingEdition.update({
        where: { id: editionId },
        data: {
          ...(fields.title === undefined ? {} : { title: fields.title }),
          ...(fields.subtitle === undefined ? {} : { subtitle: fields.subtitle }),
          ...(fields.asOf === undefined ? {} : { asOf: fields.asOf }),
          ...(fields.methodology === undefined ? {} : { methodology: fields.methodology }),
          ...(fields.sources === undefined ? {} : { sources: [...fields.sources] }),
          updatedById: principal.userId,
          updatedBySnapshot: principal.email,
        },
        include: powerRankingEditionInclude,
      });
      await createAudit(
        transaction,
        principal,
        requestId,
        'POWER_RANKING_EDITION_UPDATED',
        editionId,
        compactEditionSnapshot(before),
        compactEditionSnapshot(after),
      );
      return after;
    });
  }

  async setStatus(
    editionId: string,
    status: PowerRankingEditionStatus,
    action: string,
    principal: AdministrativePrincipal,
    requestId: string | null,
  ): Promise<PowerRankingEditionRecord | null> {
    return this.prisma.$transaction(async (transaction) => {
      const before = await transaction.powerRankingEdition.findUnique({
        where: { id: editionId },
        include: powerRankingEditionInclude,
      });
      if (before === null) return null;
      const after = await transaction.powerRankingEdition.update({
        where: { id: editionId },
        data: {
          status,
          publishedAt:
            status === 'PUBLISHED' ? (before.publishedAt ?? new Date()) : before.publishedAt,
          updatedById: principal.userId,
          updatedBySnapshot: principal.email,
        },
        include: powerRankingEditionInclude,
      });
      await createAudit(
        transaction,
        principal,
        requestId,
        action,
        editionId,
        compactEditionSnapshot(before),
        compactEditionSnapshot(after),
      );
      return after;
    });
  }

  async updateEntry(
    editionId: string,
    entryId: string,
    fields: PowerRankingEntryWriteFields,
    principal: AdministrativePrincipal,
    requestId: string | null,
  ): Promise<EntryUpdateOutcome> {
    return this.prisma.$transaction(async (transaction) => {
      const edition = await transaction.powerRankingEdition.findUnique({
        where: { id: editionId },
        include: powerRankingEditionInclude,
      });
      if (edition === null) return { kind: 'EDITION_NOT_FOUND' };
      const before = edition.entries.find((entry) => entry.id === entryId);
      if (before === undefined) return { kind: 'ENTRY_NOT_FOUND' };

      if (fields.rank !== undefined && fields.rank !== before.rank) {
        const orderedIds = edition.entries
          .filter((entry) => entry.id !== entryId)
          .map((entry) => entry.id);
        orderedIds.splice(fields.rank - 1, 0, entryId);
        await reassignEntryRanks(transaction, orderedIds);
      }

      const nextPreviousRank =
        fields.previousRank === undefined ? before.previousRank : fields.previousRank;
      const nextRank = fields.rank ?? before.rank;
      await transaction.powerRankingEntry.update({
        where: { id: entryId },
        data: {
          ...(fields.tier === undefined ? {} : { tier: fields.tier }),
          ...(fields.headline === undefined ? {} : { headline: fields.headline }),
          ...(fields.summary === undefined ? {} : { summary: fields.summary }),
          ...(fields.strengths === undefined ? {} : { strengths: [...fields.strengths] }),
          ...(fields.concerns === undefined ? {} : { concerns: [...fields.concerns] }),
          previousRank: nextPreviousRank,
          movement: deriveMovement(nextPreviousRank, nextRank),
        },
      });

      const after = await transaction.powerRankingEdition.findUniqueOrThrow({
        where: { id: editionId },
        include: powerRankingEditionInclude,
      });
      await createAudit(
        transaction,
        principal,
        requestId,
        'POWER_RANKING_ENTRY_UPDATED',
        entryId,
        sanitizeAuditSnapshot(compactEntrySnapshot(before)),
        sanitizeAuditSnapshot(
          compactEntrySnapshot(after.entries.find((entry) => entry.id === entryId) ?? before),
        ),
      );
      return { kind: 'OK', edition: after };
    });
  }

  async reorderEntries(
    editionId: string,
    orderedEntryIds: readonly string[],
    principal: AdministrativePrincipal,
    requestId: string | null,
  ): Promise<PowerRankingEditionRecord | null> {
    return this.prisma.$transaction(async (transaction) => {
      const before = await transaction.powerRankingEdition.findUnique({
        where: { id: editionId },
        include: powerRankingEditionInclude,
      });
      if (before === null) return null;
      const currentIds = new Set(before.entries.map((entry) => entry.id));
      const suppliedIds = new Set(orderedEntryIds);
      if (
        currentIds.size !== suppliedIds.size ||
        [...currentIds].some((id) => !suppliedIds.has(id))
      ) {
        throw new RangeError(
          'orderedEntryIds must be exactly the set of this edition’s current entry ids.',
        );
      }
      await reassignEntryRanks(transaction, orderedEntryIds);
      const after = await transaction.powerRankingEdition.findUniqueOrThrow({
        where: { id: editionId },
        include: powerRankingEditionInclude,
      });
      await createAudit(
        transaction,
        principal,
        requestId,
        'POWER_RANKING_REORDERED',
        editionId,
        sanitizeAuditSnapshot({
          entries: before.entries.map((entry) => ({ entryId: entry.id, rank: entry.rank })),
        }),
        sanitizeAuditSnapshot({
          entries: after.entries.map((entry) => ({ entryId: entry.id, rank: entry.rank })),
        }),
      );
      return after;
    });
  }

  async importUpsert(
    fields: PowerRankingEditionCreateFields,
    entries: readonly ResolvedImportEntry[],
    publish: boolean,
    principal: AdministrativePrincipal,
    requestId: string | null,
  ): Promise<ImportUpsertResult> {
    return this.prisma.$transaction(async (transaction) => {
      const existing = await transaction.powerRankingEdition.findUnique({
        where: { season_edition: { season: fields.season, edition: fields.edition } },
      });
      const edition =
        existing === null
          ? await transaction.powerRankingEdition.create({
              data: {
                season: fields.season,
                edition: fields.edition,
                title: fields.title,
                subtitle: fields.subtitle,
                asOf: fields.asOf,
                methodology: fields.methodology,
                sources: [...fields.sources],
                createdById: principal.userId,
                updatedById: principal.userId,
                createdBySnapshot: principal.email,
                updatedBySnapshot: principal.email,
              },
            })
          : await transaction.powerRankingEdition.update({
              where: { id: existing.id },
              data: {
                title: fields.title,
                subtitle: fields.subtitle,
                asOf: fields.asOf,
                methodology: fields.methodology,
                sources: [...fields.sources],
                updatedById: principal.userId,
                updatedBySnapshot: principal.email,
              },
            });

      // Two-phase, negative-offset write of every entry -- identical
      // rationale to `reassignEntryRanks` below: a re-import can both change
      // which team holds a given rank and reuse ranks an existing row
      // already occupies, so writing final ranks directly can collide with
      // another row's still-current rank mid-transaction.
      const priorEntries = await transaction.powerRankingEntry.findMany({
        where: { editionId: edition.id },
      });
      for (const [index, entry] of priorEntries.entries()) {
        await transaction.powerRankingEntry.update({
          where: { id: entry.id },
          data: { rank: -(index + 1) },
        });
      }
      const priorByTeamId = new Map(priorEntries.map((entry) => [entry.teamId, entry]));
      const survivingTeamIds = new Set(entries.map((entry) => entry.teamId));
      for (const entry of priorEntries) {
        if (!survivingTeamIds.has(entry.teamId)) {
          await transaction.powerRankingEntry.delete({ where: { id: entry.id } });
        }
      }
      for (const entry of entries) {
        const movement = deriveMovement(entry.previousRank, entry.rank);
        const priorEntry = priorByTeamId.get(entry.teamId);
        if (priorEntry === undefined) {
          await transaction.powerRankingEntry.create({
            data: {
              editionId: edition.id,
              teamId: entry.teamId,
              rank: entry.rank,
              previousRank: entry.previousRank,
              movement,
              tier: entry.tier,
              headline: entry.headline,
              summary: entry.summary,
              strengths: [...entry.strengths],
              concerns: [...entry.concerns],
            },
          });
        } else {
          await transaction.powerRankingEntry.update({
            where: { id: priorEntry.id },
            data: {
              rank: entry.rank,
              previousRank: entry.previousRank,
              movement,
              tier: entry.tier,
              headline: entry.headline,
              summary: entry.summary,
              strengths: [...entry.strengths],
              concerns: [...entry.concerns],
            },
          });
        }
      }

      let finalEdition = edition;
      if (publish) {
        finalEdition = await transaction.powerRankingEdition.update({
          where: { id: edition.id },
          data: {
            status: 'PUBLISHED',
            publishedAt: edition.publishedAt ?? new Date(),
            updatedById: principal.userId,
            updatedBySnapshot: principal.email,
          },
        });
      }

      await createAudit(
        transaction,
        principal,
        requestId,
        'POWER_RANKING_BATCH_IMPORTED',
        edition.id,
        existing === null ? null : sanitizeAuditSnapshot({ entryCount: priorEntries.length }),
        sanitizeAuditSnapshot({
          season: fields.season,
          edition: fields.edition,
          entryCount: entries.length,
          published: publish,
        }),
      );
      if (publish) {
        await createAudit(
          transaction,
          principal,
          requestId,
          'POWER_RANKING_PUBLISHED',
          edition.id,
          null,
          sanitizeAuditSnapshot({ status: 'PUBLISHED' }),
        );
      }

      const detail = await transaction.powerRankingEdition.findUniqueOrThrow({
        where: { id: finalEdition.id },
        include: powerRankingEditionInclude,
      });
      return { edition: detail, created: existing === null };
    });
  }
}

/** Two-pass temporary-negative-offset reassignment -- same rationale as
 * `game-media-curation.repository.ts`'s `reassignPositions` and
 * `homepage.repository.ts`'s `reassignTopStoryPositions`: the
 * `(editionId, rank)` unique constraint is checked per-statement, so writing
 * final ranks directly can collide with another entry's still-current rank
 * mid-transaction (e.g. swapping rank 2 and rank 5). Every affected entry is
 * first moved to a guaranteed-unique negative rank, then to its real final
 * rank, both passes sequential within the same interactive transaction. */
async function reassignEntryRanks(
  transaction: Prisma.TransactionClient,
  orderedEntryIds: readonly string[],
): Promise<void> {
  for (const [index, id] of orderedEntryIds.entries()) {
    await transaction.powerRankingEntry.update({ where: { id }, data: { rank: -(index + 1) } });
  }
  const entries = await transaction.powerRankingEntry.findMany({
    where: { id: { in: [...orderedEntryIds] } },
  });
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  for (const [index, id] of orderedEntryIds.entries()) {
    const rank = index + 1;
    const entry = byId.get(id);
    const previousRank = entry?.previousRank ?? null;
    await transaction.powerRankingEntry.update({
      where: { id },
      data: { rank, movement: deriveMovement(previousRank, rank) },
    });
  }
}

export function deriveMovement(previousRank: number | null, rank: number): number | null {
  return previousRank === null ? null : previousRank - rank;
}

async function createAudit(
  transaction: Prisma.TransactionClient,
  principal: AdministrativePrincipal,
  requestId: string | null,
  action: string,
  entityId: string,
  before: Prisma.InputJsonObject | null,
  after: Prisma.InputJsonObject | null,
): Promise<void> {
  await transaction.adminAuditEvent.create({
    data: {
      actorUserId: principal.userId,
      actorEmailSnapshot: principal.email,
      action,
      entityType: 'POWER_RANKING',
      entityId,
      requestId,
      ...(before === null ? {} : { beforeSnapshot: before }),
      ...(after === null ? {} : { afterSnapshot: after }),
    },
  });
}

function compactEditionSnapshot(edition: {
  readonly id: string;
  readonly season: number;
  readonly edition: string;
  readonly title: string;
  readonly status: PowerRankingEditionStatus;
  readonly publishedAt: Date | null;
}): Prisma.InputJsonObject {
  return sanitizeAuditSnapshot({
    id: edition.id,
    season: edition.season,
    edition: edition.edition,
    title: edition.title,
    status: edition.status,
    publishedAt: edition.publishedAt,
  });
}

function compactEntrySnapshot(entry: {
  readonly id: string;
  readonly rank: number;
  readonly previousRank: number | null;
  readonly movement: number | null;
  readonly tier: string;
  readonly headline: string;
}): Prisma.InputJsonObject {
  return sanitizeAuditSnapshot({
    id: entry.id,
    rank: entry.rank,
    previousRank: entry.previousRank,
    movement: entry.movement,
    tier: entry.tier,
    headline: entry.headline,
  });
}
