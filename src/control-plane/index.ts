/**
 * Control Plane API Worker — admin endpoints for project registration,
 * lifecycle management, publish orchestration, and access override CRUD.
 *
 * All endpoints require API key authentication via the Authorization header.
 * Requirements: 22.1, 22.2, 22.3, 22.4
 */

import { D1DataStore } from '../data-store/d1-data-store';
import { R2StorageProvider } from '../storage/r2-storage-provider';
import { CloudflareAccessProvider } from '../access/cloudflare-access-provider';
import { PasswordHasher } from '../auth/password-hasher';
import { parseProjectConfig, parseNavConfig, parseAllowedListConfig, validateSlugMatch } from '../site-builder/config-parser';
import { buildSite } from '../site-builder/site-builder';
import { validateToken } from '../auth/token-validator';
import { signNrdocsToken } from '../auth/jwt-utils';
import type { NrdocsTokenPayload } from '../auth/jwt-utils';
import type { OperationalEvent, AccessMode, AccessPolicyEntry, RepoPublishToken, BootstrapToken } from '../types';

/** Cloudflare Worker environment bindings. */
export interface Env {
  DB: D1Database;
  BUCKET: R2Bucket;
  API_KEY: string;
  HMAC_SIGNING_KEY: string;
  TOKEN_SIGNING_KEY: string;
  ISSUER_URL?: string;
}

// ── Helpers ──────────────────────────────────────────────────────────

/** Standard JSON error response. */
function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Standard JSON response. */
function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Stub handler for routes not yet implemented. */
/** Build an OperationalEvent with a fresh UUID and current timestamp. */
export function buildEvent(
  projectId: string | null,
  eventType: OperationalEvent['event_type'],
  detail?: string | null,
): OperationalEvent {
  return {
    id: crypto.randomUUID(),
    project_id: projectId,
    event_type: eventType,
    detail: detail ?? null,
    created_at: new Date().toISOString(),
  };
}

/** Extract the repo identity from the X-Repo-Identity request header. */
export function extractRepoIdentity(request: Request): string | null {
  return request.headers.get('X-Repo-Identity') ?? null;
}

/** Build structured audit context for publish auth decisions (never includes raw token string). */
export function buildAuditContext(
  tokenRecord: RepoPublishToken,
  requestedProjectId: string,
  request: Request,
  result: 'allow' | 'deny',
  denialReason?: string,
): Record<string, unknown> {
  return {
    event: 'publish_auth',
    token_jti: tokenRecord.jti,
    token_typ: 'repo_publish',
    token_org_id: tokenRecord.org_id,
    token_project_id: tokenRecord.project_id,
    token_repo_identity: tokenRecord.repo_identity,
    requested_project_id: requestedProjectId,
    request_repo_identity: extractRepoIdentity(request) ?? null,
    result,
    denial_reason: denialReason ?? null,
  };
}

// ── Handlers ─────────────────────────────────────────────────────────

const VALID_ACCESS_MODES: AccessMode[] = ['public', 'password'];

/**
 * POST /bootstrap/init — Validate a bootstrap token and return org metadata.
 *
 * Validates the bootstrap JWT, verifies the org is active, and returns
 * org metadata with remaining quota. No project creation or token minting.
 *
 * This endpoint uses bootstrap token auth (NOT API key auth).
 *
 * Requirements: 14.1, 14.2, 14.3, 14.4, 2.3, 2.4
 */
export async function handleBootstrapInit(request: Request, env: Env): Promise<Response> {
  // Extract Bearer token
  const authHeader = request.headers.get('Authorization');
  if (!authHeader) return jsonError('Missing or invalid bootstrap token', 401);
  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return jsonError('Missing or invalid bootstrap token', 401);
  }
  const tokenStr = parts[1];

  // Validate token
  const dataStore = new D1DataStore(env.DB);
  const expectedIssuer = env.ISSUER_URL ?? new URL(request.url).origin;
  const result = await validateToken(tokenStr, env.TOKEN_SIGNING_KEY, expectedIssuer, dataStore, 'org_bootstrap');
  if (!result.valid) return jsonError(result.reason, result.statusCode);

  const bootstrapToken = result.dbRecord as BootstrapToken;

  // Verify organization
  const org = await dataStore.getOrganizationById(bootstrapToken.org_id);
  if (!org || org.status !== 'active') return jsonError('Organization is disabled', 403);

  // Return validation response
  return jsonResponse({
    org_name: org.name,
    org_slug: org.slug,
    remaining_quota: bootstrapToken.max_repos - bootstrapToken.repos_issued_count,
    expires_at: bootstrapToken.expires_at,
  }, 200);
}

