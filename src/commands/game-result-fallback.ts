import 'dotenv/config';

import { z } from 'zod';

import { createPrismaClient } from '../common/database/prisma.js';
import { loadConfig } from '../config/env.js';
import { PrismaAdminRepository } from '../modules/admin/admin.repository.js';
import { gameResultFallbackInputSchema } from '../modules/admin/admin.schemas.js';
import { AdminService } from '../modules/admin/admin.service.js';
import { normalizeEmail } from '../modules/auth/auth.service.js';

const argumentsSchema = z
  .object({
    gameId: z.uuid(),
    actorEmail: z.email().optional(),
    homeScore: z.coerce.number().int().min(0),
    awayScore: z.coerce.number().int().min(0),
    sourceName: z.string().trim().min(1).max(160),
    sourceUrl: z.url().max(2_048),
    reason: z.string().trim().min(1).max(500),
    internalNote: z.string().trim().min(1).max(1_000).optional(),
    publicCorrectionNote: z.string().trim().min(1).max(500).optional(),
    dryRun: z.boolean(),
  })
  .strict();

const config = loadConfig();
const prisma = createPrismaClient(config.databaseUrl);

try {
  const parsed = argumentsSchema.parse(parseArguments(process.argv.slice(2)));
  const eligibleUsers = await prisma.user.findMany({
    where: {
      isActive: true,
      role: { in: ['EDITOR', 'ADMIN'] },
      ...(parsed.actorEmail === undefined
        ? {}
        : { normalizedEmail: normalizeEmail(parsed.actorEmail) }),
    },
    select: { id: true, email: true, role: true, isActive: true },
    take: 2,
  });
  const user = eligibleUsers[0];
  if (user === undefined || eligibleUsers.length !== 1) {
    throw new Error(
      'Specify one active editor/admin with --actorEmail when it cannot be selected uniquely.',
    );
  }
  const service = new AdminService(new PrismaAdminRepository(prisma));
  const input = gameResultFallbackInputSchema.parse({
    status: 'FINAL',
    homeScore: parsed.homeScore,
    awayScore: parsed.awayScore,
    sourceName: parsed.sourceName,
    sourceUrl: parsed.sourceUrl,
    reason: parsed.reason,
    internalNote: parsed.internalNote,
    publicCorrectionNote: parsed.publicCorrectionNote,
    dryRun: parsed.dryRun,
  });
  const report = await service.upsertResultFallback(
    parsed.gameId,
    input,
    { userId: user.id, email: user.email, role: user.role },
    null,
  );
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} catch (error: unknown) {
  process.stderr.write(
    `${JSON.stringify({ error: error instanceof Error ? error.message : 'Result fallback failed.' })}\n`,
  );
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}

function parseArguments(values: readonly string[]): Record<string, string | boolean> {
  const parsed: Record<string, string | boolean> = {};
  for (const value of values) {
    if (value === '--dry-run') parsed.dryRun = true;
    else if (value === '--apply') parsed.dryRun = false;
    else if (value.startsWith('--')) {
      const separator = value.indexOf('=');
      if (separator > 2) parsed[value.slice(2, separator)] = value.slice(separator + 1);
    }
  }
  if (!values.includes('--dry-run') && !values.includes('--apply')) {
    throw new Error('Exactly one of --dry-run or --apply is required.');
  }
  if (values.includes('--dry-run') && values.includes('--apply')) {
    throw new Error('Exactly one of --dry-run or --apply is required.');
  }
  return parsed;
}
