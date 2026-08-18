import * as readline from 'node:readline';
import { ExitCode } from '@nrdocs/contracts';
import type { Runtime } from './runtime.js';
import { CliError, interruptedError } from './errors.js';

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

function formatPrompt(label: string): string {
  return label.endsWith(' ') || label.endsWith(':') ? `${label} ` : `${label}: `;
}

async function readLine(label: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: Boolean(process.stdin.isTTY && process.stdout.isTTY),
  });
  try {
    return await new Promise<string>((resolve, reject) => {
      let settled = false;
      const fail = () => {
        if (settled) return;
        settled = true;
        reject(interruptedError());
      };
      rl.once('SIGINT', fail);
      rl.question(formatPrompt(label), (answer) => {
        if (settled) return;
        settled = true;
        resolve(answer);
      });
    });
  } finally {
    rl.close();
  }
}

async function readMasked(label: string): Promise<string> {
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== 'function') {
    // Fallback for rare non-TTY injection paths; production admin requires a TTY.
    return readLine(label);
  }
  const prompt = formatPrompt(label);
  process.stdout.write(prompt);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf8');
  let value = '';
  try {
    return await new Promise<string>((resolve, reject) => {
      const onData = (chunk: string) => {
        for (const char of chunk) {
          if (char === '\n' || char === '\r' || char === '\u0004') {
            cleanup();
            process.stdout.write('\n');
            resolve(value);
            return;
          }
          if (char === '\u0003') {
            cleanup();
            reject(interruptedError());
            return;
          }
          if (char === '\u007f' || char === '\b') {
            if (value.length > 0) {
              value = value.slice(0, -1);
              process.stdout.write('\b \b');
            }
            continue;
          }
          if (char < ' ' && char !== '\t') continue;
          value += char;
          process.stdout.write('*');
        }
      };
      const cleanup = () => {
        process.stdin.off('data', onData);
        if (typeof process.stdin.setRawMode === 'function') {
          process.stdin.setRawMode(false);
        }
        process.stdin.pause();
      };
      process.stdin.on('data', onData);
    });
  } catch (error) {
    if (typeof process.stdin.setRawMode === 'function') {
      process.stdin.setRawMode(false);
    }
    throw error;
  }
}

/** Interactive terminal backed by process stdin/stdout (production CLI default). */
export function createProcessTerminal(): Terminal {
  return {
    async promptLine(label) {
      return readLine(label);
    },
    async promptMasked(label) {
      return readMasked(label);
    },
    async confirm(question) {
      const answer = (await readLine(`${question} [y/N]`)).trim().toLowerCase();
      return answer === 'y' || answer === 'yes';
    },
    async confirmPhrase(question, required) {
      const answer = await readLine(question);
      return answer === required;
    },
  };
}

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
