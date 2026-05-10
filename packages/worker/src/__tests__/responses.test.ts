import { describe, it, expect } from 'vitest';
import { jsonSuccess, jsonError } from '../responses.js';

describe('jsonSuccess', () => {
  it('returns ok: true with data', async () => {
    const response = jsonSuccess({ foo: 'bar' });
    expect(response.status).toBe(200);
    const body = await response.json() as { ok: boolean; data: { foo: string } };
    expect(body.ok).toBe(true);
    expect(body.data).toEqual({ foo: 'bar' });
  });

  it('supports custom status code', async () => {
    const response = jsonSuccess({ created: true }, 201);
    expect(response.status).toBe(201);
    const body = await response.json() as { ok: boolean; data: { created: boolean } };
    expect(body.ok).toBe(true);
    expect(body.data).toEqual({ created: true });
  });

  it('handles null data', async () => {
    const response = jsonSuccess(null);
    const body = await response.json() as { ok: boolean; data: null };
    expect(body.ok).toBe(true);
    expect(body.data).toBeNull();
  });

  it('handles array data', async () => {
    const response = jsonSuccess([1, 2, 3]);
    const body = await response.json() as { ok: boolean; data: number[] };
    expect(body.ok).toBe(true);
    expect(body.data).toEqual([1, 2, 3]);
  });
});

describe('jsonError', () => {
  it('returns ok: false with error details', async () => {
    const response = jsonError('NOT_FOUND', 'Resource not found', 404);
    expect(response.status).toBe(404);
    const body = await response.json() as { ok: boolean; error: { code: string; message: string } };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('NOT_FOUND');
    expect(body.error.message).toBe('Resource not found');
  });

  it('includes details when provided', async () => {
    const response = jsonError('VALIDATION_ERROR', 'Invalid field', 400, { field: 'name' });
    const body = await response.json() as { ok: boolean; error: { code: string; message: string; details: { field: string } } };
    expect(body.error.details).toEqual({ field: 'name' });
  });

  it('omits details when not provided', async () => {
    const response = jsonError('INTERNAL_ERROR', 'Something broke', 500);
    const body = await response.json() as { ok: boolean; error: { code: string; message: string; details?: unknown } };
    expect(body.error.details).toBeUndefined();
  });

  it('uses correct status codes', async () => {
    expect(jsonError('UNAUTHORIZED', 'No auth', 401).status).toBe(401);
    expect(jsonError('FORBIDDEN', 'No access', 403).status).toBe(403);
    expect(jsonError('CONFLICT', 'State conflict', 409).status).toBe(409);
    expect(jsonError('NOT_IMPLEMENTED', 'Not ready', 501).status).toBe(501);
  });
});
