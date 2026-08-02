import type { Prisma } from '../../generated/prisma/client.js';

type SafeJsonValue = string | number | boolean | null | SafeJsonValue[] | SafeJsonObject;
interface SafeJsonObject {
  // Recursive JSON types cannot be expressed with Record without a circular type alias.
  [key: string]: SafeJsonValue;
}
const sensitiveKey = /password|token|authorization|cookie|secret|api.?key/i;

export function sanitizeAuditSnapshot(value: unknown): Prisma.InputJsonObject {
  const sanitized = sanitize(value);
  return isObject(sanitized) ? sanitized : { value: sanitized };
}

function sanitize(value: unknown): SafeJsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value);
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(sanitize);
  if (typeof value !== 'object') return `[${typeof value}]`;
  const result: SafeJsonObject = {};
  for (const [key, child] of Object.entries(value)) {
    result[key] = sensitiveKey.test(key) ? '[REDACTED]' : sanitize(child);
  }
  return result;
}

function isObject(value: SafeJsonValue): value is SafeJsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
