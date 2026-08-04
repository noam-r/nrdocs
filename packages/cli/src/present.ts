import { ExitCode, type ExitCode as ExitCodeT } from '@nrdocs/contracts';
import type { Runtime } from './runtime.js';
import { CliError, mapUnknownError } from './errors.js';

export type JsonSuccess = {
  ok: true;
  data: unknown;
};

export type JsonFailure = {
  ok: false;
  error: {
    code: string;
    message: string;
    remediation?: string;
  };
  exit_code: ExitCodeT;
};

export function presentHumanSuccess(runtime: Runtime, text: string): void {
  runtime.io.writeStdout(text.endsWith('\n') ? text : `${text}\n`);
}

export function presentJsonSuccess(runtime: Runtime, data: unknown): void {
  const body: JsonSuccess = { ok: true, data };
  runtime.io.writeStdout(`${JSON.stringify(body, null, 2)}\n`);
}

export function presentError(
  runtime: Runtime,
  error: unknown,
  options: { json: boolean },
): ExitCodeT {
  const mapped = mapUnknownError(error);
  if (options.json) {
    const failure: JsonFailure = {
      ok: false,
      error: {
        code: mapped.code,
        message: mapped.safe_message,
        ...(mapped.remediation !== undefined ? { remediation: mapped.remediation } : {}),
      },
      exit_code: mapped.exit_code,
    };
    runtime.io.writeStdout(`${JSON.stringify(failure, null, 2)}\n`);
  } else {
    let text = mapped.safe_message;
    if (mapped.remediation) text += `\n\n${mapped.remediation}`;
    runtime.io.writeStderr(`${text}\n`);
  }
  return mapped.exit_code;
}

export function assertNoSecrets(text: string): void {
  if (/nrd_pub_[A-Za-z0-9_-]+/.test(text) || /Bearer\s+\S+/i.test(text)) {
    throw new CliError({
      code: 'secret_leak',
      phase: 'internal',
      exit_code: ExitCode.InternalSoftware,
      safe_message: 'Refusing to present output that contains a secret.',
    });
  }
}
