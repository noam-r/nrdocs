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
    allow_unlisted_assets:
      row['allow_unlisted_assets'] === 1 || row['allow_unlisted_assets'] === true,
  };
}

export async function createRule(
  db: D1Database,
  pattern: string,
  accessMode: 'public' | 'password',
  createdBy: string,
  priority?: number,
  defaultAllowSelfPassword: boolean = true,
  allowUnlistedAssets: boolean = false,
): Promise<AutoApprovalRule> {
  const id = generateId('rule_');
  const now = new Date().toISOString();

  await db
    .prepare(
      `INSERT INTO auto_approval_rules (id, pattern, access_mode, enabled, priority, default_allow_repo_owner_password, allow_unlisted_assets, created_at, created_by, updated_at, updated_by)
       VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      pattern.toLowerCase(),
      accessMode,
      priority ?? 0,
      defaultAllowSelfPassword ? 1 : 0,
      allowUnlistedAssets ? 1 : 0,
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

export interface UpdateRuleInput {
  allow_unlisted_assets?: boolean;
  access_mode?: 'public' | 'password';
  priority?: number;
  enabled?: boolean;
  default_allow_repo_owner_password?: boolean;
}

export async function updateRule(
  db: D1Database,
  ruleId: string,
  updates: UpdateRuleInput,
  updatedBy: string,
): Promise<AutoApprovalRule | null> {
  const existing = await db
    .prepare('SELECT * FROM auto_approval_rules WHERE id = ?')
    .bind(ruleId)
    .first<Record<string, unknown>>();
  if (!existing) return null;

  const now = new Date().toISOString();
  const accessMode =
    updates.access_mode ??
    (existing['access_mode'] as 'public' | 'password');
  const priority =
    updates.priority ?? (existing['priority'] as number);
  const enabled =
    updates.enabled !== undefined
      ? updates.enabled
      : existing['enabled'] === 1 || existing['enabled'] === true;
  const defaultAllowSelfPassword =
    updates.default_allow_repo_owner_password !== undefined
      ? updates.default_allow_repo_owner_password
      : existing['default_allow_repo_owner_password'] === 1 ||
        existing['default_allow_repo_owner_password'] === true;
  const allowUnlisted =
    updates.allow_unlisted_assets !== undefined
      ? updates.allow_unlisted_assets
      : existing['allow_unlisted_assets'] === 1 ||
        existing['allow_unlisted_assets'] === true;

  await db
    .prepare(
      `UPDATE auto_approval_rules
       SET access_mode = ?, priority = ?, enabled = ?, default_allow_repo_owner_password = ?,
           allow_unlisted_assets = ?, updated_at = ?, updated_by = ?
       WHERE id = ?`,
    )
    .bind(
      accessMode,
      priority,
      enabled ? 1 : 0,
      defaultAllowSelfPassword ? 1 : 0,
      allowUnlisted ? 1 : 0,
      now,
      updatedBy,
      ruleId,
    )
    .run();

  const row = await db
    .prepare('SELECT * FROM auto_approval_rules WHERE id = ?')
    .bind(ruleId)
    .first<Record<string, unknown>>();
  return row ? normalizeRule(row) : null;
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