/**
 * POST /bootstrap/onboard — Create a project and mint a repo publish token.
 *
 * Validates the bootstrap JWT, verifies the org is active, checks quota,
 * creates a project, approves it, mints a repo publish token, increments
 * bootstrap token usage, and returns the project ID and signed token.
 *
 * This endpoint uses bootstrap token auth (NOT API key auth).
 *
 * Requirements: 9.1, 9.3, 9.4, 9.7, 9.8, 5.1–5.13, 6.1–6.8
 */
export async function handleBootstrapOnboard(request: Request, env: Env): Promise<Response> {
  // 1. Extract Bearer token
  const authHeader = request.headers.get('Authorization');
  if (!authHeader) return jsonError('Missing or invalid bootstrap token', 401);
  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return jsonError('Missing or invalid bootstrap token', 401);
  }
  const tokenStr = parts[1];

  // 2. Validate token
  const dataStore = new D1DataStore(env.DB);
  const expectedIssuer = env.ISSUER_URL ?? new URL(request.url).origin;
  const result = await validateToken(tokenStr, env.TOKEN_SIGNING_KEY, expectedIssuer, dataStore, 'org_bootstrap');
  if (!result.valid) return jsonError(result.reason, result.statusCode);

  const bootstrapToken = result.dbRecord as BootstrapToken;
  const orgId = bootstrapToken.org_id;

  // 3. Verify organization
  const org = await dataStore.getOrganizationById(orgId);
  if (!org || org.status !== 'active') return jsonError('Organization is disabled', 403);

  // 4. Check quota
  if (bootstrapToken.repos_issued_count >= bootstrapToken.max_repos) {
    return jsonError('Bootstrap token repo limit reached', 403);
  }

  // 5. Parse and validate request body
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; }
  catch { return jsonError('Invalid JSON body', 400); }

  const { slug, title, description, repo_identity } = body;
  if (!slug || typeof slug !== 'string') return jsonError('Missing or invalid field: slug', 400);
  if (!title || typeof title !== 'string') return jsonError('Missing or invalid field: title', 400);
  if (description !== undefined && typeof description !== 'string') {
    return jsonError('Missing or invalid field: description', 400);
  }
  if (!repo_identity || typeof repo_identity !== 'string') {
    return jsonError('Missing or invalid field: repo_identity', 400);
  }

  // 6. Create project (access_mode from control-plane default)
  const defaultAccessMode: AccessMode = 'public';
  let project;
  try {
    project = await dataStore.createProject({
      slug: slug as string,
      repo_url: '',
      title: title as string,
      description: (description as string) ?? '',
      access_mode: defaultAccessMode,
      org_id: orgId,
      repo_identity: repo_identity as string,
    });
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes('already exists')) {
      return jsonError(`A project with slug ${slug} already exists`, 409);
    }
    if (err instanceof Error && err.message.includes('Invalid repo_identity format')) {
      return jsonError(err.message, 400);
    }
    throw err;
  }

  // 7. Immediately approve project
  await dataStore.updateProjectStatus(project.id, 'approved');

  // 8. Record operational event
  await dataStore.recordEvent(
    buildEvent(project.id, 'registration', JSON.stringify({
      slug: project.slug,
      source: 'bootstrap_onboard',
      bootstrap_jti: bootstrapToken.jti,
    })),
  );

  // 9. Mint repo publish token
  const repoPublishJti = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);
  const oneYearFromNow = now + 365 * 24 * 60 * 60;
  const iss = env.ISSUER_URL ?? new URL(request.url).origin;

  const repoPublishPayload: NrdocsTokenPayload = {
    v: 1, typ: 'repo_publish', iss, exp: oneYearFromNow, jti: repoPublishJti,
  };
  const repoPublishTokenJwt = await signNrdocsToken(repoPublishPayload, env.TOKEN_SIGNING_KEY);

  const nowIso = new Date().toISOString();
  const expiresAtIso = new Date(oneYearFromNow * 1000).toISOString();

  await dataStore.createRepoPublishToken({
    id: crypto.randomUUID(),
    jti: repoPublishJti,
    org_id: orgId,
    project_id: project.id,
    repo_identity: repo_identity as string,
    status: 'active',
    created_from_bootstrap_jti: bootstrapToken.jti,
    created_at: nowIso,
    expires_at: expiresAtIso,
    last_used_at: null,
  });

  // 10. Increment bootstrap token usage
  await dataStore.incrementBootstrapTokenUsage(bootstrapToken.jti);

  // 11. Return success
  return jsonResponse({ project_id: project.id, repo_publish_token: repoPublishTokenJwt }, 201);
}

/**
 * POST /projects — Register a new project.
 *
 * Expects JSON body: { slug, repo_url, title, description, access_mode }
 * Returns 201 with the created project, or 409 on slug conflict.
 *
 * Requirements: 2.1, 2.2, 2.3, 2.10, 19.1
 */
