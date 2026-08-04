/**
 * Runtime-neutral D1 migrations and persistence operations.
 * Phase 0 placeholder — schema and adapters arrive in Phase 6.
 */
import { CONTRACTS_PACKAGE } from '@nrdocs/contracts';

export const PERSISTENCE_PACKAGE = '@nrdocs/persistence' as const;

export function persistenceDependsOnContracts(): string {
  return CONTRACTS_PACKAGE;
}
