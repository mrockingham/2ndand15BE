import 'dotenv/config';

import { createPrismaClient } from '../common/database/prisma.js';
import { PrismaArticleRepository } from '../modules/articles/article.repository.js';
import { ArticleService } from '../modules/articles/article.service.js';
import { PrismaGameHighlightsRepository } from '../modules/game-highlights/game-highlights.repository.js';
import { GameHighlightsService } from '../modules/game-highlights/game-highlights.service.js';
import { PrismaGameMediaCurationRepository } from '../modules/game-media-curation/game-media-curation.repository.js';
import { GameMediaCurationService } from '../modules/game-media-curation/game-media-curation.service.js';
import { PrismaGlobalGameMediaRepository } from '../modules/game-media-curation/global-game-media.repository.js';
import { PrismaTeamHomepageRepository } from '../modules/team-homepage/team-homepage.repository.js';
import { TeamHomepageService } from '../modules/team-homepage/team-homepage.service.js';

const databaseUrl = process.env.DATABASE_URL;
if (databaseUrl === undefined || databaseUrl.length === 0) {
  throw new Error('DATABASE_URL is required.');
}

const prisma = createPrismaClient(databaseUrl);

try {
  const teams = await prisma.team.findMany({
    where: { league: 'NFL', isActive: true },
    select: { id: true, abbreviation: true, fullName: true },
  });
  const rows = await Promise.all(
    teams.map(async (team) => {
      const gameWhere = { OR: [{ homeTeamId: team.id }, { awayTeamId: team.id }] };
      const [articles, games, gameHighlights, curatedVideos] = await Promise.all([
        prisma.articleTeam.count({ where: { teamId: team.id } }),
        prisma.game.count({ where: gameWhere }),
        prisma.gameHighlight.count({ where: { game: gameWhere } }),
        prisma.gameCuratedVideo.count({ where: { game: gameWhere } }),
      ]);
      return {
        ...team,
        articles,
        games,
        gameHighlights,
        curatedVideos,
        media: gameHighlights + curatedVideos,
      };
    }),
  );
  const eligible = rows
    .filter((row) => row.articles > 0 && row.games > 0 && row.media > 0)
    .sort(
      (left, right) =>
        right.media - left.media ||
        right.articles - left.articles ||
        left.abbreviation.localeCompare(right.abbreviation),
    );
  const articleService = new ArticleService(new PrismaArticleRepository(prisma));
  const highlightsService = new GameHighlightsService(
    new PrismaGameHighlightsRepository(prisma),
    undefined,
    () => new Date(),
    false,
  );
  const mediaService = new GameMediaCurationService(
    new PrismaGameMediaCurationRepository(prisma),
    highlightsService,
    null,
    new PrismaGlobalGameMediaRepository(prisma),
  );
  const homepageService = new TeamHomepageService({
    repository: new PrismaTeamHomepageRepository(prisma),
    articles: articleService,
    gameMedia: mediaService,
  });
  const samples = [eligible[0], eligible.at(-1)].filter(
    (team): team is NonNullable<typeof team> => team !== undefined,
  );
  const composed = await Promise.all(
    samples.map(async (team) => {
      const homepage = await homepageService.getPublicHomepage(team.id);
      return {
        abbreviation: team.abbreviation,
        bannerUsesFallback: homepage.banner.imageUrl === null,
        featuredType: homepage.editorial.featuredItem?.type ?? null,
        featuredId:
          homepage.editorial.featuredItem?.type === 'ARTICLE'
            ? homepage.editorial.featuredItem.article.id
            : (homepage.editorial.featuredItem?.id ?? null),
        supportingCount: homepage.editorial.supportingItems.length,
        highlightCount: homepage.highlights.length,
        highlights: homepage.highlights.map((item) => ({
          id: item.id,
          gameId: item.gameId,
          canEmbed: item.canEmbed,
          hasCanonicalFallback: item.canonicalUrl !== null,
        })),
      };
    }),
  );
  console.log(
    JSON.stringify(
      {
        eligibleTeamCount: eligible.length,
        dense: eligible[0] ?? null,
        sparse: eligible.at(-1) ?? null,
        composed,
      },
      null,
      2,
    ),
  );
} finally {
  await prisma.$disconnect();
}
