/**
 * Runtime-neutral shared contracts for nrdocs 2.0.
 */
export const CONTRACTS_PACKAGE = '@nrdocs/contracts' as const;

export type NrdocsPackageName =
  '@nrdocs/contracts' | '@nrdocs/persistence' | '@nrdocs/renderer' | '@nrdocs/worker' | 'nrdocs';

export function contractsReady(): boolean {
  return true;
}

export * from './ids.js';
export * from './slug.js';
export * from './time.js';
export * from './title.js';
export * from './language.js';
export * from './path-collision.js';
export * from './extensions.js';
export * from './canonical-json.js';
export * from './digest.js';
export * from './exit-codes.js';
export * from './config.js';
export * from './credentials.js';
export * from './instance.js';
export * from './manifest.js';
export * from './api.js';
export * from './publication.js';
export * as fixtures from './fixtures/index.js';
