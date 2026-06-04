/**
 * Repository management endpoint handlers.
 */

import {
  ACCESS_MODES,
  DEFAULT_MIN_PASSWORD_LENGTH,
  DEFAULT_MAX_PASSWORD_LENGTH,
} from '@nrdocs/shared';
import type { AccessMode } from '@nrdocs/shared';
import type { Env } from '../index.js';
import { jsonSuccess, jsonError } from '../responses.js';
import { requireOperator } from '../auth.js';
import { hashPassword } from '../crypto.js';
import {
  listRepos,
  findRepoByFullName,
  approveRepo,
  disableRepo,
  setAccessMode,
  setPassword,
  setSelfPasswordAllowFlag,
  validateApproval,
  validateAccessChange,
  writeAuditEvent,
} from '../db/index.js';

export async function handleListRepos(
  request: Request,
  env: Env,
  _params: Record<string, string>,
): Promise<Response> {
  const auth = requireOperator(request, env);
  if (!auth.authenticated) return auth.response;

  const url = new URL(request.url);
  const state = url.searchParams.get('state') as 'pending' | 'approved' | 'disabled' | null;
  const access = url.searchParams.get('access') as AccessMode | null;
  const owner = url.searchParams.get('owner');
  const limitStr = url.searchParams.get('limit');
  const cursor = url.searchParams.get('cursor');

  const limit = limitStr ? Math.min(Math.max(parseInt(limitStr, 10) || 50, 1), 100) : 50;

  const result = await listRepos(env.DB, {
    state: state ?? undefined,
    access: access ?? undefined,
    owner: owner ?? undefined,
    limit,
    cursor: cursor ?? undefined,
  });

  return jsonSuccess({
    repos: result.repos,
    next_cursor: result.next_cursor,
  });
}

export async function handleGetRepo(
  request: Request,
  env: Env,
  params: Record<string, string>,
): Promise<Response> {
  const auth = requireOperator(request, env);
  if (!auth.authenticated) return auth.response;

  const fullName = `${params['owner']}/${params['repo']}`.toLowerCase();
  const repo = await findRepoByFullName(env.DB, fullName);

  if (!repo) {
    return jsonError('NOT_FOUND', `Repository '${fullName}' not found`, 404);
  }

  return jsonSuccess({ repo });
}

export async function handleApproveRepo(
  request: Request,
  env: Env,
  params: Record<string, string>,
): Promise<Response> {
  const auth = requireOperator(request, env);
  if (!auth.authenticated) return auth.response;

  const fullName = `${params['owner']}/${params['repo']}`.toLowerCase();
  const repo = await findRepoByFullName(env.DB, fullName);

  if (!repo) {
    return jsonError('NOT_FOUND', `Repository '${fullName}' not found`, 404);
  }

  // Parse request body
  let body: { access_mode?: string };
  try {
    body = await request.json() as { access_mode?: string };
  } catch {
    return jsonError('INVALID_BODY', 'Request body must be valid JSON', 400);
  }

  if (!body.access_mode || !['public', 'password'].includes(body.access_mode)) {
    return jsonError(
      'VALIDATION_ERROR',
      'access_mode must be "public" or "password"',
      400,
      { field: 'access_mode' },
    );
  }

  // Validate state transition
  const validation = validateApproval(repo);
  if (!validation.valid) {
    return jsonError('INVALID_STATE', validation.error!, 409);
  }

  const accessMode = body.access_mode as 'public' | 'password';
  const updated = await approveRepo(env.DB, repo.id, accessMode, 'operator');

  await writeAuditEvent(env.DB, {
    event_type: 'repo.approved',
    actor_type: 'operator',
    repo_id: repo.id,
    metadata: { access_mode: accessMode },
  });

  return jsonSuccess({ repo: updated });
}

export async function handleDisableRepo(
  request: Request,
  env: Env,
  params: Record<string, string>,
): Promise<Response> {
  const auth = requireOperator(request, env);
  if (!auth.authenticated) return auth.response;

  const fullName = `${params['owner']}/${params['repo']}`.toLowerCase();
  const repo = await findRepoByFullName(env.DB, fullName);

  if (!repo) {
    return jsonError('NOT_FOUND', `Repository '${fullName}' not found`, 404);
  }

  let reason: string | undefined;
  try {
    const body = await request.json() as { reason?: string };
    reason = body.reason;
  } catch {
    // Body is optional for disable
  }

  const updated = await disableRepo(env.DB, repo.id, 'operator', reason);

  await writeAuditEvent(env.DB, {
    event_type: 'repo.disabled',
    actor_type: 'operator',
    repo_id: repo.id,
    metadata: reason ? { reason } : undefined,
  });

  return jsonSuccess({ repo: updated });
}

