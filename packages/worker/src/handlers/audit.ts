/**
 * Audit log query handler.
 * GET /api/audit-log — returns paginated audit events for the operator.
 */

import type { Env } from '../index.js';
import { requireOperator } from '../auth.js';
import { jsonSuccess } from '../responses.js';

export async function handleAuditLog(
  request: Request,
  env: Env,
  _params: Record<string, string>,
): Promise<Response> {
  // Require operator auth
  const auth = requireOperator(request, env);
  if (!auth.authenticated) {
    return auth.response;
  }

  const url = new URL(request.url);

  // Parse query params
  const repoFilter = url.searchParams.get('repo') ?? undefined;
  const eventFilter = url.searchParams.get('event') ?? undefined;
  const cursor = url.searchParams.get('cursor') ?? undefined;
  const limitParam = url.searchParams.get('limit');

  let limit = 50;
  if (limitParam) {
    const parsed = parseInt(limitParam, 10);
    if (!isNaN(parsed) && parsed > 0) {
      limit = Math.min(parsed, 100);
    }
  }

  // Build query
  const conditions: string[] = [];
  const bindings: (string | number)[] = [];

  if (repoFilter) {
    // Filter by repo full_name — join with repos table
    conditions.push(
      `repo_id IN (SELECT id FROM repos WHERE full_name = ?)`,
    );
    bindings.push(repoFilter.toLowerCase());
  }

  if (eventFilter) {
    conditions.push('event_type = ?');
    bindings.push(eventFilter);
  }

  if (cursor) {
    conditions.push('created_at < ?');
    bindings.push(cursor);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const query = `SELECT id, event_type, actor_type, actor_id, repo_id, build_id, rule_id, metadata_json, created_at
    FROM audit_log ${whereClause}
    ORDER BY created_at DESC
    LIMIT ?`;

  bindings.push(limit + 1); // Fetch one extra to determine if there's a next page

  const stmt = env.DB.prepare(query);
  const result = await stmt.bind(...bindings).all<{
    id: string;
    event_type: string;
    actor_type: string;
    actor_id: string | null;
    repo_id: string | null;
    build_id: string | null;
    rule_id: string | null;
    metadata_json: string | null;
    created_at: string;
  }>();

  const rows = result.results ?? [];
  const hasMore = rows.length > limit;
  const events = hasMore ? rows.slice(0, limit) : rows;

  // Map to response format (never include sensitive data)
  const items = events.map((row) => ({
    id: row.id,
    event_type: row.event_type,
    actor_type: row.actor_type,
    actor_id: row.actor_id,
    repo_id: row.repo_id,
    build_id: row.build_id,
    rule_id: row.rule_id,
    metadata: row.metadata_json ? JSON.parse(row.metadata_json) : null,
    created_at: row.created_at,
  }));

  const nextCursor = hasMore && events.length > 0
    ? events[events.length - 1]!.created_at
    : null;

  return jsonSuccess({
    items,
    cursor: nextCursor,
    has_more: hasMore,
  });
}
