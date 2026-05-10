/**
 * Auto-approval rules endpoint handlers.
 */

import type { Env } from '../index.js';
import { jsonSuccess, jsonError } from '../responses.js';
import { requireOperator } from '../auth.js';
import { listRules, createRule, deleteRule, writeAuditEvent } from '../db/index.js';

export async function handleListRules(
  request: Request,
  env: Env,
  _params: Record<string, string>,
): Promise<Response> {
  const auth = requireOperator(request, env);
  if (!auth.authenticated) return auth.response;

  const rules = await listRules(env.DB);
  return jsonSuccess({ rules });
}

export async function handleCreateRule(
  request: Request,
  env: Env,
  _params: Record<string, string>,
): Promise<Response> {
  const auth = requireOperator(request, env);
  if (!auth.authenticated) return auth.response;

  let body: { pattern?: string; access_mode?: string; priority?: number };
  try {
    body = await request.json() as { pattern?: string; access_mode?: string; priority?: number };
  } catch {
    return jsonError('INVALID_BODY', 'Request body must be valid JSON', 400);
  }

  if (!body.pattern || typeof body.pattern !== 'string') {
    return jsonError('VALIDATION_ERROR', 'pattern is required', 400, { field: 'pattern' });
  }

  // Validate pattern format: must be "owner/repo" or "owner/*"
  const patternRegex = /^[a-zA-Z0-9_.-]+\/(\*|[a-zA-Z0-9_.-]+)$/;
  if (!patternRegex.test(body.pattern)) {
    return jsonError(
      'VALIDATION_ERROR',
      'pattern must be in format "owner/repo" or "owner/*"',
      400,
      { field: 'pattern' },
    );
  }

  if (!body.access_mode || !['public', 'password'].includes(body.access_mode)) {
    return jsonError(
      'VALIDATION_ERROR',
      'access_mode must be "public" or "password"',
      400,
      { field: 'access_mode' },
    );
  }

  const accessMode = body.access_mode as 'public' | 'password';
  const priority = typeof body.priority === 'number' ? body.priority : 0;

  const rule = await createRule(env.DB, body.pattern, accessMode, 'operator', priority);

  await writeAuditEvent(env.DB, {
    event_type: 'rule.created',
    actor_type: 'operator',
    rule_id: rule.id,
    metadata: { pattern: body.pattern, access_mode: accessMode, priority },
  });

  return jsonSuccess({ rule }, 201);
}

export async function handleDeleteRule(
  request: Request,
  env: Env,
  params: Record<string, string>,
): Promise<Response> {
  const auth = requireOperator(request, env);
  if (!auth.authenticated) return auth.response;

  const ruleId = params['id']!;
  const deleted = await deleteRule(env.DB, ruleId);

  if (!deleted) {
    return jsonError('NOT_FOUND', `Rule '${ruleId}' not found`, 404);
  }

  await writeAuditEvent(env.DB, {
    event_type: 'rule.deleted',
    actor_type: 'operator',
    rule_id: ruleId,
  });

  return jsonSuccess({ deleted: true });
}
