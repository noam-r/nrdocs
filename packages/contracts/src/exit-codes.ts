/** Stable process exit taxonomy and publisher HTTP mapping. */

export const ExitCode = {
  Success: 0,
  Usage: 2,
  LocalValidation: 10,
  CredentialOrAuthority: 20,
  RetryableExternal: 30,
  CompatibilityOrProtocol: 40,
  LocalIoOrState: 50,
  InternalSoftware: 70,
  Interrupted: 130,
} as const;

export type ExitCode = (typeof ExitCode)[keyof typeof ExitCode];

export type ExitCategory =
  | 'success'
  | 'usage'
  | 'local_validation'
  | 'credential_or_authority'
  | 'retryable_external'
  | 'compatibility_or_protocol'
  | 'local_io_or_state'
  | 'internal_software'
  | 'interrupted';

export const EXIT_CATEGORY_BY_CODE: Readonly<Record<ExitCode, ExitCategory>> = {
  0: 'success',
  2: 'usage',
  10: 'local_validation',
  20: 'credential_or_authority',
  30: 'retryable_external',
  40: 'compatibility_or_protocol',
  50: 'local_io_or_state',
  70: 'internal_software',
  130: 'interrupted',
};

export const PublisherApiErrorCode = {
  InvalidRequest: 'invalid_request',
  InvalidToken: 'invalid_token',
  SiteMismatch: 'site_mismatch',
  PublishInProgress: 'publish_in_progress',
  ArtifactTooLarge: 'artifact_too_large',
  UnsupportedArtifactFormat: 'unsupported_artifact_format',
  InvalidArtifact: 'invalid_artifact',
  DigestMismatch: 'digest_mismatch',
  PublicationFailed: 'publication_failed',
  TemporarilyUnavailable: 'temporarily_unavailable',
  RateLimited: 'rate_limited',
} as const;

export type PublisherApiErrorCode =
  (typeof PublisherApiErrorCode)[keyof typeof PublisherApiErrorCode];

export const PUBLISHER_API_ERROR_HTTP: Readonly<Record<PublisherApiErrorCode, number>> = {
  invalid_request: 400,
  invalid_token: 401,
  site_mismatch: 403,
  publish_in_progress: 409,
  artifact_too_large: 413,
  unsupported_artifact_format: 415,
  invalid_artifact: 422,
  digest_mismatch: 422,
  publication_failed: 500,
  temporarily_unavailable: 503,
  rate_limited: 429,
};

const API_TO_EXIT: Readonly<Record<PublisherApiErrorCode, ExitCode>> = {
  invalid_token: ExitCode.CredentialOrAuthority,
  site_mismatch: ExitCode.CredentialOrAuthority,
  publish_in_progress: ExitCode.RetryableExternal,
  rate_limited: ExitCode.RetryableExternal,
  publication_failed: ExitCode.RetryableExternal,
  temporarily_unavailable: ExitCode.RetryableExternal,
  artifact_too_large: ExitCode.LocalValidation,
  invalid_request: ExitCode.CompatibilityOrProtocol,
  unsupported_artifact_format: ExitCode.CompatibilityOrProtocol,
  invalid_artifact: ExitCode.CompatibilityOrProtocol,
  digest_mismatch: ExitCode.CompatibilityOrProtocol,
};

export function exitCodeForPublisherApiError(code: PublisherApiErrorCode): ExitCode {
  return API_TO_EXIT[code];
}

export function exitCodeForHttpStatus(status: number, code?: string): ExitCode {
  if (code && code in API_TO_EXIT) {
    return API_TO_EXIT[code as PublisherApiErrorCode];
  }
  if (status === 429) return ExitCode.RetryableExternal;
  if (status >= 500) return ExitCode.RetryableExternal;
  if (status >= 400) return ExitCode.CompatibilityOrProtocol;
  return ExitCode.InternalSoftware;
}

export type DomainErrorPhase =
  | 'config'
  | 'credential'
  | 'validation'
  | 'render'
  | 'packaging'
  | 'upload'
  | 'promotion'
  | 'admin'
  | 'io'
  | 'internal';

export type DomainError = {
  code: string;
  phase: DomainErrorPhase;
  safe_message: string;
  exit_code: ExitCode;
  source?: { file?: string; line?: number; column?: number };
  remediation?: string;
};

export function domainError(input: DomainError): DomainError {
  return { ...input };
}

export function isSafeForOutput(value: unknown): boolean {
  if (value == null) return true;
  if (typeof value === 'string') {
    if (/nrd_pub_[A-Za-z0-9_-]+/.test(value)) return false;
    if (/Bearer\s+\S+/i.test(value)) return false;
    return true;
  }
  return typeof value === 'number' || typeof value === 'boolean';
}
