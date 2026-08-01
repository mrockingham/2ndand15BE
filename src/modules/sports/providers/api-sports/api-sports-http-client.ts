import { randomUUID } from 'node:crypto';

import type { Logger } from 'pino';

import { ApiSportsError } from './api-sports-error.js';

export type ApiSportsFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

export interface ApiSportsHttpClientOptions {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly requestTimeoutMs: number;
  readonly maxRetries: number;
  readonly fetchImplementation?: ApiSportsFetch;
  readonly sleep?: (milliseconds: number) => Promise<void>;
  readonly random?: () => number;
  readonly logger?: Pick<Logger, 'warn'>;
}

export class ApiSportsHttpClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly requestTimeoutMs: number;
  private readonly maxRetries: number;
  private readonly fetchImplementation: ApiSportsFetch;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly random: () => number;
  private readonly logger: Pick<Logger, 'warn'> | undefined;

  constructor(options: ApiSportsHttpClientOptions) {
    this.baseUrl = options.baseUrl;
    this.apiKey = options.apiKey;
    this.requestTimeoutMs = options.requestTimeoutMs;
    this.maxRetries = options.maxRetries;
    this.fetchImplementation = options.fetchImplementation ?? fetch;
    this.sleep =
      options.sleep ??
      ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.random = options.random ?? Math.random;
    this.logger = options.logger;
  }

  async get(
    path: string,
    parameters: Readonly<Record<string, string | number | undefined>>,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const url = new URL(path, ensureTrailingSlash(this.baseUrl));
    for (const [name, value] of Object.entries(parameters)) {
      if (value !== undefined) url.searchParams.set(name, String(value));
    }

    const requestId = randomUUID();
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      try {
        return await this.requestOnce(url, requestId, signal);
      } catch (error: unknown) {
        const providerError = toApiSportsError(error, requestId, signal);
        if (!providerError.retryable || attempt >= this.maxRetries) {
          if (providerError.code === 'RATE_LIMITED') {
            throw new ApiSportsError({
              code: 'QUOTA_EXHAUSTED',
              message: 'API-Sports rate-limit retries were exhausted.',
              ...(providerError.statusCode === null
                ? {}
                : { statusCode: providerError.statusCode }),
              requestId,
              cause: providerError,
            });
          }
          throw providerError;
        }

        const retryAfterMs = retryDelayMilliseconds(providerError, attempt, this.random);
        this.logger?.warn(
          {
            provider: 'api-sports',
            requestId,
            path,
            attempt: attempt + 1,
            retryAfterMs,
            errorCode: providerError.code,
            statusCode: providerError.statusCode,
          },
          'Retrying API-Sports request after a transient failure',
        );
        await this.sleep(retryAfterMs);
      }
    }

    throw new ApiSportsError({
      code: 'HTTP_ERROR',
      message: 'API-Sports request attempts were exhausted.',
      requestId,
    });
  }

  private async requestOnce(
    url: URL,
    requestId: string,
    externalSignal: AbortSignal | undefined,
  ): Promise<unknown> {
    const timeoutController = new AbortController();
    const timeout = setTimeout(() => {
      timeoutController.abort();
    }, this.requestTimeoutMs);
    const signal =
      externalSignal === undefined
        ? timeoutController.signal
        : AbortSignal.any([externalSignal, timeoutController.signal]);

    try {
      const response = await this.fetchImplementation(url, {
        method: 'GET',
        headers: {
          accept: 'application/json',
          'x-apisports-key': this.apiKey,
          'x-request-id': requestId,
        },
        signal,
      });

      if (response.status === 429) {
        const retryAfterMs = parseRetryAfterMilliseconds(response.headers.get('retry-after'));
        throw new ApiSportsError({
          code: 'RATE_LIMITED',
          message: 'API-Sports rate limit was reached.',
          statusCode: 429,
          requestId,
          retryable: true,
          cause: retryAfterMs,
        });
      }

      if (!response.ok) {
        throw new ApiSportsError({
          code: 'HTTP_ERROR',
          message: `API-Sports returned HTTP ${String(response.status)}.`,
          statusCode: response.status,
          requestId,
          retryable: response.status >= 500,
        });
      }

      try {
        return await response.json();
      } catch (error: unknown) {
        throw new ApiSportsError({
          code: 'INVALID_RESPONSE',
          message: 'API-Sports returned invalid JSON.',
          statusCode: response.status,
          requestId,
          cause: error,
        });
      }
    } catch (error: unknown) {
      if (timeoutController.signal.aborted && !externalSignal?.aborted) {
        throw new ApiSportsError({
          code: 'REQUEST_TIMEOUT',
          message: `API-Sports request timed out after ${String(this.requestTimeoutMs)}ms.`,
          requestId,
          retryable: true,
          cause: error,
        });
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith('/') ? value : `${value}/`;
}

function toApiSportsError(
  error: unknown,
  requestId: string,
  externalSignal: AbortSignal | undefined,
): ApiSportsError {
  if (error instanceof ApiSportsError) return error;
  if (externalSignal?.aborted) {
    return new ApiSportsError({
      code: 'REQUEST_ABORTED',
      message: 'API-Sports request was aborted.',
      requestId,
      cause: error,
    });
  }
  return new ApiSportsError({
    code: 'NETWORK_ERROR',
    message: 'API-Sports request failed because of a network error.',
    requestId,
    retryable: true,
    cause: error,
  });
}

function retryDelayMilliseconds(
  error: ApiSportsError,
  attempt: number,
  random: () => number,
): number {
  if (error.code === 'RATE_LIMITED' && typeof error.cause === 'number') return error.cause;
  return Math.min(2_000, 100 * 2 ** attempt) + Math.floor(random() * 100);
}

function parseRetryAfterMilliseconds(value: string | null): number {
  if (value === null) return 1_000;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(30_000, seconds * 1_000);
  const date = Date.parse(value);
  return Number.isNaN(date) ? 1_000 : Math.min(30_000, Math.max(0, date - Date.now()));
}
