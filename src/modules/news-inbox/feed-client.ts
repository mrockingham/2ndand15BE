import { promises as dns } from 'node:dns';
import type { ReadableStreamDefaultReader, ReadableStreamReadResult } from 'node:stream/web';

import { AppError } from '../../common/errors/app-error.js';
import { isPublicIpAddress, parseFeedUrl } from './news-url.js';

export const DEFAULT_FEED_LIMITS = {
  maximumBytes: 512 * 1024,
  maximumRedirects: 3,
  timeoutMs: 10_000,
} as const;

export interface FeedLimits {
  readonly maximumBytes: number;
  readonly maximumRedirects: number;
  readonly timeoutMs: number;
}

export interface FeedFetchResult {
  readonly notModified: boolean;
  readonly body: string | null;
  readonly bytes: number;
  readonly etag: string | null;
  readonly modified: string | null;
  readonly finalUrl: string;
  readonly contentType: string | null;
}

export interface FeedFetchOptions {
  readonly etag?: string | null;
  readonly modified?: string | null;
}

export type HostResolver = (hostname: string) => Promise<readonly string[]>;
export type FeedFetch = (url: string, init: RequestInit) => Promise<Response>;

export interface FeedClient {
  validateUrl(value: string): Promise<void>;
  fetch(value: string, options?: FeedFetchOptions): Promise<FeedFetchResult>;
}

export class SafeFeedClient implements FeedClient {
  constructor(
    private readonly fetchImplementation: FeedFetch = globalThis.fetch,
    private readonly resolveHost: HostResolver = defaultResolver,
    private readonly limits: FeedLimits = DEFAULT_FEED_LIMITS,
  ) {}

  async validateUrl(value: string): Promise<void> {
    await this.validateDestination(parseFeedUrl(value));
  }

  async fetch(value: string, options: FeedFetchOptions = {}): Promise<FeedFetchResult> {
    let current = parseFeedUrl(value);
    for (let redirects = 0; redirects <= this.limits.maximumRedirects; redirects += 1) {
      await this.validateDestination(current);
      const response = await this.request(current, options);
      if (isRedirect(response.status)) {
        if (redirects === this.limits.maximumRedirects)
          throw clientError('NEWS_FEED_REDIRECT_LIMIT', 'The feed exceeded the redirect limit.');
        const location = response.headers.get('location');
        if (location === null)
          throw clientError(
            'NEWS_FEED_REDIRECT_INVALID',
            'The feed returned a redirect without a location.',
          );
        current = parseFeedUrl(new URL(location, current).toString());
        continue;
      }
      const etag = boundedHeader(response.headers.get('etag'), 512);
      const modified = boundedHeader(response.headers.get('last-modified'), 256);
      if (response.status === 304) {
        return {
          notModified: true,
          body: null,
          bytes: 0,
          etag,
          modified,
          finalUrl: current.toString(),
          contentType: response.headers.get('content-type'),
        };
      }
      if (!response.ok)
        throw clientError(
          'NEWS_FEED_HTTP_ERROR',
          `The feed returned HTTP ${String(response.status)}.`,
        );
      const declaredLength = Number(response.headers.get('content-length'));
      if (Number.isFinite(declaredLength) && declaredLength > this.limits.maximumBytes) {
        throw clientError(
          'NEWS_FEED_RESPONSE_TOO_LARGE',
          'The feed response exceeds the byte limit.',
        );
      }
      const { body, bytes } = await readBoundedBody(response, this.limits.maximumBytes);
      const contentType = response.headers.get('content-type');
      assertXmlContent(contentType, body);
      return {
        notModified: false,
        body,
        bytes,
        etag,
        modified,
        finalUrl: current.toString(),
        contentType,
      };
    }
    throw clientError('NEWS_FEED_REDIRECT_LIMIT', 'The feed exceeded the redirect limit.');
  }

  private async request(url: URL, options: FeedFetchOptions): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
    }, this.limits.timeoutMs);
    try {
      return await this.fetchImplementation(url.toString(), {
        method: 'GET',
        redirect: 'manual',
        credentials: 'omit',
        signal: controller.signal,
        headers: {
          accept: 'application/atom+xml, application/rss+xml, application/xml, text/xml;q=0.9',
          'user-agent': '2ndand15-news-inbox/1.0 (+controlled-feed-reader)',
          ...(options.etag === undefined || options.etag === null
            ? {}
            : { 'if-none-match': options.etag }),
          ...(options.modified === undefined || options.modified === null
            ? {}
            : { 'if-modified-since': options.modified }),
        },
      });
    } catch (error) {
      if (controller.signal.aborted)
        throw clientError('NEWS_FEED_TIMEOUT', 'The feed request timed out.');
      throw clientError(
        'NEWS_FEED_NETWORK_ERROR',
        error instanceof Error ? error.message.slice(0, 300) : 'The feed request failed.',
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  private async validateDestination(url: URL): Promise<void> {
    const addresses = await this.resolveHost(url.hostname);
    if (addresses.length === 0 || addresses.some((address) => !isPublicIpAddress(address))) {
      throw clientError(
        'NEWS_URL_PRIVATE_DESTINATION',
        'The feed destination resolves to a non-public network address.',
        400,
      );
    }
  }
}

async function defaultResolver(hostname: string): Promise<readonly string[]> {
  try {
    return (await dns.lookup(hostname, { all: true, verbatim: true })).map(
      ({ address }) => address,
    );
  } catch {
    throw clientError('NEWS_FEED_DNS_ERROR', 'The feed hostname could not be resolved.', 400);
  }
}

async function readBoundedBody(
  response: Response,
  maximumBytes: number,
): Promise<{ body: string; bytes: number }> {
  if (response.body === null) return { body: '', bytes: 0 };
  const reader = response.body.getReader() as ReadableStreamDefaultReader<Uint8Array>;
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  let finished = false;
  while (!finished) {
    const result: ReadableStreamReadResult<Uint8Array> = await reader.read();
    if (result.done) {
      finished = true;
      continue;
    }
    bytes += result.value.byteLength;
    if (bytes > maximumBytes) {
      await reader.cancel();
      throw clientError(
        'NEWS_FEED_RESPONSE_TOO_LARGE',
        'The feed response exceeds the byte limit.',
      );
    }
    chunks.push(result.value);
  }
  const merged = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return { body: new TextDecoder('utf-8', { fatal: true }).decode(merged), bytes };
  } catch {
    throw clientError('NEWS_FEED_TEXT_INVALID', 'The feed is not valid UTF-8.');
  }
}

function assertXmlContent(contentType: string | null, body: string): void {
  const mime = contentType?.split(';', 1)[0]?.trim().toLowerCase();
  const expected =
    mime === undefined ||
    mime === '' ||
    [
      'application/atom+xml',
      'application/rss+xml',
      'application/xml',
      'text/xml',
      'application/octet-stream',
    ].includes(mime);
  const looksXml = /^\s*(?:<\?xml\b[^>]*>\s*)?<(?:rss\b|feed\b)/i.test(body);
  if (!expected || !looksXml)
    throw clientError(
      'NEWS_FEED_CONTENT_TYPE_INVALID',
      'The response is not a supported RSS or Atom XML feed.',
    );
}

function isRedirect(status: number): boolean {
  return [301, 302, 303, 307, 308].includes(status);
}

function boundedHeader(value: string | null, maximum: number): string | null {
  return value === null ? null : value.slice(0, maximum);
}

function clientError(code: string, message: string, statusCode = 422): AppError {
  return new AppError({
    code,
    message: message.replace(/[\r\n]+/g, ' ').slice(0, 500),
    statusCode,
  });
}