async function handleCreateProject(request: Request, env: Env): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return jsonError('Invalid JSON body', 400);
  }

  const { slug, repo_url, title, description, access_mode } = body;

  // Validate required fields
  if (!slug || typeof slug !== 'string') {
    return jsonError('Missing or invalid field: slug', 400);
  }
  if (!repo_url || typeof repo_url !== 'string') {
    return jsonError('Missing or invalid field: repo_url', 400);
  }
  if (!title || typeof title !== 'string') {
    return jsonError('Missing or invalid field: title', 400);
  }
  if (description !== undefined && typeof description !== 'string') {
    return jsonError('Invalid field: description', 400);
  }
  if (!access_mode || !VALID_ACCESS_MODES.includes(access_mode as AccessMode)) {
    return jsonError('Missing or invalid field: access_mode (must be "public" or "password")', 400);
  }

  // Accept optional repo_identity from request body
  const repo_identity = body.repo_identity;
  if (repo_identity !== undefined && typeof repo_identity !== 'string') {
    return jsonError('Invalid field: repo_identity', 400);
  }

  const dataStore = new D1DataStore(env.DB);

  // Resolve default org for org_id assignment (Requirement 8.1)
  let orgId: string;
  try {
    const defaultOrg = await dataStore.getDefaultOrganization();
    orgId = defaultOrg.id;
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes('Default organization not found')) {
      return jsonError('Internal server error', 500);
    }
    throw err;
  }

  try {
    const project = await dataStore.createProject({
      slug: slug as string,
      repo_url: repo_url as string,
      title: title as string,
      description: (description as string) ?? '',
      access_mode: access_mode as AccessMode,
      org_id: orgId,
      repo_identity: repo_identity as string | undefined,
    });

    // Record registration operational event (Requirement 19.1)
    await dataStore.recordEvent(
      buildEvent(project.id, 'registration', JSON.stringify({ slug: project.slug })),
    );

    return jsonResponse(project as unknown as Record<string, unknown>, 201);
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes('already exists')) {
      return jsonError(err.message, 409);
    }
    if (err instanceof Error && err.message.includes('Invalid repo_identity format')) {
      return jsonError(err.message, 400);
    }
    throw err;
  }
}

/**
 * POST /projects/:id/approve — Approve a project.
 *
 * Transitions a project from `awaiting_approval` to `approved`.
 * Records an `approval` operational event.
 *
 * Requirements: 2.4, 2.5, 19.2
 */
async function handleApproveProject(projectId: string, env: Env): Promise<Response> {
  const dataStore = new D1DataStore(env.DB);
  const project = await dataStore.getProjectById(projectId);

  if (!project) {
    return jsonError('Project not found', 404);
  }

  if (project.status !== 'awaiting_approval') {
    return jsonError(
      `Cannot approve project with status '${project.status}'; must be 'awaiting_approval'`,
      409,
    );
  }

  await dataStore.updateProjectStatus(projectId, 'approved');
  await dataStore.recordEvent(
    buildEvent(projectId, 'approval', JSON.stringify({ slug: project.slug })),
  );

  return jsonResponse({ message: 'Project approved', id: projectId });
}

/**
 * POST /projects/:id/disable — Disable a project.
 *
 * Transitions a project to `disabled` status.
 * Records a `disable` operational event.
 *
 * Requirements: 2.7, 2.8, 19.2
 */
async function handleDisableProject(projectId: string, env: Env): Promise<Response> {
  const dataStore = new D1DataStore(env.DB);
  const project = await dataStore.getProjectById(projectId);

  if (!project) {
    return jsonError('Project not found', 404);
  }

  await dataStore.updateProjectStatus(projectId, 'disabled');
  await dataStore.recordEvent(
    buildEvent(projectId, 'disable', JSON.stringify({ slug: project.slug })),
  );

  return jsonResponse({ message: 'Project disabled', id: projectId });
}

/**
 * DELETE /projects/:id — Delete a project.
 *
 * Executes the delete transaction in order:
 *   1. Mark project as disabled (immediate 404 for consumers)
 *   2. Delete R2 artifacts via StorageProvider.deletePrefix
 *   3. Remove Cloudflare Access config
 *   4. Delete D1 project record and associated state
 *
 * If R2 cleanup fails, the error is logged but deletion continues.
 * Records a `delete` operational event before final D1 deletion.
 *
 * Requirements: 2.9, 19.2, 21.1, 21.2, 21.3
 */
