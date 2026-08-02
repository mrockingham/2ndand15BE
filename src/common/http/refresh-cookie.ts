import { parseCookie } from 'cookie';
import type { Request, Response } from 'express';

import type { AppConfig } from '../../config/env.js';

export type RefreshCookieConfig = AppConfig['auth']['cookie'];

export function readRefreshCookie(request: Request, config: RefreshCookieConfig): string | null {
  const cookieHeader = request.headers.cookie;
  if (cookieHeader === undefined) {
    return null;
  }

  return parseCookie(cookieHeader)[config.name] ?? null;
}

export function setRefreshCookie(
  response: Response,
  config: RefreshCookieConfig,
  token: string,
  maxAgeSeconds: number,
): void {
  response.cookie(config.name, token, {
    httpOnly: true,
    secure: config.secure,
    sameSite: config.sameSite,
    path: config.path,
    maxAge: maxAgeSeconds * 1000,
  });
}

export function clearRefreshCookie(response: Response, config: RefreshCookieConfig): void {
  response.clearCookie(config.name, {
    httpOnly: true,
    secure: config.secure,
    sameSite: config.sameSite,
    path: config.path,
  });
}
