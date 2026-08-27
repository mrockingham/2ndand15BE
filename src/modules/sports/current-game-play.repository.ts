import { randomUUID } from 'node:crypto';

import type { AuditActor } from '../../common/audit/audit-actor.js';
import type {
  GamePlay,
  GamePlayType,
  GameStatus,
  PrismaClient,
} from '../../generated/prisma/client.js';

export interface CurrentGamePlayTarget {
  readonly id: string;
  readonly status: GameStatus;
  readonly homeTeamId: string;
  readonly awayTeamId: string;
  readonly homeAbbreviation: string;
  readonly awayAbbreviation: string;
  readonly providerMapping: { readonly providerGameId: string } | null;
  /** Currently-active (non-superseded) stored plays only — see `supersededAt` on `GamePlay`. */
  readonly plays: readonly GamePlay[];
}

export interface CurrentGamePlayWrite {
  readonly id: string | null;
  readonly gameId: string;
  readonly playKey: string;
  readonly reconciliationKey: string;
  readonly sequence: number;
  readonly period: number;
  readonly clock: string;
  readonly possessionTeamId: string | null;
  readonly playType: GamePlayType;
  readonly description: string;
  readonly startDown: number | null;
  readonly startDistance: number | null;
  readonly startYardLine: number | null;
  readonly endDown: number | null;
  readonly endDistance: number | null;
  readonly endYardLine: number | null;
  readonly isScoringPlay: boolean;
  readonly isPenalty: boolean;
  readonly isTurnover: boolean;
  readonly sourceProvider: string;
  readonly sourcePlayType: string;
  readonly sourceUpdatedAt: Date;
}

export interface CurrentGamePlayApplyInput {
  readonly target: CurrentGamePlayTarget;
  readonly rows: readonly CurrentGamePlayWrite[];
  readonly provider: string;
  readonly usageMode: 'evaluation' | 'approved';
  readonly inserted: number;
  readonly updated: number;
  /** M27.1: when supplied, the audit event is attributed to this real actor instead of the
   * hardcoded CLI string, and uses `auditAction`/`auditReason` in place of the defaults. Optional
   * so the 3 pre-existing callers (game sync, poller, live-validation harness) are unaffected. */
  readonly actor?: AuditActor;
  readonly auditAction?: string;
  readonly auditReason?: string;
}

export interface CurrentGamePlayRepairApplyInput {
  readonly target: CurrentGamePlayTarget;
  /** Rows to write: `id !== null` updates a preserved (matched, retained) row; `id === null`
   * inserts a fresh row — used for a rebuild's tail, which never reuses an old, untrusted id. */
  readonly rows: readonly CurrentGamePlayWrite[];
  /** Existing row ids to mark superseded (never deleted) rather than write. */
  readonly supersedeIds: readonly string[];
  readonly provider: string;
  readonly actor: AuditActor;
  readonly auditAction: string;
  readonly auditReason: string;
  readonly cutoffSequence: number;
}

export interface CurrentGamePlayFinalReplaceInput {
  readonly target: CurrentGamePlayTarget;
  /** M27.2: every row is a fresh insert (`id: null`) — a FINAL replacement never reuses an old
   * live-row id, by explicit product decision (no feature depends on cross-phase id stability). */
  readonly rows: readonly CurrentGamePlayWrite[];
  readonly provider: string;
  readonly phase: 'FINAL_IMMEDIATE' | 'FINAL_10' | 'FINAL_60';
  readonly fingerprint: string;
  readonly actorEmailSnapshot: string;
}

export interface CurrentGamePlayRepository {
  findTarget(gameId: string, provider: string): Promise<CurrentGamePlayTarget | null>;
  applySnapshot(input: CurrentGamePlayApplyInput): Promise<{ readonly auditEventId: string }>;
  applyRepair(input: CurrentGamePlayRepairApplyInput): Promise<{ readonly auditEventId: string }>;
  replaceWithAuthoritativeFinalSnapshot(
    input: CurrentGamePlayFinalReplaceInput,
  ): Promise<{ readonly auditEventId: string }>;
}

