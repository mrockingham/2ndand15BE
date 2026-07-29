import { randomUUID } from 'node:crypto';

import { pinoHttp, type HttpLogger } from 'pino-http';
import type { Logger } from 'pino';

const safeRequestId = /^[A-Za-z0-9._:-]{1,100}$/;

export function createRequestLogger(logger: Logger): HttpLogger {
  return pinoHttp({
    logger,
    genReqId(request, response) {
      const suppliedId = request.headers['x-request-id'];
      const requestId =
        typeof suppliedId === 'string' && safeRequestId.test(suppliedId)
          ? suppliedId
          : randomUUID();

      response.setHeader('x-request-id', requestId);
      return requestId;
    },
  });
}
