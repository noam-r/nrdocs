/**
 * Cloudflare Worker for publish and serve.
 * Phase 7: version + root smoke endpoints. Publish/serve land in later phases.
 */
import { CONTRACTS_PACKAGE } from '@nrdocs/contracts';
import { PERSISTENCE_PACKAGE } from '@nrdocs/persistence';
import { createD1Executor, type D1DatabaseLike } from './persistence-adapter.js';

export const WORKER_PACKAGE = '@nrdocs/worker' as const;

export type WorkerEnv = {
  DB: D1DatabaseLike;
  ARTIFACTS: unknown;
  NRDOCS_INSTANCE_ID: string;
  NRDOCS_PACKAGE_VERSION: string;
  NRDOCS_SESSION_KEY?: string;
};

export function workerDependencies(): { contracts: string; persistence: string } {
  return {
    contracts: CONTRACTS_PACKAGE,
    persistence: PERSISTENCE_PACKAGE,
  };
}

/** Bind the Worker D1 database to the shared persistence executor. */
export function workerPersistence(db: D1DatabaseLike) {
  return createD1Executor(db);
}

export { createD1Executor } from './persistence-adapter.js';
export type { D1DatabaseLike, SqlExecutor } from './persistence-adapter.js';

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/_nrdocs/api/version') {
      return Response.json(
        {
          ok: true,
          data: {
            package_version: env.NRDOCS_PACKAGE_VERSION,
            instance_id: env.NRDOCS_INSTANCE_ID,
            api_versions: [1],
            artifact_schema_versions: [1],
          },
        },
        { headers: { 'cache-control': 'no-store' } },
      );
    }
    if (url.pathname === '/' || url.pathname === '') {
      return new Response('nrdocs', {
        status: 200,
        headers: {
          'content-type': 'text/plain; charset=utf-8',
          'cache-control': 'no-store',
        },
      });
    }
    return new Response('Not found', {
      status: 404,
      headers: {
        'content-type': 'text/plain; charset=utf-8',
        'cache-control': 'no-store',
      },
    });
  },
};