async function handleDeleteProject(projectId: string, env: Env): Promise<Response> {
  const dataStore = new D1DataStore(env.DB);
  const project = await dataStore.getProjectById(projectId);

  if (!project) {
    return jsonError('Project not found', 404);
  }

  // Step 1: Mark disabled so the project returns 404 immediately
  await dataStore.updateProjectStatus(projectId, 'disabled');

  // Step 2: Delete R2 artifacts — log and continue on failure (Requirement 21.2)
  const storage = new R2StorageProvider(env.BUCKET);
  let r2CleanupFailed = false;
  try {
    await storage.deletePrefix(`publishes/${project.slug}/`);
  } catch (err: unknown) {
    r2CleanupFailed = true;
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      `Partial deletion: R2 cleanup failed for project ${projectId} (slug: ${project.slug}): ${message}`,
    );
  }

  // Step 3: Remove Cloudflare Access config (Requirement 21.3)
  const accessProvider = new CloudflareAccessProvider();
  try {
    await accessProvider.removeProjectAccess(project.slug);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      `Partial deletion: Cloudflare Access cleanup failed for project ${projectId} (slug: ${project.slug}): ${message}`,
    );
  }

  // Record delete event before final D1 deletion (Requirement 19.2)
  const detail: Record<string, unknown> = { slug: project.slug };
  if (r2CleanupFailed) {
    detail.r2_cleanup = 'failed — manual cleanup required';
  }
  await dataStore.recordEvent(
    buildEvent(projectId, 'delete', JSON.stringify(detail)),
  );

  // Step 4: Delete D1 project record and associated state
  await dataStore.deleteProject(projectId);

  return jsonResponse({
    message: r2CleanupFailed
      ? 'Project deleted (R2 cleanup failed — manual cleanup required)'
      : 'Project deleted',
    id: projectId,
  });
}

/**
 * POST /projects/:id/publish — Publish a project.
 *
 * Phase 1: The GitHub Actions workflow sends repo content directly in the
 * request body. The Control Plane is the sole build authority.
 *
 * Expects JSON body: { repo_content: { project_yml, nav_yml, allowed_list_yml?, pages } }
 *
 * Requirements: 3.1-3.10, 8.1-8.7, 13.1, 16.1-16.7, 19.3, 19.4
 */
