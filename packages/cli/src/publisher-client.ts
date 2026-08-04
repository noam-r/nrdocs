import {
  ARTIFACT_CONTENT_TYPE,
  exitCodeForHttpStatus,
  exitCodeForPublisherApiError,
  parseApiErrorEnvelope,
  parseApiSuccessEnvelope,
  parseProtocolVersionData,
  parsePublishResultData,
  parsePublishTargetData,
  PUBLISHER_HEADERS,
  PublisherApiErrorCode,
  type PublishResultData,
  type PublishTargetData,
  type SiteId,
} from '@nrdocs/contracts';
import { CliError, credentialError } from './errors.js';
import { ExitCode } from '@nrdocs/contracts';

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export type PublisherClientOptions = {
  fetch?: FetchLike;
  /** Request timeout in ms (default 5 minutes). */
  timeoutMs?: number;
};

function fetchImpl(options: PublisherClientOptions): FetchLike {
  return options.fetch ?? globalThis.fetch.bind(globalThis);
}

export function mapPublisherHttpFailure(status: number, body: unknown, stage: string): CliError {
  let code: string | undefined;
  let message = `HTTP ${status}`;
  try {
    const envelope = parseApiErrorEnvelope(body);
    code = envelope.error.code;
    message = envelope.error.message;
    const exit = exitCodeForPublisherApiError(envelope.error.code);
    return new CliError({
      code: envelope.error.code,
      phase:
        exit === ExitCode.CredentialOrAuthority
          ? 'credential'
          : exit === ExitCode.LocalValidation
            ? 'validation'
            : exit === ExitCode.RetryableExternal
              ? 'upload'
              : 'upload',
      exit_code: exit,
      safe_message: `Publish failed during ${stage}.\n\n${message}\n\nThe currently published site was not changed.`,
    });
  } catch {
    const exit = exitCodeForHttpStatus(status, code);
    return new CliError({
      code: 'publisher_http_error',
      phase: exit === ExitCode.RetryableExternal ? 'upload' : 'upload',
      exit_code: exit,
      safe_message: `Publish failed during ${stage}.\n\n${message}\n\nThe currently published site was not changed.`,
    });
  }
}

export function mapTransportFailure(error: unknown, stage: string): CliError {
  const detail =
    error instanceof Error &&
    !/nrd_pub_|Bearer\s/i.test(error.message) &&
    error.message.length < 200
      ? error.message
      : 'Network request failed.';
  return new CliError({
    code: 'transport_failure',
    phase: 'upload',
    exit_code: ExitCode.RetryableExternal,
    safe_message: `Publish failed during ${stage}.\n\n${detail}\n\nThe currently published site was not changed.`,
  });
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new CliError({
      code: 'invalid_response',
      phase: 'upload',
      exit_code: ExitCode.CompatibilityOrProtocol,
      safe_message:
        'Publish failed during upload.\n\nServer returned a malformed response.\n\nThe currently published site was not changed.',
    });
  }
}

function originUrl(server: string, pathname: string): string {
  return `${server.replace(/\/$/, '')}${pathname}`;
}

/** Discover protocol compatibility before authenticated publisher calls. */
export async function fetchProtocolVersion(
  server: string,
  options: PublisherClientOptions = {},
): Promise<void> {
  let response: Response;
  try {
    response = await fetchImpl(options)(originUrl(server, '/_nrdocs/api/version'), {
      method: 'GET',
      headers: { accept: 'application/json' },
    });
  } catch (error) {
    throw mapTransportFailure(error, 'protocol discovery');
  }
  if (!response.ok) {
    throw new CliError({
      code: 'protocol_discovery_failed',
      phase: 'credential',
      exit_code: ExitCode.CompatibilityOrProtocol,
      safe_message:
        'Unable to discover the nrdocs protocol version from the server.\nUpgrade or downgrade the CLI to match the instance.',
    });
  }
  let raw: unknown;
  try {
    raw = await response.json();
  } catch {
    throw new CliError({
      code: 'protocol_discovery_failed',
      phase: 'credential',
      exit_code: ExitCode.CompatibilityOrProtocol,
      safe_message:
        'Unable to discover the nrdocs protocol version from the server.\nUpgrade or downgrade the CLI to match the instance.',
    });
  }
  let data;
  try {
    data = parseProtocolVersionData(raw);
  } catch {
    throw new CliError({
      code: 'unsupported_protocol',
      phase: 'credential',
      exit_code: ExitCode.CompatibilityOrProtocol,
      safe_message:
        'This CLI is incompatible with the nrdocs instance protocol.\nUpgrade or downgrade the CLI to match the instance.',
    });
  }
  if (!data.api_versions.includes(1) || !data.artifact_schema_versions.includes(1)) {
    throw new CliError({
      code: 'unsupported_protocol',
      phase: 'credential',
      exit_code: ExitCode.CompatibilityOrProtocol,
      safe_message:
        'This CLI is incompatible with the nrdocs instance protocol.\nUpgrade or downgrade the CLI to match the instance.',
    });
  }
}

