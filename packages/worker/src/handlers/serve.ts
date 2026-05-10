/**
 * Docs serving handler.
 * Serves documentation files to readers at /:owner/:repo/*path.
 */

import type { Env } from '../index.js';
import { findRepoByFullName } from '../db/repos.js';
import { getActivePassword } from '../db/passwords.js';
import { getArtifactFile } from '../artifacts.js';
import { findBuildById } from '../db/builds.js';
import { getMimeType, getSecurityHeaders } from '../mime.js';
import { resolveServingPath } from '../path-resolver.js';
import { getSessionCookie, validateSessionCookie } from '../session.js';
import { renderPasswordPage } from './password-page.js';

export async function handleServe(
  request: Request,
  env: Env,
  url: URL,
): Promise<Response> {
  // Extract owner and repo from the path
  const segments = url.pathname.split('/').filter(Boolean);
  if (segments.length < 2) {
    return notFound();
  }

  const owner = segments[0]!.toLowerCase();
  const repo = segments[1]!.toLowerCase();
  const fullName = `${owner}/${repo}`;

  // Look up repo in D1
  const repoRecord = await findRepoByFullName(env.DB, fullName);

  // Non-revealing 404 for missing, unapproved, or inaccessible repos
  if (!repoRecord) return notFound();
  if (repoRecord.approval_state !== 'approved') return notFound();
  if (!repoRecord.latest_successful_build_id) return notFound();
  if (repoRecord.access_mode === 'none') return notFound();

  // Password access check
  if (repoRecord.access_mode === 'password') {
    const repoPath = `/${owner}/${repo}`;
    const sessionCookie = getSessionCookie(request, repoPath);

    let authenticated = false;
    if (sessionCookie) {
      const session = await validateSessionCookie(sessionCookie, env.SESSION_SECRET);
      if (session && session.repo_id === repoRecord.id) {
        // Verify password version hasn't changed
        const credential = await getActivePassword(env.DB, repoRecord.id);
        if (credential && session.password_version === credential.password_version) {
          authenticated = true;
        }
      }
    }

    if (!authenticated) {
      return renderPasswordPage(fullName);
    }
  }

  // Resolve the file path from the URL
  const resolution = resolveServingPath(url.pathname, owner, repo);

  switch (resolution.type) {
    case 'redirect':
      return new Response(null, {
        status: 301,
        headers: { Location: resolution.location },
      });

    case 'not_found':
      return notFound();

    case 'serve': {
      // Fetch the build to get the artifact prefix
      const build = await findBuildById(env.DB, repoRecord.latest_successful_build_id);
      if (!build || !build.artifact_prefix) {
        return notFound();
      }

      // Normalize file path to lowercase for lookup
      const filePath = resolution.filePath.toLowerCase();

      // Fetch from R2
      const file = await getArtifactFile(
        env.ARTIFACTS,
        repoRecord.id,
        build.id,
        filePath,
      );

      if (!file) {
        return notFound();
      }

      // Determine MIME type
      const mimeType = getMimeType(filePath) ?? 'application/octet-stream';
      const securityHeaders = getSecurityHeaders(filePath);

      return new Response(file.body, {
        status: 200,
        headers: {
          'Content-Type': mimeType,
          'Cache-Control': 'public, max-age=300',
          ...securityHeaders,
        },
      });
    }
  }
}

/** Non-revealing 404 response. */
function notFound(): Response {
  return new Response('Not Found', {
    status: 404,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
