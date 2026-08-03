import 'dotenv/config';

import { randomUUID } from 'node:crypto';

import { createPrismaClient } from '../common/database/prisma.js';
import { loadDatabaseConfig } from '../config/env.js';
import type { AdministrativePrincipal } from '../modules/admin/admin-authorization.js';
import { SafeFeedClient } from '../modules/news-inbox/feed-client.js';
import { PrismaNewsInboxRepository } from '../modules/news-inbox/news.repository.js';
import { NewsInboxService } from '../modules/news-inbox/news.service.js';

const MAXIMUM_BULK_SOURCES = 5;

async function main(): Promise<void> {
  const arguments_ = parseArguments(process.argv.slice(2));
  const prisma = createPrismaClient(loadDatabaseConfig().databaseUrl);
  try {
    const user = await prisma.user.findUnique({
      where: { normalizedEmail: arguments_.actorEmail.toLowerCase() },
      select: { id: true, email: true, role: true, isActive: true },
    });
    if (user === null || !user.isActive || !['EDITOR', 'ADMIN'].includes(user.role)) {
      throw new Error('The CLI actor must identify an active EDITOR or ADMIN account.');
    }
    const actor: AdministrativePrincipal = {
      userId: user.id,
      email: user.email,
      role: user.role,
    };
    const repository = new PrismaNewsInboxRepository(prisma);
    const service = new NewsInboxService(repository, new SafeFeedClient());
    const sources = arguments_.all
      ? await listBoundedActiveSources(repository)
      : [await requireSource(repository, arguments_.sourceSlug)];
    const results = [];
    for (const source of sources) {
      results.push(await service.ingestSource(source.id, actor, `news-cli-${randomUUID()}`));
    }
    process.stdout.write(`${JSON.stringify({ sources: results }, null, 2)}\n`);
  } finally {
    await prisma.$disconnect();
  }
}

function parseArguments(arguments_: readonly string[]): {
  readonly sourceSlug: string | null;
  readonly all: boolean;
  readonly actorEmail: string;
} {
  const source = arguments_.find((argument) => argument.startsWith('--source='))?.slice(9) ?? null;
  const actor = arguments_.find((argument) => argument.startsWith('--actor='))?.slice(8) ?? null;
  const all = arguments_.includes('--all');
  const known = arguments_.every(
    (argument) =>
      argument === '--all' || argument.startsWith('--source=') || argument.startsWith('--actor='),
  );
  if (!known || actor === null || actor.trim().length === 0 || all === (source !== null)) {
    throw new Error(
      'Usage: npm run news:ingest -- (--source=<slug> | --all) --actor=<editor-or-admin-email>',
    );
  }
  return { sourceSlug: source, all, actorEmail: actor.trim() };
}

async function requireSource(repository: PrismaNewsInboxRepository, slug: string | null) {
  if (slug === null) throw new Error('A source slug is required.');
  const source = await repository.findSourceBySlug(slug);
  if (source === null) throw new Error(`No news source uses the slug ${slug}.`);
  return source;
}

async function listBoundedActiveSources(repository: PrismaNewsInboxRepository) {
  const page = await repository.listSources({
    limit: MAXIMUM_BULK_SOURCES,
    status: 'ACTIVE',
  });
  if (page.nextCursor !== null) {
    throw new Error(`--all is bounded to ${String(MAXIMUM_BULK_SOURCES)} active sources.`);
  }
  return page.sources.filter(({ kind }) => kind !== 'MANUAL_ONLY');
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : 'News ingestion failed.'}\n`);
  process.exitCode = 1;
});
