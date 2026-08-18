import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  applyMigrations,
  createSiteWithInitialToken,
  insertInstanceMetadata,
  MemoryArtifactStore,
} from '@nrdocs/persistence';
import { openMemorySqlite } from '@nrdocs/persistence/sqlite';
import { formatId, type InstanceId, type SiteId, type TokenRecordId } from '@nrdocs/contracts';
import { ExitCode, createProcessRuntime, main, type Runtime } from './index.js';
import { writeActiveInstanceId, writeInstanceDescriptor } from './instance-store.js';
import { createRejectingTerminal } from './terminal.js';
import { generatePublishingToken } from './admin/crypto.js';

const INST = formatId('inst', new Uint8Array(16).fill(1)) as InstanceId;
const SITE = formatId('site', new Uint8Array(16).fill(2)) as SiteId;
const TOK = formatId('tok', new Uint8Array(16).fill(3)) as TokenRecordId;

function captureIo() {
  let stdout = '';
  let stderr = '';
  return {
    get stdout() {
      return stdout;
    },
    get stderr() {
      return stderr;
    },
    reset() {
      stdout = '';
      stderr = '';
    },
    io: {
      writeStdout: (t: string) => {
        stdout += t;
      },
      writeStderr: (t: string) => {
        stderr += t;
      },
    },
  };
}

async function withAdminDocs(
  fn: (args: {
    runtime: Runtime;
    cap: ReturnType<typeof captureIo>;
    docs: string;
    cwd: string;
    openDb: () => Promise<ReturnType<typeof openMemorySqlite>['executor']>;
    store: MemoryArtifactStore;
  }) => Promise<void>,
) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'nrdocs-nav-loop-'));
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'nrdocs-nav-loop-cwd-'));
  const docs = path.join(cwd, 'docs');
  await fs.mkdir(docs);
  await fs.writeFile(path.join(docs, 'index.md'), '# Home\n');
  await fs.writeFile(path.join(docs, 'clarification-decisions.md'), '# Clarification\n');

  const { executor } = openMemorySqlite();
  await applyMigrations(executor);
  await insertInstanceMetadata(executor, {
    id: INST,
    display_name: 'docs',
    account_id: 'acct',
    resource_suffix: '3f6m8p0q2r4s6t8v0w2x',
    canonical_origin: 'https://docs.example.com',
    deployed_version: '2.0.0',
  });
  const { verifier } = await generatePublishingToken();
  await createSiteWithInitialToken(executor, {
    id: SITE,
    slug: 'handbook',
    access_mode: 'public',
    initialToken: { id: TOK, name: 'initial', token_verifier: verifier },
  });

  const cap = captureIo();
  const runtime = createProcessRuntime({
    homeDir: home,
    cwd,
    platform: 'linux',
    stdoutIsTTY: true,
    stderrIsTTY: true,
    stdinIsTTY: true,
    env: { HOME: home },
    io: cap.io,
  });
  await writeInstanceDescriptor(runtime, {
    instance_id: INST,
    display_name: 'docs',
    canonical_origin: 'https://docs.example.com',
    custom_hostname: null,
    account_id: 'acct',
    resource_suffix: '3f6m8p0q2r4s6t8v0w2x',
    database_id: 'db',
    bucket_name: 'bucket',
    worker_name: 'worker',
    status: 'active',
    deployed_version: '2.0.0',
    reconciliation: null,
  });
  await writeActiveInstanceId(runtime, INST);
  const store = new MemoryArtifactStore();

  try {
    await fn({
      runtime,
      cap,
      docs,
      cwd,
      openDb: async () => executor,
      store,
    });
  } finally {
    await fs.rm(home, { recursive: true, force: true });
    await fs.rm(cwd, { recursive: true, force: true });
  }
}

describe('navigation auto vs generate nav loop', () => {
  it('generate nav without a directory targets the only child nrdocs.yml', async () => {
    await withAdminDocs(async ({ runtime, cap, docs, cwd }) => {
      await fs.writeFile(
        path.join(docs, 'nrdocs.yml'),
        `publish:\n  credential: ${SITE}\ntitle: Handbook\nnavigation: auto\n`,
      );

      expect(await main(['generate', 'nav'], { runtime })).toBe(ExitCode.Success);

      const docsYml = await fs.readFile(path.join(docs, 'nrdocs.yml'), 'utf8');
      expect(docsYml).not.toContain('navigation: auto');
      expect(docsYml).toContain('clarification-decisions.md');
      await expect(fs.access(path.join(cwd, 'nrdocs.yml'))).rejects.toThrow();
      expect(cap.stdout).toContain('Updated nrdocs.yml');
    });
  });

  it('publish auto-materializes explicit navigation without generate nav', async () => {
    await withAdminDocs(async ({ runtime, cap, docs, openDb, store }) => {
      await fs.writeFile(
        path.join(docs, 'nrdocs.yml'),
        `publish:\n  credential: ${SITE}\ntitle: Handbook\nnavigation: auto\n`,
      );

      expect(
        await main(['publish', 'docs'], {
          runtime,
          terminal: createRejectingTerminal(),
          admin: { openDb, artifactStore: store },
        }),
      ).toBe(ExitCode.Success);
      expect(cap.stdout).toContain('Non-standard filenames detected.');
      expect(cap.stdout).toContain('Published successfully.');

      const docsYml = await fs.readFile(path.join(docs, 'nrdocs.yml'), 'utf8');
      expect(docsYml).not.toContain('navigation: auto');
      expect(docsYml).toContain('clarification-decisions.md');
    });
  });

  it('publish succeeds after generate nav targets the same directory', async () => {
    await withAdminDocs(async ({ runtime, cap, docs, openDb, store }) => {
      await fs.writeFile(
        path.join(docs, 'nrdocs.yml'),
        `publish:\n  credential: ${SITE}\ntitle: Handbook\nnavigation: auto\n`,
      );

      expect(await main(['generate', 'nav', 'docs'], { runtime })).toBe(ExitCode.Success);

      const docsYml = await fs.readFile(path.join(docs, 'nrdocs.yml'), 'utf8');
      expect(docsYml).not.toContain('navigation: auto');
      expect(docsYml).toContain('clarification-decisions.md');

      cap.reset();
      expect(
        await main(['publish', 'docs'], {
          runtime,
          terminal: createRejectingTerminal(),
          admin: { openDb, artifactStore: store },
        }),
      ).toBe(ExitCode.Success);
      expect(cap.stdout).toContain('Published successfully.');
      expect(cap.stdout).not.toContain('Non-standard filenames detected.');
    });
  });
});