async function handlePublishProject(projectId: string, request: Request, env: Env): Promise<Response> {
  const dataStore = new D1DataStore(env.DB);

  // ── Phase 1: Authentication & Authorization ──────────────────────

  // 1a. Extract bearer token
  const authHeader = request.headers.get('Authorization');
  if (!authHeader) {
    return jsonError('Missing authentication credentials', 401);
  }
  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return jsonError('Malformed authentication header', 401);
  }
  const tokenStr = parts[1];

  // 1b. Validate token (structure, signature, claims, DB lookup, status)
  const expectedIssuer = env.ISSUER_URL ?? new URL(request.url).origin;
  const result = await validateToken(
    tokenStr, env.TOKEN_SIGNING_KEY, expectedIssuer, dataStore, 'repo_publish',
  );
  if (!result.valid) {
    // Auth failure — log via console.error, do NOT write to operational_events
    console.error(JSON.stringify({
      event: 'publish_auth_denied',
      reason: result.reason,
      requested_project_id: projectId,
    }));
    return jsonError(result.reason, result.statusCode);
  }

  const tokenRecord = result.dbRecord as RepoPublishToken;

  // 1c. Project binding enforcement
  if (tokenRecord.project_id !== projectId) {
    const auditCtx = buildAuditContext(tokenRecord, projectId, request, 'deny', 'project_binding_mismatch');
    console.error(JSON.stringify(auditCtx));
    return jsonError('Token not authorized for this project', 403);
  }

  // 1d. Load project and validate existence
  const project = await dataStore.getProjectById(projectId);
  if (!project) {
    return jsonError('Project not found', 404);
  }

  // 1e. Org cross-check
  if (project.org_id !== tokenRecord.org_id) {
    const auditCtx = buildAuditContext(tokenRecord, projectId, request, 'deny', 'org_mismatch');
    console.error(JSON.stringify(auditCtx));
    return jsonError('Token not authorized for this project', 403);
  }

  // 1f. Project status check
  if (project.status !== 'approved') {
    return jsonError(
      `Cannot publish project with status '${project.status}'; must be 'approved'`,
      409,
    );
  }

  // 1g. Repo identity binding (best-effort Phase 1)
  const requestRepoIdentity = extractRepoIdentity(request);
  if (
    requestRepoIdentity &&
    tokenRecord.repo_identity &&
    requestRepoIdentity !== tokenRecord.repo_identity
  ) {
    const auditCtx = buildAuditContext(tokenRecord, projectId, request, 'deny', 'repo_identity_mismatch');
    console.error(JSON.stringify(auditCtx));
    return jsonError('Token not authorized for this repository', 403);
  }

  // ── Phase 2: Publish Execution (field-level scope) ─────────────────
  // Requirements: 8.1-8.8, 9.3-9.5, 10.1-10.2

  const storage = new R2StorageProvider(env.BUCKET);
  const accessProvider = new CloudflareAccessProvider();

  // Build audit context for operational events (Requirement 9.3)
  const auditCtx = buildAuditContext(tokenRecord, projectId, request, 'allow');

  // Parse request body
  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return jsonError('Invalid JSON body', 400);
  }

  const repoContent = body.repo_content as Record<string, unknown> | undefined;
  if (!repoContent || typeof repoContent !== 'object') {
    return jsonError('Missing or invalid field: repo_content', 400);
  }

  const { project_yml, nav_yml, allowed_list_yml, pages } = repoContent as {
    project_yml?: string;
    nav_yml?: string;
    allowed_list_yml?: string;
    pages?: Record<string, string>;
  };

  if (!project_yml || typeof project_yml !== 'string') {
    return jsonError('Missing or invalid field: repo_content.project_yml', 400);
  }
  if (!nav_yml || typeof nav_yml !== 'string') {
    return jsonError('Missing or invalid field: repo_content.nav_yml', 400);
  }
  if (!pages || typeof pages !== 'object') {
    return jsonError('Missing or invalid field: repo_content.pages', 400);
  }

  // Record publish_start event with audit context (Requirements 9.3, 9.4)
  await dataStore.recordEvent(
    buildEvent(projectId, 'publish_start', JSON.stringify({
      slug: project.slug,
      ...auditCtx,
    })),
  );

  const publishId = crypto.randomUUID();
  const publishPrefix = `publishes/${project.slug}/${publishId}/`;
  const previousPointer = project.active_publish_pointer;

  try {
    // Parse configs (Requirements 10.1, 10.2, 10.3, 10.5, 10.6)
    const projectConfig = parseProjectConfig(project_yml);
    const navConfig = parseNavConfig(nav_yml);
    const allowedListConfig = allowed_list_yml
      ? parseAllowedListConfig(allowed_list_yml)
      : { allow: [] };

    // Validate slug match (Requirement 8.2) — slug is validated for consistency, not mutated
    validateSlugMatch(projectConfig, project.slug);

    // Use title and description as presentation metadata (Requirement 8.2)
    // projectConfig.title and projectConfig.description are used by buildSite for rendering

    // IGNORE access_mode from project_yml (Requirement 8.3, 8.6) —
    // The project's registered access_mode is preserved unchanged.
    // projectConfig.access_mode is NOT applied to the project record.

    // Read publish_enabled for validation (Requirement 8.4) —
    // does not change the project's security posture
    void projectConfig.publish_enabled;

    // Any other fields in project_yml beyond slug, title, description,
    // publish_enabled, access_mode are ignored (Requirement 8.8)

    // Build site (Requirements 11.1-11.6, 12.1-12.4)
    const pagesMap = new Map(Object.entries(pages));
    const artifacts = buildSite(projectConfig, navConfig, pagesMap, project.slug);

    // Upload artifacts to R2 under versioned prefix (Requirements 13.1, 16.1)
    for (const artifact of artifacts) {
      await storage.put(
        `${publishPrefix}${artifact.path}`,
        artifact.content,
        artifact.contentType,
      );
    }

    // Success path:

    // a. Atomically update active_publish_pointer (Requirement 16.2)
    await dataStore.updateActivePublishPointer(projectId, publishPrefix);

    // b. Build AccessPolicyEntry objects from allowed-list and replace repo-derived entries
    //    (Requirements 8.5, 8.6) — admin overrides are preserved
    const newRepoDerivedEntries: AccessPolicyEntry[] = allowedListConfig.allow.map(
      (subject): AccessPolicyEntry => {
        const isDomain = subject.startsWith('*@');
        return {
          id: crypto.randomUUID(),
          scope_type: 'project',
          scope_value: projectId,
          subject_type: isDomain ? 'domain' : 'email',
          subject_value: subject,
          effect: 'allow',
          source: 'repo',
          created_at: new Date().toISOString(),
        };
      },
    );

    // Get current repo-derived entries to check if access changed (Requirement 3.10)
    const currentPolicies = await dataStore.getAccessPolicies(projectId);
    const currentRepoDerived = currentPolicies
      .filter((e) => e.source === 'repo')
      .map((e) => `${e.subject_type}:${e.subject_value}`)
      .sort();
    const newRepoDerivedKeys = newRepoDerivedEntries
      .map((e) => `${e.subject_type}:${e.subject_value}`)
      .sort();
    const accessChanged =
      currentRepoDerived.length !== newRepoDerivedKeys.length ||
      currentRepoDerived.some((v, i) => v !== newRepoDerivedKeys[i]);

    if (accessChanged) {
      // Replace repo-derived entries (Requirement 8.5, 8.6, 8.7)
      await dataStore.replaceRepoDerivedEntries(projectId, newRepoDerivedEntries);

      // c. Reconcile Cloudflare Access (Requirement 15.3)
      const allPolicies = await dataStore.getAccessPolicies(projectId);
      await accessProvider.reconcileProjectAccess(project.slug, allPolicies);
    }

    // d. Update last_used_at ONLY on successful publish completion (Requirements 10.1, 10.2)
    await dataStore.updateRepoPublishTokenLastUsedAt(tokenRecord.jti);

    // e. Record publish_success event with audit context (Requirements 9.3, 9.4)
    await dataStore.recordEvent(
      buildEvent(
        projectId,
        'publish_success',
        JSON.stringify({
          slug: project.slug,
          publish_id: publishId,
          prefix: publishPrefix,
          ...auditCtx,
        }),
      ),
    );

    // f. Clean up previous publish prefix if it exists (Requirement 16.7)
    if (previousPointer && previousPointer !== publishPrefix) {
      try {
        await storage.deletePrefix(previousPointer);
      } catch (err: unknown) {
        // Log but don't fail the publish for cleanup errors
        const message = err instanceof Error ? err.message : String(err);
        console.error(
          `Failed to clean up previous publish prefix "${previousPointer}" for project ${projectId}: ${message}`,
        );
      }
    }

    return jsonResponse({
      message: 'Publish successful',
      id: projectId,
      publish_id: publishId,
      prefix: publishPrefix,
    });
  } catch (err: unknown) {
    // Failure path: do NOT update last_used_at (Requirement 10.2)
    const errorMessage = err instanceof Error ? err.message : String(err);

    // a. Record publish_failure event with error context and audit context (Requirement 9.5)
    await dataStore.recordEvent(
      buildEvent(
        projectId,
        'publish_failure',
        JSON.stringify({
          slug: project.slug,
          publish_id: publishId,
          error: errorMessage,
          ...auditCtx,
        }),
      ),
    );

    // b. Clean up partial staged artifacts (Requirement 16.6, 16.7)
    try {
      await storage.deletePrefix(publishPrefix);
    } catch (cleanupErr: unknown) {
      const cleanupMessage = cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr);
      console.error(
        `Failed to clean up partial publish artifacts at "${publishPrefix}" for project ${projectId}: ${cleanupMessage}`,
      );
    }

    // c. Return error response (previous pointer is preserved — never updated on failure)
    return jsonError(`Publish failed: ${errorMessage}`, 500);
  }
}

