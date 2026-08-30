import type { RequestHandler } from 'express';

import type { UserRole } from '../../generated/prisma/client.js';
import { AppError } from '../../common/errors/app-error.js';
import { unauthorizedError } from '../auth/auth.service.js';

export type AdministrativeCapability =
  | 'VIEW_SCHEDULE'
  | 'EDIT_SCHEDULE'
  | 'IMPORT_SCHEDULE'
  | 'VERIFY_SCHEDULE'
  | 'VIEW_SCHEDULE_AUDIT'
  | 'REMOVE_OVERRIDE'
  | 'VIEW_FULL_AUDIT'
  | 'MANAGE_ROLES'
  | 'VIEW_EDITORIAL_CONTENT'
  | 'CREATE_ARTICLE'
  | 'EDIT_ARTICLE'
  | 'PUBLISH_ARTICLE'
  | 'FEATURE_ARTICLE'
  | 'ARCHIVE_ARTICLE'
  | 'DELETE_ARTICLE'
  | 'VIEW_EDITORIAL_AUDIT'
  | 'VIEW_NEWS_SOURCES'
  | 'MANAGE_NEWS_SOURCES'
  | 'RUN_NEWS_INGESTION'
  | 'VIEW_NEWS_CANDIDATES'
  | 'REVIEW_NEWS_CANDIDATES'
  | 'CONVERT_NEWS_CANDIDATE'
  | 'MANAGE_PREDICTIONS'
  | 'VIEW_GAME_PLAYS_DIAGNOSTIC'
  | 'REPAIR_GAME_PLAYS'
  | 'VIEW_DATA_HEALTH'
  | 'PROBE_GAME_DATA'
  | 'VIEW_GAME_MEDIA'
  | 'MANAGE_GAME_MEDIA'
  | 'VIEW_HOMEPAGE_CMS'
  | 'MANAGE_HOMEPAGE_CMS'
  | 'VIEW_CONTACT_MESSAGES'
  | 'MANAGE_CONTACT_MESSAGES'
  | 'VIEW_POWER_RANKINGS'
  | 'MANAGE_POWER_RANKINGS';

export interface AdministrativePrincipal {
  readonly userId: string;
  readonly email: string;
  readonly role: UserRole;
}

export interface AdministrativeIdentityReader {
  findAdministrativeIdentity(userId: string): Promise<AdministrativePrincipal | null>;
}

const capabilitiesByRole: Readonly<Record<UserRole, ReadonlySet<AdministrativeCapability>>> = {
  USER: new Set(),
  EDITOR: new Set([
    'VIEW_SCHEDULE',
    'EDIT_SCHEDULE',
    'IMPORT_SCHEDULE',
    'VERIFY_SCHEDULE',
    'VIEW_SCHEDULE_AUDIT',
    'VIEW_EDITORIAL_CONTENT',
    'CREATE_ARTICLE',
    'EDIT_ARTICLE',
    'PUBLISH_ARTICLE',
    'FEATURE_ARTICLE',
    'VIEW_EDITORIAL_AUDIT',
    'VIEW_NEWS_SOURCES',
    'RUN_NEWS_INGESTION',
    'VIEW_NEWS_CANDIDATES',
    'REVIEW_NEWS_CANDIDATES',
    'CONVERT_NEWS_CANDIDATE',
    'MANAGE_PREDICTIONS',
    'VIEW_GAME_PLAYS_DIAGNOSTIC',
    'VIEW_DATA_HEALTH',
    'VIEW_GAME_MEDIA',
    'VIEW_HOMEPAGE_CMS',
    'MANAGE_HOMEPAGE_CMS',
    'VIEW_CONTACT_MESSAGES',
    'VIEW_POWER_RANKINGS',
    'MANAGE_POWER_RANKINGS',
  ]),
  ADMIN: new Set([
    'VIEW_SCHEDULE',
    'EDIT_SCHEDULE',
    'IMPORT_SCHEDULE',
    'VERIFY_SCHEDULE',
    'VIEW_SCHEDULE_AUDIT',
    'REMOVE_OVERRIDE',
    'VIEW_FULL_AUDIT',
    'MANAGE_ROLES',
    'VIEW_EDITORIAL_CONTENT',
    'CREATE_ARTICLE',
    'EDIT_ARTICLE',
    'PUBLISH_ARTICLE',
    'FEATURE_ARTICLE',
    'ARCHIVE_ARTICLE',
    'DELETE_ARTICLE',
    'VIEW_EDITORIAL_AUDIT',
    'VIEW_NEWS_SOURCES',
    'MANAGE_NEWS_SOURCES',
    'RUN_NEWS_INGESTION',
    'VIEW_NEWS_CANDIDATES',
    'REVIEW_NEWS_CANDIDATES',
    'CONVERT_NEWS_CANDIDATE',
    'MANAGE_PREDICTIONS',
    'VIEW_GAME_PLAYS_DIAGNOSTIC',
    'REPAIR_GAME_PLAYS',
    'VIEW_DATA_HEALTH',
    'PROBE_GAME_DATA',
    'VIEW_GAME_MEDIA',
    'MANAGE_GAME_MEDIA',
    'VIEW_HOMEPAGE_CMS',
    'MANAGE_HOMEPAGE_CMS',
    'VIEW_CONTACT_MESSAGES',
    'MANAGE_CONTACT_MESSAGES',
    'VIEW_POWER_RANKINGS',
    'MANAGE_POWER_RANKINGS',
  ]),
};

export function roleHasCapability(role: UserRole, capability: AdministrativeCapability): boolean {
  return capabilitiesByRole[role].has(capability);
}

export function createRequireAdministrativeCapability(
  identities: AdministrativeIdentityReader,
  capability: AdministrativeCapability,
): RequestHandler {
  return async (request, _response, next) => {
    if (request.auth === undefined) {
      next(unauthorizedError());
      return;
    }
    const principal = await identities.findAdministrativeIdentity(request.auth.userId);
    if (principal === null) {
      next(unauthorizedError());
      return;
    }
    if (!roleHasCapability(principal.role, capability)) {
      next(
        new AppError({
          code: 'ADMIN_PERMISSION_REQUIRED',
          message: 'The authenticated account does not have permission for this operation.',
          statusCode: 403,
        }),
      );
      return;
    }
    request.admin = principal;
    next();
  };
}
