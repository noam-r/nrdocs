/**
 * Published `nrdocs` CLI package.
 * Phase 0 placeholder — command surface arrives in Phase 2+.
 */
import { CONTRACTS_PACKAGE } from '@nrdocs/contracts';
import { PERSISTENCE_PACKAGE } from '@nrdocs/persistence';
import { RENDERER_PACKAGE } from '@nrdocs/renderer';

export const CLI_PACKAGE = 'nrdocs' as const;
export const CLI_VERSION = '2.0.0' as const;

export function cliDependencies(): {
  contracts: string;
  persistence: string;
  renderer: string;
} {
  return {
    contracts: CONTRACTS_PACKAGE,
    persistence: PERSISTENCE_PACKAGE,
    renderer: RENDERER_PACKAGE,
  };
}

export function main(argv: readonly string[] = process.argv.slice(2)): number {
  if (argv.includes('--version') || argv.includes('-V')) {
    process.stdout.write(`${CLI_PACKAGE} ${CLI_VERSION}\n`);
    return 0;
  }
  process.stderr.write(
    'nrdocs 2.0 scaffold is installed. Product commands are not implemented yet.\n',
  );
  return 2;
}
