/**
 * Health/status endpoint handler.
 */

import { NRDOCS_VERSION } from '@nrdocs/shared';
import type { Env } from '../index.js';
import { jsonSuccess } from '../responses.js';
import { requireOperator } from '../auth.js';

export async function handleStatus(
  request: Request,
  env: Env,
  _params: Record<string, string>,
): Promise<Response> {
  // Basic info is always available (no auth required)
  const basicInfo = {
    service: 'nrdocs',
    version: NRDOCS_VERSION,
    base_url: env.BASE_URL,
  };

  // If operator auth is provided, include extended info
  const auth = requireOperator(request, env);
  if (auth.authenticated) {
    return jsonSuccess({
      ...basicInfo,
      authenticated: true,
    });
  }

  return jsonSuccess(basicInfo);
}
