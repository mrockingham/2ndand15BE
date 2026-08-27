import 'dotenv/config';

import { createPrismaClient } from '../common/database/prisma.js';
import { createLogger } from '../common/logging/logger.js';
import { loadConfig } from '../config/env.js';

/**
 * READ-ONLY pre-launch content audit. Prints (as JSON lines, matching this
 * repo's other commands' stdout-JSON convention) candidate rows that look
 * like disposable test/placeholder content left over from development, so a
 * human operator can review and decide what to clean up manually before a
 * production launch.
 *
 * This command NEVER deletes or modifies any row. A companion cleanup
 * command is deliberately out of scope -- removal is a separate, manual,
 * reviewed step. See docs/production/deployment.md.
 */

const TEXT_MARKERS = ['test', 'placeholder', 'sample', 'todo', 'lorem', 'example.com', 'dummy'];

const markerPattern = new RegExp(TEXT_MARKERS.map(escapeRegExp).join('|'), 'i');

interface Candidate {
  readonly model: string;
  readonly id: string;
  readonly field: string;
  readonly snippet: string;
}

let prisma: ReturnType<typeof createPrismaClient> | undefined;

try {
  const config = loadConfig();
  const logger = createLogger(config);
  prisma = createPrismaClient(config.databaseUrl);

  const candidates: Candidate[] = [];

  // HomepageHeroSlide: only free-text field is imageAlt (VarChar 300); imageUrl
  // is also checked since a leftover dev/placeholder image URL is a plausible
  // pre-launch artifact even though it isn't prose text.
  const heroSlides = await prisma.homepageHeroSlide.findMany({
    select: { id: true, imageAlt: true, imageUrl: true },
  });
  for (const row of heroSlides) {
    checkField(candidates, 'HomepageHeroSlide', row.id, 'imageAlt', row.imageAlt);
    checkField(candidates, 'HomepageHeroSlide', row.id, 'imageUrl', row.imageUrl);
  }

  // HomepageTopStory has no free-text fields of its own (id/articleId/position/
  // audit columns only) -- nothing to scan here. Included for completeness so
  // the summary below always reports all four models by name.

  const curatedVideos = await prisma.gameCuratedVideo.findMany({
    select: {
      id: true,
      title: true,
      embedUrl: true,
      canonicalUrl: true,
      thumbnailUrl: true,
      sourceLabel: true,
    },
  });
  for (const row of curatedVideos) {
    checkField(candidates, 'GameCuratedVideo', row.id, 'title', row.title);
    checkField(candidates, 'GameCuratedVideo', row.id, 'embedUrl', row.embedUrl);
    checkField(candidates, 'GameCuratedVideo', row.id, 'canonicalUrl', row.canonicalUrl);
    checkField(candidates, 'GameCuratedVideo', row.id, 'thumbnailUrl', row.thumbnailUrl);
    checkField(candidates, 'GameCuratedVideo', row.id, 'sourceLabel', row.sourceLabel);
  }

  const globalVideos = await prisma.globalGameCenterVideo.findMany({
    select: {
      id: true,
      title: true,
      embedUrl: true,
      canonicalUrl: true,
      thumbnailUrl: true,
      sourceLabel: true,
    },
  });
  for (const row of globalVideos) {
    checkField(candidates, 'GlobalGameCenterVideo', row.id, 'title', row.title);
    checkField(candidates, 'GlobalGameCenterVideo', row.id, 'embedUrl', row.embedUrl);
    checkField(candidates, 'GlobalGameCenterVideo', row.id, 'canonicalUrl', row.canonicalUrl);
    checkField(candidates, 'GlobalGameCenterVideo', row.id, 'thumbnailUrl', row.thumbnailUrl);
    checkField(candidates, 'GlobalGameCenterVideo', row.id, 'sourceLabel', row.sourceLabel);
  }

  // User: no "+smoke"/"+test" account-tagging convention exists anywhere else
  // in this codebase (grepped test/seed files for one) -- fall back to
  // flagging obviously fake email domains, the same convention already used
  // in this repo's own tests/fixtures.
  const users = await prisma.user.findMany({
    where: {
      OR: [
        { email: { contains: 'example.com', mode: 'insensitive' } },
        { email: { contains: 'test.com', mode: 'insensitive' } },
        { email: { contains: '+test', mode: 'insensitive' } },
        { email: { contains: '+smoke', mode: 'insensitive' } },
      ],
    },
    select: { id: true, email: true },
  });
  for (const row of users) {
    candidates.push({
      model: 'User',
      id: row.id,
      field: 'email',
      snippet: row.email,
    });
  }

  for (const candidate of candidates) {
    process.stdout.write(`${JSON.stringify({ candidate })}\n`);
  }

  const summary = summarizeByModel(candidates);
  process.stdout.write(
    `${JSON.stringify({
      summary: {
        modelsScanned: [
          'HomepageHeroSlide',
          'HomepageTopStory',
          'GameCuratedVideo',
          'GlobalGameCenterVideo',
          'User',
        ],
        totalCandidates: candidates.length,
        byModel: summary,
        markers: TEXT_MARKERS,
      },
    })}\n`,
  );

  logger.info(
    { totalCandidates: candidates.length },
    'production-content-audit completed (read-only; no rows modified)',
  );
} catch (error: unknown) {
  process.stderr.write(
    `${JSON.stringify({
      error: {
        message: error instanceof Error ? error.message : 'production-content-audit failed.',
      },
    })}\n`,
  );
  process.exitCode = 1;
} finally {
  await prisma?.$disconnect();
}

function checkField(
  candidates: Candidate[],
  model: string,
  id: string,
  field: string,
  value: string | null | undefined,
): void {
  if (value === null || value === undefined) return;
  if (!markerPattern.test(value)) return;
  candidates.push({ model, id, field, snippet: value.slice(0, 200) });
}

function summarizeByModel(candidates: readonly Candidate[]): Record<string, number> {
  const summary: Record<string, number> = {};
  for (const candidate of candidates) {
    summary[candidate.model] = (summary[candidate.model] ?? 0) + 1;
  }
  return summary;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
