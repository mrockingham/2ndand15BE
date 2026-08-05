import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, rename, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const INITIAL_HOST = 'github.com';
const REDIRECT_HOSTS = new Set(['github.com', 'release-assets.githubusercontent.com']);
const RELEASE_PREFIX = '/nflverse/nflverse-data/releases/download/';

export interface HistoricalDownloadOptions {
  readonly url: string;
  readonly destination: string;
  readonly maxBytes?: number;
  readonly timeoutMs?: number;
  readonly fetchImplementation?: typeof fetch;
}

export interface HistoricalDownloadResult {
  readonly destination: string;
  readonly finalUrl: string;
  readonly sha256: string;
  readonly fileSizeBytes: number;
  readonly downloadedAt: string;
}

export async function downloadHistoricalFile(
  options: HistoricalDownloadOptions,
): Promise<HistoricalDownloadResult> {
  const maxBytes = options.maxBytes ?? 250_000_000;
  const timeoutMs = options.timeoutMs ?? 30_000;
  const fetchImplementation = options.fetchImplementation ?? fetch;
  let url = validateInitialUrl(options.url);
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, timeoutMs);
  let response: Response | undefined;
  try {
    for (let redirect = 0; redirect <= 5; redirect += 1) {
      response = await fetchImplementation(url, {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          accept: 'application/octet-stream',
          'user-agent': '2ndand15-historical-import/1.0',
        },
      });
      if (![301, 302, 303, 307, 308].includes(response.status)) break;
      const location = response.headers.get('location');
      if (location === null) throw new Error('Historical download redirect omitted Location.');
      url = validateRedirectUrl(new URL(location, url));
      if (redirect === 5) throw new Error('Historical download exceeded five redirects.');
    }
    if (response === undefined || !response.ok || response.body === null) {
      throw new Error(`Historical download failed with HTTP ${String(response?.status ?? 0)}.`);
    }
    const contentLength = response.headers.get('content-length');
    if (contentLength !== null && Number(contentLength) > maxBytes) {
      throw new Error(`Historical download exceeds ${String(maxBytes)} bytes.`);
    }
    await mkdir(dirname(options.destination), { recursive: true });
    const temporaryPath = `${options.destination}.${randomUUID()}.part`;
    const hash = createHash('sha256');
    let bytes = 0;
    const meter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        bytes += chunk.length;
        if (bytes > maxBytes) {
          callback(new Error(`Historical download exceeds ${String(maxBytes)} bytes.`));
          return;
        }
        hash.update(chunk);
        callback(null, chunk);
      },
    });
    try {
      await pipeline(
        Readable.fromWeb(response.body),
        meter,
        createWriteStream(temporaryPath, { flags: 'wx' }),
      );
      await rename(temporaryPath, options.destination);
    } catch (error) {
      await rm(temporaryPath, { force: true });
      throw error;
    }
    return {
      destination: options.destination,
      finalUrl: url.toString(),
      sha256: hash.digest('hex'),
      fileSizeBytes: bytes,
      downloadedAt: new Date().toISOString(),
    };
  } finally {
    clearTimeout(timeout);
  }
}

export function validateInitialUrl(value: string): URL {
  const url = new URL(value);
  if (
    url.protocol !== 'https:' ||
    url.hostname !== INITIAL_HOST ||
    !url.pathname.startsWith(RELEASE_PREFIX)
  ) {
    throw new Error('Only HTTPS nflverse-data GitHub release URLs are allowed.');
  }
  if (!/\.(?:parquet|csv)$/i.test(url.pathname))
    throw new Error('Only Parquet and CSV source files are allowed.');
  return url;
}

export function validateRedirectUrl(url: URL): URL {
  if (url.protocol !== 'https:' || !REDIRECT_HOSTS.has(url.hostname)) {
    throw new Error('Historical download redirected outside the approved GitHub release hosts.');
  }
  if (url.hostname === INITIAL_HOST && !url.pathname.startsWith(RELEASE_PREFIX)) {
    throw new Error('Historical download redirected outside the nflverse-data release path.');
  }
  return url;
}
