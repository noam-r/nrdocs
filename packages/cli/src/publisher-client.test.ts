import { describe, expect, it } from 'vitest';
import { ExitCode } from '@nrdocs/contracts';
import { CliError } from './errors.js';
import { fetchProtocolVersion } from './publisher-client.js';

describe('fetchProtocolVersion', () => {
  it('requires advertised artifact schema 2', async () => {
    try {
      await fetchProtocolVersion('https://docs.example.com', {
        fetch: async () =>
          new Response(
            JSON.stringify({
              product: 'nrdocs',
              package_version: '2.0.0',
              api_versions: [1],
              artifact_schema_versions: [1],
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
      });
      expect.fail('expected protocol error');
    } catch (error) {
      expect(error).toBeInstanceOf(CliError);
      expect((error as CliError).exit_code).toBe(ExitCode.CompatibilityOrProtocol);
      expect((error as CliError).safe_message).toMatch(/nrdocs deploy --instance/);
    }
  });

  it('accepts a Worker that advertises schemas 1 and 2', async () => {
    await expect(
      fetchProtocolVersion('https://docs.example.com', {
        fetch: async () =>
          new Response(
            JSON.stringify({
              product: 'nrdocs',
              package_version: '2.0.0',
              api_versions: [1],
              artifact_schema_versions: [1, 2],
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
      }),
    ).resolves.toBeUndefined();
  });
});
