import { describe, it, expect } from 'vitest';
import { generateId } from '../db/id.js';
import {
  validateApproval,
  validateDisable,
  validateAccessChange,
  canServe,
} from '../db/transitions.js';
import { findMatchingRule } from '../db/rules.js';
import type { RepoRecord, AutoApprovalRule } from '@nrdocs/shared';

// --- Helpers ---

function makeRepo(overrides: Partial<RepoRecord> = {}): RepoRecord {
  return {
    id: 'repo_abc123',
    github_repository_id: '12345',
    owner: 'myorg',
    name: 'myrepo',
    full_name: 'myorg/myrepo',
    default_branch: 'main',
    approval_state: 'pending',
    access_mode: 'none',
    latest_successful_build_id: null,
    last_publish_status: null,
    requested_access: null,
    site_title: null,
    created_at: '2024-01-01T00:00:00.000Z',
    updated_at: '2024-01-01T00:00:00.000Z',
    approved_at: null,
    approved_by: null,
    disabled_at: null,
    disabled_by: null,
    ...overrides,
  };
}

function makeRule(overrides: Partial<AutoApprovalRule> = {}): AutoApprovalRule {
  return {
    id: 'rule_abc123',
    pattern: 'myorg/*',
    access_mode: 'public',
    enabled: true,
    priority: 0,
    created_at: '2024-01-01T00:00:00.000Z',
    created_by: 'operator',
    updated_at: '2024-01-01T00:00:00.000Z',
    updated_by: 'operator',
    ...overrides,
  };
}

// --- ID Generation ---

describe('generateId', () => {
  it('generates IDs with the correct prefix', () => {
    const repoId = generateId('repo_');
    expect(repoId).toMatch(/^repo_[a-f0-9]{32}$/);

    const buildId = generateId('build_');
    expect(buildId).toMatch(/^build_[a-f0-9]{32}$/);

    const credId = generateId('cred_');
    expect(credId).toMatch(/^cred_[a-f0-9]{32}$/);

    const ruleId = generateId('rule_');
    expect(ruleId).toMatch(/^rule_[a-f0-9]{32}$/);

    const evtId = generateId('evt_');
    expect(evtId).toMatch(/^evt_[a-f0-9]{32}$/);
  });

  it('generates unique IDs', () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateId('repo_')));
    expect(ids.size).toBe(100);
  });
});

// --- State Transitions ---

