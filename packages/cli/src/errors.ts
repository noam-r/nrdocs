import { ExitCode, type DomainErrorPhase, type ExitCode as ExitCodeT } from '@nrdocs/contracts';

export type CliErrorOptions = {
  code: string;
  phase: DomainErrorPhase;
  exit_code: ExitCodeT;
  safe_message: string;
  remediation?: string;
  source?: { file?: string; line?: number; column?: number };
};

export class CliError extends Error {
  readonly code: string;
  readonly phase: DomainErrorPhase;
  readonly exit_code: ExitCodeT;
  readonly safe_message: string;
  readonly remediation?: string;
  readonly source?: { file?: string; line?: number; column?: number };

  constructor(options: CliErrorOptions) {
    super(options.safe_message);
    this.name = 'CliError';
    this.code = options.code;
    this.phase = options.phase;
    this.exit_code = options.exit_code;
    this.safe_message = options.safe_message;
    if (options.remediation !== undefined) this.remediation = options.remediation;
    if (options.source !== undefined) this.source = options.source;
  }
}

export function usageError(message: string, remediation?: string): CliError {
  return new CliError({
    code: 'usage',
    phase: 'validation',
    exit_code: ExitCode.Usage,
    safe_message: message,
    ...(remediation !== undefined ? { remediation } : {}),
  });
}

export function localValidationError(message: string, remediation?: string): CliError {
  return new CliError({
    code: 'local_validation',
    phase: 'validation',
    exit_code: ExitCode.LocalValidation,
    safe_message: message,
    ...(remediation !== undefined ? { remediation } : {}),
  });
}

export function credentialError(message: string, remediation?: string): CliError {
  return new CliError({
    code: 'credential_or_authority',
    phase: 'credential',
    exit_code: ExitCode.CredentialOrAuthority,
    safe_message: message,
    ...(remediation !== undefined ? { remediation } : {}),
  });
}

export function ioError(message: string, remediation?: string): CliError {
  return new CliError({
    code: 'local_io',
    phase: 'io',
    exit_code: ExitCode.LocalIoOrState,
    safe_message: message,
    ...(remediation !== undefined ? { remediation } : {}),
  });
}

export function internalError(message: string): CliError {
  return new CliError({
    code: 'internal',
    phase: 'internal',
    exit_code: ExitCode.InternalSoftware,
    safe_message: message,
  });
}

export function unavailableCommand(command: string): CliError {
  return new CliError({
    code: 'command_unavailable',
    phase: 'internal',
    exit_code: ExitCode.InternalSoftware,
    safe_message: `Command not available in this build: ${command}`,
  });
}

export function mapUnknownError(error: unknown): CliError {
  if (error instanceof CliError) return error;
  return internalError('An unexpected nrdocs error occurred.');
}
