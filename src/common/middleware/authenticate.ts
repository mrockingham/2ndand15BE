import type { RequestHandler } from 'express';

import type { AccessTokenService } from '../security/access-token.js';
import { unauthorizedError } from '../../modules/auth/auth.service.js';

export function createAuthenticationMiddleware(accessTokens: AccessTokenService): RequestHandler {
  return async (request, response, next) => {
    const authorization = request.headers.authorization;
    const match = authorization?.match(/^Bearer ([^\s]+)$/i);

    if (match?.[1] === undefined) {
      response.setHeader('www-authenticate', 'Bearer');
      next(unauthorizedError());
      return;
    }

    try {
      request.auth = await accessTokens.verify(match[1]);
      next();
    } catch {
      response.setHeader('www-authenticate', 'Bearer');
      next(unauthorizedError());
    }
  };
}
