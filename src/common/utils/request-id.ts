import type { ReqId } from 'pino-http';

export function serializeRequestId(requestId: ReqId): string {
  if (typeof requestId === 'string') {
    return requestId;
  }

  if (typeof requestId === 'number') {
    return requestId.toString();
  }

  return 'unknown';
}
