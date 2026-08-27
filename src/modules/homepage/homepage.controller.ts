import type { Request, RequestHandler } from 'express';

import { AppError } from '../../common/errors/app-error.js';
import type { AdministrativePrincipal } from '../admin/admin-authorization.js';
import {
  addHighlightPlacementSchema,
  createHeroSlideSchema,
  highlightCandidatesQuerySchema,
  homepageHeroSlideIdParamsSchema,
  homepageHighlightPlacementIdParamsSchema,
  homepageTopStoryArticleIdParamsSchema,
  reorderHeroSlidesSchema,
  reorderHighlightPlacementsSchema,
  reorderTopStoriesSchema,
  updateHeroSlideSchema,
  updateHighlightSettingsSchema,
} from './homepage.schemas.js';
import type { HomepageServiceContract } from './homepage.service.js';

export interface HomepageController {
  readonly listHeroSlides: RequestHandler;
  readonly getHeroSlide: RequestHandler;
  readonly createHeroSlide: RequestHandler;
  readonly updateHeroSlide: RequestHandler;
  readonly deleteHeroSlide: RequestHandler;
  readonly reorderHeroSlides: RequestHandler;
  readonly listTopStories: RequestHandler;
  readonly markTopStory: RequestHandler;
  readonly unmarkTopStory: RequestHandler;
  readonly reorderTopStories: RequestHandler;
  readonly listHighlightPlacements: RequestHandler;
  readonly listHighlightCandidates: RequestHandler;
  readonly addHighlightPlacement: RequestHandler;
  readonly removeHighlightPlacement: RequestHandler;
  readonly reorderHighlightPlacements: RequestHandler;
  readonly updateHighlightSettings: RequestHandler;
  readonly getPublicHomepage: RequestHandler;
}

export function createHomepageController(service: HomepageServiceContract): HomepageController {
  return {
    listHeroSlides: async (_request, response) => {
      response.status(200).json({ data: await service.listHeroSlides() });
    },
    getHeroSlide: async (request, response) => {
      const { slideId } = parseOrThrow(
        homepageHeroSlideIdParamsSchema,
        request.params,
        'path parameters',
      );
      response.status(200).json({ data: await service.getHeroSlide(slideId) });
    },
    createHeroSlide: async (request, response) => {
      const input = parseOrThrow(createHeroSlideSchema, request.body, 'request body');
      response.status(201).json({
        data: await service.createHeroSlide(
          input,
          requirePrincipal(request.admin),
          requestId(request),
        ),
      });
    },
    updateHeroSlide: async (request, response) => {
      const { slideId } = parseOrThrow(
        homepageHeroSlideIdParamsSchema,
        request.params,
        'path parameters',
      );
      const input = parseOrThrow(updateHeroSlideSchema, request.body, 'request body');
      response.status(200).json({
        data: await service.updateHeroSlide(
          slideId,
          input,
          requirePrincipal(request.admin),
          requestId(request),
        ),
      });
    },
    deleteHeroSlide: async (request, response) => {
      const { slideId } = parseOrThrow(
        homepageHeroSlideIdParamsSchema,
        request.params,
        'path parameters',
      );
      response.status(200).json({
        data: await service.deleteHeroSlide(
          slideId,
          requirePrincipal(request.admin),
          requestId(request),
        ),
      });
    },
    reorderHeroSlides: async (request, response) => {
      const input = parseOrThrow(reorderHeroSlidesSchema, request.body, 'request body');
      response.status(200).json({
        data: await service.reorderHeroSlides(
          input,
          requirePrincipal(request.admin),
          requestId(request),
        ),
      });
    },
    listTopStories: async (_request, response) => {
      response.status(200).json({ data: await service.listTopStories() });
    },
    markTopStory: async (request, response) => {
      const { articleId } = parseOrThrow(
        homepageTopStoryArticleIdParamsSchema,
        request.params,
        'path parameters',
      );
      response.status(200).json({
        data: await service.markTopStory(
          articleId,
          requirePrincipal(request.admin),
          requestId(request),
        ),
      });
    },
    unmarkTopStory: async (request, response) => {
      const { articleId } = parseOrThrow(
        homepageTopStoryArticleIdParamsSchema,
        request.params,
        'path parameters',
      );
      await service.unmarkTopStory(articleId, requirePrincipal(request.admin), requestId(request));
      response.status(204).send();
    },
    reorderTopStories: async (request, response) => {
      const input = parseOrThrow(reorderTopStoriesSchema, request.body, 'request body');
      response.status(200).json({
        data: await service.reorderTopStories(
          input,
          requirePrincipal(request.admin),
          requestId(request),
        ),
      });
    },
    listHighlightPlacements: async (_request, response) => {
      response.status(200).json({ data: await service.listHighlightPlacements() });
    },
    listHighlightCandidates: async (request, response) => {
      const query = parseOrThrow(highlightCandidatesQuerySchema, request.query, 'query parameters');
      response.status(200).json({ data: await service.listHighlightCandidates(query) });
    },
    addHighlightPlacement: async (request, response) => {
      const input = parseOrThrow(addHighlightPlacementSchema, request.body, 'request body');
      response.status(201).json({
        data: await service.addHighlightPlacement(
          input,
          requirePrincipal(request.admin),
          requestId(request),
        ),
      });
    },
    removeHighlightPlacement: async (request, response) => {
      const { placementId } = parseOrThrow(
        homepageHighlightPlacementIdParamsSchema,
        request.params,
        'path parameters',
      );
      await service.removeHighlightPlacement(
        placementId,
        requirePrincipal(request.admin),
        requestId(request),
      );
      response.status(204).send();
    },
    reorderHighlightPlacements: async (request, response) => {
      const input = parseOrThrow(reorderHighlightPlacementsSchema, request.body, 'request body');
      response.status(200).json({
        data: await service.reorderHighlightPlacements(
          input,
          requirePrincipal(request.admin),
          requestId(request),
        ),
      });
    },
    updateHighlightSettings: async (request, response) => {
      const input = parseOrThrow(updateHighlightSettingsSchema, request.body, 'request body');
      response.status(200).json({
        data: await service.updateHighlightSettings(
          input,
          requirePrincipal(request.admin),
          requestId(request),
        ),
      });
    },
    getPublicHomepage: async (_request, response) => {
      response.status(200).json({ data: await service.getPublicHomepage() });
    },
  };
}

function requirePrincipal(principal: AdministrativePrincipal | undefined): AdministrativePrincipal {
  if (principal === undefined) {
    throw new AppError({
      code: 'UNAUTHORIZED',
      message: 'A valid access token is required.',
      statusCode: 401,
    });
  }
  return principal;
}

function requestId(request: Request): string | null {
  const value = request.headers['x-request-id'];
  return typeof value === 'string' ? value : null;
}

function parseOrThrow<T>(
  schema: {
    safeParse(
      value: unknown,
    ):
      | { success: true; data: T }
      | { success: false; error: { issues: readonly { path: PropertyKey[]; message: string }[] } };
  },
  value: unknown,
  label: string,
): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new AppError({
      code: 'VALIDATION_ERROR',
      message: `The ${label} is invalid.`,
      statusCode: 400,
      details: result.error.issues.map((issue) => ({
        field: issue.path.join('.'),
        message: issue.message,
      })),
    });
  }
  return result.data;
}
