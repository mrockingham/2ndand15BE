import type { Request, RequestHandler } from 'express';
import { AppError } from '../../common/errors/app-error.js';
import type { AdministrativePrincipal } from '../admin/admin-authorization.js';
import {
  addTeamEditorialPlacementSchema,
  addTeamHighlightPlacementSchema,
  reorderTeamHomepagePlacementsSchema,
  teamHomepageCandidatesQuerySchema,
  teamHomepageParamsSchema,
  teamHomepagePlacementParamsSchema,
  updateTeamBannerSchema,
  updateTeamEditorialPlacementSchema,
  updateTeamHighlightSettingsSchema,
} from './team-homepage.schemas.js';
import type { TeamHomepageServiceContract } from './team-homepage.service.js';

export interface TeamHomepageController {
  readonly getHomepage: RequestHandler;
  readonly updateBanner: RequestHandler;
  readonly listEditorial: RequestHandler;
  readonly listEditorialCandidates: RequestHandler;
  readonly addEditorial: RequestHandler;
  readonly updateEditorial: RequestHandler;
  readonly removeEditorial: RequestHandler;
  readonly reorderEditorial: RequestHandler;
  readonly listHighlights: RequestHandler;
  readonly listHighlightCandidates: RequestHandler;
  readonly addHighlight: RequestHandler;
  readonly removeHighlight: RequestHandler;
  readonly reorderHighlights: RequestHandler;
  readonly updateHighlightSettings: RequestHandler;
}

export function createTeamHomepageController(
  service: TeamHomepageServiceContract,
): TeamHomepageController {
  return {
    getHomepage: async (req, res) =>
      res.status(200).json({ data: await service.getAdminHomepage(params(req).teamId) }),
    updateBanner: async (req, res) =>
      res.status(200).json({
        data: await service.updateBanner(
          params(req).teamId,
          parse(updateTeamBannerSchema, req.body),
          principal(req),
          requestId(req),
        ),
      }),
    listEditorial: async (req, res) =>
      res.status(200).json({ data: await service.listEditorial(params(req).teamId) }),
    listEditorialCandidates: async (req, res) =>
      res.status(200).json({
        data: await service.listEditorialCandidates(
          params(req).teamId,
          parse(teamHomepageCandidatesQuerySchema, req.query),
        ),
      }),
    addEditorial: async (req, res) =>
      res.status(201).json({
        data: await service.addEditorial(
          params(req).teamId,
          parse(addTeamEditorialPlacementSchema, req.body),
          principal(req),
          requestId(req),
        ),
      }),
    updateEditorial: async (req, res) => {
      const value = placementParams(req);
      res.status(200).json({
        data: await service.updateEditorial(
          value.teamId,
          value.placementId,
          parse(updateTeamEditorialPlacementSchema, req.body),
          principal(req),
          requestId(req),
        ),
      });
    },
    removeEditorial: async (req, res) => {
      const value = placementParams(req);
      await service.removeEditorial(
        value.teamId,
        value.placementId,
        principal(req),
        requestId(req),
      );
      res.status(204).send();
    },
    reorderEditorial: async (req, res) =>
      res.status(200).json({
        data: await service.reorderEditorial(
          params(req).teamId,
          parse(reorderTeamHomepagePlacementsSchema, req.body),
          principal(req),
          requestId(req),
        ),
      }),
    listHighlights: async (req, res) =>
      res.status(200).json({ data: await service.listHighlights(params(req).teamId) }),
    listHighlightCandidates: async (req, res) =>
      res.status(200).json({
        data: await service.listHighlightCandidates(
          params(req).teamId,
          parse(teamHomepageCandidatesQuerySchema, req.query),
        ),
      }),
    addHighlight: async (req, res) =>
      res.status(201).json({
        data: await service.addHighlight(
          params(req).teamId,
          parse(addTeamHighlightPlacementSchema, req.body),
          principal(req),
          requestId(req),
        ),
      }),
    removeHighlight: async (req, res) => {
      const value = placementParams(req);
      await service.removeHighlight(
        value.teamId,
        value.placementId,
        principal(req),
        requestId(req),
      );
      res.status(204).send();
    },
    reorderHighlights: async (req, res) =>
      res.status(200).json({
        data: await service.reorderHighlights(
          params(req).teamId,
          parse(reorderTeamHomepagePlacementsSchema, req.body),
          principal(req),
          requestId(req),
        ),
      }),
    updateHighlightSettings: async (req, res) =>
      res.status(200).json({
        data: await service.updateHighlightSettings(
          params(req).teamId,
          parse(updateTeamHighlightSettingsSchema, req.body),
          principal(req),
          requestId(req),
        ),
      }),
  };
}

function params(request: Request): { teamId: string } {
  return parse(teamHomepageParamsSchema, request.params);
}
function placementParams(request: Request): { teamId: string; placementId: string } {
  return parse(teamHomepagePlacementParamsSchema, request.params);
}
function principal(request: Request): AdministrativePrincipal {
  if (request.admin === undefined)
    throw new AppError({
      code: 'UNAUTHORIZED',
      message: 'A valid access token is required.',
      statusCode: 401,
    });
  return request.admin;
}
function requestId(request: Request): string | null {
  const value = request.headers['x-request-id'];
  return typeof value === 'string' ? value : null;
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
): T {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  throw new AppError({
    code: 'VALIDATION_ERROR',
    message: 'The Team Homepage request is invalid.',
    statusCode: 400,
    details: result.error.issues.map((issue) => ({
      field: issue.path.join('.'),
      message: issue.message,
    })),
  });
}
