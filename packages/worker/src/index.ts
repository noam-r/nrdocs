import { CONTRACTS_PACKAGE } from '@nrdocs/contracts';
import { PERSISTENCE_PACKAGE } from '@nrdocs/persistence';
import { createD1Executor, type D1DatabaseLike } from './persistence-adapter.js';

export const WORKER_PACKAGE = '@nrdocs/worker' as const;

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
  async fetch(): Promise<Response> {
    return new Response('nrdocs worker placeholder', {
      status: 200,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  },
};
