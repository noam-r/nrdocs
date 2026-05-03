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
import {
  parseProjectConfig,
  parseNavConfig,
  parseAllowedListConfig,
  validateSlugMatch,
  isValidProjectSlug,
} from '../site-builder/config-parser';
import { buildSite } from '../site-builder/site-builder';
import { decodeRepoContentAssets } from '../publish/asset-ingest';
import { validateToken } from '../auth/token-validator';
import { signNrdocsToken } from '../auth/jwt-utils';
import type { NrdocsTokenPayload } from '../auth/jwt-utils';
import type { OperationalEvent, AccessMode, AccessPolicyEntry, RepoPublishToken } from '../types';
import { verifyGitHubActionsOidcToken } from '../auth/github-oidc';
import type { RepoProofChallengeAction } from '../types';

/** Cloudflare Worker environment bindings. */
export interface Env {
  DB: D1Database;
  BUCKET: R2Bucket;
  API_KEY: string;
  HMAC_SIGNING_KEY: string;
  TOKEN_SIGNING_KEY: string;
  ISSUER_URL?: string;
  DELIVERY_URL?: string;
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

function base64urlEncode(bytes: Uint8Array): string {
  // btoa expects a binary string.
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function randomTokenBase64url(bytes = 32): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return base64urlEncode(buf);
}

async function sha256Base64url(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return base64urlEncode(new Uint8Array(digest));
}

function nowIso(): string {
  return new Date().toISOString();
}

function addSecondsIso(fromIso: string, seconds: number): string {
  const ms = new Date(fromIso).getTime() + seconds * 1000;
  return new Date(ms).toISOString();
}

function parseRepoProofAction(value: unknown): RepoProofChallengeAction | null {
  if (value === 'set_password' || value === 'disable_password' || value === 'set_access_mode') return value;
  return null;
}

async function handleRepoProofIssueChallenge(request: Request, env: Env): Promise<Response> {
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; }
  catch { return jsonError('Invalid JSON body', 400); }

  const { repo_id, repo_identity, action } = body;
  if (!repo_id || typeof repo_id !== 'string') return jsonError('Missing or invalid field: repo_id', 400);
  if (!repo_identity || typeof repo_identity !== 'string') return jsonError('Missing or invalid field: repo_identity', 400);
  const parsedAction = parseRepoProofAction(action);
  if (!parsedAction) return jsonError('Missing or invalid field: action', 400);

  const dataStore = new D1DataStore(env.DB);
  const repo = await dataStore.getRepoById(repo_id);
  if (!repo) return jsonError('Repo not found', 404);
  if (!repo.repo_identity || repo.repo_identity !== repo_identity) {
    return jsonError('repo_identity does not match repo', 403);
  }

  // Replace any stale issued challenge for this (repo, action) so the caller always
  // receives a fresh private_token (private_token is never stored in plaintext).
  await dataStore.deleteIssuedRepoProofChallenges(repo_id, parsedAction);

  const now = nowIso();
  const challengeId = crypto.randomUUID();
  const publicToken = randomTokenBase64url(32);
  const privateToken = randomTokenBase64url(32);
  const privateTokenHash = await sha256Base64url(`${challengeId}.${privateToken}`);
  const expiresAt = addSecondsIso(now, 20 * 60);

  await dataStore.createRepoProofChallenge({
    id: challengeId,
    repo_id,
    repo_identity,
    action: parsedAction,
    public_token: publicToken,
    private_token_hash: privateTokenHash,
    status: 'issued',
    issued_at: now,
    expires_at: expiresAt,
    verified_at: null,
    opened_until: null,
    verify_ref: null,
    verify_sha: null,
    consumed_at: null,
    attempt_count_set: 0,
    attempt_count_verify: 0,
    last_denial_reason: null,
  });

  await dataStore.recordEvent(
    buildEvent(repo_id, 'repo_proof_challenge_issued', JSON.stringify({ repo_identity, action: parsedAction })),
  );

  return jsonResponse({
    challenge_id: challengeId,
    public_token: publicToken,
    private_token: privateToken,
    expires_at: expiresAt,
    verify_file_path: `.nrdocs/challenges/${challengeId}.json`,
    opened_ttl_seconds: 120,
    issued_at: now,
  }, 201);
}

