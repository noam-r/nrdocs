/**
 * Static files endpoint handlers (placeholder implementation).
 */

import { ALLOWED_STATIC_KEYS } from '@nrdocs/shared';
import type { Env } from '../index.js';
import { jsonSuccess, jsonError } from '../responses.js';
import { requireOperator } from '../auth.js';

export async function handleListStatic(
  request: Request,
  env: Env,
  _params: Record<string, string>,
): Promise<Response> {
  const auth = requireOperator(request, env);
  if (!auth.authenticated) return auth.response;

  // Return the list of allowed static file keys with their default status
  const files = ALLOWED_STATIC_KEYS.map((key) => ({
    key,
    source: 'bundled_default' as const,
    custom: false,
  }));

  return jsonSuccess({ files });
}

export async function handleSetStatic(
  request: Request,
  env: Env,
  _params: Record<string, string>,
): Promise<Response> {
  const auth = requireOperator(request, env);
  if (!auth.authenticated) return auth.response;

  return jsonError('NOT_IMPLEMENTED', 'Static file upload not yet implemented', 501);
}

export async function handleDeleteStatic(
  request: Request,
  env: Env,
  _params: Record<string, string>,
): Promise<Response> {
  const auth = requireOperator(request, env);
  if (!auth.authenticated) return auth.response;

  return jsonError('NOT_IMPLEMENTED', 'Static file deletion not yet implemented', 501);
}
