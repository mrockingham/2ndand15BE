import type { Request, RequestHandler } from 'express';
import type { z } from 'zod';

import { AppError } from '../../common/errors/app-error.js';
import {
  clearRefreshCookie,
  readRefreshCookie,
  setRefreshCookie,
  type RefreshCookieConfig,
} from '../../common/http/refresh-cookie.js';
import {
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
} from './auth.schemas.js';
import type { AuthenticationResult, AuthenticationService } from './auth.service.js';

export interface AuthController {
  readonly register: RequestHandler;
  readonly login: RequestHandler;
  readonly refresh: RequestHandler;
  readonly logout: RequestHandler;
  readonly forgotPassword: RequestHandler;
  readonly resetPassword: RequestHandler;
}

export interface AuthControllerOptions {
  readonly authService: AuthenticationService;
  readonly cookie: RefreshCookieConfig;
  readonly refreshTokenTtlSeconds: number;
}

const forgotPasswordMessage =
  'If an account exists for that email, password reset instructions have been sent.';

export function createAuthController(options: AuthControllerOptions): AuthController {
  const { authService, cookie, refreshTokenTtlSeconds } = options;

  return {
    register: async (request, response) => {
      const body = parseBody(registerSchema, request.body);
      const result = await authService.register({
        email: body.email,
        password: body.password,
        displayName: body.displayName ?? null,
        metadata: getSessionMetadata(request),
      });
      setRefreshCookie(response, cookie, result.refreshToken, refreshTokenTtlSeconds);
      response.status(201).json({ data: toPublicAuthenticationResult(result) });
    },
    login: async (request, response) => {
      const body = parseBody(loginSchema, request.body);
      const result = await authService.login({
        ...body,
        metadata: getSessionMetadata(request),
      });
      setRefreshCookie(response, cookie, result.refreshToken, refreshTokenTtlSeconds);
      response.status(200).json({ data: toPublicAuthenticationResult(result) });
    },
    refresh: async (request, response) => {
      const result = await authService.refresh(readRefreshCookie(request, cookie));
      setRefreshCookie(response, cookie, result.refreshToken, refreshTokenTtlSeconds);
      response.status(200).json({ data: toPublicAuthenticationResult(result) });
    },
    logout: async (request, response) => {
      await authService.logout(readRefreshCookie(request, cookie));
      clearRefreshCookie(response, cookie);
      response.status(204).send();
    },
    forgotPassword: async (request, response) => {
      const body = parseBody(forgotPasswordSchema, request.body);
      await authService.forgotPassword({
        email: body.email,
        metadata: getSessionMetadata(request),
      });
      response.status(200).json({ data: { message: forgotPasswordMessage } });
    },
    resetPassword: async (request, response) => {
      const body = parseBody(resetPasswordSchema, request.body);
      await authService.resetPassword(body.token, body.password);
      clearRefreshCookie(response, cookie);
      response.status(200).json({
        data: { message: 'Password reset successfully. Please log in again.' },
      });
    },
  };
}

function parseBody<T extends z.ZodType>(schema: T, body: unknown): z.output<T> {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new AppError({
      code: 'VALIDATION_ERROR',
      message: 'The request body is invalid.',
      statusCode: 400,
      details: result.error.issues.map((issue) => ({
        field: issue.path.join('.'),
        message: issue.message,
      })),
    });
  }
  return result.data;
}

function getSessionMetadata(request: Request): {
  readonly userAgent: string | null;
  readonly ipAddress: string | null;
} {
  return {
    userAgent: request.get('user-agent')?.slice(0, 512) ?? null,
    ipAddress: request.ip?.slice(0, 64) ?? null,
  };
}

function toPublicAuthenticationResult(result: AuthenticationResult) {
  return {
    user: result.user,
    accessToken: result.accessToken,
    accessTokenExpiresIn: result.accessTokenExpiresIn,
  };
}