async function handleRepoProofVerifyChallenge(challengeId: string, request: Request, env: Env): Promise<Response> {
  // Auth: GitHub Actions OIDC
  const authHeader = request.headers.get('Authorization');
  if (!authHeader) return jsonError('Missing authentication credentials', 401);
  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') return jsonError('Malformed authentication header', 401);

  const oidcToken = parts[1];
  const expectedAudience = new URL(request.url).origin;
  let claims: Awaited<ReturnType<typeof verifyGitHubActionsOidcToken>>;
  try {
    claims = await verifyGitHubActionsOidcToken(oidcToken, { expectedAudience });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return jsonError(message, 401);
  }
  const callerRepoIdentity = `github.com/${claims.repository}`;

  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; }
  catch { return jsonError('Invalid JSON body', 400); }

  const { repo_identity, ref, sha, public_token } = body;
  if (!repo_identity || typeof repo_identity !== 'string') return jsonError('Missing or invalid field: repo_identity', 400);
  if (!ref || typeof ref !== 'string') return jsonError('Missing or invalid field: ref', 400);
  if (!sha || typeof sha !== 'string') return jsonError('Missing or invalid field: sha', 400);
  if (!public_token || typeof public_token !== 'string') return jsonError('Missing or invalid field: public_token', 400);

  const repoIdentityNormalized = repo_identity.trim();
  if (repoIdentityNormalized !== callerRepoIdentity) {
    return jsonError('repo_identity does not match OIDC repository', 403);
  }

  const dataStore = new D1DataStore(env.DB);
  const challenge = await dataStore.getRepoProofChallengeById(challengeId);
  if (!challenge) return jsonError('Challenge not found', 404);

  if (challenge.repo_identity !== repoIdentityNormalized) return jsonError('Challenge repo_identity mismatch', 403);
  if (challenge.public_token !== public_token) return jsonError('Invalid public_token', 403);

  const now = nowIso();
  if (new Date(challenge.expires_at).getTime() <= Date.now()) {
    return jsonError('Challenge expired', 409);
  }

  if (challenge.status === 'verified_by_push') {
    if (challenge.verify_sha && challenge.verify_ref && (challenge.verify_sha !== sha || challenge.verify_ref !== ref)) {
      return jsonError('Challenge already verified for a different sha/ref', 409);
    }
    return jsonResponse({ status: 'verified', opened_until: challenge.opened_until ?? addSecondsIso(now, 120) }, 200);
  }
  if (challenge.status !== 'issued') {
    return jsonError('Challenge is not issuable', 409);
  }

  const openedUntil = addSecondsIso(now, 120);
  await dataStore.markRepoProofChallengeVerified(challengeId, { verify_ref: ref, verify_sha: sha, opened_until: openedUntil });
  await dataStore.recordEvent(
    buildEvent(challenge.repo_id, 'repo_proof_challenge_verify_success', JSON.stringify({ repo_identity, ref, sha })),
  );
  return jsonResponse({ status: 'verified', opened_until: openedUntil }, 200);
}

async function handleRepoProofSetPassword(request: Request, env: Env): Promise<Response> {
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; }
  catch { return jsonError('Invalid JSON body', 400); }

  const { challenge_id, public_token, private_token, repo_id, password } = body;
  if (!challenge_id || typeof challenge_id !== 'string') return jsonError('Missing or invalid field: challenge_id', 400);
  if (!repo_id || typeof repo_id !== 'string') return jsonError('Missing or invalid field: repo_id', 400);
  if (!public_token || typeof public_token !== 'string') return jsonError('Missing or invalid field: public_token', 400);
  if (!private_token || typeof private_token !== 'string') return jsonError('Missing or invalid field: private_token', 400);
  if (!password || typeof password !== 'string' || password.length === 0) return jsonError('Missing or invalid field: password', 400);

  const dataStore = new D1DataStore(env.DB);
  const challenge = await dataStore.getRepoProofChallengeById(challenge_id);
  if (!challenge) return jsonError('Challenge not found', 404);
  if (challenge.repo_id !== repo_id) return jsonError('Challenge repo mismatch', 403);
  if (challenge.public_token !== public_token) {
    await dataStore.incrementRepoProofChallengeSetAttempts(challenge_id, 'invalid_public_token');
    return jsonError('Invalid token', 403);
  }
  const expectedHash = await sha256Base64url(`${challenge_id}.${private_token}`);
  if (challenge.private_token_hash !== expectedHash) {
    await dataStore.incrementRepoProofChallengeSetAttempts(challenge_id, 'invalid_private_token');
    return jsonError('Invalid token', 403);
  }
  if (challenge.status !== 'verified_by_push') return jsonError('Challenge not verified', 409);
  if (!challenge.opened_until || new Date(challenge.opened_until).getTime() <= Date.now()) return jsonError('Challenge window closed', 409);

  const consumedAt = nowIso();
  const consumed = await dataStore.consumeRepoProofChallenge(challenge_id, { status: 'consumed_success', consumed_at: consumedAt });
  if (!consumed) return jsonError('Challenge already consumed', 409);

  // Apply action: set password (implies password mode)
  const repoRow = await dataStore.getRepoById(repo_id);
  if (!repoRow) return jsonError('Repo not found', 404);
  if (repoRow.access_mode !== 'password') await dataStore.setRepoAccessMode(repo_id, 'password');
  const hash = await PasswordHasher.hash(password);
  await dataStore.setPasswordHash(repo_id, hash);

  await dataStore.recordEvent(
    buildEvent(repo_id, 'repo_proof_password_set_success', JSON.stringify({ repo_identity: challenge.repo_identity })),
  );
  return jsonResponse({ ok: true, repo_id, access_mode: 'password' }, 200);
}

