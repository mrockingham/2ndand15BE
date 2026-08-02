import 'dotenv/config';

import { resolve } from 'node:path';

import { AppError } from '../common/errors/app-error.js';
import { createPrismaClient } from '../common/database/prisma.js';
import { loadDatabaseConfig } from '../config/env.js';
import { PrismaAdminRepository } from '../modules/admin/admin.repository.js';
import { scheduleImportRequestSchema } from '../modules/admin/admin.schemas.js';
import { AdminService } from '../modules/admin/admin.service.js';
import { readScheduleImportFile } from '../modules/admin/schedule-csv.js';

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2));
  const config = loadDatabaseConfig();
  const prisma = createPrismaClient(config.databaseUrl);
  try {
    const rows = await readScheduleImportFile(resolve(options.file));
    const request = scheduleImportRequestSchema.parse({ rows, dryRun: !options.write });
    const result = await new AdminService(new PrismaAdminRepository(prisma)).importSchedule(
      request,
      null,
      null,
    );
    console.log(JSON.stringify(result));
    if (result.failed > 0) process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

function parseArguments(arguments_: readonly string[]): {
  readonly file: string;
  readonly write: boolean;
} {
  const fileArgument = arguments_.find((argument) => argument.startsWith('--file='));
  const write = arguments_.includes('--write');
  if (fileArgument === undefined || fileArgument.slice('--file='.length).trim() === '') {
    throw new AppError({
      code: 'IMPORT_FILE_REQUIRED',
      message: 'Usage: npm run schedule:import -- --file=path/to/schedule.csv [--write]',
      statusCode: 400,
    });
  }
  const unexpected = arguments_.filter(
    (argument) =>
      !argument.startsWith('--file=') && argument !== '--write' && argument !== '--dry-run',
  );
  if (unexpected.length > 0 || (write && arguments_.includes('--dry-run'))) {
    throw new AppError({
      code: 'IMPORT_ARGUMENTS_INVALID',
      message: 'Use one --file argument and either --dry-run or --write.',
      statusCode: 400,
    });
  }
  return { file: fileArgument.slice('--file='.length), write };
}

main().catch((error: unknown) => {
  if (error instanceof AppError) {
    console.error(
      JSON.stringify({
        error: { code: error.code, message: error.message, details: error.details },
      }),
    );
  } else
    console.error(
      JSON.stringify({ error: { code: 'IMPORT_FAILED', message: 'Schedule import failed.' } }),
    );
  process.exitCode = 1;
});
