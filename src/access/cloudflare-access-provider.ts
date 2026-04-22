import type { AccessEnforcementProvider } from '../interfaces/access-enforcement-provider';
import type { AccessPolicyEntry } from '../types';

/**
 * CloudflareAccessProvider — Phase 1 implementation of AccessEnforcementProvider.
 *
 * In phase 1, only `public` and `password` access modes are supported.
 * - `public` projects have no Cloudflare Access gate (Requirement 15.4).
 * - `password` projects are authenticated directly by the Delivery Worker,
 *   without depending on Cloudflare Access (Requirement 15.5).
 *
 * Both methods are therefore no-ops in phase 1. They will be fully
 * implemented when `invite_list` mode is added in a future phase, at which
 * point Cloudflare Access policies will be reconciled from D1 state
 * (Requirement 15.1) via the Cloudflare API.
 *
 * Abstracted behind the AccessEnforcementProvider interface per
 * Requirement 18.2 so alternative enforcement mechanisms can be
 * substituted without modifying core logic.
 */
export class CloudflareAccessProvider implements AccessEnforcementProvider {
  /**
   * Create or update the Cloudflare Access policy for a project path.
   *
   * TODO: Implement for `invite_list` mode — call the Cloudflare Access
   * API to reconcile an Access Application + policy group for
   * `docs.example.com/<projectSlug>/*` based on the provided policy entries.
   */
  async reconcileProjectAccess(
    _projectSlug: string,
    _policies: AccessPolicyEntry[],
  ): Promise<void> {
    // No-op in phase 1: password mode auth is handled by the Delivery Worker
    // and public mode has no access gate.
  }

  /**
   * Remove all Cloudflare Access configuration for a project path.
   *
   * TODO: Implement for `invite_list` mode — call the Cloudflare Access
   * API to delete the Access Application associated with
   * `docs.example.com/<projectSlug>/*`.
   */
  async removeProjectAccess(_projectSlug: string): Promise<void> {
    // No-op in phase 1: no Cloudflare Access resources are created,
    // so there is nothing to remove.
  }
}
