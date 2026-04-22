# Implementation Plan: nrdocs Platform

## Overview

Build the nrdocs serverless documentation publishing platform on Cloudflare (Workers, D1, R2). Implementation proceeds bottom-up: platform abstraction interfaces and data models first, then core components (Password Hasher, Session Token Manager, Rate Limiter, Access Policy Engine, Site Builder), then the two Workers (Control Plane API, Delivery Worker), and finally integration wiring and the GitHub Actions workflow definition.

All code is TypeScript targeting Cloudflare Workers runtime.

## Tasks

- [ ] 1. Define platform abstraction interfaces and shared types
  - [x] 1.1 Create the `StorageProvider` interface
    - Define `put`, `get`, `delete`, `list`, `deletePrefix` methods as specified in the design
    - _Requirements: 18.1_

  - [x] 1.2 Create the `DataStore` interface
    - Define project operations (`getProjectBySlug`, `getProjectById`, `createProject`, `updateProjectStatus`, `deleteProject`, `updateActivePublishPointer`)
    - Define access policy operations (`getAccessPolicies`, `getPlatformPolicies`, `replaceRepoDerivedEntries`, `upsertAdminOverride`, `deleteAdminOverride`)
    - Define password operations (`getPasswordHash`, `setPasswordHash`)
    - Define operational record method (`recordEvent`)
    - _Requirements: 18.3_

  - [x] 1.3 Create the `AccessEnforcementProvider` interface
    - Define `reconcileProjectAccess` and `removeProjectAccess` methods
    - _Requirements: 18.2_

  - [x] 1.4 Define shared TypeScript types and enums
    - `Project`, `NewProject`, `ProjectStatus` (`awaiting_approval`, `approved`, `disabled`), `AccessMode` (`public`, `password`)
    - `AccessPolicyEntry`, `OperationalEvent` (with event types: `registration`, `approval`, `disable`, `delete`, `publish_start`, `publish_success`, `publish_failure`, `login_failure`)
    - Repo config types: `ProjectConfig`, `NavConfig`, `NavItem`, `AllowedListConfig`, `PageFrontmatter`
    - Session token types: `SessionTokenPayload`, `TokenValidationResult`
    - _Requirements: 2.2, 2.3, 4.1, 4.4, 6.6, 10.1, 10.2, 10.3, 11.2, 11.3_

- [ ] 2. Implement D1 data layer (`D1DataStore`)
  - [x] 2.1 Create D1 schema migration file
    - Define `projects` table with all columns (id, slug, repo_url, title, description, status, access_mode, active_publish_pointer, password_hash, password_version, created_at, updated_at)
    - Define `access_policy_entries` table with all columns and constraints (repo-sourced entries must be `allow` effect and `project` scope)
    - Define `operational_events` table
    - Define `rate_limit_entries` table
    - _Requirements: 14.1_

  - [x] 2.2 Implement `D1DataStore` class — project operations
    - Implement `getProjectBySlug`, `getProjectById`, `createProject`, `updateProjectStatus`, `deleteProject`, `updateActivePublishPointer`
    - Enforce unique slug constraint, immutable slug/access_mode after creation
    - _Requirements: 1.5, 1.6, 2.1, 2.2, 2.3, 2.10, 14.1, 14.2_

  - [x] 2.3 Implement `D1DataStore` class — access policy operations
    - Implement `getAccessPolicies`, `getPlatformPolicies`, `replaceRepoDerivedEntries`, `upsertAdminOverride`, `deleteAdminOverride`
    - `replaceRepoDerivedEntries` must delete all existing repo-derived entries for the project and insert new ones in a transaction, preserving admin overrides
    - _Requirements: 8.5, 8.6, 8.7, 9.1, 9.5, 14.1_

  - [x] 2.4 Implement `D1DataStore` class — password and event operations
    - Implement `getPasswordHash`, `setPasswordHash` (must increment `password_version`)
    - Implement `recordEvent`
    - _Requirements: 5.7, 5.9, 14.1, 14.4, 19.1, 19.2, 19.3, 19.4_

  - [ ]* 2.5 Write unit tests for `D1DataStore`
    - Test project CRUD, slug uniqueness enforcement, status transitions
    - Test access policy replacement preserves admin overrides
    - Test password version increment on hash update
    - Test operational event recording
    - _Requirements: 2.2, 2.3, 2.10, 8.5, 8.6, 8.7, 14.1_

