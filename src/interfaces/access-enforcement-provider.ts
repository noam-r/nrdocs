import type { AccessPolicyEntry } from '../types';

/**
 * AccessEnforcementProvider — platform-agnostic interface for access
 * enforcement operations.
 *
 * Phase 1 implementation: CloudflareAccessProvider (no-op for `password`
 * mode; full implementation for future `invite_list` mode).
 * Abstracted per Requirement 18.2 so alternative enforcement mechanisms
 * can be substituted without modifying core logic.
 */
export interface AccessEnforcementProvider {
  /** Create or update access policy for a project path. */
  reconcileProjectAccess(projectSlug: string, policies: AccessPolicyEntry[]): Promise<void>;

  /** Remove all access configuration for a project path. */
  removeProjectAccess(projectSlug: string): Promise<void>;
}
