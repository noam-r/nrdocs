/**
 * Cloudflare Worker for publish and serve.
 * Phase 0 placeholder — handlers arrive in Phases 9 and 11.
 */
import { CONTRACTS_PACKAGE } from '@nrdocs/contracts';
import { PERSISTENCE_PACKAGE } from '@nrdocs/persistence';

export const WORKER_PACKAGE = '@nrdocs/worker' as const;

export function workerDependencies(): { contracts: string; persistence: string } {
  return {
    contracts: CONTRACTS_PACKAGE,
    persistence: PERSISTENCE_PACKAGE,
  };
}

export default {
  async fetch(): Promise<Response> {
    return new Response('nrdocs worker placeholder', {
      status: 200,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  },
};
