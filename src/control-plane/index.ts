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
import type { OperationalEvent, AccessMode, AccessPolicyEntry } from '../types';

/** Cloudflare Worker environment bindings. */
export interface Env {
  DB: D1Database;
  BUCKET: R2Bucket;
  API_KEY: string;
  HMAC_SIGNING_KEY: string;
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

// ── Handlers ─────────────────────────────────────────────────────────

const VALID_ACCESS_MODES: AccessMode[] = ['public', 'password'];

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

  const dataStore = new D1DataStore(env.DB);

  try {
    const project = await dataStore.createProject({
      slug: slug as string,
      repo_url: repo_url as string,
      title: title as string,
      description: (description as string) ?? '',
      access_mode: access_mode as AccessMode,
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
  const storage = new R2StorageProvider(env.BUCKET);
  const accessProvider = new CloudflareAccessProvider();

  // Look up project and validate status
  const project = await dataStore.getProjectById(projectId);
  if (!project) {
    return jsonError('Project not found', 404);
  }
  if (project.status !== 'approved') {
    return jsonError(
      `Cannot publish project with status '${project.status}'; must be 'approved'`,
      409,
    );
  }

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

  // Record publish_start event (Requirement 19.3)
  await dataStore.recordEvent(
    buildEvent(projectId, 'publish_start', JSON.stringify({ slug: project.slug })),
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

    // Validate slug match (Requirement 10.5)
    validateSlugMatch(projectConfig, project.slug);

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
    //    (Requirements 8.1-8.7)
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

    // d. Record publish_success event (Requirement 19.3)
    await dataStore.recordEvent(
      buildEvent(
        projectId,
        'publish_success',
        JSON.stringify({ slug: project.slug, publish_id: publishId, prefix: publishPrefix }),
      ),
    );

    // e. Clean up previous publish prefix if it exists (Requirement 16.7)
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
    // Failure path:
    const errorMessage = err instanceof Error ? err.message : String(err);

    // a. Record publish_failure event with error context (Requirement 19.4)
    await dataStore.recordEvent(
      buildEvent(
        projectId,
        'publish_failure',
        JSON.stringify({ slug: project.slug, publish_id: publishId, error: errorMessage }),
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
    // Authenticate every request
    const authResult = authenticate(request, env);
    if (authResult) {
      return authResult;
    }

    return route(request, env);
  },
} satisfies ExportedHandler<Env>;