// ── Admin Override Handlers ──────────────────────────────────────────

const VALID_SCOPE_TYPES = ['platform', 'project'] as const;
const VALID_EFFECTS = ['allow', 'deny'] as const;
const VALID_SUBJECT_TYPES = ['email', 'domain'] as const;

/**
 * Validate the common fields for an admin override entry.
 * Returns a JSON error Response if validation fails, or null if valid.
 */
function validateOverrideBody(
  body: Record<string, unknown>,
): Response | null {
  const { scope_type, scope_value, subject_type, subject_value, effect } = body;

  if (!scope_type || !VALID_SCOPE_TYPES.includes(scope_type as typeof VALID_SCOPE_TYPES[number])) {
    return jsonError('Missing or invalid field: scope_type (must be "platform" or "project")', 400);
  }
  if (!scope_value || typeof scope_value !== 'string') {
    return jsonError('Missing or invalid field: scope_value', 400);
  }
  if (!subject_type || !VALID_SUBJECT_TYPES.includes(subject_type as typeof VALID_SUBJECT_TYPES[number])) {
    return jsonError('Missing or invalid field: subject_type (must be "email" or "domain")', 400);
  }
  if (!subject_value || typeof subject_value !== 'string') {
    return jsonError('Missing or invalid field: subject_value', 400);
  }
  if (!effect || !VALID_EFFECTS.includes(effect as typeof VALID_EFFECTS[number])) {
    return jsonError('Missing or invalid field: effect (must be "allow" or "deny")', 400);
  }

  return null;
}

/**
 * POST /admin/overrides — Create a new admin override.
 *
 * Expects JSON body: { scope_type, scope_value, subject_type, subject_value, effect }
 * Generates a UUID, sets source='admin' and created_at, persists via upsertAdminOverride,
 * and reconciles Cloudflare Access for project-scoped entries.
 *
 * Requirements: 9.1, 9.2, 9.3, 9.4, 15.2
 */
