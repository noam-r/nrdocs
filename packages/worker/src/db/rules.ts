/**
 * Auto-approval rule query helpers for D1.
 */

import type { AutoApprovalRule } from '@nrdocs/shared';
import { generateId } from './id.js';

/**
 * Coerce D1 INTEGER 0/1 columns to JS booleans on a raw rule row.
 */
export function normalizeRule(row: Record<string, unknown>): AutoApprovalRule {
  return {
    ...(row as unknown as AutoApprovalRule),
    enabled: row['enabled'] === 1 || row['enabled'] === true,
    default_allow_repo_owner_password:
      row['default_allow_repo_owner_password'] === 1 ||
      row['default_allow_repo_owner_password'] === true,
  };
}

export async function createRule(
  db: D1Database,
  pattern: string,
  accessMode: 'public' | 'password',
  createdBy: string,
  priority?: number,
  defaultAllowSelfPassword: boolean = true,
): Promise<AutoApprovalRule> {
  const id = generateId('rule_');
  const now = new Date().toISOString();

  await db
    .prepare(
      `INSERT INTO auto_approval_rules (id, pattern, access_mode, enabled, priority, default_allow_repo_owner_password, created_at, created_by, updated_at, updated_by)
       VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      pattern.toLowerCase(),
      accessMode,
      priority ?? 0,
      defaultAllowSelfPassword ? 1 : 0,
      now,
      createdBy,
      now,
      createdBy,
    )
    .run();

  const row = await db
    .prepare('SELECT * FROM auto_approval_rules WHERE id = ?')
    .bind(id)
    .first<Record<string, unknown>>();
  return normalizeRule(row!);
}

export async function deleteRule(
  db: D1Database,
  ruleId: string,
): Promise<boolean> {
  const result = await db
    .prepare('DELETE FROM auto_approval_rules WHERE id = ?')
    .bind(ruleId)
    .run();
  return (result.meta?.changes ?? 0) > 0;
}

export async function listRules(db: D1Database): Promise<AutoApprovalRule[]> {
  const result = await db
    .prepare('SELECT * FROM auto_approval_rules WHERE enabled = 1 ORDER BY priority DESC, created_at ASC')
    .all<Record<string, unknown>>();
  return (result.results ?? []).map(normalizeRule);
}

/**
 * Pure function that implements the rule matching algorithm.
 * Exported separately for unit testing without D1.
 *
 * Matching priority:
 * 1. Exact match (owner/repo) wins over namespace match (owner/*)
 * 2. Higher priority value wins
 * 3. Older rule (earlier created_at) wins when tied
 */
export function findMatchingRule(
  rules: AutoApprovalRule[],
  fullName: string,
): AutoApprovalRule | null {
  const normalized = fullName.toLowerCase();
  const owner = normalized.split('/')[0];

  const exactMatches: AutoApprovalRule[] = [];
  const namespaceMatches: AutoApprovalRule[] = [];

  for (const rule of rules) {
    if (!rule.enabled) continue;

    const pattern = rule.pattern.toLowerCase();
    if (pattern === normalized) {
      exactMatches.push(rule);
    } else if (pattern === `${owner}/*`) {
      namespaceMatches.push(rule);
    }
  }

  // Exact matches take priority over namespace matches
  const candidates = exactMatches.length > 0 ? exactMatches : namespaceMatches;

  if (candidates.length === 0) return null;

  // Sort by priority DESC, then created_at ASC (older wins)
  candidates.sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    return a.created_at.localeCompare(b.created_at);
  });

  return candidates[0]!;
}

/**
 * Queries enabled rules from D1 and runs the matching algorithm.
 */
export async function matchRules(
  db: D1Database,
  fullName: string,
): Promise<AutoApprovalRule | null> {
  const rules = await listRules(db);
  return findMatchingRule(rules, fullName);
}
