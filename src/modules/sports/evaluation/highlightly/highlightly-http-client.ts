import { randomUUID } from 'node:crypto';

import type { Logger } from 'pino';
import type { z } from 'zod';

import { highlightlyErrorEnvelopeSchema } from './highlightly-schemas.js';

export type HighlightlyFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

export type HighlightlyErrorCode =
  | 'AUTHENTICATION_FAILED'
  | 'INVALID_REQUEST'
  | 'RATE_LIMITED'
  | 'HTTP_ERROR'
  | 'NETWORK_ERROR'
  | 'REQUEST_ABORTED'
  | 'REQUEST_TIMEOUT'
  | 'INVALID_RESPONSE';

export class HighlightlyEvaluationError extends Error {
  readonly code: HighlightlyErrorCode;
  readonly statusCode: number | null;
  readonly requestId: string | null;
  readonly retryable: boolean;
  private endpointPath: string | null = null;

  constructor(options: {
    readonly code: HighlightlyErrorCode;
    readonly message: string;
    readonly statusCode?: number;
    readonly requestId?: string;
    readonly retryable?: boolean;
  }) {
    super(options.message);
    this.name = 'HighlightlyEvaluationError';
    this.code = options.code;
    this.statusCode = options.statusCode ?? null;
    this.requestId = options.requestId ?? null;
    this.retryable = options.retryable ?? false;
  }

  setEndpointPath(path: string): void {
    this.endpointPath = path.replaceAll(/\/\d+/g, '/{id}');
  }

  getEndpointPath(): string | null {
    return this.endpointPath;
  }
}

const retryAfterByError = new WeakMap<HighlightlyEvaluationError, number>();

export interface HighlightlyRateLimitObservation {
  readonly limit: number | null;
  readonly remaining: number | null;
}

export interface HighlightlyEvaluationHttpClientOptions {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly requestTimeoutMs: number;
  readonly maxRetries: number;
  readonly fetchImplementation?: HighlightlyFetch;
  readonly sleep?: (milliseconds: number) => Promise<void>;
  readonly random?: () => number;
  readonly logger?: Pick<Logger, 'warn'>;
}

export class HighlightlyEvaluationHttpClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly requestTimeoutMs: number;
  private readonly maxRetries: number;
  private readonly fetchImplementation: HighlightlyFetch;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly random: () => number;
  private readonly logger: Pick<Logger, 'warn'> | undefined;
  private requestCount = 0;
  private rateLimit: HighlightlyRateLimitObservation = { limit: null, remaining: null };

  constructor(options: HighlightlyEvaluationHttpClientOptions) {
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

  getRequestCount(): number {
    return this.requestCount;
  }

  getRateLimitObservation(): HighlightlyRateLimitObservation {
    return this.rateLimit;
  }

  async get<T extends z.ZodType>(
    path: string,
    parameters: Readonly<Record<string, string | number | undefined>>,
    schema: T,
    signal?: AbortSignal,
  ): Promise<z.output<T>> {
    const url = new URL(path, ensureTrailingSlash(this.baseUrl));
    for (const [name, value] of Object.entries(parameters)) {
      if (value !== undefined) url.searchParams.set(name, String(value));
    }

    const requestId = randomUUID();
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      try {
        return await this.requestOnce(url, requestId, schema, signal);
      } catch (error: unknown) {
        const providerError = toHighlightlyError(error, requestId, signal);
        providerError.setEndpointPath(path);
        if (!providerError.retryable || attempt >= this.maxRetries) throw providerError;
        const retryAfterMs = retryDelayMilliseconds(providerError, attempt, this.random);
        this.logger?.warn(
          {
            provider: 'highlightly',
            requestId,
            path,
            attempt: attempt + 1,
            retryAfterMs,
            errorCode: providerError.code,
            statusCode: providerError.statusCode,
          },
          'Retrying Highlightly evaluation request after a transient failure',
        );
        await this.sleep(retryAfterMs);
      }
    }

    throw safeError('HTTP_ERROR', 'Highlightly request attempts were exhausted.', requestId);
  }

  private async requestOnce<T extends z.ZodType>(
    url: URL,
    requestId: string,
    schema: T,
    externalSignal: AbortSignal | undefined,
  ): Promise<z.output<T>> {
    const timeoutController = new AbortController();
    const timeout = setTimeout(() => {
      timeoutController.abort();
    }, this.requestTimeoutMs);
    const signal =
      externalSignal === undefined
        ? timeoutController.signal
        : AbortSignal.any([externalSignal, timeoutController.signal]);

    try {
      this.requestCount += 1;
      const response = await this.fetchImplementation(url, {
        method: 'GET',
        headers: { accept: 'application/json', 'x-rapidapi-key': this.apiKey },
        signal,
      });
      this.captureRateLimit(response.headers);

      if (!response.ok) {
        await inspectErrorEnvelope(response);
        throw responseError(response.status, requestId, response.headers.get('retry-after'));
      }

      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        throw safeError(
          'INVALID_RESPONSE',
          'Highlightly returned invalid JSON.',
          requestId,
          response.status,
        );
      }
      const parsed = schema.safeParse(payload);
      if (!parsed.success) {
        throw safeError(
          'INVALID_RESPONSE',
          `Highlightly response validation failed with ${String(parsed.error.issues.length)} issue(s).`,
          requestId,
          response.status,
        );
      }
      return parsed.data;
    } catch (error: unknown) {
      if (timeoutController.signal.aborted && !externalSignal?.aborted) {
        throw safeError(
          'REQUEST_TIMEOUT',
          `Highlightly request timed out after ${String(this.requestTimeoutMs)}ms.`,
          requestId,
          undefined,
          true,
        );
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  private captureRateLimit(headers: Headers): void {
    this.rateLimit = {
      limit: parseNonnegativeInteger(headers.get('x-ratelimit-requests-limit')),
      remaining: parseNonnegativeInteger(headers.get('x-ratelimit-requests-remaining')),
    };
  }
}

async function inspectErrorEnvelope(response: Response): Promise<void> {
  try {
    highlightlyErrorEnvelopeSchema.safeParse(await response.clone().json());
  } catch {
    // The status code remains the only surfaced provider detail.
  }
}

function responseError(
  statusCode: number,
  requestId: string,
  retryAfter: string | null,
): HighlightlyEvaluationError {
  if (statusCode === 401 || statusCode === 403) {
    return safeError(
      'AUTHENTICATION_FAILED',
      'Highlightly rejected the configured credentials.',
      requestId,
      statusCode,
    );
  }
  if (statusCode === 400 || statusCode === 404 || statusCode === 422) {
    return safeError(
      'INVALID_REQUEST',
      'Highlightly rejected the evaluation request.',
      requestId,
      statusCode,
    );
  }
  if (statusCode === 429) {
    const error = safeError(
      'RATE_LIMITED',
      'Highlightly rate limit was reached.',
      requestId,
      statusCode,
      true,
    );
    retryAfterByError.set(error, parseRetryAfterMilliseconds(retryAfter));
    return error;
  }
  return safeError(
    'HTTP_ERROR',
    `Highlightly returned HTTP ${String(statusCode)}.`,
    requestId,
    statusCode,
    statusCode >= 500,
  );
}

function toHighlightlyError(
  error: unknown,
  requestId: string,
  externalSignal: AbortSignal | undefined,
): HighlightlyEvaluationError {
  if (error instanceof HighlightlyEvaluationError) return error;
  if (externalSignal?.aborted) {
    return safeError('REQUEST_ABORTED', 'Highlightly request was aborted.', requestId);
  }
  return safeError(
    'NETWORK_ERROR',
    'Highlightly request failed because of a network error.',
    requestId,
    undefined,
    true,
  );
}

function safeError(
  code: HighlightlyErrorCode,
  message: string,
  requestId: string,
  statusCode?: number,
  retryable = false,
): HighlightlyEvaluationError {
  return new HighlightlyEvaluationError({
    code,
    message,
    requestId,
    retryable,
    ...(statusCode === undefined ? {} : { statusCode }),
  });
}

function retryDelayMilliseconds(
  error: HighlightlyEvaluationError,
  attempt: number,
  random: () => number,
): number {
  const retryAfterMs = retryAfterByError.get(error);
  if (error.code === 'RATE_LIMITED' && retryAfterMs !== undefined) return retryAfterMs;
  return Math.min(2_000, 100 * 2 ** attempt) + Math.floor(random() * 100);
}

function parseRetryAfterMilliseconds(value: string | null): number {
  if (value === null) return 1_000;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(30_000, seconds * 1_000);
  const date = Date.parse(value);
  return Number.isNaN(date) ? 1_000 : Math.min(30_000, Math.max(0, date - Date.now()));
}

function parseNonnegativeInteger(value: string | null): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith('/') ? value : `${value}/`;
}
