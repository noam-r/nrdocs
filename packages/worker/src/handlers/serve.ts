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
import { findSessionForRepo, normalizeRepoPath } from '../session.js';
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

  const rawOwner = segments[0]!;
  const rawRepo = segments[1]!;
  const owner = rawOwner.toLowerCase();
  const repo = rawRepo.toLowerCase();

  // Redirect mixed-case URLs to lowercase canonical form
  if (rawOwner !== owner || rawRepo !== repo) {
    const normalized =
      url.pathname.replace(`/${rawOwner}/${rawRepo}`, `/${owner}/${repo}`) + url.search;
    return new Response(null, {
      status: 301,
      headers: { Location: normalized },
    });
  }

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
    const repoPath = normalizeRepoPath(`/${owner}/${repo}`);

    let authenticated = false;
    const session = await findSessionForRepo(
      request,
      repoPath,
      repoRecord.id,
      env.SESSION_SECRET,
    );
    if (session) {
      const credential = await getActivePassword(env.DB, repoRecord.id);
      if (credential && session.password_version === credential.password_version) {
        authenticated = true;
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

      let filePath = resolution.filePath;

      // Fetch from R2 (try exact path, then lowercase for legacy publishes)
      let file = await getArtifactFile(
        env.ARTIFACTS,
        repoRecord.id,
        build.id,
        filePath,
      );
      if (!file && filePath !== filePath.toLowerCase()) {
        filePath = filePath.toLowerCase();
        file = await getArtifactFile(
          env.ARTIFACTS,
          repoRecord.id,
          build.id,
          filePath,
        );
      }

      // Root URL: fall back to first page from manifest when index.html is absent
      if (!file && filePath === 'index.html') {
        const fallback = await resolveRootPageFromManifest(
          env,
          repoRecord.id,
          build.id,
        );
        if (fallback) {
          return new Response(null, {
            status: 302,
            headers: { Location: `/${owner}/${repo}/${fallback}` },
          });
        }
      }

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

/** Resolves a root redirect path from the publish manifest (e.g. readme/ for README.md-only docs). */
async function resolveRootPageFromManifest(
  env: Env,
  repoId: string,
  buildId: string,
): Promise<string | null> {
  const manifestFile = await getArtifactFile(env.ARTIFACTS, repoId, buildId, 'nrdocs-manifest.json');
  if (!manifestFile) return null;

  let manifest: { pages?: Array<{ path?: string }> };
  try {
    manifest = JSON.parse(await manifestFile.text()) as { pages?: Array<{ path?: string }> };
  } catch {
    return null;
  }

  const pages = manifest.pages ?? [];
  if (pages.length === 0) return null;

  const indexPage = pages.find((p) => p.path === 'index.html');
  const pagePath = indexPage?.path ?? pages[0]?.path;
  if (!pagePath || pagePath === 'index.html') return null;

  // pagePath is e.g. "getting-started/index.html" → redirect to "getting-started/"
  const dir = pagePath.replace(/\/index\.html$/, '');
  return dir ? `${dir}/` : null;
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
