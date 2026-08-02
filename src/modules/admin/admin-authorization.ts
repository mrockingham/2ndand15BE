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
  | 'MANAGE_ROLES';

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