async function handleRepoProofDisablePassword(request: Request, env: Env): Promise<Response> {
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; }
  catch { return jsonError('Invalid JSON body', 400); }

  const { challenge_id, public_token, private_token, repo_id } = body;
  if (!challenge_id || typeof challenge_id !== 'string') return jsonError('Missing or invalid field: challenge_id', 400);
  if (!repo_id || typeof repo_id !== 'string') return jsonError('Missing or invalid field: repo_id', 400);
  if (!public_token || typeof public_token !== 'string') return jsonError('Missing or invalid field: public_token', 400);
  if (!private_token || typeof private_token !== 'string') return jsonError('Missing or invalid field: private_token', 400);

  const dataStore = new D1DataStore(env.DB);
  const challenge = await dataStore.getRepoProofChallengeById(challenge_id);
  if (!challenge) return jsonError('Challenge not found', 404);
  if (challenge.repo_id !== repo_id) return jsonError('Challenge repo mismatch', 403);
  if (challenge.public_token !== public_token) {
    await dataStore.incrementRepoProofChallengeSetAttempts(challenge_id, 'invalid_public_token');
    return jsonError('Invalid token', 403);
  }
  const expectedHash = await sha256Base64url(`${challenge_id}.${private_token}`);
  if (challenge.private_token_hash !== expectedHash) {
    await dataStore.incrementRepoProofChallengeSetAttempts(challenge_id, 'invalid_private_token');
    return jsonError('Invalid token', 403);
  }
  if (challenge.status !== 'verified_by_push') return jsonError('Challenge not verified', 409);
  if (!challenge.opened_until || new Date(challenge.opened_until).getTime() <= Date.now()) return jsonError('Challenge window closed', 409);

  const consumedAt = nowIso();
  const consumed = await dataStore.consumeRepoProofChallenge(challenge_id, { status: 'consumed_success', consumed_at: consumedAt });
  if (!consumed) return jsonError('Challenge already consumed', 409);

  const repoRow = await dataStore.getRepoById(repo_id);
  if (!repoRow) return jsonError('Repo not found', 404);
  await dataStore.setRepoAccessMode(repo_id, 'public');
  await dataStore.clearRepoPassword(repo_id);

  await dataStore.recordEvent(
    buildEvent(repo_id, 'repo_proof_disable_password_success', JSON.stringify({ repo_identity: challenge.repo_identity })),
  );
  return jsonResponse({ ok: true, repo_id, access_mode: 'public' }, 200);
}

