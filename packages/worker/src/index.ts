/**
 * nrdocs Worker entry point.
 * Wires up the router with all operator API endpoints and docs serving.
 */

import { Router } from './router.js';
import { jsonError } from './responses.js';
import { handleStatus } from './handlers/status.js';
import { handleOperatorMe } from './handlers/operator-me.js';
import {
  handleListRepos,
  handleGetRepo,
  handleApproveRepo,
  handleDisableRepo,
  handleSetAccess,
  handleSetPassword,
  handleAllowSelfPassword,
  handleDisallowSelfPassword,
} from './handlers/repos.js';
import { handleListRules, handleCreateRule, handleDeleteRule } from './handlers/rules.js';
import { handleListStatic, handleSetStatic, handleDeleteStatic } from './handlers/static-files.js';
import { handlePublish } from './handlers/publish.js';
import { handleAuditLog } from './handlers/audit.js';
import { handleServe } from './handlers/serve.js';
import { handlePasswordLogin } from './handlers/password-auth.js';
import { handleHomepage } from './handlers/homepage.js';
import { isReservedPath } from './path-resolver.js';

export interface Env {
  DB: D1Database;
  ARTIFACTS: R2Bucket;
  OPERATOR_TOKEN: string;
  SESSION_SECRET: string;
  BASE_URL: string;
}

const router = new Router();

// Health / status (no auth required for basic info)
router.get('/api/status', handleStatus);

// Operator identity
router.get('/api/operator/me', handleOperatorMe);

// Repository management
router.get('/api/repos', handleListRepos);
router.get('/api/repos/:owner/:repo', handleGetRepo);
router.post('/api/repos/:owner/:repo/approve', handleApproveRepo);
router.post('/api/repos/:owner/:repo/disable', handleDisableRepo);
router.post('/api/repos/:owner/:repo/access', handleSetAccess);
router.post('/api/repos/:owner/:repo/password', handleSetPassword);
router.post('/api/repos/:owner/:repo/allow-self-password', handleAllowSelfPassword);
router.post('/api/repos/:owner/:repo/disallow-self-password', handleDisallowSelfPassword);

// Auto-approval rules
router.get('/api/auto-approval-rules', handleListRules);
router.post('/api/auto-approval-rules', handleCreateRule);
router.delete('/api/auto-approval-rules/:id', handleDeleteRule);

// Static files (placeholder)
router.get('/api/static', handleListStatic);
router.put('/api/static/:key', handleSetStatic);
router.delete('/api/static/:key', handleDeleteStatic);

// Publish (GitHub OIDC)
router.post('/api/publish', handlePublish);

// Audit log
router.get('/api/audit-log', handleAuditLog);

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const requestId = crypto.randomUUID();

    try {
      // Try API routes first
      const response = await router.handle(request, env);
      if (response) return response;

      const url = new URL(request.url);

      // POST to /_nrdocs/login for password auth
      if (request.method === 'POST' && url.pathname === '/_nrdocs/login') {
        return handlePasswordLogin(request, env);
      }

      // Skip reserved paths — serve homepage at root, 404 for others
      if (url.pathname === '/' && request.method === 'GET') {
        return handleHomepage(request, env);
      }
      if (isReservedPath(url.pathname)) {
        return jsonError('NOT_FOUND', 'Not found', 404);
      }

      // Docs serving path (GET only, must have at least /:owner/:repo)
      if (request.method === 'GET') {
        const segments = url.pathname.split('/').filter(Boolean);
        if (segments.length >= 2) {
          return handleServe(request, env, url);
        }
      }

      // Catch-all: 404 for unmatched routes
      return jsonError('NOT_FOUND', 'Endpoint not found', 404);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error(`[${requestId}] Unhandled error:`, message);
      return new Response(
        JSON.stringify({
          ok: false,
          error: {
            code: 'INTERNAL_ERROR',
            message: 'An internal error occurred',
          },
          request_id: requestId,
        }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    }
  },
};
