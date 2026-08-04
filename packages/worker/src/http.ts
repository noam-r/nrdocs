import {
  formatId,
  parseRequestId,
  PUBLISHER_API_ERROR_HTTP,
  PublisherApiErrorCode,
  type PublisherApiErrorCode as ApiErrorCode,
  type RequestId,
} from '@nrdocs/contracts';
import { PUBLISHER_HEADERS } from '@nrdocs/contracts';
import { RATE_LIMITS } from './limits.js';

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly retryAfterSeconds?: number;

  constructor(code: ApiErrorCode, message: string, opts?: { retryAfterSeconds?: number }) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = PUBLISHER_API_ERROR_HTTP[code];
    if (opts?.retryAfterSeconds !== undefined) {
      this.retryAfterSeconds = opts.retryAfterSeconds;
    }
  }
}

export function newRequestId(incoming: string | null): RequestId {
  if (incoming) {
    const parsed = parseRequestId(incoming.trim());
    if (parsed) return parsed;
  }
  return formatId('req', globalThis.crypto.getRandomValues(new Uint8Array(16))) as RequestId;
}

export function requestIdFromHeaders(headers: Headers): RequestId {
  return newRequestId(headers.get(PUBLISHER_HEADERS.requestId));
}

const SAFE_HEADERS: Record<string, string> = {
  'cache-control': 'no-store',
  'content-type': 'application/json; charset=utf-8',
  'x-content-type-options': 'nosniff',
};

export function successResponse(
  requestId: RequestId,
  data: unknown,
  init?: { status?: number },
): Response {
  const body = JSON.stringify({ ok: true, data, request_id: requestId });
  return new Response(body, {
    status: init?.status ?? 200,
    headers: {
      ...SAFE_HEADERS,
      [PUBLISHER_HEADERS.requestId]: requestId,
    },
  });
}

export function errorResponse(requestId: RequestId, error: ApiError): Response {
  const body = JSON.stringify({
    ok: false,
    error: { code: error.code, message: error.message },
    request_id: requestId,
  });
  const headers: Record<string, string> = {
    ...SAFE_HEADERS,
    [PUBLISHER_HEADERS.requestId]: requestId,
  };
  if (error.retryAfterSeconds !== undefined) {
    headers['retry-after'] = String(error.retryAfterSeconds);
  } else if (error.code === PublisherApiErrorCode.RateLimited) {
    headers['retry-after'] = String(RATE_LIMITS.retryAfterSeconds);
  } else if (error.code === PublisherApiErrorCode.PublishInProgress && error.retryAfterSeconds) {
    headers['retry-after'] = String(error.retryAfterSeconds);
  }
  return new Response(body, { status: error.status, headers });
}

export function versionResponse(packageVersion: string): Response {
  return new Response(
    JSON.stringify({
      product: 'nrdocs',
      package_version: packageVersion,
      api_versions: [1],
      artifact_schema_versions: [1],
    }),
    {
      status: 200,
      headers: {
        ...SAFE_HEADERS,
      },
    },
  );
}

export function textResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: {
      'cache-control': 'no-store',
      'content-type': 'text/plain; charset=utf-8',
      'x-content-type-options': 'nosniff',
    },
  });
}