/** Stub handler for routes not yet implemented. */
/** Build an OperationalEvent with a fresh UUID and current timestamp. */
export function buildEvent(
  repoId: string | null,
  eventType: OperationalEvent['event_type'],
  detail?: string | null,
): OperationalEvent {
  return {
    id: crypto.randomUUID(),
    repo_id: repoId,
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
  requestedRepoId: string,
  request: Request,
  result: 'allow' | 'deny',
  denialReason?: string,
): Record<string, unknown> {
  return {
    event: 'publish_auth',
    token_jti: tokenRecord.jti,
    token_typ: 'repo_publish',
    token_repo_id: tokenRecord.repo_id,
    token_repo_identity: tokenRecord.repo_identity,
    requested_repo_id: requestedRepoId,
    request_repo_identity: extractRepoIdentity(request) ?? null,
    result,
    denial_reason: denialReason ?? null,
  };
}

// ── Handlers ─────────────────────────────────────────────────────────

const VALID_ACCESS_MODES: AccessMode[] = ['public', 'password'];
const VALID_PROJECT_STATUSES = ['awaiting_approval', 'approved', 'disabled'] as const;

function deliveryUrl(env: Env): string | undefined {
  const value = env.DELIVERY_URL?.trim();
  return value ? value.replace(/\/$/, '') : undefined;
}

function siteDocsUrl(baseUrl: string | undefined, siteSlug: string): string | null {
  if (!baseUrl) return null;
  return `${baseUrl}/${siteSlug}/`;
}

/**
 * POST /repos — Register a new project.
 *
 * Expects JSON body: { slug, repo_url, title, description, access_mode }
 * Returns 201 with the created project, or 409 on slug conflict.
 *
 * Requirements: 2.1, 2.2, 2.3, 2.10, 19.1
 */
async function handleCreateRepo(request: Request, env: Env): Promise<Response> {
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

  try {
    const repo = await dataStore.createRepo({
      slug: slug as string,
      repo_url: repo_url as string,
      title: title as string,
      description: (description as string) ?? '',
      access_mode: access_mode as AccessMode,
      repo_identity: repo_identity as string | undefined,
    });

    await dataStore.recordEvent(
      buildEvent(repo.id, 'registration', JSON.stringify({ slug: repo.slug })),
    );

    return jsonResponse(repo as unknown as Record<string, unknown>, 201);
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
 * POST /repos/:id/approve — Approve a project.
 *
 * Transitions a project from `awaiting_approval` to `approved`.
 * Records an `approval` operational event.
 *
 * Requirements: 2.4, 2.5, 19.2
 */
async function handleApproveRepo(projectId: string, env: Env): Promise<Response> {
  const dataStore = new D1DataStore(env.DB);
  const project = await dataStore.getRepoById(projectId);

  if (!project) {
    return jsonError('Repo not found', 404);
  }

  if (project.status !== 'awaiting_approval') {
    return jsonError(
      `Cannot approve project with status '${project.status}'; must be 'awaiting_approval'`,
      409,
    );
  }

  await dataStore.updateRepoStatus(projectId, 'approved');
  await dataStore.recordEvent(
    buildEvent(projectId, 'approval', JSON.stringify({ slug: project.slug })),
  );

  return jsonResponse({ message: 'Repo approved', id: projectId });
}

/**
 * POST /repos/:id/publish-token — Mint a repo publish JWT (API key auth).
 *
 * Optional JSON body: { repo_identity?: string }. When omitted, uses the project's stored repo_identity.
 * The project must be approved.
 * If the project row has no repo_identity yet, this handler writes it from the body (OIDC requires it on the project).
 */
async function handleMintRepoPublishToken(projectId: string, request: Request, env: Env): Promise<Response> {
  const dataStore = new D1DataStore(env.DB);
  const project = await dataStore.getRepoById(projectId);

  if (!project) {
    return jsonError('Repo not found', 404);
  }

  if (project.status !== 'approved') {
    return jsonError(
      `Cannot mint publish token for project with status '${project.status}'; must be 'approved'`,
      409,
    );
  }

  let body: Record<string, unknown> = {};
  try {
    const text = await request.text();
    if (text.trim()) {
      body = JSON.parse(text) as Record<string, unknown>;
    }
  } catch {
    return jsonError('Invalid JSON body', 400);
  }

  let repoIdentityInput: unknown = body.repo_identity;
  if (repoIdentityInput === undefined || repoIdentityInput === null) {
    repoIdentityInput = project.repo_identity;
  }
  if (typeof repoIdentityInput !== 'string' || !repoIdentityInput.trim()) {
    return jsonError(
      'Missing repo_identity: set it on the project or send JSON {"repo_identity":"github.com/owner/repo"}',
      400,
    );
  }

  let normalized: string;
  try {
    normalized = dataStore.normalizeRepoIdentityForOnboard(repoIdentityInput);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Invalid repo_identity';
    return jsonError(message, 400);
  }

  if (!project.repo_identity?.trim()) {
    try {
      await dataStore.updateRepoRepoIdentity(projectId, normalized);
      await dataStore.recordEvent(
        buildEvent(
          projectId,
          'repo_identity_bound',
          JSON.stringify({ repo_identity: normalized, source: 'publish_token_mint' }),
        ),
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('UNIQUE') || msg.toLowerCase().includes('unique')) {
        return jsonError(
          'repo_identity is already bound to a different repo in this database',
          409,
        );
      }
      throw err;
    }
  }

  const repoPublishJti = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);
  const oneYearFromNow = now + 365 * 24 * 60 * 60;
  const iss = env.ISSUER_URL ?? new URL(request.url).origin;
  const repoPublishPayload: NrdocsTokenPayload = {
    v: 1,
    typ: 'repo_publish',
    iss,
    exp: oneYearFromNow,
    jti: repoPublishJti,
  };
  const repoPublishTokenJwt = await signNrdocsToken(repoPublishPayload, env.TOKEN_SIGNING_KEY);
  const nowIso = new Date().toISOString();
  const expiresAtIso = new Date(oneYearFromNow * 1000).toISOString();

  const repoPublishRow: RepoPublishToken = {
    id: crypto.randomUUID(),
    jti: repoPublishJti,
    repo_id: projectId,
    repo_identity: normalized,
    status: 'active',
    token_source: 'mint',
    created_at: nowIso,
    expires_at: expiresAtIso,
    last_used_at: null,
  };

  await dataStore.createRepoPublishToken(repoPublishRow);
  await dataStore.recordEvent(
    buildEvent(
      projectId,
      'publish_token_mint',
      JSON.stringify({ repo_identity: normalized, source: 'operator_api' }),
    ),
  );

  return jsonResponse({ repo_publish_token: repoPublishTokenJwt }, 201);
}

/**
 * POST /repos/:id/disable — Disable a project.
 *
 * Transitions a project to `disabled` status.
 * Records a `disable` operational event.
 *
 * Requirements: 2.7, 2.8, 19.2
 */
async function handleDisableRepo(projectId: string, env: Env): Promise<Response> {
  const dataStore = new D1DataStore(env.DB);
  const project = await dataStore.getRepoById(projectId);

  if (!project) {
    return jsonError('Repo not found', 404);
  }

  await dataStore.updateRepoStatus(projectId, 'disabled');
  await dataStore.recordEvent(
    buildEvent(projectId, 'disable', JSON.stringify({ slug: project.slug })),
  );

  return jsonResponse({ message: 'Repo disabled', id: projectId });
}

/**
 * DELETE /repos/:id — Delete a project.
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
async function handleDeleteRepo(projectId: string, env: Env): Promise<Response> {
  const dataStore = new D1DataStore(env.DB);
  const project = await dataStore.getRepoById(projectId);

  if (!project) {
    return jsonError('Repo not found', 404);
  }

  // Step 1: Mark disabled so the project returns 404 immediately
  await dataStore.updateRepoStatus(projectId, 'disabled');

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
  try {
    await dataStore.deleteRepo(projectId);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Delete failed for project ${projectId}: ${message}`);
    return jsonError(`Delete failed: ${message}`, 500);
  }

  return jsonResponse({
    message: r2CleanupFailed
      ? 'Project deleted (R2 cleanup failed — manual cleanup required)'
      : 'Project deleted',
    id: projectId,
  });
}

/**
 * POST /repos/:id/publish — Publish a project.
 *
 * Phase 1: The GitHub Actions workflow sends repo content directly in the
 * request body. The Control Plane is the sole build authority.
 *
 * Expects JSON body: { repo_content: { project_yml, nav_yml, allowed_list_yml?, pages, assets? } }
 * Optional `assets` is a map of path (relative to content/) to base64-encoded file bytes (see publish asset limits).
 *
 * Requirements: 3.1-3.10, 8.1-8.7, 13.1, 16.1-16.7, 19.3, 19.4
 */
async function handlePublishRepo(projectId: string, request: Request, env: Env): Promise<Response> {
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
      requested_repo_id: projectId,
    }));
    return jsonError(result.reason, result.statusCode);
  }

  const tokenRecord = result.dbRecord as RepoPublishToken;

  // 1c. Repo binding enforcement
  if (tokenRecord.repo_id !== projectId) {
    const auditCtx = buildAuditContext(tokenRecord, projectId, request, 'deny', 'repo_binding_mismatch');
    console.error(JSON.stringify(auditCtx));
    return jsonError('Token not authorized for this repo', 403);
  }

  // 1d. Load repo and validate existence
  const project = await dataStore.getRepoById(projectId);
  if (!project) {
    return jsonError('Repo not found', 404);
  }

  // 1e. Status check
  if (project.status !== 'approved') {
    return jsonError(
      `Cannot publish repo with status '${project.status}'; must be 'approved'`,
      409,
    );
  }

  // 1f. Repo identity binding (best-effort Phase 1)
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

  const { project_yml, nav_yml, allowed_list_yml, pages, assets: assetsField } = repoContent as {
    project_yml?: string;
    nav_yml?: string;
    allowed_list_yml?: string;
    pages?: Record<string, string>;
    assets?: unknown;
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

  const assetIngest = decodeRepoContentAssets(assetsField);
  if (!assetIngest.ok) {
    return jsonError(assetIngest.error, 400);
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

    for (const bin of assetIngest.items) {
      await storage.put(`${publishPrefix}${bin.path}`, bin.content, bin.contentType);
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
          scope_type: 'repo',
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

    const baseUrl = deliveryUrl(env);
    const readerUrl = siteDocsUrl(baseUrl, project.slug);
    return jsonResponse({
      message: 'Publish successful',
      id: projectId,
      slug: project.slug,
      publish_id: publishId,
      prefix: publishPrefix,
      delivery_url: baseUrl ?? null,
      url: readerUrl,
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

const VALID_SCOPE_TYPES = ['platform', 'repo'] as const;
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
    return jsonError('Missing or invalid field: scope_type (must be "platform" or "repo")', 400);
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
    scope_type: body.scope_type as 'platform' | 'repo',
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
  if (entry.scope_type === 'repo') {
    const project = await dataStore.getRepoById(entry.scope_value);
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
    scope_type: body.scope_type as 'platform' | 'repo',
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
  if (entry.scope_type === 'repo') {
    const project = await dataStore.getRepoById(entry.scope_value);
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
 * GET /repos/:id — Get project details.
 *
 * Returns the full project record.
 */
async function handleGetRepo(projectId: string, env: Env): Promise<Response> {
  const dataStore = new D1DataStore(env.DB);
  const project = await dataStore.getRepoById(projectId);

  if (!project) {
    return jsonError('Repo not found', 404);
  }

  return jsonResponse(project as unknown as Record<string, unknown>);
}

/**
 * GET /status/:id — Limited repo-owner status endpoint.
 *
 * Does not require admin API key. Returns only non-secret lifecycle and URL data.
 */
async function handlePublicRepoStatus(projectId: string, env: Env): Promise<Response> {
  const dataStore = new D1DataStore(env.DB);
  const project = await dataStore.getRepoById(projectId);
  if (!project) {
    return jsonError('Repo not found', 404);
  }

  const baseUrl = deliveryUrl(env);
  const published = Boolean(project.active_publish_pointer);

  return jsonResponse({
    repo_id: project.id,
    slug: project.slug,
    title: project.title,
    status: project.status,
    access_mode: project.access_mode,
    repo_identity: project.repo_identity,
    approved: project.status === 'approved',
    published,
    active_publish_pointer: project.active_publish_pointer,
    delivery_url: baseUrl ?? null,
    url: siteDocsUrl(baseUrl, project.slug),
    updated_at: project.updated_at,
  });
}

/**
 * POST /oidc/publish-credentials — Exchange a GitHub Actions OIDC token for publish credentials.
 *
 * No API key required. Requires a GitHub Actions OIDC token in Authorization header.
 *
 * Response: { repo_id, repo_publish_token, expires_at }
 */
async function handleOidcPublishCredentials(request: Request, env: Env): Promise<Response> {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader) return jsonError('Missing authentication credentials', 401);
  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return jsonError('Malformed authentication header', 401);
  }

  const oidcToken = parts[1];
  const expectedAudience = new URL(request.url).origin;

  let claims: Awaited<ReturnType<typeof verifyGitHubActionsOidcToken>>;
  try {
    claims = await verifyGitHubActionsOidcToken(oidcToken, { expectedAudience });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return jsonError(message, 401);
  }

  const repoIdentity = `github.com/${claims.repository}`;
  const dataStore = new D1DataStore(env.DB);
  const project = await dataStore.getRepoByRepoIdentity(repoIdentity);
  if (!project) {
    return jsonError(`No repo is registered for repository ${repoIdentity}`, 404);
  }
  if (project.status !== 'approved') {
    return jsonError(`Repo is not approved (status: ${project.status})`, 409);
  }

  const repoPublishJti = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);
  const ttlSeconds = 10 * 60;
  const expires = now + ttlSeconds;
  const issuer = env.ISSUER_URL ?? new URL(request.url).origin;

  const payload: NrdocsTokenPayload = {
    v: 1,
    typ: 'repo_publish',
    iss: issuer,
    exp: expires,
    jti: repoPublishJti,
  };

  const jwt = await signNrdocsToken(payload, env.TOKEN_SIGNING_KEY);
  const nowIso = new Date(now * 1000).toISOString();
  const expiresAtIso = new Date(expires * 1000).toISOString();

  const row: RepoPublishToken = {
    id: crypto.randomUUID(),
    jti: repoPublishJti,
    repo_id: project.id,
    repo_identity: repoIdentity,
    status: 'active',
    token_source: 'oidc',
    created_at: nowIso,
    expires_at: expiresAtIso,
    last_used_at: null,
  };

  await dataStore.createRepoPublishToken(row);
  await dataStore.recordEvent(
    buildEvent(
      project.id,
      'publish_token_mint',
      JSON.stringify({ repo_identity: repoIdentity, source: 'oidc_exchange' }),
    ),
  );

  return jsonResponse(
    {
      repo_id: project.id,
      repo_publish_token: jwt,
      expires_at: expiresAtIso,
    },
    201,
  );
}

/**
 * POST /oidc/register-project — Register or refresh a pending repo using GitHub Actions OIDC.
 *
 * No API key. Body: { slug, title, description?, access_mode, repo_url? }.
 * repo_identity is derived from the OIDC token (repository claim).
 */
async function handleOidcRegisterProject(request: Request, env: Env): Promise<Response> {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader) return jsonError('Missing authentication credentials', 401);
  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return jsonError('Malformed authentication header', 401);
  }

  const oidcToken = parts[1];
  const expectedAudience = new URL(request.url).origin;

  let claims: Awaited<ReturnType<typeof verifyGitHubActionsOidcToken>>;
  try {
    claims = await verifyGitHubActionsOidcToken(oidcToken, { expectedAudience });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return jsonError(message, 401);
  }

  const repoIdentity = `github.com/${claims.repository}`;

  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return jsonError('Invalid JSON body', 400);
  }

  const slugRaw = body.slug;
  const titleRaw = body.title;
  const accessModeRaw = body.access_mode;
  if (typeof slugRaw !== 'string' || slugRaw.trim() === '') {
    return jsonError('Missing or invalid field: slug', 400);
  }
  const slug = slugRaw.trim();
  if (!isValidProjectSlug(slug)) {
    return jsonError('Invalid slug format (lowercase letters, digits, hyphens; no leading/trailing hyphen)', 400);
  }

  if (typeof titleRaw !== 'string' || titleRaw.trim() === '') {
    return jsonError('Missing or invalid field: title', 400);
  }
  const title = titleRaw.trim();

  const description = typeof body.description === 'string' ? body.description : '';
  if (typeof body.description !== 'undefined' && typeof body.description !== 'string') {
    return jsonError('Invalid field: description', 400);
  }

  if (
    typeof accessModeRaw !== 'string' ||
    !VALID_ACCESS_MODES.includes(accessModeRaw as AccessMode)
  ) {
    return jsonError('Missing or invalid field: access_mode (must be "public" or "password")', 400);
  }
  const access_mode = accessModeRaw as AccessMode;

  const dataStore = new D1DataStore(env.DB);

  if (body.repo_identity !== undefined) {
    if (typeof body.repo_identity !== 'string') {
      return jsonError('Invalid field: repo_identity', 400);
    }
    let normalizedBody: string;
    try {
      normalizedBody = dataStore.normalizeRepoIdentityForOnboard(body.repo_identity);
    } catch {
      return jsonError('Invalid repo_identity format', 400);
    }
    let normalizedToken: string;
    try {
      normalizedToken = dataStore.normalizeRepoIdentityForOnboard(repoIdentity);
    } catch {
      return jsonError('Invalid repository in OIDC token', 400);
    }
    if (normalizedBody !== normalizedToken) {
      return jsonError('repo_identity does not match OIDC token', 400);
    }
  }

  let repo_url: string;
  if (body.repo_url !== undefined && body.repo_url !== null) {
    if (typeof body.repo_url !== 'string' || body.repo_url.trim() === '') {
      return jsonError('Invalid field: repo_url', 400);
    }
    repo_url = body.repo_url.trim();
  } else {
    repo_url = `https://github.com/${claims.repository}`;
  }

  let normalizedIdentity: string;
  try {
    normalizedIdentity = dataStore.normalizeRepoIdentityForOnboard(repoIdentity);
  } catch {
    return jsonError('Invalid repository in OIDC token', 400);
  }

  const existingByIdentity = await dataStore.getRepoByRepoIdentity(normalizedIdentity);

  if (existingByIdentity) {
    if (existingByIdentity.status === 'disabled') {
      return jsonError('Repo is disabled; contact operator to re-enable', 409);
    }
    if (existingByIdentity.status === 'awaiting_approval' && existingByIdentity.slug !== slug) {
      return jsonError(
        `Conflict: slug "${slug}" does not match pending registration for this repository (registered slug: "${existingByIdentity.slug}")`,
        409,
      );
    }
    return jsonResponse(existingByIdentity as unknown as Record<string, unknown>, 200);
  }

  const slugRow = await dataStore.getRepoBySlug(slug);
  if (slugRow) {
    return jsonError(`Slug "${slug}" is already registered to another repository`, 409);
  }

  try {
    const repo = await dataStore.createRepo({
      slug,
      repo_url,
      title,
      description,
      access_mode,
      repo_identity: normalizedIdentity,
    });

    await dataStore.recordEvent(
      buildEvent(repo.id, 'registration', JSON.stringify({ slug: repo.slug, source: 'oidc_register' })),
    );

    return jsonResponse(repo as unknown as Record<string, unknown>, 201);
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes('already exists')) {
      return jsonError(err.message, 409);
    }
    throw err;
  }
}

