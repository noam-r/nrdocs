import { describe, it, expect } from 'vitest';
import {
  normalizeApiBaseUrl,
  buildApiUrl,
  extractFetchError,
  mapPublishExitCode,
  formatPublishFailure,
  parseApiUrlFromConfig,
  parseApiUrlFromWorkflow,
} from '../errors.js';

describe('normalizeApiBaseUrl', () => {
  it('strips trailing slashes', () => {
    expect(normalizeApiBaseUrl('https://docs.example.com/').url).toBe('https://docs.example.com');
  });

  it('strips duplicate /api suffix', () => {
    const result = normalizeApiBaseUrl('https://docs.example.com/api');
    expect(result.url).toBe('https://docs.example.com');
    expect(result.strippedApiSuffix).toBe(true);
  });
});

describe('buildApiUrl', () => {
  it('appends api path to base', () => {
    expect(buildApiUrl('https://docs.example.com', '/api/status')).toBe(
      'https://docs.example.com/api/status',
    );
  });
});

describe('extractFetchError', () => {
  it('extracts ENOTFOUND from cause chain', () => {
    const inner = Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' });
    const outer = new Error('fetch failed', { cause: inner });
    const result = extractFetchError(outer);
    expect(result.kind).toBe('dns_failure');
    expect(result.message).toBe('fetch failed');
    expect(result.cause).toContain('ENOTFOUND');
  });
});

describe('mapPublishExitCode', () => {
  it('maps OIDC failures to 13', () => {
    expect(mapPublishExitCode({ code: 'OIDC_VERIFICATION_FAILED', message: 'x' })).toBe(13);
  });

  it('maps network errors to 14', () => {
    expect(mapPublishExitCode({ code: 'network_error', message: 'fetch failed', status: 0 })).toBe(
      14,
    );
  });

  it('maps repo disabled to 16', () => {
    expect(mapPublishExitCode({ code: 'REPO_DISABLED', message: 'x' })).toBe(16);
  });
});

describe('formatPublishFailure', () => {
  it('includes remediation for network errors', () => {
    const formatted = formatPublishFailure(
      { code: 'network_error', message: 'fetch failed', cause: 'ENOTFOUND', status: 0 },
      { command: 'publish', apiBaseUrl: 'https://docs.example.com', fullName: 'acme/docs' },
    );
    expect(formatted.headline).toContain('Could not reach');
    expect(formatted.fixes.length).toBeGreaterThan(0);
    expect(formatted.exitCode).toBe(14);
  });

  it('includes rule hint for REPO_NOT_ALLOWED', () => {
    const formatted = formatPublishFailure(
      { code: 'REPO_NOT_ALLOWED', message: 'not allowed', status: 403 },
      { command: 'publish', apiBaseUrl: 'https://docs.example.com', fullName: 'acme/docs' },
    );
    expect(formatted.fixes.some((f) => f.includes("rules add 'acme/*'"))).toBe(true);
  });
});

describe('parseApiUrlFromConfig', () => {
  it('parses api_url from yml', () => {
    const content = 'site:\n  title: "Docs"\n  api_url: https://docs.example.com\n';
    expect(parseApiUrlFromConfig(content)).toBe('https://docs.example.com');
  });
});

describe('parseApiUrlFromWorkflow', () => {
  it('parses NRDOCS_API_URL from workflow', () => {
    const content = 'env:\n  NRDOCS_API_URL: https://docs.example.com\n';
    expect(parseApiUrlFromWorkflow(content)).toBe('https://docs.example.com');
  });
});

describe('usesInsecureHttp', () => {
  it('detects http URLs', async () => {
    const { usesInsecureHttp } = await import('../errors.js');
    expect(usesInsecureHttp('http://docs.example.com')).toBe(true);
    expect(usesInsecureHttp('https://docs.example.com')).toBe(false);
  });
});
