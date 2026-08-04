/** Safe parsers for Cloudflare control-plane JSON responses. */

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export type CfApiEnvelope<T> = {
  success: boolean;
  errors: Array<{ code?: number; message: string }>;
  result: T;
};

export function parseCfEnvelope<T>(
  raw: unknown,
  mapResult: (result: unknown) => T,
): CfApiEnvelope<T> {
  if (!isObject(raw)) throw new Error('malformed Cloudflare response');
  if (typeof raw.success !== 'boolean') throw new Error('malformed Cloudflare response');
  const errorsRaw = Array.isArray(raw.errors) ? raw.errors : [];
  const errors = errorsRaw.map((e) => {
    if (!isObject(e) || typeof e.message !== 'string') {
      return { message: 'unknown Cloudflare error' };
    }
    return {
      message: e.message,
      ...(typeof e.code === 'number' ? { code: e.code } : {}),
    };
  });
  return {
    success: raw.success,
    errors,
    result: mapResult(raw.result),
  };
}

export type CfAccount = { id: string; name: string };

export function parseAccountsResult(result: unknown): CfAccount[] {
  if (!Array.isArray(result)) throw new Error('malformed accounts result');
  return result.map((row) => {
    if (!isObject(row) || typeof row.id !== 'string' || typeof row.name !== 'string') {
      throw new Error('malformed account row');
    }
    return { id: row.id, name: row.name };
  });
}

export type CfD1Database = { uuid: string; name: string };

export function parseD1ListResult(result: unknown): CfD1Database[] {
  if (!Array.isArray(result)) throw new Error('malformed D1 list result');
  return result.map((row) => {
    if (!isObject(row) || typeof row.uuid !== 'string' || typeof row.name !== 'string') {
      throw new Error('malformed D1 row');
    }
    return { uuid: row.uuid, name: row.name };
  });
}

export function parseD1CreateResult(result: unknown): CfD1Database {
  if (!isObject(result) || typeof result.uuid !== 'string' || typeof result.name !== 'string') {
    throw new Error('malformed D1 create result');
  }
  return { uuid: result.uuid, name: result.name };
}

export type CfR2Bucket = { name: string };

export function parseR2ListResult(result: unknown): CfR2Bucket[] {
  const buckets = isObject(result) && Array.isArray(result.buckets) ? result.buckets : result;
  if (!Array.isArray(buckets)) throw new Error('malformed R2 list result');
  return buckets.map((row) => {
    if (!isObject(row) || typeof row.name !== 'string') throw new Error('malformed R2 row');
    return { name: row.name };
  });
}

export type CfZone = { id: string; name: string; status: string };

export function parseZonesResult(result: unknown): CfZone[] {
  if (!Array.isArray(result)) throw new Error('malformed zones result');
  return result.map((row) => {
    if (
      !isObject(row) ||
      typeof row.id !== 'string' ||
      typeof row.name !== 'string' ||
      typeof row.status !== 'string'
    ) {
      throw new Error('malformed zone row');
    }
    return { id: row.id, name: row.name, status: row.status };
  });
}

export function classifyCfError(status: number, envelope: CfApiEnvelope<unknown>): string {
  if (status === 429 || envelope.errors.some((e) => e.code === 10000 || /rate/i.test(e.message))) {
    return 'rate_limited';
  }
  if (status === 403 || status === 401) return 'permission_denied';
  if (status === 409 || envelope.errors.some((e) => /already exists/i.test(e.message))) {
    return 'already_exists';
  }
  if (!envelope.success) return 'api_error';
  return 'ok';
}
