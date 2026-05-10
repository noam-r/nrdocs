/**
 * GitHub OIDC publish endpoint handler.
 * Receives artifact uploads from GitHub Actions via OIDC authentication.
 */

import type { Env } from '../index.js';
import { jsonSuccess, jsonError } from '../responses.js';
import { verifyGithubOidc } from '../oidc.js';
import { extractArtifact } from '../archive.js';
import { buildArtifactPrefix, storeArtifactFile } from '../artifacts.js';
import { getMimeType } from '../mime.js';
import {
  upsertRepo,
  createBuild,
  markBuildSuccess,
  markBuildFailed,
  updateLatestBuild,
  findRepoByGithubId,
  approveRepo,
  matchRules,
  writeAuditEvent,
  hasPassword,
} from '../db/index.js';
import { DEFAULT_MAX_ARCHIVE_SIZE_MB } from '@nrdocs/shared';

interface PublishMetadata {
  site_title?: string;
  requested_access?: string;
}

export async function handlePublish(
  request: Request,
  env: Env,
  _params: Record<string, string>,
): Promise<Response> {
  // 1. Extract Bearer token
  const authHeader = request.headers.get('Authorization');
  if (!authHeader) {
    return jsonError('UNAUTHORIZED', 'Missing Authorization header', 401);
  }

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return jsonError('UNAUTHORIZED', 'Invalid Authorization header format', 401);
  }

  const token = parts[1]!;

  // 2. Verify GitHub OIDC token
  const oidcResult = await verifyGithubOidc(token, 'nrdocs');
  if (!oidcResult.ok) {
    return jsonError('OIDC_VERIFICATION_FAILED', oidcResult.error, 401);
  }

  const claims = oidcResult.claims;

  // 3. Derive repo identity (lowercase normalized)
  const fullName = claims.repository.toLowerCase();
  const ownerName = claims.repository_owner.toLowerCase();
  const repoName = fullName.split('/')[1] ?? '';

  // 4. Check if repo is disabled
  const existingRepo = await findRepoByGithubId(env.DB, claims.repository_id);
  if (existingRepo && existingRepo.approval_state === 'disabled') {
    return jsonError('REPO_DISABLED', 'This repository has been disabled by the operator', 409);
  }

  // 5. Check publish allowlist: repo must be already known OR match an auto-approval rule
  if (!existingRepo) {
    const matchedRule = await matchRules(env.DB, fullName);
    if (!matchedRule) {
      return jsonError(
        'REPO_NOT_ALLOWED',
        `Repository '${fullName}' is not allowed to publish to this instance. The operator must add an auto-approval rule first. Run: nrdocs rules add '${ownerName}/*' --access password`,
        403,
      );
    }
  }

  // 6. Parse multipart form data
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch (_e) {
    return jsonError('INVALID_REQUEST', 'Expected multipart/form-data body', 400);
  }

  const metadataField = formData.get('metadata');
  const artifactField = formData.get('artifact') as unknown as File | string | null;

  if (!artifactField || typeof artifactField === 'string') {
    return jsonError('INVALID_REQUEST', 'Missing artifact file in form data', 400);
  }

  // artifactField is now typed as File
  const artifactFile = artifactField as unknown as { arrayBuffer(): Promise<ArrayBuffer> };

  // 6. Validate metadata
  let metadata: PublishMetadata = {};
  if (metadataField) {
    try {
      metadata = JSON.parse(metadataField) as PublishMetadata;
    } catch (_e) {
      return jsonError('INVALID_METADATA', 'metadata field must be valid JSON', 400);
    }

    if (metadata.site_title !== undefined && typeof metadata.site_title !== 'string') {
      return jsonError('INVALID_METADATA', 'site_title must be a string', 400);
    }
    if (metadata.requested_access !== undefined) {
      if (!['public', 'password'].includes(metadata.requested_access)) {
        return jsonError('INVALID_METADATA', 'requested_access must be "public" or "password"', 400);
      }
    }
  }

  // Check archive size
  const maxArchiveSize = DEFAULT_MAX_ARCHIVE_SIZE_MB * 1024 * 1024;
  const archiveBuffer = await artifactFile.arrayBuffer();
  if (archiveBuffer.byteLength > maxArchiveSize) {
    return jsonError(
      'ARCHIVE_TOO_LARGE',
      `Archive exceeds ${DEFAULT_MAX_ARCHIVE_SIZE_MB}MB limit`,
      400,
    );
  }

  // 7. Extract and validate artifact archive
  const extractResult = await extractArtifact(archiveBuffer);
  if (!extractResult.ok) {
    return jsonError(
      'EXTRACTION_FAILED',
      extractResult.error.message,
      400,
      { code: extractResult.error.code },
    );
  }

  const { files, totalSize, fileCount } = extractResult.result;

  // 8. Upsert repo record
  const repo = await upsertRepo(env.DB, {
    github_repository_id: claims.repository_id,
    owner: ownerName,
    name: repoName,
    full_name: fullName,
    site_title: metadata.site_title,
    requested_access: metadata.requested_access,
  });

  // 9. Create build record (status: uploading)
  const build = await createBuild(env.DB, {
    repo_id: repo.id,
    github_repository_id: claims.repository_id,
    git_sha: claims.sha,
    git_ref: claims.ref,
    workflow_ref: claims.workflow_ref,
    run_id: claims.run_id,
  });

  // 10. Store all extracted files in R2
  try {
    for (const file of files) {
      const contentType = getMimeType(file.path) ?? 'application/octet-stream';
      await storeArtifactFile(
        env.ARTIFACTS,
        repo.id,
        build.id,
        file.path,
        file.content.buffer as ArrayBuffer,
        contentType,
      );
    }
  } catch (_e) {
    // Mark build as failed if storage fails
    await markBuildFailed(env.DB, build.id, 'STORAGE_FAILED', 'Failed to store artifact files in R2');
    return jsonError('STORAGE_FAILED', 'Failed to store artifact files', 500);
  }

  // 11. Compute content hash and mark build as success
  const contentHash = await computeContentHash(files);
  const prefix = buildArtifactPrefix(repo.id, build.id);
  const successBuild = await markBuildSuccess(env.DB, build.id, prefix, totalSize, fileCount, contentHash);

  // 12. Update repo's latest_successful_build_id
  await updateLatestBuild(env.DB, repo.id, build.id);

  // Write publish audit event
  await writeAuditEvent(env.DB, {
    event_type: 'build.published',
    actor_type: 'github_action',
    actor_id: fullName,
    repo_id: repo.id,
    build_id: build.id,
    metadata: {
      git_sha: claims.sha,
      git_ref: claims.ref,
      file_count: fileCount,
      total_size: totalSize,
    },
  });

  // 13. Evaluate auto-approval rules
  let approvalState = repo.approval_state;
  let approvalSource: string | null = null;
  let accessMode = repo.access_mode;

  // Re-fetch repo to get updated state after upsert
  const updatedRepo = await findRepoByGithubId(env.DB, claims.repository_id);
  if (updatedRepo) {
    approvalState = updatedRepo.approval_state;
    accessMode = updatedRepo.access_mode;
  }

  // 14. If repo is pending, check auto-approval rules
  if (approvalState === 'pending') {
    const matchedRule = await matchRules(env.DB, fullName);
    if (matchedRule) {
      // Auto-approve with rule's access mode
      const approved = await approveRepo(env.DB, repo.id, matchedRule.access_mode, `auto_rule:${matchedRule.id}`);
      approvalState = approved.approval_state;
      accessMode = approved.access_mode;
      approvalSource = `auto_rule:${matchedRule.id}`;

      // Write auto-approval audit event
      await writeAuditEvent(env.DB, {
        event_type: 'repo.auto_approved',
        actor_type: 'system',
        actor_id: 'auto_approval',
        repo_id: repo.id,
        rule_id: matchedRule.id,
        metadata: {
          pattern: matchedRule.pattern,
          access_mode: matchedRule.access_mode,
        },
      });
    }
  }

  // 15. Determine serving status
  const servingUrl = `${env.BASE_URL}/${fullName}/`;
  let visible = false;
  let reason: string;
  let requiresPassword = false;

  if (approvalState !== 'approved') {
    reason = 'awaiting_operator_approval';
  } else if (accessMode === 'none') {
    reason = 'access_mode_not_set';
  } else if (accessMode === 'password') {
    const hasPw = await hasPassword(env.DB, repo.id);
    if (!hasPw) {
      reason = 'needs_password';
      requiresPassword = true;
    } else {
      visible = true;
      reason = 'serving';
      requiresPassword = true;
    }
  } else {
    // public
    visible = true;
    reason = 'serving';
  }

  // 16. Build response
  const responseData: Record<string, unknown> = {
    repo: {
      full_name: fullName,
      github_repository_id: claims.repository_id,
    },
    build: {
      id: successBuild.id,
      status: successBuild.status,
      git_sha: claims.sha,
    },
    approval: {
      state: approvalState,
      source: approvalSource,
    },
    access: {
      mode: accessMode,
    },
    serving: {
      visible,
      reason,
      url: servingUrl,
      ...(requiresPassword ? { requires_password: true } : {}),
    },
  };

  return jsonSuccess(responseData);
}

/**
 * Computes a SHA-256 content hash over all file contents (sorted by path).
 */
async function computeContentHash(
  files: Array<{ path: string; content: Uint8Array }>,
): Promise<string> {
  // Sort files by path for deterministic hashing
  const sorted = [...files].sort((a, b) => a.path.localeCompare(b.path));

  // Concatenate all content with path separators
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];
  for (const file of sorted) {
    parts.push(encoder.encode(file.path + '\n'));
    parts.push(file.content);
  }

  // Compute total length
  let totalLen = 0;
  for (const p of parts) totalLen += p.length;

  const combined = new Uint8Array(totalLen);
  let offset = 0;
  for (const p of parts) {
    combined.set(p, offset);
    offset += p.length;
  }

  const hashBuffer = await crypto.subtle.digest('SHA-256', combined);
  const hashArray = new Uint8Array(hashBuffer);
  let hex = '';
  for (let i = 0; i < hashArray.length; i++) {
    hex += hashArray[i]!.toString(16).padStart(2, '0');
  }
  return hex;
}
