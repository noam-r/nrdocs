/**
 * Operator identity endpoint handler.
 */

import { NRDOCS_VERSION } from '@nrdocs/shared';
import type { Env } from '../index.js';
import { jsonSuccess } from '../responses.js';
import { requireOperator } from '../auth.js';

export async function handleOperatorMe(
  request: Request,
  env: Env,
  _params: Record<string, string>,
): Promise<Response> {
  const auth = requireOperator(request, env);
  if (!auth.authenticated) return auth.response;

  return jsonSuccess({
    operator: {
      type: 'operator_token',
    },
    deployment: {
      base_url: env.BASE_URL,
      version: NRDOCS_VERSION,
    },
  });
}
