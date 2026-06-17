/**
 * Error formatting and remediation for CLI commands.
 */

export interface ApiErrorInfo {
  code: string;
  message: string;
  status?: number;
  url?: string;
  cause?: string;
  responseBody?: string;
}

export interface FailureContext {
  command: 'publish' | 'doctor';
  apiBaseUrl?: string;
  fullName?: string;
  archiveSizeBytes?: number;
}

export interface FormattedFailure {
  headline: string;
  details: string[];
  fixes: string[];
  exitCode: number;
}

/** True when a URL uses plain http:// (password-protected docs require HTTPS). */
export function usesInsecureHttp(url: string): boolean {
  const trimmed = url.trim();
  if (!trimmed) return false;
  try {
    const withProto = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    return new URL(withProto).protocol === 'http:';
  } catch {
    return false;
  }
}

/** Normalizes API base URL: trim slashes, strip duplicate /api suffix. */
export function normalizeApiBaseUrl(url: string): { url: string; strippedApiSuffix: boolean } {
  let normalized = url.trim().replace(/\/+$/, '');
  let strippedApiSuffix = false;
  if (normalized.endsWith('/api')) {
    normalized = normalized.slice(0, -4);
    strippedApiSuffix = true;
  }
  return { url: normalized, strippedApiSuffix };
}

/** Builds full URL for an API path. */
export function buildApiUrl(baseUrl: string, apiPath: string): string {
  const { url } = normalizeApiBaseUrl(baseUrl);
  const path = apiPath.startsWith('/') ? apiPath : `/${apiPath}`;
  return `${url}${path}`;
}