- [ ] 3. Implement R2 storage provider (`R2StorageProvider`)
  - [x] 3.1 Implement `R2StorageProvider` class
    - Implement `put`, `get`, `delete`, `list`, `deletePrefix` backed by Cloudflare R2 bindings
    - `deletePrefix` must list all objects under the prefix and delete them
    - _Requirements: 13.1, 18.1_

  - [ ]* 3.2 Write unit tests for `R2StorageProvider`
    - Test put/get round-trip, delete, list, deletePrefix
    - _Requirements: 18.1_

- [ ] 4. Implement Cloudflare Access enforcement provider
  - [x] 4.1 Implement `CloudflareAccessProvider` class
    - Implement `reconcileProjectAccess` and `removeProjectAccess`
    - Phase 1 stub: for `password` mode projects, these are no-ops; full implementation for future `invite_list` mode
    - _Requirements: 15.1, 15.4, 15.5, 18.2_

- [x] 5. Checkpoint — Ensure all interface implementations compile and tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 6. Implement Password Hasher module
  - [x] 6.1 Implement `PasswordHasher` with scrypt
    - `hash(plaintext)` → scrypt hash string
    - `verify(plaintext, storedHash)` → boolean
    - Use Web Crypto API or compatible scrypt implementation for Workers runtime
    - _Requirements: 5.2, 5.7_

  - [ ]* 6.2 Write unit tests for `PasswordHasher`
    - Test hash produces non-plaintext output, verify succeeds for correct password, verify fails for wrong password
    - _Requirements: 5.2, 5.7_

- [ ] 7. Implement Session Token Manager
  - [x] 7.1 Implement `SessionTokenManager`
    - `create(projectId, passwordVersion, signingKey, ttl)` → token string in format `base64url(payload).base64url(HMAC-SHA256(payload, signingKey))`
    - Payload fields: `v` (version), `pid` (project ID), `iat` (issued-at), `exp` (expiry), `pv` (password version)
    - `validate(token, signingKey, currentPasswordVersion)` → `{ valid, projectId }` or rejection reason
    - Reject tokens with mismatched `pv`, expired `exp`, invalid HMAC, or unrecognized `v`
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7_

  - [ ]* 7.2 Write unit tests for `SessionTokenManager`
    - Test create produces valid format, validate accepts valid token, rejects expired token, rejects wrong password version, rejects tampered signature, rejects unrecognized version
    - _Requirements: 5.5, 5.6, 5.9, 6.4, 6.7_

- [ ] 8. Implement Rate Limiter
  - [x] 8.1 Implement `RateLimiter` using D1 `rate_limit_entries` table
    - `checkAndIncrement(projectId, maxAttempts, windowSeconds)` → `{ allowed: boolean, retryAfterSeconds?: number }`
    - Track failed attempts per project within a configurable time window
    - Reset window when it expires
    - _Requirements: 5.10_

  - [ ]* 8.2 Write unit tests for `RateLimiter`
    - Test allows attempts under threshold, blocks after threshold, resets after window expires
    - _Requirements: 5.10_

- [ ] 9. Implement Access Policy Engine
  - [x] 9.1 Implement `AccessPolicyEngine` as a pure function
    - Evaluate access in precedence order: platform blacklist → platform whitelist → project blacklist → project whitelist → repo-derived allow → default deny
    - Support exact email and domain wildcard (`*@example.com`) matching
    - Return allow/deny decision with the matching rule for auditability
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7_

  - [ ]* 9.2 Write unit tests for `AccessPolicyEngine`
    - Test each precedence level: platform deny overrides all, platform allow grants all projects, project deny overrides project allow, project allow grants specific project, repo-derived allow, default deny
    - Test domain wildcard matching
    - Test that engine is not invoked for `public` or `password` mode (caller responsibility)
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8, 7.9_

