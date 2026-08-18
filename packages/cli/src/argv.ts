import { usageError, type CliError } from './errors.js';

export type GlobalFlags = {
  help: boolean;
  version: boolean;
  json: boolean;
  instance?: string;
};

const GLOBAL_ONLY = new Set(['--help', '-h', '--version', '-V', '--json']);

/**
 * Peel known global options from argv. Remaining tokens are command words / args.
 */
export function peelGlobals(argv: readonly string[]): {
  globals: GlobalFlags;
  rest: string[];
} {
  const globals: GlobalFlags = {
    help: false,
    version: false,
    json: false,
  };
  const rest: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--help' || arg === '-h') {
      globals.help = true;
      continue;
    }
    if (arg === '--version' || arg === '-V') {
      globals.version = true;
      continue;
    }
    if (arg === '--json') {
      globals.json = true;
      continue;
    }
    if (arg === '--instance') {
      const value = argv[++i];
      if (value === undefined || value.startsWith('-')) {
        throw usageError('--instance requires an instance ID.');
      }
      globals.instance = value;
      continue;
    }
    if (arg.startsWith('--instance=')) {
      const value = arg.slice('--instance='.length);
      if (!value) throw usageError('--instance requires an instance ID.');
      globals.instance = value;
      continue;
    }
    if (arg === '--token' || arg === '--profile' || arg === '--api-url') {
      throw usageError(`Unknown option: ${arg}`);
    }
    if (arg === '--yes' || arg === '-y') {
      throw usageError('Confirmation bypass flags are not supported.');
    }
    rest.push(arg);
  }

  return { globals, rest };
}

export function parseFlags(
  args: readonly string[],
  options: {
    boolean?: string[];
    string?: string[];
  } = {},
): { flags: Record<string, string | boolean>; positionals: string[] } {
  const boolean = new Set(options.boolean ?? []);
  const string = new Set(options.string ?? []);
  const flags: Record<string, string | boolean> = {};
  const positionals: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === '--') {
      positionals.push(...args.slice(i + 1));
      break;
    }
    if (!arg.startsWith('-')) {
      positionals.push(arg);
      continue;
    }
    if (GLOBAL_ONLY.has(arg) || arg === '--instance' || arg.startsWith('--instance=')) {
      // Already peeled; ignore if somehow present
      if (arg === '--instance') i++;
      continue;
    }
    const eq = arg.indexOf('=');
    const name = eq === -1 ? arg : arg.slice(0, eq);
    const inline = eq === -1 ? undefined : arg.slice(eq + 1);
    if (boolean.has(name)) {
      if (inline !== undefined) throw usageError(`Option ${name} does not take a value.`);
      flags[name] = true;
      continue;
    }
    if (string.has(name)) {
      const value = inline ?? args[++i];
      if (value === undefined || (inline === undefined && value.startsWith('-'))) {
        throw usageError(`Option ${name} requires a value.`);
      }
      flags[name] = value;
      continue;
    }
    throw usageError(`Unknown option: ${name}`);
  }

  return { flags, positionals };
}

export const REMOVED_TOP_LEVEL = new Set([
  'init',
  'repos',
  'status',
  'approve',
  'rules',
  'auth',
  'profiles',
  'doctor',
  'nav',
  'config',
]);

const REMOVED_TOP_LEVEL_REMEDIATION: Record<string, string> = {
  init: [
    'nrdocs 2.0 has no init command. Connect a publication directory with:',
    '  nrdocs connect [directory]',
    'Run: nrdocs --help',
  ].join('\n'),
  nav: 'Use: nrdocs generate nav [directory]',
};

export function removedTopLevelError(command: string): CliError {
  return usageError(
    `Unknown command: ${command}`,
    REMOVED_TOP_LEVEL_REMEDIATION[command] ?? 'Run: nrdocs --help',
  );
}
