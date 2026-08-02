import type { Request, RequestHandler } from 'express';

import { AppError } from '../../common/errors/app-error.js';
import type { AdministrativePrincipal } from '../admin/admin-authorization.js';
import {
  adminArticleListQuerySchema,
  articleCreateSchema,
  articleIdParamsSchema,
  articleRevisionParamsSchema,
  articleScheduleSchema,
  articleSlugParamsSchema,
  articleTeamsUpdateSchema,
  articleUpdateSchema,
  articleVersionActionSchema,
  publicArticleListQuerySchema,
  revisionListQuerySchema,
  teamArticleParamsSchema,
} from './article.schemas.js';
import type { EditorialArticleService, PublicArticleReader } from './article.service.js';

export function createPublicArticleController(service: PublicArticleReader): {
  readonly list: RequestHandler;
  readonly featured: RequestHandler;
  readonly detail: RequestHandler;
  readonly teamList: RequestHandler;
} {
  return {
    list: async (request, response) => {
      const query = parse(publicArticleListQuerySchema, request.query, 'query parameters');
      const page = await service.list(query);
      setPublicCache(response);
      response.status(200).json({ data: page.articles, meta: { nextCursor: page.nextCursor } });
    },
    featured: async (request, response) => {
      const query = parse(publicArticleListQuerySchema, request.query, 'query parameters');
      const page = await service.listFeatured(query);
      setPublicCache(response);
      response.status(200).json({ data: page.articles, meta: { nextCursor: page.nextCursor } });
    },
    detail: async (request, response) => {
      const { slug } = parse(articleSlugParamsSchema, request.params, 'path parameters');
      setPublicCache(response);
      response.status(200).json({ data: await service.getBySlug(slug) });
    },
    teamList: async (request, response) => {
      const { teamId } = parse(teamArticleParamsSchema, request.params, 'path parameters');
      const query = parse(publicArticleListQuerySchema, request.query, 'query parameters');
      const page = await service.listForTeam(teamId, query);
      setPublicCache(response);
      response.status(200).json({ data: page.articles, meta: { nextCursor: page.nextCursor } });
    },
  };
}

export function createAdminArticleController(service: EditorialArticleService) {
  return {
    list: handler(async (request, response) => {
      const query = parse(adminArticleListQuerySchema, request.query, 'query parameters');
      const page = await service.listAdmin(query);
      response.status(200).json({ data: page.articles, meta: { nextCursor: page.nextCursor } });
    }),
    detail: handler(async (request, response) => {
      const { articleId } = parse(articleIdParamsSchema, request.params, 'path parameters');
      response.status(200).json({ data: await service.getAdmin(articleId) });
    }),
    create: handler(async (request, response) => {
      const input = parse(articleCreateSchema, request.body, 'request body');
      response.status(201).json({
        data: await service.create(input, principal(request), requestId(request)),
      });
    }),
    update: handler(async (request, response) => {
      const { articleId } = parse(articleIdParamsSchema, request.params, 'path parameters');
      const input = parse(articleUpdateSchema, request.body, 'request body');
      response.status(200).json({
        data: await service.update(articleId, input, principal(request), requestId(request)),
      });
    }),
    teams: handler(async (request, response) => {
      const { articleId } = parse(articleIdParamsSchema, request.params, 'path parameters');
      const input = parse(articleTeamsUpdateSchema, request.body, 'request body');
      response.status(200).json({
        data: await service.replaceTeams(articleId, input, principal(request), requestId(request)),
      });
    }),
    publish: statusHandler(service.publish.bind(service)),
    unpublish: statusHandler(service.unpublish.bind(service)),
    schedule: handler(async (request, response) => {
      const { articleId } = parse(articleIdParamsSchema, request.params, 'path parameters');
      const input = parse(articleScheduleSchema, request.body, 'request body');
      response.status(200).json({
        data: await service.schedule(articleId, input, principal(request), requestId(request)),
      });
    }),
    archive: statusHandler(service.archive.bind(service)),
    restore: statusHandler(service.restore.bind(service)),
    revisions: handler(async (request, response) => {
      const { articleId } = parse(articleIdParamsSchema, request.params, 'path parameters');
      const query = parse(revisionListQuerySchema, request.query, 'query parameters');
      const page = await service.listRevisions(articleId, query);
      response.status(200).json({ data: page.revisions, meta: { nextCursor: page.nextCursor } });
    }),
    revision: handler(async (request, response) => {
      const { articleId, revisionId } = parse(
        articleRevisionParamsSchema,
        request.params,
        'path parameters',
      );
      response.status(200).json({ data: await service.getRevision(articleId, revisionId) });
    }),
  };

  function statusHandler(
    operation: (
      id: string,
      input: ReturnType<typeof articleVersionActionSchema.parse>,
      actor: AdministrativePrincipal,
      requestId: string | null,
    ) => Promise<unknown>,
  ): RequestHandler {
    return handler(async (request, response) => {
      const { articleId } = parse(articleIdParamsSchema, request.params, 'path parameters');
      const input = parse(articleVersionActionSchema, request.body, 'request body');
      response.status(200).json({
        data: await operation(articleId, input, principal(request), requestId(request)),
      });
    });
  }
}

function handler(operation: RequestHandler): RequestHandler {
  return operation;
}

function principal(request: Request): AdministrativePrincipal {
  if (request.admin === undefined) {
    throw new AppError({
      code: 'UNAUTHORIZED',
      message: 'A valid administrative account is required.',
      statusCode: 401,
    });
  }
  return request.admin;
}

function requestId(request: Request): string | null {
  const value = request.headers['x-request-id'];
  return typeof value === 'string' ? value : null;
}

function setPublicCache(response: Parameters<RequestHandler>[1]): void {
  response.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
}

function parse<T>(
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
