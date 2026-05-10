/**
 * Comprehensive state transition tests.
 * Verifies all state machine flows using pure logic functions.
 */

import { describe, it, expect } from 'vitest';
import {
  canServe,
  validateApproval,
  validateDisable,
  validateAccessChange,
} from '../db/transitions.js';
import { findMatchingRule } from '../db/rules.js';
import type { RepoRecord, AutoApprovalRule } from '@nrdocs/shared';

/** Helper to create a minimal RepoRecord for testing. */
function makeRepo(overrides: Partial<RepoRecord> = {}): RepoRecord {
  return {
    id: 'repo_test1',
    github_repository_id: '99999',
    owner: 'acme',
    name: 'docs',
    full_name: 'acme/docs',
    default_branch: 'main',
    approval_state: 'pending',
    access_mode: 'none',
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

function makeRule(overrides: Partial<AutoApprovalRule> = {}): AutoApprovalRule {
  return {
    id: 'rule_1',
    pattern: 'acme/*',
    access_mode: 'public',
    enabled: true,
    priority: 0,
    created_at: '2024-01-01T00:00:00Z',
    created_by: 'operator',
    updated_at: '2024-01-01T00:00:00Z',
    updated_by: 'operator',
    ...overrides,
  };
}

describe('State Transitions', () => {
  describe('First publish flow (no auto-approval)', () => {
    it('new repo starts pending with access none', () => {
      const repo = makeRepo({
        approval_state: 'pending',
        access_mode: 'none',
        latest_successful_build_id: 'build_1',
      });

      // canServe should be false — not approved
      const result = canServe(repo, false);
      expect(result.serveable).toBe(false);
      expect(result.reason).toContain('pending');
    });

    it('pending repo with build is not serveable', () => {
      const repo = makeRepo({
        approval_state: 'pending',
        access_mode: 'none',
        latest_successful_build_id: 'build_abc',
      });
      expect(canServe(repo, false).serveable).toBe(false);
    });
  });

  describe('First publish flow (with auto-approval)', () => {
    it('matching rule auto-approves with public access → serveable', () => {
      const rules = [makeRule({ pattern: 'acme/*', access_mode: 'public' })];
      const matched = findMatchingRule(rules, 'acme/docs');
      expect(matched).not.toBeNull();
      expect(matched!.access_mode).toBe('public');

      // Simulate the state after auto-approval
      const repo = makeRepo({
        approval_state: 'approved',
        access_mode: 'public',
        latest_successful_build_id: 'build_1',
      });
      expect(canServe(repo, false).serveable).toBe(true);
    });

    it('matching rule auto-approves with password access → needs credential', () => {
      const rules = [makeRule({ pattern: 'acme/*', access_mode: 'password' })];
      const matched = findMatchingRule(rules, 'acme/docs');
      expect(matched).not.toBeNull();
      expect(matched!.access_mode).toBe('password');

      // After auto-approval with password mode but no credential set
      const repo = makeRepo({
        approval_state: 'approved',
        access_mode: 'password',
        latest_successful_build_id: 'build_1',
      });
      const result = canServe(repo, false);
      expect(result.serveable).toBe(false);
      expect(result.reason).toContain('password');
    });

    it('no matching rule leaves repo pending', () => {
      const rules = [makeRule({ pattern: 'other/*' })];
      const matched = findMatchingRule(rules, 'acme/docs');
      expect(matched).toBeNull();

      // Repo stays pending
      const repo = makeRepo({
        approval_state: 'pending',
        access_mode: 'none',
        latest_successful_build_id: 'build_1',
      });
      expect(canServe(repo, false).serveable).toBe(false);
    });
  });

  describe('Manual approval flow', () => {
    it('pending repo with build → approve with public → canServe true', () => {
      const repo = makeRepo({
        approval_state: 'pending',
        latest_successful_build_id: 'build_1',
      });

      // Validate approval is allowed
      expect(validateApproval(repo).valid).toBe(true);

      // After approval
      const approved = makeRepo({
        ...repo,
        approval_state: 'approved',
        access_mode: 'public',
      });
      expect(canServe(approved, false).serveable).toBe(true);
    });

    it('pending repo with build → approve with password → needs credential', () => {
      const repo = makeRepo({
        approval_state: 'pending',
        latest_successful_build_id: 'build_1',
      });

      expect(validateApproval(repo).valid).toBe(true);

      // After approval with password mode
      const approved = makeRepo({
        ...repo,
        approval_state: 'approved',
        access_mode: 'password',
      });

      // Without credential
      expect(canServe(approved, false).serveable).toBe(false);
      // With credential
      expect(canServe(approved, true).serveable).toBe(true);
    });

    it('pending repo without build → approve rejected', () => {
      const repo = makeRepo({
        approval_state: 'pending',
        latest_successful_build_id: null,
      });

      const result = validateApproval(repo);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('build');
    });
  });

  describe('Disable flow', () => {
    it('approved public repo → disable → canServe false', () => {
      const repo = makeRepo({
        approval_state: 'approved',
        access_mode: 'public',
        latest_successful_build_id: 'build_1',
      });

      // Validate disable is always valid
      expect(validateDisable(repo).valid).toBe(true);

      // After disable
      const disabled = makeRepo({
        ...repo,
        approval_state: 'disabled',
      });
      expect(canServe(disabled, false).serveable).toBe(false);
    });

    it('validateDisable is always valid (idempotent)', () => {
      expect(validateDisable(makeRepo({ approval_state: 'pending' })).valid).toBe(true);
      expect(validateDisable(makeRepo({ approval_state: 'approved' })).valid).toBe(true);
      expect(validateDisable(makeRepo({ approval_state: 'disabled' })).valid).toBe(true);
    });

    it('disabled repo is not serveable regardless of access mode', () => {
      const disabled = makeRepo({
        approval_state: 'disabled',
        access_mode: 'public',
        latest_successful_build_id: 'build_1',
      });
      expect(canServe(disabled, true).serveable).toBe(false);
    });
  });

  describe('Access change flow', () => {
    it('approved public → change to password → canServe depends on credential', () => {
      const repo = makeRepo({
        approval_state: 'approved',
        access_mode: 'public',
        latest_successful_build_id: 'build_1',
      });

      // Validate access change is allowed
      expect(validateAccessChange(repo, 'password').valid).toBe(true);

      // After change to password
      const withPassword = makeRepo({
        ...repo,
        access_mode: 'password',
      });

      // Without credential → not serveable
      expect(canServe(withPassword, false).serveable).toBe(false);
      // With credential → serveable
      expect(canServe(withPassword, true).serveable).toBe(true);
    });

    it('approved password → change to public → canServe true', () => {
      const repo = makeRepo({
        approval_state: 'approved',
        access_mode: 'password',
        latest_successful_build_id: 'build_1',
      });

      expect(validateAccessChange(repo, 'public').valid).toBe(true);

      // After change to public
      const publicRepo = makeRepo({
        ...repo,
        access_mode: 'public',
      });
      expect(canServe(publicRepo, false).serveable).toBe(true);
    });

    it('pending repo → access change rejected', () => {
      const repo = makeRepo({
        approval_state: 'pending',
        latest_successful_build_id: 'build_1',
      });

      const result = validateAccessChange(repo, 'public');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('approved');
    });

    it('disabled repo → access change rejected', () => {
      const repo = makeRepo({
        approval_state: 'disabled',
        latest_successful_build_id: 'build_1',
      });

      const result = validateAccessChange(repo, 'public');
      expect(result.valid).toBe(false);
    });
  });

  describe('Republish flow', () => {
    it('approved repo → new publish → approval preserved, new build served', () => {
      // Repo was approved with build_1
      const repo = makeRepo({
        approval_state: 'approved',
        access_mode: 'public',
        latest_successful_build_id: 'build_1',
      });
      expect(canServe(repo, false).serveable).toBe(true);

      // After republish, latest_successful_build_id updated to build_2
      const republished = makeRepo({
        ...repo,
        latest_successful_build_id: 'build_2',
      });

      // Approval state preserved
      expect(republished.approval_state).toBe('approved');
      expect(republished.access_mode).toBe('public');
      expect(canServe(republished, false).serveable).toBe(true);
    });

    it('republish does not change approval state', () => {
      const repo = makeRepo({
        approval_state: 'approved',
        access_mode: 'password',
        latest_successful_build_id: 'build_1',
      });

      // Simulate republish — only build ID changes
      const republished = makeRepo({
        ...repo,
        latest_successful_build_id: 'build_2',
        updated_at: '2024-06-01T00:00:00Z',
      });

      expect(republished.approval_state).toBe('approved');
      expect(republished.access_mode).toBe('password');
    });
  });

  describe('Failed publish flow', () => {
    it('approved repo with build_1 → failed publish → build_1 still served', () => {
      // The repo has a successful build
      const repo = makeRepo({
        approval_state: 'approved',
        access_mode: 'public',
        latest_successful_build_id: 'build_1',
      });

      // A failed publish does NOT update latest_successful_build_id
      // The repo record stays the same
      expect(canServe(repo, false).serveable).toBe(true);
      expect(repo.latest_successful_build_id).toBe('build_1');
    });

    it('pending repo with no prior build → failed publish → still not serveable', () => {
      const repo = makeRepo({
        approval_state: 'pending',
        access_mode: 'none',
        latest_successful_build_id: null,
      });

      // Failed publish doesn't set latest_successful_build_id
      expect(canServe(repo, false).serveable).toBe(false);
    });
  });
});
