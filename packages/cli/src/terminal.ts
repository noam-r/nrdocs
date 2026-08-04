import { ExitCode } from '@nrdocs/contracts';
import type { Runtime } from './runtime.js';
import { CliError } from './errors.js';

export function requireInteractiveTerminal(runtime: Runtime, action: string): void {
  if (!runtime.stdinIsTTY || !runtime.stdoutIsTTY) {
    throw new CliError({
      code: 'interactive_required',
      phase: 'admin',
      exit_code: ExitCode.Usage,
      safe_message: `${action} requires an interactive terminal.\nRerun this command from an attached terminal.`,
    });
  }
}

export type Terminal = {
  confirm(question: string): Promise<boolean>;
  confirmPhrase(question: string, required: string): Promise<boolean>;
  promptMasked(label: string): Promise<string>;
  promptLine(label: string): Promise<string>;
};

/** Non-functional terminal used when no interactive adapter is injected. */
export function createRejectingTerminal(): Terminal {
  return {
    async confirm() {
      throw new CliError({
        code: 'interactive_required',
        phase: 'admin',
        exit_code: ExitCode.Usage,
        safe_message: 'Interactive confirmation is required.',
      });
    },
    async confirmPhrase() {
      throw new CliError({
        code: 'interactive_required',
        phase: 'admin',
        exit_code: ExitCode.Usage,
        safe_message: 'Interactive confirmation is required.',
      });
    },
    async promptMasked() {
      throw new CliError({
        code: 'interactive_required',
        phase: 'admin',
        exit_code: ExitCode.Usage,
        safe_message: 'Interactive masked input is required.',
      });
    },
    async promptLine() {
      throw new CliError({
        code: 'interactive_required',
        phase: 'admin',
        exit_code: ExitCode.Usage,
        safe_message: 'Interactive input is required.',
      });
    },
  };
}

/**
 * Confirmation helpers for destructive admin flows (wired in later phases).
 * Declining confirmation is a successful exit (0) at the command layer.
 */
export async function confirmOrDecline(
  terminal: Terminal,
  question: string,
): Promise<'confirmed' | 'declined'> {
  return (await terminal.confirm(question)) ? 'confirmed' : 'declined';
}

export async function confirmPhraseOrDecline(
  terminal: Terminal,
  question: string,
  required: string,
): Promise<'confirmed' | 'declined'> {
  return (await terminal.confirmPhrase(question, required)) ? 'confirmed' : 'declined';
}

export function isPublisherCiMode(runtime: Runtime): boolean {
  const url = runtime.env.NRDOCS_URL;
  const token = runtime.env.NRDOCS_TOKEN;
  return Boolean(url && token);
}