export async function handleSetAccess(
  request: Request,
  env: Env,
  params: Record<string, string>,
): Promise<Response> {
  const auth = requireOperator(request, env);
  if (!auth.authenticated) return auth.response;

  const fullName = `${params['owner']}/${params['repo']}`.toLowerCase();
  const repo = await findRepoByFullName(env.DB, fullName);

  if (!repo) {
    return jsonError('NOT_FOUND', `Repository '${fullName}' not found`, 404);
  }

  let body: { access_mode?: string };
  try {
    body = await request.json() as { access_mode?: string };
  } catch {
    return jsonError('INVALID_BODY', 'Request body must be valid JSON', 400);
  }

  if (!body.access_mode || !ACCESS_MODES.includes(body.access_mode as AccessMode)) {
    return jsonError(
      'VALIDATION_ERROR',
      `access_mode must be one of: ${ACCESS_MODES.join(', ')}`,
      400,
      { field: 'access_mode' },
    );
  }

  const newMode = body.access_mode as AccessMode;
  const validation = validateAccessChange(repo, newMode);
  if (!validation.valid) {
    return jsonError('INVALID_STATE', validation.error!, 409);
  }

  const updated = await setAccessMode(env.DB, repo.id, newMode);

  await writeAuditEvent(env.DB, {
    event_type: 'repo.access_changed',
    actor_type: 'operator',
    repo_id: repo.id,
    metadata: { old_mode: repo.access_mode, new_mode: newMode },
  });

  return jsonSuccess({ repo: updated });
}

export async function handleSetPassword(
  request: Request,
  env: Env,
  params: Record<string, string>,
): Promise<Response> {
  const auth = requireOperator(request, env);
  if (!auth.authenticated) return auth.response;

  const fullName = `${params['owner']}/${params['repo']}`.toLowerCase();
  const repo = await findRepoByFullName(env.DB, fullName);

  if (!repo) {
    return jsonError('NOT_FOUND', `Repository '${fullName}' not found`, 404);
  }

  let body: { password?: string };
  try {
    body = await request.json() as { password?: string };
  } catch {
    return jsonError('INVALID_BODY', 'Request body must be valid JSON', 400);
  }

  if (!body.password || typeof body.password !== 'string') {
    return jsonError('VALIDATION_ERROR', 'password is required', 400, { field: 'password' });
  }

  if (body.password.length < DEFAULT_MIN_PASSWORD_LENGTH) {
    return jsonError(
      'VALIDATION_ERROR',
      `Password must be at least ${DEFAULT_MIN_PASSWORD_LENGTH} characters`,
      400,
      { field: 'password', min_length: DEFAULT_MIN_PASSWORD_LENGTH },
    );
  }

  if (body.password.length > DEFAULT_MAX_PASSWORD_LENGTH) {
    return jsonError(
      'VALIDATION_ERROR',
      `Password must be at most ${DEFAULT_MAX_PASSWORD_LENGTH} characters`,
      400,
      { field: 'password', max_length: DEFAULT_MAX_PASSWORD_LENGTH },
    );
  }

  const { hash, salt, iteration_count } = await hashPassword(body.password);
  await setPassword(env.DB, repo.id, hash, salt, iteration_count, 'operator');

  await writeAuditEvent(env.DB, {
    event_type: 'repo.password_set',
    actor_type: 'operator',
    repo_id: repo.id,
  });

  return jsonSuccess({ message: 'Password updated successfully' });
}

export async function handleAllowSelfPassword(
  request: Request,
  env: Env,
  params: Record<string, string>,
): Promise<Response> {
  const auth = requireOperator(request, env);
  if (!auth.authenticated) return auth.response;

  const fullName = `${params['owner']}/${params['repo']}`.toLowerCase();
  const repo = await findRepoByFullName(env.DB, fullName);

  if (!repo) {
    return jsonError('NOT_FOUND', `Repository '${fullName}' not found`, 404);
  }

  await setSelfPasswordAllowFlag(env.DB, repo.id, true);

  await writeAuditEvent(env.DB, {
    event_type: 'repo.self_password_allowed',
    actor_type: 'operator',
    repo_id: repo.id,
  });

  const updated = await findRepoByFullName(env.DB, fullName);
  return jsonSuccess({ repo: updated });
}

export async function handleDisallowSelfPassword(
  request: Request,
  env: Env,
  params: Record<string, string>,
): Promise<Response> {
  const auth = requireOperator(request, env);
  if (!auth.authenticated) return auth.response;

  const fullName = `${params['owner']}/${params['repo']}`.toLowerCase();
  const repo = await findRepoByFullName(env.DB, fullName);

  if (!repo) {
    return jsonError('NOT_FOUND', `Repository '${fullName}' not found`, 404);
  }

  await setSelfPasswordAllowFlag(env.DB, repo.id, false);

  await writeAuditEvent(env.DB, {
    event_type: 'repo.self_password_disallowed',
    actor_type: 'operator',
    repo_id: repo.id,
  });

  const updated = await findRepoByFullName(env.DB, fullName);
  return jsonSuccess({ repo: updated });
}
