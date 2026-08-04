/**
 * Runtime-neutral shared contracts for nrdocs 2.0.
 * Phase 0 placeholder — schemas and fixtures arrive in Phase 1.
 */
export const CONTRACTS_PACKAGE = '@nrdocs/contracts' as const;

export type NrdocsPackageName =
  '@nrdocs/contracts' | '@nrdocs/persistence' | '@nrdocs/renderer' | '@nrdocs/worker' | 'nrdocs';

export function contractsReady(): boolean {
  return true;
}