async function handleCreateAdminOverride(request: Request, env: Env): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return jsonError('Invalid JSON body', 400);
  }

  const validationError = validateOverrideBody(body);
  if (validationError) return validationError;

  const entry: AccessPolicyEntry = {
    id: crypto.randomUUID(),
    scope_type: body.scope_type as 'platform' | 'project',
    scope_value: body.scope_value as string,
    subject_type: body.subject_type as 'email' | 'domain',
    subject_value: body.subject_value as string,
    effect: body.effect as 'allow' | 'deny',
    source: 'admin',
    created_at: new Date().toISOString(),
  };

  const dataStore = new D1DataStore(env.DB);
  await dataStore.upsertAdminOverride(entry);

  // Reconcile Cloudflare Access for project-scoped overrides (Requirement 15.2)
  if (entry.scope_type === 'project') {
    const project = await dataStore.getProjectById(entry.scope_value);
    if (project) {
      const accessProvider = new CloudflareAccessProvider();
      const allPolicies = await dataStore.getAccessPolicies(entry.scope_value);
      await accessProvider.reconcileProjectAccess(project.slug, allPolicies);
    }
  }

  return jsonResponse({ message: 'Admin override created', id: entry.id }, 201);
}

/**
 * PUT /admin/overrides/:id — Update an existing admin override.
 *
 * Expects JSON body with fields to update (same validation as create).
 * Persists via upsertAdminOverride with the existing ID and reconciles Cloudflare Access.
 *
 * Requirements: 9.1, 9.2, 9.3, 9.4, 15.2
 */
async function handleUpdateAdminOverride(overrideId: string, request: Request, env: Env): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return jsonError('Invalid JSON body', 400);
  }

  const validationError = validateOverrideBody(body);
  if (validationError) return validationError;

  const entry: AccessPolicyEntry = {
    id: overrideId,
    scope_type: body.scope_type as 'platform' | 'project',
    scope_value: body.scope_value as string,
    subject_type: body.subject_type as 'email' | 'domain',
    subject_value: body.subject_value as string,
    effect: body.effect as 'allow' | 'deny',
    source: 'admin',
    created_at: new Date().toISOString(),
  };

  const dataStore = new D1DataStore(env.DB);
  await dataStore.upsertAdminOverride(entry);

  // Reconcile Cloudflare Access for project-scoped overrides (Requirement 15.2)
  if (entry.scope_type === 'project') {
    const project = await dataStore.getProjectById(entry.scope_value);
    if (project) {
      const accessProvider = new CloudflareAccessProvider();
      const allPolicies = await dataStore.getAccessPolicies(entry.scope_value);
      await accessProvider.reconcileProjectAccess(project.slug, allPolicies);
    }
  }

  return jsonResponse({ message: 'Admin override updated', id: overrideId });
}

/**
 * DELETE /admin/overrides/:id — Delete an admin override.
 *
 * Removes the entry via deleteAdminOverride.
 *
 * Requirements: 9.1, 9.4
 */
async function handleDeleteAdminOverride(overrideId: string, env: Env): Promise<Response> {
  const dataStore = new D1DataStore(env.DB);
  await dataStore.deleteAdminOverride(overrideId);

  return jsonResponse({ message: 'Admin override deleted', id: overrideId });
}

/**
 * GET /projects/:id — Get project details.
 *
 * Returns the full project record.
 */
async function handleGetProject(projectId: string, env: Env): Promise<Response> {
  const dataStore = new D1DataStore(env.DB);
  const project = await dataStore.getProjectById(projectId);

  if (!project) {
    return jsonError('Project not found', 404);
  }

  return jsonResponse(project as unknown as Record<string, unknown>);
}

/**
 * POST /projects/:id/password — Set or update the project password.
 *
 * Expects JSON body: { password: "plaintext-password" }
 * Hashes the password and stores it in D1. Increments password_version,
 * which invalidates all existing session tokens.
 *
 * Only applicable to projects with access_mode 'password'.
 */
async function handleSetPassword(projectId: string, request: Request, env: Env): Promise<Response> {
  const dataStore = new D1DataStore(env.DB);
  const project = await dataStore.getProjectById(projectId);

  if (!project) {
    return jsonError('Project not found', 404);
  }

  if (project.access_mode !== 'password') {
    return jsonError('Cannot set password on a project with access_mode "public"', 400);
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return jsonError('Invalid JSON body', 400);
  }

  const { password } = body;
  if (!password || typeof password !== 'string' || password.length === 0) {
    return jsonError('Missing or invalid field: password', 400);
  }

  const hash = await PasswordHasher.hash(password);
  await dataStore.setPasswordHash(projectId, hash);

  return jsonResponse({ message: 'Password updated', id: projectId });
}

// ── Auth middleware ──────────────────────────────────────────────────

/**
 * Validate the Authorization header against the stored API key.
 * Expects `Authorization: Bearer <key>`.
 * Returns null when auth succeeds, or a 401 Response to send back.
 *
 * Requirements: 22.2, 22.3, 22.4
 */