export class PrismaCurrentGamePlayRepository implements CurrentGamePlayRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findTarget(gameId: string, provider: string): Promise<CurrentGamePlayTarget | null> {
    const game = await this.prisma.game.findUnique({
      where: { id: gameId },
      select: {
        id: true,
        status: true,
        homeTeamId: true,
        awayTeamId: true,
        homeTeam: { select: { abbreviation: true } },
        awayTeam: { select: { abbreviation: true } },
        providerMaps: {
          where: { provider },
          take: 1,
          select: { providerGameId: true },
        },
        plays: { where: { supersededAt: null }, orderBy: { sequence: 'asc' } },
      },
    });
    if (game === null) return null;
    return {
      id: game.id,
      status: game.status,
      homeTeamId: game.homeTeamId,
      awayTeamId: game.awayTeamId,
      homeAbbreviation: game.homeTeam.abbreviation,
      awayAbbreviation: game.awayTeam.abbreviation,
      providerMapping: game.providerMaps[0] ?? null,
      plays: game.plays,
    };
  }

  applySnapshot(input: CurrentGamePlayApplyInput): Promise<{ readonly auditEventId: string }> {
    const auditEventId = randomUUID();
    return this.prisma.$transaction(
      async (transaction) => {
        if (input.target.plays.length > 0) {
          await transaction.gamePlay.updateMany({
            where: { gameId: input.target.id, supersededAt: null },
            data: { sequence: { increment: 1_000_000 } },
          });
        }
        const newRows = input.rows.filter((row) => row.id === null);
        if (newRows.length > 0) {
          await transaction.gamePlay.createMany({
            data: newRows.map((row) => {
              const { id, ...data } = row;
              void id;
              return data;
            }),
          });
        }
        for (const row of input.rows.filter((candidate) => candidate.id !== null)) {
          const { id, ...data } = row;
          if (id !== null) await transaction.gamePlay.update({ where: { id }, data });
        }
        await transaction.adminAuditEvent.create({
          data: {
            id: auditEventId,
            actorUserId: input.actor?.userId ?? null,
            actorEmailSnapshot: input.actor?.emailSnapshot ?? 'current-game-plays-sync-cli',
            action: input.auditAction ?? 'CURRENT_GAME_PLAYS_SYNC',
            entityType: 'GAME',
            entityId: input.target.id,
            beforeSnapshot: { playRows: input.target.plays.length },
            afterSnapshot: {
              provider: input.provider,
              usageMode: input.usageMode,
              playRows: input.rows.length,
              inserted: input.inserted,
              updated: input.updated,
            },
            requestId: input.actor?.requestId ?? null,
            ...(input.auditReason === undefined ? {} : { reason: input.auditReason }),
          },
        });
        return { auditEventId };
      },
      { timeout: 30_000 },
    );
  }

  applyRepair(input: CurrentGamePlayRepairApplyInput): Promise<{ readonly auditEventId: string }> {
    const auditEventId = randomUUID();
    return this.prisma.$transaction(
      async (transaction) => {
        if (input.supersedeIds.length > 0) {
          await transaction.gamePlay.updateMany({
            where: { id: { in: [...input.supersedeIds] } },
            data: { supersededAt: new Date(), supersededByRunId: auditEventId },
          });
        }
        const newRows = input.rows.filter((row) => row.id === null);
        if (newRows.length > 0) {
          await transaction.gamePlay.createMany({
            data: newRows.map((row) => {
              const { id, ...data } = row;
              void id;
              return data;
            }),
          });
        }
        for (const row of input.rows.filter((candidate) => candidate.id !== null)) {
          const { id, ...data } = row;
          if (id !== null) await transaction.gamePlay.update({ where: { id }, data });
        }
        await transaction.adminAuditEvent.create({
          data: {
            id: auditEventId,
            actorUserId: input.actor.userId,
            actorEmailSnapshot: input.actor.emailSnapshot,
            action: input.auditAction,
            entityType: 'GAME',
            entityId: input.target.id,
            beforeSnapshot: { playRows: input.target.plays.length },
            afterSnapshot: {
              provider: input.provider,
              cutoffSequence: input.cutoffSequence,
              supersededCount: input.supersedeIds.length,
              playRows: input.rows.length,
            },
            requestId: input.actor.requestId,
            reason: input.auditReason,
          },
        });
        return { auditEventId };
      },
      { timeout: 30_000 },
    );
  }

  replaceWithAuthoritativeFinalSnapshot(
    input: CurrentGamePlayFinalReplaceInput,
  ): Promise<{ readonly auditEventId: string }> {
    const auditEventId = randomUUID();
    return this.prisma.$transaction(
      async (transaction) => {
        const priorActiveCount = input.target.plays.length;
        if (priorActiveCount > 0) {
          await transaction.gamePlay.updateMany({
            where: { gameId: input.target.id, supersededAt: null },
            data: { supersededAt: new Date(), supersededByRunId: auditEventId },
          });
        }
        if (input.rows.length > 0) {
          await transaction.gamePlay.createMany({
            data: input.rows.map((row) => {
              const { id, ...data } = row;
              void id;
              return data;
            }),
          });
        }
        await transaction.adminAuditEvent.create({
          data: {
            id: auditEventId,
            actorUserId: null,
            actorEmailSnapshot: input.actorEmailSnapshot,
            action: 'CURRENT_GAME_PLAYS_FINAL_REPLACED',
            entityType: 'GAME',
            entityId: input.target.id,
            beforeSnapshot: { playRows: priorActiveCount },
            afterSnapshot: {
              provider: input.provider,
              phase: input.phase,
              fingerprint: input.fingerprint,
              priorActiveCount,
              newActiveCount: input.rows.length,
              supersededCount: priorActiveCount,
            },
            requestId: null,
          },
        });
        return { auditEventId };
      },
      { timeout: 30_000 },
    );
  }
}
