import { createInterface, type Interface as ReadlineInterface } from 'node:readline';

/**
 * Check if stdin is a TTY (interactive mode).
 */
export function isInteractive(): boolean {
  return !!process.stdin.isTTY;
}

/**
 * Read a single line from stdin using readline.
 * Extracted for testability — tests can override via _setReadLine.
 */
let readLine: (questionText: string) => Promise<string> = (questionText) => {
  const rl: ReadlineInterface = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise<string>((resolve) => {
    rl.question(questionText, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
};

/** @internal — test-only hook to replace the readline implementation. */
export function _setReadLine(fn: (questionText: string) => Promise<string>): void {
  readLine = fn;
}

/**
 * Prompt the user for input with a default value.
 * In non-interactive mode, returns the default or throws if required and no default.
 */
export async function prompt(message: string, defaultValue?: string): Promise<string> {
  if (!isInteractive()) {
    if (defaultValue !== undefined) return defaultValue;
    throw new Error(`Non-interactive mode: no value provided for "${message}" and no default available`);
  }

  const suffix = defaultValue !== undefined ? ` [${defaultValue}]` : '';
  const answer = await readLine(`${message}${suffix}: `);
  const trimmed = answer.trim();
  return trimmed || defaultValue || '';
}

/**
 * Prompt the user for confirmation (y/n).
 */
export async function confirm(message: string, defaultValue?: boolean): Promise<boolean> {
  if (!isInteractive()) {
    if (defaultValue !== undefined) return defaultValue;
    throw new Error(`Non-interactive mode: no value provided for "${message}" and no default available`);
  }

  const hint = defaultValue === true ? 'Y/n' : defaultValue === false ? 'y/N' : 'y/n';
  const answer = await readLine(`${message} (${hint}): `);
  const trimmed = answer.trim().toLowerCase();

  if (trimmed === 'y' || trimmed === 'yes') return true;
  if (trimmed === 'n' || trimmed === 'no') return false;
  return defaultValue ?? false;
}
