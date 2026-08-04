import { ExitCode } from '@nrdocs/contracts';

export type PersistenceErrorCode =
  'invariant' | 'not_found' | 'conflict' | 'constraint' | 'descriptor_mismatch' | 'io';

export class PersistenceError extends Error {
  readonly code: PersistenceErrorCode;
  readonly exit_code: number;

  constructor(code: PersistenceErrorCode, message: string, exitCode?: number) {
    super(message);
    this.name = 'PersistenceError';
    this.code = code;
    this.exit_code =
      exitCode ??
      (code === 'descriptor_mismatch'
        ? ExitCode.CredentialOrAuthority
        : code === 'not_found'
          ? ExitCode.LocalValidation
          : code === 'conflict'
            ? ExitCode.LocalValidation
            : ExitCode.InternalSoftware);
  }
}

export function invariantFailure(message: string): PersistenceError {
  return new PersistenceError('invariant', message);
}

export function notFound(message: string): PersistenceError {
  return new PersistenceError('not_found', message);
}

export function conflict(message: string): PersistenceError {
  return new PersistenceError('conflict', message);
}

export function constraintFailure(message: string): PersistenceError {
  return new PersistenceError('constraint', message);
}

export function descriptorMismatch(message: string): PersistenceError {
  return new PersistenceError('descriptor_mismatch', message, ExitCode.CredentialOrAuthority);
}