/**
 * GET /repos — List projects.
 *
 * Defaults to approved projects only. Use ?all=1 to include every status,
 * or ?status=awaiting_approval|approved|disabled for an explicit status.
 */
async function handleListRepos(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const statusParam = url.searchParams.get('status')?.trim();
  const all = url.searchParams.get('all') === '1' || url.searchParams.get('all') === 'true';
  const accessMode = url.searchParams.get('access_mode')?.trim();

  if (statusParam && !VALID_PROJECT_STATUSES.includes(statusParam as typeof VALID_PROJECT_STATUSES[number])) {
    return jsonError('Invalid status. Expected awaiting_approval, approved, or disabled', 400);
  }
  if (accessMode && !VALID_ACCESS_MODES.includes(accessMode as AccessMode)) {
    return jsonError('Invalid access_mode. Expected public or password', 400);
  }

  try {
    const dataStore = new D1DataStore(env.DB);
    const projects = await dataStore.listRepos({
      status: statusParam
        ? statusParam as typeof VALID_PROJECT_STATUSES[number]
        : all ? undefined : 'approved',
      name: url.searchParams.get('name')?.trim() || undefined,
      slug: url.searchParams.get('slug')?.trim() || undefined,
      title: url.searchParams.get('title')?.trim() || undefined,
      repo_identity: url.searchParams.get('repo_identity')?.trim() || undefined,
      access_mode: accessMode ? accessMode as AccessMode : undefined,
    });

    const baseUrl = deliveryUrl(env);
    const repos = projects.map((project) => ({
      ...(project as unknown as Record<string, unknown>),
      delivery_url: baseUrl ?? null,
      url: siteDocsUrl(baseUrl, project.slug),
    }));

    return jsonResponse({ repos, count: repos.length });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[GET /repos]', msg);
    if (msg.includes('no such table') && msg.includes('repos')) {
      return jsonError(
        'D1 is missing the repos schema. From the nrdocs repo run: wrangler d1 execute nrdocs --remote --file=migrations/0001_single_tenant_repos.sql && wrangler deploy --env control-plane',
        503,
      );
    }
    return jsonError(`Database error: ${msg}`, 500);
  }
}

