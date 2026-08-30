import 'dotenv/config';

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { AppError } from '../common/errors/app-error.js';
import { createPrismaClient } from '../common/database/prisma.js';
import { loadDatabaseConfig } from '../config/env.js';
import type { AdministrativePrincipal } from '../modules/admin/admin-authorization.js';
import { PrismaPowerRankingRepository } from '../modules/power-rankings/power-ranking.repository.js';
import { powerRankingImportDocumentSchema } from '../modules/power-rankings/power-ranking.schemas.js';
import { PowerRankingService } from '../modules/power-rankings/power-ranking.service.js';

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2));
  const config = loadDatabaseConfig();
  const prisma = createPrismaClient(config.databaseUrl);
  try {
    const raw = await readFile(resolve(options.file), 'utf8');
    const document = powerRankingImportDocumentSchema.parse(JSON.parse(raw));
    const service = new PowerRankingService(new PrismaPowerRankingRepository(prisma));

    if (!options.write) {
      const preview = await service.previewImport(document);
      console.log(JSON.stringify(preview, null, 2));
      if (!preview.valid) process.exitCode = 1;
      return;
    }

    const actor = await requireActor(prisma, options.actorEmail);
    const result = await service.upsertImport(document, options.publish, actor, null);
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

async function requireActor(
  prisma: ReturnType<typeof createPrismaClient>,
  actorEmail: string,
): Promise<AdministrativePrincipal> {
  const user = await prisma.user.findUnique({
    where: { normalizedEmail: actorEmail.toLowerCase() },
    select: { id: true, email: true, role: true, isActive: true },
  });
  if (user === null || !user.isActive || !['EDITOR', 'ADMIN'].includes(user.role)) {
    throw new AppError({
      code: 'IMPORT_ACTOR_INVALID',
      message: 'The --actor= email must identify an active EDITOR or ADMIN account.',
      statusCode: 400,
    });
  }
  return { userId: user.id, email: user.email, role: user.role };
}

function parseArguments(arguments_: readonly string[]): {
  readonly file: string;
  readonly write: boolean;
  readonly publish: boolean;
  readonly actorEmail: string;
} {
  const fileArgument = arguments_.find((argument) => argument.startsWith('--file='));
  const actorArgument = arguments_.find((argument) => argument.startsWith('--actor='));
  const write = arguments_.includes('--write');
  const publish = arguments_.includes('--publish');
  const known = arguments_.every(
    (argument) =>
      argument.startsWith('--file=') ||
      argument.startsWith('--actor=') ||
      argument === '--write' ||
      argument === '--dry-run' ||
      argument === '--publish',
  );
  if (
    fileArgument === undefined ||
    fileArgument.slice('--file='.length).trim() === '' ||
    !known ||
    (write && arguments_.includes('--dry-run')) ||
    (publish && !write)
  ) {
    throw new AppError({
      code: 'IMPORT_ARGUMENTS_INVALID',
      message:
        'Usage: npm run power-rankings:import -- --file=path/to/rankings.json --actor=<editor-or-admin-email> [--write] [--publish]. ' +
        'Without --write, the import only previews/validates and writes nothing; --publish requires --write and needs exactly 32 entries.',
      statusCode: 400,
    });
  }
  if (
    write &&
    (actorArgument === undefined || actorArgument.slice('--actor='.length).trim() === '')
  ) {
    throw new AppError({
      code: 'IMPORT_ACTOR_REQUIRED',
      message: '--actor=<editor-or-admin-email> is required with --write.',
      statusCode: 400,
    });
  }
  return {
    file: fileArgument.slice('--file='.length),
    write,
    publish,
    actorEmail: actorArgument?.slice('--actor='.length).trim() ?? '',
  };
}

main().catch((error: unknown) => {
  if (error instanceof AppError) {
    console.error(
      JSON.stringify({
        error: { code: error.code, message: error.message, details: error.details },
      }),
    );
  } else {
    console.error(
      JSON.stringify({
        error: { code: 'IMPORT_FAILED', message: 'Power rankings import failed.' },
      }),
    );
  }
  process.exitCode = 1;
});
