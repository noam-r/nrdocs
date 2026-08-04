/**
 * Local Markdown discovery, validation, rendering, and packaging.
 * Phase 0 placeholder — renderer pipeline arrives in Phases 3–4.
 */
import { CONTRACTS_PACKAGE } from '@nrdocs/contracts';

export const RENDERER_PACKAGE = '@nrdocs/renderer' as const;

export function rendererDependsOnContracts(): string {
  return CONTRACTS_PACKAGE;
}
