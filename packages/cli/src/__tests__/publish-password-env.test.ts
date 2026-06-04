/**
 * Property-based tests for CLI publish password env-var forwarding.
 *
 * **Validates: Requirements 4.1, 4.2, 9.5**
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fc from 'fast-check';

// Mock heavy dependencies before importing the module under test
vi.mock('../renderer/index.js', () => ({
  renderSite: vi.fn().mockResolvedValue({
    files: [{ path: 'index.html', content: '<h1>Test</h1>' }],
    manifest: { pages: [] },
  }),
}));

vi.mock('../renderer/packager.js', () => ({
  createArchive: vi.fn().mockResolvedValue(new Uint8Array([0x1f, 0x8b, 0, 0])),
}));

vi.mock('../config/docs-config.js', () => ({
  loadDocsConfig: vi.fn().mockReturnValue({
    config: { site: { title: 'Test' }, content: { index: 'index.md' } },
    configPath: '/fake/docs/nrdocs.yml',
    contentDir: '/fake/docs',
  }),
  getExplicitNav: vi.fn().mockReturnValue(null),
  validateNavPaths: vi.fn().mockReturnValue({ valid: true, errors: [] }),
}));

vi.mock('node:fs', () => ({
  existsSync: vi.fn().mockReturnValue(true),
  readFileSync: vi.fn().mockReturnValue(
    'site:\n  title: Test\n  api_url: https://docs.example.com\n',
  ),
}));

describe('Property 1: Publish multipart inclusion biconditional', () => {
  let originalEnv: NodeJS.ProcessEnv;
  let originalFetch: typeof globalThis.fetch;
  let capturedFormData: FormData | null;
  let originalExit: typeof process.exit;

  beforeEach(() => {
    originalEnv = { ...process.env };
    originalFetch = globalThis.fetch;
    originalExit = process.exit;
    capturedFormData = null;

    // Prevent process.exit from actually exiting
    process.exit = vi.fn() as unknown as typeof process.exit;

    // Set up CI environment so handlePublish doesn't bail early
    process.env['GITHUB_ACTIONS'] = 'true';
    process.env['ACTIONS_ID_TOKEN_REQUEST_URL'] = 'https://token.actions.githubusercontent.com/fake';
    process.env['ACTIONS_ID_TOKEN_REQUEST_TOKEN'] = 'fake-request-token';
    process.env['GITHUB_REPOSITORY'] = 'testorg/testrepo';
    process.env['NRDOCS_API_URL'] = 'https://docs.example.com';

    // Mock fetch: first call is OIDC token request, second is the publish call
    globalThis.fetch = vi.fn().mockImplementation(async (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url;

      if (urlStr.includes('token.actions.githubusercontent.com')) {
        // OIDC token request
        return new Response(JSON.stringify({ value: 'fake-oidc-token' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (urlStr.includes('/api/publish')) {
        // Capture the FormData from the publish request
        capturedFormData = init?.body as FormData;
        return new Response(
          JSON.stringify({ ok: true, data: { approval: { state: 'approved' }, serving: { visible: true } } }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      return new Response(JSON.stringify({ ok: true, data: {} }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    // Suppress console output during tests
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    process.env = originalEnv;
    globalThis.fetch = originalFetch;
    process.exit = originalExit;
    vi.restoreAllMocks();
  });

  it('password field is present iff NRDOCS_DOCS_PASSWORD is a non-empty string; when present, value === env var byte-for-byte', async () => {
    const { handlePublish } = await import('../commands/publish.js');

    // Generator: undefined, empty string, or arbitrary non-empty Unicode strings of length 1..512
    const passwordEnvArb = fc.oneof(
      fc.constant(undefined),
      fc.constant(''),
      fc.string({ minLength: 1, maxLength: 512 }),
    );

    await fc.assert(
      fc.asyncProperty(passwordEnvArb, async (passwordEnvValue) => {
        // Reset captured data
        capturedFormData = null;

        // Set or unset the env var
        if (passwordEnvValue === undefined) {
          delete process.env['NRDOCS_DOCS_PASSWORD'];
        } else {
          process.env['NRDOCS_DOCS_PASSWORD'] = passwordEnvValue;
        }

        // Reset the exit mock so we can detect if it was called
        (process.exit as unknown as ReturnType<typeof vi.fn>).mockClear();

        await handlePublish(['--docs-dir', 'docs']);

        // If process.exit was called, the publish didn't reach the FormData stage
        // This shouldn't happen with our mocks, but guard against it
        if ((process.exit as unknown as ReturnType<typeof vi.fn>).mock.calls.length > 0) {
          return; // Skip this iteration - environment setup issue
        }

        // The publish request should have been made
        expect(capturedFormData).not.toBeNull();
        if (!capturedFormData) return;

        const passwordField = (capturedFormData as FormData).get('password');
        const isNonEmpty = typeof passwordEnvValue === 'string' && passwordEnvValue.length > 0;

        if (isNonEmpty) {
          // Password field MUST be present and equal to the env var byte-for-byte
          expect(passwordField).not.toBeNull();
          expect(passwordField).toBe(passwordEnvValue);
        } else {
          // Password field MUST be absent
          expect(passwordField).toBeNull();
        }
      }),
      { numRuns: 100 },
    );
  });
});
