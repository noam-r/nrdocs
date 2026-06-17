/**
 * Password authentication handler for protected docs.
 * Handles POST /_nrdocs/login form submissions.
 */

import type { Env } from '../index.js';
import { jsonError } from '../responses.js';
import { findRepoByFullName } from '../db/repos.js';
import { getActivePassword } from '../db/passwords.js';
import { verifyPassword } from '../crypto.js';
import {
  createSessionCookie,
  buildSetCookieHeader,
  normalizeRepoFullName,
  normalizeRepoPath,
} from '../session.js';
import { isSecureRequest, buildHttpsRepoUrl } from '../request-security.js';
import { renderPasswordPage, renderHttpsRequiredPage } from './password-page.js';

const SESSION_MAX_AGE_SECONDS = 86400; // 24 hours

export async function handlePasswordLogin(
  request: Request,
  env: Env,
): Promise<Response> {
  // Only accept POST with form data
  const contentType = request.headers.get('Content-Type') ?? '';
  if (!contentType.includes('application/x-www-form-urlencoded')) {
    return jsonError('BAD_REQUEST', 'Invalid content type', 400);
  }

  let formData: URLSearchParams;
  try {
    const body = await request.text();
    formData = new URLSearchParams(body);
  } catch {
    return jsonError('BAD_REQUEST', 'Invalid form data', 400);
  }

  const password = formData.get('password') ?? '';
  const repoFullName = normalizeRepoFullName(formData.get('repo') ?? '');

  if (!password || !repoFullName) {
    return jsonError('BAD_REQUEST', 'Missing required fields', 400);
  }

  if (!isSecureRequest(request)) {
    return renderHttpsRequiredPage(
      buildHttpsRepoUrl(request, repoFullName),
      repoFullName,
      'Submit the password again after switching to HTTPS.',
    );
  }

  // Look up repo
  const repo = await findRepoByFullName(env.DB, repoFullName);

  // Non-revealing: if repo not found, not approved, or not password-protected → 404
  if (!repo || repo.approval_state !== 'approved' || repo.access_mode !== 'password') {
    return jsonError('NOT_FOUND', 'Not found', 404);
  }

  // Get active password credential
  const credential = await getActivePassword(env.DB, repo.id);
  if (!credential) {
    return jsonError('NOT_FOUND', 'Not found', 404);
  }

  // Verify password
  const valid = await verifyPassword(
    password,
    credential.password_hash,
    credential.salt,
    credential.iteration_count,
  );

  if (!valid) {
    return renderPasswordPage(repoFullName, 'Incorrect password. Please try again.');
  }

  // Create session cookie
  const sessionData = {
    repo_id: repo.id,
    password_version: credential.password_version,
    expires_at: Date.now() + SESSION_MAX_AGE_SECONDS * 1000,
  };

  const cookieValue = await createSessionCookie(sessionData, env.SESSION_SECRET);
  const repoPath = normalizeRepoPath(`/${repo.full_name}`);
  const setCookie = buildSetCookieHeader(cookieValue, repoPath, SESSION_MAX_AGE_SECONDS);

  // Redirect to the docs root (canonical lowercase URL)
  return new Response(null, {
    status: 303,
    headers: {
      Location: `${repoPath}/`,
      'Set-Cookie': setCookie,
    },
  });
}
