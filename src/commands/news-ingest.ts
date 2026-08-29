import 'dotenv/config';

import { randomUUID } from 'node:crypto';

import { createPrismaClient } from '../common/database/prisma.js';
import { loadNewsIngestionConfig } from '../config/env.js';
import type { AdministrativePrincipal } from '../modules/admin/admin-authorization.js';
import { SafeFeedClient } from '../modules/news-inbox/feed-client.js';
import { PrismaNewsInboxRepository } from '../modules/news-inbox/news.repository.js';
import {
  NEWS_AUTO_PUBLISH_SYSTEM_ACTOR_EMAIL,
  NewsInboxService,
} from '../modules/news-inbox/news.service.js';

// Production currently has 23 active sources. Keep `--all` bounded above that
// reviewed registry size so an accidental mass activation still fails closed.
const MAXIMUM_BULK_SOURCES = 32;

async function main(): Promise<void> {
  const arguments_ = parseArguments(process.argv.slice(2));
  const config = loadNewsIngestionConfig();
  const prisma = createPrismaClient(config.databaseUrl);
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
    const service = new NewsInboxService(
      repository,
      new SafeFeedClient(),
      config.newsIngestion,
      () => new Date(),
      config.newsAutoPublish,
    );
    const sources = arguments_.all
      ? await listBoundedActiveSources(repository)
      : [await requireSource(repository, arguments_.sourceSlug)];
    const results = [];
    for (const source of sources) {
      results.push(await service.ingestSource(source.id, actor, `news-cli-${randomUUID()}`));
    }
    // M42B: one bounded auto-publish pass per invocation, after every
    // source's ingestion has landed its candidates -- not a second cron, not
    // per-source (the global per-run cap in `evaluateAutoPublishBatch`
    // wouldn't mean anything if applied separately per source). Only runs
    // for `--all`, matching the Render cron's actual invocation shape;
    // `--source=<slug>` stays a scoped, single-source debug/test path with
    // no cross-source side effects. Uses the dedicated system actor, never
    // the human `--actor=` account -- auto-publication must never be
    // attributed to whichever person happens to run the cron (ticket §O).
    const autoPublish = arguments_.all
      ? await service.autoPublishEligibleCandidates(
          await requireSystemActor(prisma),
          `news-cli-autopublish-${randomUUID()}`,
        )
      : null;
    process.stdout.write(`${JSON.stringify({ sources: results, autoPublish }, null, 2)}\n`);
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

async function requireSystemActor(
  prisma: ConstructorParameters<typeof PrismaNewsInboxRepository>[0],
): Promise<AdministrativePrincipal> {
  const user = await prisma.user.findUnique({
    where: { normalizedEmail: NEWS_AUTO_PUBLISH_SYSTEM_ACTOR_EMAIL.toLowerCase() },
    select: { id: true, email: true, role: true, isActive: true },
  });
  if (user === null || !user.isActive || !['EDITOR', 'ADMIN'].includes(user.role)) {
    throw new Error(
      `The auto-publish system actor (${NEWS_AUTO_PUBLISH_SYSTEM_ACTOR_EMAIL}) must exist as an active EDITOR or ADMIN account.`,
    );
  }
  return { userId: user.id, email: user.email, role: user.role };
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
