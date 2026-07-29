import type { ErrorRequestHandler } from 'express';

import { AppError } from '../errors/app-error.js';
import { serializeRequestId } from '../utils/request-id.js';

interface ErrorResponse {
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly details?: unknown;
    readonly requestId: string;
  };
}

function isInvalidJsonError(error: unknown): boolean {
  if (!(error instanceof SyntaxError)) {
    return false;
  }

  return 'status' in error && error.status === 400;
}

export const errorHandler: ErrorRequestHandler = (error: unknown, request, response, next) => {
  if (response.headersSent) {
    next(error);
    return;
  }

  const appError =
    error instanceof AppError
      ? error
      : isInvalidJsonError(error)
        ? new AppError({
            code: 'INVALID_JSON',
            message: 'The request body contains invalid JSON.',
            statusCode: 400,
            cause: error,
          })
        : new AppError({
            code: 'INTERNAL_SERVER_ERROR',
            message: 'An unexpected error occurred.',
            statusCode: 500,
            cause: error,
          });

  if (appError.statusCode >= 500) {
    request.log.error({ err: error }, 'Request failed unexpectedly');
  }

  const body: ErrorResponse = {
    error: {
      code: appError.code,
      message: appError.message,
      ...(appError.details === undefined ? {} : { details: appError.details }),
      requestId: serializeRequestId(request.id),
    },
  };

  response.status(appError.statusCode).json(body);
};