export async function fetchPublishTarget(
  server: string,
  token: string,
  options: PublisherClientOptions & { expectedSiteId?: SiteId | null } = {},
): Promise<PublishTargetData> {
  const headers: Record<string, string> = {
    accept: 'application/json',
    authorization: `Bearer ${token}`,
  };
  if (options.expectedSiteId) {
    headers[PUBLISHER_HEADERS.expectedSiteId] = options.expectedSiteId;
  }

  let response: Response;
  try {
    response = await fetchImpl(options)(originUrl(server, '/_nrdocs/api/v1/publish-target'), {
      method: 'GET',
      headers,
    });
  } catch (error) {
    throw mapTransportFailure(error, 'destination validation');
  }

  const body = await readJson(response);
  if (!response.ok) {
    if (response.status === 401) {
      throw credentialError('Invalid publishing token.');
    }
    if (response.status === 403) {
      // Prefer structured mismatch for publish; connect maps separately.
      try {
        const envelope = parseApiErrorEnvelope(body);
        if (envelope.error.code === PublisherApiErrorCode.SiteMismatch) {
          throw new CliError({
            code: 'site_mismatch',
            phase: 'credential',
            exit_code: ExitCode.CredentialOrAuthority,
            safe_message: envelope.error.message,
          });
        }
      } catch (error) {
        if (error instanceof CliError) throw error;
      }
    }
    throw mapPublisherHttpFailure(response.status, body, 'destination validation');
  }

  try {
    return parseApiSuccessEnvelope(body, parsePublishTargetData).data;
  } catch {
    throw new CliError({
      code: 'invalid_response',
      phase: 'credential',
      exit_code: ExitCode.CompatibilityOrProtocol,
      safe_message: 'Server returned an invalid publish-target response.',
    });
  }
}

export async function uploadArtifact(
  server: string,
  token: string,
  input: {
    expectedSiteId: SiteId;
    digest: string;
    gzipBytes: Uint8Array;
  },
  options: PublisherClientOptions = {},
): Promise<PublishResultData> {
  const headers: Record<string, string> = {
    accept: 'application/json',
    authorization: `Bearer ${token}`,
    'content-type': ARTIFACT_CONTENT_TYPE,
    'content-length': String(input.gzipBytes.byteLength),
    [PUBLISHER_HEADERS.expectedSiteId]: input.expectedSiteId,
    [PUBLISHER_HEADERS.artifactDigest]: input.digest,
  };

  let response: Response;
  try {
    response = await fetchImpl(options)(originUrl(server, '/_nrdocs/api/v1/publish'), {
      method: 'POST',
      headers,
      body: Uint8Array.from(input.gzipBytes),
    });
  } catch (error) {
    throw mapTransportFailure(error, 'upload');
  }

  const body = await readJson(response);
  if (!response.ok) {
    throw mapPublisherHttpFailure(response.status, body, 'upload');
  }

  try {
    return parseApiSuccessEnvelope(body, parsePublishResultData).data;
  } catch {
    throw new CliError({
      code: 'invalid_response',
      phase: 'upload',
      exit_code: ExitCode.CompatibilityOrProtocol,
      safe_message:
        'Publish failed during upload.\n\nServer returned an invalid success response.\n\nThe currently published site was not changed.',
    });
  }
}
