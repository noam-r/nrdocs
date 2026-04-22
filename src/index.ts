/**
 * nrdocs Platform — barrel export for library consumers.
 *
 * Re-exports all public interfaces, implementations, and shared types
 * so that consumers can import from a single entry point.
 */

// ── Shared types ────────────────────────────────────────────────────
export type {
  Project,
  NewProject,
  ProjectStatus,
  AccessMode,
  AccessPolicyEntry,
  OperationalEvent,
  ProjectConfig,
  NavConfig,
  NavItem,
  AllowedListConfig,
  PageFrontmatter,
  SessionTokenPayload,
  TokenValidationResult,
} from './types';

// ── Platform abstraction interfaces ─────────────────────────────────
export type { StorageProvider } from './interfaces/storage-provider';
export type { DataStore } from './interfaces/data-store';
export type { AccessEnforcementProvider } from './interfaces/access-enforcement-provider';

// ── Implementations ─────────────────────────────────────────────────
export { D1DataStore } from './data-store/d1-data-store';
export { R2StorageProvider } from './storage/r2-storage-provider';
export { CloudflareAccessProvider } from './access/cloudflare-access-provider';

// ── Core components ─────────────────────────────────────────────────
export { PasswordHasher } from './auth/password-hasher';
export { SessionTokenManager } from './auth/session-token-manager';
export { RateLimiter } from './auth/rate-limiter';
export { evaluateAccess } from './access/access-policy-engine';
export type { AccessPolicyResult } from './access/access-policy-engine';

// ── Site builder ────────────────────────────────────────────────────
export {
  parseProjectConfig,
  parseNavConfig,
  parseAllowedListConfig,
  validateSlugMatch,
} from './site-builder/config-parser';
export { parseMarkdownPage } from './site-builder/markdown-parser';
export { validateNavReferences, generateNavHtml } from './site-builder/nav-generator';
export { buildSite } from './site-builder/site-builder';
