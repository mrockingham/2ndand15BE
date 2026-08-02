import 'dotenv/config';

import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { AppError } from '../common/errors/app-error.js';
import { createPrismaClient } from '../common/database/prisma.js';
import { loadDatabaseConfig } from '../config/env.js';
import type { UserRole } from '../generated/prisma/client.js';
import { PrismaAdminRepository } from '../modules/admin/admin.repository.js';
import { AdminService } from '../modules/admin/admin.service.js';
import { emailSchema } from '../modules/auth/auth.schemas.js';

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2));
  const config = loadDatabaseConfig();
  const prisma = createPrismaClient(config.databaseUrl);
  try {
    const result = await new AdminService(new PrismaAdminRepository(prisma)).setRole(
      options.email,
      options.role,
      { userId: null, emailSnapshot: 'admin:set-role-cli', requestId: null },
    );
    console.log(
      JSON.stringify({
        userId: result.id,
        email: result.email,
        previousRole: result.previousRole,
        role: result.role,
      }),
    );
  } finally {
    await prisma.$disconnect();
  }
}

export function parseArguments(arguments_: readonly string[]): {
  readonly email: string;
  readonly role: UserRole;
} {
  const email = arguments_
    .find((argument) => argument.startsWith('--email='))
    ?.slice('--email='.length);
  const role = arguments_
    .find((argument) => argument.startsWith('--role='))
    ?.slice('--role='.length)
    .toUpperCase();
  const parsedEmail = emailSchema.safeParse(email);
  if (!parsedEmail.success || !isRole(role)) {
    throw new AppError({
      code: 'ROLE_ARGUMENTS_INVALID',
      message: 'Usage: npm run admin:set-role -- --email=user@example.com --role=USER|EDITOR|ADMIN',
      statusCode: 400,
    });
  }
  return { email: parsedEmail.data, role };
}

function isRole(value: string | undefined): value is UserRole {
  return value === 'USER' || value === 'EDITOR' || value === 'ADMIN';
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  main().catch((error: unknown) => {
    if (error instanceof AppError)
      console.error(JSON.stringify({ error: { code: error.code, message: error.message } }));
    else
      console.error(
        JSON.stringify({ error: { code: 'ROLE_UPDATE_FAILED', message: 'Role update failed.' } }),
      );
    process.exitCode = 1;
  });
}
