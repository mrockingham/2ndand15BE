import type { Request, RequestHandler } from 'express';

import { AppError } from '../../common/errors/app-error.js';
import type { AdministrativePrincipal } from '../admin/admin-authorization.js';
import {
  adminContactMessageListQuerySchema,
  contactMessageIdParamsSchema,
  submitContactMessageSchema,
  updateContactMessageStatusSchema,
} from './contact.schemas.js';
import type { ContactServiceContract } from './contact.service.js';

export interface ContactController {
  readonly submit: RequestHandler;
  readonly list: RequestHandler;
  readonly get: RequestHandler;
  readonly updateStatus: RequestHandler;
}

const GENERIC_ACCEPTED_MESSAGE = "Thanks -- we've received your message and will follow up soon.";

export function createContactController(service: ContactServiceContract): ContactController {
  return {
    submit: async (request, response) => {
      const input = parseOrThrow(submitContactMessageSchema, request.body, 'request body');
      await service.submit(input);
      response.status(202).json({ data: { message: GENERIC_ACCEPTED_MESSAGE } });
    },
    list: async (request, response) => {
      const query = parseOrThrow(
        adminContactMessageListQuerySchema,
        request.query,
        'query parameters',
      );
      response.status(200).json({ data: await service.list(query) });
    },
    get: async (request, response) => {
      const { contactMessageId } = parseOrThrow(
        contactMessageIdParamsSchema,
        request.params,
        'path parameters',
      );
      response.status(200).json({ data: await service.get(contactMessageId) });
    },
    updateStatus: async (request, response) => {
      const { contactMessageId } = parseOrThrow(
        contactMessageIdParamsSchema,
        request.params,
        'path parameters',
      );
      const input = parseOrThrow(updateContactMessageStatusSchema, request.body, 'request body');
      response.status(200).json({
        data: await service.updateStatus(
          contactMessageId,
          input,
          requirePrincipal(request.admin),
          requestId(request),
        ),
      });
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
