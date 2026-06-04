/**
 * Full access-control matrix tests.
 * Verifies the complete decision paths using pure logic functions.
 */

import { describe, it, expect } from 'vitest';
import {
  canServe,
  validateApproval,
  validateAccessChange,
} from '../db/transitions.js';
import { findMatchingRule } from '../db/rules.js';
import type { RepoRecord, AutoApprovalRule } from '@nrdocs/shared';

/** Helper to create a minimal RepoRecord for testing. */
function makeRepo(overrides: Partial<RepoRecord> = {}): RepoRecord {
  return {
    id: 'repo_test123',
    github_repository_id: '12345',
    owner: 'acme',
    name: 'docs',
    full_name: 'acme/docs',
    default_branch: 'main',
    approval_state: 'pending',
    access_mode: 'none',
    allow_repo_owner_password: false,
    latest_successful_build_id: null,
    last_publish_status: null,
    requested_access: null,
    site_title: null,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    approved_at: null,
    approved_by: null,
    disabled_at: null,
    disabled_by: null,
    ...overrides,
  };
}

describe('Access Control Matrix', () => {
  describe('canServe() decision matrix', () => {
    it('repo not approved → not serveable (404)', () => {
      const repo = makeRepo({ approval_state: 'pending', access_mode: 'none' });
      const result = canServe(repo, false);
      expect(result.serveable).toBe(false);
    });

    it('repo approved, no build → not serveable (404)', () => {
      const repo = makeRepo({
        approval_state: 'approved',
        access_mode: 'public',
        latest_successful_build_id: null,
      });
      const result = canServe(repo, false);
      expect(result.serveable).toBe(false);
    });

    it('repo pending, has build, access none → not serveable (404)', () => {
      const repo = makeRepo({
        approval_state: 'pending',
        access_mode: 'none',
        latest_successful_build_id: 'build_1',
      });
      const result = canServe(repo, false);
      expect(result.serveable).toBe(false);
    });

    it('repo approved, has build, access public → serveable (200)', () => {
      const repo = makeRepo({
        approval_state: 'approved',
        access_mode: 'public',
        latest_successful_build_id: 'build_1',
      });
      const result = canServe(repo, false);
      expect(result.serveable).toBe(true);
    });

    it('repo approved, has build, access password, no credential → not serveable (password page)', () => {
      const repo = makeRepo({
        approval_state: 'approved',
        access_mode: 'password',
        latest_successful_build_id: 'build_1',
      });
      const result = canServe(repo, false);
      expect(result.serveable).toBe(false);
      expect(result.reason).toContain('password');
    });

    it('repo approved, has build, access password, has credential → serveable (200 after auth)', () => {
      const repo = makeRepo({
        approval_state: 'approved',
        access_mode: 'password',
        latest_successful_build_id: 'build_1',
      });
      const result = canServe(repo, true);
      expect(result.serveable).toBe(true);
    });

    it('repo disabled, access public → not serveable (404)', () => {
      const repo = makeRepo({
        approval_state: 'disabled',
        access_mode: 'public',
        latest_successful_build_id: 'build_1',
      });
      const result = canServe(repo, false);
      expect(result.serveable).toBe(false);
    });

    it('repo disabled, access password, has credential → not serveable (404)', () => {
      const repo = makeRepo({
        approval_state: 'disabled',
        access_mode: 'password',
        latest_successful_build_id: 'build_1',
      });
      const result = canServe(repo, true);
      expect(result.serveable).toBe(false);
    });

    it('repo approved, access none → not serveable', () => {
      const repo = makeRepo({
        approval_state: 'approved',
        access_mode: 'none',
        latest_successful_build_id: 'build_1',
      });
      const result = canServe(repo, false);
      expect(result.serveable).toBe(false);
      expect(result.reason).toContain('none');
    });
  });

  describe('validateApproval()', () => {
    it('rejects repos without builds', () => {
      const repo = makeRepo({ latest_successful_build_id: null });
      const result = validateApproval(repo);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('build');
    });

    it('accepts repos with a successful build', () => {
      const repo = makeRepo({ latest_successful_build_id: 'build_1' });
      const result = validateApproval(repo);
      expect(result.valid).toBe(true);
    });

    it('accepts already-approved repos (idempotent)', () => {
      const repo = makeRepo({
        approval_state: 'approved',
        latest_successful_build_id: 'build_1',
      });
      const result = validateApproval(repo);
      expect(result.valid).toBe(true);
    });
  });

  describe('validateAccessChange()', () => {
    it('rejects pending repos', () => {
      const repo = makeRepo({ approval_state: 'pending' });
      const result = validateAccessChange(repo, 'public');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('approved');
    });

    it('rejects disabled repos', () => {
      const repo = makeRepo({ approval_state: 'disabled' });
      const result = validateAccessChange(repo, 'public');
      expect(result.valid).toBe(false);
    });

    it('accepts approved repos', () => {
      const repo = makeRepo({ approval_state: 'approved' });
      const result = validateAccessChange(repo, 'password');
      expect(result.valid).toBe(true);
    });
  });

  describe('findMatchingRule() complex scenarios', () => {
    function makeRule(overrides: Partial<AutoApprovalRule> = {}): AutoApprovalRule {
      return {
        id: 'rule_1',
        pattern: 'acme/*',
        access_mode: 'public',
        enabled: true,
        priority: 0,
        default_allow_repo_owner_password: true,
        allow_unlisted_assets: false,
        created_at: '2024-01-01T00:00:00Z',
        created_by: 'operator',
        updated_at: '2024-01-01T00:00:00Z',
        updated_by: 'operator',
        ...overrides,
      };
    }

    it('returns null when no rules match', () => {
      const rules = [makeRule({ pattern: 'other/*' })];
      const result = findMatchingRule(rules, 'acme/docs');
      expect(result).toBeNull();
    });

    it('matches exact repo pattern', () => {
      const rules = [makeRule({ pattern: 'acme/docs' })];
      const result = findMatchingRule(rules, 'acme/docs');
      expect(result).not.toBeNull();
      expect(result!.pattern).toBe('acme/docs');
    });

    it('matches namespace wildcard pattern', () => {
      const rules = [makeRule({ pattern: 'acme/*' })];
      const result = findMatchingRule(rules, 'acme/docs');
      expect(result).not.toBeNull();
    });

    it('exact match takes priority over namespace match', () => {
      const rules = [
        makeRule({ id: 'rule_ns', pattern: 'acme/*', access_mode: 'public', priority: 10 }),
        makeRule({ id: 'rule_exact', pattern: 'acme/docs', access_mode: 'password', priority: 0 }),
      ];
      const result = findMatchingRule(rules, 'acme/docs');
      expect(result).not.toBeNull();
      expect(result!.id).toBe('rule_exact');
      expect(result!.access_mode).toBe('password');
    });

    it('higher priority wins among same-type matches', () => {
      const rules = [
        makeRule({ id: 'rule_low', pattern: 'acme/*', priority: 1, created_at: '2024-01-01T00:00:00Z' }),
        makeRule({ id: 'rule_high', pattern: 'acme/*', priority: 10, created_at: '2024-01-02T00:00:00Z' }),
      ];
      const result = findMatchingRule(rules, 'acme/docs');
      expect(result!.id).toBe('rule_high');
    });

    it('older rule wins when priority is tied', () => {
      const rules = [
        makeRule({ id: 'rule_new', pattern: 'acme/*', priority: 5, created_at: '2024-06-01T00:00:00Z' }),
        makeRule({ id: 'rule_old', pattern: 'acme/*', priority: 5, created_at: '2024-01-01T00:00:00Z' }),
      ];
      const result = findMatchingRule(rules, 'acme/docs');
      expect(result!.id).toBe('rule_old');
    });

    it('skips disabled rules', () => {
      const rules = [
        makeRule({ id: 'rule_disabled', pattern: 'acme/docs', enabled: false }),
        makeRule({ id: 'rule_ns', pattern: 'acme/*', enabled: true }),
      ];
      const result = findMatchingRule(rules, 'acme/docs');
      expect(result!.id).toBe('rule_ns');
    });

    it('case-insensitive matching', () => {
      const rules = [makeRule({ pattern: 'acme/docs' })];
      const result = findMatchingRule(rules, 'ACME/DOCS');
      expect(result).not.toBeNull();
    });

    it('returns null for empty rules list', () => {
      const result = findMatchingRule([], 'acme/docs');
      expect(result).toBeNull();
    });

    it('does not match partial namespace patterns', () => {
      const rules = [makeRule({ pattern: 'acm/*' })];
      const result = findMatchingRule(rules, 'acme/docs');
      expect(result).toBeNull();
    });
  });
});
