/**
 * State transition validation logic.
 * Pure functions — no DB access needed.
 */

import type { RepoRecord, AccessMode } from '@nrdocs/shared';

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

export interface ServeResult {
  serveable: boolean;
  reason: string;
}

/**
 * Validates that a repo can be approved.
 * - Must have a latest_successful_build_id (approval requires artifact)
 * - Idempotent: re-approving an already-approved repo is valid
 */
export function validateApproval(repo: RepoRecord): ValidationResult {
  if (!repo.latest_successful_build_id) {
    return {
      valid: false,
      error: 'Cannot approve repo without a successful build',
    };
  }
  return { valid: true };
}

/**
 * Validates that a repo can be disabled.
 * Always valid (idempotent).
 */
export function validateDisable(_repo: RepoRecord): ValidationResult {
  return { valid: true };
}

/**
 * Validates that an access mode change is allowed.
 * - Repo must be in approved state
 * - Cannot set access on pending/disabled repos
 */
export function validateAccessChange(
  repo: RepoRecord,
  _newMode: AccessMode,
): ValidationResult {
  if (repo.approval_state !== 'approved') {
    return {
      valid: false,
      error: `Cannot change access mode on a repo in '${repo.approval_state}' state; must be approved`,
    };
  }
  return { valid: true };
}

/**
 * Determines whether a repo can serve content to visitors.
 *
 * Serving decision matrix:
 * - Must be approved
 * - Must have a latest_successful_build_id
 * - If access_mode is 'password', must have an active password credential
 * - If access_mode is 'public', always serveable (no password needed)
 * - If access_mode is 'none', not serveable
 */
export function canServe(
  repo: RepoRecord,
  hasPasswordCredential: boolean,
): ServeResult {
  if (repo.approval_state !== 'approved') {
    return { serveable: false, reason: `Repo is ${repo.approval_state}, not approved` };
  }

  if (!repo.latest_successful_build_id) {
    return { serveable: false, reason: 'No successful build available' };
  }

  if (repo.access_mode === 'none') {
    return { serveable: false, reason: 'Access mode is none' };
  }

  if (repo.access_mode === 'password' && !hasPasswordCredential) {
    return { serveable: false, reason: 'Password access mode requires a password credential' };
  }

  return { serveable: true, reason: 'Repo is approved with a successful build and valid access configuration' };
}
