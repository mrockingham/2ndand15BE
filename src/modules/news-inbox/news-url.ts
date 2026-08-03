import { createHash } from 'node:crypto';
import { isIP } from 'node:net';

import { AppError } from '../../common/errors/app-error.js';

export const REMOVED_TRACKING_PARAMETERS = [
  'fbclid',
  'gclid',
  'mc_cid',
  'mc_eid',
  'utm_*',
] as const;

export interface NormalizedNewsUrl {
  readonly url: string;
  readonly hash: string;
}

export function normalizeNewsUrl(value: string): NormalizedNewsUrl {
  const parsed = parseHttpUrl(value, 'NEWS_CANDIDATE_URL_INVALID');
  assertNoObviouslyPrivateHost(parsed);
  parsed.hash = '';
  for (const key of [...parsed.searchParams.keys()]) {
    const normalized = key.toLowerCase();
    if (
      normalized.startsWith('utm_') ||
      ['fbclid', 'gclid', 'mc_cid', 'mc_eid'].includes(normalized)
    ) {
      parsed.searchParams.delete(key);
    }
  }
  const url = parsed.toString();
  return { url, hash: createHash('sha256').update(url).digest('hex') };
}

export function parseFeedUrl(value: string): URL {
  const parsed = parseHttpUrl(value, 'NEWS_SOURCE_URL_INVALID');
  assertNoObviouslyPrivateHost(parsed);
  return parsed;
}

function parseHttpUrl(value: string, code: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw invalidUrl(code);
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw invalidUrl(code);
  }
  return parsed;
}

function assertNoObviouslyPrivateHost(url: URL): void {
  const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname === 'metadata.google.internal'
  ) {
    throw privateDestination();
  }
  if (isIP(hostname) !== 0 && !isPublicIpAddress(hostname)) throw privateDestination();
}

export function isPublicIpAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return isPublicIpv4(address);
  if (family !== 6) return false;

  const normalized = address.toLowerCase().split('%')[0] ?? '';
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(normalized)?.[1];
  if (mapped !== undefined) return isPublicIpv4(mapped);
  const hexadecimalMapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(normalized);
  if (hexadecimalMapped !== null) {
    const high = Number.parseInt(hexadecimalMapped[1] ?? '', 16);
    const low = Number.parseInt(hexadecimalMapped[2] ?? '', 16);
    return isPublicIpv4(
      `${String(high >> 8)}.${String(high & 0xff)}.${String(low >> 8)}.${String(low & 0xff)}`,
    );
  }
  if (
    normalized === '::' ||
    normalized === '::1' ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    /^fe[89ab]/.test(normalized) ||
    normalized.startsWith('ff') ||
    normalized.startsWith('2001:db8:')
  ) {
    return false;
  }
  return true;
}

function isPublicIpv4(address: string): boolean {
  const parts = address.split('.').map(Number);
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return false;
  }
  const [a = -1, b = -1, c = -1] = parts;
  if (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113)
  ) {
    return false;
  }
  return true;
}

function invalidUrl(code: string): AppError {
  return new AppError({
    code,
    message: 'A public HTTP or HTTPS URL without credentials is required.',
    statusCode: 400,
  });
}

function privateDestination(): AppError {
  return new AppError({
    code: 'NEWS_URL_PRIVATE_DESTINATION',
    message: 'Local, private-network, link-local, and metadata destinations are not allowed.',
    statusCode: 400,
  });
}