/**
 * POST /repos/:id/password — Set or update the project password.
 *
 * Expects JSON body: { password: "plaintext-password" }
 * Hashes the password and stores it in D1. Increments password_version,
 * which invalidates all existing session tokens.
 *
 * Only applicable to projects with access_mode 'password'.
 */
async function handleSetPassword(projectId: string, request: Request, env: Env): Promise<Response> {
  // This route supports:
  // - Operator auth via NRDOCS_API_KEY (Authorization: Bearer <api key>)
  // - Repo-owner auth via short-lived repo_publish JWT (Authorization: Bearer <jwt>)
  //
  // Repo-owner auth is used from GitHub Actions after OIDC exchange, enabling
  // password rotation without per-repo secrets and without operator involvement.
  const apiKeyAuth = authenticate(request, env);
  if (apiKeyAuth !== null) {
    const header = request.headers.get('Authorization');
    const parts = header?.split(' ') ?? [];
    const tokenStr = parts.length === 2 && parts[0] === 'Bearer' ? parts[1] : undefined;
    if (!tokenStr) return apiKeyAuth;

    const dataStore = new D1DataStore(env.DB);
    const expectedIssuer = env.ISSUER_URL ?? new URL(request.url).origin;
    const tokenValidation = await validateToken(
      tokenStr,
      env.TOKEN_SIGNING_KEY,
      expectedIssuer,
      dataStore,
      'repo_publish',
    );
    if (!tokenValidation.valid) return jsonError(tokenValidation.reason, tokenValidation.statusCode);
    const tokenRecord = tokenValidation.dbRecord as RepoPublishToken;
    if (tokenRecord.repo_id !== projectId) {
      return jsonError('Token is not authorized for this project', 403);
    }
  }

  const dataStore = new D1DataStore(env.DB);
  const project = await dataStore.getRepoById(projectId);

  if (!project) {
    return jsonError('Repo not found', 404);
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

  // Common journey: start public, later add a password.
  // Setting a password flips the project to access_mode=password.
  if (project.access_mode !== 'password') {
    await dataStore.setRepoAccessMode(projectId, 'password');
  }

  const hash = await PasswordHasher.hash(password);
  await dataStore.setPasswordHash(projectId, hash);

  return jsonResponse({ message: 'Password updated', id: projectId });
}

/**
 * POST /repos/:id/access-mode — Change the project's access mode.
 *
 * Expects JSON body: { access_mode: "public" | "password" }
 *
 * Auth: operator API key or repo_publish JWT scoped to the project.
 */
async function handleSetAccessMode(projectId: string, request: Request, env: Env): Promise<Response> {
  const apiKeyAuth = authenticate(request, env);
  if (apiKeyAuth !== null) {
    const header = request.headers.get('Authorization');
    const parts = header?.split(' ') ?? [];
    const tokenStr = parts.length === 2 && parts[0] === 'Bearer' ? parts[1] : undefined;
    if (!tokenStr) return apiKeyAuth;

    const dataStore = new D1DataStore(env.DB);
    const expectedIssuer = env.ISSUER_URL ?? new URL(request.url).origin;
    const tokenValidation = await validateToken(
      tokenStr,
      env.TOKEN_SIGNING_KEY,
      expectedIssuer,
      dataStore,
      'repo_publish',
    );
    if (!tokenValidation.valid) return jsonError(tokenValidation.reason, tokenValidation.statusCode);
    const tokenRecord = tokenValidation.dbRecord as RepoPublishToken;
    if (tokenRecord.repo_id !== projectId) {
      return jsonError('Token is not authorized for this project', 403);
    }
  }

  const dataStore = new D1DataStore(env.DB);
  const project = await dataStore.getRepoById(projectId);
  if (!project) return jsonError('Repo not found', 404);

  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return jsonError('Invalid JSON body', 400);
  }

  const { access_mode } = body;
  if (!access_mode || typeof access_mode !== 'string' || !VALID_ACCESS_MODES.includes(access_mode as AccessMode)) {
    return jsonError('Missing or invalid field: access_mode (must be "public" or "password")', 400);
  }

  const next = access_mode as AccessMode;
  if (next === project.access_mode) {
    return jsonResponse({ message: 'Access mode unchanged', id: projectId, access_mode: next });
  }

  await dataStore.setRepoAccessMode(projectId, next);
  if (next === 'public') {
    // Turning password off clears the hash and invalidates sessions.
    await dataStore.clearRepoPassword(projectId);
  }

  return jsonResponse({ message: 'Access mode updated', id: projectId, access_mode: next });
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

/** Collapse duplicate slashes and strip a trailing slash (except `/`). */
function normalizePathname(pathname: string): string {
  let p = pathname.replace(/\/{2,}/g, '/');
  if (p.length > 1 && p.endsWith('/')) {
    p = p.slice(0, -1);
  }
  return p;
}

function isOidcPublishCredentialsPath(path: string): boolean {
  return path === '/oidc/publish-credentials' || path.endsWith('/oidc/publish-credentials');
}

function isOidcRegisterProjectPath(path: string): boolean {
  return path === '/oidc/register-project' || path.endsWith('/oidc/register-project');
}

/**
 * Simple path-based router. Matches method + pathname pattern.
 * Supports `:id` path parameters.
 */
function route(request: Request, env: Env): Response | Promise<Response> {
  const url = new URL(request.url);
  const method = request.method;
  const path = normalizePathname(url.pathname);

  const statusMatch = path.match(/^\/status\/([^/]+)$/);
  if (method === 'GET' && statusMatch) {
    return handlePublicRepoStatus(statusMatch[1], env);
  }

  if (method === 'POST' && isOidcPublishCredentialsPath(path)) {
    return handleOidcPublishCredentials(request, env);
  }

  if (method === 'POST' && isOidcRegisterProjectPath(path)) {
    return handleOidcRegisterProject(request, env);
  }

  // Repo-proof challenge routes (repo-owner password management)
  if (method === 'POST' && path === '/repo-proof/challenges') {
    return handleRepoProofIssueChallenge(request, env);
  }
  const rpVerifyMatch = path.match(/^\/repo-proof\/challenges\/([^/]+)\/verify$/);
  if (method === 'POST' && rpVerifyMatch) {
    return handleRepoProofVerifyChallenge(rpVerifyMatch[1], request, env);
  }
  if (method === 'POST' && path === '/repo-proof/password') {
    return handleRepoProofSetPassword(request, env);
  }
  if (method === 'POST' && path === '/repo-proof/disable-password') {
    return handleRepoProofDisablePassword(request, env);
  }

  // Project routes
  if (method === 'POST' && path === '/repos') {
    return handleCreateRepo(request, env);
  }
  if (method === 'GET' && path === '/repos') {
    return handleListRepos(request, env);
  }

  // Match /repos/:id/approve
  const approveMatch = path.match(/^\/repos\/([^/]+)\/approve$/);
  if (method === 'POST' && approveMatch) {
    return handleApproveRepo(approveMatch[1], env);
  }

  // Match /repos/:id/publish-token (before /publish)
  const mintPublishTokenMatch = path.match(/^\/repos\/([^/]+)\/publish-token$/);
  if (method === 'POST' && mintPublishTokenMatch) {
    return handleMintRepoPublishToken(mintPublishTokenMatch[1], request, env);
  }

  // Match /repos/:id/disable
  const disableMatch = path.match(/^\/repos\/([^/]+)\/disable$/);
  if (method === 'POST' && disableMatch) {
    return handleDisableRepo(disableMatch[1], env);
  }

  // Match /repos/:id (GET)
  const getMatch = path.match(/^\/repos\/([^/]+)$/);
  if (method === 'GET' && getMatch) {
    return handleGetRepo(getMatch[1], env);
  }

  // Match /repos/:id (DELETE)
  const deleteMatch = path.match(/^\/repos\/([^/]+)$/);
  if (method === 'DELETE' && deleteMatch) {
    return handleDeleteRepo(deleteMatch[1], env);
  }

  // Match /repos/:id/publish
  const publishMatch = path.match(/^\/repos\/([^/]+)\/publish$/);
  if (method === 'POST' && publishMatch) {
    return handlePublishRepo(publishMatch[1], request, env);
  }

  // Match /repos/:id/password
  const passwordMatch = path.match(/^\/repos\/([^/]+)\/password$/);
  if (method === 'POST' && passwordMatch) {
    return handleSetPassword(passwordMatch[1], request, env);
  }

  // Match /repos/:id/access-mode
  const accessModeMatch = path.match(/^\/repos\/([^/]+)\/access-mode$/);
  if (method === 'POST' && accessModeMatch) {
    return handleSetAccessMode(accessModeMatch[1], request, env);
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
    // Publish endpoint uses repo-publish-token bearer auth, skip API key auth
    // OIDC exchange endpoint uses GitHub OIDC bearer auth, skip API key auth
    // Public status endpoint returns limited non-secret lifecycle data.
    const url = new URL(request.url);
    const path = normalizePathname(url.pathname);
    const isPublishRoute = request.method === 'POST' &&
      /^\/repos\/[^/]+\/publish$/.test(path);
    const isOidcRoute =
      request.method === 'POST' &&
      (isOidcPublishCredentialsPath(path) || isOidcRegisterProjectPath(path));
    const isPublicStatusRoute = request.method === 'GET' &&
      /^\/status\/[^/]+$/.test(path);
    const isPasswordRoute = request.method === 'POST' &&
      /^\/repos\/[^/]+\/password$/.test(path);
    const isAccessModeRoute = request.method === 'POST' &&
      /^\/repos\/[^/]+\/access-mode$/.test(path);
    const isRepoProofRoute = /^\/repo-proof\/.*/.test(path);
    if (!isPublishRoute && !isOidcRoute && !isPublicStatusRoute && !isPasswordRoute && !isAccessModeRoute && !isRepoProofRoute) {
      const authResult = authenticate(request, env);
      if (authResult) {
        return authResult;
      }
    }

    return route(request, env);
  },
} satisfies ExportedHandler<Env>;
