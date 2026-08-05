/**
 * Disposable Cloudflare end-to-end suite (opt-in).
 *
 * Requires a valid CLOUDFLARE_API_TOKEN (and preferably CLOUDFLARE_ACCOUNT_ID).
 * Creates uniquely scoped resources, exercises deploy bindings + smoke, then cleans up.
 * Never targets an existing user instance.
 *
 * Run: pnpm test:e2e:cloudflare
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatId, type InstanceId } from '@nrdocs/contracts';
import { MIGRATIONS } from '@nrdocs/persistence';
import {
  createLiveCloudflareControlPlane,
  type LiveCloudflareOptions,
} from '../../packages/cli/src/deploy/live-cloudflare.js';
import {
  generateResourceSuffix,
  plannedResourceNames,
} from '../../packages/cli/src/deploy/names.js';
import type { CloudflareControlPlane } from '../../packages/cli/src/deploy/cloudflare.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packagedDir = path.resolve(__dirname, '../../packages/cli/packaged');

async function verifyApiToken(token: string): Promise<boolean> {
  try {
    const res = await fetch('https://api.cloudflare.com/client/v4/user/tokens/verify', {
      headers: { authorization: `Bearer ${token}` },
    });
    const json = (await res.json()) as { success?: boolean };
    return json.success === true;
  } catch {
    return false;
  }
}

async function loadPackaged(name: string): Promise<string> {
  return fs.readFile(path.join(packagedDir, name), 'utf8');
}

async function ensurePackaged(): Promise<void> {
  try {
    await fs.access(path.join(packagedDir, 'worker.mjs'));
  } catch {
    throw new Error(
      'Missing packages/cli/packaged/worker.mjs. Run pnpm --filter nrdocs run bundle:release first.',
    );
  }
}

describe('disposable Cloudflare e2e', () => {
  it('provisions Worker+D1+R2, applies migrations, smokes, and cleans up', async () => {
    const token = process.env.CLOUDFLARE_API_TOKEN?.trim();
    if (!token) {
      console.warn('Skipping: CLOUDFLARE_API_TOKEN not set');
      return;
    }
    if (!(await verifyApiToken(token))) {
      console.warn('Skipping: CLOUDFLARE_API_TOKEN is not a valid Cloudflare API token');
      return;
    }
    await ensurePackaged();

    const cf: CloudflareControlPlane = createLiveCloudflareControlPlane({
      token,
    } satisfies LiveCloudflareOptions);

    const accounts = await cf.listAccounts();
    expect(accounts.length).toBeGreaterThan(0);
    const pinned = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
    const accountId = pinned || accounts[0]!.id;
    if (pinned) {
      expect(accounts.some((a) => a.id === pinned)).toBe(true);
    }

    const pre = await cf.preflight(accountId, false);
    expect(pre.ok).toBe(true);

    const suffix = generateResourceSuffix(globalThis.crypto.getRandomValues(new Uint8Array(16)));
    const names = plannedResourceNames(accountId, suffix);
    const instanceId = formatId(
      'inst',
      globalThis.crypto.getRandomValues(new Uint8Array(16)),
    ) as InstanceId;

    let databaseId = '';
    let workersDevUrl: string | null = null;
    const created = { d1: false, r2: false, worker: false };

    try {
      const d1 = await cf.createD1(accountId, names.database_name);
      databaseId = d1.uuid;
      created.d1 = true;

      await cf.createR2(accountId, names.bucket_name);
      created.r2 = true;

      const marker = new TextEncoder().encode(
        JSON.stringify({
          schema_version: 1,
          instance_id: instanceId,
          account_id: accountId,
          resource_suffix: suffix,
          package_version: '2.0.0',
        }) + '\n',
      );
      await cf.putR2Object(accountId, names.bucket_name, '_nrdocs/instance.json', marker);

      const statements = MIGRATIONS.flatMap((m) =>
        m.statements.map((sql) => ({ sql, params: [] as Array<string | number | null> })),
      );
      await cf.d1Batch(accountId, databaseId, statements);
      await cf.d1Batch(accountId, databaseId, [
        {
          sql: `INSERT INTO instance_metadata (
              id, display_name, account_id, resource_suffix, canonical_origin,
              deployed_version, schema_version, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
          params: [
            instanceId,
            'e2e-disposable',
            accountId,
            suffix,
            `https://${names.worker_name}.workers.dev`,
            '2.0.0',
            new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
          ],
        },
      ]);

      const script = await loadPackaged('worker.mjs');
      const platformCss = await loadPackaged('reader.css');
      const platformJs = await loadPackaged('reader.js');
      const platformMermaid = await loadPackaged('mermaid.js');
      expect(script.length).toBeGreaterThan(10_000);
      expect(platformMermaid.length).toBeGreaterThan(100);

      const deployed = await cf.deployWorker({
        accountId,
        workerName: names.worker_name,
        databaseId,
        bucketName: names.bucket_name,
        instanceId,
        packageVersion: '2.0.0',
        script,
        platformCss,
        platformJs,
        platformMermaid,
        createSessionKey: true,
        sessionKeyBytes: globalThis.crypto.getRandomValues(new Uint8Array(32)),
        workersDev: true,
        customDomain: null,
      });
      created.worker = true;
      workersDevUrl = deployed.workersDevUrl;
      expect(workersDevUrl).toBeTruthy();

      const version = await cf.smokeGet(`${workersDevUrl}/_nrdocs/api/version`);
      const root = await cf.smokeGet(`${workersDevUrl}/`);
      // Some developer networks cannot reach workers.dev; treat as soft failure with clear signal.
      if (version.status === 0 || root.status === 0) {
        console.warn('workers.dev unreachable from this host; control-plane steps still passed');
      } else {
        expect(version.status).toBe(200);
        expect(root.status).toBe(200);
        expect(root.body).toContain('nrdocs');
      }

      // R2 list/delete round-trip
      const listed = await cf.listR2Objects(accountId, names.bucket_name, '_nrdocs/');
      expect(listed.keys.some((k) => k.includes('instance.json'))).toBe(true);
    } finally {
      // Bounded cleanup — best-effort, order: worker → objects → bucket → d1
      try {
        if (created.worker) await cf.deleteWorker(accountId, names.worker_name);
      } catch (e) {
        console.warn('cleanup worker', e);
      }
      try {
        if (created.r2) {
          let cursor: string | undefined;
          for (;;) {
            const page = await cf.listR2Objects(accountId, names.bucket_name, '', {
              ...(cursor ? { cursor } : {}),
              limit: 500,
            });
            for (const key of page.keys) {
              try {
                await cf.deleteR2Object(accountId, names.bucket_name, key);
              } catch {
                /* continue */
              }
            }
            if (!page.cursor) break;
            cursor = page.cursor;
          }
          await cf.deleteR2Bucket(accountId, names.bucket_name);
        }
      } catch (e) {
        console.warn('cleanup r2', e);
      }
      try {
        if (created.d1 && databaseId) await cf.deleteD1(accountId, databaseId);
      } catch (e) {
        console.warn('cleanup d1', e);
      }
    }
  }, 600_000);
});
