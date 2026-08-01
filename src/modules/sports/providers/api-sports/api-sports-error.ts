export type ApiSportsErrorCode =
  | 'REQUEST_ABORTED'
  | 'REQUEST_TIMEOUT'
  | 'NETWORK_ERROR'
  | 'HTTP_ERROR'
  | 'RATE_LIMITED'
  | 'QUOTA_EXHAUSTED'
  | 'PROVIDER_RESPONSE_ERROR'
  | 'INVALID_RESPONSE';

export class ApiSportsError extends Error {
  readonly code: ApiSportsErrorCode;
  readonly statusCode: number | null;
  readonly requestId: string | null;
  readonly retryable: boolean;

  constructor(options: {
    readonly code: ApiSportsErrorCode;
    readonly message: string;
    readonly statusCode?: number;
    readonly requestId?: string;
    readonly retryable?: boolean;
    readonly cause?: unknown;
  }) {
    super(options.message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'ApiSportsError';
    this.code = options.code;
    this.statusCode = options.statusCode ?? null;
    this.requestId = options.requestId ?? null;
    this.retryable = options.retryable ?? false;
  }
}