- [x] 10. Checkpoint — Ensure all core modules compile and tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 11. Implement Site Builder
  - [x] 11.1 Implement repo config parsers and validators
    - Parse and validate `project.yml` (slug, title, description, publish_enabled, access_mode)
    - Parse and validate `nav.yml` (hierarchical nav items with labels, paths, sections, children)
    - Parse and validate `allowed-list.yml` (list of email/domain patterns)
    - Validate slug in `project.yml` matches the registered slug
    - _Requirements: 10.1, 10.2, 10.3, 10.5, 10.6_

  - [x] 11.2 Implement Markdown page parser
    - Parse Markdown files from `/content` directory
    - Extract and validate frontmatter (required: `title`, `order`; optional: `section`, `hidden`, `template`, `tags`)
    - Render Markdown to HTML
    - _Requirements: 11.1, 11.2, 11.3_

  - [x] 11.3 Implement navigation generator
    - Generate navigation HTML markup from `nav.yml` structure
    - Validate that all pages referenced in `nav.yml` exist in `/content`
    - Exclude pages with `hidden: true` from navigation markup
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 11.4_

  - [x] 11.4 Implement HTML template and full site build
    - Apply the standard page template wrapping rendered Markdown content with navigation
    - Produce the complete artifact set (HTML pages, assets) ready for R2 upload
    - _Requirements: 11.5, 11.6, 12.3_

  - [ ]* 11.5 Write unit tests for Site Builder
    - Test `project.yml` validation (valid config, slug mismatch rejection)
    - Test `nav.yml` parsing and missing page detection
    - Test Markdown rendering with frontmatter extraction
    - Test navigation generation respects `hidden` flag
    - _Requirements: 10.5, 10.6, 11.4, 12.4_

- [ ] 12. Implement Control Plane API Worker
  - [x] 12.1 Set up Control Plane Worker project structure and API key auth middleware
    - Create Cloudflare Worker entry point with routing
    - Implement API key authentication middleware — validate `Authorization` header against Worker secret
    - Reject unauthenticated requests with HTTP 401
    - Never log or expose API keys in responses or operational records
    - _Requirements: 22.1, 22.2, 22.3, 22.4_

  - [x] 12.2 Implement project registration endpoint
    - Accept project registration with slug, repo_url, title, description, access_mode
    - Assign UUID, set status to `awaiting_approval`, enforce slug uniqueness
    - Record `registration` operational event
    - _Requirements: 2.1, 2.2, 2.3, 2.10, 19.1_

  - [x] 12.3 Implement project lifecycle endpoints (approve, disable, delete)
    - Approve: transition `awaiting_approval` → `approved`, record `approval` event
    - Disable: transition to `disabled`, record `disable` event
    - Delete: execute delete transaction — (1) mark disabled, (2) delete R2 artifacts via `StorageProvider.deletePrefix`, (3) remove Cloudflare Access config, (4) delete D1 project record and associated state; log partial failures
    - Record `delete` operational event
    - _Requirements: 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 19.2, 21.1, 21.2, 21.3_

  - [x] 12.4 Implement publish orchestration endpoint
    - Validate project exists and is `approved`
    - Record `publish_start` event
    - Read repo config and content from registered repository
    - Invoke Site Builder to build static site
    - Upload artifacts to R2 under versioned prefix `publishes/<slug>/<publish_id>/`
    - On success: atomically update `active_publish_pointer` in D1, replace repo-derived access entries, reconcile Cloudflare Access if changed, record `publish_success` event
    - On failure: preserve previous pointer, record `publish_failure` event with error context, clean up partial staged artifacts
    - Skip access sync if allowed-list unchanged
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10, 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 13.1, 16.1, 16.2, 16.3, 16.4, 16.5, 16.6, 16.7, 19.3, 19.4_

  - [x] 12.5 Implement admin override CRUD endpoints
    - Create/update/delete admin override entries at platform or project scope
    - Support `allow` and `deny` effects, exact email and domain wildcard subjects
    - Reconcile Cloudflare Access on changes
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 15.2_

  - [ ]* 12.6 Write unit tests for Control Plane API
    - Test API key auth rejects missing/invalid keys
    - Test registration enforces slug uniqueness and sets correct initial status
    - Test lifecycle transitions and delete transaction ordering
    - Test publish orchestration happy path and failure rollback
    - Test admin override CRUD
    - _Requirements: 2.2, 2.4, 2.5, 2.7, 2.9, 3.1, 3.7, 22.3_

