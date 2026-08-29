import 'dotenv/config';

import { createPrismaClient } from '../common/database/prisma.js';
import { loadNewsIngestionConfig } from '../config/env.js';
import { SafeFeedClient } from '../modules/news-inbox/feed-client.js';
import { PrismaNewsInboxRepository } from '../modules/news-inbox/news.repository.js';
import { NewsInboxService } from '../modules/news-inbox/news.service.js';

/**
 * M42B operator-safe dry run (ticket §V): evaluates the exact same pool,
 * eligibility rules, and per-run/per-source caps `autoPublishEligibleCandidates`
 * would use, but never writes anything and is never gated by
 * `NEWS_AUTO_PUBLISH_ENABLED` -- it must work to help decide whether to flip
 * that switch on in the first place. No flags: unlike `news-ingest.ts`, this
 * always evaluates against the current, real database.
 */
async function main(): Promise<void> {
  const config = loadNewsIngestionConfig();
  const prisma = createPrismaClient(config.databaseUrl);
  try {
    const repository = new PrismaNewsInboxRepository(prisma);
    const service = new NewsInboxService(
      repository,
      new SafeFeedClient(),
      config.newsIngestion,
      () => new Date(),
      config.newsAutoPublish,
    );
    const result = await service.previewAutoPublish();
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : 'Auto-publish preview failed.'}\n`,
  );
  process.exitCode = 1;
});
