/**
 * Runtime-neutral D1 migrations, row decoding, state transitions, and R2 keys.
 */
import { CONTRACTS_PACKAGE } from '@nrdocs/contracts';

export const PERSISTENCE_PACKAGE = '@nrdocs/persistence' as const;

export function persistenceDependsOnContracts(): string {
  return CONTRACTS_PACKAGE;
}

export * from './constants.js';
export * from './errors.js';
export * from './sql.js';
export * from './migrations.js';
export * from './migrate.js';
export * from './types.js';
export * from './verifiers.js';
export * from './decode.js';
export * from './r2-keys.js';
export * from './r2.js';
export * from './ops.js';
export * from './d1-adapter.js';
export * from './time.js';
// sqlite-adapter is Node-only — import from '@nrdocs/persistence/sqlite'.