- [x] 13. Checkpoint — Ensure Control Plane compiles and tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 14. Implement Delivery Worker
  - [x] 14.1 Set up Delivery Worker project structure and request routing
    - Create Cloudflare Worker entry point bound to `docs.example.com/*`
    - Extract slug from first URL path segment
    - Look up project in D1 by slug
    - Return HTTP 404 for unknown slugs and `disabled` projects (identical responses, no disclosure)
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.7_

  - [x] 14.2 Implement URL resolution and content serving
    - Trailing-slash paths → resolve to `<active_publish_pointer>/<remaining_path>/index.html` in R2
    - No trailing slash, no file extension → HTTP 301 redirect to trailing-slash form
    - Paths with file extensions → serve literal R2 object at `<active_publish_pointer>/<remaining_path>`
    - Set `Cache-Control` headers per platform freshness policy (configurable TTL)
    - _Requirements: 1.8, 1.9, 1.10, 13.2, 13.3, 20.1, 20.2, 20.3_

  - [x] 14.3 Implement public access mode serving
    - For `public` projects: serve content directly without authentication
    - No access policy evaluation for public mode
    - _Requirements: 4.2, 7.9_

  - [x] 14.4 Implement password authentication flow
    - For `password` projects: check for valid session token cookie
    - If no valid session: return login page displaying project title
    - On password submit: verify against stored scrypt hash via `PasswordHasher`
    - On success: issue session token cookie (`Secure; HttpOnly; SameSite=Lax; Path=/<slug>/; Max-Age=<ttl>`) and redirect to requested path
    - On failure: re-render login page with error, do not issue token
    - Never include protected content before successful authentication
    - _Requirements: 4.3, 5.1, 5.2, 5.3, 5.4, 5.8, 6.5_

  - [x] 14.5 Implement session token validation in request flow
    - Validate HMAC signature, check expiry, verify password version matches current D1 value
    - Reject expired, tampered, or version-mismatched tokens → treat as unauthenticated
    - _Requirements: 5.5, 5.6, 5.9, 6.7_

  - [x] 14.6 Implement rate limiting on login endpoint
    - Check rate limit before processing login attempt
    - On threshold exceeded: return HTTP 429 with appropriate retry-after
    - Log each failed login attempt with project slug and request metadata (excluding submitted password)
    - _Requirements: 5.10, 5.11_

  - [ ]* 14.7 Write unit tests for Delivery Worker
    - Test slug extraction and project lookup (found, not found, disabled)
    - Test URL resolution (trailing slash, no trailing slash redirect, file extension)
    - Test public mode serves without auth
    - Test password mode login flow (success, failure, rate limiting)
    - Test session token validation (valid, expired, wrong password version, tampered)
    - Test Cache-Control headers
    - _Requirements: 1.2, 1.3, 1.4, 1.8, 1.9, 1.10, 4.2, 4.3, 5.1, 5.3, 5.4, 5.10_

- [x] 15. Checkpoint — Ensure Delivery Worker compiles and tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 16. Create GitHub Actions workflow definition
  - [x] 16.1 Create the reusable GitHub Actions workflow YAML
    - Define workflow triggered on deployment events (or configurable trigger)
    - Check out repository source
    - Invoke Control Plane publish endpoint with repo identity and authentication credentials (platform-level or project-specific secret)
    - _Requirements: 17.1, 17.2, 17.3, 17.4_

- [ ] 17. Integration wiring and Wrangler configuration
  - [x] 17.1 Create Wrangler configuration for both Workers
    - Configure Delivery Worker with D1 and R2 bindings, Worker secrets for HMAC signing key and session config
    - Configure Control Plane Worker with D1 and R2 bindings, Worker secrets for API key and HMAC signing key
    - Define environment variables for configurable values (session TTL, cache TTL, rate limit threshold/window)
    - _Requirements: 6.3, 20.3, 22.4_

  - [x] 17.2 Wire all components together in Worker entry points
    - Instantiate `D1DataStore`, `R2StorageProvider`, `CloudflareAccessProvider` with Worker bindings
    - Inject dependencies into Control Plane handlers and Delivery Worker handlers
    - Ensure no hanging or orphaned code — all modules integrated
    - _Requirements: 18.1, 18.2, 18.3_

  - [ ]* 17.3 Write integration tests for end-to-end flows
    - Test publish flow: trigger → build → upload → activate → serve new content
    - Test password auth flow: login → session → access → session expiry
    - Test project lifecycle: register → approve → publish → disable → 404
    - Test delete transaction: disable → R2 cleanup → D1 cleanup
    - _Requirements: 3.1, 3.5, 3.6, 5.3, 5.6, 2.5, 2.7, 2.9, 21.1_

- [x] 18. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirement clauses for traceability
- Checkpoints ensure incremental validation at natural boundaries
- All code targets TypeScript on Cloudflare Workers runtime
- The design has no Correctness Properties section, so property-based tests are not included — unit and integration tests cover validation