describe('validateApproval', () => {
  it('rejects approval when no successful build exists', () => {
    const repo = makeRepo({ latest_successful_build_id: null });
    const result = validateApproval(repo);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('successful build');
  });

  it('allows approval when a successful build exists', () => {
    const repo = makeRepo({ latest_successful_build_id: 'build_xyz' });
    const result = validateApproval(repo);
    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('allows re-approval of already approved repo (idempotent)', () => {
    const repo = makeRepo({
      approval_state: 'approved',
      latest_successful_build_id: 'build_xyz',
    });
    const result = validateApproval(repo);
    expect(result.valid).toBe(true);
  });
});

describe('validateDisable', () => {
  it('is always valid for pending repos', () => {
    const repo = makeRepo({ approval_state: 'pending' });
    expect(validateDisable(repo).valid).toBe(true);
  });

  it('is always valid for approved repos', () => {
    const repo = makeRepo({ approval_state: 'approved' });
    expect(validateDisable(repo).valid).toBe(true);
  });

  it('is always valid for already disabled repos (idempotent)', () => {
    const repo = makeRepo({ approval_state: 'disabled' });
    expect(validateDisable(repo).valid).toBe(true);
  });
});

describe('validateAccessChange', () => {
  it('rejects access change on pending repos', () => {
    const repo = makeRepo({ approval_state: 'pending' });
    const result = validateAccessChange(repo, 'public');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('pending');
  });

  it('rejects access change on disabled repos', () => {
    const repo = makeRepo({ approval_state: 'disabled' });
    const result = validateAccessChange(repo, 'public');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('disabled');
  });

  it('allows access change on approved repos', () => {
    const repo = makeRepo({ approval_state: 'approved' });
    const result = validateAccessChange(repo, 'password');
    expect(result.valid).toBe(true);
  });
});

describe('canServe', () => {
  it('returns not serveable for pending repos', () => {
    const repo = makeRepo({ approval_state: 'pending' });
    const result = canServe(repo, false);
    expect(result.serveable).toBe(false);
    expect(result.reason).toContain('pending');
  });

  it('returns not serveable for disabled repos', () => {
    const repo = makeRepo({ approval_state: 'disabled' });
    const result = canServe(repo, false);
    expect(result.serveable).toBe(false);
    expect(result.reason).toContain('disabled');
  });

  it('returns not serveable when no successful build', () => {
    const repo = makeRepo({
      approval_state: 'approved',
      latest_successful_build_id: null,
    });
    const result = canServe(repo, false);
    expect(result.serveable).toBe(false);
    expect(result.reason).toContain('No successful build');
  });

  it('returns not serveable when access_mode is none', () => {
    const repo = makeRepo({
      approval_state: 'approved',
      latest_successful_build_id: 'build_xyz',
      access_mode: 'none',
    });
    const result = canServe(repo, false);
    expect(result.serveable).toBe(false);
    expect(result.reason).toContain('none');
  });

  it('returns serveable for public access with build', () => {
    const repo = makeRepo({
      approval_state: 'approved',
      latest_successful_build_id: 'build_xyz',
      access_mode: 'public',
    });
    const result = canServe(repo, false);
    expect(result.serveable).toBe(true);
  });

  it('returns not serveable for password access without credential', () => {
    const repo = makeRepo({
      approval_state: 'approved',
      latest_successful_build_id: 'build_xyz',
      access_mode: 'password',
    });
    const result = canServe(repo, false);
    expect(result.serveable).toBe(false);
    expect(result.reason).toContain('password credential');
  });

  it('returns serveable for password access with credential', () => {
    const repo = makeRepo({
      approval_state: 'approved',
      latest_successful_build_id: 'build_xyz',
      access_mode: 'password',
    });
    const result = canServe(repo, true);
    expect(result.serveable).toBe(true);
  });
});

// --- Rule Matching ---

describe('findMatchingRule', () => {
  it('returns null when no rules match', () => {
    const rules = [makeRule({ pattern: 'other-org/*' })];
    const result = findMatchingRule(rules, 'myorg/myrepo');
    expect(result).toBeNull();
  });

  it('matches exact pattern', () => {
    const rules = [makeRule({ pattern: 'myorg/myrepo' })];
    const result = findMatchingRule(rules, 'myorg/myrepo');
    expect(result).not.toBeNull();
    expect(result!.pattern).toBe('myorg/myrepo');
  });

  it('matches namespace pattern', () => {
    const rules = [makeRule({ pattern: 'myorg/*' })];
    const result = findMatchingRule(rules, 'myorg/myrepo');
    expect(result).not.toBeNull();
    expect(result!.pattern).toBe('myorg/*');
  });

  it('exact match wins over namespace match', () => {
    const rules = [
      makeRule({ id: 'rule_1', pattern: 'myorg/*', priority: 10 }),
      makeRule({ id: 'rule_2', pattern: 'myorg/myrepo', priority: 0 }),
    ];
    const result = findMatchingRule(rules, 'myorg/myrepo');
    expect(result).not.toBeNull();
    expect(result!.id).toBe('rule_2');
  });

  it('higher priority wins among same match type', () => {
    const rules = [
      makeRule({ id: 'rule_1', pattern: 'myorg/*', priority: 5 }),
      makeRule({ id: 'rule_2', pattern: 'myorg/*', priority: 10 }),
    ];
    const result = findMatchingRule(rules, 'myorg/myrepo');
    expect(result).not.toBeNull();
    expect(result!.id).toBe('rule_2');
  });

  it('older rule wins when priority is tied', () => {
    const rules = [
      makeRule({
        id: 'rule_1',
        pattern: 'myorg/*',
        priority: 5,
        created_at: '2024-01-01T00:00:00.000Z',
      }),
      makeRule({
        id: 'rule_2',
        pattern: 'myorg/*',
        priority: 5,
        created_at: '2024-06-01T00:00:00.000Z',
      }),
    ];
    const result = findMatchingRule(rules, 'myorg/myrepo');
    expect(result).not.toBeNull();
    expect(result!.id).toBe('rule_1');
  });

  it('performs case-insensitive matching', () => {
    const rules = [makeRule({ pattern: 'MyOrg/MyRepo' })];
    const result = findMatchingRule(rules, 'MYORG/MYREPO');
    expect(result).not.toBeNull();
  });

  it('skips disabled rules', () => {
    const rules = [makeRule({ pattern: 'myorg/myrepo', enabled: false })];
    const result = findMatchingRule(rules, 'myorg/myrepo');
    expect(result).toBeNull();
  });
});
