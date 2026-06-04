/**
 * Auto-approval rules endpoint handlers.
 */

import type { Env } from '../index.js';
import { jsonSuccess, jsonError } from '../responses.js';
import { requireOperator } from '../auth.js';
import { listRules, createRule, updateRule, deleteRule, writeAuditEvent } from '../db/index.js';

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

  let body: {
    pattern?: string;
    access_mode?: string;
    priority?: number;
    default_allow_repo_owner_password?: unknown;
    allow_unlisted_assets?: unknown;
  };
  try {
    body = await request.json() as typeof body;
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

  // R11.7: default to true when omitted; R11.8: reject non-boolean values
  let defaultAllowSelfPassword = true;
  if (body.default_allow_repo_owner_password !== undefined) {
    if (typeof body.default_allow_repo_owner_password !== 'boolean') {
      return jsonError(
        'VALIDATION_ERROR',
        'default_allow_repo_owner_password must be a boolean',
        400,
        { field: 'default_allow_repo_owner_password' },
      );
    }
    defaultAllowSelfPassword = body.default_allow_repo_owner_password;
  }

  let allowUnlistedAssets = false;
  if (body.allow_unlisted_assets !== undefined) {
    if (typeof body.allow_unlisted_assets !== 'boolean') {
      return jsonError(
        'VALIDATION_ERROR',
        'allow_unlisted_assets must be a boolean',
        400,
        { field: 'allow_unlisted_assets' },
      );
    }
    allowUnlistedAssets = body.allow_unlisted_assets;
  }

  const rule = await createRule(
    env.DB,
    body.pattern,
    accessMode,
    'operator',
    priority,
    defaultAllowSelfPassword,
    allowUnlistedAssets,
  );

  await writeAuditEvent(env.DB, {
    event_type: 'rule.created',
    actor_type: 'operator',
    rule_id: rule.id,
    metadata: {
      pattern: body.pattern,
      access_mode: accessMode,
      priority,
      allow_unlisted_assets: allowUnlistedAssets,
    },
  });

  return jsonSuccess({ rule }, 201);
}

export async function handleUpdateRule(
  request: Request,
  env: Env,
  params: Record<string, string>,
): Promise<Response> {
  const auth = requireOperator(request, env);
  if (!auth.authenticated) return auth.response;

  const ruleId = params['id']!;
  let body: {
    allow_unlisted_assets?: unknown;
    access_mode?: string;
    priority?: number;
    enabled?: boolean;
    default_allow_repo_owner_password?: unknown;
  };
  try {
    body = await request.json() as typeof body;
  } catch {
    return jsonError('INVALID_BODY', 'Request body must be valid JSON', 400);
  }

  const updates: {
    allow_unlisted_assets?: boolean;
    access_mode?: 'public' | 'password';
    priority?: number;
    enabled?: boolean;
    default_allow_repo_owner_password?: boolean;
  } = {};

  if (body.allow_unlisted_assets !== undefined) {
    if (typeof body.allow_unlisted_assets !== 'boolean') {
      return jsonError(
        'VALIDATION_ERROR',
        'allow_unlisted_assets must be a boolean',
        400,
        { field: 'allow_unlisted_assets' },
      );
    }
    updates.allow_unlisted_assets = body.allow_unlisted_assets;
  }

  if (body.access_mode !== undefined) {
    if (!['public', 'password'].includes(body.access_mode)) {
      return jsonError(
        'VALIDATION_ERROR',
        'access_mode must be "public" or "password"',
        400,
        { field: 'access_mode' },
      );
    }
    updates.access_mode = body.access_mode as 'public' | 'password';
  }

  if (typeof body.priority === 'number') {
    updates.priority = body.priority;
  }

  if (body.enabled !== undefined) {
    if (typeof body.enabled !== 'boolean') {
      return jsonError('VALIDATION_ERROR', 'enabled must be a boolean', 400, { field: 'enabled' });
    }
    updates.enabled = body.enabled;
  }

  if (body.default_allow_repo_owner_password !== undefined) {
    if (typeof body.default_allow_repo_owner_password !== 'boolean') {
      return jsonError(
        'VALIDATION_ERROR',
        'default_allow_repo_owner_password must be a boolean',
        400,
        { field: 'default_allow_repo_owner_password' },
      );
    }
    updates.default_allow_repo_owner_password = body.default_allow_repo_owner_password;
  }

  if (Object.keys(updates).length === 0) {
    return jsonError('VALIDATION_ERROR', 'No updatable fields provided', 400);
  }

  const rule = await updateRule(env.DB, ruleId, updates, 'operator');
  if (!rule) {
    return jsonError('NOT_FOUND', `Rule '${ruleId}' not found`, 404);
  }

  await writeAuditEvent(env.DB, {
    event_type: 'rule.updated',
    actor_type: 'operator',
    rule_id: ruleId,
    metadata: updates as Record<string, unknown>,
  });

  return jsonSuccess({ rule });
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
