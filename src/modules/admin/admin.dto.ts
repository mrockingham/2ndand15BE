import type { Prisma } from '../../generated/prisma/client.js';
import { toGameDto, type GameDto } from '../games/game.dto.js';

export const adminGameInclude = {
  homeTeam: true,
  awayTeam: true,
  editorialOverride: true,
  provenance: true,
  providerMaps: { select: { provider: true } },
} satisfies Prisma.GameInclude;

export type AdminGameRecord = Prisma.GameGetPayload<{ include: typeof adminGameInclude }>;

export interface AdminGameDto {
  readonly id: string;
  readonly resolved: GameDto;
  readonly base: GameDto;
  readonly providerManaged: boolean;
  readonly provenance: {
    readonly sourceType: string;
    readonly sourceName: string;
    readonly sourceUrl: string | null;
    readonly externalReference: string | null;
    readonly notes: string | null;
    readonly importedAt: string;
    readonly verifiedAt: string | null;
    readonly verifiedById: string | null;
  } | null;
  readonly override: {
    readonly startTime: string | null;
    readonly status: string | null;
    readonly homeScore: number | null;
    readonly awayScore: number | null;
    readonly week: number | null;
    readonly venueName: string | null;
    readonly venueCity: string | null;
    readonly broadcastNetwork: string | null;
    readonly isNeutralSite: boolean | null;
    readonly publicCorrectionNote: string | null;
    readonly internalNote: string | null;
    readonly resultSourceName: string | null;
    readonly resultSourceUrl: string | null;
    readonly resultVerifiedAt: string | null;
    readonly resultReason: string | null;
    readonly createdBySnapshot: string;
    readonly updatedBySnapshot: string;
    readonly createdAt: string;
    readonly updatedAt: string;
  } | null;
}

export function toAdminGameDto(game: AdminGameRecord): AdminGameDto {
  const publicRecord = {
    ...game,
    editorialOverride: game.editorialOverride,
  };
  const baseRecord = { ...game, editorialOverride: null };
  return {
    id: game.id,
    resolved: toGameDto(publicRecord),
    base: toGameDto(baseRecord),
    providerManaged: game.providerMaps.length > 0,
    provenance:
      game.provenance === null
        ? null
        : {
            sourceType: game.provenance.sourceType,
            sourceName: game.provenance.sourceName,
            sourceUrl: game.provenance.sourceUrl,
            externalReference: game.provenance.externalReference,
            notes: game.provenance.notes,
            importedAt: game.provenance.importedAt.toISOString(),
            verifiedAt: game.provenance.verifiedAt?.toISOString() ?? null,
            verifiedById: game.provenance.verifiedById,
          },
    override:
      game.editorialOverride === null
        ? null
        : {
            startTime: game.editorialOverride.startTime?.toISOString() ?? null,
            status: game.editorialOverride.status,
            homeScore: game.editorialOverride.homeScore,
            awayScore: game.editorialOverride.awayScore,
            week: game.editorialOverride.week,
            venueName: game.editorialOverride.venueName,
            venueCity: game.editorialOverride.venueCity,
            broadcastNetwork: game.editorialOverride.broadcastNetwork,
            isNeutralSite: game.editorialOverride.isNeutralSite,
            publicCorrectionNote: game.editorialOverride.publicCorrectionNote,
            internalNote: game.editorialOverride.internalNote,
            resultSourceName: game.editorialOverride.resultSourceName,
            resultSourceUrl: game.editorialOverride.resultSourceUrl,
            resultVerifiedAt: game.editorialOverride.resultVerifiedAt?.toISOString() ?? null,
            resultReason: game.editorialOverride.resultReason,
            createdBySnapshot: game.editorialOverride.createdBySnapshot,
            updatedBySnapshot: game.editorialOverride.updatedBySnapshot,
            createdAt: game.editorialOverride.createdAt.toISOString(),
            updatedAt: game.editorialOverride.updatedAt.toISOString(),
          },
  };
}

export type AuditEventRecord = Prisma.AdminAuditEventGetPayload<Record<string, never>>;

export function toAuditEventDto(event: AuditEventRecord) {
  return {
    id: event.id,
    actorUserId: event.actorUserId,
    actorEmailSnapshot: event.actorEmailSnapshot,
    action: event.action,
    entityType: event.entityType,
    entityId: event.entityId,
    beforeSnapshot: event.beforeSnapshot,
    afterSnapshot: event.afterSnapshot,
    requestId: event.requestId,
    reason: event.reason,
    createdAt: event.createdAt.toISOString(),
  };
}
