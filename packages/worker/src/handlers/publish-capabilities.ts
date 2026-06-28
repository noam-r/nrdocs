/**
 * Publish capabilities for GitHub Actions (OIDC).
 */

import type { Env } from '../index.js';
import { jsonSuccess, jsonError } from '../responses.js';
import { verifyGithubOidc } from '../oidc.js';
import { matchRules } from '../db/index.js';

export async function handlePublishCapabilities(
  request: Request,
  env: Env,
  _params: Record<string, string>,
): Promise<Response> {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader) {
    return jsonError('UNAUTHORIZED', 'Missing Authorization header', 401);
  }

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return jsonError('UNAUTHORIZED', 'Invalid Authorization header format', 401);
  }

  const oidcResult = await verifyGithubOidc(parts[1]!, 'nrdocs');
  if (!oidcResult.ok) {
    return jsonError('OIDC_VERIFICATION_FAILED', oidcResult.error, 401);
  }

  const fullName = oidcResult.claims.repository.toLowerCase();
  const matchedRule = await matchRules(env.DB, fullName);

  return jsonSuccess({
    full_name: fullName,
    allow_unlisted_assets: matchedRule?.allow_unlisted_assets ?? false,
    rule_matched: matchedRule !== null,
    rule_id: matchedRule?.id ?? null,
  });
}