function authenticate(request: Request, env: Env): Response | null {
  const header = request.headers.get('Authorization');
  if (!header) {
    return jsonError('Missing authentication credentials', 401);
  }

  // Expect "Bearer <key>" format
  const parts = header.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return jsonError('Invalid authentication credentials', 401);
  }

  const providedKey = parts[1];

  // Constant-time comparison to mitigate timing attacks.
  // Both strings are encoded to equal-length buffers for comparison.
  if (!timingSafeEqual(providedKey, env.API_KEY)) {
    return jsonError('Invalid authentication credentials', 401);
  }

  return null; // auth passed
}

/**
 * Constant-time string comparison using byte-level XOR.
 * Prevents timing side-channels when comparing API keys.
 */
function timingSafeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const aBuf = encoder.encode(a);
  const bBuf = encoder.encode(b);

  if (aBuf.byteLength !== bBuf.byteLength) {
    // Still do a dummy comparison to avoid leaking length via timing.
    let _diff = 1;
    for (let i = 0; i < aBuf.byteLength; i++) {
      _diff |= aBuf[i] ^ (bBuf[i % bBuf.byteLength] ?? 0);
    }
    return false;
  }

  let diff = 0;
  for (let i = 0; i < aBuf.byteLength; i++) {
    diff |= aBuf[i] ^ bBuf[i];
  }
  return diff === 0;
}

// ── Router ───────────────────────────────────────────────────────────

/**
 * Simple path-based router. Matches method + pathname pattern.
 * Supports `:id` path parameters.
 */
function route(request: Request, env: Env): Response | Promise<Response> {
  const url = new URL(request.url);
  const method = request.method;
  const path = url.pathname;

  // Bootstrap routes (use their own JWT-based auth, not API key auth)
  if (method === 'POST' && path === '/bootstrap/init') {
    return handleBootstrapInit(request, env);
  }
  if (method === 'POST' && path === '/bootstrap/onboard') {
    return handleBootstrapOnboard(request, env);
  }

  // Project routes
  if (method === 'POST' && path === '/projects') {
    return handleCreateProject(request, env);
  }

  // Match /projects/:id/approve
  const approveMatch = path.match(/^\/projects\/([^/]+)\/approve$/);
  if (method === 'POST' && approveMatch) {
    return handleApproveProject(approveMatch[1], env);
  }

  // Match /projects/:id/disable
  const disableMatch = path.match(/^\/projects\/([^/]+)\/disable$/);
  if (method === 'POST' && disableMatch) {
    return handleDisableProject(disableMatch[1], env);
  }

  // Match /projects/:id (GET)
  const getMatch = path.match(/^\/projects\/([^/]+)$/);
  if (method === 'GET' && getMatch) {
    return handleGetProject(getMatch[1], env);
  }

  // Match /projects/:id (DELETE)
  const deleteMatch = path.match(/^\/projects\/([^/]+)$/);
  if (method === 'DELETE' && deleteMatch) {
    return handleDeleteProject(deleteMatch[1], env);
  }

  // Match /projects/:id/publish
  const publishMatch = path.match(/^\/projects\/([^/]+)\/publish$/);
  if (method === 'POST' && publishMatch) {
    return handlePublishProject(publishMatch[1], request, env);
  }

  // Match /projects/:id/password
  const passwordMatch = path.match(/^\/projects\/([^/]+)\/password$/);
  if (method === 'POST' && passwordMatch) {
    return handleSetPassword(passwordMatch[1], request, env);
  }

  // Admin override routes
  if (method === 'POST' && path === '/admin/overrides') {
    return handleCreateAdminOverride(request, env);
  }

  // Match /admin/overrides/:id (PUT)
  const updateOverrideMatch = path.match(/^\/admin\/overrides\/([^/]+)$/);
  if (method === 'PUT' && updateOverrideMatch) {
    return handleUpdateAdminOverride(updateOverrideMatch[1], request, env);
  }

  // Match /admin/overrides/:id (DELETE)
  const deleteOverrideMatch = path.match(/^\/admin\/overrides\/([^/]+)$/);
  if (method === 'DELETE' && deleteOverrideMatch) {
    return handleDeleteAdminOverride(deleteOverrideMatch[1], env);
  }

  return jsonError('Not found', 404);
}

// ── Worker entry point ───────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Bootstrap endpoint uses its own JWT-based auth, skip API key auth
    // Publish endpoint uses repo-publish-token bearer auth, skip API key auth
    const url = new URL(request.url);
    const isPublishRoute = request.method === 'POST' &&
      /^\/projects\/[^/]+\/publish$/.test(url.pathname);
    const isBootstrapRoute = url.pathname === '/bootstrap/init' ||
      url.pathname === '/bootstrap/onboard';
    if (!isBootstrapRoute && !isPublishRoute) {
      const authResult = authenticate(request, env);
      if (authResult) {
        return authResult;
      }
    }

    return route(request, env);
  },
} satisfies ExportedHandler<Env>;