/** Walks Error.cause chain for diagnostic details. */
export function extractFetchError(err: unknown): {
  message: string;
  cause?: string;
  kind: string;
} {
  if (!(err instanceof Error)) {
    return { message: String(err), kind: 'unknown' };
  }

  const parts: string[] = [];
  let kind = 'network_error';
  let current: unknown = err;

  for (let depth = 0; depth < 5 && current; depth++) {
    if (current instanceof Error) {
      if (current.message && !parts.includes(current.message)) {
        parts.push(current.message);
      }
      const c = current as Error & { cause?: unknown; code?: string };
      if (c.code) {
        const code = String(c.code);
        parts.push(code);
        if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') kind = 'dns_failure';
        else if (code === 'ECONNREFUSED' || code === 'ECONNRESET') kind = 'connection_refused';
        else if (code === 'CERT_HAS_EXPIRED' || code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE') kind = 'tls_error';
        else if (code === 'UND_ERR_CONNECT_TIMEOUT' || code === 'ETIMEDOUT') kind = 'timeout';
      }
      current = c.cause;
    } else if (typeof current === 'object' && current !== null && 'code' in current) {
      parts.push(String((current as { code: string }).code));
      break;
    } else {
      break;
    }
  }

  const cause = parts.length > 1 ? parts.slice(1).join(' → ') : parts[0];
  return {
    message: err.message,
    cause: cause !== err.message ? cause : undefined,
    kind,
  };
}

/** Maps API error codes to CLI exit codes per spec. */
export function mapPublishExitCode(error: ApiErrorInfo): number {
  const code = error.code.toUpperCase();
  if (code === 'UNAUTHORIZED' || code === 'OIDC_VERIFICATION_FAILED') return 13;
  if (code === 'REPO_DISABLED') return 16;
  if (
    code === 'INVALID_REQUEST' ||
    code === 'EXTRACTION_FAILED' ||
    code === 'INVALID_EXTENSION' ||
    code === 'EXTENSION_NOT_PERMITTED' ||
    code === 'PATH_TRAVERSAL' ||
    code === 'REJECTED_EXTENSION'
  ) {
    return 15;
  }
  if (code === 'network_error' || code === 'timeout' || error.status === 0) return 14;
  return 14;
}

/** Formats a publish failure for console output. */
export function formatPublishFailure(
  error: ApiErrorInfo,
  context: FailureContext,
): FormattedFailure {
  const exitCode = mapPublishExitCode(error);
  const publishUrl = context.apiBaseUrl
    ? buildApiUrl(context.apiBaseUrl, '/api/publish')
    : undefined;

  const details: string[] = [];
  if (publishUrl) details.push(`URL:     ${publishUrl}`);
  if (error.status && error.status > 0) details.push(`HTTP:    ${error.status}`);
  details.push(`Code:    ${error.code}`);
  if (error.message) details.push(`Message: ${error.message}`);
  if (error.cause) details.push(`Cause:   ${error.cause}`);
  if (context.fullName) details.push(`Repo:    ${context.fullName}`);
  if (context.archiveSizeBytes !== undefined) {
    details.push(`Size:    ${(context.archiveSizeBytes / 1024).toFixed(1)} KB`);
  }
  if (error.responseBody) {
    const snippet = error.responseBody.slice(0, 120).replace(/\s+/g, ' ');
    details.push(`Body:    ${snippet}${error.responseBody.length > 120 ? '…' : ''}`);
  }

  let headline: string;
  const fixes: string[] = [];

  if (error.code === 'network_error' || error.status === 0) {
    headline = 'Could not reach nrdocs API';
    fixes.push(
      'Check api_url in docs/nrdocs.yml and NRDOCS_API_URL in .github/workflows/nrdocs.yml match your deployment.',
    );
    if (context.apiBaseUrl) {
      fixes.push(`From a terminal: curl -fsS ${buildApiUrl(context.apiBaseUrl, '/api/status')}`);
    }
    fixes.push('Ask your operator to confirm the Worker is deployed (nrdocs deploy).');
    fixes.push(
      'If the API host is only reachable on a VPN or private network, GitHub Actions cannot publish to it.',
    );
  } else if (error.code === 'UNAUTHORIZED' || error.code === 'OIDC_VERIFICATION_FAILED') {
    headline = 'Publish authentication rejected';
    fixes.push('Ensure the workflow has permissions.id-token: write.');
    fixes.push('Re-run the workflow — OIDC tokens are short-lived.');
    fixes.push('Confirm this repo is publishing to the correct nrdocs instance URL.');
  } else if (error.code === 'REPO_NOT_ALLOWED') {
    headline = 'Publish rejected — repo not on allowlist';
    const owner = context.fullName?.split('/')[0];
    if (owner) {
      fixes.push(`Ask the operator: nrdocs rules add '${owner}/*' --access password`);
    } else {
      fixes.push('Ask the operator to add an auto-approval rule for this repo.');
    }
    fixes.push('Re-run the GitHub Action after the rule exists.');
  } else if (error.code === 'REPO_DISABLED') {
    headline = 'Publish rejected — repo disabled';
    fixes.push('Ask the operator to re-enable the repo or approve it again.');
  } else if (
    error.code === 'EXTENSION_NOT_PERMITTED' ||
    error.code === 'extension_not_permitted'
  ) {
    headline = 'Publish rejected — non-whitelisted file extensions in artifact';
    const owner = context.fullName?.split('/')[0];
    if (owner) {
      fixes.push(
        `Ask the operator: nrdocs rules add '${owner}/*' --access password --allow-unlisted-files true`,
      );
    } else {
      fixes.push(
        'Ask the operator to add or update an auto-approval rule with --allow-unlisted-files true',
      );
    }
    fixes.push('Or remove non-whitelisted files from docs/ before publishing.');
  } else if (error.code === 'timeout') {
    headline = 'Upload timed out';
    fixes.push('Retry the workflow; if it persists, check Worker limits and network stability.');
  } else {
    headline = 'Publish failed';
    fixes.push('Run nrdocs doctor (or nrdocs doctor --ci in GitHub Actions) to diagnose connectivity.');
    if (context.fullName) {
      fixes.push(`Check repo status: nrdocs status ${context.fullName}`);
    }
  }

  return { headline, details, fixes, exitCode };
}

/** Prints a formatted failure to stderr. */
export function printFailure(formatted: FormattedFailure): void {
  console.error(`\nError: ${formatted.headline}\n`);
  for (const line of formatted.details) {
    console.error(`  ${line}`);
  }
  if (formatted.fixes.length > 0) {
    console.error('\nWhat to try:');
    formatted.fixes.forEach((fix, i) => {
      console.error(`  ${i + 1}. ${fix}`);
    });
  }
  console.error('');
}

/** Probes GET /api/status for doctor and preflight. */
export async function probeApiStatus(
  baseUrl: string,
  timeoutMs = 15000,
): Promise<{ ok: boolean; status: number; message: string; version?: string }> {
  const url = buildApiUrl(baseUrl, '/api/status');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) {
      return { ok: false, status: res.status, message: `HTTP ${res.status}` };
    }
    const contentType = res.headers.get('Content-Type') ?? '';
    if (!contentType.includes('json')) {
      const text = await res.text();
      return {
        ok: false,
        status: res.status,
        message: `Non-JSON response (${contentType || 'unknown'}): ${text.slice(0, 80)}`,
      };
    }
    const json = (await res.json()) as { ok?: boolean; data?: { version?: string; service?: string } };
    const version = json.data?.version;
    return {
      ok: true,
      status: res.status,
      message: version ? `OK (nrdocs ${version})` : 'OK',
      version,
    };
  } catch (e) {
    clearTimeout(timer);
    const extracted = extractFetchError(e);
    const label =
      extracted.kind === 'timeout' ? 'timed out' : extracted.cause ?? extracted.message;
    return { ok: false, status: 0, message: label };
  }
}

/** Parses api_url from nrdocs.yml content. */
export function parseApiUrlFromConfig(content: string): string | undefined {
  const match = content.match(/api_url:\s*["']?([^"'\n]+)["']?/);
  return match ? match[1]!.trim() : undefined;
}

/** Parses NRDOCS_API_URL from workflow YAML. */
export function parseApiUrlFromWorkflow(content: string): string | undefined {
  const match = content.match(/NRDOCS_API_URL:\s*(\S+)/);
  return match ? match[1]!.trim() : undefined;
}
